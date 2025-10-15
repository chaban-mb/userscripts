// ==UserScript==
// @name         YouTube Music: Spotify Search
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Adds a context-aware "Search on Spotify" item to the menu for songs and albums.
// @author       chaban
// @license      MIT
// @match        https://music.youtube.com/*
// @connect      spotify.com
// @grant        GM_openInTab
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const CUSTOM_ITEM_ID = 'spotify-search';

    console.log(`%c[${SCRIPT_NAME}] Script Loaded. Version ${GM.info.script.version}.`, 'font-weight: bold;');

    let lastActionContext = null;

    /**
     * Extracts context by checking multiple DOM structures, starting from the trigger element.
     * @param {HTMLElement} triggerElement The element that initiated the menu.
     * @returns { {query: string, type: string} | null }
     */
    const getContextFromTrigger = (triggerElement) => {
        console.log(`%c[${SCRIPT_NAME}] getContextFromTrigger: Received trigger...`, 'color: royalblue;', triggerElement);
        if (!triggerElement) {
            console.warn(`[${SCRIPT_NAME}] Trigger element is null.`);
            return null;
        }

        try {
            // Strategy 1: Song in a list (most common)
            const listItem = triggerElement.closest('ytmusic-responsive-list-item-renderer');
            if (listItem) {
                console.log(`[${SCRIPT_NAME}] Found list item parent. Attempting Strategy 1 (Song)...`, listItem);
                const title = listItem.querySelector('.title a, .title')?.textContent?.trim();
                let artist = Array.from(listItem.querySelectorAll('.secondary-flex-columns a'))
                                .map(node => node.textContent.trim())
                                .join(' ');

                // If artist is not found in the row, we are likely on an album page.
                // Look for the artist in the main page header instead.
                if (!artist && title) {
                    console.log(`[${SCRIPT_NAME}] -> No artist in song row, looking for page header artist...`);
                    artist = document.querySelector('ytmusic-responsive-header-renderer .strapline-text a, ytmusic-detail-header-renderer .subtitle a')?.textContent?.trim();
                }

                if (title && artist) {
                    const result = { query: `${artist} ${title}`, type: 'Song' };
                    console.log(`%c[${SCRIPT_NAME}] -> SUCCESS (Song). Context:`, 'color: lightgreen;', result);
                    return result;
                }
            }

            // Strategy 2: Album/Artist header
            const header = triggerElement.closest('ytmusic-responsive-header-renderer');
            if (header) {
                console.log(`[${SCRIPT_NAME}] Found header parent. Attempting Strategy 2 (Header)...`, header);
                const title = header.querySelector('.title')?.textContent?.trim();
                const artist = header.querySelector('.strapline-text a')?.textContent?.trim();
                const subtitleText = header.querySelector('.subtitle')?.textContent?.toLowerCase() || 'album';
                let type = 'Album'; // Default to Album
                if (subtitleText.includes('artist')) type = 'Artist';
                else if (subtitleText.includes('single')) type = 'Single';
                else if (subtitleText.includes('ep')) type = 'EP';

                if (title && artist) {
                    const result = { query: `${artist} ${title}`, type: type };
                    console.log(`%c[${SCRIPT_NAME}] -> SUCCESS (Header). Context:`, 'color: lightgreen;', result);
                    return result;
                }
            }

            // Strategy 3: Album/Playlist/Song/Channel Card (e.g., in carousels)
            const cardItem = triggerElement.closest('ytmusic-two-row-item-renderer');
            if (cardItem) {
                console.log(`[${SCRIPT_NAME}] Found card parent. Attempting Strategy 3 (Card)...`, cardItem);
                const title = cardItem.querySelector('.title a, .title')?.textContent?.trim();
                const subtitleText = cardItem.querySelector('.subtitle')?.textContent?.trim() || '';
                const parts = subtitleText.split('•').map(s => s.trim());
                const type = parts[0] || 'Unknown';

                // Handle Channels by checking for circular thumbnail, a structural hint.
                if (cardItem.hasAttribute('has-circle-cropped-thumbnail')) {
                    const result = { query: title, type: 'Channel' };
                    console.log(`%c[${SCRIPT_NAME}] -> SUCCESS (Channel Card). Context:`, 'color: lightgreen;', result);
                    return result;
                }

                // Handle User Playlists by checking if the type is "Playlist".
                if (type.toLowerCase() === 'playlist') {
                     const result = { query: title, type: 'Playlist' };
                     console.log(`%c[${SCRIPT_NAME}] -> SUCCESS (Playlist Card). Context:`, 'color: lightgreen;', result);
                     return result;
                }

                // Handle Album/Song/EP/Single cards
                const artist = parts[1] || '';
                if (title) {
                    const result = { query: `${artist} ${title}`, type: type };
                    console.log(`%c[${SCRIPT_NAME}] -> SUCCESS (Media Card). Context:`, 'color: lightgreen;', result);
                    return result;
                }
            }

            // Strategy 4: Main player bar
            const playerBar = triggerElement.closest('ytmusic-player-bar');
            if (playerBar) {
                console.log(`[${SCRIPT_NAME}] Found player bar parent. Attempting Strategy 4 (Player Bar)...`, playerBar);
                const title = playerBar.querySelector('.title')?.textContent?.trim();
                const artist = playerBar.querySelector('.byline-wrapper .subtitle a')?.textContent?.trim();
                if (title && artist) {
                    const result = { query: `${artist} ${title}`, type: 'Song' };
                    console.log(`%c[${SCRIPT_NAME}] -> SUCCESS (Player Bar). Context:`, 'color: lightgreen;', result);
                    return result;
                }
            }

        } catch (e) {
            console.error(`[${SCRIPT_NAME}] An error occurred in getContextFromTrigger:`, e);
        }

        console.warn(`[${SCRIPT_NAME}] getContextFromTrigger: No valid context found for this trigger.`);
        return null;
    };

    /**
     * Adds the custom menu item using the pre-captured context data.
     */
    const addCustomMenuItem = (menu) => {
        if (!lastActionContext || !menu || menu.querySelector(`#${CUSTOM_ITEM_ID}`)) {
            return;
        }
        console.log(`%c[${SCRIPT_NAME}] addCustomMenuItem: Called for menu. Context:`, 'color: orange;', lastActionContext);

        const listbox = menu.querySelector('tp-yt-paper-listbox');
        if (!listbox) return;

        const context = lastActionContext;
        const customItem = document.createElement('ytmusic-menu-navigation-item-renderer');
        customItem.id = CUSTOM_ITEM_ID;
        customItem.data = {
            text: { runs: [{ text: `Search "${context.type}" on Spotify` }] },
            icon: { iconType: 'YTMUSIC_SEARCH' },
            navigationEndpoint: {}
        };

        const nativeItem = listbox.querySelector('ytmusic-menu-navigation-item-renderer');
        if (nativeItem) customItem.className = nativeItem.className;

        customItem.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const spotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(context.query)}`;
            GM_openInTab(spotifyUrl, { active: true });
            if (menu?.close) menu.close();
        }, true);

        listbox.prepend(customItem);
        console.log(`%c[${SCRIPT_NAME}] SUCCESS! Item added to menu.`, 'color: lightgreen; font-weight: bold;');
        lastActionContext = null;
    };

    // STAGE 2: Observes a specific menu element for style changes (i.e., being shown again).
    const attributeObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.attributeName === 'style') {
                const menu = mutation.target;
                // Add item if the menu is now visible and doesn't already have our item
                if (menu.style.display !== 'none' && !menu.querySelector(`#${CUSTOM_ITEM_ID}`)) {
                     console.log(`%c[${SCRIPT_NAME}] AttributeObserver: Menu became visible. Adding item.`, 'color: purple;');
                    addCustomMenuItem(menu);
                }
            }
        }
    });

    // STAGE 1: Listens for the 'yt-action' event to capture context.
    document.addEventListener('yt-action', (event) => {
        if (event?.detail?.actionName === 'yt-open-popup-action') {
            console.log(`%c[${SCRIPT_NAME}] 'yt-open-popup-action' captured.`, event.detail);
            const triggerElement = event?.detail?.args?.[1];
            lastActionContext = getContextFromTrigger(triggerElement);
        }
    });

    // STAGE 1: Observes for new menus being added to the DOM for the first time.
    const menuObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'YTMUSIC-MENU-POPUP-RENDERER') {
                    if (!node.dataset.customMenuObserved) {
                        console.log(`%c[${SCRIPT_NAME}] MenuObserver: New menu detected. Attaching attribute observer.`, 'color: blue;');
                        node.dataset.customMenuObserved = 'true';
                        // The attribute observer will handle the initial injection, preventing race conditions.
                        attributeObserver.observe(node, { attributes: true, attributeFilter: ['style'] });
                    }
                }
            }
        }
    });

    menuObserver.observe(document.body, { childList: true, subtree: true });

})();
