// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://github.com/Scrut1ny
// @version      5.0
// @description  Copies Q&A, shows a live status panel, and intercepts trackers
// @match        https://*.sophia.org/*
// @run-at       document-end
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @icon
// ==/UserScript==

(function () {
    "use strict";

    let lastOutput = "";
    let lastPanelUpdate = 0;
    let observer = null;
    let scriptObs = null;
    let blockerOn = true;
    let privacyOn = true;
    let logContainer = null;

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => r.querySelectorAll(s);

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

    function ensureLogContainer() {
        if (logContainer) return logContainer;

        logContainer = document.createElement("div");
        logContainer.id = "hp-log-container";
        document.body.appendChild(logContainer);

        const style = document.createElement("style");
        style.textContent = `
        #hp-log-container {
            position: fixed;
            right: 20px;
            bottom: 20px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            z-index: 999999;
            pointer-events: none;
            align-items: flex-end;
        }
        .hp-log {
            background: rgba(0, 0, 0, 0.8);
            color: #fff;
            border: 1px solid #31ff5e;
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 12px;
            font-family: "Consolas", monospace;
            box-shadow: 0 0 8px rgba(49, 255, 94, 0.3);
            animation: hp-log-fade 10s ease forwards;
            transform: translateY(0);
            opacity: 1;
            white-space: nowrap;
            width: fit-content;
            max-width: none;
        }
        .hp-log-domain {
            color: #ff4d4d;
        }
        @keyframes hp-log-fade {
            0% { opacity: 1; transform: translateY(0); }
            75% { opacity: 1; transform: translateY(-6px); }
            100% { opacity: 0; transform: translateY(-16px); }
        }
        `;
        document.head.appendChild(style);

        return logContainer;
    }

    function pushLog(domain) {
        const container = ensureLogContainer();
        const el = document.createElement("div");
        el.className = "hp-log";
        el.innerHTML = `🛡️ Intercepted: <span class="hp-log-domain">${domain}</span>`;

        container.appendChild(el);

        const maxLogs = 4;
        while (container.children.length > maxLogs) {
            container.removeChild(container.firstChild);
        }

        setTimeout(() => el.remove(), 10200);
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

    function extractQA() {
        let questionEl = $(".assessment-question-inner .question p");
        let answerEls = $$(".assessment-question-inner .multiple-choice-answer-fields .multiple-choice-answer-field p");

        if (!questionEl) {
            questionEl = $(".challenge-v2-question__text p");
        }
        if (!answerEls.length) {
            answerEls = $$(".challenge-v2-answer__list .challenge-v2-answer__text p");
        }

        if (!questionEl || !answerEls.length) return null;

        const question = questionEl.textContent.trim();
        const letters = "abcdefghijklmnopqrstuvwxyz";
        const answers = Array.from(answerEls).map(
            (el, i) => `${letters[i] || "?"}.) ${el.textContent.trim()}`
        );

        return `Question:\n${question}\n\nAnswers:\n${answers.join("\n")}`;
    }

    function copyOutput(output) {
        lastOutput = output;
        copyText(output)
            .then((ok) => toast(ok ? "Copied!" : "Clipboard unavailable."))
            .catch(() => toast("Copy failed."));
    }

    function renderIfChanged() {
        const out = extractQA();
        if (!out || out === lastOutput) return;
        copyOutput(out);
    }

    function forceCopyNow() {
        const out = extractQA();
        if (!out) return toast("No Q/A found.");
        copyOutput(out);
    }

    function getUserData() {
        const el = $("#current_user_data");
        const first = el?.getAttribute("data-first-name");
        const last = el?.getAttribute("data-last-name");
        return {
            name: first && last ? `${first} ${last}` : "Unknown",
            userId: el?.getAttribute("data-id") || "Unknown",
        };
    }

    function logBlocked(src) {
        const hit = blockedHosts.find((h) => src.includes(h));
        if (hit) pushLog(hit);
    }

    function isBlocked(src) {
        try {
            const url = new URL(src, location.href);
            return blockedHosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
        } catch {
            return false;
        }
    }

    function removeBlockedScripts() {
        $$("script[src]").forEach((s) => {
            if (isBlocked(s.src)) {
                logBlocked(s.src);
                s.remove();
            }
        });
    }

    function startBlocker() {
        removeBlockedScripts();
        if (scriptObs) return;
        scriptObs = new MutationObserver((muts) => {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    if (n.tagName === "SCRIPT" && n.src && isBlocked(n.src)) {
                        logBlocked(n.src);
                        n.remove();
                    }
                }
            }
        });
        scriptObs.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopBlocker() {
        scriptObs?.disconnect();
        scriptObs = null;
    }

    function updateBlockerButton() {
        const btn = $("#hp-block-toggle");
        if (!btn) return;
        btn.textContent = `${blockerOn ? "🛡️" : "⚠️"} Intercept Traffic`;
    }

    function toggleBlocker(on) {
        blockerOn = on;
        $("#hp-block-toggle")?.classList.toggle("is-on", on);
        updateBlockerButton();
        on ? startBlocker() : stopBlocker();
        toast(`Tracker block: ${on ? "ON" : "OFF"}`);
    }

    function togglePrivacy(on) {
        privacyOn = on;
        const btn = $("#hp-privacy-toggle");
        if (btn) {
            btn.classList.toggle("is-on", on);
            btn.textContent = on ? "🔒" : "🔓";
        }
        fillPanel();
        toast(`Privacy: ${on ? "ON" : "OFF"}`);
    }

    function createPanel() {
        if ($("#sophia-overwatch-panel")) return;

        const panel = document.createElement("div");
        panel.id = "sophia-overwatch-panel";
        panel.innerHTML = `
        <div id="sophia-overwatch-panel-content">
            <div class="hp-title">Sophia Overwatch</div>

            <div class="hp-grid">
                <div class="hp-kv">
                    <span>User</span>
                    <b id="hp-name"></b>
                </div>
                <div class="hp-kv hp-kv-with-toggle">
                    <span>User ID</span>
                    <b id="hp-userid"></b>
                    <button id="hp-privacy-toggle" class="is-on" title="Privacy toggle">🔒</button>
                </div>
            </div>

            <div class="hp-sep"></div>

            <div class="hp-actions">
                <button id="hp-copy-btn">📋 Copy Q&A</button>
                <button id="hp-block-toggle" class="is-on" title="Block trackers">🛡️ Intercept Traffic</button>
            </div>
        </div>
        `;
        document.body.appendChild(panel);

        const style = document.createElement("style");
        style.textContent = `
        #sophia-overwatch-panel {
            position: fixed;
            top: 110px;
            right: -300px;
            width: 300px;
            background: #0b0f0b;
            color: #31ff5e;
            border: 1px solid #1e5328;
            box-shadow: 0 0 15px rgba(49, 255, 94, 0.4);
            font-family: "Consolas", monospace;
            transition: right 0.25s ease;
            z-index: 999999;
            padding: 10px;
        }
        #sophia-overwatch-panel:hover {
            right: 0;
        }
        #sophia-overwatch-panel-content {
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 14px;
        }
        .hp-title {
            font-size: 14px;
            font-weight: bold;
            text-transform: uppercase;
            border-bottom: 1px solid #1e5328;
            padding-bottom: 6px;
            margin-bottom: 2px;
            color: #ff2b2b;
            text-shadow: 0 0 6px rgba(255, 43, 43, 0.8), 0 0 12px rgba(255, 43, 43, 0.5);
            text-align: center;
        }
        .hp-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 10px;
            font-size: 13px;
            align-items: start;
        }
        .hp-kv {
            display: grid;
            grid-template-rows: auto auto;
            row-gap: 4px;
        }
        .hp-kv-with-toggle {
            grid-template-columns: 1fr auto;
            grid-template-rows: auto auto;
            column-gap: 8px;
            align-items: center;
        }
        .hp-kv span {
            color: #8fffaa;
            display: block;
            font-size: 12px;
        }
        .hp-kv b {
            color: #b7ffcc;
            font-weight: 600;
            font-size: 13px;
        }
        .hp-kv-with-toggle span {
            grid-column: 1;
            grid-row: 1;
        }
        .hp-kv-with-toggle b {
            grid-column: 1;
            grid-row: 2;
        }
        #hp-privacy-toggle {
            grid-column: 2;
            grid-row: 1 / span 2;
            align-self: center;
            justify-self: end;
            padding: 5px 10px;
            background: #2a0f0f;
            border: 1px solid #ff2b2b;
            color: #ff9b9b;
            cursor: pointer;
            font-size: 16px;
            border-radius: 6px;
            line-height: 1;
            height: 28px;
            width: 40px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        #hp-privacy-toggle.is-on {
            background: #0f1a0f;
            color: #31ff5e;
            border-color: #31ff5e;
            box-shadow: 0 0 6px rgba(49, 255, 94, 0.5);
        }
        .hp-sep {
            margin-top: 6px;
            border-top: 1px dashed #1e5328;
        }
        .hp-actions {
            display: flex;
            gap: 6px;
            margin-top: 6px;
        }
        #hp-copy-btn {
            flex: 1;
            padding: 7px 8px;
            background: #0f1a0f;
            border: 1px solid #31ff5e;
            color: #31ff5e;
            cursor: pointer;
            font-size: 12px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        #hp-copy-btn:hover {
            background: #173117;
        }
        #hp-block-toggle {
            flex: 1;
            padding: 7px 8px;
            background: #2a0f0f;
            border: 1px solid #ff2b2b;
            color: #ff9b9b;
            cursor: pointer;
            font-size: 12px;
            text-transform: uppercase;
            white-space: nowrap;
        }
        #hp-block-toggle.is-on {
            background: #0f1a0f;
            color: #31ff5e;
            border-color: #31ff5e;
            box-shadow: 0 0 8px rgba(49, 255, 94, 0.5);
        }
        `;
        document.head.appendChild(style);

        $("#hp-copy-btn").onclick = forceCopyNow;
        $("#hp-block-toggle").onclick = () => toggleBlocker(!blockerOn);
        $("#hp-privacy-toggle").onclick = () => togglePrivacy(!privacyOn);

        toggleBlocker(true);
        togglePrivacy(true);
    }

    function fillPanel() {
        const user = getUserData();
        $("#hp-name").textContent = privacyOn ? "Hidden" : user.name;
        $("#hp-userid").textContent = privacyOn ? "Hidden" : user.userId;
    }

    function fillPanelThrottled() {
        const now = Date.now();
        if (now - lastPanelUpdate < 500) return;
        lastPanelUpdate = now;
        fillPanel();
    }

    function attachObserver() {
        const root =
            $(".assessment-question-inner") ||
            $(".assessment-question-block") ||
            $(".assessment-take__question-area");

        if (root && !observer) {
            observer = new MutationObserver(() => {
                fillPanelThrottled();
                renderIfChanged();
            });
            observer.observe(root, { childList: true, subtree: true, characterData: true });
        }
    }

    function start() {
        createPanel();
        fillPanel();
        renderIfChanged();
        setInterval(() => {
            attachObserver();
            fillPanelThrottled();
            renderIfChanged();
        }, 1200);
    }

    (function waitForBody() {
        if (document.body) return start();
        setTimeout(waitForBody, 200);
    })();
})();
