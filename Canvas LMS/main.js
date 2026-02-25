// ==UserScript==
// @name         Canvas Quiz Event Tracker Blocker
// @namespace    https://github.com/instructure/canvas-lms
// @version      2.0
// @description  Blocks all 5 quiz log auditing event trackers in Canvas LMS
// @match        *
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._blocked = method === 'POST' && /quiz_submission_events/.test(url);
    return _open.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._blocked) {
      // Fake a successful response so EventManager flushes its buffer
      // and the error handler doesn't trigger a page reload
      Object.defineProperty(this, 'status', { value: 204 });
      Object.defineProperty(this, 'readyState', { value: 4 });
      this.dispatchEvent(new Event('load'));
      this.onreadystatechange?.();
      return;
    }
    return _send.call(this, body);
  };
})();

