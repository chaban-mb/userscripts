// ==UserScript==
// @name         YouTube Music: Spotify Search
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.1.0
// @description  Adds a context-aware "Search on Spotify" item to the menu for songs and albums.
// @author       chaban
// @license      MIT
// @match        https://music.youtube.com/*
// @connect      spotify.com
// @grant        GM_openInTab
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20Music%20Spotify%20Search.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20Music%20Spotify%20Search.user.js
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const CUSTOM_ITEM_ID = 'spotify-search';

    console.debug(`[${SCRIPT_NAME}] Script initialized (v${GM.info.script.version})`);

    let lastActionContext = null;

    /**
     * Extracts context by checking multiple DOM structures, starting from the trigger element.
     * @param {HTMLElement} triggerElement The element that initiated the menu.
     * @returns { {query: string, type: string} | null }
     */
    const getContextFromTrigger = (triggerElement) => {
        if (!triggerElement) {
            console.debug(`[${SCRIPT_NAME}] Context extraction skipped: Trigger element is null.`);
            return null;
        }

        const attempts = [];

        try {
            // Strategy 1: Song / Podcast Episode in a list
            const listItem = triggerElement.closest('ytmusic-responsive-list-item-renderer, ytmusic-multi-row-list-item-renderer');
            if (listItem) {
                const title = listItem.querySelector('.title a, .title')?.textContent?.trim();
                let artist = Array.from(listItem.querySelectorAll('.secondary-flex-columns a, .subtitle a'))
                                .map(node => node.textContent.trim())
                                .filter(Boolean)
                                .join(' ');

                // If artist is not found in the row, check page header
                if (!artist && title) {
                    artist = document.querySelector('ytmusic-immersive-header-renderer .title, ytmusic-responsive-header-renderer .title, ytmusic-responsive-header-renderer .strapline-text a, ytmusic-detail-header-renderer .subtitle a')?.textContent?.trim();
                }

                const isMultiRow = listItem.tagName.toLowerCase() === 'ytmusic-multi-row-list-item-renderer';
                const subtitleText = listItem.querySelector('.subtitle')?.textContent?.toLowerCase() || '';
                const isPodcast = isMultiRow || subtitleText.includes('episode') || subtitleText.includes('podcast');
                const type = isPodcast ? 'Podcast' : 'Song';

                if (title) {
                    const query = artist ? `${artist} ${title}` : title;
                    const result = { query, type, strategy: 'ListItem' };
                    console.debug(`[${SCRIPT_NAME}] Context extracted`, result);
                    return result;
                }
                attempts.push({ strategy: 'ListItem', matched: true, titleFound: Boolean(title), artistFound: Boolean(artist), listItem });
            } else {
                attempts.push({ strategy: 'ListItem', matched: false });
            }

            // Strategy 2: Album/Artist/Immersive header
            const header = triggerElement.closest('ytmusic-responsive-header-renderer, ytmusic-immersive-header-renderer, ytmusic-detail-header-renderer');
            if (header) {
                const title = header.querySelector('.title')?.textContent?.trim();
                const artist = header.querySelector('.strapline-text a')?.textContent?.trim();
                const subtitleText = header.querySelector('.subtitle')?.textContent?.toLowerCase() || 'album';
                
                const isImmersiveArtistHeader = header.tagName.toLowerCase() === 'ytmusic-immersive-header-renderer';
                
                let type = 'Album';
                if (isImmersiveArtistHeader || subtitleText.includes('artist')) {
                    type = 'Artist';
                } else if (subtitleText.includes('single')) {
                    type = 'Single';
                } else if (subtitleText.includes('ep')) {
                    type = 'EP';
                }

                if (title) {
                    const query = isImmersiveArtistHeader || !artist ? title : `${artist} ${title}`;
                    const result = { query, type, strategy: 'Header' };
                    console.debug(`[${SCRIPT_NAME}] Context extracted`, result);
                    return result;
                }
                attempts.push({ strategy: 'Header', matched: true, titleFound: Boolean(title), artistFound: Boolean(artist), header });
            } else {
                attempts.push({ strategy: 'Header', matched: false });
            }

            // Strategy 3: Album/Playlist/Song/Channel Card (e.g., in carousels)
            const cardItem = triggerElement.closest('ytmusic-two-row-item-renderer');
            if (cardItem) {
                const title = cardItem.querySelector('.title a, .title')?.textContent?.trim();
                const subtitleText = cardItem.querySelector('.subtitle')?.textContent?.trim() || '';

                if (cardItem.hasAttribute('has-circle-cropped-thumbnail')) {
                    const result = { query: title, type: 'Channel', strategy: 'Card' };
                    console.debug(`[${SCRIPT_NAME}] Context extracted`, result);
                    return result;
                }

                // Subtitle analysis
                const parts = subtitleText.split('•').map(s => s.trim()).filter(Boolean);
                
                let type = 'Album';
                let artist = '';
                let year = '';

                for (const part of parts) {
                    const lower = part.toLowerCase();
                    if (/^\d{4}$/.test(part)) {
                        year = part;
                    } else if (['album', 'single', 'ep', 'playlist', 'podcast'].includes(lower)) {
                        if (lower === 'album') type = 'Album';
                        else if (lower === 'single') type = 'Single';
                        else if (lower === 'ep') type = 'EP';
                        else if (lower === 'playlist') type = 'Playlist';
                    } else {
                        if (!artist) artist = part;
                    }
                }

                if (type === 'Playlist') {
                    const result = { query: title, type: 'Playlist', strategy: 'Card' };
                    console.debug(`[${SCRIPT_NAME}] Context extracted`, result);
                    return result;
                }

                // If artist is missing in card subtitle (common on artist discography carousels),
                // fall back to page header artist
                if (!artist) {
                    artist = document.querySelector('ytmusic-immersive-header-renderer .title, ytmusic-responsive-header-renderer .title, ytmusic-detail-header-renderer .title')?.textContent?.trim() || '';
                }

                if (title) {
                    const query = artist ? `${artist} ${title}` : title;
                    const result = { query, type, strategy: 'Card' };
                    console.debug(`[${SCRIPT_NAME}] Context extracted`, result);
                    return result;
                }
                attempts.push({ strategy: 'Card', matched: true, titleFound: Boolean(title), artistFound: Boolean(artist), type, cardItem });
            } else {
                attempts.push({ strategy: 'Card', matched: false });
            }

            // Strategy 4: Main player bar
            const playerBar = triggerElement.closest('ytmusic-player-bar');
            if (playerBar) {
                const title = playerBar.querySelector('.title')?.textContent?.trim();
                const artist = playerBar.querySelector('.byline-wrapper .subtitle a')?.textContent?.trim();
                if (title && artist) {
                    const result = { query: `${artist} ${title}`, type: 'Song', strategy: 'PlayerBar' };
                    console.debug(`[${SCRIPT_NAME}] Context extracted`, result);
                    return result;
                }
                attempts.push({ strategy: 'PlayerBar', matched: true, titleFound: Boolean(title), artistFound: Boolean(artist), playerBar });
            } else {
                attempts.push({ strategy: 'PlayerBar', matched: false });
            }

        } catch (e) {
            console.error(`[${SCRIPT_NAME}] Context extraction crashed:`, { triggerElement, attempts, error: e });
            return null;
        }

        // All strategies failed -> Emit rich diagnostic payload!
        console.warn(`[${SCRIPT_NAME}] Failed to resolve context for menu trigger:`, {
            triggerElement,
            triggerTag: triggerElement.tagName,
            triggerHTML: triggerElement.outerHTML?.slice(0, 200),
            pageUrl: location.href,
            attempts
        });

        return null;
    };

    /**
     * Adds the custom menu item using the pre-captured context data.
     */
    const addCustomMenuItem = (menu) => {
        if (!lastActionContext || !menu || menu.querySelector(`#${CUSTOM_ITEM_ID}`)) {
            return;
        }

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
        console.debug(`[${SCRIPT_NAME}] Prepend custom Spotify menu item:`, context);
        lastActionContext = null;
    };

    // STAGE 2: Observes a specific menu element for style changes (i.e., being shown again).
    const attributeObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.attributeName === 'style') {
                const menu = mutation.target;
                // Add item if the menu is now visible and doesn't already have our item
                if (menu.style.display !== 'none' && !menu.querySelector(`#${CUSTOM_ITEM_ID}`)) {
                    addCustomMenuItem(menu);
                }
            }
        }
    });

    // STAGE 1: Listens for the 'yt-action' event to capture context.
    document.addEventListener('yt-action', (event) => {
        if (event?.detail?.actionName === 'yt-open-popup-action') {
            console.debug(`[${SCRIPT_NAME}] yt-open-popup-action captured`, event.detail);
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
