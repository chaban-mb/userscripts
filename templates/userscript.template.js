// ==UserScript==
// @name         {{NAME}}
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  {{DESCRIPTION}}
// @tag          ai-created
// @author       chaban
// @license      MIT
// @homepageURL  https://github.com/chaban-mb/userscripts
// @supportURL   https://github.com/chaban-mb/userscripts/issues
// @match        *://*.musicbrainz.org/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/{{ENCODED_NAME}}.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/{{ENCODED_NAME}}.user.js
// ==/UserScript==

(async function () {
    'use strict';

    const SCRIPT_NAME = '{{NAME}}';

    // Structured logging helper
    const log = {
        debug: (...args) => console.debug(`[${SCRIPT_NAME}]`, ...args),
        info: (...args) => console.info(`[${SCRIPT_NAME}]`, ...args),
        warn: (...args) => console.warn(`[${SCRIPT_NAME}]`, ...args),
        error: (...args) => console.error(`[${SCRIPT_NAME}]`, ...args),
    };

    /**
     * Main script entry point
     */
    async function main() {
        log.debug('Initialized successfully on', location.href);
        // Script logic here
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        await main();
    }
})();
