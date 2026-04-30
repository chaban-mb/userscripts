// ==UserScript==
// @name        Beatport: MusicBrainz Importer
// @namespace   https://musicbrainz.org/user/chaban
// @version     2.6.2
// @description Adds MusicBrainz status icons to Beatport releases and allows importing them with Harmony
// @tag         ai-created
// @author      RustyNova, chaban
// @license     MIT
// @match       https://www.beatport.com/*
// @connect     musicbrainz.org
// @icon        https://www.google.com/s2/favicons?sz=64&domain=beatport.com
// @grant       GM.xmlHttpRequest
// @run-at      document-idle
// @require     ../lib/MusicBrainzAPI.js
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Importer.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Importer.user.js
// ==/UserScript==

(function () {
  'use strict';

  /**
   * Configuration object to centralize all constants.
   */
  const Config = {
    USER_AGENT: 'UserJS.BeatportMusicBrainzImporter',
    HARMONY_BASE_URL: 'https://harmony.pulsewidth.org.uk/release',
    MUSICBRAINZ_BASE_URL: 'https://musicbrainz.org/',
    HARMONY_ICON_URL: 'https://harmony.pulsewidth.org.uk/favicon.svg',
    MUSICBRAINZ_ICON_URL: 'https://raw.githubusercontent.com/metabrainz/musicbrainz-server/master/root/static/images/entity/release.svg',

    SUPPORTED_PATHS: [
      '/my-beatport',
      '/label/',
      '/artist/',
      '/track/',
      '/genre/',
      '/release/',
      '/chart/'
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
      RELEASE_CONTROLS_CONTAINER: '[class*="CollectionControls-style__Wrapper"]',
      LOADING_OVERLAY: 'div[class*="LoadingOverlay-style__LoadingOverlayStyled"]'
    },
    CLASS_NAMES: {
      STATUS_ICON: 'status-icon',
      HARMONY_ICON: 'harmony-icon',
      RELEASE_ICON: 'release-icon',
      ICONS_CONTAINER: 'button_container',
      BUTTON_MUSICBRAINZ: 'button_musicbrainz',
      BUTTON_HARMONY: 'button_harmony',
    },

    OBSERVER_CONFIG: {
      root: document,
      options: {
        subtree: true,
        childList: true
      }
    },
  };

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
    _getNestedProperty: function (obj, path) {
      return path.reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
    },

    /**
     * Retrieves the __NEXT_DATA__ object from the page.
     * @returns {object | null} The parsed __NEXT_DATA__ object, or null if not found or parsing fails.
     */
    _getNextData: function () {
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
    _getBasePathname: function (pathname) {
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
    getReleaseDataFromNextData: function () {
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
    getArtistAndReleaseFromMetaTags: function () {
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
    waitForElement: function (selector) {
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
    addMissingIcon: function (container, releaseUrl) {
      let iconLink = document.createElement("a");
      iconLink.className = `${Config.CLASS_NAMES.STATUS_ICON} ${Config.CLASS_NAMES.HARMONY_ICON}`;
      iconLink.href = getHarmonyImportUrl(releaseUrl);
      iconLink.target = "_blank";
      iconLink.title = "Import with Harmony"
      container.appendChild(iconLink);
      iconLink.onclick = function () {
        BeatportMusicBrainzImporter._mbApi.invalidateCacheForUrl(releaseUrl);
      };
    },

    /**
     * Creates and appends a "release" icon (linking to MusicBrainz) to the given container.
     * @param {string} container - The container element to which the icon will be appended.
     * @param {string} type - The MusicBrainz entity type (e.g., "release", "release-group").
     * @param {string} mbid - The MusicBrainz ID of the entity.
     */
    addReleaseIcon: function (container, type, mbid) {
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
    updateReleaseRow: async function (rowElement, releaseUrl, mbStatus) {
      const dateDiv = rowElement.querySelector(Config.SELECTORS.ANCHOR);
      if (!dateDiv) {
        return;
      }



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

      // Mark row as processed for this specific URL to handle React DOM recycling
      BeatportMusicBrainzImporter._processedRows.set(rowElement, releaseUrl);
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
    _createOpenWindowHandler: function (url) {
      return function () {
        window.open(url, '_blank').focus();
      };
    },

    /**
     * Adds an "Import with Harmony" button.
     * @param {HTMLElement} container - The container to append the button to.
     * @param {string} releaseUrl - The current Beatport release URL.
     */
    addHarmonyImportButton: function (container, releaseUrl) {
      let button = document.createElement("button");
      button.textContent = "Import with Harmony";
      button.className = `${Config.CLASS_NAMES.BUTTON_HARMONY}`;
      button.title = "Import with Harmony"
      button.onclick = function () {
        BeatportMusicBrainzImporter._mbApi.invalidateCacheForUrl(releaseUrl);
        window.open(getHarmonyImportUrl(releaseUrl), '_blank').focus();
      };

      container.appendChild(button);
    },

    /**
     * Adds an "Open in MusicBrainz" button.
     * @param {HTMLElement} container - The container to append the button to.
     * @param {string} type - The MusicBrainz entity type.
     * @param {string} mbid - The MusicBrainz ID.
     */
    addOpenMusicBrainzButton: function (container, type, mbid) {
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
    addSearchMusicBrainzButton: function (container, artist, release) {
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
    processReleasePageButtons: async function (mbStatus, releaseUrl) {
      const anchor = await Utils.waitForElement(Config.SELECTORS.RELEASE_CONTROLS_CONTAINER);
      if (!anchor) {
        return;
      }

      // Disconnect observer before modifying DOM - No longer needed as we use Next.js router events

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

      this.addHarmonyImportButton(container, releaseUrl);

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

      // BeatportMusicBrainzImporter._observerInstance.observe(Config.OBSERVER_CONFIG.root, Config.OBSERVER_CONFIG.options);
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
     * Checks if the current page is a specific release detail page.
     * @returns {boolean} True if on a release detail page, false otherwise.
     */
    isReleaseDetailPage: function () {
      const pathname = window.location.pathname;
      const basePathname = Utils._getBasePathname(pathname);
      return basePathname.startsWith('/release/');
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

    _log: function (msg) {
      console.log(`[MB Import] ${msg}`);
    },

    /**
     * Initializes the application: injects CSS and sets up the MutationObserver.
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
     * Hooks into the Next.js router to listen for navigation events.
     */
    _hookNextRouter: function () {
      const self = this;

      const checkContentAndTrigger = (observer, source) => {
        const isDetail = DOMScanner.isReleaseDetailPage();

        // Use the standard scanner. If it finds anything, it means NEW content has arrived.
        const itemsToProcess = DOMScanner.getReleasesToProcess();

        if (isDetail) {
          const controls = document.querySelector(Config.SELECTORS.RELEASE_CONTROLS_CONTAINER);
          // For detail pages, we just check if controls exist.
          if (controls) { // A bit naive, but Detail pages usually re-render the whole container
            if (observer) observer.disconnect();
            self.runUpdate();
            return true;
          }
        } else {
          // List Page
          if (itemsToProcess.length > 0) {
            if (observer) observer.disconnect();
            self.runUpdate();
            return true;
          }
        }

        return false;
      };

      const valCheckNext = () => {
        if (unsafeWindow.next && unsafeWindow.next.router && unsafeWindow.next.router.events) {
          unsafeWindow.next.router.events.on('routeChangeComplete', () => {

            // 1. Immediate check (in case synchronous update)
            if (checkContentAndTrigger(null, 'Immediate Check')) return;

            // 2. Observer for async updates
            const observer = new MutationObserver(() => {
              checkContentAndTrigger(observer, 'MutationObserver');
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
     * Main function to execute the process of scanning for releases, fetching data, and updating UI.
     * This function handles both status icons on list pages and import buttons on detail pages.
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

          const isDetailPage = DOMScanner.isReleaseDetailPage();
          let itemsToProcess = [];

          // 1. --- Gather Raw Items ---
          if (isDetailPage) {
            itemsToProcess.push({
              url: window.location.href,
              element: null
            });
          } else {
            itemsToProcess = DOMScanner.getReleasesToProcess();
            if (itemsToProcess.length === 0) {
              continue;
            }
          }

          // 2. --- Normalize Items & Group by URL ---
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

          // 3. --- Check API Cache & Instant Update ---
          uniqueUrls.forEach(url => {
            const cachedData = this._mbApi.getFromCache(url);
            if (cachedData !== undefined) {
              // The API cache stores the raw response object. We need to process it to get the status.
              let status = null;
              if (cachedData && cachedData.relations) {
                const releaseRelation = cachedData.relations.find(rel => rel['target-type'] === 'release' && rel.release);
                if (releaseRelation) {
                  status = [releaseRelation['target-type'], releaseRelation.release.id];
                }
              }
              // Note: If cachedData is null (e.g. 404), the status logic correctly results in null.
              mbStatusMap.set(url, status);
            } else {
              uncachedUrls.push(url);
            }
          });

          // Helper function to perform UI updates
          const updateUIForUrls = async (urls) => {
            for (const normalizedUrl of urls) {
              const status = mbStatusMap.get(normalizedUrl);
              const elements = urlToElementsMap.get(normalizedUrl);
              for (const element of elements) {
                if (isDetailPage) {
                  await ButtonManager.processReleasePageButtons(status, normalizedUrl);
                } else {
                  if (element && element.isConnected) {
                    await IconManager.updateReleaseRow(element, normalizedUrl, status);
                  }
                }
              }
            }
          };

          // Update cached items immediately
          await updateUIForUrls(uniqueUrls.filter(u => mbStatusMap.has(u)));

          // 4. --- Batch Lookup for Uncached Items ---
          if (uncachedUrls.length > 0) {
            try {
              // We use the batch lookup here to be efficient with network requests
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
                console.error(`[MB Import] Failed batch lookup`, error);
              }
              uncachedUrls.forEach(url => {
                mbStatusMap.set(url, null);
              });
            }

            // Update UI for newly fetched items
            await updateUIForUrls(uncachedUrls);
          }

        } while (this._scheduleUpdate);
      } catch (err) {
        console.error('[MB Import] Error in runUpdate:', err);
      } finally {
        this._runningUpdate = false;
      }
    }
  };

  BeatportMusicBrainzImporter.init();
})();