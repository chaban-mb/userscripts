// ==UserScript==
// @name         MusicBrainz: Artwork Uploader Thumbnails Accelerator
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.4
// @tag          ai-created
// @description  Replaces data URI thumbnails on the artwork uploader with object URLs for better performance.
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/release/*/add-cover-art*
// @match        *://*.musicbrainz.org/event/*/add-event-art*
// @grant        none
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const originalReadAsDataURL = FileReader.prototype.readAsDataURL;

    FileReader.prototype.readAsDataURL = function(file) {
        const fileReaderInstance = this;

        const originalOnload = fileReaderInstance.onload;
        const originalOnloadend = fileReaderInstance.onloadend;

        fileReaderInstance.onload = (event) => {
            const objectURL = URL.createObjectURL(file);

            Object.defineProperty(fileReaderInstance, 'result', {
                value: objectURL,
                writable: false,
                configurable: true,
            });

            if (originalOnload) {
                originalOnload.call(fileReaderInstance, event);
            }
        };

        setTimeout(() => {
            fileReaderInstance.dispatchEvent(new ProgressEvent('load'));
            const loadEndEvent = new ProgressEvent('loadend');
            fileReaderInstance.dispatchEvent(loadEndEvent);

            if (originalOnloadend) {
                originalOnloadend.call(fileReaderInstance, loadEndEvent);
            }
        }, 0);

    };
})();