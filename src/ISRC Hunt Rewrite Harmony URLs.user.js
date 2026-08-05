// ==UserScript==
// @name        ISRC Hunt: Rewrite Harmony URLs
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.2.2
// @description Rewrites links to Harmony to use "category=preferred"
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://isrchunt.com/*
// @grant       none
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Rewrite%20Harmony%20URLs.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Rewrite%20Harmony%20URLs.user.js
// ==/UserScript==

[].forEach.call(document.querySelectorAll('a[href*="harmony"]'), function (el) {
    let params = new URLSearchParams(el.search);
    let spotify = params.get('url').split('/').pop();
    el.href = `https://harmony.pulsewidth.org.uk/release?spotify=${spotify}&category=preferred`;
});