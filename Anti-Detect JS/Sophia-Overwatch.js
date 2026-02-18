// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://github.com/Scrut1ny
// @version      6.5
// @description  Copies Q&A and intercepts trackers
// @match        https://*.sophia.org/*
// @run-at       document-end
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @icon
// ==/UserScript==

(function () {
    "use strict";

    let lastOutput = "";
    let lastRoot = null;
    let rootObserver = null;
    let scriptObs = null;
    let logContainer = null;
    let renderScheduled = false;

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

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

        while (container.children.length > 4) {
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

    function textLinesWithAlts(node) {
        if (!node) return [];
        const clone = node.cloneNode(true);

        clone.querySelectorAll("img").forEach((img) => {
            img.replaceWith(document.createTextNode(img.getAttribute("alt")?.trim() || ""));
        });

        clone.querySelectorAll("br").forEach((br) => {
            br.replaceWith(document.createTextNode("\n"));
        });

        return clone.textContent
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
    }

    function textWithAlts(node) {
        return textLinesWithAlts(node).join("\n");
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

    function imageAlts(node) {
        return $$("img", node)
            .map((img) => img.getAttribute("alt")?.trim())
            .filter(Boolean);
    }

    function formatAnswerText(text, prefix) {
        const lines = text.split("\n").filter(Boolean);
        if (!lines.length) return prefix;
        const [first, ...rest] = lines;
        return [prefix + first, ...rest.map((line) => `        ${line}`)].join("\n");
    }

    function extractQuestionData() {
        const legacyContainer = $(".assessment-question-inner .question");
        if (legacyContainer) {
            const promptParts = [];
            let pendingImages = [];

            const pushImages = () => {
                if (!pendingImages.length) return;
                promptParts.push(`Image Description:\n${pendingImages.join("\n")}`);
                pendingImages = [];
            };

            Array.from(legacyContainer.childNodes).forEach((node) => {
                if (node.nodeType !== Node.ELEMENT_NODE) return;

                if (node.matches("p")) {
                    pushImages();
                    const text = textLinesWithAlts(node).join(" ");
                    if (text) promptParts.push(text);
                    return;
                }

                if (node.matches("img, figure")) {
                    const alts = imageAlts(node);
                    if (alts.length) pendingImages.push(...alts);
                }
            });

            pushImages();

            return {
                statement: null,
                promptLabel: "Question, Instruction, or Fill in the Blank",
                prompt: promptParts.join("\n\n"),
                promptImages: [],
            };
        }

        const block = $(".challenge-v2-question__text");
        if (!block) return null;

        const paragraphs = $$("p", block);
        const statementLines = [];
        const statementImages = [];
        const promptImages = [];
        const promptLines = [];

        const lastPromptIndex = [...paragraphs]
            .map((p, idx) => ({
                idx,
                lines: textLinesWithAlts(p),
                imageOnly: textLinesWithAlts(p).every((line) => imageAlts(p).includes(line)),
            }))
            .filter((p) => p.lines.length && !p.imageOnly)
            .map((p) => p.idx)
            .pop();

        if (paragraphs.length === 1) {
            const lines = textLinesWithAlts(paragraphs[0]);
            if (lines.length > 1) {
                statementLines.push(...lines.slice(0, -1));
                promptLines.push(lines.at(-1));
            } else if (lines.length) {
                promptLines.push(lines[0]);
            }
        } else if (lastPromptIndex !== undefined) {
            paragraphs.forEach((p, idx) => {
                const lines = textLinesWithAlts(p);
                if (!lines.length) return;

                const alts = imageAlts(p);
                const imageOnly = lines.every((line) => alts.includes(line));

                if (imageOnly) {
                    (idx <= lastPromptIndex ? statementImages : promptImages).push(...alts);
                    return;
                }

                if (idx < lastPromptIndex) {
                    statementLines.push(...lines);
                } else if (idx === lastPromptIndex) {
                    promptLines.push(lines.join(" "));
                }
            });
        }

        const tables = $$("table", block);
        if (tables.length) {
            const tableLines = tables.flatMap((table) => renderTableAsText(table));
            if (tableLines.length) {
                if (statementLines.length) statementLines.push("");
                statementLines.push("Data Table:");
                statementLines.push(...tableLines);
            }
        }

        const standaloneImages = $$("img", block).filter((img) => !img.closest("p"));
        if (standaloneImages.length && paragraphs[lastPromptIndex]) {
            const promptNode = paragraphs[lastPromptIndex];
            standaloneImages.forEach((img) => {
                const alt = img.getAttribute("alt")?.trim();
                if (!alt) return;
                const afterPrompt =
                    promptNode.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING;
                (afterPrompt ? promptImages : statementImages).push(alt);
            });
        }

        if (statementImages.length) {
            if (statementLines.length) statementLines.push("");
            statementLines.push("Image Description:");
            statementLines.push(...statementImages);
        }

        const statement = statementLines.length ? statementLines.join("\n") : null;
        const prompt = promptLines.join(" ").trim();

        return {
            statement,
            promptLabel: "Question, Instruction, or Fill in the Blank",
            prompt,
            promptImages,
        };
    }

    function extractAnswerText(el, index) {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const prefix = `${letters[index] || "?"}.) `;
        const valueEl = el.querySelector("div") || el;
        return formatAnswerText(textWithAlts(valueEl), prefix);
    }

    function extractQA() {
        const qData = extractQuestionData();
        if (!qData) return null;

        const answerEls =
            $$(".assessment-question-inner .multiple-choice-answer-fields .multiple-choice-answer-field p") ||
            [];

        const answers =
            answerEls.length > 0
                ? answerEls.map((el, i) => `- ${extractAnswerText(el, i)}`)
                : $$(".challenge-v2-answer__list .challenge-v2-answer__text").map((el, i) =>
                      `- ${extractAnswerText(el, i)}`
                  );

        if (!answers.length) return null;

        const parts = [];
        if (qData.statement) parts.push(`Statement:\n${qData.statement}`);
        parts.push(`${qData.promptLabel}:\n${qData.prompt}`);
        if (qData.promptImages?.length) {
            parts.push(`Image Description:\n${qData.promptImages.join("\n")}`);
        }
        parts.push(`Possible answers:\n${answers.join("\n")}`);

        return parts.join("\n\n");
    }

    function renderIfChanged() {
        const out = extractQA();
        if (!out || out === lastOutput) return;
        lastOutput = out;
        copyText(out)
            .then((ok) => toast(ok ? "Copied!" : "Clipboard unavailable."))
            .catch(() => toast("Copy failed."));
    }

    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderScheduled = false;
            renderIfChanged();
        });
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
                pushLog(s.src);
                s.remove();
            }
        });
    }

    function startBlocker() {
        removeBlockedScripts();
        if (scriptObs) return;
        scriptObs = new MutationObserver((muts) => {
            muts.forEach((m) => {
                m.addedNodes.forEach((n) => {
                    if (n.tagName === "SCRIPT" && n.src && isBlocked(n.src)) {
                        pushLog(n.src);
                        n.remove();
                    }
                });
            });
        });
        scriptObs.observe(document.documentElement, { childList: true, subtree: true });
    }

    function attachRootObserver() {
        const root =
            $(".challenge-v2-question__text") ||
            $(".assessment-question-inner") ||
            $(".assessment-question-block") ||
            $(".assessment-take__question-area");

        if (root === lastRoot) return;

        lastRoot = root;
        rootObserver?.disconnect();
        if (!root) return;

        rootObserver = new MutationObserver(() => scheduleRender());
        rootObserver.observe(root, { childList: true, subtree: true, characterData: true });

        scheduleRender();
    }

    function start() {
        startBlocker();
        scheduleRender();

        const pageObserver = new MutationObserver(() => attachRootObserver());
        pageObserver.observe(document.documentElement, { childList: true, subtree: true });
        attachRootObserver();
    }

    (function waitForBody() {
        if (document.body) return start();
        setTimeout(waitForBody, 200);
    })();
})();
