// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://github.com/Scrut1ny
// @version      22.0
// @description  Copies Q&A, blocks tracking, event-driven cookie destruction
// @match        https://*.sophia.org/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(() => {
    "use strict";

    // --- CONFIGURATION ---
    const blockedHosts = [
        "cdn.optimizely.com", "static.cloudflareinsights.com", "stat.sophia.org",
        "stats.sophia.org", "dpm.demdex.net", "js.hs-scripts.com",
        "analytics.sophia.org", "assets.adobedtm.com"
    ];

    const blockedEvents = new Set([
        "show_tour", "close_tour", "click_link", "modal_view", "alert_view",
        "form_view", "form_submit", "form_field_change", "form_step"
    ]);

    const blockedGa = new Set(["pageview"]);
    const sophiaMethods = ["clickLinkForGA", "clickModalCloseForGA", "formGA", "initPingator", "clickToggleForGA"];

    const blockedCookies = [
        /^sophia_st$/, // Sophia Session Timer
        /^AMCV/,       // Adobe Marketing Cloud
        /^AMCVS/,      // Adobe Analytics
        /^_sp_/        // Snowplow Analytics
    ];

    let logContainer = null;
    let lastCopiedHash = "";

    // --- UI ---
    const injectStyles = () => {
        if (document.getElementById('hp-styles')) return;
        const style = document.createElement("style");
        style.id = 'hp-styles';
        style.textContent = `
            #hp-log-container {
                position: fixed; right: 16px; bottom: 16px;
                display: flex; flex-direction: column; gap: 6px;
                z-index: 2147483647; pointer-events: none; align-items: flex-end;
            }
            .hp-log {
                background: #1a1a1a; color: #ff5555; border: 1px solid #333;
                padding: 6px 10px; border-radius: 4px; font-size: 13px;
                font-family: Consolas, monospace; font-weight: bold;
                animation: hp-fade 6s ease forwards; opacity: 1;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5); pointer-events: auto;
                min-width: 150px; display: flex; align-items: center; gap: 8px;
            }
            .hp-toast {
                position: fixed; bottom: 16px; left: 16px;
                padding: 8px 12px; background: #1a1a1a; color: #4dff88;
                border: 1px solid #333; border-left: 3px solid #4dff88;
                border-radius: 4px; font-size: 20px; font-family: Consolas, monospace;
                z-index: 2147483647; font-weight: bold; text-align: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                animation: hp-slide-in-left 0.3s ease forwards;
            }
            @keyframes hp-fade {
                0% { opacity: 0; transform: translateY(10px); }
                5% { opacity: 1; transform: translateY(0); }
                85% { opacity: 1; transform: translateY(-5px); }
                100% { opacity: 0; transform: translateY(-20px); }
            }
            @keyframes hp-slide-in-left {
                0% { opacity: 0; transform: translateX(-20px); }
                100% { opacity: 1; transform: translateX(0); }
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    const getLogger = () => {
        if (logContainer && document.contains(logContainer)) return logContainer;
        logContainer = document.createElement("div");
        logContainer.id = "hp-log-container";
        (document.body || document.documentElement).appendChild(logContainer);
        return logContainer;
    };

    const pushLog = (rawMsg) => {
        const container = getLogger();
        const el = document.createElement("div");
        el.className = "hp-log";

        let displayText = String(rawMsg);
        if (displayText.includes("http")) {
            try {
                const urlMatch = displayText.match(/https?:\/\/[^ "']+/);
                if (urlMatch) {
                    const urlObj = new URL(urlMatch[0]);
                    displayText = urlObj.hostname;
                }
            } catch (e) {}
        }

        el.textContent = `🛡️ ${displayText}`;
        container.appendChild(el);
        if (container.childElementCount > 8) container.firstElementChild.remove();
        setTimeout(() => el.remove(), 6200);
    };

    const toast = (msg) => {
        const existing = document.querySelector('.hp-toast');
        if (existing) existing.remove();

        const el = document.createElement("div");
        el.className = "hp-toast";
        el.textContent = msg;
        (document.body || document.documentElement).appendChild(el);
        setTimeout(() => el.remove(), 2500);
    };

    // --- COOKIES ---
    const activateCookieDefense = async () => {
        if (!window.cookieStore) return;

        const kill = (name) => {
            window.cookieStore.delete(name);
            pushLog(`Cookie: ${name}`);
        };

        const all = await window.cookieStore.getAll();
        all.filter(c => blockedCookies.some(r => r.test(c.name))).forEach(c => kill(c.name));

        window.cookieStore.addEventListener('change', (event) => {
            event.changed.forEach(c => {
                if (blockedCookies.some(r => r.test(c.name))) {
                    kill(c.name);
                }
            });
        });
    };

    // --- BLOCKING ---
    const isBlocked = (urlStr) => {
        try {
            const h = new URL(urlStr, location.href).hostname;
            return blockedHosts.some(blocked => h === blocked || h.endsWith('.' + blocked));
        } catch {
            return false;
        }
    };

    const patchDataLayer = () => {
        window.dataLayer = window.dataLayer || [];
        const originalPush = Array.prototype.push;
        const safePush = function(...args) {
            const allowed = [];
            for (const arg of args) {
                if (arg && typeof arg === "object" && arg.event && blockedEvents.has(arg.event)) {
                    pushLog(arg.event);
                } else {
                    allowed.push(arg);
                }
            }
            return allowed.length ? originalPush.apply(this, allowed) : this.length;
        };
        window.dataLayer.push = safePush;
    };

    // --- EXTRACTION ---
    const simpleHash = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    };

    const getCleanTextFromNode = (node) => {
        if (!node) return "";
        const clone = node.cloneNode(true);

        const images = clone.querySelectorAll('img');
        images.forEach(img => {
            if (img.alt && img.alt.trim()) {
                const textNode = document.createTextNode(`[Image: ${img.alt.trim()}] `);
                img.parentNode.replaceChild(textNode, img);
            }
        });

        const tables = clone.querySelectorAll('table');
        tables.forEach(table => {
            let tableText = "\n";
            const rows = table.querySelectorAll('tr');

            rows.forEach((row, rowIndex) => {
                const cells = row.querySelectorAll('td, th');
                const rowText = Array.from(cells)
                    .map(cell => cell.innerText.trim().replace(/\n/g, ' '))
                    .join(' | ');

                tableText += `| ${rowText} |\n`;

                if (rowIndex === 0) {
                    const divider = Array.from(cells).map(() => '---').join(' | ');
                    tableText += `| ${divider} |\n`;
                }
            });

            tableText += "\n";
            const pre = document.createElement('div');
            pre.innerText = tableText;
            table.parentNode.replaceChild(pre, table);
        });

        const brs = clone.querySelectorAll('br');
        brs.forEach(br => br.parentNode.replaceChild(document.createTextNode('\n'), br));

        return clone.innerText.trim().replace(/\n\s*\n/g, '\n\n');
    };

    const extractAndCopy = () => {
        const qContainer = document.querySelector('.challenge-v2-question__text') ||
                           document.querySelector('.question-body');

        if (!qContainer) return;

        const aList = document.querySelector('.challenge-v2-answer__list');

        if (!aList) return;

        let finalQ = getCleanTextFromNode(qContainer);

        const answerItems = Array.from(aList.querySelectorAll('li'));
        const finalAnswers = answerItems.map(li => {
            if (li.classList.contains('rationale-item')) return null;

            const letterEl = li.querySelector('.letter');
            const textEl = li.querySelector('.challenge-v2-answer__text div') ||
                           li.querySelector('.challenge-v2-answer__text');

            if (!textEl) return null;

            const letter = letterEl ? letterEl.innerText.trim() : "-";
            const text = getCleanTextFromNode(textEl);

            return `${letter} ${text}`;
        }).filter(Boolean).join('\n');

        const fullText = `QUESTION:\n${finalQ}\n\nOPTIONS:\n${finalAnswers}`;

        const contentHash = simpleHash(fullText);
        if (contentHash === lastCopiedHash) return;

        lastCopiedHash = contentHash;

        if (typeof GM_setClipboard === "function") {
            GM_setClipboard(fullText);
            toast("📋");
        } else {
            navigator.clipboard.writeText(fullText).then(() => toast("📋"));
        }
    };

    // --- INIT ---
    const init = () => {
        injectStyles();
        patchDataLayer();
        activateCookieDefense();

        setInterval(extractAndCopy, 1000);
        setTimeout(extractAndCopy, 500);

        new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const n of m.addedNodes) {
                    if (n.tagName === "SCRIPT" && n.src && isBlocked(n.src)) {
                        n.remove();
                        pushLog(n.src);
                    }
                }
            }
        }).observe(document.documentElement, { childList: true, subtree: true });

        const cleanInterval = setInterval(() => {
            document.querySelectorAll('script[src]').forEach(s => {
                if (isBlocked(s.src)) { s.remove(); pushLog(s.src); }
            });
            if (typeof SOPHIA !== "undefined") {
                sophiaMethods.forEach(m => {
                    if (SOPHIA[m] && !SOPHIA[m]._patched) {
                        SOPHIA[m] = () => pushLog(`SOPHIA.${m}`);
                        SOPHIA[m]._patched = true;
                    }
                });
            }
            if (window.ga && !window.ga._patched) {
                const oldGa = window.ga;
                window.ga = function(...args) {
                    if (args[0] === 'send' && blockedGa.has(args[1])) {
                        pushLog(args[1]);
                        return;
                    }
                    return oldGa.apply(this, args);
                };
                window.ga._patched = true;
            }
        }, 1000);
        setTimeout(() => clearInterval(cleanInterval), 15000);
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
