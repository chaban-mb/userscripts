// ==UserScript==
// @name        MusicBrainz: Hotkeys for selected entities
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.7.1
// @description Adds hotkeys to perform actions on selected entities. "A" = Artwork, "D" = Delete, "E" = Edit, "W" = Merge, "Q" = Aliases, "R" = Relationship Editor, "H" = Editing History
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://*.musicbrainz.org/artist*
// @match       *://*.musicbrainz.org/area/*
// @match       *://*.musicbrainz.org/release-group/*
// @match       *://*.musicbrainz.org/release/*
// @match       *://*.musicbrainz.org/recording/*
// @match       *://*.musicbrainz.org/work/*
// @match       *://*.musicbrainz.org/label/*
// @match       *://*.musicbrainz.org/place/*
// @match       *://*.musicbrainz.org/instrument/*
// @match       *://*.musicbrainz.org/genre/*
// @match       *://*.musicbrainz.org/event/*
// @match       *://*.musicbrainz.org/series/*
// @match       *://*.musicbrainz.org/collection/*
// @match       *://*.musicbrainz.org/isrc/*
// @match       *://*.musicbrainz.org/iswc/*
// @match       *://*.musicbrainz.org/report/*
// @match       *://*.musicbrainz.org/*/*/artists
// @match       *://*.musicbrainz.org/*/*/releases
// @match       *://*.musicbrainz.org/*/*/recordings
// @match       *://*.musicbrainz.org/*/*/release-groups
// @match       *://*.musicbrainz.org/*/*/events
// @match       *://*.musicbrainz.org/*/*/labels
// @match       *://*.musicbrainz.org/*/*/places
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       none
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Hotkeys%20for%20selected%20entities.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Hotkeys%20for%20selected%20entities.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAMESPACE = GM_info.script.namespace;
    const SCRIPT_NAME = GM_info.script.name;
    const ACTION_EVENT_NAME = 'UserJS:MusicBrainz';

    const entityTypes = {
        artist: { actions: ['edit', 'aliases', 'edits'] },
        release: { actions: ['delete', 'edit', 'viewArtwork', 'aliases', 'edit-relationships', 'edits'] },
        recording: { actions: ['delete', 'edit', 'aliases', 'edits'] },
        work: { actions: ['edit', 'aliases', 'edits'] },
        area: { actions: ['delete', 'edit', 'aliases', 'edits'] },
        instrument: { actions: ['delete', 'edit', 'aliases', 'edits'] },
        genre: { actions: ['delete', 'edit', 'aliases', 'edits'] },
        'release-group': { actions: ['edit', 'aliases', 'edits'] },
        event: { actions: ['edit', 'viewArtwork', 'aliases', 'edits'] },
        place: { actions: ['edit', 'aliases', 'edits'] },
        label: { actions: ['edit', 'aliases', 'edits'] },
        series: { actions: ['edit', 'aliases', 'edits'] }
    };

    /**
     * Broadcasts an action event to check if another script can handle it.
     * @param {string} action - The action identifier (e.g., 'delete').
     * @param {Array<{type: string, mbid: string, url: string}>} items - List of entity objects.
     * @returns {boolean} True if an external handler intercepted the action via preventDefault().
     */
    function dispatchEntityAction(action, items) {
        const event = new CustomEvent(ACTION_EVENT_NAME, {
            detail: {
                namespace: SCRIPT_NAMESPACE,
                origin: SCRIPT_NAME,
                action,
                items
            },
            bubbles: true,
            cancelable: true
        });
        return !document.dispatchEvent(event);
    }

    /**
     * Extracts the entity type and MBID from the URL.
     * @param {string} url - The URL to extract from.
     * @returns {object|undefined} An object containing the entity type and MBID, or undefined if not detectable.
     */
    function extractEntityFromURL(url) {
        const entity = url.match(/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:$|\/|\?)/i);
        return entity ? {
            type: entity[1],
            mbid: entity[2]
        } : undefined;
    }

    /**
     * Extracts the entity type and MBID from the link. Uses extractEntityFromURL
     * @param {HTMLAnchorElement} link The link element.
     * @returns {object|null} An object containing the entity type and MBID, or null if not detectable.
     */
    function extractEntityInfoFromLink(link) {
        if (!link || !link.href) {
            return null;
        }
        const entityInfo = extractEntityFromURL(link.href);
        return entityInfo && entityTypes[entityInfo.type] ? entityInfo : null;
    }

    /**
     * Returns the URL for a specific action on an entity.
     * @param {object} entityInfo - The entity information (type and MBID).
     * @param {string} action - The action to perform.
     * @returns {string} The URL for the action.
     */
    function getUrlForAction(entityInfo, action) {
        let url = `/${entityInfo.type}/${entityInfo.mbid}/${action}`;
        if (action === 'viewArtwork') {
            url = entityInfo.type === 'release' ? `/release/${entityInfo.mbid}/cover-art` : `/event/${entityInfo.mbid}/event-art`;
        }
        return url;
    }

    /**
     * Opens pages for selected entity checkboxes or dispatches action to external listeners.
     * @param {NodeListOf<HTMLInputElement>|Array<HTMLInputElement>} checkboxes - Checkboxes of selected entities.
     * @param {string} action - Type of action (edit, delete, viewArtwork, aliases, etc.).
     */
    function openPages(checkboxes, action) {
        const items = [];
        checkboxes.forEach((checkbox) => {
            const row = checkbox.closest('tr');
            if (row) {
                const links = Array.from(row.querySelectorAll('a[href]'));
                for (const link of links) {
                    const entityInfo = extractEntityInfoFromLink(link);
                    if (entityInfo && entityTypes[entityInfo.type]?.actions.includes(action) && entityInfo.mbid) {
                        items.push(entityInfo);
                        break;
                    }
                }
            }
        });

        if (items.length > 0 && dispatchEntityAction(action, items)) {
            return; // Intercepted by external script
        }

        items.forEach((item, index) => {
            const url = getUrlForAction(item, action);
            setTimeout(() => {
                window.open(url, '_blank');
            }, index * 1000);
        });
    }

    /**
     * Gets the entity information from the current page URL.
     * @returns {object|null} An object containing the entity type and MBID, or null if not detectable.
     */
    function getCurrentEntity() {
        const entityInfo = extractEntityFromURL(window.location.href);
        return entityInfo && entityTypes[entityInfo.type] ? entityInfo : null;
    }

    /**
     * Checks if an input element or editable element has focus, excluding the entity selection checkboxes.
     * @returns {boolean} True if a non-checkbox input, textarea, select, or contenteditable element has focus.
     */
    function isInputFocused() {
        const activeElement = document.activeElement;
        if (!activeElement) return false;

        const tagName = activeElement.tagName.toLowerCase();

        if (tagName === 'input' && (activeElement.name === 'add-to-merge' || activeElement.name === 'remove' || activeElement.parentElement.className === 'checkbox-cell') && activeElement.type === 'checkbox') {
            return false;
        }

        return (
            tagName === 'input' ||
            tagName === 'textarea' ||
            tagName === 'select' ||
            activeElement.isContentEditable
        );
    }

    /**
     * Handles the keydown event for triggering actions.
     * @param {KeyboardEvent} event - The keydown event.
     */
    function handleKeyDown(event) {
        if (!event.isTrusted) {
            return;
        }
        if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.isComposing || isInputFocused()) {
            return;
        }

        const checkedSelector = 'input[name="add-to-merge"]:checked, input[name="remove"]:checked';
        const checkboxes = document.querySelectorAll(checkedSelector);

        // If items are selected, perform actions on them.
        if (checkboxes.length > 0) {
            switch (event.key) {
                case 'w':
                    if (checkboxes.length > 1) {
                        const container = document.querySelector('.list-merge-buttons-row-container');
                        if (container) {
                            const buttons = container.querySelectorAll('button[formtarget="_blank"]');
                            if (buttons.length > 0) {
                                buttons[buttons.length - 1].click();
                            }
                        }
                    }
                    break;
                case 'd':
                    openPages(checkboxes, 'delete');
                    break;
                case 'e':
                    openPages(checkboxes, 'edit');
                    break;
                case 'a':
                    openPages(checkboxes, 'viewArtwork');
                    break;
                case 'q':
                    openPages(checkboxes, 'aliases');
                    break;
                case 'r':
                    openPages(checkboxes, 'edit-relationships');
                    break;
                case 'h':
                    openPages(checkboxes, 'edits');
                    break;
            }

        } else {
            // No items selected, try to perform action on the current page entity.
            const currentEntity = getCurrentEntity();

            // Special handling for Merge (w) which uses a sidebar link
            if (event.key === 'w') {
                document.querySelector('#sidebar [href*="merge_queue"]')?.click();
                return;
            }

            if (!currentEntity) return;

            let action = '';
            switch (event.key) {
                case 'd':
                    action = 'delete';
                    break;
                case 'e':
                    action = 'edit';
                    break;
                case 'a':
                    action = 'viewArtwork';
                    break;
                case 'q':
                    action = 'aliases';
                    break;
                case 'r':
                    action = 'edit-relationships';
                    break;
                case 'h':
                    action = 'edits';
                    break;
            }

            if (action && entityTypes[currentEntity.type].actions.includes(action)) {
                const url = getUrlForAction(currentEntity, action);
                window.open(url, '_blank');
            }
        }
    }

    document.addEventListener('keydown', handleKeyDown);
})();