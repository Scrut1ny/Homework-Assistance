// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://github.com/Scrut1ny
// @version      24.0
// @description  Copies Q&A, blocks tracking, event-driven cookie destruction
// @match        https://*.sophia.org/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        unsafeWindow
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

    const Q_SELECTOR = ".challenge-v2-question__text, .question-body .question, .question-body";
    const A_SELECTOR = ".challenge-v2-answer__list, .multiple-choice-answer-fields";

    const Q_STRIP = "ul.multiple-choice-answer-fields, ul.answer-fields, .challenge-v2-answer__list, #resubmit-message-place, #helpful-tutorials-message-place, .button-block, .control-section, .assessment-report-wrapper, .letter";

    const EXTRACT_TAGS = new Set(["DIV", "UL", "LI"]);

    let logContainer = null;
    let lastCopiedHash = 0;
    let lastRawText = "";
    let extractTimeout = null;
    let toastTimer = null;

    // --- UI ---
    const ROOT = document.documentElement;

    const injectStyles = () => {
        if (document.getElementById("hp-styles")) return;
        const style = document.createElement("style");
        style.id = "hp-styles";
        style.textContent = `
        #hp-log-container {
        position: fixed; right: 16px; bottom: 16px;
        display: flex; flex-direction: column; gap: 6px;
        z-index: 2147483647; pointer-events: none; align-items: flex-end;
        }
        .hp-log {
            background: #1a1a1a; color: #ff5555; border: 1px solid #333;
            padding: 6px 10px; border-radius: 4px; font-size: 13px;
            font-family: Consolas, monospace; font-weight: bold;
            animation: hp-fade 6s ease forwards; opacity: 1;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); pointer-events: auto;
            min-width: 150px; display: flex; align-items: center; gap: 8px;
        }
        .hp-toast {
            position: fixed; bottom: 16px; left: 16px;
            padding: 8px 12px; background: #1a1a1a; color: #4dff88;
            border: 1px solid #333; border-left: 3px solid #4dff88;
            border-radius: 4px; font-size: 20px; font-family: Consolas, monospace;
            z-index: 2147483647; font-weight: bold; text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            animation: hp-slide-in-left 0.3s ease forwards;
        }
        @keyframes hp-fade {
            0% { opacity: 0; transform: translateY(10px); }
            5% { opacity: 1; transform: translateY(0); }
            85% { opacity: 1; transform: translateY(-5px); }
            100% { opacity: 0; transform: translateY(-20px); }
        }
        @keyframes hp-slide-in-left {
            0% { opacity: 0; transform: translateX(-20px); }
            100% { opacity: 1; transform: translateX(0); }
        }
        `;
        (document.head || ROOT).appendChild(style);
    };

    const pushLog = (rawMsg) => {
        if (!logContainer) {
            logContainer = document.createElement("div");
            logContainer.id = "hp-log-container";
            (document.body || ROOT).appendChild(logContainer);
        }
        const el = document.createElement("div");
        el.className = "hp-log";
        const text = String(rawMsg);
        el.textContent = `🛡️ ${text.includes("://") ? text.split("/")[2] : text}`;
        logContainer.appendChild(el);
        if (logContainer.childNodes.length > 8) logContainer.firstChild.remove();
        el.addEventListener("animationend", () => el.remove(), { once: true });
    };

    const toast = (msg) => {
        const existing = document.querySelector(".hp-toast");
        if (existing) existing.remove();
        clearTimeout(toastTimer);
        const el = document.createElement("div");
        el.className = "hp-toast";
        el.textContent = msg;
        (document.body || ROOT).appendChild(el);
        toastTimer = setTimeout(() => el.remove(), 2500);
    };

    // --- BLOCKING HELPERS ---
    const isBlocked = (urlStr) => {
        if (!urlStr) return false;
        try {
            return BLOCKED_HOSTS.has(new URL(urlStr, location.origin).hostname);
        } catch {
            return false;
        }
    };

    // --- COOKIE DEFENSE ---
    const activateCookieDefense = async () => {
        const store = w.cookieStore;
        if (!store) return;
        const kill = ({ name }) => { store.delete(name); pushLog(`Cookie: ${name}`); };
        (await store.getAll()).forEach(c => BLOCKED_COOKIE_RE.test(c.name) && kill(c));
        store.addEventListener("change", ({ changed }) =>
        changed.forEach(c => BLOCKED_COOKIE_RE.test(c.name) && kill(c))
        );
    };

    // --- LOCALSTORAGE DEFENSE ---
    const patchLocalStorage = () => {
        const origSetItem = w.Storage.prototype.setItem;
        w.Storage.prototype.setItem = function(key, value) {
            if (BLOCKED_STORAGE_KEYS.has(key)) {
                pushLog(`localStorage: ${key}`);
                return;
            }
            return origSetItem.apply(this, arguments);
        };
    };

    // --- DATALAYER SANITIZATION ---
    const patchDataLayerPush = () => {
        const origPush = Array.prototype.push;
        const handler = {
            apply(target, thisArg, args) {
                if (thisArg === w.dataLayer) {
                    const filtered = args.filter(arg => {
                        if (arg && typeof arg === "object") {
                            if ("session_duration" in arg) {
                                delete arg.session_duration;
                            }
                            if ("userId" in arg) {
                                pushLog(`dataLayer: userId leak (${arg.event || "unknown"})`);
                                return false;
                            }
                        }
                        return true;
                    });
                    return origPush.apply(thisArg, filtered);
                }
                return origPush.apply(thisArg, args);
            }
        };
        Array.prototype.push = new Proxy(origPush, handler);
    };

    // --- NETWORK INTERCEPTION ---
    const patchNetwork = () => {
        const origFetch = w.fetch;
        w.fetch = function (input) {
            const url = (input instanceof Request) ? input.url : String(input);
            if (isBlocked(url)) {
                pushLog(url);
                return Promise.resolve(new Response("", { status: 200 }));
            }
            return origFetch.apply(this, arguments);
        };

        const XHR = w.XMLHttpRequest.prototype;
        const origOpen = XHR.open;
        const origSend = XHR.send;
        XHR.open = function (method, url) {
            this._blocked = isBlocked(url);
            if (this._blocked) pushLog(url);
            return origOpen.apply(this, arguments);
        };
        XHR.send = function () {
            if (this._blocked) return;
            return origSend.apply(this, arguments);
        };

        const origBeacon = w.navigator.sendBeacon;
        if (origBeacon) {
            w.navigator.sendBeacon = function (url) {
                if (isBlocked(url)) {
                    pushLog(url);
                    return true;
                }
                return origBeacon.apply(this, arguments);
            };
        }
    };

    // --- UNIVERSAL PROXY INTERCEPTION ---
    const SHIMMED = Symbol("shimmed");

    const createShim = (target, name, type, rules) => {
        if (target?.[SHIMMED]) return target;

        const isPush = type === "push";

        const pushTrap = isPush && {
            apply(pushFn, thisArg, args) {
                const allowed = args.filter(arg => {
                    if (arg && typeof arg === "object") {
                        const val = arg[rules.trigger];
                        if (val && rules.block.has(val)) {
                            pushLog(`${name}: ${val}`);
                            return false;
                        }
                    }
                    return true;
                });
                return Reflect.apply(pushFn, thisArg, allowed);
            }
        };

        return new Proxy(target, {
            get(target, prop, receiver) {
                if (prop === SHIMMED) return true;
                if (isPush && prop === "push") return new Proxy(target.push, pushTrap);
                return Reflect.get(target, prop, receiver);
            },
            apply(target, thisArg, args) {
                if (!isPush && rules.has(args[0])) {
                    pushLog(`${name}: ${args[0]}`);
                    return;
                }
                return Reflect.apply(target, thisArg, args);
            }
        });
    };

    const installTrap = (key, type, rules) => {
        const fallback = type === "push" ? [] : function () {
            (w[key].q = w[key].q || []).push(arguments);
        };
        let shim = createShim(w[key] || fallback, key, type, rules);

        try {
            Object.defineProperty(w, key, {
                configurable: true,
                get: () => shim,
                                  set: (val) => { shim = createShim(val, key, type, rules); }
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

    // --- EXTRACTION ---
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
        const qContainer = document.querySelector(Q_SELECTOR);
        const aList = document.querySelector(A_SELECTOR);
        if (!qContainer || !aList) return;

        const currentRaw = qContainer.innerText;
        if (currentRaw === lastRawText) return;

        const finalQ = getCleanText(qContainer);
        const finalAnswers = [...aList.querySelectorAll("li")]
        .filter(li => !li.classList.contains("rationale-item"))
        .map((li, idx) => {
            const textEl = li.querySelector(".challenge-v2-answer__text div, .challenge-v2-answer__text, label div") || li;
            let text = getCleanText(textEl);
            if (!text) return null;
            const expectedChar = String.fromCharCode(65 + idx);
            const prefixRegex = new RegExp(`^(${expectedChar}[\\.\\)]+\\s*)+`, "i");
        text = text.replace(prefixRegex, "");

        return `${expectedChar}.) ${text}`;
        })
        .filter(Boolean)
        .join("\n");

        const fullText = `QUESTION:\n${finalQ}\n\nOPTIONS:\n${finalAnswers}`;
        const contentHash = simpleHash(fullText);

        if (contentHash !== lastCopiedHash) {
            lastCopiedHash = contentHash;
            lastRawText = currentRaw;
            GM_setClipboard(fullText);
            toast("📋");
        }
    };

    // --- INIT ---
    const scheduleExtract = () => {
        clearTimeout(extractTimeout);
        extractTimeout = setTimeout(extractAndCopy, 100);
    };

    const observer = new MutationObserver((mutations) => {
        let needsExtract = false;
        for (const { addedNodes } of mutations) {
            for (const n of addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.tagName === "SCRIPT" && n.src && isBlocked(n.src)) {
                    n.remove();
                    pushLog(n.src);
                }
                if (!needsExtract && EXTRACT_TAGS.has(n.tagName)) {
                    needsExtract = true;
                }
            }
        }
        if (needsExtract) scheduleExtract();
    });

        const init = () => {
            injectStyles();
            patchTracking();
            patchNetwork();
            patchLocalStorage();
            patchDataLayerPush();
            activateCookieDefense();
            setInterval(extractAndCopy, 1000);
            observer.observe(ROOT, { childList: true, subtree: true });
        };

        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
        else init();

})();
