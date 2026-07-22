// ==UserScript==
// @name         Spotify Release List: MusicBrainz Checker
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.2
// @tag          ai-created
// @description  Checks releases on Spotify Release List instances against MusicBrainz. Fades or hides found releases and collapses date groups where everything is catalogued.
// @author       chaban
// @license      MIT
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @match        https://spotifyreleaselist.netlify.app/*
// @match        https://*.spotifyreleaselist.netlify.app/*
// @match        https://spotifylist.mybrainz.dev/*
// @connect      musicbrainz.org
// @grant        GM.xmlHttpRequest
// @grant        GM.addStyle
// @require      ../lib/MusicBrainzAPI.js
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/Spotify%20Release%20List%20MusicBrainz%20Checker.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/Spotify%20Release%20List%20MusicBrainz%20Checker.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const log = (...args) => console.debug(`[${SCRIPT_NAME}]`, ...args);
    const warn = (...args) => console.warn(`[${SCRIPT_NAME}]`, ...args);

    const MB_BASE = 'https://musicbrainz.org';

    const api = new MusicBrainzAPI({
        user_agent: `${SCRIPT_NAME}/1.0.0 ( https://musicbrainz.org/user/chaban )`,
    });

    /** Album IDs that have already been submitted for lookup (prevents duplicate requests on re-renders). */
    const processedIds = new Set();

    /** Whether found releases are currently hidden (default) or shown. */
    let isHidden = true;

    // -------------------------------------------------------------------------
    // Styles
    // -------------------------------------------------------------------------

    GM.addStyle(`
        /* Default: hide found cards */
        article.Album.mb-found {
            display: none;
        }

        /* Date groups where every release is found */
        .ReleaseDay.mb-all-found {
            display: none;
        }

        /* Show-found mode: restore found cards only; date sections managed in JS */
        .mb-show-found article.Album.mb-found {
            display: flex;
        }

        /* MusicBrainz pill badge */
        .mb-badge {
            display: inline-block;
            font-size: 0.68em;
            padding: 1px 6px;
            border-radius: 3px;
            font-weight: 700;
            line-height: 1.5;
            vertical-align: middle;
            text-decoration: none;
            white-space: nowrap;
            background: #ba478f;
            color: #fff;
            margin-left: 4px;
        }
        .mb-badge:hover {
            background: #9b3a78;
            color: #fff;
        }
    `);

    /**
     * Ensures the "Show/Hide Found" toggle button exists and is the last child
     * of Header__left. Safe to call on every mutation — appendChild on an
     * already-connected element moves it (no clone), so this self-corrects after
     * React re-inserts native buttons following a refresh or cancel.
     */
    function injectToggle() {
        const headerLeft = document.querySelector('.Header__left');
        if (!headerLeft) return;

        // Only act once the Filter button is present — that signals React has
        // finished rendering all native header controls.
        if (!headerLeft.querySelector('[title^="Toggle Filters"]')) return;

        let btn = document.getElementById('mb-checker-toggle');
        const isNew = !btn;

        if (isNew) {
            btn = document.createElement('button');
            btn.id = 'mb-checker-toggle';
            btn.className = 'button is-rounded has-text-weight-semibold is-dark is-darker button--compact';
            btn.title = 'Toggle visibility of releases already in MusicBrainz';
            // Set initial label to match current isHidden state.
            btn.innerHTML = isHidden
                ? `<span class="icon"><i class="fas fa-eye"></i></span><span>Show Found</span>`
                : `<span class="icon"><i class="fas fa-eye-slash"></i></span><span>Hide Found</span>`;

            btn.addEventListener('click', () => {
                isHidden = !isHidden;
                document.body.classList.toggle('mb-show-found', !isHidden);
                if (!isHidden) {
                    for (const day of document.querySelectorAll('.ReleaseDay.mb-all-found')) {
                        day.classList.remove('mb-all-found');
                    }
                } else {
                    updateReleaseDayCollapse();
                }
                btn.innerHTML = isHidden
                    ? `<span class="icon"><i class="fas fa-eye"></i></span><span>Show Found</span>`
                    : `<span class="icon"><i class="fas fa-eye-slash"></i></span><span>Hide Found</span>`;
            });
        }

        // appendChild moves an already-connected element rather than cloning it —
        // this repositions the button to the end whenever native buttons were
        // re-added after it (e.g. after a canceled refresh).
        if (headerLeft.lastElementChild !== btn) {
            headerLeft.appendChild(btn);
            log(`Toggle button ${isNew ? 'created' : 'repositioned'}`);
        }
    }

    // -------------------------------------------------------------------------
    // DOM helpers
    // -------------------------------------------------------------------------

    /**
     * Extracts the Spotify album ID from an open.spotify.com/album/... URL.
     * @param {string} href
     * @returns {string|null}
     */
    function extractAlbumId(href) {
        const match = href.match(/open\.spotify\.com\/album\/([A-Za-z0-9]+)/);
        return match ? match[1] : null;
    }

    /**
     * Builds the canonical open.spotify.com album URL for a given ID.
     * @param {string} id
     * @returns {string}
     */
    const buildSpotifyUrl = (id) => `https://open.spotify.com/album/${id}`;

    /**
     * Finds all unprocessed album cards currently in the DOM.
     * @returns {{ card: HTMLElement, id: string, spotifyUrl: string }[]}
     */
    function findUnprocessedCards() {
        const cards = [];
        for (const anchor of document.querySelectorAll('a.Album__title[href*="open.spotify.com/album/"]')) {
            const id = extractAlbumId(anchor.href);
            if (!id || processedIds.has(id)) continue;

            const card = anchor.closest('article.Album');
            if (!card) continue;

            cards.push({ card, id, spotifyUrl: buildSpotifyUrl(id) });
        }
        return cards;
    }

    // -------------------------------------------------------------------------
    // MB lookup & card marking
    // -------------------------------------------------------------------------

    /**
     * Marks a card as found in MusicBrainz: fades it and injects an MB link badge.
     * @param {HTMLElement} card
     * @param {string} mbid - MusicBrainz release MBID.
     */
    function markFound(card, mbid) {
        card.classList.add('mb-found');

        const metaRow = card.querySelector('.Album__meta-row');
        if (!metaRow) return;

        const badge = document.createElement('a');
        badge.className = 'mb-badge';
        badge.href = `${MB_BASE}/release/${mbid}`;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.textContent = 'MB \u2197';
        badge.title = 'Open in MusicBrainz';
        metaRow.appendChild(badge);
    }

    /**
     * After marking individual cards, collapses any .ReleaseDay group
     * where every child album is found in MusicBrainz.
     */
    function updateReleaseDayCollapse() {
        for (const day of document.querySelectorAll('.ReleaseDay')) {
            const albums = [...day.querySelectorAll('article.Album')];
            if (albums.length === 0) continue;
            const allFound = albums.every(a => a.classList.contains('mb-found'));
            day.classList.toggle('mb-all-found', allFound);
        }
    }

    /**
     * Collects unprocessed cards, marks them as pending, looks them up
     * in MusicBrainz, then applies visual state to each card.
     */
    async function processNewCards() {
        const items = findUnprocessedCards();
        if (items.length === 0) return;

        // Mark all as in-progress immediately so re-entrant calls don't re-add them.
        for (const { id } of items) {
            processedIds.add(id);
        }

        log(`Looking up ${items.length} album(s) in MusicBrainz\u2026`);

        const spotifyUrls = items.map(({ spotifyUrl }) => spotifyUrl);

        let results;
        try {
            results = await api.lookupUrl(spotifyUrls, ['release-rels']);
        } catch (error) {
            warn('MusicBrainz URL lookup failed:', error);
            return;
        }

        for (const { card, spotifyUrl } of items) {
            const mbData = results.get(spotifyUrl);
            if (!mbData) continue;

            const releaseRel = mbData.relations?.find(r => r['target-type'] === 'release');
            if (!releaseRel?.release?.id) continue;

            markFound(card, releaseRel.release.id);
        }

        updateReleaseDayCollapse();
    }

    // -------------------------------------------------------------------------
    // MutationObserver: watch for new cards rendered by React
    // -------------------------------------------------------------------------

    let pending = false;

    /**
     * Debounced trigger for processNewCards. Coalesces rapid DOM mutations
     * into a single lookup call.
     */
    function scheduleScan() {
        if (pending) return;
        pending = true;
        setTimeout(async () => {
            pending = false;
            await processNewCards();
        }, 400);
    }

    function startObserver() {
        const observer = new MutationObserver((mutations) => {
            // If a refresh is in progress, remove our button and clear the processed set.
            // React will replace all card DOM nodes; clearing processedIds ensures the
            // fresh cards are re-scanned and re-marked once the sync ends or is canceled.
            if (document.querySelector('.SyncButton--syncing')) {
                document.getElementById('mb-checker-toggle')?.remove();
                processedIds.clear();
                return;
            }

            const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
            if (!hasNewNodes) return;
            injectToggle();
            scheduleScan();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
        log('MutationObserver started');
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------

    function init() {
        injectToggle();
        startObserver();
        // Process whatever is already rendered (e.g., demo mode pre-populates the DOM).
        scheduleScan();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
