// ==UserScript==
// @name        Beatport: MusicBrainz Importer
// @namespace   https://musicbrainz.org/user/chaban
// @version     2.3.3
// @description Adds MusicBrainz status icons to Beatport releases and allows importing them with Harmony
// @tag         ai-created
// @author      RustyNova, chaban
// @license     MIT
// @match       https://www.beatport.com/*
// @connect     musicbrainz.org
// @icon        https://www.google.com/s2/favicons?sz=64&domain=beatport.com
// @grant       GM.xmlHttpRequest
// @run-at      document-idle
// ==/UserScript==

(function() {
  'use strict';

  /**
   * Configuration object to centralize all constants.
   */
  const Config = {
    SHORT_APP_NAME: 'UserJS.BeatportMusicBrainzImporter',
    HARMONY_BASE_URL: 'https://harmony.pulsewidth.org.uk/release',
    MUSICBRAINZ_API_BASE_URL: 'https://musicbrainz.org/ws/2/url',
    MUSICBRAINZ_BASE_URL: 'https://musicbrainz.org/',

    HARMONY_ICON_URL: 'https://harmony.pulsewidth.org.uk/favicon.svg',
    MUSICBRAINZ_ICON_URL: 'https://raw.githubusercontent.com/metabrainz/musicbrainz-server/master/root/static/images/entity/release.svg',

    SUPPORTED_PATHS: [
      '/my-beatport',
      '/label/',
      '/artist/',
      '/track/',
      '/genre/',
      '/release/'
    ],

    HARMONY_DEFAULT_PARAMS: {
      gtin: '',
      region: 'us',
      category: 'preferred'
    },

    SELECTORS: {
      RELEASE_ROW: '[class*="TableRow"]',
      RELEASE_LINK: '[href*="/release/"]',
      ANCHOR: '.date',
      ICONS_CONTAINER: '.button_container',
      RELEASE_CONTROLS_CONTAINER: '[class*="CollectionControls-style__Wrapper"]'
    },
    CLASS_NAMES: {
      STATUS_ICON: 'status-icon',
      HARMONY_ICON: 'harmony-icon',
      RELEASE_ICON: 'release-icon',
      ICONS_CONTAINER: 'button_container',
      BUTTON_MUSICBRAINZ: 'button_musicbrainz',
      BUTTON_HARMONY: 'button_harmony',
    },

    MB_API_BATCH_SIZE: 100,
    MB_API_MAX_RETRIES: 5,
    MB_API_TIMEOUT_MS: 10000,

    OBSERVER_CONFIG: {
      root: document,
      options: {
        subtree: true,
        childList: true
      }
    },
  };

  /**
   * Utility function to pause execution for a given number of milliseconds.
   * @param {number} ms - The number of milliseconds to sleep.
   * @returns {Promise<void>} A promise that resolves after the specified delay.
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * General utility functions.
   */
  const Utils = {
    /**
     * Safely retrieves nested properties from an object.
     * @param {object} obj - The object to traverse.
     * @param {string[]} path - An array of property names representing the path to the desired value.
     * @returns {any | undefined} The value at the specified path, or undefined if any part of the path is missing.
     */
    _getNestedProperty: function(obj, path) {
        return path.reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
    },

    /**
     * Retrieves the __NEXT_DATA__ object from the page.
     * @returns {object | null} The parsed __NEXT_DATA__ object, or null if not found or parsing fails.
     */
    _getNextData: function() {
        const nextDataScript = document.getElementById('__NEXT_DATA__');
        if (nextDataScript && nextDataScript.textContent) {
            try {
                return JSON.parse(nextDataScript.textContent);
            } catch (e) {
                return null;
            }
        }
        return null;
    },

    /**
     * Extracts the base pathname from a URL, removing any leading language prefix (e.g., /de/, /fr/).
     * @param {string} pathname - The window.location.pathname string.
     * @returns {string} The pathname without a language prefix.
     */
    _getBasePathname: function(pathname) {
      const langPrefixRegex = /^\/[a-z]{2}\//;
      if (langPrefixRegex.test(pathname)) {
        return '/' + pathname.substring(pathname.indexOf('/', 1) + 1);
      }
      return pathname;
    },

    /**
     * Finds and extracts the current release data from the __NEXT_DATA__ object.
     * Prioritizes 'release' directly, then looks into 'dehydratedState.queries'.
     * @returns {object | null} The release data object, or null if not found.
     */
    getReleaseDataFromNextData: function() {
        const parsedData = this._getNextData();
        if (!parsedData) {
            return null;
        }

        // 1. Try to get release data directly from pageProps.release
        let release = this._getNestedProperty(parsedData, ['props', 'pageProps', 'release']);
        if (release && release.id) {
            return release;
        }

        // 2. If not found directly, search within dehydratedState.queries
        const queries = this._getNestedProperty(parsedData, ['props', 'pageProps', 'dehydratedState', 'queries']);

        if (Array.isArray(queries)) {
            const currentReleaseId = window.location.pathname.split('/').pop(); // Extract ID from URL

            for (const query of queries) {
                const queryData = this._getNestedProperty(query, ['state', 'data']);
                if (queryData) {
                    // Case 1: queryData.results is an array of releases (e.g., label releases list)
                    if (Array.isArray(queryData.results)) {
                        const foundRelease = queryData.results.find(item =>
                            item.id && item.id.toString() === currentReleaseId
                        );
                        if (foundRelease) {
                            return foundRelease;
                        }
                    }
                    // Case 2: queryData itself is the release object (e.g., single release page data)
                    else if (queryData.id && queryData.id.toString() === currentReleaseId) {
                        return queryData;
                    }
                }
            }
        }
        return null; // Release data not found in __NEXT_DATA__
    },

    /**
     * Extracts artist and release name from the Open Graph title meta tag.
     * @returns {{artist: string, release: string}|null} An object with artist and release, or null if not found.
     */
    getArtistAndReleaseFromMetaTags: function() {
      const ogTitleMeta = document.querySelector('meta[property="og:title"]');
      if (ogTitleMeta && ogTitleMeta.content) {
        const ogTitle = ogTitleMeta.content;
        const parts = ogTitle.split(' - ');
        if (parts.length >= 2) {
          let artist = parts[0].trim();
          let release = parts[1];

          // Remove the label part if present (e.g., "[We Are Trance]")
          const labelMatch = release.match(/\[.*?\]/);
          if (labelMatch) {
            release = release.replace(labelMatch[0], '').trim();
          }

          // Remove the trailing Beatport suffix (e.g., "| Music & Downloads on Beatport")
          const beatportSuffix = " | Music & Downloads on Beatport";
          if (release.endsWith(beatportSuffix)) {
            release = release.substring(0, release.length - beatportSuffix.length).trim();
          }

          return { artist: artist, release: release };
        }
      }
      return null;
    },

    /**
     * Waits for an element matching the selector to appear in the DOM.
     * @param {string} selector - The CSS selector for the element to wait for.
     * @returns {Promise<HTMLElement>} A promise that resolves with the element when found.
     */
    waitForElement: function(selector) {
      return new Promise((resolve) => {
        const observer = new MutationObserver((mutations, obs) => {
          const element = document.querySelector(selector);
          if (element) {
            obs.disconnect();
            resolve(element);
          }
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true
        });
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });
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
   * Constructs the MusicBrainz release URL.
   * @param {string} type - The MusicBrainz entity type (e.g., "release", "release-group").
   * @param {string} mbid - The MusicBrainz ID of the entity.
   * @returns {string} The complete MusicBrainz release URL.
   */
  function getMusicBrainzReleaseUrl(type, mbid) {
    return `${Config.MUSICBRAINZ_BASE_URL}${type}/${mbid}`;
  }

  /**
   * Constructs the MusicBrainz tag lookup (search) URL using URLSearchParams.
   * @param {string} artist - The artist name.
   * @param {string} release - The release name.
   * @returns {string} The complete MusicBrainz tag lookup URL.
   */
  function getMusicBrainzSearchUrl(artist, release) {
    const baseUrl = new URL('taglookup/index', Config.MUSICBRAINZ_BASE_URL);
    baseUrl.searchParams.set('tag-lookup.artist', artist);
    baseUrl.searchParams.set('tag-lookup.release', release);
    return baseUrl.toString();
  }

  /**
   * Manages the creation and appending of status icons to the DOM.
   */
  const IconManager = {
    /**
     * Creates and appends a "missing" icon (linking to Harmony) to the given container.
     * @param {HTMLElement} container - The container element to which the icon will be appended.
     * @param {string} releaseUrl - The Beatport release URL to be used in the Harmony link.
     */
    addMissingIcon: function(container, releaseUrl) {
      let iconLink = document.createElement("a");
      iconLink.className = `${Config.CLASS_NAMES.STATUS_ICON} ${Config.CLASS_NAMES.HARMONY_ICON}`;
      iconLink.href = getHarmonyImportUrl(releaseUrl);
      iconLink.target = "_blank";
      iconLink.title = "Import with Harmony"
      container.appendChild(iconLink);
    },

    /**
     * Creates and appends a "release" icon (linking to MusicBrainz) to the given container.
     * @param {string} container - The container element to which the icon will be appended.
     * @param {string} type - The MusicBrainz entity type (e.g., "release", "release-group").
     * @param {string} mbid - The MusicBrainz ID of the entity.
     */
    addReleaseIcon: function(container, type, mbid) {
      let iconLink = document.createElement("a");
      iconLink.className = `${Config.CLASS_NAMES.STATUS_ICON} ${Config.CLASS_NAMES.RELEASE_ICON}`;
      iconLink.href = getMusicBrainzReleaseUrl(type, mbid);
      iconLink.target = "_blank";
      iconLink.title = "Open in MusicBrainz"
      container.appendChild(iconLink);
    },

    /**
     * Processes a single release row to add MusicBrainz status icons based on lookup results.
     * @param {HTMLElement} rowElement - The DOM element representing a single release row.
     * @param {string} releaseUrl - The Beatport URL of the release.
     * @param {Array|null} mbStatus - The MusicBrainz status ([targetType, mbid]) or null if not found.
     */
    updateReleaseRow: async function(rowElement, releaseUrl, mbStatus) {
      const dateDiv = rowElement.querySelector(Config.SELECTORS.ANCHOR);
      if (!dateDiv) {
        return;
      }

      // Disconnect observer before modifying DOM
      BeatportMusicBrainzImporter._observerInstance.disconnect();

      let existingIconsContainer = dateDiv.querySelector(`.${Config.CLASS_NAMES.ICONS_CONTAINER}`);
      if (existingIconsContainer) {
        existingIconsContainer.remove();
      }

      let iconsContainer = document.createElement("div");
      iconsContainer.className = Config.CLASS_NAMES.ICONS_CONTAINER;

      if (mbStatus !== null) {
        this.addReleaseIcon(iconsContainer, mbStatus[0], mbStatus[1]);
      } else {
        this.addMissingIcon(iconsContainer, releaseUrl);
      }

      dateDiv.appendChild(iconsContainer);

      BeatportMusicBrainzImporter._observerInstance.observe(Config.OBSERVER_CONFIG.root, Config.OBSERVER_CONFIG.options);
    }
  };

  /**
   * Manages the injection of import/search buttons on release detail pages.
   */
  const ButtonManager = {
    /**
     * Creates an onclick handler function that opens a given URL in a new tab.
     * @param {string} url - The URL to open.
     * @returns {function} An event handler function.
     */
    _createOpenWindowHandler: function(url) {
      return function() {
        window.open(url, '_blank').focus();
      };
    },

    /**
     * Adds an "Import with Harmony" button.
     * @param {HTMLElement} container - The container to append the button to.
     * @param {string} releaseUrl - The current Beatport release URL.
     */
    addHarmonyImportButton: function(container, releaseUrl) {
      let button = document.createElement("button");
      button.textContent = "Import with Harmony";
      button.className = `${Config.CLASS_NAMES.BUTTON_HARMONY}`;
      button.title = "Import with Harmony"

      button.onclick = this._createOpenWindowHandler(getHarmonyImportUrl(releaseUrl));
      container.appendChild(button);
    },

    /**
     * Adds an "Open in MusicBrainz" button.
     * @param {HTMLElement} container - The container to append the button to.
     * @param {string} type - The MusicBrainz entity type.
     * @param {string} mbid - The MusicBrainz ID.
     */
    addOpenMusicBrainzButton: function(container, type, mbid) {
      let button = document.createElement("button");
      button.textContent = "Open in MusicBrainz";
      button.className = `${Config.CLASS_NAMES.BUTTON_MUSICBRAINZ}`;
      button.title = "Open in MusicBrainz";

      button.onclick = this._createOpenWindowHandler(getMusicBrainzReleaseUrl(type, mbid));
      container.appendChild(button);
    },

    /**
     * Adds a "Search in MusicBrainz" button.
     * @param {HTMLElement} container - The container to append the button to.
     * @param {string} artist - The artist name.
     * @param {string} release - The release name.
     */
    addSearchMusicBrainzButton: function(container, artist, release) {
      let button = document.createElement("button");
      button.textContent = "Search in MusicBrainz";
      button.className = `${Config.CLASS_NAMES.BUTTON_MUSICBRAINZ}`;
      button.title = "Search in MusicBrainz";

      button.onclick = this._createOpenWindowHandler(getMusicBrainzSearchUrl(artist, release));
      container.appendChild(button);
    },

    /**
     * Processes the current release page to add import/search buttons.
     * @param {Array|null|undefined} mbStatus - The MusicBrainz status for the current URL.
     */
    processReleasePageButtons: async function(mbStatus) {
      const anchor = await Utils.waitForElement(Config.SELECTORS.RELEASE_CONTROLS_CONTAINER);
      if (!anchor) {
        return;
      }

      BeatportMusicBrainzImporter._observerInstance.disconnect();

      let container = anchor.querySelector(`.${Config.CLASS_NAMES.ICONS_CONTAINER}`);
      if (container) {
          while (container.firstChild) {
              container.removeChild(container.firstChild);
          }
      } else {
          container = document.createElement("div");
          container.className = Config.CLASS_NAMES.ICONS_CONTAINER;
          anchor.appendChild(container);
      }

      const currentUrl = window.location.href;

      this.addHarmonyImportButton(container, currentUrl);

      if (mbStatus !== null && mbStatus !== undefined) {
        this.addOpenMusicBrainzButton(container, mbStatus[0], mbStatus[1]);
      } else {
        let artistName = '';
        let releaseName = '';

        // Try to get data from the new, more robust __NEXT_DATA__ extraction
        const releaseDataFromNext = Utils.getReleaseDataFromNextData();
        if (releaseDataFromNext) {
          artistName = releaseDataFromNext.artists[0]?.name || '';
          releaseName = releaseDataFromNext.name || '';
        }

        // Fallback to meta tags if __NEXT_DATA__ is still incomplete or didn't contain the specific release
        if (!artistName || !releaseName) {
          const metaData = Utils.getArtistAndReleaseFromMetaTags();
          if (metaData) {
            artistName = metaData.artist;
            releaseName = metaData.release;
          }
        }

        if (artistName && releaseName) {
          this.addSearchMusicBrainzButton(container, artistName, releaseName);
        }
      }

      BeatportMusicBrainzImporter._observerInstance.observe(Config.OBSERVER_CONFIG.root, Config.OBSERVER_CONFIG.options);
    }
  };


  /**
   * Handles all interactions with the MusicBrainz API, including caching and retries.
   */
  const MusicBrainzAPI = {
    _urlCache: new Map(),

    /**
     * Queries MusicBrainz for multiple URLs in batches using the 'resource' parameter.
     * @param {string[]} urlsToQuery - An array of URLs to query.
     * @returns {Promise<Map<string, Array|null|undefined>>} A promise that resolves to a Map where keys are URLs
     * and values are either [targetType, mbid], null (not found), or undefined (API failed).
     */
    lookupUrls: async function(urlsToQuery) {
      const resultsMap = new Map();
      const uniqueUrlsToQuery = [...new Set(urlsToQuery)];

      const uncachedUrls = uniqueUrlsToQuery.filter(url => {
        const cached = this._urlCache.get(url);
        if (cached !== undefined) {
          resultsMap.set(url, cached);
          return false;
        }
        return true;
      });

      if (uncachedUrls.length === 0) {
        return resultsMap;
      }

      for (let i = 0; i < uncachedUrls.length; i += Config.MB_API_BATCH_SIZE) {
        const batch = uncachedUrls.slice(i, i + Config.MB_API_BATCH_SIZE);

        const apiUrl = new URL(Config.MUSICBRAINZ_API_BASE_URL);
        batch.forEach(url => {
          const parsedUrl = new URL(url);
          const normalizedPathname = Utils._getBasePathname(parsedUrl.pathname);
          const normalizedUrl = `${parsedUrl.origin}${normalizedPathname}${parsedUrl.search}`;
          apiUrl.searchParams.append('resource', normalizedUrl);
        });
        apiUrl.searchParams.set('inc', 'release-rels');
        apiUrl.searchParams.set('fmt', 'json');

        let tries = 0;
        let success = false;
        while (!success && tries < Config.MB_API_MAX_RETRIES) {
          await sleep(1000 * tries);

          try {
            const response = await GM.xmlHttpRequest({
              url: apiUrl.toString(),
              method: "GET",
              responseType: "json",
              headers: {
                'Accept': "application/json",
                'Origin': location.origin,
                'User-Agent': `${Config.SHORT_APP_NAME}/${GM_info.script.version} ( ${GM_info.script.namespace} )`,
              },
              anonymous: true,
              timeout: Config.MB_API_TIMEOUT_MS
            });

            if (response.status === 200 && response.response) {
                let urlEntities;
                if (batch.length === 1) {
                    urlEntities = [response.response];
                } else if (Array.isArray(response.response.urls)) {
                    urlEntities = response.response.urls;
                } else {
                    batch.forEach(url => this._urlCache.set(url, null));
                    success = true;
                    continue;
                }

                this._processApiResponse(batch, urlEntities, resultsMap);
                success = true;

            } else if (response.status === 404) {
              batch.forEach(url => this._urlCache.set(url, null));
              success = true;
            } else if (response.status === 503) {
              tries++;
            } else {
              tries++;
            }
          } catch (e) {
            tries++;
          }
        }

        if (!success) {
          batch.forEach(url => {
            this._urlCache.set(url, undefined);
            resultsMap.delete(url);
          });
        }
      }
      return resultsMap;
    } ,

    /**
     * Internal helper to process successful API responses and update cache/results.
     * @param {string[]} originalUrlsInBatch - The original batch of URLs sent in the request.
     * @param {Array<Object>} urlEntities - The 'urls' array from the MusicBrainz API response (or single object wrapped in array).
     * @param {Map<string, Array|null|undefined>} resultsMap - The map to store current results.
     */
    _processApiResponse: function(originalUrlsInBatch, urlEntities, resultsMap) {

      originalUrlsInBatch.forEach(originalUrl => {
        const urlEntity = urlEntities.find(ue => {
          const parsedOriginalUrl = new URL(originalUrl);
          const normalizedOriginalPathname = Utils._getBasePathname(parsedOriginalUrl.pathname);
          const normalizedOriginalUrl = `${parsedOriginalUrl.origin}${normalizedOriginalPathname}${parsedOriginalUrl.search}`;

          const parsedEntityResource = new URL(ue.resource);
          const normalizedEntityResourcePathname = Utils._getBasePathname(parsedEntityResource.pathname);
          const normalizedEntityResource = `${parsedEntityResource.origin}${normalizedEntityResourcePathname}${parsedEntityResource.search}`;

          return normalizedOriginalUrl === normalizedEntityResource;
        });

        if (urlEntity) {
          if (urlEntity.relations && urlEntity.relations.length > 0) {
            // Find the first relation that targets a 'release'
            const releaseRelation = urlEntity.relations.find(rel => rel['target-type'] === 'release');

            if (releaseRelation && releaseRelation.release && releaseRelation.release.id) {
                const targetType = releaseRelation['target-type'];
                const mbid = releaseRelation.release.id;
                this._urlCache.set(originalUrl, [targetType, mbid]);
                resultsMap.set(originalUrl, [targetType, mbid]);
            } else {
                this._urlCache.set(originalUrl, null);
                resultsMap.set(originalUrl, null);
            }
          } else {
            this._urlCache.set(originalUrl, null);
            resultsMap.set(originalUrl, null);
          }
        } else {
          this._urlCache.set(originalUrl, null);
          resultsMap.set(originalUrl, null);
        }
      });
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
    isSupportedPage: function() {
      const pathname = window.location.pathname;
      const basePathname = Utils._getBasePathname(pathname);
      return Config.SUPPORTED_PATHS.some(path => basePathname.startsWith(path));
    },

    /**
     * Checks if the current page is a specific release detail page.
     * @returns {boolean} True if on a release detail page, false otherwise.
     */
    isReleaseDetailPage: function() {
      const pathname = window.location.pathname;
      const basePathname = Utils._getBasePathname(pathname);
      return basePathname.startsWith('/release/');
    },

    /**
     * Finds all unprocessed release rows and extracts their URLs and corresponding DOM elements.
     * @returns {Array<{url: string, element: HTMLElement}>} An array of objects, each containing
     * a release URL and its DOM element.
     */
    getReleasesToProcess: function() {
      const releases = document.querySelectorAll(Config.SELECTORS.RELEASE_ROW);
      const unprocessedReleases = [];

      for (const releaseRow of releases) {
        const releaseLinkElement = releaseRow.querySelector(Config.SELECTORS.RELEASE_LINK);
        if (releaseLinkElement && releaseLinkElement.href) {
          const url = releaseLinkElement.href;
          const dateDiv = releaseRow.querySelector(Config.SELECTORS.ANCHOR);
          const existingIconsContainer = dateDiv ? dateDiv.querySelector(`.${Config.CLASS_NAMES.ICONS_CONTAINER}`) : null;

          if (!existingIconsContainer) {
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
    _observerTimeoutId: null,
    _previousUrl: '',
    _observerInstance: null, // General DOM MutationObserver instance
    _nprogressObserver: null, // NProgress specific MutationObserver instance

    /**
     * Initializes the application: injects CSS and sets up the MutationObserver.
     */
    init: function() {
      this._injectCSS();
      this._setupObservers();
      this._previousUrl = window.location.href;
      // Initial run after NProgress finishes
      this._waitForNProgressToFinish().then(() => this.runUpdate());
    },

    /**
     * Injects custom CSS rules into the document head.
     */
    _injectCSS: function() {
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
          }

          .${Config.CLASS_NAMES.HARMONY_ICON} {
              background-image: url("${Config.HARMONY_ICON_URL}") !important;
          }

          .${Config.CLASS_NAMES.RELEASE_ICON} {
              background-image: url("${Config.MUSICBRAINZ_ICON_URL}") !important;
          }

          /* Combined container for both status icons and import buttons */
          .${Config.CLASS_NAMES.ICONS_CONTAINER} {
              display: flex;
              align-items: center;
              gap: 10px; /* Space between buttons/icons */
              flex-wrap: wrap; /* Allow wrapping on smaller screens */
              justify-content: flex-start; /* Align buttons to the left */
          }

          /* Adjust anchor display to accommodate icons/buttons */
          ${Config.SELECTORS.ANCHOR} {
              display: flex;
              align-items: center;
              justify-content: space-between;
          }

          /* Import Buttons CSS (from original import script) */
          .${Config.CLASS_NAMES.BUTTON_MUSICBRAINZ} {
              background-color: #BA478F;
              padding: 2px 6px;
              border-radius: 4px;
              color: white;
              font-weight: bold;
              cursor: pointer;
              border: none;
              transition: background-color 0.2s ease;
          }
          .${Config.CLASS_NAMES.BUTTON_MUSICBRAINZ}:hover {
              background-color: #9e3a79;
          }

          .${Config.CLASS_NAMES.BUTTON_HARMONY} {
              background-color: #c45555;
              padding: 2px 6px;
              border-radius: 4px;
              color: white;
              font-weight: bold;
              cursor: pointer;
              border: none;
              transition: background-color 0.2s ease;
          }
          .${Config.CLASS_NAMES.BUTTON_HARMONY}:hover {
              background-color: #a34545;
          }

          /* Ensure the parent of ShareContainer has flex or block to allow button container to sit well */
          .${Config.SELECTORS.RELEASE_CONTROLS_CONTAINER} {
              display: flex;
              flex-direction: row;
              align-items: center;
              gap: 15px;
              flex-wrap: wrap;
          }
        `;
        head.appendChild(style);
      }
    },

    /**
     * Waits for the NProgress busy class to be removed from the HTML element.
     * @returns {Promise<void>} A promise that resolves when 'nprogress-busy' class is removed.
     */
    _waitForNProgressToFinish: function() {
        return new Promise(resolve => {
            const htmlElement = document.documentElement;

            if (!htmlElement.classList.contains('nprogress-busy')) {
                resolve(); // Already done loading
                return;
            }

            // Disconnect any existing NProgress observer to prevent duplicates if called multiple times
            if (this._nprogressObserver) {
                this._nprogressObserver.disconnect();
                this._nprogressObserver = null;
            }

            // Create an observer to watch for the 'nprogress-busy' class removal
            this._nprogressObserver = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        if (!htmlElement.classList.contains('nprogress-busy')) {
                            this._nprogressObserver.disconnect();
                            this._nprogressObserver = null; // Clear reference
                            resolve();
                            break; // Stop iterating mutations and resolve
                        }
                    }
                }
            });

            this._nprogressObserver.observe(htmlElement, { attributes: true, attributeFilter: ['class'] });
        });
    },

    /**
     * Sets up all observers (MutationObserver and History API listeners).
     */
    _setupObservers: function() {
      const self = this;
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function() {
          originalPushState.apply(this, arguments);
          // Only trigger if URL actually changed to avoid redundant calls if state is pushed without URL change
          if (window.location.href !== self._previousUrl) {
              self._previousUrl = window.location.href;
              MusicBrainzAPI._urlCache.clear();
              self._waitForNProgressToFinish().then(() => self.runUpdate());
          }
      };

      history.replaceState = function() {
          originalReplaceState.apply(this, arguments);
          // Only trigger if URL actually changed
          if (window.location.href !== self._previousUrl) {
              self._previousUrl = window.location.href;
              MusicBrainzAPI._urlCache.clear();
              self._waitForNProgressToFinish().then(() => self.runUpdate());
          }
      };

      window.addEventListener('popstate', () => {
          // popstate always means URL changed (back/forward)
          self._previousUrl = window.location.href;
          MusicBrainzAPI._urlCache.clear();
          self._waitForNProgressToFinish().then(() => self.runUpdate());
      });

      // 2. MutationObserver for dynamic content loading on the same page (e.g., infinite scroll)
      const observer = new MutationObserver((mutations) => {
        // Only proceed if NProgress is not active AND it's a list page.
        if (!document.documentElement.classList.contains('nprogress-busy') && !DOMScanner.isReleaseDetailPage()) {
          // Debounce general DOM mutations
          if (this._observerTimeoutId) {
            clearTimeout(this._observerTimeoutId);
          }

          this._observerTimeoutId = setTimeout(async () => {
            this._observerTimeoutId = null;

            // Only run update if there are new releases to process
            if (DOMScanner.getReleasesToProcess().length > 0) {
              this.runUpdate();
            }
          }, 50);
        }
        // The else if (window.location.href !== this._previousUrl) block is no longer needed here
        // because the History API listeners handle URL changes and trigger _waitForNProgressToFinish.
      });
      this._observerInstance = observer;
      observer.observe(Config.OBSERVER_CONFIG.root, Config.OBSERVER_CONFIG.options);
    },

    /**
     * Main function to execute the process of scanning for releases, fetching data, and updating UI.
     * This function handles both status icons on list pages and import buttons on detail pages.
     */
    runUpdate: async function() {

      if (this._runningUpdate) {
        this._scheduleUpdate = true;
        return;
      }
      this._runningUpdate = true;

      if (!DOMScanner.isSupportedPage()) {
        this._runningUpdate = false;
        return;
      }

      const isDetailPage = DOMScanner.isReleaseDetailPage();

      if (isDetailPage) {
        const currentUrl = window.location.href;
        const mbResultsMap = await MusicBrainzAPI.lookupUrls([currentUrl]);
        const mbStatus = mbResultsMap.get(currentUrl);
        await ButtonManager.processReleasePageButtons(mbStatus);
        this._runningUpdate = false;
        return;
      }

      // Only proceed with list page status icons if it's NOT a detail page
      const releasesToProcess = DOMScanner.getReleasesToProcess();

      if (releasesToProcess.length === 0) {
        this._runningUpdate = false;
        return;
      }

      const urls = releasesToProcess.map(r => r.url);
      const mbResultsMap = await MusicBrainzAPI.lookupUrls(urls);

      for (const {
          url,
          element
        } of releasesToProcess) {
        const status = mbResultsMap.get(url);
        if (status !== undefined) {
          await IconManager.updateReleaseRow(element, url, status);
        }
      }
      this._runningUpdate = false;
    }
  };

  BeatportMusicBrainzImporter.init();

})();
