// ==UserScript==
// @name         Deezer: MusicBrainz importer
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Adds buttons for MusicBrainz, ListenBrainz, Harmony, ISRC Hunt and SAMBL to Deezer.
// @tag          ai-created
// @author       chaban
// @license      MIT
// @icon         https://www.deezer.com/favicon.ico
// @match        *://*.deezer.com/*
// @connect      musicbrainz.org
// @connect      listenbrainz.org
// @grant        GM.xmlHttpRequest
// @grant        GM.addStyle
// @require      ../lib/MusicBrainzAPI.js
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/Deezer%20MusicBrainz%20importer.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/Deezer%20MusicBrainz%20importer.user.js
// ==/UserScript==

(function () {
    'use strict';

    class main {
        static SCRIPT_NAME = GM.info.script.name;
        static SELECTORS = {
            ACTION_BAR: [
                '#page_content [data-testid="masthead"] ~ div .chakra-button__group',
                '#page_content [data-testid="masthead"] ~ div [role="group"]'
            ],
            TITLE: [
                '#page_content h1',
                '#page_content h2',
                '#page_content [data-testid="masthead"] h2'
            ],
            ARTIST_LINK: [
                '#page_content [data-testid="creator-name"]',
                '#page_content a[href*="/artist/"]',
                '#page_content [data-testid="artist"]'
            ],
            ALBUM_LINK_ON_TRACK_PAGE: [
                '#page_content a[href*="/album/"]',
                '#page_content [data-testid="album"]'
            ],
        };
        static URLS = {
            MUSICBRAINZ_BASE: 'https://musicbrainz.org',
            HARMONY_BASE: 'https://harmony.pulsewidth.org.uk/release',
            SAMBL_BASE: 'https://sambl.lioncat6.com',
            ISRCHUNT_BASE: 'https://isrchunt.com',
            LISTENBRAINZ_BASE: 'https://listenbrainz.org',
        };


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
                                finalReleaseUrl = `https://www.deezer.com/album/${albumInfo.id}`;
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
                        ? main.constructUrl(`${main.URLS.SAMBL_BASE}/artist`, { provider_id: pageInfo.id, provider: 'deezer', artist_mbid: mbInfo.mbid })
                        : main.constructUrl(`${main.URLS.SAMBL_BASE}/newartist`, { provider_id: pageInfo.id, provider: 'deezer' });
                },
            },
            ISRCHUNT: {
                id: 'isrc-hunt-button', text: 'Open in ISRC Hunt', className: 'import-button-isrc-hunt', color: '#3B82F6',
                pages: ['album'],
                getUrl: ({ normalizedUrl, pageInfo }) => main.constructUrl(`${main.URLS.ISRCHUNT_BASE}/deezer/importisrc`, {
                    releaseId: pageInfo.id,
                }),
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
            this.#mbApi = new MusicBrainzAPI({ user_agent: `${main.SCRIPT_NAME}/${GM.info.script.version} ( ${GM.info.script.namespace} )` });
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
                    this.#debounceTimer = setTimeout(() => this.#run(), 500);
                }
            });
            this.#observer.observe(document.body, { childList: true, subtree: true });
        }

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
                const actionBar = await main.waitForElement(main.SELECTORS.ACTION_BAR, 10000);

                this.#createButtonContainer(actionBar);

                this.#setupButtonsInLoadingState(pageInfo);

                const normalizedUrl = main.normalizeUrl(urlForThisRun);
                const initialContext = { pageInfo, normalizedUrl, runId };

                this.#updateButtonsWithData(initialContext);

                const needsMbInfo = Object.values(main.BUTTON_CONFIG).some(config => config.pages.includes(pageInfo.type) && config.requiresMbInfo);

                if (needsMbInfo) {
                    this.#fetchMusicBrainzInfo(urlForThisRun, pageInfo).then(mbInfo => {
                        if (this.#runId !== runId) return;
                        this.#updateButtonsWithData({ ...initialContext, mbInfo });
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
                    const needsLoading = config.requiresMbInfo || config.id === 'mb-import-lookup-button';
                    if (needsLoading) {
                        main.setButtonLoading(button, true);
                    }
                }
            }
        }

        #updateButtonsWithData(context) {
            for (const config of Object.values(main.BUTTON_CONFIG)) {
                const canSetUp = (!config.requiresMbInfo || context.mbInfo !== undefined);

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

            actionBar.appendChild(this.#buttonContainer);
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

        #cleanup() {
            document.getElementById('mb-script-button-container')?.remove();
            this.#buttonContainer = null;
        }

        #addStyles() {
            const staticStyles = `
                #mb-script-button-container { display: flex; align-items: center; margin-left: 8px; }
                .import-button {
                    border-radius: 4px; border: none; padding: 8px 12px; font-size: 0.9em; font-weight: 700; color: white;
                    cursor: pointer; margin: 0 4px; transition: all 0.2s ease; position: relative; text-decoration: none !important;
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

        async #fetchMusicBrainzInfo(url, pageInfo) {
            console.debug(`%c[${main.SCRIPT_NAME}] #fetchMusicBrainzInfo`, 'color: blue; font-weight: bold;', { url, pageInfo });
            const normalizedUrl = main.normalizeUrl(url);

            const incMap = {
                album: 'release-rels',
                artist: 'artist-rels',
                track: 'recording-rels',
            };
            const inc = incMap[pageInfo.type];

            const deezerToMbType = {
                album: 'release',
                artist: 'artist',
                track: 'recording',
            };
            const expectedMbType = deezerToMbType[pageInfo.type];

            try {
                const urlData = await this.#mbApi.lookupUrl(normalizedUrl, [inc]);
                if (!urlData || !Array.isArray(urlData.relations) || urlData.relations.length === 0) return null;

                const relation = urlData.relations.find(rel =>
                    rel['target-type'] === expectedMbType && rel[expectedMbType]
                );

                if (!relation) return null;

                const mbid = relation[expectedMbType].id;
                if (!mbid) return null;

                return { targetType: expectedMbType, mbid: mbid };

            } catch (error) {
                if (!error.message || !error.message.includes('404')) {
                    console.error(`${main.SCRIPT_NAME}: MB API request failed for ${normalizedUrl}`, error);
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
            const titleEl = main.querySelectorFromAlternatives(this.SELECTORS.TITLE);
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
            return (type !== 'unknown' && id) ? `https://www.deezer.com/${type}/${id}` : url;
        }

        static extractInfoFromUrl(url) {
            const match = url.match(/(?:https?:\/\/)?(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(album|artist|track|playlist)\/([0-9]+)/);
            return { type: match?.[1] || 'unknown', id: match?.[2] || null };
        }

        static gmXmlHttpRequest(options) {
            return new Promise((resolve, reject) => GM.xmlHttpRequest({ ...options, onload: resolve, onerror: reject, onabort: reject }));
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
