// ==UserScript==
// @name        Spotify: MusicBrainz importer
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.4.5
// @description Adds buttons for MusicBrainz, ListenBrainz, Harmony, ISRC Hunt and SAMBL to Spotify.
// @tag         ai-created
// @author      chaban, garylaski, RustyNova
// @license     MIT
// @match       *://*.spotify.com/*
// @connect     musicbrainz.org
// @connect     listenbrainz.org

// @icon        https://open.spotify.com/favicon.ico
// @grant       GM.xmlHttpRequest
// @grant       GM.addStyle
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.registerMenuCommand
// @updateURL   https://github.com/chaban-mb/userscripts/raw/dist/src/Spotify%20MusicBrainz%20importer.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/dist/src/Spotify%20MusicBrainz%20importer.user.js
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


    const TokenManager = {
        _token: null,
        async init() {
            this._token = await GM.getValue('listenbrainz_user_token', null);
            GM.registerMenuCommand('Set ListenBrainz Token', this.setToken.bind(this));
        },
        getTokenValue() {
            return this._token;
        },
        async getToken(forcePrompt = false) {
            if (!this._token || forcePrompt) {
                const success = await this.setToken();
                if (!success) {
                    return null;
                }
            }
            return this._token;
        },
        async setToken() {
            const token = prompt('Please enter your ListenBrainz User Token:', this._token || '');
            if (token && token.trim()) {
                this._token = token.trim();
                await GM.setValue('listenbrainz_user_token', this._token);
                alert('ListenBrainz token saved!');
                return true;
            }
            return false;
        }
    };

    class main {
        static SCRIPT_NAME = GM.info.script.name;
        static USER_AGENT = `${main.SCRIPT_NAME}/${GM.info.script.version} ( ${GM.info.script.namespace} )`;
        static SELECTORS = {
            ACTION_BAR: [
                '[data-testid="action-bar-row"]'
            ],
            SORT_BUTTON: 'button[role="combobox"]',
            ARTIST_LINK: [
                '[data-testid="creator-link"]'
            ],
            PAGE_TITLE: [
                '[data-testid="entityTitle"]',
                '.encore-text-headline-large'
            ],
            ALBUM_LINK_ON_TRACK_PAGE: [
                '[data-testid="entityTitle"] ~ div a[href*="/album/"]',
                '[data-testid="track-page"] > div:first-child a[href*="/album/"]'
            ],
        };
        static URLS = {
            MUSICBRAINZ_BASE: 'https://musicbrainz.org',
            HARMONY_BASE: 'https://harmony.pulsewidth.org.uk/release',
            SAMBL_BASE: 'https://sambl.lioncat6.com',
            ISRCHUNT_BASE: 'https://isrchunt.com',
            LISTENBRAINZ_API_BASE: 'https://api.listenbrainz.org/1',
            LISTENBRAINZ_BASE: 'https://listenbrainz.org',
        };

        /**
         * @typedef {Object} PageInfo
         * @property {string} type - The page type (album, artist, track, playlist, unknown).
         * @property {string|null} id - The extracted provider ID.
         */

        /**
         * @typedef {Object} MbInfo
         * @property {string} targetType - The MusicBrainz entity type (release, artist, recording).
         * @property {string} mbid - The matching MusicBrainz ID.
         */

        /**
         * @typedef {Object} LbPlaylistResult
         * @property {number} count - Number of matched playlists.
         * @property {Array<Object>} playlists - Array of ListenBrainz playlist objects.
         */

        /**
         * @typedef {Object} ButtonContext
         * @property {PageInfo} pageInfo - Parsed information about the current Spotify page.
         * @property {string} normalizedUrl - The canonical Spotify URL.
         * @property {number} runId - The execution run ID.
         * @property {boolean} tokenExists - Whether a ListenBrainz user token is set.
         * @property {MbInfo} [mbInfo] - The matched MusicBrainz entity info (if available).
         * @property {LbPlaylistResult} [lbPlaylistResult] - The result of a ListenBrainz playlist search.
         * @property {HTMLElement} [button] - The actual DOM button element.
         */

        /**
         * @typedef {Object} ButtonConfig
         * @property {string} id - HTML ID for the button.
         * @property {string} text - Display text for the button.
         * @property {string} className - CSS class name for styling.
         * @property {string} color - Hex color code for the button background.
         * @property {string[]} pages - Array of page types where this button should appear.
         * @property {boolean} [requiresMbInfo] - If true, waits for MB API response before enabling.
         * @property {boolean} [invalidateCache] - If true, invalidates API cache on click.
         * @property {function(ButtonContext): string|null} getUrl - Generates the target URL.
         * @property {function(ButtonContext): string} [getText] - Dynamic text generator.
         * @property {function(ButtonContext): void} [onClick] - Custom click handler instead of href.
         */

        /** @type {Object<string, ButtonConfig>} */

        static BUTTON_CONFIG = {
            HARMONY: {
                id: 'mb-import-harmony-button', text: 'Import with Harmony', className: 'import-button-harmony', color: '#c45555',
                pages: ['album', 'track'],
                invalidateCache: true,
                getUrl: ({ pageInfo, normalizedUrl }) => {
                    let finalReleaseUrl = null;

                    if (pageInfo.type === 'album') {
                        finalReleaseUrl = normalizedUrl;
                    } else if (pageInfo.type === 'track') {
                        const albumLinkEl = main.querySelectorFromAlternatives(main.SELECTORS.ALBUM_LINK_ON_TRACK_PAGE);
                        if (albumLinkEl?.href) {
                            const albumInfo = main.extractInfoFromUrl(albumLinkEl.href);
                            if (albumInfo.type === 'album' && albumInfo.id) {
                                finalReleaseUrl = `https://open.spotify.com/album/${albumInfo.id}`;
                            }
                        }
                    }

                    if (!finalReleaseUrl) return null;

                    return main.constructUrl(main.URLS.HARMONY_BASE, {
                        gtin: '', category: 'preferred', url: finalReleaseUrl,
                    });
                },
            },
            MUSICBRAINZ: {
                id: 'mb-import-lookup-button', text: 'MusicBrainz', className: 'import-button-open', color: '#BA478F',
                pages: ['album', 'artist', 'track'],
                getText: ({ mbInfo }) => mbInfo ? 'Open in MusicBrainz' : 'Search in MusicBrainz',
                getUrl: ({ mbInfo, pageInfo }) => {
                    if (mbInfo) {
                        return new URL(`${mbInfo.targetType}/${mbInfo.mbid}`, main.URLS.MUSICBRAINZ_BASE);
                    }
                    const { title, artist } = main.getReleaseInfo();
                    if (!title) return null;

                    if (pageInfo.type === 'artist') {
                        return main.constructUrl(`${main.URLS.MUSICBRAINZ_BASE}/search`, { query: title, type: 'artist' });
                    }
                    if (pageInfo.type === 'track') {
                        return main.constructUrl(`${main.URLS.MUSICBRAINZ_BASE}/search`, { query: `recording:"${title}" AND artist:"${artist}"`, type: 'recording', method: 'advanced' });
                    }
                    return main.constructUrl(`${main.URLS.MUSICBRAINZ_BASE}/taglookup/index`, { 'tag-lookup.release': title, 'tag-lookup.artist': artist });
                },
            },
            LISTENBRAINZ: {
                id: 'mb-listenbrainz-button', text: 'Open in ListenBrainz', className: 'import-button-listenbrainz', color: '#5555c4',
                pages: ['artist', 'track', 'album'],
                requiresMbInfo: true,
                getUrl: ({ mbInfo }) => {
                    if (!mbInfo?.mbid) return null;
                    let path;
                    switch (mbInfo.targetType) {
                        case 'artist':
                            path = 'artist';
                            break;
                        case 'recording':
                            path = 'track';
                            break;
                        case 'release':
                            path = 'release';
                            break;
                        default:
                            return null;
                    }
                    return new URL(`${path}/${mbInfo.mbid}/`, main.URLS.LISTENBRAINZ_BASE);
                },
            },
            SAMBL: {
                id: 'sambl-button', text: 'Open in SAMBL', className: 'import-button-sambl', color: '#1DB954',
                pages: ['artist'],
                getUrl: ({ mbInfo, pageInfo }) => {
                    if (!pageInfo.id) return null;
                    const isMbidFound = mbInfo?.targetType === 'artist';
                    return isMbidFound
                        ? main.constructUrl(`${main.URLS.SAMBL_BASE}/artist`, { provider_id: pageInfo.id, provider: 'spotify', artist_mbid: mbInfo.mbid })
                        : main.constructUrl(`${main.URLS.SAMBL_BASE}/newartist`, { provider_id: pageInfo.id, provider: 'spotify' });
                },
            },
            ISRCHUNT: {
                id: 'isrc-hunt-button', text: 'Open in ISRC Hunt', className: 'import-button-isrc-hunt', color: '#3B82F6',
                pages: ['playlist'],
                getUrl: ({ normalizedUrl }) => main.constructUrl(main.URLS.ISRCHUNT_BASE, {
                    spotifyPlaylist: normalizedUrl,
                }),
            },
            LISTENBRAINZ_IMPORT_PLAYLIST: {
                id: 'lb-playlist-import-button', text: 'ListenBrainz Playlist', className: 'import-button-listenbrainz', color: '#5555c4',
                pages: ['playlist'],
                getText: ({ lbPlaylistResult, tokenExists }) => {
                    if (!tokenExists) return 'Set LB Token';
                    if (lbPlaylistResult.count === 1) return 'Open in ListenBrainz';
                    if (lbPlaylistResult.count > 1) return 'Find in ListenBrainz';
                    return 'Import to ListenBrainz';
                },
                getUrl: ({ normalizedUrl, lbPlaylistResult }) => {
                    if (lbPlaylistResult.count === 1) {
                        return new URL(lbPlaylistResult.playlists[0].playlist.identifier);
                    }
                    if (lbPlaylistResult.count > 1) {
                        const { title } = main.getReleaseInfo();
                        return main.constructUrl(`${main.URLS.LISTENBRAINZ_BASE}/search`, {
                            search_term: title,
                            search_type: 'playlist'
                        });
                    }
                    return null;
                },
                onClick: async function (context) {
                    const { lbPlaylistResult, button, tokenExists } = context;
                    if (!tokenExists) {
                        const token = await TokenManager.getToken(true);
                        if (token) document.getElementById('mb-script-button-container')?.dispatchEvent(new Event('mb-button-update'));
                        return;
                    }

                    if (lbPlaylistResult.count === 0) {
                        main.setButtonLoading(button, true);
                        try {
                            const importSuccessful = await this.#importSpotifyPlaylist(context);
                            if (importSuccessful) {
                                document.getElementById('mb-script-button-container')?.dispatchEvent(new Event('mb-button-update'));
                            }
                        } catch (error) {
                            console.error('Spotify import failed:', error);
                            main.setButtonText(button, 'Import Failed');
                            button.classList.add('import-button-error');
                            main.setButtonLoading(button, false);
                        }
                    }
                },
            },
        };

        #urlCache = new Map();
        #currentUrl = '';
        #observer = null;
        #debounceTimer = null;
        #buttonContainer = null;
        #runId = 0;
        #mbApi = null;

        constructor() {
            TokenManager.init();
            this.#mbApi = new MusicBrainzAPI({ user_agent: main.USER_AGENT });
            this.#addStyles();
            this.#currentUrl = location.href;
            this.#initializeObserver();
            this.#run();
        }

        #initializeObserver() {
            this.#observer = new MutationObserver(() => {
                if (location.href !== this.#currentUrl) {
                    this.#currentUrl = location.href;
                    clearTimeout(this.#debounceTimer);
                    this.#debounceTimer = setTimeout(() => this.#run(), 250);
                }
            });
            this.#observer.observe(document.body, { childList: true, subtree: true });
        }

        /**
         * @summary Executes the core DOM injection and API fetching logic for the current page.
         * Runs automatically on load or mutation debounces.
         */
        async #run() {
            const runId = ++this.#runId;
            const urlForThisRun = location.href;
            console.debug(`${main.SCRIPT_NAME}: Starting run #${runId} for ${urlForThisRun}`);
            this.#cleanup();

            const pageInfo = main.extractInfoFromUrl(urlForThisRun);
            const supportedPages = [...new Set(Object.values(main.BUTTON_CONFIG).flatMap(config => config.pages))];

            if (!supportedPages.includes(pageInfo.type)) {
                return;
            }

            try {
                const actionBar = await main.waitForElement(main.SELECTORS.ACTION_BAR, 5000);
                this.#createButtonContainer(actionBar);

                this.#setupButtonsInLoadingState(pageInfo);

                const normalizedUrl = main.normalizeUrl(urlForThisRun);
                const tokenExists = !!TokenManager.getTokenValue();
                const initialContext = { pageInfo, normalizedUrl, tokenExists, runId };

                this.#updateButtonsWithData(initialContext);

                const needsMbInfo = Object.values(main.BUTTON_CONFIG).some(config => config.pages.includes(pageInfo.type) && config.requiresMbInfo);

                if (needsMbInfo) {
                    this.#fetchMusicBrainzInfo(urlForThisRun, pageInfo).then(mbInfo => {
                        if (this.#runId !== runId) return;
                        this.#updateButtonsWithData({ ...initialContext, mbInfo });
                    });
                }

                if (pageInfo.type === 'playlist') {
                    this.#findListenBrainzPlaylist(normalizedUrl).then(lbPlaylistResult => {
                        if (this.#runId !== runId) return;
                        this.#updateButtonsWithData({ ...initialContext, lbPlaylistResult });
                    });
                }

            } catch (error) {
                if (this.#runId !== runId) {
                    console.debug(`${main.SCRIPT_NAME}: Suppressing error from obsolete run #${runId}.`);
                    return;
                }
                console.error(`${main.SCRIPT_NAME}: Failed to initialize buttons for run #${runId}.`, error);
            }
        }

        #setupButtonsInLoadingState(pageInfo) {
            for (const config of Object.values(main.BUTTON_CONFIG)) {
                if (config.pages.includes(pageInfo.type)) {
                    const button = this.#createOrUpdateButton(config);
                    const needsLoading = config.requiresMbInfo || config.id === 'mb-import-lookup-button' || config.id === 'lb-playlist-import-button';
                    if (needsLoading) {
                        main.setButtonLoading(button, true);
                    }
                }
            }
        }

        #updateButtonsWithData(context) {
            for (const config of Object.values(main.BUTTON_CONFIG)) {
                const canSetUp =
                    (!config.requiresMbInfo || context.mbInfo !== undefined) &&
                    (config.id !== 'lb-playlist-import-button' || context.lbPlaylistResult !== undefined);

                if (config.pages.includes(context.pageInfo.type) && canSetUp) {
                    this.#setupButtonFromConfig(config, context);
                }
            }
        }

        #setupButtonFromConfig(config, context) {
            const { pageInfo, mbInfo } = context;
            const button = document.getElementById(config.id);
            if (!button) return;

            if (config.requiresMbInfo && !mbInfo) {
                button.classList.add('disabled');
                main.setButtonLoading(button, false);
                return;
            };

            context.button = button;

            if (config.getText) {
                main.setButtonText(button, config.getText(context));
            }

            const url = config.getUrl(context);
            main.setButtonLoading(button, false);

            if (url) {
                button.href = url.toString();
                button.classList.remove('disabled');
                if (config.invalidateCache) {
                    button.addEventListener('click', () => {
                        this.#mbApi.invalidateCacheForUrl(context.normalizedUrl);
                    });
                }
            } else if (config.onClick) {
                const newButton = button.cloneNode(true);
                button.parentNode.replaceChild(newButton, button);
                newButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    config.onClick.call(this, { ...context, button: newButton });
                });
                newButton.classList.remove('disabled');
            } else {
                button.classList.add('disabled');
            }
        }

        #createButtonContainer(actionBar) {
            this.#buttonContainer = document.createElement('div');
            this.#buttonContainer.id = 'mb-script-button-container';
            this.#buttonContainer.addEventListener('mb-button-update', () => this.#run());

            const sortButton = actionBar.querySelector(main.SELECTORS.SORT_BUTTON);
            if (sortButton) {
                sortButton.parentElement.before(this.#buttonContainer);
            } else {
                actionBar.appendChild(this.#buttonContainer);
            }
        }

        #createOrUpdateButton(config) {
            if (!this.#buttonContainer) return null;
            let button = document.getElementById(config.id);
            if (!button) {
                button = document.createElement("a");
                button.id = config.id;
                button.target = '_blank';
                button.rel = 'noopener noreferrer';
                this.#buttonContainer.appendChild(button);
            }
            button.className = `import-button ${config.className}`;
            button.removeAttribute('href');
            button.classList.remove('disabled', 'loading');

            const textSpan = document.createElement('span');
            textSpan.textContent = config.text;
            button.textContent = '';
            button.appendChild(textSpan);

            const needsLoading = config.id === 'mb-import-lookup-button' || config.requiresMbInfo;
            if (needsLoading) {
                main.setButtonLoading(button, true);
            }

            return button;
        }

        /**
         * @summary Searches ListenBrainz to check if a Spotify playlist has already been imported.
         * @param {string} spotifyUrl - The canonical Spotify playlist URL.
         * @returns {Promise<LbPlaylistResult>} An object containing the search results.
         */
        async #findListenBrainzPlaylist(spotifyUrl) {
            const cacheKey = `lb-playlist-search-${spotifyUrl}`;
            if (this.#urlCache.has(cacheKey)) {
                return this.#urlCache.get(cacheKey);
            }

            const result = { count: 0, playlists: [] };
            try {
                const playlistId = spotifyUrl.split('/').pop();
                const searchUrl = main.constructUrl(`${main.URLS.LISTENBRAINZ_API_BASE}/playlist/search`, {
                    query: playlistId,
                });

                const res = await main.gmXmlHttpRequest({ url: searchUrl.toString(), method: 'GET', responseType: 'json' });

                if (res.status === 200 && res.response?.playlists?.length > 0) {
                    const perfectMatches = res.response.playlists.filter(p => p.playlist.annotation === spotifyUrl);
                    result.count = perfectMatches.length;
                    result.playlists = perfectMatches;
                }
            } catch (error) {
                console.error(`${main.SCRIPT_NAME}: ListenBrainz playlist search failed for ${spotifyUrl}`, error);
            }

            this.#urlCache.set(cacheKey, result);
            return result;
        }

        /**
         * @summary Triggers a remote playlist import job on the ListenBrainz server.
         * @param {ButtonContext} context - The current button execution context.
         * @returns {Promise<boolean|null>} True if successful, or null if no token exists.
         */
        async #importSpotifyPlaylist({ pageInfo, normalizedUrl, button }) {
            const token = await TokenManager.getToken();
            if (!token) {
                main.setButtonLoading(button, false);
                return null;
            }

            main.setButtonText(button, 'Importing...');
            const importUrl = main.constructUrl(`${main.URLS.LISTENBRAINZ_API_BASE}/playlist/spotify/${pageInfo.id}/tracks`, {});
            const importRes = await main.gmXmlHttpRequest({
                method: 'GET', url: importUrl.toString(),
                headers: { 'Authorization': `Token ${token}` },
                responseType: 'json'
            });

            if (importRes.status !== 200) throw new Error(`Import failed: ${importRes.status}`);

            const importedPlaylist = importRes.response.playlist;
            const newMbid = importRes.response.identifier;

            main.setButtonText(button, 'Annotating...');
            const editUrl = main.constructUrl(`${main.URLS.LISTENBRAINZ_API_BASE}/playlist/edit/${newMbid}`, {});

            const jspfPayload = {
                playlist: {
                    title: importedPlaylist.title,
                    annotation: normalizedUrl,
                    extension: {
                        'https://musicbrainz.org/doc/jspf#playlist': {
                            public: importedPlaylist.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.public ?? true
                        }
                    }
                }
            };

            const editRes = await main.gmXmlHttpRequest({
                method: 'POST', url: editUrl.toString(),
                headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
                data: JSON.stringify(jspfPayload),
                responseType: 'json'
            });

            if (editRes.status !== 200) throw new Error(`Annotation failed: ${editRes.status}`);

            const { title } = main.getReleaseInfo();
            const fakeResult = {
                count: 1,
                playlists: [{
                    playlist: {
                        identifier: `${main.URLS.LISTENBRAINZ_BASE}/playlist/${newMbid}`,
                        annotation: normalizedUrl,
                        title: title,
                    }
                }]
            };
            const cacheKey = `lb-playlist-search-${normalizedUrl}`;
            this.#urlCache.set(cacheKey, fakeResult);

            console.log(`${main.SCRIPT_NAME}: Successfully imported and annotated playlist ${newMbid}. Cache updated.`);
            return newMbid;
        }

        #cleanup() {
            document.getElementById('mb-script-button-container')?.remove();
            this.#buttonContainer = null;
        }

        #addStyles() {
            const staticStyles = `
                #mb-script-button-container { display: flex; align-items: center; margin-left: 8px; }
                .import-button {
                    border-radius: 4px; border: none; padding: 8px 12px; font-size: 0.9em; font-weight: 700; color: white;
                    cursor: pointer; margin: 0 4px; transition: all 0.2s ease; position: relative;
                }
                .import-button:focus { text-decoration: none !important; }
                .import-button:hover:not(.disabled) { filter: brightness(1.1); transform: scale(1.05); text-decoration: none; }
                .import-button.disabled { opacity: 0.7; cursor: not-allowed; pointer-events: none; }
                .import-button.loading span { visibility: hidden; }
                .import-button.loading::after {
                    content: ''; position: absolute; top: 50%; left: 50%;
                    width: 16px; height: 16px; transform: translate(-50%, -50%);
                    border: 2px solid rgba(255, 255, 255, 0.5); border-top-color: white;
                    border-radius: 50%; animation: spin 0.8s linear infinite;
                }
                .import-button-error { background-color: #cc0000 !important; }
                @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
            `;

            const dynamicStyles = main.generateDynamicStyles();
            GM.addStyle(staticStyles + dynamicStyles);
        }

        /**
         * @summary Fetches entity relationships from MusicBrainz API to find corresponding MBIDs for the current Spotify URL.
         * @param {string} url - The current Spotify URL to look up.
         * @param {PageInfo} pageInfo - The parsed page information to determine query type.
         * @returns {Promise<MbInfo|null>} The MBID and entity type, or null if not found.
         */
        async #fetchMusicBrainzInfo(url, pageInfo) {
            console.debug(`%c[${main.SCRIPT_NAME}] #fetchMusicBrainzInfo`, 'color: blue; font-weight: bold;', { url, pageInfo });
            const normalizedUrl = main.normalizeUrl(url);

            const incMap = {
                album: 'release-rels',
                artist: 'artist-rels',
                track: 'recording-rels',
            };
            const inc = incMap[pageInfo.type];

            const spotifyToMbType = {
                album: 'release',
                artist: 'artist',
                track: 'recording',
            };
            const expectedMbType = spotifyToMbType[pageInfo.type];
            console.debug(`[${main.SCRIPT_NAME}] Expected MB Type: ${expectedMbType}`);

            try {
                // The API module returns a single object for a single URL lookup
                const urlData = await this.#mbApi.lookupUrl(normalizedUrl, [inc]);
                console.debug(`[${main.SCRIPT_NAME}] API Response:`, urlData);

                if (!urlData || !Array.isArray(urlData.relations) || urlData.relations.length === 0) {
                    console.debug(`[${main.SCRIPT_NAME}] No relations found in API response.`);
                    return null;
                }

                // Find the specific relation that matches our expected entity type
                const relation = urlData.relations.find(rel =>
                    rel['target-type'] === expectedMbType && rel[expectedMbType]
                );
                console.debug(`[${main.SCRIPT_NAME}] Found matching relation:`, relation);

                if (!relation) {
                    console.debug(`[${main.SCRIPT_NAME}] No relation found for expected type '${expectedMbType}'.`);
                    return null;
                }

                const mbid = relation[expectedMbType].id;
                if (!mbid) {
                    console.warn(`[${main.SCRIPT_NAME}] Relation found, but MBID is missing.`);
                    return null;
                }

                const result = {
                    targetType: expectedMbType,
                    mbid: mbid
                };
                console.debug(`[${main.SCRIPT_NAME}] Successfully parsed result:`, result);
                return result;

            } catch (error) {
                // The API module might throw a PermanentError for 404s, which is expected.
                if (!error.message || !error.message.includes('404')) {
                    console.error(`${main.SCRIPT_NAME}: MB API request failed for ${normalizedUrl}`, error);
                } else {
                    console.debug(`[${main.SCRIPT_NAME}] API returned 404 (Not Found) for ${normalizedUrl}, as expected for an unlinked entity.`);
                }
                return null;
            }
        }

        static setButtonLoading(button, isLoading) {
            if (!button) return;
            button.classList.toggle('loading', isLoading);
            if (isLoading) {
                button.classList.add('disabled');
            }
        }

        static setButtonText(button, text) {
            const span = button.querySelector('span');
            if (span) span.textContent = text;
        }

        static getReleaseInfo() {
            const titleEl = main.querySelectorFromAlternatives(this.SELECTORS.PAGE_TITLE);
            const artistEl = main.querySelectorFromAlternatives(this.SELECTORS.ARTIST_LINK);
            const title = titleEl?.textContent.trim() || '';
            const artist = this.extractInfoFromUrl(location.href).type !== 'artist' ? (artistEl?.textContent.trim() || '') : '';
            return { title, artist };
        }

        static querySelectorFromAlternatives(selectors) {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) return element;
            }
            return null;
        }

        static constructUrl(base, params) {
            const url = new URL(base);
            for (const key in params) {
                if (params[key]) url.searchParams.set(key, params[key]);
            }
            return url;
        }

        static normalizeUrl(url) {
            const { type, id } = this.extractInfoFromUrl(url);
            return (type !== 'unknown' && id) ? `https://open.spotify.com/${type}/${id}` : url;
        }

        static extractInfoFromUrl(url) {
            const match = url.match(/(?:https?:\/\/)?(?:play|open)\.spotify\.com\/(?:intl-[a-z]{2,}(?:-[A-Z]{2,})?\/)?(\w+)\/([a-zA-Z0-9]+)/);
            return { type: match?.[1] || 'unknown', id: match?.[2] || null };
        }

        static gmXmlHttpRequest(options) {
            const headers = {
                'User-Agent': main.USER_AGENT,
                ...options.headers
            };
            return new Promise((resolve, reject) => GM.xmlHttpRequest({ ...options, headers, onload: resolve, onerror: reject, onabort: reject }));
        }

        static generateDynamicStyles() {
            return Object.values(this.BUTTON_CONFIG).map(config =>
                `.${config.className} { background-color: ${config.color}; }`
            ).join('\n');
        }

        static waitForElement(selectors, timeout = 10000) {
            return new Promise((resolve, reject) => {
                const element = main.querySelectorFromAlternatives(selectors);
                if (element) return resolve(element);
                const observer = new MutationObserver(() => {
                    const el = main.querySelectorFromAlternatives(selectors);
                    if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
                });
                const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout waiting for selectors: ${selectors.join(', ')}`)); }, timeout);
                observer.observe(document.body, { childList: true, subtree: true });
            });
        }
    }

    new main();
})();