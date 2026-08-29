// ==UserScript==
// @name        Spotify Release List: MusicBrainz Checker
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.0.3
// @description Checks releases on Spotify Release List instances against MusicBrainz. Fades or hides found releases and collapses date groups where everything is catalogued.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       https://spotifyreleaselist.netlify.app/*
// @match       https://*.spotifyreleaselist.netlify.app/*
// @match       https://spotifylist.mybrainz.dev/*
// @connect     musicbrainz.org

// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       GM.xmlHttpRequest
// @grant       GM.addStyle
// @updateURL   https://github.com/chaban-mb/userscripts/raw/dist/src/Spotify%20Release%20List%20MusicBrainz%20Checker.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/dist/src/Spotify%20Release%20List%20MusicBrainz%20Checker.user.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Inlined Library: lib/MusicBrainzAPI.js ---
/**
 * @typedef {Object} MbEntity
 * @property {string} id - The MusicBrainz ID (UUID) of the entity.
 * @property {string} [name] - The name of the entity (e.g. for artists or labels).
 * @property {string} [title] - The title of the entity (e.g. for releases or works).
 */

/**
 * @typedef {Object} MbRelation
 * @property {string} type - The relationship type name (e.g., 'purchase for download').
 * @property {string} type-id - The relationship type UUID.
 * @property {string} direction - The orientation of the relationship ('forward' or 'backward').
 * @property {string} target-type - Target entity type name ('artist', 'label', 'release', etc).
 * @property {MbEntity} [artist] - Artist details if target-type is 'artist'.
 * @property {MbEntity} [label] - Label details if target-type is 'label'.
 * @property {MbEntity} [release] - Release details if target-type is 'release'.
 * @property {MbEntity} [recording] - Recording details if target-type is 'recording'.
 * @property {MbEntity} [url] - URL details if target-type is 'url'.
 */

/**
 * @typedef {Object} MbUrlLookupResponse
 * @property {string} id - The entity MBID.
 * @property {string} resource - The lookup URL resource string.
 * @property {MbRelation[]} relations - Array of relationships resolved for the URL.
 */

class MusicBrainzAPI {
    /**
     * @summary Creates an instance of the MusicBrainz API client.
     * @param {Object} [options={}] - Custom options for configuration.
     * @param {string} [options.base_url] - Alternate base endpoint for the Web Service.
     * @param {string} [options.user_agent] - User Agent header identification string.
     * @param {number} [options.max_retries=5] - Maximum retry attempts for failed requests.
     * @param {number} [options.batch_size=100] - URL batch chunk size.
     * @param {number} [options.timeout=15000] - Timeout per network request in milliseconds.
     */
    constructor(options = {}) {
        let defaultOrigin = 'https://musicbrainz.org';

        if (/(musicbrainz\.(org|eu))$/i.test(window.location.hostname)) {
            defaultOrigin = window.location.origin;
        }

        this.base_url = options.base_url || `${defaultOrigin}/ws/2`;
        this.user_agent = options.user_agent || `UserJS.MusicBrainzAPI/0.2.2 ( https://musicbrainz.org/user/chaban )`;
        this.rate_limit_delay = 1000;
        this.max_retries = options.max_retries || 5;
        this.batch_size = options.batch_size || 100;
        this.timeout = options.timeout || 15000;
        this.cache = new Map();
        this.next_available_request_time = 0;
    }

    _parseHeaders(headerStr) {
        const headers = {};
        if (!headerStr) {
            return headers;
        }
        const headerPairs = headerStr.split('\u000d\u000a');
        for (const headerPair of headerPairs) {
            const index = headerPair.indexOf('\u003a\u0020');
            if (index > 0) {
                const key = headerPair.substring(0, index).toLowerCase();
                const value = headerPair.substring(index + 2);
                headers[key] = value;
            }
        }
        return headers;
    }

