// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://example.com/
// @version      4.8
// @description  Compact panel + auto Q/A copy + tracker block toggle
// @match        *://*.sophia.org/*
// @run-at       document-end
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    "use strict";

    let lastOutput = "";
    let lastPanelUpdate = 0;
    let observer = null;
    let scriptBlockerObserver = null;
    let blockerEnabled = true;

    // -------- Q/A EXTRACTOR --------
    function extractQuestionAndAnswers() {
        const questionEl = document.querySelector(".assessment-question-inner .question p");
        const answerEls = document.querySelectorAll(
            ".assessment-question-inner .multiple-choice-answer-fields .multiple-choice-answer-field p"
        );

        if (!questionEl || answerEls.length === 0) {
            return null;
        }

        const question = questionEl.textContent.trim();
        const answers = Array.from(answerEls).map((el, i) => `${i + 1}. ${el.textContent.trim()}`);

        return `Question:\n${question}\n\nAnswers:\n${answers.join("\n")}`;
    }

    function showToast(message) {
        const toast = document.createElement("div");
        toast.textContent = message;
        toast.style.position = "fixed";
        toast.style.bottom = "20px";
        toast.style.right = "20px";
        toast.style.padding = "8px 12px";
        toast.style.background = "rgba(0,0,0,0.8)";
        toast.style.color = "#fff";
        toast.style.borderRadius = "6px";
        toast.style.fontSize = "12px";
        toast.style.zIndex = "99999";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 1000);
    }

    function copyToClipboard(text) {
        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(text);
            return Promise.resolve(true);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(() => true);
        }
        return Promise.resolve(false);
    }

    function renderIfChanged() {
        const output = extractQuestionAndAnswers();
        if (!output || output === lastOutput) return;

        lastOutput = output;
        copyToClipboard(output)
        .then((ok) => showToast(ok ? "Copied!" : "Clipboard unavailable."))
        .catch(() => showToast("Copy failed."));
    }

    function forceCopyNow() {
        const output = extractQuestionAndAnswers();
        if (!output) {
            showToast("No Q/A found.");
            return;
        }
        lastOutput = output;
        copyToClipboard(output)
        .then((ok) => showToast(ok ? "Copied!" : "Clipboard unavailable."))
        .catch(() => showToast("Copy failed."));
    }

    // -------- DATA --------
    function getDataLayerValue(key) {
        const layer = unsafeWindow?.dataLayer || window.dataLayer;
        if (!layer || !Array.isArray(layer)) return null;
        for (let i = layer.length - 1; i >= 0; i--) {
            const item = layer[i];
            if (item && key in item) return item[key];
        }
        return null;
    }

    function getUserData() {
        const userEl = document.getElementById("current_user_data");
        const name =
        userEl?.getAttribute("data-first-name") && userEl?.getAttribute("data-last-name")
        ? `${userEl.getAttribute("data-first-name")} ${userEl.getAttribute("data-last-name")}`
        : "Unknown";
        return {
            name,
 userId: userEl?.getAttribute("data-id") || "Unknown",
        };
    }

    function getUnitMilestoneTitle() {
        const h1 = document.querySelector(".flexible-assessment-header__title h1");
        return h1 ? h1.textContent.trim() : "Unknown";
    }

    function getQuestionStats() {
        const total = document.querySelectorAll(".flexible-assessment-header__number-milestone").length;
        const currentHeader = document.querySelector(".assessment-question-block h3");
        const currentMatch = currentHeader?.textContent.match(/Question\s+(\d+)/i);
        return { total: total || "Unknown", current: currentMatch ? currentMatch[1] : "Unknown" };
    }

    // -------- SCRIPT BLOCKER --------
    const blockedScriptHosts = [
        "cdn.optimizely.com",
        "static.cloudflareinsights.com",
        "stat.sophia.org",
        "stats.sophia.org",
        "dpm.demdex.net",
        "js.hs-scripts.com",
        "analytics.sophia.org",
        "assets.adobedtm.com",
    ];

    function logBlockedDomain(src) {
        const hit = blockedScriptHosts.find((host) => src.includes(host));
        if (!hit) return;
        console.log(`🛰️ Intercepted tracker: ${hit} — blocked at load time.`);
    }

    function isBlockedSrc(src) {
        try {
            const url = new URL(src, location.href);
            return blockedScriptHosts.some(
                (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
            );
        } catch {
            return false;
        }
    }

    function removeBlockedScripts() {
        const scripts = document.querySelectorAll("script[src]");
        scripts.forEach((script) => {
            if (isBlockedSrc(script.src)) {
                logBlockedDomain(script.src);
                script.remove();
            }
        });
    }

    function startScriptBlocker() {
        removeBlockedScripts();

        if (scriptBlockerObserver) return;
        scriptBlockerObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.tagName === "SCRIPT" && node.src) {
                        if (isBlockedSrc(node.src)) {
                            logBlockedDomain(node.src);
                            node.remove();
                        }
                    }
                }
            }
        });

        scriptBlockerObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    function stopScriptBlocker() {
        if (scriptBlockerObserver) {
            scriptBlockerObserver.disconnect();
            scriptBlockerObserver = null;
        }
    }

    function toggleBlocker(on) {
        blockerEnabled = on;
        const btn = document.getElementById("hp-block-toggle");
        if (btn) btn.classList.toggle("is-on", on);
        if (on) {
            startScriptBlocker();
            showToast("Tracker block: ON");
        } else {
            stopScriptBlocker();
            showToast("Tracker block: OFF");
        }
    }

    // -------- PANEL UI --------
    function createPanel() {
        if (document.getElementById("sophia-overwatch-panel")) return;

        const panel = document.createElement("div");
        panel.id = "sophia-overwatch-panel";
        panel.innerHTML = `
        <div id="sophia-overwatch-panel-content">
        <div class="hp-title">Sophia Overwatch</div>

        <div class="hp-grid">
        <div class="hp-kv"><span>User</span><b id="hp-name"></b></div>
        <div class="hp-kv"><span>User ID</span><b id="hp-userid"></b></div>
        </div>

        <div class="hp-section">Core</div>
        <div class="hp-line">Course: <span id="hp-course"></span></div>
        <div class="hp-line">Unit: <span id="hp-unit"></span></div>
        <div class="hp-line">Question: <span id="hp-qcurrent"></span> / <span id="hp-qtotal"></span></div>

        <div class="hp-actions">
        <button id="hp-copy-btn">📋 Copy Q&A</button>
        <button id="hp-block-toggle" class="is-on" title="Block trackers">⛔ Intercept Traffic</button>
        </div>
        </div>
        `;
        document.body.appendChild(panel);

        const style = document.createElement("style");
        style.textContent = `
        #sophia-overwatch-panel {
        position: fixed;
        top: 70px;
        right: -300px;
        width: 300px;
        background: #0b0f0b;
        color: #31ff5e;
        border: 1px solid #1e5328;
        box-shadow: 0 0 15px rgba(49,255,94,0.4);
        font-family: "Consolas", monospace;
        transition: right 0.25s ease;
        z-index: 999999;
        padding: 10px;
        }
        #sophia-overwatch-panel:hover { right: 0; }
        #sophia-overwatch-panel-content { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
        .hp-title {
            font-size: 12px;
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
            gap: 4px 10px;
            font-size: 11px;
        }
        .hp-kv span { color: #8fffaa; display: block; font-size: 10px; }
        .hp-kv b { color: #b7ffcc; font-weight: 600; }
        .hp-section {
            margin-top: 4px;
            padding-top: 4px;
            border-top: 1px dashed #1e5328;
            color: #9bffb5;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.6px;
        }
        .hp-line span { color: #b7ffcc; }
        .hp-actions {
            display: flex;
            gap: 6px;
            margin-top: 6px;
        }
        #hp-copy-btn,
        #hp-block-toggle {
        flex: 1;
        padding: 5px 6px;
        background: #0f1a0f;
        border: 1px solid #31ff5e;
        color: #31ff5e;
        cursor: pointer;
        font-size: 11px;
        text-transform: uppercase;
        }
        #hp-copy-btn:hover { background: #173117; }
        #hp-block-toggle {
        border-color: #ff2b2b;
        background: #2a0f0f;
        color: #ff9b9b;
        }
        #hp-block-toggle.is-on {
        background: #151515;
        color: #ff2b2b;
        box-shadow: 0 0 8px rgba(255, 43, 43, 0.5);
        }
        `;
        document.head.appendChild(style);

        document.getElementById("hp-copy-btn").onclick = () => forceCopyNow();
        document.getElementById("hp-block-toggle").onclick = () => toggleBlocker(!blockerEnabled);

        // Default ON
        toggleBlocker(true);
    }

    function fillPanel() {
        const user = getUserData();
        const course = getDataLayerValue("course_name") || "Unknown";
        const unit = getUnitMilestoneTitle();
        const qStats = getQuestionStats();

        document.getElementById("hp-name").textContent = user.name;
        document.getElementById("hp-userid").textContent = user.userId;

        document.getElementById("hp-course").textContent = course;
        document.getElementById("hp-unit").textContent = unit;
        document.getElementById("hp-qcurrent").textContent = qStats.current;
        document.getElementById("hp-qtotal").textContent = qStats.total;
    }

    function fillPanelThrottled() {
        const now = Date.now();
        if (now - lastPanelUpdate < 500) return;
        lastPanelUpdate = now;
        fillPanel();
    }

    function attachObserverIfPossible() {
        const questionRoot =
        document.querySelector(".assessment-question-inner") ||
        document.querySelector(".assessment-question-block") ||
        document.querySelector(".assessment-take__question-area");

        if (questionRoot && !observer) {
            observer = new MutationObserver(() => {
                fillPanelThrottled();
                renderIfChanged();
            });
            observer.observe(questionRoot, { childList: true, subtree: true, characterData: true });
        }
    }

    function start() {
        createPanel();
        fillPanel();
        renderIfChanged();

        setInterval(() => {
            attachObserverIfPossible();
            fillPanelThrottled();
            renderIfChanged();
        }, 1200);
    }

    function waitForBodyAndStart() {
        if (document.body) {
            start();
            return;
        }
        setTimeout(waitForBodyAndStart, 200);
    }

    waitForBodyAndStart();
})();
