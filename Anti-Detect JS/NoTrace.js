// ==UserScript==
// @name         NoTrace
// @namespace    https://github.com/Scrut1ny
// @version      1.1
// @description  Block visibility, focus, mouse events, and pagehide detection
// @match        *://*/*
// @grant        none
// ==/UserScript==

// https://webbrowsertools.com/test-always-active/

(function() {
    'use strict';

    // List of events to block
    const blockedEvents = [
        'visibilitychange',
        'webkitvisibilitychange',
        'mozvisibilitychange',
        'pagehide',
        'mouseenter',
        'mouseleave',
        'focusin',
        'focusout',
        'focus',
        'blur'
    ];

    // ---------- 1. Stop all blocked events ----------
    blockedEvents.forEach(event => {
        window.addEventListener(event, e => e.stopImmediatePropagation(), true);
        document.addEventListener(event, e => e.stopImmediatePropagation(), true);
    });

    // ---------- 2. Override addEventListener to prevent future event listeners ----------
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (blockedEvents.includes(type)) return; // Block event listeners for specific events
        return originalAddEventListener.call(this, type, listener, options);
    };

    // ---------- 3. Neutralize inline handlers (like onfocus) ----------
    blockedEvents.forEach(event => {
        const prop = 'on' + event;
        Object.defineProperty(window, prop, { value: null, writable: false });
        Object.defineProperty(document, prop, { value: null, writable: false });
    });

    // ---------- 4. Override visibility / focus state APIs ----------
    try {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible'
        });
    } catch {}

    try {
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            get: () => false
        });
    } catch {}

    // Override hasFocus()
    document.hasFocus = () => true;

    // Override activeElement
    try {
        Object.defineProperty(document, 'activeElement', {
            configurable: true,
            get: () => document.body || null
        });
    } catch {}

    console.info('StealthMode - Event Blocking Active ✅');
})();
