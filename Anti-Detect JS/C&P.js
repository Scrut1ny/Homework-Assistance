// ==UserScript==
// @name         Extract Question & Answers (Auto Update + Clipboard)
// @namespace    https://app.sophia.org/
// @version      2.2
// @description  Extracts Q/A, waits for dynamic content, auto-updates on question change, copies to clipboard
// @match        *://*/*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  "use strict";

  let lastOutput = "";

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
    toast.style.padding = "10px 14px";
    toast.style.background = "rgba(0,0,0,0.8)";
    toast.style.color = "#fff";
    toast.style.borderRadius = "6px";
    toast.style.fontSize = "14px";
    toast.style.zIndex = "99999";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1500);
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
      .then((ok) => showToast(ok ? "Copied to clipboard!" : "Clipboard unavailable."))
      .catch(() => showToast("Clipboard copy failed."));
  }

  function observeForChanges() {
    const observer = new MutationObserver(() => {
      renderIfChanged();
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderIfChanged(); // initial attempt
  }

  window.addEventListener("load", observeForChanges);
  window.extractQA = renderIfChanged;
})();
})();
