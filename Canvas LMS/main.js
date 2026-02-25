// ==UserScript==
// @name         Canvas Quiz Event Tracker Blocker
// @namespace    https://github.com/instructure/canvas-lms
// @version      4.1
// @description  Blocks all 5 quiz log auditing event trackers in Canvas LMS
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let targetUrl = null;
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (m, u, ...a) {
    if (!targetUrl && window.ENV?.QUIZ_SUBMISSION_EVENTS_URL) {
      targetUrl = window.ENV.QUIZ_SUBMISSION_EVENTS_URL;
    }
    this._b = targetUrl && m === 'POST' && u === targetUrl;
    return _open.call(this, m, u, ...a);
  };

  XMLHttpRequest.prototype.send = function (b) {
    if (this._b) {
      Object.defineProperty(this, 'status', { value: 204 });
      Object.defineProperty(this, 'readyState', { value: 4 });
      this.dispatchEvent(new Event('load'));
      this.onreadystatechange?.();
      return;
    }
    return _send.call(this, b);
  };
})();
