// ==UserScript==
// @name         Sophia Overwatch (minimal)
// @namespace    https://github.com/Scrut1ny
// @version      1.0
// @description  Auto-copies Q&A from milestone and challenge sections
// @match        https://*.sophia.org/*
// @run-at       document-end
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    "use strict";

    let lastOutput = "";

    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => r.querySelectorAll(s);

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

    function copyIfChanged() {
        const out = extractQA();
        if (!out || out === lastOutput) return;
        lastOutput = out;
        copyText(out).catch(() => {});
    }

    function attachObserver() {
        const root =
            $(".assessment-question-inner") ||
            $(".assessment-question-block") ||
            $(".assessment-take__question-area") ||
            $(".challenge-v2-question__text");

        if (!root) return;

        const observer = new MutationObserver(copyIfChanged);
        observer.observe(root, { childList: true, subtree: true, characterData: true });
    }

    function start() {
        copyIfChanged();
        attachObserver();
        setInterval(copyIfChanged, 1200);
    }

    (function waitForBody() {
        if (document.body) return start();
        setTimeout(waitForBody, 200);
    })();
})();
