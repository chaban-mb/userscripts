// ==UserScript==
// @name        Discourse: Disable Touch Detection
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.1.2
// @description Overrides browser APIs to disable touch-based UI adjustments in Discourse forums.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       https://community.metabrainz.org/*
// @icon        https://www.discourse.org/a/img/favicon.png
// @grant       none
// @run-at      document-start
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/Discourse%20Disable%20Touch%20Detection.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/Discourse%20Disable%20Touch%20Detection.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;

    // --- Shim 1: Modern Touch Detection (any-pointer: coarse) ---
    // This is the primary method used in recent Discourse versions.

    const TARGETED_QUERY = '(any-pointer: coarse)';
    const originalMatchMedia = window.matchMedia;

    window.matchMedia = (query) => {
        if (query === TARGETED_QUERY) {
            console.log(`[${SCRIPT_NAME}] Spoofing result for modern touch query: '${query}'`);
            return {
                matches: false,
                media: query,
                addListener: () => { },
                removeListener: () => { },
                addEventListener: () => { },
                removeEventListener: () => { },
                dispatchEvent: () => true,
            };
        }
        return originalMatchMedia.call(window, query);
    };

    // --- Shim 2: Legacy Touch Detection (maxTouchPoints & ontouchstart) ---
    // This provides backward compatibility for older Discourse versions.

    try {
        Object.defineProperty(navigator, 'maxTouchPoints', {
            get: () => 0,
            configurable: true,
        });

        if ('ontouchstart' in window) {
            delete window.ontouchstart;
        }

        console.log(`[${SCRIPT_NAME}] Applied legacy touch detection shims (maxTouchPoints, ontouchstart).`);

    } catch (e) {
        console.error(`[${SCRIPT_NAME}] Failed to apply legacy shims.`, e);
    }

})();