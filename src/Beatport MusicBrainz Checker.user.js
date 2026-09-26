// ==UserScript==
// @name         Beatport: MusicBrainz Checker
// @namespace    https://musicbrainz.org/user/chaban
// @version      2.8.1
// @description  Adds MusicBrainz status icons to Beatport releases on list pages and links missing releases for importing
// @tag          ai-created
// @author       RustyNova, chaban
// @license      MIT
// @match        https://www.beatport.com/*
// @connect      musicbrainz.org
// @require      ../lib/MusicBrainzAPI.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=beatport.com
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Checker.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Checker.user.js
// ==/UserScript==

(function () {
  'use strict';

  /**
   * Configuration object for endpoints, selectors, and import providers.
   */
  const Config = {
    USER_AGENT: 'UserJS.BeatportMusicBrainzChecker',
    MUSICBRAINZ_BASE_URL: 'https://musicbrainz.org/',
    MUSICBRAINZ_ICON_URL: 'https://raw.githubusercontent.com/metabrainz/musicbrainz-server/master/root/static/images/entity/release.svg',

    /**
     * Missing release action provider:
     * - 'auto': Automatically uses 'harmony' if Harmony Beatport Recovery (unsafeWindow.HBR) is installed, otherwise 'beatport'.
     * - 'beatport': Opens Beatport release page in a new tab for 1-click import via Murdos Beatport Importer.
     * - 'harmony': Opens Harmony import URL directly.
     */
    MISSING_RELEASE_PROVIDER: 'auto',

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
      RELEASE_LINK: 'a[href*="/release/"]:not(.status-icon)',
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
   * Resolves the effective missing release provider based on configuration
   * and runtime environment (auto-detects Harmony Beatport Recovery).
   * @returns {'harmony'|'beatport'} The active provider.
   */
  function getEffectiveMissingProvider() {
    if (Config.MISSING_RELEASE_PROVIDER !== 'auto') {
      return Config.MISSING_RELEASE_PROVIDER;
    }
    return unsafeWindow.HBR ? 'harmony' : 'beatport';
  }

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
   * @returns {string} The target URL based on the effective provider.
   */
  function getMissingReleaseUrl(releaseUrl) {
    if (getEffectiveMissingProvider() === 'harmony') {
      return getHarmonyImportUrl(releaseUrl);
    }
    return releaseUrl;
  }

  /**
   * Resolves the tooltip title for releases missing from MusicBrainz.
   * @returns {string} Tooltip description.
   */
  function getMissingReleaseTitle() {
    if (getEffectiveMissingProvider() === 'harmony') {
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
          const hasIcons = releaseRow.querySelector(Config.SELECTORS.ICONS_CONTAINER);

          if (lastProcessed !== normalizedUrl || !hasIcons) {
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
        user_agent: `${Config.USER_AGENT}/${GM.info.script.version} ( ${GM.info.script.namespace} )`
      });
      this._injectCSS();
      this._hookNextRouter();
      this._setupDOMObserver();
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

      const valCheckNext = () => {
        if (unsafeWindow.next?.router?.events) {
          unsafeWindow.next.router.events.on('routeChangeComplete', () => {
            self.runUpdate();
          });
          return;
        }

        setTimeout(valCheckNext, 500);
      };

      valCheckNext();
    },

    /**
     * Continuous debounced observer to restore status icons
     * when React re-renders table rows or after background session refreshes.
     */
    _setupDOMObserver: function () {
      let debounceTimer = null;
      const observer = new MutationObserver((mutations) => {
        const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
        if (!hasNewNodes) {
          return;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          if (DOMScanner.isSupportedPage() && DOMScanner.getReleasesToProcess().length > 0) {
            this.runUpdate();
          }
        }, 300);
      });

      observer.observe(document.body, { childList: true, subtree: true });
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

          // If DOM elements were replaced or added while fetching, schedule another pass
          if (DOMScanner.getReleasesToProcess().length > 0) {
            this._scheduleUpdate = true;
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