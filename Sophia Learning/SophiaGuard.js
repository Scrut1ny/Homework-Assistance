// ==UserScript==
// @name        Sophia Guard
// @namespace   https://github.com/Scrut1ny
// @match       https://*.sophia.org/*
// @version     30.0
// @author      Scrut1ny
// @description Copies Q&A & blocks all tracking in real-time
// @run-at      document-start
// @grant       GM_setClipboard
// @grant       unsafeWindow
// ==/UserScript==

(() => {
    "use strict";

    const w = unsafeWindow;

    // --- CONFIGURATION ---
    const BLOCKED_HOSTS = new Set([
        "cdn.optimizely.com", "static.cloudflareinsights.com", "stat.sophia.org",
        "stats.sophia.org", "dpm.demdex.net", "js.hs-scripts.com",
        "analytics.sophia.org", "assets.adobedtm.com"
    ]);

    const TRACKING_CONFIG = {
        push: {
            dataLayer: {
                trigger: "event",
                block: new Set([
                    "modal_view", "modal_close", "alert_view", "click_link", "click_toggle",
                    "form_view", "form_start", "form_submit", "form_field_change", "form_progress",
                    "login", "student_expired", "show_tour", "close_tour"
                ])
            },
            optimizely: {
                trigger: "type",
                block: new Set(["event", "user", "activate"])
            }
        },
        call: {
            ga: new Set(["pageview", "send", "create", "require"]),
            snowplow: new Set(["trackPageView", "trackStructEvent", "newTracker"])
        }
    };

    const BLOCKED_COOKIE_RE = /^(sophia_st|AMCVS?|_sp_)/;
    const BLOCKED_STORAGE_KEYS = new Set(["postponed_form_submit"]);

    const A_SELECTOR = ".challenge-v2-answer__list, .multiple-choice-answer-fields";
    const Q_STRIP = "ul.multiple-choice-answer-fields, ul.answer-fields, .challenge-v2-answer__list, #resubmit-message-place, #helpful-tutorials-message-place, .button-block, .control-section, .assessment-report-wrapper, .letter";
    const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const PREFIX_RE = /^[a-h]\.\)\s*/i;

    // --- STATE ---
    let logContainer = null;
    let activeToast = null;
    let lastCopiedHash = 0;
    let lastRawText = "";
    let extractTimeout = null;
    let toastTimer = null;
    let initialized = false;
    
    const MAX_LOGS = 8;
    
    // --- UI ---
    const ROOT = document.documentElement;
    
    const injectStyles = () => {
        if (document.getElementById("hp-styles")) return;
    
        const style = document.createElement("style");
        style.id = "hp-styles";
        style.textContent =
            "#hp-log-container{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:6px;z-index:2147483647;pointer-events:none;align-items:flex-end}" +
            ".hp-log{background:#1a1a1a;color:#ff5555;border:1px solid #333;padding:6px 10px;border-radius:4px;font-size:13px;font-family:Consolas,monospace;font-weight:bold;animation:hp-fade 6s ease forwards;opacity:1;box-shadow:0 4px 12px rgba(0,0,0,.5);pointer-events:auto;min-width:150px;display:flex;align-items:center;gap:8px}" +
            ".hp-toast{position:fixed;bottom:16px;left:16px;padding:8px 12px;background:#1a1a1a;color:#4dff88;border:1px solid #333;border-left:3px solid #4dff88;border-radius:4px;font-size:20px;font-family:Consolas,monospace;z-index:2147483647;font-weight:bold;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.5);animation:hp-slide-in-left .3s ease forwards}" +
            "@keyframes hp-fade{0%{opacity:0;transform:translateY(10px)}5%{opacity:1;transform:translateY(0)}85%{opacity:1;transform:translateY(-5px)}100%{opacity:0;transform:translateY(-20px)}}" +
            "@keyframes hp-slide-in-left{0%{opacity:0;transform:translateX(-20px)}100%{opacity:1;transform:translateX(0)}}";
    
        (document.head || ROOT).appendChild(style);
    };
    
    const extractHost = (str) => {
        const s = str.indexOf("://");
        if (s === -1) return str;
    
        const start = s + 3;
        const end = str.indexOf("/", start);
    
        return end === -1
            ? str.slice(start)
            : str.substring(start, end);
    };
    
    const pushLog = (rawMsg) => {
        if (!logContainer) {
            logContainer = document.createElement("div");
            logContainer.id = "hp-log-container";
            document.body.appendChild(logContainer);
        }
    
        const el = document.createElement("div");
        el.className = "hp-log";
        el.textContent = "\u{1F6E1}\uFE0F " + extractHost(rawMsg);
    
        logContainer.appendChild(el);
    
        while (logContainer.children.length > MAX_LOGS) {
            logContainer.firstElementChild.remove();
        }
    
        el.addEventListener("animationend", () => {
            if (el.isConnected) {
                el.remove();
            }
        }, { once: true });
    };
    
    const toast = (msg) => {
        if (activeToast) {
            activeToast.remove();
            activeToast = null;
        }
    
        clearTimeout(toastTimer);
    
        const el = document.createElement("div");
        el.className = "hp-toast";
        el.textContent = msg;
    
        document.body.appendChild(el);
        activeToast = el;
    
        toastTimer = setTimeout(() => {
            if (el.isConnected) {
                el.remove();
            }
            activeToast = null;
        }, 2500);
    };

    // --- NETWORK & REQUEST BLOCKING ---
    const isBlocked = (urlStr) => {
        if (!urlStr) return false;
        const s = urlStr.indexOf("//");
        if (s === -1) return false;
        const start = s + 2;
        const end = urlStr.indexOf("/", start);
        const host = end === -1 ? urlStr.slice(start) : urlStr.substring(start, end);
        return BLOCKED_HOSTS.has(host);
    };

    const patchNetwork = () => {
        const origFetch = w.fetch;
        const blockedResponse = new Response("", { status: 200 });
        const patched_fetch = function (input, init) {
            const url = typeof input === "string" ? input : input.url;
            if (isBlocked(url)) {
                pushLog(url);
                return Promise.resolve(blockedResponse.clone());
            }
            return origFetch.call(this, input, init);
        };
        Object.defineProperty(w, "fetch", {
            value: patched_fetch,
            writable: false,
            configurable: false
        });

        const XHR = w.XMLHttpRequest.prototype;
        const origOpen = XHR.open;
        const origSend = XHR.send;
        const blockedXHRs = new WeakSet();

        const patched_open = function (method, url, async, user, pass) {
            if (isBlocked(url)) {
                blockedXHRs.add(this);
                pushLog(url);
                return;
            }
            return origOpen.call(this, method, url, async, user, pass);
        };

        const patched_send = function (body) {
            if (blockedXHRs.has(this)) return;
            return origSend.call(this, body);
        };

        Object.defineProperty(XHR, "open", {
            value: patched_open,
            writable: false,
            configurable: false
        });
        Object.defineProperty(XHR, "send", {
            value: patched_send,
            writable: false,
            configurable: false
        });

        const origBeacon = w.navigator.sendBeacon;
        if (origBeacon) {
            const patched_beacon = function (url, data) {
                if (isBlocked(url)) {
                    pushLog(url);
                    return true;
                }
                return origBeacon.call(this, url, data);
            };
            Object.defineProperty(w.navigator, "sendBeacon", {
                value: patched_beacon,
                writable: false,
                configurable: false
            });
        }
    };

    // --- TRACKING INTERCEPTION ---
    const installTrap = (key, type, rules) => {
        const isPush = type === "push";
        const isDataLayer = key === "dataLayer";

        const wrapPush = (target) => {
            const origPush = Array.prototype.push;
            target.push = function (...args) {
                for (let i = args.length - 1; i >= 0; i--) {
                    const arg = args[i];
                    if (arg && typeof arg === "object") {
                        if (isDataLayer) {
                            delete arg.session_duration;
                            if ("userId" in arg) {
                                pushLog(`${key}: userId leak (${arg.event || "unknown"})`);
                                args.splice(i, 1);
                                continue;
                            }
                        }
                        const val = arg[rules.trigger];
                        if (val && rules.block.has(val)) {
                            pushLog(`${key}: ${val}`);
                            args.splice(i, 1);
                        }
                    }
                }
                if (args.length) return origPush.apply(this, args);
            };
            return target;
        };

        const wrapCall = (target) => {
            return function (...args) {
                if (rules.has(args[0])) {
                    pushLog(`${key}: ${args[0]}`);
                    return;
                }
                return target.apply(this, args);
            };
        };

        const wrap = (val) => {
            if (!val) return val;
            return isPush ? wrapPush(val) : wrapCall(val);
        };

        const fallback = isPush ? [] : function () {
            (w[key].q = w[key].q || []).push(arguments);
        };

        let current = wrap(w[key] || fallback);

        try {
            Object.defineProperty(w, key, {
                configurable: true,
                get: () => current,
                set: (val) => { current = wrap(val); }
            });
        } catch (e) {
            console.warn(`Failed to hook ${key}`, e);
        }
    };

    const patchTracking = () => {
        for (const [type, entries] of Object.entries(TRACKING_CONFIG)) {
            for (const [key, rules] of Object.entries(entries)) {
                installTrap(key, type, rules);
            }
        }
    };

    // --- STORAGE DEFENSE ---
    const activateCookieDefense = async () => {
        const store = w.cookieStore;
        if (!store) return;

        const purge = (name) => {
            store.delete(name);
            pushLog(`Cookie: ${name}`);
        };

        for (const { name } of await store.getAll()) {
            if (BLOCKED_COOKIE_RE.test(name)) purge(name);
        }

        store.addEventListener("change", ({ changed }) => {
            for (const { name } of changed) {
                if (BLOCKED_COOKIE_RE.test(name)) purge(name);
            }
        });
    };

    const patchLocalStorage = () => {
        const origSetItem = w.Storage.prototype.setItem;
        const patched = function (key, value) {
            if (BLOCKED_STORAGE_KEYS.has(key)) {
                pushLog(`localStorage: ${key}`);
                return;
            }
            origSetItem.call(this, key, value);
        };
        Object.defineProperty(w.Storage.prototype, "setItem", {
            value: patched,
            writable: false,
            configurable: false
        });
    };

    // --- Q&A EXTRACTION ---
    const simpleHash = (str) => {
        let h = 0;
        for (let i = 0, len = str.length; i < len; i++) {
            h = Math.imul(31, h) + str.charCodeAt(i) | 0;
        }
        return h;
    };

    const getCleanText = (node) => {
        if (!node) return "";
        const clone = node.cloneNode(true);
        const text = (str) => document.createTextNode(str);

        for (const el of clone.querySelectorAll(Q_STRIP)) el.remove();

        for (const img of clone.querySelectorAll("img")) {
            if (img.alt) img.replaceWith(text(`[Image: ${img.alt.trim()}] `));
        }

        for (const table of clone.querySelectorAll("table")) {
            const rows = table.querySelectorAll("tr");
            let txt = "\n";
            rows.forEach((row, i) => {
                const cells = [...row.querySelectorAll("td, th")].map(c => c.innerText.trim().replace(/\n/g, " "));
                txt += `| ${cells.join(" | ")} |\n`;
                if (i === 0) txt += `| ${cells.map(() => "---").join(" | ")} |\n`;
            });
            table.replaceWith(Object.assign(document.createElement("div"), { innerText: txt + "\n" }));
        }

        for (const p of clone.querySelectorAll("p")) p.append("\n");
        for (const br of clone.querySelectorAll("br")) br.replaceWith("\n");

        return clone.innerText.trim().replace(/\n\s*\n/g, "\n\n");
    };

    const extractAndCopy = () => {
        const qContainer = document.querySelector(".challenge-v2-question__text")
                        || document.querySelector(".question-body .question")
                        || document.querySelector(".question-body");

        const aList = document.querySelector(A_SELECTOR);
        if (!qContainer || !aList) return;

        const currentRaw = qContainer.innerText + "\0" + aList.innerText;
        if (currentRaw === lastRawText) return;

        const finalQ = qContainer.querySelector("img, table") || qContainer.querySelector(Q_STRIP)
                     ? getCleanText(qContainer)
                     : qContainer.innerText.trim();

        const items = aList.querySelectorAll("li");
        let finalAnswers = "";
        let idx = 0;

        for (let i = 0; i < items.length; i++) {
            const li = items[i];
            if (li.classList.contains("rationale-item")) continue;

            const textEl = li.querySelector(".challenge-v2-answer__text div")
                        || li.querySelector("label div")
                        || li.querySelector(".challenge-v2-answer__text")
                        || li;

            let text = textEl.querySelector("img, table, br")
                     ? getCleanText(textEl)
                     : textEl.innerText.trim();

            if (!text) continue;

            const letter = LETTERS[idx];
            text = text.replace(PREFIX_RE[idx], "");
            if (finalAnswers) finalAnswers += "\n";
            finalAnswers += letter + ".) " + text;
            idx++;
        }

        const fullText = "QUESTION:\n" + finalQ + "\n\nOPTIONS:\n" + finalAnswers;
        const contentHash = simpleHash(fullText);

        if (contentHash !== lastCopiedHash) {
            lastCopiedHash = contentHash;
            lastRawText = currentRaw;
            GM_setClipboard(fullText);
            toast("\u{1F4CB}");
        }
    };

    // --- INIT ---
    const scheduleExtract = () => {
        clearTimeout(extractTimeout);
        extractTimeout = setTimeout(extractAndCopy, 100);
    };

    const observer = new MutationObserver((mutations) => {
        let needsExtract = false;
        for (let i = 0; i < mutations.length; i++) {
            const nodes = mutations[i].addedNodes;
            for (let j = 0; j < nodes.length; j++) {
                const n = nodes[j];
                if (n.nodeType !== 1) continue;
                if (n.tagName === "SCRIPT" && n.src && isBlocked(n.src)) {
                    n.remove();
                    pushLog(n.src);
                }
                if (!needsExtract && (n.tagName === "DIV" || n.tagName === "UL" || n.tagName === "LI")) {
                    needsExtract = true;
                }
            }
        }
        if (needsExtract) scheduleExtract();
    });

    const init = () => {
        if (initialized) return;
        initialized = true;
        injectStyles();
        patchTracking();
        patchNetwork();
        patchLocalStorage();
        activateCookieDefense();
        extractAndCopy();
        setInterval(extractAndCopy, 3000);
        observer.observe(ROOT, { childList: true, subtree: true });
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})();
