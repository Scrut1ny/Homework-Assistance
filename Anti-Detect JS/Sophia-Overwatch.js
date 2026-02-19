// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://github.com/Scrut1ny
// @version      7.8
// @description  Copies Q&A and blocks tracking (API-only, optimized + images)
// @match        https://*.sophia.org/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(() => {
    "use strict";

    const blockedHosts = [
        "cdn.optimizely.com",
        "static.cloudflareinsights.com",
        "stat.sophia.org",
        "stats.sophia.org",
        "dpm.demdex.net",
        "js.hs-scripts.com",
        "analytics.sophia.org",
        "assets.adobedtm.com",
    ];

    const blockedEvents = new Set([
        "show_tour",
        "close_tour",
        "click_link",
        "modal_view",
        "alert_view",
        "form_view",
        "form_submit",
        "form_field_change",
        "form_step",
    ]);

    const blockedGa = new Set(["pageview"]);
    const blockedSnowplow = new Set(["trackPageView", "trackStructEvent"]);
    const sophiaMethods = [
        "clickLinkForGA",
        "clickModalCloseForGA",
        "formGA",
        "initPingator",
        "clickToggleForGA",
    ];

    const state = {
        lastOutput: "",
        lastId: null,
        lastPayload: null,
        lastPath: location.pathname,
        lastSearch: location.search,
        log: null,
        logTemplate: null,
        scriptObs: null,
        token: 0,
        debounce: null,
        lastResourceName: null,
        resourcesDirty: true,
    };

    const parser = new DOMParser();

    const RX_BR = /<br\s*\/?>/gi;
    const RX_P = /<\/p>\s*<p>/gi;
    const RX_TAG = /<\/?[^>]+>/g;
    const RX_NL = /\s+\n/g;

    const $all = (s, r = document) => Array.from(r.querySelectorAll(s));

    const injectStyles = () => {
        const style = document.createElement("style");
        style.textContent = `
            #hp-log-container {
                position: fixed;
                right: 16px;
                bottom: 16px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                z-index: 999999;
                pointer-events: none;
                align-items: flex-end;
            }
            .hp-log {
                background: #111;
                color: #ff4d4d;
                border: 1px solid #2a2a2a;
                padding: 6px 10px;
                border-radius: 6px;
                font-size: 12px;
                font-family: Consolas, monospace;
                animation: hp-log-fade 10s ease forwards;
                opacity: 1;
                white-space: nowrap;
            }
            .hp-toast {
                position: fixed;
                bottom: 20px;
                right: 20px;
                padding: 8px 12px;
                background: rgba(0,0,0,.8);
                color: #fff;
                border-radius: 6px;
                font-size: 12px;
                z-index: 99999;
            }
            @keyframes hp-log-fade {
                0% { opacity: 1; transform: translateY(0); }
                75% { opacity: 1; transform: translateY(-4px); }
                100% { opacity: 0; transform: translateY(-10px); }
            }
        `;
        document.head.appendChild(style);
    };

    const ensureLog = () => {
        if (state.log) return state.log;
        const log = document.createElement("div");
        log.id = "hp-log-container";
        document.body.appendChild(log);
        state.log = log;

        const tmpl = document.createElement("div");
        tmpl.className = "hp-log";
        state.logTemplate = tmpl;

        return log;
    };

    const toast = (msg) => {
        const el = document.createElement("div");
        el.className = "hp-toast";
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1000);
    };

    const copy = (t) =>
        typeof GM_setClipboard === "function"
            ? (GM_setClipboard(t), Promise.resolve(true))
            : navigator.clipboard?.writeText
            ? navigator.clipboard.writeText(t).then(() => true)
            : Promise.resolve(false);

    const proxyProp = (obj, prop, onSet) => {
        let v = obj[prop];
        Object.defineProperty(obj, prop, {
            get: () => v,
            set: (nv) => ((v = nv), onSet(nv)),
            configurable: true,
        });
    };

    const proxyFn = (fn, shouldBlock) =>
        new Proxy(fn || function () {}, {
            apply(t, thisArg, args) {
                if (shouldBlock(args)) return;
                return Reflect.apply(t, thisArg, args);
            },
        });

    const pushLog = (msg) => {
        const c = ensureLog();
        const el = state.logTemplate ? state.logTemplate.cloneNode(true) : document.createElement("div");
        if (!el.className) el.className = "hp-log";
        let text = String(msg || "").trim();
        if (/^(https?:)?\/\//i.test(text)) {
            try {
                text = new URL(text, location.href).hostname;
            } catch {}
        }
        el.innerHTML = `🛡️ <span class="hp-log-domain">${text}</span>`;
        c.appendChild(el);
        while (c.children.length > 10) c.removeChild(c.firstChild);
        setTimeout(() => el.remove(), 10200);
    };

    const patchDataLayer = (arr) => {
        if (!Array.isArray(arr)) return;
        const push = Array.prototype.push;
        arr.push = function (...args) {
            const filtered = args.filter(
                (e) => !(e && typeof e === "object" && blockedEvents.has(e.event)) || (pushLog(`dataLayer: ${e.event}`), false)
            );
            return filtered.length ? push.apply(this, filtered) : this.length;
        };
    };

    const installSOPHIABlocks = () => {
        if (typeof SOPHIA === "undefined") return false;
        sophiaMethods.forEach((m) => SOPHIA[m] && (SOPHIA[m] = () => pushLog(`SOPHIA.${m}()`)));
        if (SOPHIA.pingator) SOPHIA.pingator.setTarget = () => pushLog("SOPHIA.pingator.setTarget()");
        return true;
    };

    const initTracking = () => {
        window.dataLayer = window.dataLayer || [];
        patchDataLayer(window.dataLayer);
        proxyProp(window, "dataLayer", patchDataLayer);

        window.ga = proxyFn(window.ga, (a) => a[0] === "send" && blockedGa.has(a[1]) && (pushLog(`ga(): ${a[1]}`), true));
        window.snowplow = proxyFn(window.snowplow, (a) => blockedSnowplow.has(a[0]) && (pushLog(`snowplow(): ${a[0]}`), true));

        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
            if (k === "postponed_form_submit") return pushLog(`localStorage: ${k}`);
            return setItem.call(this, k, v);
        };

        if (!installSOPHIABlocks()) {
            const t = setInterval(() => installSOPHIABlocks() && clearInterval(t), 100);
            setTimeout(() => clearInterval(t), 15000);
        }
        proxyProp(window, "SOPHIA", (v) => v && installSOPHIABlocks());

        const desc =
            Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ||
            Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");
        if (desc?.set) {
            Object.defineProperty(document, "cookie", {
                get() {
                    return desc.get.call(this);
                },
                set(val) {
                    if (typeof val === "string" && val.startsWith("sophia_st=")) return pushLog("sophia_st cookie write");
                    return desc.set.call(this, val);
                },
                configurable: true,
            });
        }
    };

    const extractQuestion = (html) => {
        const doc = parser.parseFromString(html || "", "text/html");
        const body = doc.body;
        const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);

        let text = "";
        let needsBreak = false;

        const pushBreak = () => {
            if (!needsBreak) return;
            text += "\n\n";
            needsBreak = false;
        };

        let n = walker.currentNode;
        while (n) {
            if (n.nodeType === 3) {
                const v = n.nodeValue || "";
                if (v.trim()) {
                    pushBreak();
                    text += v;
                }
            } else if (n.nodeType === 1) {
                const tag = n.tagName;
                if (tag === "BR" || tag === "P") needsBreak = true;
                if (tag === "IMG") {
                    const alt = n.getAttribute("alt")?.trim();
                    if (alt) {
                        pushBreak();
                        text += (text ? "\n\n" : "") + "Image Description:\n" + alt;
                    }
                }
            }
            n = walker.nextNode();
        }

        return text.trim() ? text.split(/\n{3,}/).join("\n\n") : "";
    };

    const stripHtml = (html) =>
        (html || "")
            .replace(RX_BR, "\n")
            .replace(RX_P, "\n\n")
            .replace(RX_TAG, "")
            .replace(RX_NL, "\n")
            .trim();

    const formatAnswer = (text, prefix) => {
        const lines = text.split("\n").filter(Boolean);
        if (!lines.length) return prefix;
        const [first, ...rest] = lines;
        return [prefix + first, ...rest.map((l) => `        ${l}`)].join("\n");
    };

    const findId = () => {
        if (!state.resourcesDirty && state.lastResourceName) {
            const m = state.lastResourceName.match(/milestone_question_takes\/(\d+)/);
            return m ? m[1] : null;
        }
        const entries = performance.getEntriesByType("resource");
        for (let i = entries.length - 1; i >= 0; i--) {
            const name = entries[i]?.name || "";
            if (name.includes("milestone_question_takes/")) {
                state.lastResourceName = name;
                state.resourcesDirty = false;
                const m = name.match(/milestone_question_takes\/(\d+)/);
                return m ? m[1] : null;
            }
        }
        return null;
    };

    const fetchPayload = async () => {
        const id = findId();
        if (!id) return null;
        if (state.lastId === id && state.lastPayload) return state.lastPayload;

        const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
        if (!csrf) return null;

        try {
            const res = await fetch(`/milestone_question_takes/${id}`, {
                credentials: "include",
                headers: {
                    Accept: "application/json, text/javascript, */*; q=0.01",
                    "X-CSRF-Token": csrf,
                    "X-Requested-With": "XMLHttpRequest",
                },
            });
            if (!res.ok) return null;
            const data = await res.json();
            if (!data?.question?.question_body || !data?.question?.answers) return null;
            state.lastId = id;
            state.lastPayload = data;
            return data;
        } catch {
            return null;
        }
    };

    const extractQA = async () => {
        const d = await fetchPayload();
        if (!d) return null;

        const q = extractQuestion(d.question.question_body);
        const a = d.question.answers || [];
        if (!q || !a.length) return null;

        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const answers = a.map((x, i) => {
            const text = stripHtml(x.content);
            return `- ${formatAnswer(text, `${letters[i] || "?"}.) `)}`;
        });

        return `${q}\n\nPossible answers:\n${answers.join("\n")}`;
    };

    const render = async () => {
        const token = ++state.token;
        const out = await extractQA();
        if (token !== state.token || !out || out === state.lastOutput) return;
        state.lastOutput = out;
        copy(out).then((ok) => toast(ok ? "Copied!" : "Clipboard unavailable.")).catch(() => toast("Copy failed."));
    };

    const schedule = () => {
        if (state.debounce) clearTimeout(state.debounce);
        state.debounce = setTimeout(() => {
            state.debounce = null;
            render();
        }, 350);
    };

    const isBlocked = (src) => {
        try {
            const u = new URL(src, location.href);
            return blockedHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
        } catch {
            return false;
        }
    };

    const removeBlockedScripts = (root = document) => {
        $all("script[src]", root).forEach((s) => {
            if (isBlocked(s.src)) {
                pushLog(s.src);
                s.remove();
            }
        });
    };

    const startBlocker = () => {
        removeBlockedScripts();
        if (state.scriptObs) return;
        state.scriptObs = new MutationObserver((muts) =>
            muts.forEach((m) =>
                m.addedNodes.forEach((n) => {
                    if (n.tagName === "SCRIPT" && n.src && isBlocked(n.src)) {
                        pushLog(n.src);
                        n.remove();
                    }
                })
            )
        );
        state.scriptObs.observe(document.documentElement, { childList: true, subtree: true });
    };

    const onRoute = () => {
        if (location.pathname !== state.lastPath || location.search !== state.lastSearch) {
            state.lastPath = location.pathname;
            state.lastSearch = location.search;
            state.resourcesDirty = true;
            schedule();
        }
    };

    const hookHistory = () => {
        const wrap = (fn) =>
            function (...args) {
                const ret = fn.apply(this, args);
                onRoute();
                return ret;
            };
        history.pushState = wrap(history.pushState);
        history.replaceState = wrap(history.replaceState);
        window.addEventListener("popstate", onRoute);
    };

    const start = () => {
        injectStyles();
        hookHistory();
        startBlocker();
        render();
    };

    document.addEventListener("DOMContentLoaded", initTracking);

    (function waitForBody() {
        if (document.body) return start();
        setTimeout(waitForBody, 200);
    })();
})();
