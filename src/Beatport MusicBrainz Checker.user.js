// ==UserScript==
// @name         Beatport: MusicBrainz Checker
// @namespace    https://musicbrainz.org/user/chaban
// @version      2.7.0
// @description  Adds MusicBrainz status icons to Beatport releases on list pages and links missing releases for importing
// @tag          ai-created
// @author       RustyNova, chaban
// @license      MIT
// @match        https://www.beatport.com/*
// @connect      musicbrainz.org

// @icon         https://www.google.com/s2/favicons?sz=64&domain=beatport.com
// @grant        GM.xmlHttpRequest
// @run-at       document-idle
// @updateURL    https://github.com/chaban-mb/userscripts/raw/dist/src/Beatport%20MusicBrainz%20Checker.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/dist/src/Beatport%20MusicBrainz%20Checker.user.js
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


  /**
   * Configuration object for endpoints, selectors, and import providers.
   */
  const Config = {
    USER_AGENT: 'UserJS.BeatportMusicBrainzChecker',
    MUSICBRAINZ_BASE_URL: 'https://musicbrainz.org/',
    MUSICBRAINZ_ICON_URL: 'https://raw.githubusercontent.com/metabrainz/musicbrainz-server/master/root/static/images/entity/release.svg',

    /**
     * Missing release action provider:
     * - 'beatport': Opens Beatport release page in a new tab for 1-click import via Murdos Beatport Importer (default workaround while Cloudflare blocks Harmony server scraping).
     * - 'harmony': Opens Harmony import URL directly (available when Harmony implements Beatport API support).
     */
    MISSING_RELEASE_PROVIDER: 'beatport',

    HARMONY_BASE_URL: 'https://harmony.pulsewidth.org.uk/release',
    HARMONY_ICON_URL: 'https://harmony.pulsewidth.org.uk/favicon.svg',
    HARMONY_DEFAULT_PARAMS: {
      gtin: '',
      region: 'us',
      category: 'preferred'
    },

    SUPPORTED_PATHS: [
      '/my-beatport',
      '/label/',
      '/artist/',
      '/track/',
      '/genre/',
      '/chart/'
    ],

    SELECTORS: {
      RELEASE_ROW: '[class*="TableRow"]',
      RELEASE_LINK: '[href*="/release/"]',
      ANCHOR: '.date',
      ICONS_CONTAINER: '.button_container'
    },

    CLASS_NAMES: {
      STATUS_ICON: 'status-icon',
      HARMONY_ICON: 'harmony-icon',
      RELEASE_ICON: 'release-icon',
      ICONS_CONTAINER: 'button_container'
    }
  };

  /**
   * General utility helpers.
   */
  const Utils = {
    /**
     * Extracts the base pathname from a URL, removing any leading language prefix (e.g., /de/, /fr/).
     * @param {string} pathname - The window.location.pathname string.
     * @returns {string} The pathname without a language prefix.
     */
    _getBasePathname: function (pathname) {
      const langPrefixRegex = /^\/[a-z]{2}\//;
      if (langPrefixRegex.test(pathname)) {
        return '/' + pathname.substring(pathname.indexOf('/', 1) + 1);
      }
      return pathname;
    }
  };

  /**
   * Constructs the Harmony import URL for a given Beatport release URL.
   * @param {string} releaseUrl - The Beatport release URL.
   * @returns {string} The complete Harmony import URL.
   */
  function getHarmonyImportUrl(releaseUrl) {
    const harmonyParams = new URLSearchParams();

    for (const [key, value] of Object.entries(Config.HARMONY_DEFAULT_PARAMS)) {
      harmonyParams.set(key, value);
    }

    harmonyParams.set('url', releaseUrl);
    return `${Config.HARMONY_BASE_URL}?${harmonyParams.toString()}`;
  }

  /**
   * Resolves the target destination URL for releases missing from MusicBrainz.
   * @param {string} releaseUrl - The Beatport release URL.
   * @returns {string} The target URL based on Config.MISSING_RELEASE_PROVIDER.
   */
  function getMissingReleaseUrl(releaseUrl) {
    if (Config.MISSING_RELEASE_PROVIDER === 'harmony') {
      return getHarmonyImportUrl(releaseUrl);
    }
    return releaseUrl;
  }

  /**
   * Resolves the tooltip title for releases missing from MusicBrainz.
   * @returns {string} Tooltip description.
   */
  function getMissingReleaseTitle() {
    if (Config.MISSING_RELEASE_PROVIDER === 'harmony') {
      return 'Import with Harmony';
    }
    return 'Missing from MusicBrainz — Open release page to import';
  }

  /**
   * Constructs the MusicBrainz release URL.
   * @param {string} type - The MusicBrainz entity type (e.g., "release", "release-group").
   * @param {string} mbid - The MusicBrainz ID of the entity.
   * @returns {string} The complete MusicBrainz release URL.
   */
  function getMusicBrainzReleaseUrl(type, mbid) {
    return `${Config.MUSICBRAINZ_BASE_URL}${type}/${mbid}`;
  }

  /**
   * Manages the creation and appending of status icons to the DOM.
   */
  const IconManager = {
    /**
     * Creates and appends a "missing" icon (linking to Beatport release page or Harmony) to the given container.
     * @param {HTMLElement} container - The container element to which the icon will be appended.
     * @param {string} releaseUrl - The Beatport release URL.
     */
    addMissingIcon: function (container, releaseUrl) {
      const iconLink = document.createElement('a');
      iconLink.className = `${Config.CLASS_NAMES.STATUS_ICON} ${Config.CLASS_NAMES.HARMONY_ICON}`;
      iconLink.href = getMissingReleaseUrl(releaseUrl);
      iconLink.target = '_blank';
      iconLink.rel = 'noopener noreferrer';
      iconLink.title = getMissingReleaseTitle();
      iconLink.onclick = function () {
        BeatportMusicBrainzImporter._mbApi.invalidateCacheForUrl(releaseUrl);
      };
      container.appendChild(iconLink);
    },

    /**
     * Creates and appends a "release" icon (linking to MusicBrainz) to the given container.
     * @param {HTMLElement} container - The container element to which the icon will be appended.
     * @param {string} type - The MusicBrainz entity type (e.g., "release", "release-group").
     * @param {string} mbid - The MusicBrainz ID of the entity.
     */
    addReleaseIcon: function (container, type, mbid) {
      const iconLink = document.createElement('a');
      iconLink.className = `${Config.CLASS_NAMES.STATUS_ICON} ${Config.CLASS_NAMES.RELEASE_ICON}`;
      iconLink.href = getMusicBrainzReleaseUrl(type, mbid);
      iconLink.target = '_blank';
      iconLink.rel = 'noopener noreferrer';
      iconLink.title = 'Open in MusicBrainz';
      container.appendChild(iconLink);
    },

    /**
     * Processes a single release row to add MusicBrainz status icons based on lookup results.
     * @param {HTMLElement} rowElement - The DOM element representing a single release row.
     * @param {string} releaseUrl - The Beatport URL of the release.
     * @param {[string, string]|null} mbStatus - The MusicBrainz status ([targetType, mbid]) or null if not found.
     */
    updateReleaseRow: function (rowElement, releaseUrl, mbStatus) {
      const dateDiv = rowElement.querySelector(Config.SELECTORS.ANCHOR);
      if (!dateDiv) {
        return;
      }

      const existingIconsContainer = dateDiv.querySelector(`.${Config.CLASS_NAMES.ICONS_CONTAINER}`);
      if (existingIconsContainer) {
        existingIconsContainer.remove();
      }

      const iconsContainer = document.createElement('div');
      iconsContainer.className = Config.CLASS_NAMES.ICONS_CONTAINER;

      if (mbStatus !== null) {
        this.addReleaseIcon(iconsContainer, mbStatus[0], mbStatus[1]);
      } else {
        this.addMissingIcon(iconsContainer, releaseUrl);
      }

      dateDiv.appendChild(iconsContainer);

      // Mark row as processed for this specific URL to handle React DOM recycling
      BeatportMusicBrainzImporter._processedRows.set(rowElement, releaseUrl);
    }
  };

  /**
   * Scans the DOM for release rows and extracts relevant information.
   */
  const DOMScanner = {
    /**
     * Checks if the current page URL matches any of the supported patterns.
     * @returns {boolean} True if the current page is supported, false otherwise.
     */
    isSupportedPage: function () {
      const pathname = window.location.pathname;
      const basePathname = Utils._getBasePathname(pathname);
      return Config.SUPPORTED_PATHS.some(path => basePathname.startsWith(path));
    },

    /**
     * Finds all unprocessed release rows and extracts their URLs and corresponding DOM elements.
     * @returns {Array<{url: string, element: HTMLElement}>} An array of objects, each containing
     * a release URL and its DOM element.
     */
    getReleasesToProcess: function () {
      const releases = document.querySelectorAll(Config.SELECTORS.RELEASE_ROW);
      const unprocessedReleases = [];

      for (const releaseRow of releases) {
        const releaseLinkElement = releaseRow.querySelector(Config.SELECTORS.RELEASE_LINK);
        if (releaseLinkElement && releaseLinkElement.href) {
          const url = releaseLinkElement.href;

          // Normalize the URL before checking the Map
          const parsedUrl = new URL(url);
          const normalizedPathname = Utils._getBasePathname(parsedUrl.pathname);
          const normalizedUrl = `${parsedUrl.origin}${normalizedPathname}${parsedUrl.search}`;

          const lastProcessed = BeatportMusicBrainzImporter._processedRows.get(releaseRow);

          if (lastProcessed !== normalizedUrl) {
            unprocessedReleases.push({
              url: url,
              element: releaseRow
            });
          }
        }
      }
      return unprocessedReleases;
    }
  };

  /**
   * Main application logic for the userscript.
   */
  const BeatportMusicBrainzImporter = {
    _runningUpdate: false,
    _scheduleUpdate: false,
    _mbApi: null,
    _processedRows: new WeakMap(),

    /**
     * Initializes the application: injects CSS and sets up the MutationObserver and router hook.
     */
    init: function () {
      this._mbApi = new MusicBrainzAPI({
        user_agent: `${Config.USER_AGENT}/${GM_info.script.version} ( ${GM_info.script.namespace} )`
      });
      this._injectCSS();
      this._hookNextRouter();
      // Initial run
      setTimeout(() => this.runUpdate(), 1000);
    },

    /**
     * Injects custom CSS rules into the document head.
     */
    _injectCSS: function () {
      const head = document.head || document.getElementsByTagName('head')[0];
      if (head) {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.textContent = `
          /* Status Icons CSS */
          .${Config.CLASS_NAMES.STATUS_ICON} {
              margin: 0px 5px;
              width: 20px;
              height: 20px;
              display: inline-block;
              background-repeat: no-repeat;
              background-position: center;
              background-size: 20px;
              cursor: pointer;
          }

          .${Config.CLASS_NAMES.HARMONY_ICON} {
              background-image: url("${Config.HARMONY_ICON_URL}") !important;
          }

          .${Config.CLASS_NAMES.RELEASE_ICON} {
              background-image: url("${Config.MUSICBRAINZ_ICON_URL}") !important;
          }

          /* Container for status icons */
          .${Config.CLASS_NAMES.ICONS_CONTAINER} {
              display: flex;
              align-items: center;
              gap: 10px;
              flex-wrap: wrap;
              justify-content: flex-start;
          }

          /* Adjust anchor display to accommodate icons */
          ${Config.SELECTORS.ANCHOR} {
              display: flex;
              align-items: center;
              justify-content: space-between;
          }
        `;
        head.appendChild(style);
      }
    },

    /**
     * Hooks into the Next.js router to listen for client-side navigation events.
     */
    _hookNextRouter: function () {
      const self = this;

      const checkContentAndTrigger = (observer) => {
        const itemsToProcess = DOMScanner.getReleasesToProcess();

        if (itemsToProcess.length > 0) {
          if (observer) observer.disconnect();
          self.runUpdate();
          return true;
        }

        return false;
      };

      const valCheckNext = () => {
        if (unsafeWindow.next?.router?.events) {
          unsafeWindow.next.router.events.on('routeChangeComplete', () => {
            // 1. Immediate check for synchronous update
            if (checkContentAndTrigger(null)) return;

            // 2. Observer for async updates
            const observer = new MutationObserver(() => {
              checkContentAndTrigger(observer);
            });

            observer.observe(document.body, { childList: true, subtree: true });

            // Timeout safety
            setTimeout(() => {
              observer.disconnect();
            }, 10000);
          });
          return;
        }

        setTimeout(valCheckNext, 500);
      };

      valCheckNext();
    },

    /**
     * Main function to scan for releases, fetch MusicBrainz data, and update row UI icons.
     */
    runUpdate: async function () {
      if (this._runningUpdate) {
        this._scheduleUpdate = true;
        return;
      }
      this._runningUpdate = true;

      try {
        do {
          this._scheduleUpdate = false;

          if (!DOMScanner.isSupportedPage()) {
            return;
          }

          const itemsToProcess = DOMScanner.getReleasesToProcess();
          if (itemsToProcess.length === 0) {
            continue;
          }

          // 1. Normalize items and group by URL
          const urlToElementsMap = new Map();

          itemsToProcess.forEach(({ url, element }) => {
            const parsedUrl = new URL(url);
            const normalizedPathname = Utils._getBasePathname(parsedUrl.pathname);
            const normalizedUrl = `${parsedUrl.origin}${normalizedPathname}${parsedUrl.search}`;

            if (!urlToElementsMap.has(normalizedUrl)) {
              urlToElementsMap.set(normalizedUrl, []);
            }
            urlToElementsMap.get(normalizedUrl).push(element);
          });

          const uniqueUrls = Array.from(urlToElementsMap.keys());
          const uncachedUrls = [];
          const mbStatusMap = new Map();

          // 2. Check API cache for instant update
          uniqueUrls.forEach(url => {
            const cachedData = this._mbApi.getFromCache(url);
            if (cachedData !== undefined) {
              let status = null;
              if (cachedData && cachedData.relations) {
                const releaseRelation = cachedData.relations.find(rel => rel['target-type'] === 'release' && rel.release);
                if (releaseRelation) {
                  status = [releaseRelation['target-type'], releaseRelation.release.id];
                }
              }
              mbStatusMap.set(url, status);
            } else {
              uncachedUrls.push(url);
            }
          });

          // Helper function to update UI for given URLs
          const updateUIForUrls = (urls) => {
            for (const normalizedUrl of urls) {
              const status = mbStatusMap.get(normalizedUrl);
              const elements = urlToElementsMap.get(normalizedUrl);
              if (elements) {
                for (const element of elements) {
                  if (element && element.isConnected) {
                    IconManager.updateReleaseRow(element, normalizedUrl, status);
                  }
                }
              }
            }
          };

          // Update cached items immediately
          updateUIForUrls(uniqueUrls.filter(u => mbStatusMap.has(u)));

          // 3. Batch lookup for uncached items
          if (uncachedUrls.length > 0) {
            try {
              const mbResults = await this._mbApi.lookupUrl(uncachedUrls, ['release-rels']);

              for (const normalizedUrl of uncachedUrls) {
                const urlData = mbResults.get(normalizedUrl);
                let status = null;

                if (urlData && urlData.relations) {
                  const releaseRelation = urlData.relations.find(rel => rel['target-type'] === 'release' && rel.release);
                  if (releaseRelation) {
                    status = [releaseRelation['target-type'], releaseRelation.release.id];
                  }
                }
                mbStatusMap.set(normalizedUrl, status);
              }
            } catch (error) {
              if (!error.message || !error.message.includes('HTTP Error 404')) {
                console.error('[MB Import] Failed batch lookup:', { error, uncachedCount: uncachedUrls.length });
              }
              uncachedUrls.forEach(url => {
                mbStatusMap.set(url, null);
              });
            }

            // Update UI for newly fetched items
            updateUIForUrls(uncachedUrls);
          }

        } while (this._scheduleUpdate);
      } catch (err) {
        console.error('[MB Import] Error during update cycle:', { error: err });
      } finally {
        this._runningUpdate = false;
      }
    }
  };

  BeatportMusicBrainzImporter.init();
})();