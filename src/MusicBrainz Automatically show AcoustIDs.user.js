// ==UserScript==
// @name        MusicBrainz: Automatically show AcoustIDs
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.3.3
// @description Automatically triggers the "Show acoustIDs" function of loujine's script
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://*.musicbrainz.org/artist/*/recordings*
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       none
// @run-at      document-idle
// @updateURL   https://github.com/chaban-mb/userscripts/raw/dist/src/MusicBrainz%20Automatically%20show%20AcoustIDs.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/dist/src/MusicBrainz%20Automatically%20show%20AcoustIDs.user.js
// ==/UserScript==

if (document.querySelector('.tbl th:last-of-type')?.textContent.trim() !== 'AcoustID') {
        document.querySelector('#showAcoustids')?.click();
}