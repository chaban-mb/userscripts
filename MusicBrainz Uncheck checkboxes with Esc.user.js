// ==UserScript==
// @name         MusicBrainz: Uncheck checkboxes with Esc
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.2
// @description  Unchecks all checked checkboxes for specified selectors when pressing Escape key
// @tag          ai-created
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/*
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    /**
     * An array of base CSS selectors targeting the checkboxes to be unchecked.
     * The ':checked' pseudo-selector will be automatically appended to each base selector.
     * Examples:
     * - 'input[type="checkbox"][name="add-to-merge"]'
     * - '#mySpecificIdCheckbox'
     * - '.some-class-checkbox'
     * - 'input[type="checkbox"][data-custom-attribute="value"]'
     */
    const TARGET_CHECKBOX_SELECTORS = [
        'input[type="checkbox"][name="add-to-merge"]',
        '.release-relationship-editor #tracklist [type="checkbox"]',
        '.cover-art-checkbox',
        '#selectAllCovers',
    ];

    /**
     * Unchecks all currently checked checkboxes that match the combined selectors.
     */
    function uncheckTargetCheckboxes() {
        // Join all base selectors with ':checked' and then with a comma for a single query.
        const fullSelector = TARGET_CHECKBOX_SELECTORS
            .map(baseSelector => `${baseSelector}:checked`)
            .join(', ');

        // If there are no selectors, do nothing.
        if (!fullSelector) {
            return;
        }

        document.querySelectorAll(fullSelector).forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            uncheckTargetCheckboxes();
        }
    });
})();
