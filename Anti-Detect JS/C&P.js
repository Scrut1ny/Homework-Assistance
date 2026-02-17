// ==UserScript==
// @name         Extract Question & Answers to Clipboard (Q/A List)
// @namespace    https://example.com/
// @version      1.1
// @description  Extracts question + answers and copies formatted Q/A list to clipboard
// @match        *://*/*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    "use strict";

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

        const formatted = `Question:\n${question}\n\nAnswers:\n${answers.join("\n")}`;
        return formatted;
    }

    function showToast(message) {
        const toast = document.createElement("div");
        toast.textContent = message;
        toast.style.position = "fixed";
        toast.style.bottom = "20px";
        toast.style.right = "20px";
        toast.style.padding = "10px 14px";
        toast.style.background = "rgba(0,0,0,0.8)";
        toast.style.color = "#fff";
        toast.style.borderRadius = "6px";
        toast.style.fontSize = "14px";
        toast.style.zIndex = "99999";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    function copyToClipboard(text) {
        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(text);
            return Promise.resolve();
        }
        return navigator.clipboard.writeText(text);
    }

    function run() {
        const result = extractQuestionAndAnswers();
        if (!result) {
            showToast("No question/answers found.");
            return;
        }

        copyToClipboard(result)
        .then(() => {
            console.log("Copied:\n" + result);
            showToast("Question & answers copied!");
        })
        .catch((err) => {
            console.error("Clipboard copy failed", err);
            showToast("Copy failed. See console.");
        });
    }

    // Run once on load
    window.addEventListener("load", run);

    // Optional: expose a manual trigger in console
    window.extractQA = run;
})();
