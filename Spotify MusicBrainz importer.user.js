// ==UserScript==
// @name         Spotify: MusicBrainz importer
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.1.0
// @tag          ai-created
// @description  Adds buttons for MusicBrainz, ListenBrainz, Harmony, ISRC Hunt and SAMBL to Spotify.
// @author       chaban, garylaski, RustyNova
// @license      MIT
// @icon         https://open.spotify.com/favicon.ico
// @match        *://*.spotify.com/*
// @connect      musicbrainz.org
// @grant        GM.xmlHttpRequest
// @grant        GM.addStyle
// ==/UserScript==

(function () {
    'use strict';

    class main {
        static SCRIPT_NAME = GM.info.script.name;
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
                '[data-testid="entityTitle"] ~ div a[href^="/album/"]',
                '[data-testid="track-page"] > div:first-child a[href^="/album/"]'
            ],
        };
        static URLS = {
            MUSICBRAINZ_API_BASE: 'https://musicbrainz.org/ws/2/url',
            MUSICBRAINZ_BASE: 'https://musicbrainz.org',
            HARMONY_BASE: 'https://harmony.pulsewidth.org.uk/release',
            LISTENBRAINZ_BASE: 'https://listenbrainz.org',
            SAMBL_BASE: 'https://sambl.lioncat6.com',
            ISRCHUNT_BASE: 'https://isrchunt.com',
        };

        static BUTTON_CONFIG = {
            HARMONY: {
                id: 'mb-import-harmony-button', text: 'Import with Harmony', className: 'import-button-harmony', color: '#c45555',
                pages: ['album', 'track'],
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
                        return main.constructUrl(`${main.URLS.MUSICBRAINZ_BASE}/search`, { query: `recording:"${title}" AND artist:"${artist}"`, type: 'recording' });
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
        };

        #urlCache = new Map();
        #currentUrl = '';
        #observer = null;
        #debounceTimer = null;
        #buttonContainer = null;

        constructor() {
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

        async #run() {
            console.debug(`${main.SCRIPT_NAME}: Running on ${this.#currentUrl}`);
            this.#cleanup();

            const pageInfo = main.extractInfoFromUrl(location.href);
            const supportedPages = [...new Set(Object.values(main.BUTTON_CONFIG).flatMap(config => config.pages))];

            if (!supportedPages.includes(pageInfo.type)) {
                console.debug(`${main.SCRIPT_NAME}: Not a supported page (${pageInfo.type}). Aborting.`);
                return;
            }

            try {
                const actionBar = await main.waitForElement(main.SELECTORS.ACTION_BAR, 5000);
                this.#createButtonContainer(actionBar);
                const normalizedUrl = main.normalizeUrl(location.href);

                const needsMbInfo = Object.values(main.BUTTON_CONFIG).some(config =>
                    config.pages.includes(pageInfo.type) && (config.requiresMbInfo || config.id === 'mb-import-lookup-button')
                );

                const mbInfo = needsMbInfo ? await this.#fetchMusicBrainzInfo(location.href, pageInfo) : null;

                if (location.href !== this.#currentUrl) {
                    console.debug(`${main.SCRIPT_NAME}: URL changed during async operation. Aborting update.`);
                    return;
                }

                this.#setupButtons({ pageInfo, mbInfo, normalizedUrl });

            } catch (error) {
                console.error(`${main.SCRIPT_NAME}: Failed to initialize buttons.`, error);
            }
        }


        #setupButtons(context) {
            for (const config of Object.values(main.BUTTON_CONFIG)) {
                this.#setupButtonFromConfig(config, context);
            }
        }

        #setupButtonFromConfig(config, context) {
            const { pageInfo, mbInfo } = context;

            if (!config.pages.includes(pageInfo.type)) return;
            if (config.requiresMbInfo && !mbInfo) return;

            const button = this.#createOrUpdateButton(config);
            if (!button) return;

            if (config.getText) {
                main.setButtonText(button, config.getText(context));
            }

            const url = config.getUrl(context);
            main.setButtonLoading(button, false);

            if (url) {
                button.href = url.toString();
                button.classList.remove('disabled');

            } else {
                button.classList.add('disabled');
                if (config.id === 'mb-import-lookup-button') {
                    main.setButtonText(button, 'Info N/A');
                }
            }
        }


        #createButtonContainer(actionBar) {
            this.#buttonContainer = document.createElement('div');
            this.#buttonContainer.id = 'mb-script-button-container';
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
                @keyframes spin { to { transform: translate(-50%, -50%) rotate(360deg); } }
            `;
            const dynamicStyles = main.generateDynamicStyles();
            GM.addStyle(staticStyles + dynamicStyles);
        }

        async #fetchMusicBrainzInfo(url, pageInfo) {
            const normalizedUrl = main.normalizeUrl(url);
            if (this.#urlCache.has(normalizedUrl)) {
                return this.#urlCache.get(normalizedUrl);
            }

            const incMap = {
                album: 'release-rels',
                artist: 'artist-rels',
                track: 'recording-rels',
            };
            const inc = incMap[pageInfo.type];

            try {
                const res = await main.gmXmlHttpRequest({
                    url: main.constructUrl(main.URLS.MUSICBRAINZ_API_BASE, { limit: 1, fmt: 'json', inc, resource: normalizedUrl }),
                    method: 'GET',
                    responseType: 'json',
                });
                if (res.status !== 200 || !res.response?.relations?.length) {
                    this.#urlCache.set(normalizedUrl, null); return null;
                }
                const relation = res.response.relations[0];
                const result = { targetType: relation['target-type'], mbid: relation[relation['target-type']].id };
                this.#urlCache.set(normalizedUrl, result);
                return result;
            } catch (error) {
                console.error(`${main.SCRIPT_NAME}: MB API request failed for ${normalizedUrl}`, error);
                this.#urlCache.set(normalizedUrl, null);
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
