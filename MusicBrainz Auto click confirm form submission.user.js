// ==UserScript==
// @name         MusicBrainz: Auto click confirm form submission
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.3.0
// @description  Automatically clicks the button to confirm submitting (seeding) data from other sites
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/release/add*
// @match        *://*.musicbrainz.org/release/*/edit*
// @match        *://*.musicbrainz.org/recording/create*
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        none
// @inject-into  content
// ==/UserScript==

const urlParams = new URLSearchParams(window.location.search);

if (!urlParams.has('skip_confirmation')) {
    document.querySelector(".confirm-seed button[type='submit']")?.click();
}