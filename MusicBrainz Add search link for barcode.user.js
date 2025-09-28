// ==UserScript==
// @name        MusicBrainz: Add search link for barcode
// @namespace   https://musicbrainz.org/user/chaban
// @description Searches for existing releases in "Add release" edits by barcode, highlights and adds a search link on match
// @version     3.1.1
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://*.musicbrainz.org/edit/*
// @match       *://*.musicbrainz.org/search/edits*
// @match       *://*.musicbrainz.org/*/*/edits
// @match       *://*.musicbrainz.org/*/*/open_edits
// @match       *://*.musicbrainz.org/user/*/edits*
// @connect     musicbrainz.org
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    /**
     * Configuration object to centralize all constants and settings.
     */
    const Config = {
        BARCODE_REGEX: /(\b\d{8,14}\b)/g,
        TARGET_SELECTOR: '.add-release',
        API_BASE_URL: 'https://musicbrainz.org/ws/2/release/',
        MAX_RETRIES: 5,
        SHORT_APP_NAME: 'UserJS.BarcodeLink',
        USER_AGENT: '',
        SEARCH_LINK_CLASS: 'mb-barcode-search-link',
        PROCESSED_BARCODE_SPAN_CLASS: 'mb-barcode-processed',
    };

    /**
     * Utility functions.
     */
    const Utils = {
        /**
         * Pauses execution for a given number of milliseconds.
         * @param {number} ms - The number of milliseconds to sleep.
         * @returns {Promise<void>} A promise that resolves after the specified delay.
         */
        delay: function(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        /**
         * Parses raw response headers string into a simple object.
         * @param {string} headerStr - The raw headers string.
         * @returns {Object} An object mapping header names to their values.
         */
        parseHeaders: function(headerStr) {
            const headers = {};
            if (!headerStr) return headers;
            headerStr.split('\n').forEach(line => {
                const parts = line.split(':');
                if (parts.length > 1) {
                    const key = parts[0].trim().toLowerCase();
                    const value = parts.slice(1).join(':').trim();
                    headers[key] = value;
                }
            });
            return headers;
        }
    };

    /**
     * Handles all interactions with the MusicBrainz API, including rate limiting, retries, and pagination.
     */
    const MusicBrainzAPI = {
        _lastRequestFinishedTime: 0,
        _nextAvailableRequestTime: 0,

        /**
         * Sends a single GM_xmlhttpRequest to the MusicBrainz API.
         * Handles response parsing and updates global rate limiting state.
         * @param {string} url - The full URL for the API request.
         * @returns {Promise<Object>} - Resolves with parsed JSON data, rejects on error or malformed response.
         */
        _sendHttpRequest: function(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: {
                        'User-Agent': Config.USER_AGENT,
                        'Accept': 'application/json'
                    },
                    onload: (res) => {
                        this._lastRequestFinishedTime = Date.now();

                        const headers = Utils.parseHeaders(res.responseHeaders);
                        const rateLimitReset = parseInt(headers['x-ratelimit-reset'], 10) * 1000;
                        const rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10);
                        const retryAfterSeconds = parseInt(headers['retry-after'], 10);
                        const rateLimitZone = headers['x-ratelimit-zone'];

                        if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
                            this._nextAvailableRequestTime = this._lastRequestFinishedTime + (retryAfterSeconds * 1000);
                            console.warn(`[${GM.info.script.name}] Server requested Retry-After: ${retryAfterSeconds}s. Next request delayed until ${new Date(this._nextAvailableRequestTime).toLocaleTimeString()}.`);
                        } else if (!isNaN(rateLimitReset) && rateLimitRemaining === 0) {
                            this._nextAvailableRequestTime = rateLimitReset;
                            console.warn(`[${GM.info.script.name}] Rate limit exhausted for zone "${rateLimitZone}". Next request delayed until ${new Date(this._nextAvailableRequestTime).toLocaleTimeString()}.`);
                        } else if (res.status === 503) {
                            this._nextAvailableRequestTime = this._lastRequestFinishedTime + 5000;
                            console.warn(`[${GM.info.script.name}] 503 Service Unavailable. Defaulting to 5s delay.`);
                        } else {
                            this._nextAvailableRequestTime = Math.max(this._nextAvailableRequestTime, this._lastRequestFinishedTime + 1000);
                        }

                        if (res.status >= 200 && res.status < 300) {
                            try {
                                const data = JSON.parse(res.responseText);
                                resolve(data);
                            } catch (e) {
                                console.error(`[${GM.info.script.name}] Error parsing JSON for URL ${url.substring(0, 100)}...:`, e);
                                reject(new Error(`JSON parsing error for URL ${url.substring(0, 100)}...`));
                            }
                        } else if (res.status === 503) {
                            reject(new Error('Rate limit hit or server overloaded'));
                        } else {
                            console.error(`[${GM.info.script.name}] API request for URL ${url.substring(0, 100)}... failed with status ${res.status}: ${res.statusText}`);
                            reject(new Error(`API error ${res.status} for URL ${url.substring(0, 100)}...`));
                        }
                    },
                    onerror: (error) => {
                        this._lastRequestFinishedTime = Date.now();
                        this._nextAvailableRequestTime = Math.max(this._nextAvailableRequestTime, this._lastRequestFinishedTime + 5000);
                        console.error(`[${GM.info.script.name}] Network error for URL ${url.substring(0, 100)}...:`, error);
                        reject(new Error(`Network error for URL ${url.substring(0, 100)}...`));
                    },
                    ontimeout: () => {
                        this._lastRequestFinishedTime = Date.now();
                        this._nextAvailableRequestTime = Math.max(this._nextAvailableRequestTime, this._lastRequestFinishedTime + 5000);
                        console.warn(`[${GM.info.script.name}] Request for URL ${url.substring(0, 100)}... timed out.`);
                        reject(new Error(`Timeout for URL ${url.substring(0, 100)}...`));
                    }
                });
            });
        },

        /**
         * Executes an API call with retry logic and rate limiting delays.
         * @param {string} url - The URL for the API request.
         * @param {string} logContext - A string to append to log messages (e.g., "query: X, offset: Y").
         * @returns {Promise<Object>} - Resolves with parsed JSON data, rejects if all retries fail.
         */
        _executeApiCallWithRetries: async function(url, logContext) {
            for (let i = 0; i < Config.MAX_RETRIES; i++) {
                const now = Date.now();
                let waitTime = 0;

                if (now < this._nextAvailableRequestTime) {
                    waitTime = this._nextAvailableRequestTime - now;
                } else {
                    const timeSinceLastRequest = now - this._lastRequestFinishedTime;
                    if (timeSinceLastRequest < 1000) {
                        waitTime = 1000 - timeSinceLastRequest;
                    }
                }

                if (waitTime > 0) {
                    console.log(`[${GM.info.script.name}] Waiting for ${waitTime}ms before sending request (${logContext}).`);
                    await Utils.delay(waitTime);
                }

                try {
                    return await this._sendHttpRequest(url);
                } catch (error) {
                    if (i < Config.MAX_RETRIES - 1 && (error.message.includes('Rate limit hit') || error.message.includes('Network error') || error.message.includes('Timeout') || error.message.includes('server overloaded'))) {
                        console.warn(`[${GM.info.script.name}] Retrying request (${logContext}) (attempt ${i + 1}/${Config.MAX_RETRIES}). Error: ${error.message}`);
                    } else {
                        throw error;
                    }
                }
            }
            throw new Error(`[${GM.info.script.name}] Failed to complete request after ${Config.MAX_RETRIES} attempts (${logContext}).`);
        },

        /**
         * Fetches data from MusicBrainz API with dynamic rate limiting and pagination.
         * @param {string} query - The search query for barcodes.
         * @returns {Promise<{releases: Array, count: number}>} - Resolves with an object containing all fetched releases and their count.
         */
        fetchBarcodeData: async function(query) {
            const BASE_SEARCH_URL = `${Config.API_BASE_URL}?fmt=json`;

            let allReleases = [];
            let currentOffset = 0;
            const limit = 100;
            let totalCount = 0;

            do {
                const url = `${BASE_SEARCH_URL}&query=${encodeURIComponent(query)}&limit=${limit}&offset=${currentOffset}`;
                const logContext = `query: ${query.substring(0, 50)}..., offset: ${currentOffset}`;
                let responseData;
                let fetchedAnyReleasesOnCurrentPage = false;

                try {
                    responseData = await this._executeApiCallWithRetries(url, logContext);
                } catch (error) {
                    console.error(`[${GM.info.script.name}] Failed to fetch page for query ${query.substring(0, 50)}... (offset: ${currentOffset}): ${error.message}`);
                    return { releases: allReleases, count: allReleases.length };
                }

                if (responseData && Array.isArray(responseData.releases)) {
                    if (responseData.releases.length > 0) {
                        allReleases = allReleases.concat(responseData.releases);
                        fetchedAnyReleasesOnCurrentPage = true;
                    }

                    if (totalCount === 0) {
                        totalCount = responseData.count;
                        if (totalCount === 0 && responseData.releases.length === 0) {
                            console.log(`[${GM.info.script.name}] No releases found for query ${query.substring(0, 50)}... (initial count 0).`);
                            break;
                        }
                    }

                    currentOffset += responseData.releases.length;

                    if (responseData.releases.length < limit) {
                        console.log(`[${GM.info.script.name}] Last page fetched for query ${query.substring(0, 50)}... (returned ${responseData.releases.length} releases). Terminating pagination.`);
                        break;
                    }

                    if (!fetchedAnyReleasesOnCurrentPage && currentOffset < totalCount) {
                        console.warn(`[${GM.info.script.name}] Expected more releases but received none for query ${query.substring(0, 50)}... (offset: ${currentOffset}). Terminating pagination.`);
                        break;
                    }

                } else {
                    console.warn(`[${GM.info.script.name}] Malformed response or no releases array for query ${query.substring(0, 50)}... (offset: ${currentOffset}). Assuming no more data from this point.`);
                    break;
                }

                if (totalCount > 0 && currentOffset >= totalCount) {
                    console.log(`[${GM.info.script.name}] All ${totalCount} releases fetched for query ${query.substring(0, 50)}...`);
                    break;
                }

            } while (true);

            return { releases: allReleases, count: allReleases.length };
        }
    };

    /**
     * Scans the DOM for barcode elements and manages their associated data.
     */
    const DOMScanner = {
        _barcodeToSpansMap: new Map(),
        _uniqueBarcodes: new Set(),

        /**
         * Finds barcodes in text nodes and wraps them in spans, storing references.
         * @param {Node} node - The current DOM node to process.
         */
        collectBarcodesAndCreateSpans: function(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains(Config.PROCESSED_BARCODE_SPAN_CLASS)) {
                    return;
                }

                const originalText = node.textContent;
                const matches = [...originalText.matchAll(Config.BARCODE_REGEX)];
                if (matches.length === 0) return;

                let lastIndex = 0;
                const fragment = document.createDocumentFragment();

                for (const match of matches) {
                    const barcode = match[0];
                    const startIndex = match.index;
                    const endIndex = startIndex + barcode.length;

                    if (startIndex > lastIndex) {
                        fragment.appendChild(document.createTextNode(originalText.substring(lastIndex, startIndex)));
                    }

                    const barcodeSpan = document.createElement('span');
                    barcodeSpan.textContent = barcode;
                    barcodeSpan.classList.add(Config.PROCESSED_BARCODE_SPAN_CLASS);

                    if (!this._barcodeToSpansMap.has(barcode)) {
                        this._barcodeToSpansMap.set(barcode, []);
                    }
                    this._barcodeToSpansMap.get(barcode).push(barcodeSpan);
                    this._uniqueBarcodes.add(barcode);

                    fragment.appendChild(barcodeSpan);
                    lastIndex = endIndex;
                }

                if (lastIndex < originalText.length) {
                    fragment.appendChild(document.createTextNode(originalText.substring(lastIndex)));
                }

                if (fragment.hasChildNodes()) {
                    node.parentNode.insertBefore(fragment, node);
                    node.remove();
                }

            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE' && !node.classList.contains(Config.PROCESSED_BARCODE_SPAN_CLASS)) {
                    const children = Array.from(node.childNodes);
                    for (const child of children) {
                        this.collectBarcodesAndCreateSpans(child);
                    }
                }
            }
        },

        /**
         * Returns the set of unique barcodes found.
         * @returns {Set<string>} A set of unique barcode strings.
         */
        getUniqueBarcodes: function() {
            return this._uniqueBarcodes;
        },

        /**
         * Returns the map of barcodes to their corresponding span elements.
         * @returns {Map<string, HTMLElement[]>} A map where keys are barcodes and values are arrays of their span elements.
         */
        getBarcodeSpansMap: function() {
            return this._barcodeToSpansMap;
        }
    };

    /**
     * Main application logic for the userscript.
     */
    const BarcodeLinkerApp = {
        /**
         * Initializes the application.
         */
        init: function() {
            Config.USER_AGENT = `${Config.SHORT_APP_NAME}/${GM.info.script.version} ( ${GM.info.script.namespace} )`;
            this.processAddReleaseTables();
        },

        /**
         * Processes all "Add release" tables to find barcodes, fetch data, and update the DOM.
         */
        processAddReleaseTables: async function() {
            const tables = document.querySelectorAll(Config.TARGET_SELECTOR);

            tables.forEach(table => {
                table.querySelectorAll('td').forEach(cell => {
                    DOMScanner.collectBarcodesAndCreateSpans(cell);
                });
            });

            const uniqueBarcodes = DOMScanner.getUniqueBarcodes();
            if (uniqueBarcodes.size === 0) {
                console.log(`[${GM.info.script.name}] No barcodes found to process.`);
                return;
            }

            const combinedQuery = Array.from(uniqueBarcodes).map(b => `barcode:${b}`).join(' OR ');

            try {
                const data = await MusicBrainzAPI.fetchBarcodeData(combinedQuery);

                if (data && data.releases) {
                    const releasesByBarcode = new Map();
                    data.releases.forEach(release => {
                        if (release.barcode) {
                            if (!releasesByBarcode.has(release.barcode)) {
                                releasesByBarcode.set(release.barcode, []);
                            }
                            releasesByBarcode.get(release.barcode).push(release);
                        }
                    });

                    uniqueBarcodes.forEach(barcode => {
                        const spans = DOMScanner.getBarcodeSpansMap().get(barcode);
                        const releasesForBarcode = releasesByBarcode.get(barcode) || [];

                        if (spans && releasesForBarcode.length > 1) {
                            const searchUrl = `//musicbrainz.org/search?type=release&method=advanced&query=barcode:${barcode}`;
                            const searchLink = document.createElement('a');
                            searchLink.href = searchUrl;
                            searchLink.setAttribute('target', '_blank');
                            searchLink.textContent = 'Search';
                            searchLink.classList.add(Config.SEARCH_LINK_CLASS);

                            spans.forEach(barcodeSpan => {
                                if (!barcodeSpan.querySelector(`.${Config.SEARCH_LINK_CLASS}`)) {
                                    barcodeSpan.appendChild(document.createTextNode(' ('));
                                    barcodeSpan.appendChild(searchLink.cloneNode(true));
                                    barcodeSpan.appendChild(document.createTextNode(')'));

                                    barcodeSpan.style.backgroundColor = 'yellow';
                                    barcodeSpan.title = `Multiple MusicBrainz releases found for barcode: ${barcode}`;
                                } else {
                                    console.log(`[${GM.info.script.name}] Skipping duplicate link addition for barcode ${barcode} in span. Link already exists.`);
                                }
                            });
                        }
                    });
                } else {
                    console.warn(`[${GM.info.script.name}] No releases found for any barcodes in the batch query, or malformed response.`);
                }
            } catch (error) {
                console.error(`[${GM.info.script.name}] Failed to fetch data for all barcodes: ${error.message}`);
            }
        }
    };

    BarcodeLinkerApp.init();

})();