    /**
     * @summary Internal low-level fetch request runner with retry handling.
     * @param {string} endpoint - API resource endpoint.
     * @param {Object} [params={}] - Search parameters.
     * @param {Object|null} [tracker=null] - Optional diagnostic statistics tracker.
     * @returns {Promise<Object>} The JSON parsed response body.
     * @private
     */
    async _request(endpoint, params = {}, tracker = null) {
        if (tracker) {
            tracker.requests++;
        }
        const url = new URL(`${this.base_url}/${endpoint}`);
        params.fmt = 'json';
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                for (const v of value) {
                    if (v !== undefined && v !== '') {
                        url.searchParams.append(key, v);
                    }
                }
            } else if (value !== undefined && value !== '') {
                url.searchParams.append(key, value);
            }
        }

        for (let i = 0; i < this.max_retries; i++) {
            const now = Date.now();
            const waitTime = this.next_available_request_time - now;
            if (waitTime > 0) {
                if (tracker) tracker.rateLimitWaitMs += waitTime;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            const reqStartTime = Date.now();
            try {
                const response = await new Promise((resolve, reject) => {
                    GM.xmlHttpRequest({
                        method: 'GET',
                        url: url.toString(),
                        timeout: this.timeout,
                        headers: {
                            'User-Agent': this.user_agent,
                            'Accept': 'application/json',
                            'Origin': location.origin,
                        },
                        anonymous: true,
                        onload: (res) => {
                            if (tracker) {
                                tracker.networkDurationMs += (Date.now() - reqStartTime);
                            }
                            const responseTime = Date.now();
                            const headers = this._parseHeaders(res.responseHeaders);
                            const rateLimitReset = parseInt(headers['x-ratelimit-reset'], 10) * 1000;
                            const rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10);
                            const retryAfterSeconds = parseInt(headers['retry-after'], 10);

                            if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
                                this.next_available_request_time = responseTime + (retryAfterSeconds * 1000);
                            } else if (!isNaN(rateLimitReset) && rateLimitRemaining === 0) {
                                this.next_available_request_time = rateLimitReset;
                            } else {
                                this.next_available_request_time = responseTime + this.rate_limit_delay;
                            }

                            if (res.status >= 200 && res.status < 300) {
                                resolve(JSON.parse(res.responseText));
                            } else if (res.status === 503) {
                                reject(new Error('503 Service Unavailable (rate limit or server overloaded)'));
                            } else {
                                const isPermanent = res.status >= 400 && res.status < 500;
                                const error = isPermanent
                                    ? new PermanentError(`HTTP Error ${res.status}: ${res.statusText}`, res.status)
                                    : new Error(`HTTP Error ${res.status}: ${res.statusText}`);
                                error.status = res.status;
                                reject(error);
                            }
                        },
                        onerror: (err) => {
                            if (tracker) {
                                tracker.networkDurationMs += (Date.now() - reqStartTime);
                            }
                            this.next_available_request_time = Date.now() + 5000;
                            reject(new Error('Network error'));
                        },
                        ontimeout: () => {
                            if (tracker) {
                                tracker.networkDurationMs += (Date.now() - reqStartTime);
                            }
                            this.next_available_request_time = Date.now() + 5000;
                            reject(new Error('Request timed out'));
                        },
                    });
                });

                return response;
            } catch (error) {
                if (error instanceof PermanentError) {
                    throw error; // Stop retrying and propagate the error.
                }

                if (tracker) {
                    tracker.retries++;
                    tracker.errors.push(`Attempt ${i + 1}/${this.max_retries} failed: ${error.message}`);
                }

                if (!navigator.onLine) {
                    console.log(`[MusicBrainzAPI] Offline detected. Waiting for network...`);
                    await new Promise(resolve => {
                        const handler = () => {
                            window.removeEventListener('online', handler);
                            resolve();
                        };
                        window.addEventListener('online', handler);
                    });
                    i--; // Don't count this attempt
                    continue;
                }

                if (i === this.max_retries - 1) throw error;
                const delay = this.rate_limit_delay * Math.pow(2, i);
                if (tracker) {
                    tracker.retryBackoffWaitMs += delay;
                }
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    /**
     * @summary Normalizes a URL string to its canonical WHATWG/RFC 3986 format.
     * @param {string} url - The URL string to normalize.
     * @returns {string} The normalized URL string.
     */
    static normalizeUrl(url) {
        if (!url) return url;
        try {
            return new URL(url).href;
        } catch {
            return url;
        }
    }

    /**
     * @summary Looks up MBIDs for MusicBrainz resource URLs. Supports batching.
     * @param {string|string[]} urls - A single URL or an array of URLs to resolve.
     * @param {string[]} [inc=[]] - Relationships to include in the lookup query.
     * @returns {Promise<Map<string, MbUrlLookupResponse|null>|MbUrlLookupResponse|null>} A Map mapping URLs to relationship response objects if urls was an array, or the relationship response object if urls was a string.
     */
    async lookupUrl(urls, inc = []) {
        const isInputArray = Array.isArray(urls);
        const rawUrls = isInputArray ? urls : [urls];
        const normalizedUrls = rawUrls.map(u => MusicBrainzAPI.normalizeUrl(u));
        const urlArray = isInputArray ? [...new Set(normalizedUrls)] : normalizedUrls;

        if (urlArray.length === 0) {
            return isInputArray ? {} : null;
        }

        const results = new Map();
        const uncachedUrls = [];

        for (const url of urlArray) {
            if (this.cache.has(url)) {
                results.set(url, this.cache.get(url));
            } else {
                uncachedUrls.push(url);
            }
        }

        const diagnostics = {
            requests: 0,
            retries: 0,
            rateLimitWaitMs: 0,
            retryBackoffWaitMs: 0,
            networkDurationMs: 0,
            errors: []
        };

        if (uncachedUrls.length > 0) {
            const urlChunks = [];
            for (let i = 0; i < uncachedUrls.length; i += this.batch_size) {
                urlChunks.push(uncachedUrls.slice(i, i + this.batch_size));
            }

            const promises = urlChunks.map(chunk =>
                this._request('url', {
                    resource: chunk,
                    inc: inc.join('+')
                }, diagnostics)
            );

            // Use Promise.allSettled to ensure all batches are processed, even if some fail.
            const settledResults = await Promise.allSettled(promises);

            settledResults.forEach((result, index) => {
                const chunk = urlChunks[index]; // Get the corresponding chunk of URLs for this result.

                if (result.status === 'fulfilled') {
                    const response = result.value;

                    // The API returns a single object for a 1-item request, and an object with a `urls` array for multi-item requests.
                    if (chunk.length === 1) {
                        const url = chunk[0];
                        const mbData = response && MusicBrainzAPI.normalizeUrl(response.resource) === url ? response : null;
                        this.cache.set(url, mbData);
                        results.set(url, mbData);
                    } else {
                        const responseMap = new Map(response.urls?.map(u => [MusicBrainzAPI.normalizeUrl(u.resource), u]) || []);
                        for (const url of chunk) {
                            const mbData = responseMap.get(url) || null;
                            this.cache.set(url, mbData);
                            results.set(url, mbData);
                        }
                    }
                } else { // status === 'rejected'
                    const is404 = result.reason && result.reason.status === 404;
                    if (!is404) {
                        console.error(`MusicBrainz API batch lookup failed for chunk starting with ${chunk[0]}`, result.reason);
                    }

                    // Only cache as null if it's a permanent error (like 404), not for network errors
                    const isPermanent = result.reason && result.reason.name === 'PermanentError';

                    for (const url of chunk) {
                        if (isPermanent) {
                            this.cache.set(url, null);
                        }
                        results.set(url, null);
                    }
                }
            });
        }

        results.diagnostics = diagnostics;
        results.sources = new Map(
            urlArray.map(url => [url, uncachedUrls.includes(url) ? 'network' : 'cache'])
        );

        return isInputArray ? results : results.get(urlArray[0]);
    }

    /**
     * @summary Searches the MusicBrainz database for matching entities.
     * @param {string} entity - Entity type (artist, release, recording, etc).
     * @param {string} query - The search query parameter.
     * @param {number} [limit=100] - Result page chunk limit.
     * @param {string[]} [inc=[]] - Relationships to include in each search.
     * @param {boolean} [fetch_all=false] - Whether to fetch all pages sequentially.
     * @returns {Promise<Object|MbEntity[]>} Parsed query result object (or list of entities if fetch_all is true).
     */
    async search(entity, query, limit = 100, inc = [], fetch_all = false) {
        if (!fetch_all) {
            return this._request(entity, { query, limit, inc: inc.join('+') });
        }

        let results = [];
        let offset = 0;
        let total;

        do {
            const data = await this._request(entity, { query, limit, offset, inc: inc.join('+') });
            const entities = data[entity + 's'] || [];
            results.push(...entities);
            total = data.count;
            offset += entities.length;
            if (entities.length === 0) break;
        } while (offset < total);

        return results;
    }

    /**
     * Fetches details for a specific MusicBrainz entity by its MBID.
     * @param {string} entity - The entity type (e.g., 'release', 'artist', 'recording').
     * @param {string} mbid - The MusicBrainz Identifier (MBID) of the entity.
     * @param {string[]} [inc=[]] - Array of sub-queries/relationships to include (e.g., ['recordings', 'artists', 'url-rels']).
     * @returns {Promise<object>} A promise that resolves to the entity details object.
     */
    get(entity, mbid, inc = []) {
        return this._request(`${entity}/${mbid}`, { inc: inc.join('+') });
    }

    clearCache() {
        this.cache.clear();
    }

    invalidateCacheForUrl(url) {
        const urls = Array.isArray(url) ? url : [url];
        urls.forEach(u => this.cache.delete(MusicBrainzAPI.normalizeUrl(u)));
    }

    /**
     * Synchronously retrieves a value from the cache if available.
     * @param {string} url - The URL to check.
     * @returns {object|undefined} The cached response or undefined if not cached.
     */
    getFromCache(url) {
        return this.cache.get(MusicBrainzAPI.normalizeUrl(url));
    }
}

class PermanentError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'PermanentError';
        this.status = status;
    }
}
    // --- End Inlined Library ---


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
