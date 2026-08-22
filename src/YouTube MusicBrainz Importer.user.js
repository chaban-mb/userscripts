// ==UserScript==
// @name        YouTube: MusicBrainz Importer
// @namespace   https://musicbrainz.org/user/chaban
// @version     2.12.0
// @description Imports YouTube videos to MusicBrainz as a new standalone recording
// @tag         ai-created
// @author      nikki, RustyNova, chaban
// @license     MIT
// @match       *://www.youtube.com/*
// @match       *://*.musicbrainz.org/recording/create*
// @connect     musicbrainz.org
// @connect     listenbrainz.org
// @require     ../lib/MusicBrainzAPI.js
// @icon        https://www.google.com/s2/favicons?sz=256&domain=youtube.com
// @grant       GM.xmlHttpRequest
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.deleteValue
// @grant       GM.registerMenuCommand
// @run-at      document-end
// @noframes
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20MusicBrainz%20Importer.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20MusicBrainz%20Importer.user.js
// ==/UserScript==

//**************************************************************************//
// Based on the "Import videos from YouTube as release" script by RustyNova
// and the original "Import videos from YouTube as recording" script by nikki et al.
//**************************************************************************//

(function () {
    'use strict';

    /**
     * Localization module to handle translations.
     */
    const L10n = {
        _language: (document.documentElement.lang || navigator.language || navigator.userLanguage).split('-')[0],
        _strings: {
            en: {
                loading: 'Loading...',
                addRecording: 'Add Recording',
                updateLength: 'Update Length',
                onMB: 'On MB ✓',
                onMBArtist: 'Artist on MB ✓',
                onMBLabel: 'Label on MB ✓',
                onMBMulti: 'On MB (Multi) ✓',
                addRecordingTitle: 'Add to MusicBrainz as recording',
                updateLengthTitle: 'The linked MusicBrainz recording is missing its length. Click to update it to {length}s.',
                linkedToRecordingTitle: 'This YouTube video is linked to MusicBrainz recording: {title}',
                linkedToMultiTitle: 'This YouTube video/channel is linked to multiple entities on MusicBrainz.\nClick to view URL entity page.',
                errorVideoNotFound: 'Video Not Found / YT API Error',
                errorApiRateLimit: '{apiName} Rate Limit / Server Error',
                errorApiNetwork: '{apiName} Network Error',
                errorProcessing: 'Processing Error',
                // Channel specific strings
                searchAddMB: 'Add to MB',
                searchAddMBTitle: 'Search or add {name} on MusicBrainz',
                // Playlist specific strings
                createPlaylist: 'Create LB Playlist',
                syncPlaylist: 'Sync LB Playlist',
                onLB: 'On LB (Playlist) ✓',
                createPlaylistTitle: 'Create a new ListenBrainz playlist from this video\'s tracklist.',
                syncPlaylistTitle: 'This playlist is marked as [INCOMPLETE] on ListenBrainz. Click to sync with the current tracklist.',
                linkedToPlaylistTitle: 'This video is linked to a ListenBrainz playlist: {title}',
                playlistInProgress: 'Processing...',
                tokenMissing: 'Set LB Token!',
                tokenMissingTitle: 'Click to set your ListenBrainz token',
                viewReport: 'View Report',
                viewReportTitle: 'View list of unmatched/unparsed tracks from the video description.',
            },
            de: {
                loading: 'Wird geladen...',
                addRecording: 'Aufnahme hinzufügen',
                updateLength: 'Länge aktualisieren',
                onMB: 'Auf MB ✓',
                onMBArtist: 'Künstler auf MB ✓',
                onMBLabel: 'Label auf MB ✓',
                onMBMulti: 'Auf MB (Multi) ✓',
                addRecordingTitle: 'Als Aufnahme zu MusicBrainz hinzufügen',
                updateLengthTitle: 'Bei der verknüpften MusicBrainz-Aufnahme fehlt die Länge. Klicken, um sie auf {length}s zu aktualisieren.',
                linkedToRecordingTitle: 'Dieses YouTube-Video ist mit der MusicBrainz-Aufnahme verknüpft: {title}',
                linkedToMultiTitle: 'Dieses YouTube-Video bzw. dieser Kanal ist mit mehreren Entitäten auf MusicBrainz verknüpft.\nKlicken, um die URL-Entitätsseite anzuzeigen.',
                errorVideoNotFound: 'Video nicht gefunden / YT API-Fehler',
                errorApiRateLimit: '{apiName} Ratenlimit / Serverfehler',
                errorApiNetwork: '{apiName} Netzwerkfehler',
                errorProcessing: 'Verarbeitungsfehler',
                // Channel specific strings
                searchAddMB: 'Zu MB hinzufügen',
                searchAddMBTitle: '{name} auf MusicBrainz suchen oder hinzufügen',
                // Playlist specific strings
                createPlaylist: 'LB-Playlist erstellen',
                syncPlaylist: 'LB-Playlist synchronisieren',
                onLB: 'Auf LB (Playlist) ✓',
                createPlaylistTitle: 'Eine neue ListenBrainz-Playlist aus der Trackliste dieses Videos erstellen.',
                syncPlaylistTitle: 'Diese Playlist ist auf ListenBrainz als [INCOMPLETE] markiert. Klicken, um mit der aktuellen Trackliste zu synchronisieren.',
                linkedToPlaylistTitle: 'Dieses Video ist mit einer ListenBrainz-Playlist verknüpft: {title}',
                playlistInProgress: 'Verarbeite...',
                tokenMissing: 'LB-Token setzen!',
                tokenMissingTitle: 'Klicken, um Ihr ListenBrainz-Token festzulegen',
                viewReport: 'Bericht anzeigen',
                viewReportTitle: 'Liste der nicht zugeordneten und nicht verarbeiteten Titel aus der Videobeschreibung anzeigen.',
            }
        },
        getString: function (key, substitutions) {
            const langStrings = this._strings[this._language] || this._strings.en;
            let str = langStrings[key] || this._strings.en[key] || `L10N_ERROR: ${key}`;
            if (substitutions) {
                for (const subKey in substitutions) {
                    str = str.replace(`{${subKey}}`, substitutions[subKey]);
                }
            }
            return str;
        }
    };

    /**
     * Configuration object to centralize all constants and selectors.
     */
    const Config = {
        SHORT_APP_NAME: 'UserJS.YoutubeImport',
        MUSICBRAINZ_API_ROOT: 'https://musicbrainz.org/ws/2/',
        LISTENBRAINZ_API_ROOT: 'https://api.listenbrainz.org/1/',
        TOKEN_STORAGE_KEY: 'listenbrainz_user_token',

        MAX_RETRIES: 5,
        INITIAL_RETRY_DELAY_MS: 1000,
        RETRY_BACKOFF_FACTOR: 2,

        SELECTORS: {
            BUTTON_DOCK: '#top-row.ytd-watch-metadata #owner.ytd-watch-metadata',
            BUTTON_DOCK_FALLBACK: '#top-row.ytd-watch-metadata #actions.ytd-watch-metadata',
            CHANNEL_DOCK: 'yt-page-header-view-model yt-flexible-actions-view-model, yt-page-header-view-model subscribe-button-view-model, ytd-page-header-renderer #page-header-actions, ytd-page-header-renderer ytd-subscribe-button-renderer, ytd-c4-tabbed-header-renderer #buttons, #inner-header-container #buttons',
            MUSICBRAINZ_MAIN_VIDEO_CHECKBOX: '[name="edit-recording.video"]',
            MUSICBRAINZ_EXTERNAL_LINKS_EDITOR: '#external-links-editor',
            MUSICBRAINZ_INDIVIDUAL_VIDEO_CHECKBOX: '.relationship-item input[type="checkbox"]',
        },

        CLASS_NAMES: {
            CONTAINER: 'musicbrainz-userscript-container',
            BUTTON_RENDERER: 'musicbrainz-button-renderer',
        },

        MUSICBRAINZ_FREE_STREAMING_LINK_TYPE_ID: '268',
        MUSICBRAINZ_FREE_STREAMING_RELATION_TYPE_ID: '7e41ef12-a124-4324-afdb-fdbae687a89c',
    };

    const USER_AGENT = `${Config.SHORT_APP_NAME}/${GM_info.script.version} ( ${GM_info.script.namespace} )`;

    /**
     * Manages the ListenBrainz user token.
     */
    const TokenManager = {
        _token: null,
        async init() {
            this._token = await GM.getValue(Config.TOKEN_STORAGE_KEY, null);
            GM.registerMenuCommand('Set ListenBrainz Token', async () => {
                const success = await this.setToken();
                if (success) {
                    const currentVideoId = DOMScanner.getVideoId();
                    if (currentVideoId) {
                        YouTubeMusicBrainzImporter.triggerUpdate(currentVideoId);
                    }
                }
            });
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
            if (token === null) {
                return false;
            }
            const trimmedToken = token.trim();
            if (trimmedToken === '') {
                this._token = null;
                await GM.deleteValue(Config.TOKEN_STORAGE_KEY);
                alert('ListenBrainz token cleared!');
                return true;
            } else {
                this._token = trimmedToken;
                await GM.setValue(Config.TOKEN_STORAGE_KEY, this._token);
                alert('ListenBrainz token saved!');
                return true;
            }
        }
    };

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /**
     * Crisp, optimized inline SVG definitions for YouTube button iconography.
     */
    const SVGIcons = {
        musicbrainz: {
            viewBox: '0 0 27 30',
            paths: ['M13 1 1 8v14l12 7V1zm1 0 12 7v14l-12 7V1z']
        },
        listenbrainz: {
            viewBox: '0 0 24 24',
            paths: ['M12 4.5a9 9 0 0 0-9 9v3a3 3 0 0 0 3 3h1v-6H5a7 7 0 1 1 14 0h-2v6h1a3 3 0 0 0 3-3v-3a9 9 0 0 0-9-9zm-4 9h2v4H8zm6 0h2v4h-2z']
        },
        sync: {
            viewBox: '0 0 24 24',
            paths: ['M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z']
        },
        clock: {
            viewBox: '0 0 24 24',
            paths: ['M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z']
        },
        report: {
            viewBox: '0 0 24 24',
            paths: ['M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z']
        },
        alert: {
            viewBox: '0 0 24 24',
            paths: ['M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z']
        },
        spinner: {
            viewBox: '0 0 24 24',
            isSpinner: true,
            circle: { cx: '12', cy: '12', r: '9', strokeOpacity: '0.25' },
            path: { d: 'M12 3a9 9 0 0 1 9 9', strokeLinecap: 'round' }
        },
        // --- Reference SVG Definitions ---
        checkmark: {
            viewBox: '0 0 24 24',
            paths: ['M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z']
        },
        plus: {
            viewBox: '0 0 24 24',
            paths: ['M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z']
        },
        externalLink: {
            viewBox: '0 0 24 24',
            paths: ['M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z']
        }
    };

    /**
     * Builds a native SVGSVGElement without triggering TrustedHTML / DOMParser restrictions.
     * @param {Object|null} iconDef
     * @returns {SVGSVGElement|null}
     */
    function createSvgElement(iconDef) {
        if (!iconDef) return null;
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', iconDef.viewBox || '0 0 24 24');
        svg.setAttribute('width', '20');
        svg.setAttribute('height', '20');

        if (iconDef.isSpinner) {
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2.5');
            svg.setAttribute('class', 'yt-spec-button-shape-next__spinner');

            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', iconDef.circle.cx);
            circle.setAttribute('cy', iconDef.circle.cy);
            circle.setAttribute('r', iconDef.circle.r);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', 'currentColor');
            circle.setAttribute('stroke-width', '2.5');
            circle.setAttribute('stroke-opacity', iconDef.circle.strokeOpacity);
            svg.appendChild(circle);

            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', iconDef.path.d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '2.5');
            path.setAttribute('stroke-linecap', iconDef.path.strokeLinecap);
            svg.appendChild(path);
        } else {
            svg.setAttribute('fill', 'currentColor');
            (iconDef.paths || []).forEach(d => {
                const path = document.createElementNS(SVG_NS, 'path');
                path.setAttribute('d', d);
                svg.appendChild(path);
            });
        }
        return svg;
    }

    /**
     * Modular factory and state manager for native-styled YouTube buttons.
     */
    class YTButton {
        /**
         * @param {Object} options
         * @param {string} [options.id]
         * @param {'button'|'a'} [options.tag='button']
         * @param {'button'|'submit'} [options.type='button']
         * @param {string} [options.label='']
         * @param {string} [options.title='']
         * @param {Object|null} [options.icon=null] - SVG icon definition
         * @param {string} [options.variant='tonal'] - 'tonal' | 'brand-mb' | 'brand-lb' | 'update' | 'sync' | 'report' | 'error' | 'info'
         * @param {string} [options.href='']
         * @param {string} [options.target='_blank']
         * @param {boolean} [options.disabled=false]
         * @param {Function} [options.onClick]
         */
        constructor(options = {}) {
            this.container = document.createElement('div');
            this.container.className = `musicbrainz-button-renderer ${Config.CLASS_NAMES.BUTTON_RENDERER}`;

            this.tag = options.tag || (options.href ? 'a' : 'button');
            this.element = document.createElement(this.tag);
            this.element.className = 'ytSpecButtonShapeNextHost ytSpecButtonShapeNextSizeM ytSpecButtonShapeNextMono yt-spec-button-shape-next ytSpecButtonShapeNextEnableBackdropFilterExperiment ytSpecButtonShapeNextMainstageIconSize ytSpecButtonShapeNextMainstagePadding';

            if (this.tag === 'button') {
                this.element.type = options.type || 'button';
            }

            this._currentIcon = null;
            this._originalIcon = null;

            this.iconContainer = document.createElement('div');
            this.iconContainer.className = 'ytSpecButtonShapeNextIcon ytSpecButtonShapeNextElevatedContent yt-spec-button-shape-next__icon';
            this.iconContainer.setAttribute('aria-hidden', 'true');
            this.iconContainer.style.display = 'none';

            this.textContainer = document.createElement('div');
            this.textContainer.className = 'ytSpecButtonShapeNextButtonTextContent ytSpecButtonShapeNextElevatedContent yt-spec-button-shape-next__button-text-content';

            this.textSpan = document.createElement('span');
            this.textSpan.className = 'ytAttributedStringHost ytAttributedStringWhiteSpaceNoWrap';
            this.textSpan.setAttribute('role', 'text');
            this.textContainer.appendChild(this.textSpan);

            this.element.appendChild(this.iconContainer);
            this.element.appendChild(this.textContainer);
            this.container.appendChild(this.element);

            this.update(options);
        }

        _renderIcon(icon) {
            while (this.iconContainer.firstChild) {
                this.iconContainer.removeChild(this.iconContainer.firstChild);
            }
            const svgNode = createSvgElement(icon);
            if (svgNode) {
                this.iconContainer.appendChild(svgNode);
                this.iconContainer.style.display = 'inline-flex';
                this.element.classList.add('ytSpecButtonShapeNextIconLeading', 'yt-spec-button-shape-next--icon-leading');
            } else {
                this.iconContainer.style.display = 'none';
                this.element.classList.remove('ytSpecButtonShapeNextIconLeading', 'yt-spec-button-shape-next--icon-leading');
            }
        }

        update({ label, title, icon, variant, href, target, disabled, onClick }) {
            if (label !== undefined) {
                this.textSpan.textContent = label;
                this.element.setAttribute('aria-label', label);
            }
            if (title !== undefined) {
                this.element.title = title;
            }
            if (icon !== undefined) {
                this._currentIcon = icon;
                this._originalIcon = null;
                this._renderIcon(icon);
            }
            if (variant !== undefined) {
                this.element.className = this.element.className.replace(/yt-spec-button-shape-next--(brand-mb|brand-lb|update|sync|report|error|info|tonal|mono)|ytSpecButtonShapeNext(Tonal|Filled)/g, '').trim();
                const variantClass = variant === 'tonal'
                    ? 'ytSpecButtonShapeNextTonal yt-spec-button-shape-next--tonal'
                    : `ytSpecButtonShapeNextFilled yt-spec-button-shape-next--${variant}`;
                this.element.className = `${this.element.className} ${variantClass}`.replace(/\s+/g, ' ').trim();
            }
            if (href !== undefined && this.tag === 'a') {
                this.element.href = href;
                if (target !== undefined) this.element.target = target;
            }
            if (disabled !== undefined) {
                if (this.tag === 'button') {
                    this.element.disabled = disabled;
                } else {
                    this.element.classList.toggle('disabled', disabled);
                    if (disabled) {
                        this.element.removeAttribute('href');
                    }
                }
                if (!disabled) {
                    this.setPending(false);
                }
            }
            if (onClick !== undefined) {
                if (this._clickHandler) {
                    this.element.removeEventListener('click', this._clickHandler);
                }
                if (onClick) {
                    this._clickHandler = onClick;
                    this.element.addEventListener('click', this._clickHandler);
                }
            }
        }

        setPending(isPending) {
            this.container.style.opacity = isPending ? '0.7' : '';
            this.container.style.pointerEvents = isPending ? 'none' : '';
            if (this.tag === 'button') {
                this.element.disabled = isPending;
            }
            if (isPending) {
                if (!this._originalIcon && this._currentIcon) {
                    this._originalIcon = this._currentIcon;
                }
                this._renderIcon(SVGIcons.spinner);
            } else if (this._originalIcon) {
                this._renderIcon(this._originalIcon);
                this._originalIcon = null;
            }
        }

        show() {
            this.container.style.display = 'inline-flex';
        }

        hide() {
            this.container.style.display = 'none';
        }
    }

    /**
     * General utility functions.
     */
    const Utils = {
        /**
         * Waits for an element matching the given CSS selector to appear in the DOM.
         * @param {string} selector - The CSS selector of the element to wait for.
         * @param {number} timeout - The maximum time (in milliseconds) to wait for the element.
         * @returns {Promise<Element>} A promise that resolves with the element once found, or rejects on timeout.
         */
        waitForElement: function (selector, timeout = 15000) {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    return;
                }

                let observer;
                const timer = setTimeout(() => {
                    if (observer) observer.disconnect();
                    reject(new Error(`Timeout waiting for element with selector: ${selector}`));
                }, timeout);

                observer = new MutationObserver(() => {
                    const targetElement = document.querySelector(selector);
                    if (targetElement) {
                        clearTimeout(timer);
                        observer.disconnect();
                        resolve(targetElement);
                    }
                });
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            });
        },

        /**
         * Safely extracts plain text from various YouTube internal title/text renderer object shapes.
         * @param {*} obj - The text object, runs array, or string from YouTube renderer payloads.
         * @returns {string}
         */
        extractTextFromYtObject: function (obj) {
            if (!obj) return '';
            if (typeof obj === 'string') return obj.trim();
            if (typeof obj.content === 'string') return obj.content.trim();
            if (typeof obj.text === 'string') return obj.text.trim();
            if (typeof obj.simpleText === 'string') return obj.simpleText.trim();
            if (Array.isArray(obj.runs)) {
                return obj.runs.map(r => r?.text || '').join('').trim();
            }
            if (obj.dynamicTextViewModel) {
                return this.extractTextFromYtObject(obj.dynamicTextViewModel.text || obj.dynamicTextViewModel);
            }
            if (obj.title) {
                return this.extractTextFromYtObject(obj.title);
            }
            if (obj.pageTitle) {
                return this.extractTextFromYtObject(obj.pageTitle);
            }
            return '';
        },

        /**
         * Performs an asynchronous HTTP request using GM.xmlHttpRequest with retry logic and exponential backoff.
         * @param {Object} details - The GM.xmlHttpRequest details object (method, url, headers, data).
         * @param {string} apiName - Name of the API for logging (e.g., "YouTube API", "MusicBrainz API").
         * @param {number} [currentRetry=0] - The current retry attempt.
         * @returns {Promise<Object>} A promise that resolves with the response object or rejects on error/exhausted retries.
         */
        gmXmlHttpRequest: function (details, apiName, currentRetry = 0) {
            const headers = {
                "Referer": location.origin,
                "Origin": location.origin,
                ...details.headers
            };

            return new Promise((resolve, reject) => {
                console.debug(`[${GM.info.script.name}] [XHR Start] Sending request for ${apiName}. URL: ${details.url}`);
                try {
                    GM.xmlHttpRequest({
                        method: details.method || 'GET',
                        url: details.url,
                        headers: headers,
                        data: details.data || null,
                        anonymous: details.anonymous || false,
                        timeout: details.timeout || 10000,
                        onload: (response) => {
                            console.debug(`[${GM.info.script.name}] [XHR Callback] onload received for ${apiName}. Status: ${response.status}`);
                            if (response.status >= 200 && response.status < 300) {
                                resolve(response);
                            } else if (response.status === 503 && currentRetry < Config.MAX_RETRIES) {
                                const delay = Config.INITIAL_RETRY_DELAY_MS * Math.pow(Config.RETRY_BACKOFF_FACTOR, currentRetry);
                                console.warn(`[${GM.info.script.name}] ${apiName} returned 503. Retrying in ${delay}ms (attempt ${currentRetry + 1}/${Config.MAX_RETRIES}).`);
                                setTimeout(() => {
                                    Utils.gmXmlHttpRequest(details, apiName, currentRetry + 1)
                                        .then(resolve)
                                        .catch(reject);
                                }, delay);
                            } else {
                                if (!(response.status === 404 && apiName === 'MusicBrainz API')) {
                                    console.error(`[${GM.info.script.name}] ${apiName} request failed with status ${response.status}.`);
                                }
                                const error = new Error(`Request to ${apiName} failed with status ${response.status}: ${response.responseText}`);
                                error.status = response.status;
                                error.apiName = apiName;
                                reject(error);
                            }
                        },
                        onerror: (response) => {
                            console.error(`[${GM.info.script.name}] [XHR Callback] onerror received for ${apiName}. Response details:`, response);
                            if (!navigator.onLine) {
                                console.debug(`[${GM.info.script.name}] Offline detected. Waiting for network...`);
                                const waitForOnline = () => new Promise(resolve => {
                                    const handler = () => {
                                        window.removeEventListener('online', handler);
                                        resolve();
                                    };
                                    window.addEventListener('online', handler);
                                });

                                waitForOnline().then(() => {
                                    console.debug(`[${GM.info.script.name}] Network restored. Retrying...`);
                                    Utils.gmXmlHttpRequest(details, apiName, currentRetry)
                                        .then(resolve)
                                        .catch(reject);
                                });
                                return;
                            }

                            const error = new Error(`Network error for ${apiName}: ${response.statusText}`);
                            error.status = response.status;
                            error.apiName = apiName;
                            reject(error);
                        },
                        ontimeout: () => {
                            console.error(`[${GM.info.script.name}] [XHR Callback] ontimeout received for ${apiName}.`);
                            const error = new Error(`Request to ${apiName} timed out`);
                            error.status = 408;
                            error.apiName = apiName;
                            reject(error);
                        },
                        onabort: () => {
                            console.error(`[${GM.info.script.name}] [XHR Callback] onabort received for ${apiName}.`);
                            const error = new Error(`Request to ${apiName} aborted`);
                            error.status = 0;
                            error.apiName = apiName;
                            reject(error);
                        }
                    });
                    console.debug(`[${GM.info.script.name}] [XHR Scheduled] GM.xmlHttpRequest scheduled successfully for ${apiName}.`);
                } catch (err) {
                    console.error(`[${GM.info.script.name}] [XHR Exception] Direct crash scheduling GM.xmlHttpRequest for ${apiName}:`, err);
                    reject(err);
                }
            });
        },


        /**
         * Parses a block of text for track information using multiple regex patterns.
         * @param {string} text The raw text (e.g., YouTube description).
         * @returns {{parsedTracks: Array<Object>, unparsedLines: Array<string>}}
         */
        parseTracklist: function (text) {
            if (!text) {
                return { parsedTracks: [], unparsedLines: [] };
            }
            const tracklistPatterns = [
                { // Format: StartTime - EndTime Artist - Title
                    regex: /^((?:\d+:)?\d+:\d+)\s*[-–—]\s*(?:\d+:)?\d+\s+(.+?)\s*[-–—]\s*(.+)$/,
                    map: (match) => ({ timestampStr: match[1], artist: match[2], title: match[3] })
                },
                { // Format: Timestamp - Artist - Title
                    regex: /^((?:\d+:)?\d+:\d+)\s*[-–—]\s*(.+?)\s*[-–—]\s*(.+)$/,
                    map: (match) => ({ timestampStr: match[1], artist: match[2], title: match[3] })
                },
                { // Format: Timestamp [Artist] - Title or Timestamp Artist - Title
                    regex: /^((?:\d+:)?\d+:\d+)\s+(?:\[(.+?)\]|(.+?))\s*[-–—]\s*(.+)$/,
                    map: (match) => ({ timestampStr: match[1], artist: match[2] || match[3], title: match[4] })
                },
                { // Format: Artist - Title (Timestamp)
                    regex: /^(.+?)\s*[-–—]\s*(.+?)\s+\(?((\d+:)?\d+:\d+)\)?$/,
                    map: (match) => ({ artist: match[1], title: match[2], timestampStr: match[3] })
                },
                { // Format: (Timestamp): Artist - Title
                    regex: /^\(((?:\d+:)?\d+:\d+)\):?\s+(.+?)\s*[-–—]\s*(.+)$/,
                    map: (match) => ({ timestampStr: match[1], artist: match[2], title: match[3] })
                },
                { // Format: Title StartTime - EndTime OR Artist - Title StartTime - EndTime
                    regex: /^(.+?)(?:\s*[-–—]\s*(.+?))?\s+((?:\d+:)?\d+:\d+)\s*[-–—]\s*(?:\d+:)?\d+:\d+$/,
                    map: (match) => ({
                        timestampStr: match[3],
                        artist: match[2] ? match[1] : '',
                        title: match[2] || match[1]
                    })
                }
            ];

            const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
            const parsedTracks = [];
            const unparsedLines = [];

            for (const line of lines) {
                let matched = false;
                for (const pattern of tracklistPatterns) {
                    const match = line.match(pattern.regex);
                    if (match) {
                        const { timestampStr, artist, title } = pattern.map(match);
                        const timeParts = timestampStr.split(':').map(Number);
                        let timestampSeconds = 0;
                        if (timeParts.length === 2) { // MM:SS
                            timestampSeconds = timeParts[0] * 60 + timeParts[1];
                        } else if (timeParts.length === 3) { // HH:MM:SS
                            timestampSeconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];
                        }

                        // Use the matched artist, or the fallback channel name if missing
                        const finalArtist = artist ? artist.trim() : fallbackArtist.trim();

                        parsedTracks.push({
                            artist: finalArtist,
                            title: title.trim(),
                            timestamp: timestampStr.trim(),
                            timestampSeconds,
                            originalLine: line
                        });

                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    unparsedLines.push(line);
                }
            }
            return { parsedTracks, unparsedLines };
        },

        /**
         * Finds the Longest Common Subsequence (LCS) of two arrays.
         * @param {Array<any>} arr1
         * @param {Array<any>} arr2
         * @returns {Array<any>}
         */
        findLCS: function (arr1, arr2) {
            const m = arr1.length;
            const n = arr2.length;
            const dp = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

            for (let i = 1; i <= m; i++) {
                for (let j = 1; j <= n; j++) {
                    if (arr1[i - 1] === arr2[j - 1]) {
                        dp[i][j] = 1 + dp[i - 1][j - 1];
                    } else {
                        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                    }
                }
            }

            // Backtrack from dp[m][n] to reconstruct the LCS
            const lcs = [];
            let i = m, j = n;
            while (i > 0 && j > 0) {
                if (arr1[i - 1] === arr2[j - 1]) {
                    lcs.unshift(arr1[i - 1]);
                    i--; j--;
                } else if (dp[i - 1][j] > dp[i][j - 1]) {
                    i--;
                } else {
                    j--;
                }
            }
            return lcs;
        },

        /**
         * Groups a sorted list of deletion indices into consecutive chunks for batching.
         * @param {number[]} indices - A list of indices to delete, sorted in descending order.
         * @returns {Array<{index: number, count: number}>} An array of chunks to delete.
         */
        groupDeletions: function (indices) {
            if (indices.length === 0) {
                return [];
            }

            const groups = [];
            let currentGroup = { index: indices[0], count: 1 };

            for (let i = 1; i < indices.length; i++) {
                if (indices[i] === currentGroup.index - 1) {
                    currentGroup.index = indices[i];
                    currentGroup.count++;
                } else {
                    groups.push(currentGroup);
                    currentGroup = { index: indices[i], count: 1 };
                }
            }
            groups.push(currentGroup);
            return groups;
        }
    };



    /**
     * Diagnostic module to extract YouTube video metadata directly from in-page window objects / DOM
     * and compare it against the YouTube Data API response.
     */
    const InPageDataExtractor = {
        _lastEventDetail: null,

        initEventListeners() {
            document.addEventListener('yt-navigate-finish', (event) => {
                this._lastEventDetail = event.detail;
            });
        },

        /**
         * Returns the raw player response currently cached or stored in window variables.
         * @returns {Object|null}
         */
        getRawPlayerResponse() {
            let playerResponse = null;
            if (this._lastEventDetail?.response) {
                const resp = this._lastEventDetail.response;
                playerResponse = resp.playerResponse || resp.endpoint?.watchEndpoint?.playerResponse;
            }
            if (!playerResponse && window.ytInitialPlayerResponse) {
                playerResponse = window.ytInitialPlayerResponse;
            }
            return playerResponse;
        },

        /**
         * Extracts video data from in-page player objects or window globals for a given video ID.
         * @param {string} videoId
         * @returns {Object|null}
         */
        extractVideoData(videoId) {
            const playerResponse = this.getRawPlayerResponse();

            // 3. Check movie_player DOM component fallback
            const moviePlayer = document.getElementById('movie_player');
            const moviePlayerData = moviePlayer?.getVideoData?.();
            const videoDetails = playerResponse?.videoDetails;

            const title = videoDetails?.title || moviePlayerData?.title || document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.innerText || '';
            const channelTitle = videoDetails?.author || moviePlayerData?.author || document.querySelector('#owner #channel-name a')?.innerText || '';
            const channelId = videoDetails?.channelId || '';

            // Extract channel handle if present in owner link or player metadata
            const channelHandle = document.querySelector('#owner a[href*="/@"]')?.getAttribute('href')?.match(/\/(@[A-Za-z0-9_.-]+)/)?.[1]
                || playerResponse?.microformat?.playerMicroformatRenderer?.ownerProfileUrl?.match(/\/(@[A-Za-z0-9_.-]+)/)?.[1]
                || null;

            if (channelId && channelHandle) {
                DOMScanner.cacheChannelId(channelHandle, channelId);
            }

            let durationSeconds = 0;
            const microformatSec = playerResponse?.microformat?.playerMicroformatRenderer?.lengthSeconds;
            if (microformatSec) {
                durationSeconds = parseInt(microformatSec, 10);
            }

            // Extract direct milliseconds strictly from adaptiveFormats.approxDurationMs without video element fallback
            let directMs = 0;
            const adaptiveFormat = playerResponse?.streamingData?.adaptiveFormats?.[0];
            if (adaptiveFormat?.approxDurationMs) {
                directMs = parseInt(adaptiveFormat.approxDurationMs, 10);
            }

            const description = (
                videoDetails?.shortDescription
                ?? playerResponse?.microformat?.playerMicroformatRenderer?.description?.simpleText
                ?? document.querySelector('meta[name="description"]')?.content
                ?? document.querySelector('#description-inline-expander #plain-snippet-text')?.innerText
                ?? document.querySelector('#description-inline-expander yt-attributed-string')?.innerText
                ?? ''
            ).trim();

            const category = playerResponse?.microformat?.playerMicroformatRenderer?.category
                || document.querySelector('meta[itemprop="genre"]')?.content
                || '';

            if (!title && !channelTitle) {
                return null;
            }

            // Synthesize YouTube API shape for compatibility and validation
            return {
                id: videoId,
                snippet: {
                    title,
                    channelTitle,
                    channelId,
                    channelHandle,
                    description,
                    category,
                },
                contentDetails: {
                    duration: `PT${durationSeconds}S`,
                    durationMs: durationSeconds * 1000,
                    directMs,
                }
            };
        }
    };

    /**
     * Handles all interactions with the ListenBrainz API.
     */
    const rateLimitState = {
        isBlocked: false,
        resetTime: 0,
    };

    const ListenBrainzAPI = {
        _searchCache: new Map(),
        /**
         * Generic helper for making requests to the ListenBrainz API.
         * @param {string} endpoint - The API endpoint path.
         * @param {Object} options - Configuration for the request.
         * @param {string} options.token - The user's ListenBrainz token.
         * @param {string} [options.method='GET'] - The HTTP method.
         * @param {Object|null} [options.body=null] - The JSON body for POST requests.
         * @returns {Promise<Object>} The parsed JSON response.
         */
        async apiRequest(endpoint, { token, method = 'GET', body = null }) {
            if (rateLimitState.isBlocked && Date.now() < rateLimitState.resetTime) {
                const waitMs = (rateLimitState.resetTime - Date.now()) + 100;
                console.warn(`[${GM.info.script.name}] Rate limited locally. Waiting ${Math.ceil(waitMs / 1000)}s...`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
            rateLimitState.isBlocked = false;
            const url = Config.LISTENBRAINZ_API_ROOT + endpoint;
            const headers = new Headers();

            // This is where the Authorization header is constructed
            if (token) headers.append('Authorization', `Token ${token}`);

            if (body) headers.append('Content-Type', 'application/json');
            try {
                const response = await Utils.gmXmlHttpRequest({
                    method,
                    url,
                    headers: Object.fromEntries(headers.entries()),
                    data: body ? JSON.stringify(body) : null,
                }, 'ListenBrainz API');
                const remaining = response.responseHeaders.match(/x-ratelimit-remaining:\s*(\d+)/i);
                const resetIn = response.responseHeaders.match(/x-ratelimit-reset-in:\s*(\d+)/i);

                if (remaining && resetIn && parseInt(remaining[1], 10) === 0) {
                    const resetInMs = parseInt(resetIn[1], 10) * 1000;
                    rateLimitState.isBlocked = true;
                    rateLimitState.resetTime = Date.now() + resetInMs;
                }

                if (response.status === 429) {
                    const retryAfter = response.responseHeaders.match(/retry-after:\s*(\d+)/i) || resetIn;
                    const retryAfterMs = parseInt(retryAfter ? retryAfter[1] : '10', 10) * 1000;
                    rateLimitState.isBlocked = true;
                    rateLimitState.resetTime = Date.now() + retryAfterMs;
                    console.warn(`[${GM.info.script.name}] 429 Rate limit exceeded. Waiting ${retryAfterMs / 1000}s before retrying...`);
                    await new Promise(resolve => setTimeout(resolve, retryAfterMs + 100));
                    return this.apiRequest(endpoint, { token, method, body });
                }

                return response.responseText ? JSON.parse(response.responseText) : {};
            } catch (error) {
                console.error(`[${GM.info.script.name}] ListenBrainz API Error:`, error);
                throw error;
            }
        },

        async searchPlaylists(query) {
            if (this._searchCache.has(query)) {
                return this._searchCache.get(query);
            }
            const token = await TokenManager.getToken();
            if (!token) throw new Error("ListenBrainz token not set.");

            const endpoint = `playlist/search?query=${encodeURIComponent(query)}&count=100`;
            const data = await this.apiRequest(endpoint, { token });
            this._searchCache.set(query, data);
            return data;
        },

        async lookupTrack(artist, title) {
            const token = await TokenManager.getToken();
            const endpoint = `metadata/lookup/?artist_name=${encodeURIComponent(artist)}&recording_name=${encodeURIComponent(title)}&metadata=false&inc=artist`;
            const data = await this.apiRequest(endpoint, { token });

            return data.recording_mbid ? { title, creator: artist, identifier: `https://musicbrainz.org/recording/${data.recording_mbid}` } : null;
        },

        async createPlaylist(token, title, annotation, tracks, isPublic) {
            const jspf = { playlist: { title, track: tracks, annotation, extension: { "https://musicbrainz.org/doc/jspf#playlist": { public: isPublic } } } };
            return this.apiRequest('playlist/create', { method: 'POST', token, body: jspf });
        },

        async fetchPlaylist(token, mbid) {
            const data = await this.apiRequest(`playlist/${mbid}`, { token });
            return data.playlist;
        },

        async deletePlaylistItems(token, mbid, index, count) {
            if (count === 0) return;
            return this.apiRequest(`playlist/${mbid}/item/delete`, { method: 'POST', token, body: { index, count } });
        },

        async addPlaylistItemAtOffset(token, mbid, offset, tracks) {
            const jspf = { playlist: { track: tracks } };
            return this.apiRequest(`playlist/${mbid}/item/add/${offset}`, { method: 'POST', token, body: jspf });
        },

        /**
         * Edits a playlist's core metadata, including title, annotation, visibility, and description.
         * @param {string} token - The user's ListenBrainz token.
         * @param {string} mbid - The MBID of the playlist to edit.
         * @param {Object} details - The metadata to update.
         * @param {string} details.title - The new title.
         * @param {string} details.annotation - The new annotation.
         * @param {boolean} details.isPublic - The public status.
         * @param {string} details.description - The full description to store in additional_metadata.
         */
        async editPlaylistMetadata(token, mbid, { title, annotation, isPublic, description }) {
            const jspf = {
                playlist: {
                    title,
                    annotation: annotation || '',
                    extension: {
                        "https://musicbrainz.org/doc/jspf#playlist": {
                            public: isPublic,
                            additional_metadata: { "youtube_description": description }
                        }
                    }
                }
            };
            return this.apiRequest(`playlist/edit/${mbid}`, { method: 'POST', token, body: jspf });
        },
    };

    /**
     * Scans the DOM for relevant elements and extracts information.
     */
    const DOMScanner = {
        _channelCache: new Map(),

        /**
         * Caches a mapping from a channel handle to its canonical channel ID.
         * @param {string} handle
         * @param {string} channelId
         */
        cacheChannelId: function (handle, channelId) {
            if (!handle || !channelId) return;
            const cleanHandle = decodeURIComponent(handle).replace(/^@+/, '').trim();
            if (!cleanHandle || cleanHandle.includes('/')) return;

            this._channelCache.set(cleanHandle.toLowerCase(), channelId);
        },

        /**
         * Outputs a consolidated Wide Event summary for video data extraction and MusicBrainz matching.
         * @param {Object} ytData - Extracted video data.
         * @param {string[]} urlsToQuery - Queried MusicBrainz URLs.
         * @param {Map<string, Object|null>} mbResults - Map of MusicBrainz lookup results.
         * @param {Map<string, boolean>} [cachedUrlMap=null] - Cache hit status per URL before lookup.
         */
        logVideoSummary: function (ytData, urlsToQuery, mbResults, cachedUrlMap = null) {
            const formatMsToHms = (ms) => {
                if (ms === null || ms === undefined || isNaN(ms)) return 'N/A';
                const totalSec = Math.floor(ms / 1000);
                const h = Math.floor(totalSec / 3600);
                const m = Math.floor((totalSec % 3600) / 60);
                const s = totalSec % 60;
                const pad = (n) => String(n).padStart(2, '0');
                return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
            };

            const lookups = urlsToQuery.map(url => {
                const mbUrlEntity = mbResults.get(url);
                const isVideo = url.includes('/watch?v=');
                const source = mbResults.sources?.get(url) || (cachedUrlMap?.get(url) ? 'cache' : 'network');

                if (isVideo) {
                    const recordingRelations = (mbUrlEntity?.relations || []).filter(
                        rel => rel['type-id'] === Config.MUSICBRAINZ_FREE_STREAMING_RELATION_TYPE_ID &&
                            rel['target-type'] === 'recording' &&
                            rel.recording && rel.recording.id
                    );
                    const matches = recordingRelations.map(r => ({
                        id: r.recording.id,
                        title: r.recording.title,
                        length: r.recording.length
                    }));
                    return {
                        url,
                        type: 'video',
                        source,
                        status: matches.length > 0 ? 'linked' : 'unlinked',
                        matches: matches.length > 0 ? matches : null
                    };
                }

                const entities = [];
                if (mbUrlEntity?.relations) {
                    for (const rel of mbUrlEntity.relations) {
                        const targetType = rel['target-type'];
                        const targetObj = targetType ? rel[targetType] : null;
                        if (targetObj && targetObj.id) {
                            entities.push({
                                targetType,
                                id: targetObj.id,
                                name: targetObj.name || targetObj.title || ''
                            });
                        }
                    }
                }
                return {
                    url,
                    type: 'channel',
                    source,
                    status: entities.length > 0 ? 'linked' : 'unlinked',
                    matches: entities.length > 0 ? entities : null
                };
            });

            console.info(`[${GM.info.script.name}] Video: "${ytData.snippet?.title || ytData.id}"`, {
                videoId: ytData.id,
                title: ytData.snippet?.title || '',
                channel: ytData.snippet?.channelTitle || '',
                channelId: ytData.snippet?.channelId || '',
                duration: `${formatMsToHms(ytData.contentDetails?.durationMs)} (${ytData.contentDetails?.durationMs || 0}ms)`,
                lookups
            });
        },

        /**
         * Outputs a consolidated Wide Event summary for channel data extraction and MusicBrainz matching.
         * @param {{ channelId: string|null, handle: string|null, channelTitle: string, canonicalUrl: string|null, handleUrl: string|null }} channelData
         * @param {string[]} urlsToQuery
         * @param {Map<string, Object|null>} mbResults - Map of MusicBrainz lookup results.
         * @param {Map<string, boolean>} [cachedUrlMap=null] - Cache hit status per URL before lookup.
         */
        logChannelSummary: function (channelData, urlsToQuery, mbResults, cachedUrlMap = null) {
            const lookups = urlsToQuery.map(url => {
                const mbUrlEntity = mbResults.get(url);
                const source = mbResults.sources?.get(url) || (cachedUrlMap?.get(url) ? 'cache' : 'network');
                const entities = [];
                if (mbUrlEntity?.relations) {
                    for (const rel of mbUrlEntity.relations) {
                        const targetType = rel['target-type'];
                        const targetObj = targetType ? rel[targetType] : null;
                        if (targetObj && targetObj.id) {
                            entities.push({
                                targetType,
                                id: targetObj.id,
                                name: targetObj.name || targetObj.title || ''
                            });
                        }
                    }
                }
                return {
                    url,
                    source,
                    status: entities.length > 0 ? 'linked' : 'unlinked',
                    matches: entities.length > 0 ? entities : null
                };
            });

            console.info(`[${GM.info.script.name}] Channel: "${channelData.channelTitle || channelData.handle || 'N/A'}"`, {
                channelTitle: channelData.channelTitle || '',
                channelId: channelData.channelId || '',
                handle: channelData.handle || '',
                canonicalUrl: channelData.canonicalUrl,
                handleUrl: channelData.handleUrl,
                lookups
            });
        },

        /**
         * Checks if the current page is a YouTube video watch page.
         * @returns {string|null} The video ID if it's a video page, otherwise null.
         */
        getVideoId: function () {
            const videoIdMatch = location.href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
            return videoIdMatch ? videoIdMatch[1] : null;
        },

        /**
         * Checks if the current page is a YouTube channel or user page.
         * @returns {boolean} True if the current page is a channel page.
         */
        isChannelPage: function () {
            if (this.getVideoId()) return false;
            const decodedPath = decodeURIComponent(location.pathname);
            return /^\/(?:@[^\/]+|channel\/UC[\w-]+|c\/[^\/]+|user\/[^\/]+)(?:\/|$)/u.test(decodedPath);
        },

        /**
         * Extracts channel ID, handle, and display name from navigation event, URL, and cache.
         * @param {CustomEvent} [event] Optional navigation event detail.
         * @returns {{ channelId: string|null, handle: string|null, channelTitle: string, canonicalUrl: string|null, handleUrl: string|null }}
         */
        getChannelData: function (event) {
            // 1. Extract Handle (@...) directly from URL pathname
            let handle = null;
            const decodedPath = decodeURIComponent(location.pathname);
            const handleMatch = decodedPath.match(/\/(@[^\/?#]+)/);
            if (handleMatch) {
                handle = handleMatch[1];
            }

            // 2. Extract Response object (SPA event response OR initial page load data)
            const eventResponse = event?.detail?.response?.response
                || event?.detail?.response
                || (!event ? window.ytInitialData : null);

            // 3. Extract Channel ID (UC...) from navigation event, initial data, URL, or session cache
            let channelId = null;

            // Source A: Navigation event detail
            if (event?.detail) {
                const browseId = event.detail.endpoint?.browseEndpoint?.browseId
                    || event.detail.response?.endpoint?.browseEndpoint?.browseId
                    || eventResponse?.endpoint?.browseEndpoint?.browseId;
                if (browseId && browseId.startsWith('UC')) {
                    channelId = browseId;
                }
            }

            // Source B: Event response / initial data metadata
            if (!channelId && eventResponse) {
                const extId = eventResponse?.metadata?.channelMetadataRenderer?.externalId
                    || eventResponse?.header?.c4TabbedHeaderRenderer?.channelId;
                if (extId && extId.startsWith('UC')) {
                    channelId = extId;
                }
            }

            // Source C: Direct URL pathname (/channel/UC...)
            if (!channelId) {
                const pathChannelMatch = location.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
                if (pathChannelMatch) {
                    channelId = pathChannelMatch[1];
                }
            }

            // Source D: Session handle-to-channelId cache
            if (!channelId && handle) {
                channelId = this._channelCache.get(handle.toLowerCase()) || null;
            }

            // Source E: ytcfg globals
            if (!channelId) {
                if (window.ytcfg?.get?.('CHANNEL_ID') && window.ytcfg.get('CHANNEL_ID').startsWith('UC')) {
                    channelId = window.ytcfg.get('CHANNEL_ID');
                }
            }

            // Source F: Initial page load meta tags (only when event is absent)
            if (!channelId && !event) {
                const channelIdMeta = document.querySelector('meta[itemprop="channelId"], meta[itemprop="identifier"]');
                if (channelIdMeta && channelIdMeta.content && channelIdMeta.content.startsWith('UC')) {
                    channelId = channelIdMeta.content;
                }
            }

            // Cache discovered mapping for subsequent navigation
            if (handle && channelId) {
                this.cacheChannelId(handle, channelId);
            }

            // 4. Extract Channel Title directly from event payload / initial data
            let channelTitle = '';
            const eventTitle = Utils.extractTextFromYtObject(eventResponse?.metadata?.channelMetadataRenderer?.title)
                || Utils.extractTextFromYtObject(eventResponse?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.title)
                || Utils.extractTextFromYtObject(eventResponse?.header?.pageHeaderRenderer?.pageTitle)
                || Utils.extractTextFromYtObject(eventResponse?.header?.c4TabbedHeaderRenderer?.title)
                || Utils.extractTextFromYtObject(eventResponse?.microformat?.microformatDataRenderer?.title);

            if (eventTitle) {
                channelTitle = eventTitle;
            } else if (!event && document.title) {
                channelTitle = document.title.replace(/\s*-\s*YouTube$/, '').trim();
            }

            const canonicalUrl = channelId ? `https://www.youtube.com/channel/${channelId}` : null;
            const handleUrl = handle ? `https://www.youtube.com/${handle}` : null;

            return {
                channelId,
                handle,
                channelTitle,
                canonicalUrl,
                handleUrl
            };
        },

        /**
         * Checks if the current page is a YouTube channel or user page.
         * @returns {string|null} The channel identifier or null.
         */
        getChannelIdOrHandle: function () {
            const decodedPath = decodeURIComponent(location.pathname);
            const match = decodedPath.match(/^\/(?:channel\/(UC[\w-]+)|@([^\/?#]+)|user\/([^\/?#]+)|c\/([^\/?#]+))/);
            return match ? (match[1] || match[2] || match[3] || match[4]) : null;
        },

        /**
         * Finds the DOM element where the watch page buttons should be appended.
         * @returns {Promise<HTMLElement|null>} A promise that resolves with the dock element, or null if not found.
         */
        getButtonAnchorElement: async function () {
            try {
                return await Utils.waitForElement(Config.SELECTORS.BUTTON_DOCK, 10000)
                    .catch(() => Utils.waitForElement(Config.SELECTORS.BUTTON_DOCK_FALLBACK, 5000));
            } catch (e) {
                console.error(`[${GM.info.script.name}] Could not find button dock element:`, e);
                return null;
            }
        },

        /**
         * Finds the DOM element where channel page buttons should be appended.
         * @returns {Promise<HTMLElement|null>} A promise that resolves with the channel dock element, or null.
         */
        getChannelAnchorElement: async function () {
            try {
                return await Utils.waitForElement(Config.SELECTORS.CHANNEL_DOCK, 10000);
            } catch (e) {
                console.error(`[${GM.info.script.name}] Could not find channel dock element:`, e);
                return null;
            }
        },
    };

    /**
     * Base class managing button container lifecycle, docking, and state transitions.
     */
    class BaseButtonManager {
        /**
         * @param {string} [extraClass=''] - Additional CSS classes for the container.
         */
        constructor(extraClass = '') {
            this._containerDiv = document.createElement('div');
            this._containerDiv.className = `holder ${Config.CLASS_NAMES.CONTAINER} ${extraClass}`.trim();
            this._containerDiv.style.display = 'none';
        }

        get container() {
            return this._containerDiv;
        }

        init() {
            // Lifecycle hook for initial setup
        }

        /**
         * Appends the button container to the specified dock element.
         * @param {HTMLElement|null} dockElement - Target container in DOM.
         */
        appendToDock(dockElement) {
            if (!dockElement || dockElement.contains(this._containerDiv)) return;
            dockElement.appendChild(this._containerDiv);
        }

        /**
         * Sets pending/dimmed state during background requests.
         * @param {boolean} [isPending=true]
         */
        setPending(isPending = true) {
            if (this._containerDiv.style.display !== 'none') {
                this._containerDiv.style.opacity = isPending ? '0.5' : '1';
                this._containerDiv.style.pointerEvents = isPending ? 'none' : 'auto';
            }
        }

        show() {
            this._containerDiv.style.display = 'inline-flex';
            this._containerDiv.style.opacity = '1';
            this._containerDiv.style.pointerEvents = 'auto';
        }

        hide() {
            this._containerDiv.style.display = 'none';
            this._containerDiv.style.opacity = '1';
            this._containerDiv.style.pointerEvents = 'auto';
        }

        clear() {
            while (this._containerDiv.firstChild) {
                this._containerDiv.removeChild(this._containerDiv.firstChild);
            }
        }

        /**
         * Replaces container children with the provided element(s).
         * @param {HTMLElement|YTButton|Array<HTMLElement|YTButton>} elements
         */
        setContent(elements) {
            this.clear();
            const nodes = Array.isArray(elements) ? elements : [elements];
            nodes.forEach(node => {
                if (node instanceof YTButton) {
                    this._containerDiv.appendChild(node.container);
                } else if (node) {
                    this._containerDiv.appendChild(node);
                }
            });
            this.show();
        }

        /**
         * Displays an error button with a given message.
         * @param {string} message - The error message to display.
         */
        displayError(message) {
            this.setContent(new YTButton({
                tag: 'button',
                label: message,
                title: message,
                icon: SVGIcons.alert,
                variant: 'error',
                disabled: true
            }));
        }

        /**
         * Displays an informational button with a given message.
         * @param {string} message - The info message to display.
         */
        displayInfo(message) {
            this.setContent(new YTButton({
                tag: 'button',
                label: message,
                title: message,
                icon: SVGIcons.alert,
                variant: 'info',
                disabled: true
            }));
        }

        resetState() {
            this.clear();
            this.hide();
        }
    }

    /**
     * Manages the creation, display, and state of the MusicBrainz import button.
     */
    class RecordingButtonManagerClass extends BaseButtonManager {
        constructor() {
            super();
            this._form = document.createElement('form');
            this._form.method = 'get';
            this._form.action = '//musicbrainz.org/recording/create';
            this._form.acceptCharset = 'UTF-8';
            this._form.target = '_blank';
            this._form.style.display = 'none';

            this._submitButton = new YTButton({
                tag: 'button',
                type: 'submit',
                label: L10n.getString('loading'),
                title: L10n.getString('addRecordingTitle'),
                icon: SVGIcons.musicbrainz,
                variant: 'brand-mb',
                disabled: true
            });

            this._form.appendChild(this._submitButton.container);
            this._containerDiv.appendChild(this._form);
        }

        _addField(name, value) {
            const field = document.createElement('input');
            field.type = 'hidden';
            field.name = name;
            field.value = value;
            this._form.insertBefore(field, this._submitButton.container);
        }

        resetState() {
            Array.from(this._form.querySelectorAll('input[type="hidden"]')).forEach(input => this._form.removeChild(input));
            this.clear();
            this._form.style.display = 'none';
            this._containerDiv.appendChild(this._form);
            this._submitButton.update({
                label: L10n.getString('loading'),
                title: L10n.getString('addRecordingTitle'),
                icon: SVGIcons.musicbrainz,
                variant: 'brand-mb',
                disabled: true
            });
            this.hide();
        }

        setPending(isPending = true) {
            super.setPending(isPending);
            if (this._submitButton) {
                this._submitButton.setPending(isPending);
            }
        }

        prepareAddButton(youtubeVideoData, canonicalYtUrl, artistMbid, videoId) {
            this.resetState();

            const title = youtubeVideoData.snippet.title;
            const artist = youtubeVideoData.snippet.channelTitle;
            const length = (youtubeVideoData.contentDetails && typeof youtubeVideoData.contentDetails.durationMs === 'number')
                ? youtubeVideoData.contentDetails.durationMs
                : 0;

            this._addField('edit-recording.name', title);
            if (artistMbid) {
                this._addField('artist', artistMbid);
                this._addField('edit-recording.artist_credit.names.0.artist.name', artist);
            } else {
                this._addField('edit-recording.artist_credit.names.0.name', artist);
            }

            if (typeof length === 'number' && !isNaN(length) && length > 0) {
                this._addField('edit-recording.length', length);
            }

            this._addField('edit-recording.video', '1');
            this._addField('edit-recording.url.0.text', canonicalYtUrl);
            this._addField('edit-recording.url.0.link_type_id', Config.MUSICBRAINZ_FREE_STREAMING_LINK_TYPE_ID);
            const scriptInfo = GM_info.script;
            const editNote = `${canonicalYtUrl}\n—\n${scriptInfo.name} (v${scriptInfo.version})`;
            this._addField('edit-recording.edit_note', editNote);

            this._submitButton.update({
                label: L10n.getString('addRecording'),
                title: L10n.getString('addRecordingTitle'),
                icon: SVGIcons.musicbrainz,
                variant: 'brand-mb',
                disabled: false
            });

            this._form.style.display = 'inline-flex';
            this.show();

            const invalidateCacheAndPrefetch = () => {
                console.debug(`[${GM.info.script.name}] Import button clicked. Clearing cache for video ID: ${videoId}`);
                YouTubeMusicBrainzImporter._mbApi.invalidateCacheForUrl(canonicalYtUrl);

                if (youtubeVideoData.snippet.channelId) {
                    const youtubeChannelUrl = new URL(`https://www.youtube.com/channel/${youtubeVideoData.snippet.channelId}`).toString();
                    YouTubeMusicBrainzImporter._mbApi.invalidateCacheForUrl(youtubeChannelUrl);
                }
            };
            this._submitButton.element.addEventListener('mousedown', invalidateCacheAndPrefetch, { once: true });
        }

        displayExistingButton(allRelevantRecordingRelations, urlEntityId, youtubeVideoData, canonicalYtUrl) {
            this.resetState();

            let button;
            if (allRelevantRecordingRelations.length === 1) {
                const existingRecordingRelation = allRelevantRecordingRelations[0];
                const recordingMBID = existingRecordingRelation.recording.id;
                const recordingTitle = existingRecordingRelation.recording.title || 'View Recording';
                const hasLength = existingRecordingRelation.recording.length != null;
                const ytHasLength = youtubeVideoData && youtubeVideoData.contentDetails && (youtubeVideoData.contentDetails.durationMs > 0 || youtubeVideoData.contentDetails.directMs > 0);

                if (!hasLength && ytHasLength) {
                    const lengthInMs = youtubeVideoData.contentDetails.durationMs || youtubeVideoData.contentDetails.directMs;
                    const scriptInfo = GM_info.script;
                    const editNote = `${canonicalYtUrl}\n—\n${scriptInfo.name} (v${scriptInfo.version})`;
                    const encodedEditNote = encodeURIComponent(editNote);
                    const href = `//musicbrainz.org/recording/${recordingMBID}/edit?edit-recording.length=${lengthInMs}&edit-recording.edit_note=${encodedEditNote}`;

                    button = new YTButton({
                        tag: 'a',
                        href,
                        target: '_blank',
                        label: L10n.getString('updateLength'),
                        title: L10n.getString('updateLengthTitle', { length: Math.round(lengthInMs / 1000) }),
                        icon: SVGIcons.clock,
                        variant: 'update'
                    });
                    console.debug(`[${GM.info.script.name}] Displaying 'Update Length' button for recording ${recordingMBID}.`);
                } else {
                    button = new YTButton({
                        tag: 'a',
                        href: `//musicbrainz.org/recording/${recordingMBID}`,
                        target: '_blank',
                        label: L10n.getString('onMB'),
                        title: L10n.getString('linkedToRecordingTitle', { title: recordingTitle }),
                        icon: SVGIcons.musicbrainz,
                        variant: 'tonal'
                    });
                }
            } else {
                console.debug(`[${GM.info.script.name}] Multiple recording relations found. Linking to URL entity page.`);
                button = new YTButton({
                    tag: 'a',
                    href: `//musicbrainz.org/url/${urlEntityId}`,
                    target: '_blank',
                    label: L10n.getString('onMBMulti'),
                    title: L10n.getString('linkedToMultiTitle'),
                    icon: SVGIcons.musicbrainz,
                    variant: 'tonal'
                });
            }

            this.setContent(button);
            console.debug(`[${GM.info.script.name}] Displaying existing link button.`);
        }
    }
    const RecordingButtonManager = new RecordingButtonManagerClass();

    /**
     * Manages the UI for the ListenBrainz playlist button.
     */
    class PlaylistButtonManagerClass extends BaseButtonManager {
        setStateTokenNeeded(onSuccessCallback) {
            this.setContent(new YTButton({
                tag: 'button',
                label: L10n.getString('tokenMissing'),
                title: L10n.getString('tokenMissingTitle'),
                icon: SVGIcons.alert,
                variant: 'error',
                onClick: async () => {
                    const token = await TokenManager.getToken(true);
                    if (token) {
                        onSuccessCallback();
                    }
                }
            }));
        }

        setStateCreate(onClick) {
            this.setContent(new YTButton({
                tag: 'button',
                label: L10n.getString('createPlaylist'),
                title: L10n.getString('createPlaylistTitle'),
                icon: SVGIcons.listenbrainz,
                variant: 'brand-lb',
                onClick
            }));
        }

        setStateSync(title, mbid, onClick) {
            const linkBtn = new YTButton({
                tag: 'a',
                href: `//listenbrainz.org/playlist/${mbid}`,
                target: '_blank',
                label: L10n.getString('onLB'),
                title: L10n.getString('linkedToPlaylistTitle', { title }),
                icon: SVGIcons.listenbrainz,
                variant: 'tonal'
            });

            const syncBtn = new YTButton({
                tag: 'button',
                label: L10n.getString('syncPlaylist'),
                title: L10n.getString('syncPlaylistTitle'),
                icon: SVGIcons.sync,
                variant: 'sync',
                onClick
            });

            this.setContent([linkBtn, syncBtn]);
        }

        setStateExists(title, targetUrl) {
            const uuidRegex = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
            const href = uuidRegex.test(targetUrl)
                ? `//listenbrainz.org/playlist/${targetUrl}`
                : (targetUrl.startsWith('http') ? targetUrl : `//${targetUrl}`);

            const text = title === 'On LB (Multi)' ? 'On LB (Multi) ✓' : L10n.getString('onLB');
            this.setContent(new YTButton({
                tag: 'a',
                href,
                target: '_blank',
                label: text,
                title: L10n.getString('linkedToPlaylistTitle', { title }),
                icon: SVGIcons.listenbrainz,
                variant: 'tonal'
            }));
        }

        setStateReport(title, mbid, openReportCallback) {
            const linkBtn = new YTButton({
                tag: 'a',
                href: `//listenbrainz.org/playlist/${mbid}`,
                target: '_blank',
                label: L10n.getString('onLB'),
                title: L10n.getString('linkedToPlaylistTitle', { title }),
                icon: SVGIcons.listenbrainz,
                variant: 'tonal'
            });

            const reportBtn = new YTButton({
                tag: 'button',
                label: L10n.getString('viewReport'),
                title: L10n.getString('viewReportTitle'),
                icon: SVGIcons.report,
                variant: 'report',
                onClick: openReportCallback
            });

            this.setContent([linkBtn, reportBtn]);
        }

        setStateInProgress(message) {
            this.setContent(new YTButton({
                tag: 'button',
                label: message,
                title: message,
                icon: SVGIcons.spinner,
                variant: 'tonal',
                disabled: true
            }));
        }
    }
    const PlaylistButtonManager = new PlaylistButtonManagerClass();

    /**
     * Manages the creation, display, and state of the MusicBrainz channel page button.
     */
    class ChannelButtonManagerClass extends BaseButtonManager {
        constructor() {
            super('ytFlexibleActionsViewModelAction channel-mb-holder');
            this._button = new YTButton({
                tag: 'a',
                label: L10n.getString('loading'),
                title: L10n.getString('loading'),
                icon: SVGIcons.musicbrainz,
                variant: 'tonal',
                disabled: true
            });
            this._containerDiv.appendChild(this._button.container);
        }

        setPending(isPending = true) {
            super.setPending(isPending);
            if (this._button) {
                this._button.setPending(isPending);
            }
            if (isPending) {
                this.show();
            }
        }

        displayLinkedEntity(targetType, entityId, entityName) {
            const formattedType = targetType.charAt(0).toUpperCase() + targetType.slice(1);
            let label = L10n.getString('onMB');
            if (targetType === 'artist') {
                label = L10n.getString('onMBArtist') || 'Artist on MB ✓';
            } else if (targetType === 'label') {
                label = L10n.getString('onMBLabel') || 'Label on MB ✓';
            } else {
                label = `${formattedType} on MB ✓`;
            }

            const title = `Linked to ${formattedType}: ${entityName || entityId}`;

            this._button.update({
                tag: 'a',
                href: `//musicbrainz.org/${targetType}/${entityId}`,
                target: '_blank',
                label: label,
                title: title,
                icon: SVGIcons.musicbrainz,
                variant: 'tonal',
                disabled: false
            });
            this.show();
        }

        displayMultiLinked(urlEntityId) {
            this._button.update({
                tag: 'a',
                href: `//musicbrainz.org/url/${urlEntityId}`,
                target: '_blank',
                label: L10n.getString('onMBMulti'),
                title: L10n.getString('linkedToMultiTitle'),
                icon: SVGIcons.musicbrainz,
                variant: 'tonal',
                disabled: false
            });
            this.show();
        }

        displaySearchOrAdd(channelTitle, targetUrl, urlsToInvalidate = []) {
            const cleanUrl = targetUrl || location.href.split('?')[0];
            const createUrl = `//musicbrainz.org/artist/create?edit-artist.name=${encodeURIComponent(channelTitle)}&edit-artist.url.0.text=${encodeURIComponent(cleanUrl)}`;

            this._button.update({
                tag: 'a',
                href: createUrl,
                target: '_blank',
                label: L10n.getString('searchAddMB') || 'Add to MB',
                title: L10n.getString('searchAddMBTitle', { name: channelTitle }),
                icon: SVGIcons.musicbrainz,
                variant: 'brand-mb',
                disabled: false
            });

            if (urlsToInvalidate && urlsToInvalidate.length > 0) {
                const invalidateCache = () => {
                    console.debug(`[${GM.info.script.name}] Channel 'Add to MB' clicked. Invalidate cache:`, urlsToInvalidate);
                    YouTubeMusicBrainzImporter._mbApi.invalidateCacheForUrl(urlsToInvalidate);
                };
                this._button.element.addEventListener('mousedown', invalidateCache, { once: true });
            }

            this.show();
        }

        displayError(message) {
            this._button.update({
                tag: 'button',
                label: message,
                title: message,
                icon: SVGIcons.alert,
                variant: 'error',
                disabled: true
            });
            this.show();
        }
    }
    const ChannelButtonManager = new ChannelButtonManagerClass();

    /**
     * High-level logic for creating and syncing ListenBrainz playlists.
     */
    const PlaylistLogic = {
        _generateReportHTML: function (notFoundTracks, unparsedLines, videoTitle) {
            let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Playlist Import Report: ${videoTitle}</title>
            <style>body{font-family:sans-serif;padding:1em 2em;background-color:#f9f9f9;} h1,h2{border-bottom:1px solid #ccc;padding-bottom:5px;} ul{list-style:none;padding-left:0;} li{margin-bottom:0.8em;padding:0.5em;background-color:white;border:1px solid #ddd;border-radius:4px;} a{text-decoration:none;color:#007bff;font-weight:bold;margin-left:1em;}</style>
            </head><body><h1>Playlist Import Report</h1><h2>${videoTitle}</h2>`;

            if (notFoundTracks.length > 0) {
                html += '<h2>Unmatched Tracks</h2><p>These lines were parsed as tracks but could not be found on MusicBrainz.</p><ul>';
                notFoundTracks.forEach(track => {
                    const mbQuery = `artist:"${track.artist}" AND recording:"${track.title}"`;
                    const mbSearchUrl = `https://musicbrainz.org/search?query=${encodeURIComponent(mbQuery)}&type=recording&method=advanced`;
                    const googleQuery = `"${track.artist}" "${track.title}"`;
                    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}&nfpr=1`;
                    html += `<li>${track.originalLine} <a href="${mbSearchUrl}" target="_blank">[Search MB]</a> <a href="${googleSearchUrl}" target="_blank">[Search Google]</a></li>`;
                });
                html += '</ul>';
            }

            if (unparsedLines.length > 0) {
                html += '<h2>Unparsed Lines</h2><p>These lines from the description did not match any track format.</p><ul>';
                unparsedLines.forEach(line => {
                    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(line)}`;
                    html += `<li>${line} <a href="${searchUrl}" target="_blank">[Search Google]</a></li>`;
                });
                html += '</ul>';
            }

            html += '</body></html>';
            return html;
        },

        async _processTracklist(description, progressCallback) {
            const { parsedTracks, unparsedLines } = Utils.parseTracklist(description, fallbackArtist);
            if (parsedTracks.length === 0) {
                return { foundTracks: [], notFoundTracks: [], unparsedLines };
            }

            parsedTracks.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

            // --- Heuristic ---
            const uniqueArtists = new Set(parsedTracks.map(t => t.artist)).size;
            const uniqueTitles = new Set(parsedTracks.map(t => t.title)).size;
            const parserIsLikelySwapped = (uniqueArtists > 0 && uniqueTitles > 0 && parsedTracks.length > 3)
                ? (uniqueArtists > uniqueTitles)
                : false;

            if (parserIsLikelySwapped) {
                console.debug(`[${GM.info.script.name}] Tracklist heuristic: uniqueArtists=${uniqueArtists}, uniqueTitles=${uniqueTitles}. Parser output likely swapped. Prioritizing swapped lookup.`);
            } else {
                console.debug(`[${GM.info.script.name}] Tracklist heuristic: uniqueArtists=${uniqueArtists}, uniqueTitles=${uniqueTitles}. Parser output seems correct. Prioritizing parser order lookup.`);
            }
            // --- End of heuristic ---

            let foundTracks = [];
            let potentiallyNotFound = []; // Tracks not found in the first pass

            // --- First Pass: Use the heuristic's best guess ---
            let i = 0;
            for (const track of parsedTracks) {
                if (progressCallback) progressCallback(i, parsedTracks.length, 'Pass 1'); // Indicate pass 1

                const artistGuess1 = parserIsLikelySwapped ? track.title.trim() : track.artist.trim();
                const titleGuess1 = parserIsLikelySwapped ? track.artist.trim() : track.title.trim();

                try {
                    const result = await ListenBrainzAPI.lookupTrack(artistGuess1, titleGuess1);
                    if (result) {
                        foundTracks.push(result);
                    } else {
                        // Add original track object with the heuristic's guess applied for potential second pass/reporting
                        potentiallyNotFound.push({
                            artist: artistGuess1,
                            title: titleGuess1,
                            timestamp: track.timestamp,
                            timestampSeconds: track.timestampSeconds,
                            originalLine: track.originalLine,
                            // Store the alternative guess for the second pass
                            altArtist: parserIsLikelySwapped ? track.artist.trim() : track.title.trim(),
                            altTitle: parserIsLikelySwapped ? track.title.trim() : track.artist.trim()
                        });
                    }
                } catch (error) {
                    console.error(`[${GM.info.script.name}] Error during Pass 1 lookup for track: "${artistGuess1} - ${titleGuess1}" (Original line: ${track.originalLine})`, error);
                    // Add to potentiallyNotFound on error too, using heuristic guess for report
                    potentiallyNotFound.push({
                        artist: artistGuess1,
                        title: titleGuess1,
                        timestamp: track.timestamp,
                        timestampSeconds: track.timestampSeconds,
                        originalLine: track.originalLine,
                        altArtist: parserIsLikelySwapped ? track.artist.trim() : track.title.trim(),
                        altTitle: parserIsLikelySwapped ? track.title.trim() : track.artist.trim()
                    });
                }
                i++;
            }

            // --- Second Pass (Conditional): Try swapped order only if the first pass found nothing ---
            let finalNotFoundTracks = potentiallyNotFound; // Assume all potential misses are final unless found in pass 2

            if (foundTracks.length === 0 && potentiallyNotFound.length > 0) {
                console.debug(`[${GM.info.script.name}] First pass found no tracks. Starting second pass with swapped order.`);
                foundTracks = []; // Reset foundTracks for the second pass results
                finalNotFoundTracks = []; // Reset finalNotFoundTracks for the second pass results
                let j = 0;

                for (const trackInfo of potentiallyNotFound) {
                    if (progressCallback) progressCallback(j, potentiallyNotFound.length, 'Pass 2'); // Indicate pass 2

                    try {
                        // Use the alternative guess stored earlier
                        const result = await ListenBrainzAPI.lookupTrack(trackInfo.altArtist, trackInfo.altTitle);
                        if (result) {
                            foundTracks.push(result);
                        } else {
                            // Track still not found, add its *heuristic guess* to final report list
                            console.debug(`[${GM.info.script.name}] Track still not found on Pass 2: "${trackInfo.artist} - ${trackInfo.title}" (Original line: ${trackInfo.originalLine})`);
                            finalNotFoundTracks.push({
                                artist: trackInfo.artist, // Report using heuristic guess
                                title: trackInfo.title,   // Report using heuristic guess
                                timestamp: trackInfo.timestamp,
                                timestampSeconds: trackInfo.timestampSeconds,
                                originalLine: trackInfo.originalLine
                            });
                        }
                    } catch (error) {
                        console.error(`[${GM.info.script.name}] Error during Pass 2 lookup for track: "${trackInfo.altArtist} - ${trackInfo.altTitle}" (Original line: ${trackInfo.originalLine})`, error);
                        // Add heuristic guess to report on error
                        finalNotFoundTracks.push({
                            artist: trackInfo.artist,
                            title: trackInfo.title,
                            timestamp: trackInfo.timestamp,
                            timestampSeconds: trackInfo.timestampSeconds,
                            originalLine: trackInfo.originalLine
                        });
                    }
                    j++;
                }
            } else if (potentiallyNotFound.length > 0) {
                // First pass found *some* tracks, so don't run second pass.
                // Convert potentiallyNotFound (which includes altArtist/altTitle)
                // back to the simple structure needed for the report.
                finalNotFoundTracks = potentiallyNotFound.map(trackInfo => ({
                    artist: trackInfo.artist, // Report using heuristic guess
                    title: trackInfo.title,   // Report using heuristic guess
                    timestamp: trackInfo.timestamp,
                    timestampSeconds: trackInfo.timestampSeconds,
                    originalLine: trackInfo.originalLine
                }));
                console.debug(`[${GM.info.script.name}] First pass found ${foundTracks.length} tracks. Skipping second pass.`);
            }

            return { foundTracks, notFoundTracks: finalNotFoundTracks, unparsedLines };
        },

        async createPlaylist(ytData, canonicalYtUrl) {
            const token = await TokenManager.getToken();
            if (!token) {
                PlaylistButtonManager.setStateTokenNeeded(() => this.createPlaylist(ytData, canonicalYtUrl));
                return;
            }

            PlaylistButtonManager.setStateInProgress('Processing...');
            try {
                const { foundTracks, notFoundTracks, unparsedLines } = await this._processTracklist(
                    ytData.snippet.description,
                    ytData.snippet.channelTitle,
                    (current, total) => {
                        PlaylistButtonManager.setStateInProgress(`Looking up: ${current}/${total}`);
                    }
                );

                if (foundTracks.length === 0) {
                    PlaylistButtonManager.displayError('No tracks found');
                    return;
                }

                let playlistTitle = ytData.snippet.title;
                if (notFoundTracks.length > 0) {
                    playlistTitle = `[INCOMPLETE] ${playlistTitle}`;
                }

                PlaylistButtonManager.setStateInProgress('Creating...');
                const createResponse = await ListenBrainzAPI.createPlaylist(token, playlistTitle, canonicalYtUrl, foundTracks, true);
                const newMbid = createResponse.playlist_mbid;

                PlaylistButtonManager.setStateInProgress('Storing metadata...');
                await ListenBrainzAPI.editPlaylistMetadata(token, newMbid, {
                    title: playlistTitle,
                    annotation: canonicalYtUrl,
                    isPublic: true,
                    description: ytData.snippet.description
                });

                if (notFoundTracks.length > 0 || unparsedLines.length > 0) {
                    const reportHtml = this._generateReportHTML(notFoundTracks, unparsedLines, ytData.snippet.title);
                    const openReport = () => {
                        const blob = new Blob([reportHtml], { type: 'text/html' });
                        const url = URL.createObjectURL(blob);
                        const reportWindow = window.open(url);
                        if (reportWindow) {
                            reportWindow.addEventListener('unload', () => {
                                URL.revokeObjectURL(url);
                            });
                        } else {
                            alert('Popup blocked! Please allow popups for this site to view the report.');
                        }
                    };
                    PlaylistButtonManager.setStateReport(playlistTitle, newMbid, openReport);
                } else {
                    PlaylistButtonManager.setStateExists(playlistTitle, newMbid);
                }

            } catch (error) {
                PlaylistButtonManager.displayError('Creation Failed');
                console.error(`[${GM.info.script.name}] Error creating playlist:`, error);
            }
        },

        async syncPlaylist(ytData, canonicalYtUrl, playlistMbid) {
            const token = await TokenManager.getToken();
            if (!token) {
                PlaylistButtonManager.setStateTokenNeeded(() => this.syncPlaylist(ytData, canonicalYtUrl, playlistMbid));
                return;
            }

            PlaylistButtonManager.setStateInProgress('Syncing...');
            try {
                // Step 1: Fetch existing playlist and process new tracklist
                PlaylistButtonManager.setStateInProgress('Fetching data...');
                const existingPlaylist = await ListenBrainzAPI.fetchPlaylist(token, playlistMbid);
                const oldTracks = existingPlaylist.track || [];
                const oldMbids = oldTracks.map(t => t.identifier[0].split('/').pop());

                const { foundTracks: newTracks, notFoundTracks, unparsedLines } = await this._processTracklist(
                    ytData.snippet.description,
                    ytData.snippet.channelTitle,
                    (current, total) => {
                        PlaylistButtonManager.setStateInProgress(`Looking up: ${current}/${total}`);
                    }
                );
                const newMbids = newTracks.map(t => t.identifier.split('/').pop());

                // Steps 2 & 3: Calculate and perform deletions and additions
                PlaylistButtonManager.setStateInProgress('Updating tracks...');
                const lcsMbids = Utils.findLCS(oldMbids, newMbids);
                const lcsMbidsSet = new Set(lcsMbids);

                const indicesToDelete = oldMbids.map((mbid, index) => lcsMbidsSet.has(mbid) ? -1 : index).filter(index => index !== -1);
                indicesToDelete.sort((a, b) => b - a);

                const deleteGroups = Utils.groupDeletions(indicesToDelete);
                for (const group of deleteGroups) {
                    await ListenBrainzAPI.deletePlaylistItems(token, playlistMbid, group.index, group.count);
                }

                const currentServerMbids = oldMbids.filter(mbid => lcsMbidsSet.has(mbid));
                let serverIndex = 0;
                for (let i = 0; i < newMbids.length; i++) {
                    const newMbid = newMbids[i];
                    if (serverIndex < currentServerMbids.length && currentServerMbids[serverIndex] === newMbid) {
                        serverIndex++;
                    } else {
                        const chunkToAdd = [];
                        let lookaheadIndex = i;
                        while (lookaheadIndex < newMbids.length && (serverIndex >= currentServerMbids.length || currentServerMbids[serverIndex] !== newMbids[lookaheadIndex])) {
                            const trackToAdd = newTracks.find(t => t.identifier.endsWith(newMbids[lookaheadIndex]));
                            chunkToAdd.push(trackToAdd);
                            lookaheadIndex++;
                        }
                        if (chunkToAdd.length > 0) {
                            await ListenBrainzAPI.addPlaylistItemAtOffset(token, playlistMbid, i, chunkToAdd);
                            i = lookaheadIndex - 1;
                        }
                    }
                }

                // Step 4: Update Playlist Metadata on the server
                PlaylistButtonManager.setStateInProgress('Updating title...');
                let finalTitle = existingPlaylist.title;
                if (notFoundTracks.length === 0) {
                    finalTitle = existingPlaylist.title.replace(/\[INCOMPLETE\]\s*/, '');
                } else if (!existingPlaylist.title.startsWith('[INCOMPLETE]')) {
                    finalTitle = `[INCOMPLETE] ${existingPlaylist.title}`;
                }

                const isPublic = existingPlaylist.extension["https://musicbrainz.org/doc/jspf#playlist"].public;
                await ListenBrainzAPI.editPlaylistMetadata(token, playlistMbid, {
                    title: finalTitle,
                    annotation: existingPlaylist.annotation,
                    isPublic: isPublic,
                    description: ytData.snippet.description
                });

                if (notFoundTracks.length > 0 || unparsedLines.length > 0) {
                    const reportHtml = this._generateReportHTML(notFoundTracks, unparsedLines, ytData.snippet.title);
                    const openReport = () => {
                        const blob = new Blob([reportHtml], { type: 'text/html' });
                        const url = URL.createObjectURL(blob);
                        const reportWindow = window.open(url);
                        if (reportWindow) {
                            reportWindow.addEventListener('unload', () => {
                                URL.revokeObjectURL(url);
                            });
                        } else {
                            alert('Popup blocked! Please allow popups for this site to view the report.');
                        }
                    };
                    PlaylistButtonManager.setStateReport(finalTitle, playlistMbid, openReport);
                } else {
                    PlaylistButtonManager.setStateExists(finalTitle, playlistMbid);
                }

            } catch (error) {
                PlaylistButtonManager.displayError('Sync Failed');
                console.error(`[${GM.info.script.name}] Error syncing playlist:`, error);
            }
        },
    };

    /**
     * Main application logic for the userscript.
     */
    const YouTubeMusicBrainzImporter = {
        _processingVideoId: null,
        _currentProcessingPromise: null,
        _processingChannelKey: null,
        _currentChannelProcessingPromise: null,
        _mbApi: null,

        lookupMbUrls: async function (canonicalUrls) {
            try {
                return await this._mbApi.lookupUrl(canonicalUrls, [
                    'recording-rels',
                    'artist-rels',
                    'label-rels',
                    'place-rels',
                    'event-rels',
                    'series-rels'
                ]);
            } catch (error) {
                if (error.name === 'PermanentError') {
                    console.debug(`[${GM.info.script.name}] A URL was not found in MusicBrainz (404), which is expected.`);
                } else {
                    console.error(`[${GM.info.script.name}] An unexpected error occurred looking up MusicBrainz URLs:`, error);
                }
                // On error, return a map with null values for all requested URLs
                const resultsMap = new Map();
                const urls = Array.isArray(canonicalUrls) ? canonicalUrls : [canonicalUrls];
                urls.forEach(url => resultsMap.set(url, null));
                return resultsMap;
            }
        },

        _extractArtistMbid: function (channelUrlEntity) {
            if (!channelUrlEntity?.relations) return null;
            const artistRelation = channelUrlEntity.relations.find(rel => rel['target-type'] === 'artist' && rel.artist);
            return artistRelation?.artist.id || null;
        },


        /**
         * Initializes the application: injects CSS, initializes managers, and sets up observers.
         */
        init: function () {
            this._mbApi = new MusicBrainzAPI({ user_agent: USER_AGENT });
            InPageDataExtractor.initEventListeners();
            this._injectCSS();
            TokenManager.init(); // Initialize token manager
            RecordingButtonManager.init();
            PlaylistButtonManager.init(); // Initialize playlist button manager
            ChannelButtonManager.init(); // Initialize channel button manager
            this._setupObservers();

            this._routePage();
        },

        /**
         * Injects custom CSS rules into the document head for button styling.
         */
        _injectCSS: function () {
            const head = document.head || document.getElementsByTagName('head')[0];
            if (head) {
                const style = document.createElement('style');
                style.setAttribute('type', 'text/css');
                style.textContent = `
                    .${Config.CLASS_NAMES.CONTAINER} {
                        display: inline-flex;
                        align-items: center;
                        align-self: center;
                        gap: 8px;
                        margin-left: 8px;
                    }
                    yt-flexible-actions-view-model .${Config.CLASS_NAMES.CONTAINER},
                    .ytFlexibleActionsViewModelAction.${Config.CLASS_NAMES.CONTAINER} {
                        margin-left: 0;
                    }
                    .${Config.CLASS_NAMES.BUTTON_RENDERER} {
                        display: inline-flex;
                        align-items: center;
                        align-self: center;
                    }
                    .musicbrainz-button-renderer .yt-spec-button-shape-next,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextHost {
                        align-self: center;
                    }
                    .holder {
                        height: 100%;
                        display: inline-flex;
                        align-items: center;
                    }
                    .musicbrainz-userscript-container form {
                        display: inline-flex;
                        align-items: center;
                        align-self: center;
                        margin: 0;
                        padding: 0;
                    }

                    /* Ensure SVG icons scale cleanly inside YouTube icon slot */
                    .musicbrainz-button-renderer .yt-spec-button-shape-next__icon svg,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextIcon svg {
                        width: 100%;
                        height: 100%;
                        max-width: 20px;
                        max-height: 20px;
                        display: block;
                    }

                    /* Brand Modifiers */
                    .musicbrainz-button-renderer .yt-spec-button-shape-next--brand-mb,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--brand-mb {
                        background-color: #BA478F !important;
                        color: #ffffff !important;
                    }
                    .musicbrainz-button-renderer .yt-spec-button-shape-next--brand-mb:hover,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--brand-mb:hover {
                        background-color: #a53f7c !important;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next--brand-lb,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--brand-lb {
                        background-color: #EB743B !important;
                        color: #ffffff !important;
                    }
                    .musicbrainz-button-renderer .yt-spec-button-shape-next--brand-lb:hover,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--brand-lb:hover {
                        background-color: #d16631 !important;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next--update,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--update {
                        background-color: #065fd4 !important;
                        color: #ffffff !important;
                    }
                    html[dark] .musicbrainz-button-renderer .yt-spec-button-shape-next--update,
                    [dark] .musicbrainz-button-renderer .yt-spec-button-shape-next--update {
                        background-color: #3ea6ff !important;
                        color: #0f0f0f !important;
                    }
                    .musicbrainz-button-renderer .yt-spec-button-shape-next--update:hover {
                        background-color: #004fc4 !important;
                    }
                    html[dark] .musicbrainz-button-renderer .yt-spec-button-shape-next--update:hover,
                    [dark] .musicbrainz-button-renderer .yt-spec-button-shape-next--update:hover {
                        background-color: #65b8ff !important;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next--sync,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--sync {
                        background-color: #007bff !important;
                        color: #ffffff !important;
                    }
                    .musicbrainz-button-renderer .yt-spec-button-shape-next--sync:hover {
                        background-color: #0069d9 !important;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next--report,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--report {
                        background-color: #f59e0b !important;
                        color: #111827 !important;
                    }
                    .musicbrainz-button-renderer .yt-spec-button-shape-next--report:hover {
                        background-color: #d97706 !important;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next--error,
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextFilled.yt-spec-button-shape-next--error {
                        background-color: #cc0000 !important;
                        color: #ffffff !important;
                    }
                    .musicbrainz-button-renderer .yt-spec-button-shape-next--error:hover {
                        background-color: #b30000 !important;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next--info {
                        background-color: #3ea6ff !important;
                        color: #0f0f0f !important;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next__icon svg:not(.yt-spec-button-shape-next__spinner),
                    .musicbrainz-button-renderer .ytSpecButtonShapeNextIcon svg:not(.yt-spec-button-shape-next__spinner) {
                        fill: currentColor;
                    }

                    .musicbrainz-button-renderer .yt-spec-button-shape-next__spinner,
                    .musicbrainz-button-renderer svg.yt-spec-button-shape-next__spinner,
                    .musicbrainz-button-renderer .yt-spec-button-shape-next__spinner circle,
                    .musicbrainz-button-renderer .yt-spec-button-shape-next__spinner path {
                        fill: none !important;
                    }

                    .musicbrainz-button-renderer [disabled],
                    .musicbrainz-button-renderer .disabled {
                        opacity: 0.6 !important;
                        cursor: not-allowed !important;
                        pointer-events: none !important;
                    }
                    @keyframes yt-btn-spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .yt-spec-button-shape-next__spinner {
                        animation: yt-btn-spin 0.8s linear infinite;
                        transform-origin: center center;
                    }
                `;
                head.appendChild(style);
            }
        },

        /**
         * Sets up observers for YouTube's SPA navigation.
         */
        _setupObservers: function () {
            document.addEventListener('yt-navigate-finish', (event) => {
                this._routePage(event);
            });
        },

        /**
         * Evaluates current URL and coordinates page-specific logic.
         * @param {CustomEvent} [event]
         */
        _routePage: function (event) {
            const currentVideoId = DOMScanner.getVideoId();
            if (currentVideoId) {
                ChannelButtonManager.hide();
                this.triggerUpdate(currentVideoId);
            } else if (DOMScanner.isChannelPage()) {
                RecordingButtonManager.hide();
                PlaylistButtonManager.hide();
                ChannelButtonManager.hide();
                this.triggerChannelUpdate(event);
            } else {
                RecordingButtonManager.hide();
                PlaylistButtonManager.hide();
                ChannelButtonManager.hide();
                this._processingVideoId = null;
                this._processingChannelKey = null;
            }
        },

        /**
         * Triggers the channel lookup and UI update.
         * @param {CustomEvent} [event]
         */
        triggerChannelUpdate: function (event) {
            const channelData = DOMScanner.getChannelData(event);
            const channelKey = channelData.channelId || channelData.handle || location.pathname;

            if (this._processingChannelKey === channelKey && this._currentChannelProcessingPromise) {
                return;
            }

            this._processingChannelKey = channelKey;

            this._currentChannelProcessingPromise = this._performChannelUpdate(channelData)
                .finally(() => {
                    if (this._processingChannelKey === channelKey) {
                        this._processingChannelKey = null;
                        this._currentChannelProcessingPromise = null;
                    }
                });
        },

        /**
         * Performs the channel lookup and renders the appropriate MusicBrainz channel action.
         * @param {{ channelId: string|null, handle: string|null, channelTitle: string, canonicalUrl: string|null, handleUrl: string|null }} channelData
         */
        _performChannelUpdate: async function (channelData) {
            const dockElement = await DOMScanner.getChannelAnchorElement();
            ChannelButtonManager.appendToDock(dockElement);

            const urlsToQuery = [];
            if (channelData.canonicalUrl) urlsToQuery.push(channelData.canonicalUrl);
            if (channelData.handleUrl && !urlsToQuery.includes(channelData.handleUrl)) {
                urlsToQuery.push(channelData.handleUrl);
            }

            // Also fallback to cleaned current URL if not already present
            const cleanPath = location.pathname.replace(/\/videos$|\/featured$|\/playlists$|\/community$|\/about$|\/shorts$|\/streams$/, '');
            const cleanLocationUrl = `${location.origin}${cleanPath}`;
            if (!urlsToQuery.includes(cleanLocationUrl) && cleanLocationUrl.includes('youtube.com')) {
                urlsToQuery.push(cleanLocationUrl);
            }

            if (urlsToQuery.length === 0) {
                ChannelButtonManager.hide();
                return;
            }

            const cachedUrlMap = new Map(urlsToQuery.map(u => [u, this._mbApi.cache.has(u)]));
            const isAllCached = urlsToQuery.every(u => cachedUrlMap.get(u));
            if (!isAllCached) {
                ChannelButtonManager.setPending();
            }

            try {
                const mbResults = await this.lookupMbUrls(urlsToQuery);

                // Collect all matched entities across queried URLs
                const foundEntities = [];
                let urlEntityId = null;

                for (const url of urlsToQuery) {
                    const mbUrlEntity = mbResults.get(url);
                    if (mbUrlEntity) {
                        if (!urlEntityId) urlEntityId = mbUrlEntity.id;
                        for (const rel of (mbUrlEntity.relations || [])) {
                            const targetType = rel['target-type'];
                            const targetObj = targetType ? rel[targetType] : null;
                            if (targetObj && targetObj.id) {
                                const id = targetObj.id;
                                const name = targetObj.name || targetObj.title || '';
                                if (!foundEntities.some(e => e.id === id)) {
                                    foundEntities.push({ targetType, id, name });
                                }
                            }
                        }
                    }
                }

                DOMScanner.logChannelSummary(channelData, urlsToQuery, mbResults, cachedUrlMap);

                if (foundEntities.length === 1) {
                    const { targetType, id, name } = foundEntities[0];
                    ChannelButtonManager.displayLinkedEntity(targetType, id, name);
                } else if (foundEntities.length > 1) {
                    ChannelButtonManager.displayMultiLinked(urlEntityId);
                } else {
                    ChannelButtonManager.displaySearchOrAdd(channelData.channelTitle, channelData.canonicalUrl || channelData.handleUrl, urlsToQuery);
                }
            } catch (error) {
                console.error(`[${GM.info.script.name}] Error in channel lookup:`, error);
                const apiName = error.apiName || 'API';
                const errorMessage = error.status === 503 ? L10n.getString('errorApiRateLimit', { apiName }) : L10n.getString('errorProcessing');
                ChannelButtonManager.displayError(errorMessage);
            }
        },

        /**
         * Triggers the update process for a given video ID.
         * This function acts as a gatekeeper to ensure only one update runs at a time.
         * @param {string|null} videoId - The YouTube video ID to process.
         */
        triggerUpdate: function (videoId) {
            if (this._processingVideoId === videoId && this._currentProcessingPromise) {
                return;
            }

            if (!videoId) {
                RecordingButtonManager.hide();
                PlaylistButtonManager.hide();
                this._processingVideoId = null;
                this._currentProcessingPromise = null;
                return;
            }

            this._processingVideoId = videoId;

            this._currentProcessingPromise = this._performUpdate(videoId)
                .finally(() => {
                    if (this._processingVideoId === videoId) {
                        this._processingVideoId = null;
                        this._currentProcessingPromise = null;
                    }
                });
        },

        /**
         * Performs the unified API calls and updates recording and playlist UI buttons.
         * @summary Unified single-pass extraction, MusicBrainz lookup, and UI resolution pipeline.
         * @param {string} videoId - The YouTube video ID to process.
         * @returns {Promise<void>} A promise that resolves when the update is complete.
         */
        _performUpdate: async function (videoId) {
            const dockElement = await DOMScanner.getButtonAnchorElement();
            RecordingButtonManager.appendToDock(dockElement);
            PlaylistButtonManager.appendToDock(dockElement);

            const ytData = InPageDataExtractor.extractVideoData(videoId);

            if (!ytData) {
                console.warn(`[${GM.info.script.name}] Could not extract metadata for video ID: ${videoId}`);
                RecordingButtonManager.displayInfo(L10n.getString('errorVideoNotFound'));
                PlaylistButtonManager.hide();
                return;
            }

            const canonicalYtUrl = new URL(`https://www.youtube.com/watch?v=${videoId}`).toString();
            const youtubeChannelUrl = ytData.snippet.channelId ? new URL(`https://www.youtube.com/channel/${ytData.snippet.channelId}`).toString() : null;
            const cleanHandle = ytData.snippet.channelHandle ? (ytData.snippet.channelHandle.startsWith('@') ? ytData.snippet.channelHandle : `@${ytData.snippet.channelHandle}`) : null;
            const youtubeHandleUrl = cleanHandle ? new URL(`https://www.youtube.com/${cleanHandle}`).toString() : null;

            // Prepare Single Query Array (Batched lookup)
            const urlsToQuery = [canonicalYtUrl];
            if (youtubeChannelUrl) urlsToQuery.push(youtubeChannelUrl);
            if (youtubeHandleUrl && !urlsToQuery.includes(youtubeHandleUrl)) urlsToQuery.push(youtubeHandleUrl);

            const cachedUrlMap = new Map(urlsToQuery.map(u => [u, this._mbApi.cache.has(u)]));
            const isFullyCached = urlsToQuery.every(u => cachedUrlMap.get(u));

            // If uncached, set pending dimmed state while querying to avoid layout jump
            if (!isFullyCached) {
                RecordingButtonManager.setPending();
                PlaylistButtonManager.setPending();
            }

            // Fetch MusicBrainz Data (single batched HTTP request for both video and channel)
            const mbResults = await this.lookupMbUrls(urlsToQuery);

            const mbVideoUrlEntity = mbResults.get(canonicalYtUrl);
            const artistMbid = youtubeChannelUrl ? this._extractArtistMbid(mbResults.get(youtubeChannelUrl)) : null;

            try {
                DOMScanner.logVideoSummary(ytData, urlsToQuery, mbResults, cachedUrlMap);
            } catch (diagError) {
                console.error(`[${GM.info.script.name}] Error logging video summary:`, diagError);
            }

            // ===== Run Recording Importer Logic and Playlist Logic in Parallel =====
            const recordingPromise = this._handleRecordingImport(ytData, canonicalYtUrl, youtubeChannelUrl, mbResults, mbVideoUrlEntity, artistMbid);
            const playlistPromise = this._handlePlaylistLogic(ytData, canonicalYtUrl);

            await Promise.all([recordingPromise, playlistPromise]);
        },

        /**
         * Resolves recording import status and configures the recording button.
         * @summary Evaluates MusicBrainz URL relationships and configures button state.
         * @param {Object} ytData - Extracted video data.
         * @param {string} canonicalYtUrl - Canonical watch URL.
         * @param {string|null} youtubeChannelUrl - Canonical channel URL if available.
         * @param {Map<string, Object|null>} mbResults - Map of MusicBrainz lookup results.
         * @param {Object|null} [mbVideoUrlEntity] - Resolved video URL entity if pre-computed.
         * @param {string|null} [artistMbid] - Resolved artist MBID if pre-computed.
         * @returns {Promise<void>}
         */
        _handleRecordingImport: async function (ytData, canonicalYtUrl, youtubeChannelUrl, mbResults, mbVideoUrlEntity, artistMbid) {
            try {
                const videoUrlEntity = mbVideoUrlEntity !== undefined ? mbVideoUrlEntity : mbResults.get(canonicalYtUrl);
                const artistId = artistMbid !== undefined ? artistMbid : (youtubeChannelUrl ? this._extractArtistMbid(mbResults.get(youtubeChannelUrl)) : null);

                if (videoUrlEntity) {
                    const allRelevantRecordingRelations = (videoUrlEntity.relations || []).filter(
                        rel => rel['type-id'] === Config.MUSICBRAINZ_FREE_STREAMING_RELATION_TYPE_ID &&
                            rel['target-type'] === "recording" &&
                            rel.recording && rel.recording.id
                    );

                    if (allRelevantRecordingRelations.length > 0) {
                        RecordingButtonManager.displayExistingButton(allRelevantRecordingRelations, videoUrlEntity.id, ytData, canonicalYtUrl);
                    } else {
                        RecordingButtonManager.prepareAddButton(ytData, canonicalYtUrl, artistId, ytData.id);
                    }
                } else {
                    RecordingButtonManager.prepareAddButton(ytData, canonicalYtUrl, artistId, ytData.id);
                }
            } catch (error) {
                console.error(`[${GM.info.script.name}] Error in recording import logic:`, error);
                const apiName = error.apiName || 'API';
                const errorMessage = error.status === 503 ? L10n.getString('errorApiRateLimit', { apiName }) : L10n.getString('errorProcessing');
                RecordingButtonManager.displayError(errorMessage);
            }
        },

        _handlePlaylistLogic: async function (ytData, canonicalYtUrl) {
            const { parsedTracks } = Utils.parseTracklist(ytData.snippet.description);
            if (parsedTracks.length === 0) {
                PlaylistButtonManager.hide();
                return;
            }

            if (!TokenManager.getTokenValue()) {
                PlaylistButtonManager.hide();
                return;
            }

            try {
                const searchResults = await ListenBrainzAPI.searchPlaylists(ytData.id);
                const perfectMatches = (searchResults.playlists || []).filter(p => p.playlist.annotation && p.playlist.annotation.includes(canonicalYtUrl));

                if (perfectMatches.length === 1) {
                    const playlist = perfectMatches[0].playlist;
                    const playlistMbid = playlist.identifier.split('/').pop();
                    const isINCOMPLETE = playlist.title.startsWith('[INCOMPLETE]');

                    if (isINCOMPLETE) {
                        PlaylistButtonManager.setStateSync(playlist.title, playlistMbid, () => {
                            PlaylistLogic.syncPlaylist(ytData, canonicalYtUrl, playlistMbid);
                        });
                    } else {
                        PlaylistButtonManager.setStateExists(playlist.title, playlistMbid);
                    }
                } else if (perfectMatches.length > 1) {
                    // Handle multiple matches case if necessary, for now link to search
                    const searchUrl = `https://listenbrainz.org/search/?search_type=playlist&search_term=${encodeURIComponent(canonicalYtUrl)}`;
                    PlaylistButtonManager.setStateExists('On LB (Multi)', searchUrl);
                } else {
                    PlaylistButtonManager.setStateCreate(() => {
                        PlaylistLogic.createPlaylist(ytData, canonicalYtUrl);
                    });
                }
            } catch (error) {
                console.error(`[${GM.info.script.name}] Error in playlist logic:`, error);
                const apiName = error.apiName || 'API';
                const errorMessage = error.status === 503 ? L10n.getString('errorApiRateLimit', { apiName }) : L10n.getString('errorProcessing');
                PlaylistButtonManager.displayError(errorMessage);
            }
        },
    };


    /**
     * Helper function to set the checked state of a checkbox by simulating a click.
     * @param {HTMLInputElement} checkbox - The checkbox element.
     * @param {boolean} isChecked - The desired checked state.
     */
    function setCheckboxState(checkbox, isChecked) {
        if (!checkbox || checkbox.disabled) {
            return;
        }
        if (checkbox.checked !== isChecked) {
            checkbox.click();
        }
    }

    /**
     * Handles logic specific to the MusicBrainz recording creation page.
     */
    const MusicBrainzRecordingCreatePage = {
        _mainVideoCheckbox: null,
        _externalLinksEditor: null,
        _mutationObserver: null,
        _isInternalSync: false,

        init: async function () {
            try {
                this._externalLinksEditor = await Utils.waitForElement(Config.SELECTORS.MUSICBRAINZ_EXTERNAL_LINKS_EDITOR, 10000);
                this._mainVideoCheckbox = await Utils.waitForElement(Config.SELECTORS.MUSICBRAINZ_MAIN_VIDEO_CHECKBOX, 10000);

                console.debug(`[${GM.info.script.name}] Initializing for MusicBrainz recording create page.`);
                this._setupListeners();
                this._setupMutationObserver();
                this._initialSync();
            } catch (error) {
                console.debug(`[${GM.info.script.name}] Not on MusicBrainz recording create page or elements not found:`, error.message);
            }
        },

        /**
         * A wrapper function to prevent event loops during checkbox synchronization.
         * It ensures the sync flag is always reset, even if an error occurs.
         * @param {Function} action - The function to execute while the guard is active.
         */
        _withSyncGuard: function (action) {
            if (this._isInternalSync) return;

            this._isInternalSync = true;
            try {
                action();
            } finally {
                this._isInternalSync = false;
            }
        },

        /**
         * Gets all 'video' checkboxes associated with external links.
         * @returns {NodeListOf<HTMLInputElement>} A NodeList of the checkbox elements.
         */
        _getIndividualVideoCheckboxes: function () {
            return this._externalLinksEditor.querySelectorAll(Config.SELECTORS.MUSICBRAINZ_INDIVIDUAL_VIDEO_CHECKBOX);
        },

        /**
         * Synchronizes the state of the main video checkbox to all individual video checkboxes.
         * @param {boolean} isChecked - The desired checked state.
         */
        _syncMainToIndividual: function (isChecked) {
            this._getIndividualVideoCheckboxes().forEach(checkbox => {
                setCheckboxState(checkbox, isChecked);
            });
        },

        /**
         * Synchronizes the state of individual video checkboxes to the main video checkbox.
         */
        _syncIndividualToMain: function () {
            const anyIndividualChecked = Array.from(this._getIndividualVideoCheckboxes()).some(checkbox => checkbox.checked);
            setCheckboxState(this._mainVideoCheckbox, anyIndividualChecked);
        },

        /**
         * Sets up event listeners for the main and existing individual video checkboxes.
         */
        _setupListeners: function () {
            this._mainVideoCheckbox.addEventListener('change', () => {
                this._withSyncGuard(() => {
                    this._syncMainToIndividual(this._mainVideoCheckbox.checked);
                    console.debug(`[${GM.info.script.name}] Main video checkbox toggled by user. Synced to individual checkboxes.`);
                });
            });

            this._getIndividualVideoCheckboxes().forEach(checkbox => {
                checkbox.addEventListener('change', () => {
                    this._withSyncGuard(() => {
                        this._syncIndividualToMain();
                        console.debug(`[${GM.info.script.name}] Individual video checkbox toggled by user. Synced to main checkbox.`);
                    });
                });
            });
            console.debug(`[${GM.info.script.name}] Initial listeners set up.`);
        },

        /**
         * Sets up a MutationObserver to detect dynamically added external link rows and attach listeners.
         */
        _setupMutationObserver: function () {
            this._mutationObserver = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) {
                                const relationshipItems = node.matches('.relationship-item') ? [node] : node.querySelectorAll('.relationship-item');
                                relationshipItems.forEach(item => {
                                    const checkbox = item.querySelector(Config.SELECTORS.MUSICBRAINZ_INDIVIDUAL_VIDEO_CHECKBOX);
                                    if (checkbox && !checkbox.dataset.mbSyncListenerAdded) {
                                        checkbox.addEventListener('change', () => {
                                            this._withSyncGuard(() => {
                                                this._syncIndividualToMain();
                                                console.debug(`[${GM.info.script.name}] New individual video checkbox toggled. Synced to main checkbox.`);
                                            });
                                        });
                                        checkbox.dataset.mbSyncListenerAdded = 'true';
                                        console.debug(`[${GM.info.script.name}] Listener attached to new individual video checkbox.`);

                                        if (this._mainVideoCheckbox && this._mainVideoCheckbox.checked) {
                                            setCheckboxState(checkbox, true);
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
            });

            this._mutationObserver.observe(this._externalLinksEditor, {
                childList: true,
                subtree: true
            });
            console.debug(`[${GM.info.script.name}] MutationObserver set up for external links editor.`);
        },

        /**
         * Performs an initial synchronization of checkbox states when the script loads.
         */
        _initialSync: function () {
            this._withSyncGuard(() => {
                if (this._mainVideoCheckbox.checked) {
                    this._syncMainToIndividual(true);
                    console.debug(`[${GM.info.script.name}] Main video checkbox was pre-checked by URL. Synced all individual checkboxes to true.`);
                } else {
                    this._syncIndividualToMain();
                    console.debug(`[${GM.info.script.name}] Main video checkbox not pre-checked by URL. Synced main checkbox based on individual links.`);
                }
            });
            console.debug(`[${GM.info.script.name}] Initial sync completed.`);
        }
    };


    if (window.location.href.includes('musicbrainz.org/recording/create')) {
        MusicBrainzRecordingCreatePage.init();
    } else if (window.location.hostname.includes('youtube.com')) {
        YouTubeMusicBrainzImporter.init();
    }

})();
