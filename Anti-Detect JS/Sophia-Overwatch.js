// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://github.com/Scrut1ny
// @version      6.8
// @description  Copies Q&A and blocks tracking
// @match        https://*.sophia.org/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @icon
// ==/UserScript==

(function () {
    "use strict";

    /**********************************************************************
     *  CONFIG + STATE
     **********************************************************************/
    const SELECTORS = Object.freeze({
        legacyQuestion: ".assessment-question-inner .question",
        legacyAnswers:
            ".assessment-question-inner .multiple-choice-answer-fields .multiple-choice-answer-field p",
        challengeQuestion: ".challenge-v2-question__text",
        challengeAnswers: ".challenge-v2-answer__list .challenge-v2-answer__text",
        roots: [
            ".challenge-v2-question__text",
            ".assessment-question-inner",
            ".assessment-question-block",
            ".assessment-take__question-area",
        ],
    });

    const blockedHosts = Object.freeze([
        "cdn.optimizely.com",
        "static.cloudflareinsights.com",
        "stat.sophia.org",
        "stats.sophia.org",
        "dpm.demdex.net",
        "js.hs-scripts.com",
        "analytics.sophia.org",
        "assets.adobedtm.com",
    ]);

    const blockedDataLayerEvents = new Set([
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

    const blockedGaCalls = new Set(["pageview"]);
    const blockedSnowplowCalls = new Set(["trackPageView", "trackStructEvent"]);

    const sophiaBlockedMethods = Object.freeze([
        "clickLinkForGA",
        "clickModalCloseForGA",
        "formGA",
        "initPingator",
        "clickToggleForGA",
    ]);

    const state = {
        lastOutput: "",
        lastRoot: null,
        rootObserver: null,
        scriptObserver: null,
        logContainer: null,
        renderScheduled: false,
        lastRenderAt: 0,
        minRenderInterval: 150, // ms
    };

    /**********************************************************************
     *  HELPERS
     **********************************************************************/
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

    function toast(msg) {
        const el = document.createElement("div");
        el.textContent = msg;
        el.style.cssText = [
            "position:fixed",
            "bottom:20px",
            "right:20px",
            "padding:8px 12px",
            "background:rgba(0,0,0,.8)",
            "color:#fff",
            "border-radius:6px",
            "font-size:12px",
            "z-index:99999",
        ].join(";");
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1000);
    }

    function copyText(text) {
        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(text);
            return Promise.resolve(true);
        }
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true);
        }
        return Promise.resolve(false);
    }

    function definePropertyProxy(obj, prop, onSet) {
        let value = obj[prop];
        Object.defineProperty(obj, prop, {
            get() {
                return value;
            },
            set(val) {
                value = val;
                onSet(val);
            },
            configurable: true,
        });
    }

    function createFunctionProxy(target, shouldBlock) {
        return new Proxy(target || function () {}, {
            apply(fn, thisArg, args) {
                if (shouldBlock(args)) return;
                return Reflect.apply(fn, thisArg, args);
            },
        });
    }

    /**********************************************************************
     *  TEXT EXTRACTION (FAST, NO CLONE)
     **********************************************************************/
    function collectTextLines(node) {
        if (!node) return [];
        const lines = [];
        let current = "";

        const flush = () => {
            const trimmed = current.trim();
            if (trimmed) lines.push(trimmed);
            current = "";
        };

        const walker = document.createTreeWalker(
            node,
            NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
            {
                acceptNode(n) {
                    if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
                    if (n.nodeType === Node.ELEMENT_NODE) return NodeFilter.FILTER_ACCEPT;
                    return NodeFilter.FILTER_REJECT;
                },
            }
        );

        let currentNode = walker.currentNode;
        while (currentNode) {
            if (currentNode.nodeType === Node.TEXT_NODE) {
                current += currentNode.nodeValue || "";
            } else if (currentNode.nodeType === Node.ELEMENT_NODE) {
                const el = currentNode;
                if (el.tagName === "BR") {
                    flush();
                } else if (el.tagName === "IMG") {
                    const alt = el.getAttribute("alt")?.trim();
                    if (alt) current += alt;
                }
            }
            currentNode = walker.nextNode();
        }

        flush();
        return lines;
    }

    function textWithAlts(node) {
        return collectTextLines(node).join("\n");
    }

    function imageAlts(node) {
        return $$("img", node)
            .map((img) => img.getAttribute("alt")?.trim())
            .filter(Boolean);
    }

    function renderTableAsText(table) {
        return $$("tr", table)
            .map((row) =>
                $$("th, td", row)
                    .map((cell) => cell.textContent.trim())
                    .filter(Boolean)
                    .join(" | ")
            )
            .filter(Boolean);
    }

    function formatAnswerText(text, prefix) {
        const lines = text.split("\n").filter(Boolean);
        if (!lines.length) return prefix;
        const [first, ...rest] = lines;
        return [prefix + first, ...rest.map((line) => `        ${line}`)].join("\n");
    }

    /**********************************************************************
     *  TRACKER LOG UI
     **********************************************************************/
    function ensureLogContainer() {
        if (state.logContainer) return state.logContainer;
        state.logContainer = document.createElement("div");
        state.logContainer.id = "hp-log-container";
        document.body.appendChild(state.logContainer);

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
            font-family: "Consolas", monospace;
            animation: hp-log-fade 10s ease forwards;
            opacity: 1;
            white-space: nowrap;
        }
        .hp-log-blocked {
            color: #ff4d4d;
        }
        @keyframes hp-log-fade {
            0% { opacity: 1; transform: translateY(0); }
            75% { opacity: 1; transform: translateY(-4px); }
            100% { opacity: 0; transform: translateY(-10px); }
        }
        `;
        document.head.appendChild(style);
        return state.logContainer;
    }

    function pushLog(message) {
        const container = ensureLogContainer();
        const el = document.createElement("div");
        el.className = "hp-log";

        let display = String(message || "").trim();
        if (/^(https?:)?\/\//i.test(display)) {
            try {
                const url = new URL(display, location.href);
                display = url.hostname;
            } catch {}
        }

        el.innerHTML = `🛡️ <span class="hp-log-domain">${display}</span>`;
        container.appendChild(el);

        while (container.children.length > 10) {
            container.removeChild(container.firstChild);
        }

        setTimeout(() => el.remove(), 10200);
    }

    /**********************************************************************
     *  TRACKING BLOCKER (MERGED)
     **********************************************************************/
    function patchDataLayer(arr) {
        if (!Array.isArray(arr)) return;
        const originalPush = Array.prototype.push;

        arr.push = function (...args) {
            const filtered = args.filter((entry) => {
                if (entry && typeof entry === "object" && blockedDataLayerEvents.has(entry.event)) {
                    pushLog(`dataLayer event: ${entry.event}`);
                    return false;
                }
                return true;
            });
            return filtered.length > 0 ? originalPush.apply(this, filtered) : this.length;
        };
    }

    function installSOPHIABlocks() {
        if (typeof SOPHIA === "undefined") return false;

        for (const method of sophiaBlockedMethods) {
            if (SOPHIA[method]) {
                SOPHIA[method] = () => pushLog(`SOPHIA.${method}()`);
            }
        }

        if (SOPHIA.pingator) {
            SOPHIA.pingator.setTarget = () => pushLog("SOPHIA.pingator.setTarget()");
        }

        return true;
    }

    function initTrackingBlocker() {
        window.dataLayer = window.dataLayer || [];
        patchDataLayer(window.dataLayer);
        definePropertyProxy(window, "dataLayer", (val) => patchDataLayer(val));

        window.ga = createFunctionProxy(window.ga, (args) => {
            if (args[0] === "send" && blockedGaCalls.has(args[1])) {
                pushLog(`ga(): ${args[1]}`);
                return true;
            }
            return false;
        });

        window.snowplow = createFunctionProxy(window.snowplow, (args) => {
            if (blockedSnowplowCalls.has(args[0])) {
                const detail = args[0] === "trackStructEvent" ? args[1]?.category || args[1] : "";
                pushLog(`snowplow(): ${args[0]}${detail ? ` ${detail}` : ""}`);
                return true;
            }
            return false;
        });

        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === "postponed_form_submit") {
                pushLog(`localStorage write: ${key}`);
                return;
            }
            return originalSetItem.call(this, key, value);
        };

        if (!installSOPHIABlocks()) {
            const interval = setInterval(() => {
                if (installSOPHIABlocks()) clearInterval(interval);
            }, 100);
            setTimeout(() => clearInterval(interval), 15000);
        }

        definePropertyProxy(window, "SOPHIA", (val) => {
            if (val && typeof val === "object") installSOPHIABlocks();
        });

        const cookieDescriptor =
            Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ||
            Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");

        if (cookieDescriptor?.set) {
            Object.defineProperty(document, "cookie", {
                get() {
                    return cookieDescriptor.get.call(this);
                },
                set(val) {
                    if (typeof val === "string" && val.startsWith("sophia_st=")) {
                        pushLog("sophia_st cookie write");
                        return;
                    }
                    return cookieDescriptor.set.call(this, val);
                },
                configurable: true,
            });
        }
    }

    /**********************************************************************
     *  QUESTION/ANSWER EXTRACTION
     **********************************************************************/
    function resolveQuestionBlock(root) {
        if (root?.matches?.(SELECTORS.challengeQuestion)) return root;
        if (root?.matches?.(SELECTORS.legacyQuestion)) return root;
        return (
            $(SELECTORS.challengeQuestion, root || document) ||
            $(SELECTORS.legacyQuestion, root || document)
        );
    }

    function serializeQuestionBlock(block) {
        const parts = [];
        Array.from(block.childNodes).forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue?.trim();
                if (text) parts.push(text);
                return;
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return;

            if (node.matches("p")) {
                const lines = collectTextLines(node);
                if (lines.length) parts.push(...lines);
                return;
            }

            if (node.matches("table")) {
                const tableLines = renderTableAsText(node);
                if (tableLines.length) {
                    parts.push("Data Table:");
                    parts.push(...tableLines);
                }
                return;
            }

            if (node.matches("img, figure")) {
                const alts = imageAlts(node);
                if (alts.length) {
                    parts.push("Image Description:");
                    parts.push(...alts);
                }
                return;
            }
        });

        return parts.filter(Boolean);
    }

    function extractAnswerText(el, index) {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const prefix = `${letters[index] || "?"}.) `;
        const valueEl = el.querySelector("div") || el;
        return formatAnswerText(textWithAlts(valueEl), prefix);
    }

    function extractQA(root) {
        const block = resolveQuestionBlock(root);
        if (!block) return null;

        const questionLines = serializeQuestionBlock(block);
        if (!questionLines.length) return null;

        const legacyAnswers = $$(SELECTORS.legacyAnswers, document);
        const challengeAnswers = $$(SELECTORS.challengeAnswers, document);
        const answerEls = legacyAnswers.length ? legacyAnswers : challengeAnswers;

        if (!answerEls.length) return null;

        const answers = answerEls.map((el, i) => `- ${extractAnswerText(el, i)}`);

        return `${questionLines.join("\n\n")}\n\nPossible answers:\n${answers.join("\n")}`;
    }

    /**********************************************************************
     *  RENDER + CLIPBOARD
     **********************************************************************/
    function renderIfChanged() {
        const out = extractQA(state.lastRoot);
        if (!out || out === state.lastOutput) return;
        state.lastOutput = out;
        copyText(out)
            .then((ok) => toast(ok ? "Copied!" : "Clipboard unavailable."))
            .catch(() => toast("Copy failed."));
    }

    function scheduleRender() {
        if (state.renderScheduled) return;
        state.renderScheduled = true;
        requestAnimationFrame(() => {
            state.renderScheduled = false;
            const now = Date.now();
            if (now - state.lastRenderAt < state.minRenderInterval) return;
            state.lastRenderAt = now;
            renderIfChanged();
        });
    }

    /**********************************************************************
     *  TRACKER BLOCKER (SCRIPT INTERCEPT)
     **********************************************************************/
    function isBlocked(src) {
        try {
            const url = new URL(src, location.href);
            return blockedHosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
        } catch {
            return false;
        }
    }

    function removeBlockedScripts(root = document) {
        $$("script[src]", root).forEach((s) => {
            if (isBlocked(s.src)) {
                pushLog(s.src);
                s.remove();
            }
        });
    }

    function startBlocker() {
        removeBlockedScripts();
        if (state.scriptObserver) return;
        state.scriptObserver = new MutationObserver((muts) => {
            muts.forEach((m) => {
                m.addedNodes.forEach((n) => {
                    if (n.tagName === "SCRIPT" && n.src && isBlocked(n.src)) {
                        pushLog(n.src);
                        n.remove();
                    }
                });
            });
        });
        state.scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    /**********************************************************************
     *  OBSERVERS
     **********************************************************************/
    function findRoot() {
        for (const sel of SELECTORS.roots) {
            const root = $(sel);
            if (root) return root;
        }
        return null;
    }

    function attachRootObserver() {
        const root = findRoot();
        if (root === state.lastRoot) return;

        state.lastRoot = root;
        state.rootObserver?.disconnect();
        if (!root) return;

        state.rootObserver = new MutationObserver(() => scheduleRender());
        state.rootObserver.observe(root, { childList: true, subtree: true, characterData: true });

        renderIfChanged();
    }

    /**********************************************************************
     *  INIT
     **********************************************************************/
    function start() {
        initTrackingBlocker();
        startBlocker();
        renderIfChanged();

        const pageObserver = new MutationObserver(() => attachRootObserver());
        pageObserver.observe(document.documentElement, { childList: true, subtree: true });
        attachRootObserver();
    }

    (function waitForBody() {
        if (document.body) return start();
        setTimeout(waitForBody, 200);
    })();
})();
