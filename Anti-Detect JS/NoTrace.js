// ==UserScript==
// @name         Ultimate Anti-Tab-Detection
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Fully blocks visibility, focus, idle, rAF, timers, and mouse leave detection
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const blockedEvents = [
        'blur',
        'focus',
        'focusin',
        'focusout',
        'visibilitychange',
        'webkitvisibilitychange',
        'mozvisibilitychange',
        'mouseleave',
        'mouseout',
        'pagehide'
    ];

    // ---------- 1. Fake page always visible & focused ----------
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.hasFocus = () => true;
    window.hasFocus = () => true;

    // ---------- 2. Stop all blocked events ----------
    blockedEvents.forEach(event => {
        window.addEventListener(event, e => e.stopImmediatePropagation(), true);
        document.addEventListener(event, e => e.stopImmediatePropagation(), true);
    });

    // ---------- 3. Override addEventListener ----------
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (blockedEvents.includes(type)) return;
        return originalAddEventListener.call(this, type, listener, options);
    };

    // ---------- 4. Neutralize inline handlers ----------
    blockedEvents.forEach(event => {
        const prop = 'on' + event;
        Object.defineProperty(window, prop, { value: null, writable: false });
        Object.defineProperty(document, prop, { value: null, writable: false });
    });

    // ---------- 5. Fake timers & prevent throttling ----------
    // Always return a small delta for setTimeout / setInterval
    const originalSetTimeout = window.setTimeout;
    const originalSetInterval = window.setInterval;
    window.setTimeout = (fn, delay, ...args) => originalSetTimeout(fn, Math.min(delay, 10), ...args);
    window.setInterval = (fn, delay, ...args) => originalSetInterval(fn, Math.min(delay, 10), ...args);

    // ---------- 6. Override requestAnimationFrame ----------
    const originalRAF = window.requestAnimationFrame;
    let lastTime = performance.now();
    window.requestAnimationFrame = (callback) => {
        const now = performance.now();
        const delta = Math.min(16, now - lastTime); // simulate 60fps even if tab backgrounded
        lastTime = now;
        return originalRAF.call(window, (ts) => callback(ts + delta));
    };

    // ---------- 7. Fake performance timings ----------
    const perfProps = ['timing', 'now', 'memory'];
    perfProps.forEach(prop => {
        if (prop in performance) {
            Object.defineProperty(performance, prop, {
                get: () => performance[prop],
                                  configurable: false
            });
        }
    });

    // ---------- 8. Block Idle Detection API ----------
    if ('idle' in navigator) {
        Object.defineProperty(navigator, 'idle', {
            get: () => ({
                query: async () => ({ state: 'active', timeRemaining: Infinity }),
                        addEventListener: () => {},
                        removeEventListener: () => {}
            }),
            configurable: true
        });
    }

    // ---------- 9. Override focus/blur properties on elements ----------
    const originalFocus = HTMLElement.prototype.focus;
    const originalBlur = HTMLElement.prototype.blur;
    HTMLElement.prototype.focus = function() {};
    HTMLElement.prototype.blur = function() {};

    // ---------- 10. Console log blocker (optional) ----------
    // Prevent some analytics scripts from printing focus/blur info
    const originalConsoleLog = console.log;
    console.log = function(...args) {
        if (args.some(a => typeof a === 'string' && /(blur|focus|visibility|idle)/i.test(a))) return;
        return originalConsoleLog.apply(console, args);
    };

    console.info('Ultimate Anti-Tab-Detection Loaded ✅');
})();
