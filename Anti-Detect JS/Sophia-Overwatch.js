// ==UserScript==
// @name         Sophia Overwatch
// @namespace    https://github.com/Scrut1ny
// @version      19.0
// @description  Copies Q&A, blocks tracking, event-driven cookie destruction
// @match        https://*.sophia.org/*
// @run-at       document-start
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(() => {
    "use strict";

    // --- CONFIGURATION ---
    const CONFIG = {
        blockedHosts: [
            "cdn.optimizely.com", "static.cloudflareinsights.com", "stat.sophia.org",
            "stats.sophia.org", "dpm.demdex.net", "js.hs-scripts.com",
            "analytics.sophia.org", "assets.adobedtm.com"
        ],
        blockedEvents: new Set([
            "show_tour", "close_tour", "click_link", "modal_view", "alert_view",
            "form_view", "form_submit", "form_field_change", "form_step"
        ]),
        blockedCookies: [
            /^sophia_st$/, // Sophia Session Timer
            /^AMCV/,       // Adobe Marketing Cloud
            /^AMCVS/,      // Adobe Analytics
            /^_sp_/        // Snowplow Analytics
        ]
    };

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
        all.filter(c => CONFIG.blockedCookies.some(r => r.test(c.name))).forEach(c => kill(c.name));

        window.cookieStore.addEventListener('change', (event) => {
            event.changed.forEach(c => {
                if (CONFIG.blockedCookies.some(r => r.test(c.name))) {
                    kill(c.name);
                }
            });
        });
    };

    // --- BLOCKING ---
    const patchDataLayer = () => {
        window.dataLayer = window.dataLayer || [];
        const originalPush = Array.prototype.push;
        window.dataLayer.push = function(...args) {
            const allowed = args.filter(a => !(a?.event && CONFIG.blockedEvents.has(a.event)));
            args.forEach(a => { if(a?.event && CONFIG.blockedEvents.has(a.event)) pushLog(a.event); });
            return allowed.length ? originalPush.apply(this, allowed) : this.length;
        };
    };

    const blockNetwork = () => {
        document.querySelectorAll('script[src]').forEach(s => {
            if (CONFIG.blockedHosts.some(h => s.src.includes(h))) {
                s.remove();
                pushLog(s.src);
            }
        });
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
        
        clone.querySelectorAll('img').forEach(img => {
            if (img.alt?.trim()) img.replaceWith(`[Image: ${img.alt.trim()}] `);
        });

        clone.querySelectorAll('table').forEach(table => {
            let tableText = "\n";
            const rows = table.querySelectorAll('tr');
            rows.forEach((row, i) => {
                const cells = Array.from(row.querySelectorAll('td, th'))
                    .map(c => c.innerText.trim().replace(/\n/g, ' '));
                tableText += `| ${cells.join(' | ')} |\n`;
                if (i === 0) tableText += `| ${cells.map(() => '---').join(' | ')} |\n`;
            });
            const pre = document.createElement('div');
            pre.innerText = tableText + "\n";
            table.replaceWith(pre);
        });

        clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
        return clone.innerText.trim().replace(/\n\s*\n/g, '\n\n'); 
    };

    const extractAndCopy = () => {
        const qContainer = document.querySelector('.challenge-v2-question__text, .question-body');
        const aList = document.querySelector('.challenge-v2-answer__list');
        if (!qContainer || !aList) return;

        let finalQ = getCleanTextFromNode(qContainer);
        
        const finalAnswers = Array.from(aList.querySelectorAll('li'))
            .map(li => {
                if (li.classList.contains('rationale-item')) return null;
                const letter = li.querySelector('.letter')?.innerText.trim() || "-";
                const textEl = li.querySelector('.challenge-v2-answer__text div, .challenge-v2-answer__text');
                return textEl ? `${letter} ${getCleanTextFromNode(textEl)}` : null;
            })
            .filter(Boolean)
            .join('\n'); 

        const fullText = `QUESTION:\n${finalQ}\n\nOPTIONS:\n${finalAnswers}`;
        const contentHash = simpleHash(fullText);
        
        if (contentHash === lastCopiedHash) return;
        lastCopiedHash = contentHash;

        GM_setClipboard(fullText);
        toast("📋"); 
    };

    // --- INIT ---
    const init = () => {
        injectStyles();
        patchDataLayer();
        activateCookieDefense(); 
        
        const loop = setInterval(() => {
            extractAndCopy();
            blockNetwork();
        }, 1000);

        setTimeout(() => clearInterval(loop), 15000);
        setInterval(extractAndCopy, 1000); 
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

})();
