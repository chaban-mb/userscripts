// ==UserScript==
// @name        [DEPRECATED] MusicBrainz: Artwork Uploader Thumbnails Accelerator
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.0.7
// @description Replaces data URI thumbnails on the artwork uploader with object URLs for better performance.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://*.musicbrainz.org/release/*/add-cover-art*
// @match       *://*.musicbrainz.org/event/*/add-event-art*
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       none
// @run-at      document-start
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Artwork%20Uploader%20Thumbnails%20Accelerator.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Artwork%20Uploader%20Thumbnails%20Accelerator.user.js
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const MESSAGE =
        `MusicBrainz: Artwork Uploader Thumbnails Accelerator is now DEPRECATED.\n\n` +
        `This script is no longer needed as the optimization is now built into MusicBrainz.\n\n` +
        `Please uninstall the script from your userscript manager.`;

    console.info(`[${SCRIPT_NAME}]: Script is deprecated and no longer required. Please uninstall.`);
    window.alert(MESSAGE);
})();