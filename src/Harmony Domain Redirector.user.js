// ==UserScript==
// @name         Harmony: Domain Redirector
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Redirects the official Harmony instance to the alternative mybrainz instance.
// @author       chaban
// @license      MIT
// @match        https://harmony.pulsewidth.org.uk/*
// @icon         https://harmony.pulsewidth.org.uk/harmony-logo.svg
// @run-at       document-start
// @grant        none
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/Harmony%20Domain%20Redirector.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/Harmony%20Domain%20Redirector.user.js
// ==/UserScript==

(function () {
    'use strict';

    const url = new URL(window.location.href);
    if (url.hostname === 'harmony.pulsewidth.org.uk') {
        url.hostname = 'harmony.mybrainz.dev';
        window.location.replace(url.href);
    }
})();
