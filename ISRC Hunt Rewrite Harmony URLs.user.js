// ==UserScript==
// @name        ISRC Hunt: Rewrite Harmony URLs
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.1
// @description Rewrites links to Harmony to use "category=preferred"
// @author      chaban
// @license     MIT
// @match       *://isrchunt.com/*
// @grant       none
// ==/UserScript==

[].forEach.call(document.querySelectorAll('a[href*="harmony"]'), function (el) {
    let params = new URLSearchParams(el.search);
    let spotify = params.get('url').split('/').pop();
    el.href = `https://harmony.pulsewidth.org.uk/release?spotify=${spotify}&category=preferred`;
});