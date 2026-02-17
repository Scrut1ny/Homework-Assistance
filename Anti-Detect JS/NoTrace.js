// ==UserScript==
// @name         StealthMode (Event Blocking)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Block visibility, focus, mouse events, and pagehide detection
// @match        *://*/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const blocked = new Set([
    'visibilitychange',
    'webkitvisibilitychange',
    'mozvisibilitychange',
    'pagehide',
    'mouseenter',
    'mouseleave',
    'focusin',
    'focusout',
    'focus',
    'blur',
  ]);

  // 1) Stop blocked events at capture phase early
  const blocker = e => e.stopImmediatePropagation();
  for (const type of blocked) {
    window.addEventListener(type, blocker, true);
    document.addEventListener(type, blocker, true);
  }

  // 2) Prevent future listeners for blocked events
  const { addEventListener } = EventTarget.prototype;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (blocked.has(type)) return;
    return addEventListener.call(this, type, listener, options);
  };

  // 3) Neutralize inline handlers
  for (const type of blocked) {
    const prop = 'on' + type;
    Object.defineProperty(window, prop, { value: null, writable: false });
    Object.defineProperty(document, prop, { value: null, writable: false });
    if (document.documentElement) {
      Object.defineProperty(document.documentElement, prop, { value: null, writable: false });
    }
  }

  console.info('StealthMode - Event Blocking Active ✅');
})();
