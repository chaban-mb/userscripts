// ==UserScript==
// @name         YouTube: MusicBrainz Importer
// @namespace    https://musicbrainz.org/user/chaban
// @version      2.5.3
// @description  Imports YouTube videos to MusicBrainz as a new standalone recording
// @tag          ai-created
// @author       nikki, RustyNova, chaban
// @license      MIT
// @match        *://www.youtube.com/*
// @match        *://musicbrainz.org/recording/create*
// @connect      googleapis.com
// @connect      musicbrainz.org
// @icon         https://www.google.com/s2/favicons?sz=256&domain=youtube.com
// @grant        GM.xmlHttpRequest
// @run-at       document-end
// @noframes
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
                onMBMulti: 'On MB (Multi) ✓',
                addRecordingTitle: 'Add to MusicBrainz as recording',
                updateLengthTitle: 'The linked MusicBrainz recording is missing its length. Click to update it to {length}s.',
                linkedToRecordingTitle: 'This YouTube video is linked to MusicBrainz recording: {title}',
                linkedToMultiTitle: 'This YouTube video is linked to multiple recordings on MusicBrainz.\nClick to view URL entity page.',
                errorVideoNotFound: 'Video Not Found / YT API Error',
                errorApiRateLimit: '{apiName} Rate Limit / Server Error',
                errorApiNetwork: '{apiName} Network Error',
                errorProcessing: 'Processing Error',
            },
            de: {
                loading: 'Wird geladen...',
                addRecording: 'Aufnahme hinzufügen',
                updateLength: 'Länge aktualisieren',
                onMB: 'Auf MB ✓',
                onMBMulti: 'Auf MB (Multi) ✓',
                addRecordingTitle: 'Als Aufnahme zu MusicBrainz hinzufügen',
                updateLengthTitle: 'Bei der verknüpften MusicBrainz-Aufnahme fehlt die Länge. Klicken, um sie auf {length}s zu aktualisieren.',
                linkedToRecordingTitle: 'Dieses YouTube-Video ist mit der MusicBrainz-Aufnahme verknüpft: {title}',
                linkedToMultiTitle: 'Dieses YouTube-Video ist mit mehreren Aufnahmen auf MusicBrainz verknüpft.\nKlicken, um die URL-Entitätsseite anzuzeigen.',
                errorVideoNotFound: 'Video nicht gefunden / YT API-Fehler',
                errorApiRateLimit: '{apiName} Ratenlimit / Serverfehler',
                errorApiNetwork: '{apiName} Netzwerkfehler',
                errorProcessing: 'Verarbeitungsfehler',
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
        GOOGLE_API_KEY: 'AIzaSyC5syukuFyCSoRvMr42Geu_d_1c_cRYouU',
        MUSICBRAINZ_API_ROOT: 'https://musicbrainz.org/ws/2/',
        YOUTUBE_API_ROOT: 'https://www.googleapis.com/youtube/v3/',
        YOUTUBE_API_VIDEO_PARTS: 'snippet,id,contentDetails',

        MAX_RETRIES: 5,
        INITIAL_RETRY_DELAY_MS: 1000,
        RETRY_BACKOFF_FACTOR: 2,

        SELECTORS: {
            BUTTON_DOCK: '#top-row.ytd-watch-metadata #owner.ytd-watch-metadata',
            MUSICBRAINZ_MAIN_VIDEO_CHECKBOX: '[name="edit-recording.video"]',
            MUSICBRAINZ_EXTERNAL_LINKS_EDITOR: '#external-links-editor',
            MUSICBRAINZ_INDIVIDUAL_VIDEO_CHECKBOX: '.relationship-item input[type="checkbox"]',
        },

        CLASS_NAMES: {
            CONTAINER: 'musicbrainz-userscript-container',
            BUTTON: 'search-button',
            BUTTON_READY: 'mb-ready',
            BUTTON_ADDED: 'mb-added',
            BUTTON_ERROR: 'mb-error',
            BUTTON_INFO: 'mb-info',
            BUTTON_UPDATE: 'mb-update', // Class for the update button
        },

        MUSICBRAINZ_FREE_STREAMING_LINK_TYPE_ID: '268',
        MUSICBRAINZ_FREE_STREAMING_RELATION_TYPE_ID: '7e41ef12-a124-4324-afdb-fdbae687a89c',
    };

    const USER_AGENT = `${Config.SHORT_APP_NAME}/${GM_info.script.version} ( ${GM_info.script.namespace} )`;

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
        waitForElement: function (selector, timeout = 7000) {
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

                observer = new MutationObserver((mutations, obs) => {
                    const targetElement = document.querySelector(selector);
                    if (targetElement) {
                        clearTimeout(timer);
                        obs.disconnect();
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
                ...(details.headers || {})
            };

            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: details.method || 'GET',
                    url: details.url,
                    headers: headers,
                    data: details.data || null,
                    anonymous: details.anonymous || false,
                    onload: (response) => {
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
                        console.error(`[${GM.info.script.name}] ${apiName} network error:`, response);
                        const error = new Error(`Network error for ${apiName}: ${response.statusText}`);
                        error.status = response.status;
                        error.apiName = apiName;
                        reject(error);
                    },
                    ontimeout: () => {
                        console.error(`[${GM.info.script.name}] ${apiName} request timed out.`);
                        const error = new Error(`Request to ${apiName} timed out`);
                        error.status = 408;
                        error.apiName = apiName;
                        reject(error);
                    }
                });
            });
        },

        /**
         * Converts ISO8601 duration to milliseconds using a single regular expression.
         * Handles durations with date and time parts (e.g., P1DT12H30M5.5S).
         * https://en.wikipedia.org/wiki/ISO_8601#Durations
         * @param {string} str - The ISO8601 duration string.
         * @returns {number} The duration in milliseconds, or NaN if invalid.
         */
        ISO8601toMilliSeconds: function (str) {
            // This single regex captures the optional Day part, and the optional Time part (which must be preceded by 'T').
            // Groups: 1=Days, 2=Hours, 3=Minutes, 4=Seconds
            const regex = /^P(?:(\d*\.?\d*)D)?(?:T(?:(\d*\.?\d*)H)?(?:(\d*\.?\d*)M)?(?:(\d*\.?\d*)S)?)?$/;

            const matches = str.replace(',', '.').match(regex);

            // If the regex doesn't match, or if it matches but finds no duration components (e.g., input is "P" or "PT"), return NaN.
            if (!matches || matches.slice(1).every(part => part === undefined)) {
                return NaN;
            }

            const days = parseFloat(matches[1] || 0);
            const hours = parseFloat(matches[2] || 0);
            const minutes = parseFloat(matches[3] || 0);
            const seconds = parseFloat(matches[4] || 0);

            const totalSeconds = (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;

            return totalSeconds * 1000;
        }
    };

    /**
     * Handles all interactions with the YouTube Data API.
     */
    const YouTubeAPI = {
        _videoDataCache: new Map(),

        /**
         * Fetches minimalist video data from the YouTube Data API.
         * @param {string} videoId - The YouTube video ID.
         * @returns {Promise<Object|null>} A promise that resolves with the video data, or null if not found/error.
         */
        fetchVideoData: async function (videoId) {
            if (this._videoDataCache.has(videoId)) {
                const cachedData = this._videoDataCache.get(videoId);
                console.log(`[${GM.info.script.name}] YouTube API response found in cache for video ID: ${videoId}.`);
                return cachedData !== false ? cachedData : null;
            }

            const url = new URL('videos', Config.YOUTUBE_API_ROOT);
            url.searchParams.append('part', Config.YOUTUBE_API_VIDEO_PARTS);
            url.searchParams.append('id', videoId);
            url.searchParams.append('key', Config.GOOGLE_API_KEY);

            console.log(`[${GM.info.script.name}] Calling YouTube API for video ID:`, videoId);
            try {
                const response = await Utils.gmXmlHttpRequest({
                    method: 'GET',
                    url: url.toString(),
                }, 'YouTube API');

                const parsedFullResponse = JSON.parse(response.responseText);
                if (parsedFullResponse.items && parsedFullResponse.items.length > 0) {
                    const videoData = parsedFullResponse.items[0];
                    const minimalStructuredData = {
                        id: videoData.id,
                        snippet: {
                            title: videoData.snippet.title,
                            channelTitle: videoData.snippet.channelTitle,
                            channelId: videoData.snippet.channelId,
                        },
                        contentDetails: {
                            duration: videoData.contentDetails.duration
                        }
                    };
                    this._videoDataCache.set(videoId, minimalStructuredData);
                    return minimalStructuredData;
                } else {
                    console.log(`[${GM.info.script.name}] YouTube API returned no items for video ID: ${videoId}.`);
                    this._videoDataCache.set(videoId, false);
                    return null;
                }
            } catch (error) {
                console.error(`[${GM.info.script.name}] Error fetching YouTube video data for ${videoId}:`, error);
                this._videoDataCache.set(videoId, false);
                throw error;
            }
        },
    };

    /**
     * Handles all interactions with the MusicBrainz API.
     */
    const MusicBrainzAPI = {
        _urlCache: new Map(),
        _requestQueue: [],
        _isProcessingQueue: false,
        _lastRequestTime: 0,

        /**
         * Throttles GM.xmlHttpRequest calls to respect MusicBrainz API rate limits.
         * @param {Object} options - Request options.
         * @returns {Promise<Object>} A promise that resolves with the response object.
         */
        _throttledGmXmlHttpRequest: function (options) {
            return new Promise((resolve, reject) => {
                const request = {
                    options,
                    resolve,
                    reject
                };
                this._requestQueue.push(request);
                this._processQueue();
            });
        },

        /**
         * Processes the request queue, respecting the rate limit.
         */
        _processQueue: function () {
            if (this._isProcessingQueue || this._requestQueue.length === 0) {
                return;
            }

            this._isProcessingQueue = true;
            const now = Date.now();

            const timeSinceLastRequest = now - this._lastRequestTime;
            const delay = Math.max(0, Config.INITIAL_RETRY_DELAY_MS - timeSinceLastRequest);

            setTimeout(async () => {
                const request = this._requestQueue.shift();
                if (request) {
                    try {
                        const response = await Utils.gmXmlHttpRequest(request.options, 'MusicBrainz API');
                        request.resolve(response);
                    } catch (error) {
                        request.reject(error);
                    } finally {
                        this._lastRequestTime = Date.now();
                        this._isProcessingQueue = false;
                        this._processQueue();
                    }
                } else {
                    this._isProcessingQueue = false;
                }
            }, delay);
        },

        /**
         * Looks up multiple URLs on MusicBrainz to find existing relations.
         * @param {string[]} canonicalUrls - An array of canonical URLs to look up.
         * @returns {Promise<Map<string, Object|null>>} A promise that resolves with a Map where keys are URLs and values are MusicBrainz URL entity data (including relations), or null if not found/error.
         */
        lookupUrls: async function (canonicalUrls) {
            const resultsMap = new Map();
            const urlsToFetch = [];

            for (const url of canonicalUrls) {
                if (this._urlCache.has(url)) {
                    const cachedData = this._urlCache.get(url);
                    if (cachedData !== false && cachedData !== null) {
                        console.log(`[${GM.info.script.name}] MusicBrainz URL entity found in cache for ${url}.`);
                    } else {
                        console.log(`[${GM.info.script.name}] MusicBrainz URL not found in cache for ${url}.`);
                    }
                    resultsMap.set(url, cachedData !== false ? cachedData : null);
                } else {
                    urlsToFetch.push(url);
                }
            }

            if (urlsToFetch.length === 0) {
                return resultsMap;
            }

            const url = new URL('url', Config.MUSICBRAINZ_API_ROOT);
            urlsToFetch.forEach(resUrl => url.searchParams.append('resource', resUrl));
            url.searchParams.append('inc', 'recording-rels+artist-rels');
            url.searchParams.append('fmt', 'json');

            console.log(`[${GM.info.script.name}] :`, url.toString());
            try {
                const response = await this._throttledGmXmlHttpRequest({
                    method: 'GET',
                    url: url.toString(),
                    headers: {
                        "User-Agent": USER_AGENT,
                    },
                    anonymous: true,
                });

                const data = JSON.parse(response.responseText);

                if (urlsToFetch.length === 1) {
                    if (data && data.resource === urlsToFetch[0]) {
                        this._urlCache.set(urlsToFetch[0], data);
                        resultsMap.set(urlsToFetch[0], data);
                    } else {
                        this._urlCache.set(urlsToFetch[0], false);
                        resultsMap.set(urlsToFetch[0], null);
                    }
                } else {
                    if (data.urls && data.urls.length > 0) {
                        for (const urlEntity of data.urls) {
                            const originalUrl = urlsToFetch.find(u => u === urlEntity.resource);
                            if (originalUrl) {
                                this._urlCache.set(originalUrl, urlEntity);
                                resultsMap.set(originalUrl, urlEntity);
                            }
                        }
                    }
                }

                for (const url of urlsToFetch) {
                    if (!resultsMap.has(url)) {
                        this._urlCache.set(url, false);
                        resultsMap.set(url, null);
                    }
                }
                return resultsMap;

            } catch (error) {
                if (error.status === 404 && urlsToFetch.length === 1) {
                    console.info(`[${GM.info.script.name}] MusicBrainz URL not found (404) for single URL: ${urlsToFetch[0]}. This is expected and handled.`);
                    this._urlCache.set(urlsToFetch[0], false);
                    resultsMap.set(urlsToFetch[0], null);
                    return resultsMap;
                } else {
                    console.error(`[${GM.info.script.name}] Error looking up MusicBrainz URLs:`, error);
                    throw error;
                }
            }
        },

        /**
         * Extracts the Artist MBID from a MusicBrainz URL entity if it contains artist relations.
         * @param {Object|null} channelUrlEntity - The MusicBrainz URL entity object for a channel.
         * @returns {string|null} The Artist MBID if found, otherwise null.
         */
        _extractArtistMbid: function (channelUrlEntity) {
            if (!channelUrlEntity || !channelUrlEntity.relations) return null;
            for (const relation of channelUrlEntity.relations) {
                if (relation['target-type'] === 'artist' && relation.artist && relation.artist.id) {
                    return relation.artist.id;
                }
            }
            return null;
        }
    };

    /**
     * Scans the DOM for relevant elements and extracts information.
     */
    const DOMScanner = {
        /**
         * Checks if the current page is a YouTube video watch page.
         * @returns {string|null} The video ID if it's a video page, otherwise null.
         */
        getVideoId: function () {
            const videoIdMatch = location.href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
            return videoIdMatch ? videoIdMatch[1] : null;
        },

        /**
         * Finds the DOM element where the import button should be appended.
         * @returns {Promise<HTMLElement|null>} A promise that resolves with the dock element, or null if not found.
         */
        getButtonAnchorElement: async function () {
            try {
                const dock = await Utils.waitForElement(Config.SELECTORS.BUTTON_DOCK, 5000);
                console.log(`[${GM.info.script.name}] Found button dock:`, dock);
                return dock;
            } catch (e) {
                console.error(`[${GM.info.script.name}] Could not find button dock element:`, e);
                return null;
            }
        },
    };

    /**
     * Manages the creation, display, and state of the MusicBrainz import button.
     */
    const ButtonManager = {
        _form: null,
        _submitButton: null,
        _textElement: null,
        _containerDiv: null,

        /**
         * Initializes the button elements and their basic structure.
         */
        init: function () {
            this._containerDiv = document.createElement("div");
            this._containerDiv.setAttribute("class", `holder ${Config.CLASS_NAMES.CONTAINER}`);
            this._containerDiv.style.display = 'none';

            this._form = document.createElement("form");
            this._form.method = "get";
            this._form.action = "//musicbrainz.org/recording/create";
            this._form.acceptCharset = "UTF-8";
            this._form.target = "_blank";

            this._submitButton = document.createElement("button");
            this._submitButton.type = "submit";
            this._submitButton.title = L10n.getString('addRecordingTitle');
            this._submitButton.setAttribute("class", Config.CLASS_NAMES.BUTTON);
            this._textElement = document.createElement("span");
            this._textElement.innerText = L10n.getString('loading');

            const buttonContent = document.createElement('div');
            buttonContent.style.display = 'flex';
            buttonContent.style.alignItems = 'center';
            buttonContent.appendChild(this._textElement);
            this._submitButton.appendChild(buttonContent);

            this._form.appendChild(this._submitButton);
            this._containerDiv.appendChild(this._form);
        },

        /**
         * Resets the button state, clearing previous form fields and setting to loading.
         */
        resetState: function () {
            Array.from(this._form.querySelectorAll('input[type="hidden"]')).forEach(input => this._form.removeChild(input));
            while (this._containerDiv.firstChild) {
                this._containerDiv.removeChild(this._containerDiv.firstChild);
            }
            this._containerDiv.appendChild(this._form);

            this._textElement.innerText = L10n.getString('loading');
            this._submitButton.className = Config.CLASS_NAMES.BUTTON;
            this._submitButton.disabled = true;
            this._form.style.display = 'flex';
            this._containerDiv.style.display = 'flex';
        },

        /**
         * Appends a hidden input field to the form.
         * @param {string} name - The name attribute of the input field.
         * @param {string} value - The value attribute of the input field.
         */
        _addField: function (name, value) {
            if (!this._form) return;
            const field = document.createElement("input");
            field.type = "hidden";
            field.name = name;
            field.value = value;
            this._form.insertBefore(field, this._submitButton);
        },

        /**
         * Appends the button container to the specified dock element.
         * If dock is null, it appends to body as a fallback.
         * @param {HTMLElement|null} dockElement - The element to append the button to.
         */
        appendToDock: function (dockElement) {
            if (document.body.contains(this._containerDiv)) {
                return;
            }

            if (dockElement) {
                dockElement.appendChild(this._containerDiv);
                console.log(`[${GM.info.script.name}] Button UI appended to dock.`);
            } else {
                console.warn(`[${GM.info.script.name}] Could not find a suitable dock element. Appending to body as last resort.`);
                document.body.appendChild(this._containerDiv);
                this._containerDiv.style.position = 'fixed';
                this._containerDiv.style.top = '10px';
                this._containerDiv.style.right = '10px';
                this._containerDiv.style.zIndex = '9999';
                this._containerDiv.style.background = 'rgba(0,0,0,0.7)';
                this._containerDiv.style.padding = '5px';
                this._containerDiv.style.borderRadius = '5px';
            }
        },

        /**
         * Prepares the form with YouTube video data and displays the "Add Recording" button.
         * @param {Object} youtubeVideoData - The minimalist YouTube video data.
         * @param {string} canonicalYtUrl - The canonical YouTube URL.
         * @param {string|null} artistMbid - The MusicBrainz Artist MBID if found.
         * @param {string} videoId - The YouTube video ID.
         */
        prepareAddButton: function (youtubeVideoData, canonicalYtUrl, artistMbid, videoId) {
            const title = youtubeVideoData.snippet.title;
            const artist = youtubeVideoData.snippet.channelTitle;

            let length = 0;
            if (youtubeVideoData.contentDetails && typeof youtubeVideoData.contentDetails.duration === 'string') {
                length = Utils.ISO8601toMilliSeconds(youtubeVideoData.contentDetails.duration);
            }

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
            const editNote = `${document.location.href}\n—\n${scriptInfo.name} (v${scriptInfo.version})`;
            this._addField('edit-recording.edit_note', editNote);

            this._textElement.innerText = L10n.getString('addRecording');
            this._submitButton.className = `${Config.CLASS_NAMES.BUTTON} ${Config.CLASS_NAMES.BUTTON_READY}`;
            this._submitButton.disabled = false;
            this._form.style.display = 'flex';

            this._submitButton.onclick = () => {
                console.log(`[${GM.info.script.name}] Import button clicked. Clearing cache for video ID: ${videoId}`);
                MusicBrainzAPI._urlCache.delete(canonicalYtUrl);

                if (youtubeVideoData.snippet.channelId) {
                    const youtubeChannelUrl = new URL(`https://www.youtube.com/channel/${youtubeVideoData.snippet.channelId}`).toString();
                    MusicBrainzAPI._urlCache.delete(youtubeChannelUrl);
                }
            };
        },

        /**
         * Displays the "On MB ✓" button, linking to the existing MusicBrainz entity.
         * If the recording has no length, it provides a button to update it.
         * @param {Array} allRelevantRecordingRelations - An array of recording relations.
         * @param {string} urlEntityId - The MusicBrainz URL entity ID.
         * @param {Object} youtubeVideoData - The minimalist YouTube video data.
         */
        displayExistingButton: function (allRelevantRecordingRelations, urlEntityId, youtubeVideoData) {
            this._form.style.display = 'none';
            const link = document.createElement('a');
            link.style.textDecoration = 'none';
            link.target = '_blank';

            const button = document.createElement('button');
            const span = document.createElement('span');
            button.appendChild(span);
            link.appendChild(button);

            if (allRelevantRecordingRelations.length === 1) {
                const existingRecordingRelation = allRelevantRecordingRelations[0];
                const recordingMBID = existingRecordingRelation.recording.id;
                const recordingTitle = existingRecordingRelation.recording.title || "View Recording";
                const hasLength = existingRecordingRelation.recording.length != null;
                const ytHasLength = youtubeVideoData && youtubeVideoData.contentDetails && youtubeVideoData.contentDetails.duration;

                // Check if the recording is missing the length and we have a length from YouTube
                if (!hasLength && ytHasLength) {
                    const lengthInMs = Utils.ISO8601toMilliSeconds(youtubeVideoData.contentDetails.duration);
                    const scriptInfo = GM_info.script;
                    const editNote = `${document.location.href}\n—\n${scriptInfo.name} (v${scriptInfo.version})`;
                    const encodedEditNote = encodeURIComponent(editNote);
                    link.href = `//musicbrainz.org/recording/${recordingMBID}/edit?edit-recording.length=${lengthInMs}&edit-recording.edit_note=${encodedEditNote}`;
                    link.title = L10n.getString('updateLengthTitle', {
                        length: Math.round(lengthInMs / 1000)
                    });
                    span.textContent = L10n.getString('updateLength');
                    button.className = `${Config.CLASS_NAMES.BUTTON} ${Config.CLASS_NAMES.BUTTON_UPDATE}`;
                    console.log(`[${GM.info.script.name}] Displaying 'Update Length' button for recording ${recordingMBID}.`);
                } else {
                    // Default behavior: link to the recording page
                    link.href = `//musicbrainz.org/recording/${recordingMBID}`;
                    link.title = L10n.getString('linkedToRecordingTitle', {
                        title: recordingTitle
                    });
                    span.textContent = L10n.getString('onMB');
                    button.className = `${Config.CLASS_NAMES.BUTTON} ${Config.CLASS_NAMES.BUTTON_ADDED}`;
                }
            } else {
                console.log(`[${GM.info.script.name}] Multiple recording relations found. Linking to URL entity page.`);
                link.href = `//musicbrainz.org/url/${urlEntityId}`;
                link.title = L10n.getString('linkedToMultiTitle');
                span.textContent = L10n.getString('onMBMulti');
                button.className = `${Config.CLASS_NAMES.BUTTON} ${Config.CLASS_NAMES.BUTTON_ADDED}`;
            }
            this._containerDiv.appendChild(link);
            console.log(`[${GM.info.script.name}] Displaying existing link button.`);
        },

        /**
         * Displays an error button with a given message.
         * @param {string} message - The error message to display.
         */
        displayError: function (message) {
            this.resetState();
            this._textElement.innerText = message;
            this._submitButton.className = `${Config.CLASS_NAMES.BUTTON} ${Config.CLASS_NAMES.BUTTON_ERROR}`;
            this._submitButton.disabled = true;
            this._containerDiv.style.display = 'flex';
        },

        /**
         * Displays an informational button with a given message.
         * @param {string} message - The info message to display.
         */
        displayInfo: function (message) {
            this.resetState();
            this._textElement.innerText = message;
            this._submitButton.className = `${Config.CLASS_NAMES.BUTTON} ${Config.CLASS_NAMES.BUTTON_INFO}`;
            this._submitButton.disabled = true;
            this._containerDiv.style.display = 'flex';
        }
    };

    /**
     * Main application logic for the userscript.
     */
    const YouTubeMusicBrainzImporter = {
        _previousUrl: '',
        _processingVideoId: null,
        _currentProcessingPromise: null,
        _navigationTimeoutId: null,
        _prefetchedDataPromise: null,
        _prefetchedVideoId: null,

        /**
         * Initializes the application: injects CSS and sets up observers.
         */
        init: function () {
            this._injectCSS();
            ButtonManager.init();
            this._setupObservers();
            this._setupUrlChangeListeners();
            this._previousUrl = window.location.href;

            this.triggerUpdate(DOMScanner.getVideoId());
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
                        /* Add any container specific styles here if needed */
                    }
                    .dashbox {
                        padding-bottom: 4px;
                    }
                    .button-area {
                        display: flex;
                        padding: 5px;
                    }
                    .button-favicon {
                        height: 1.25em;
                        margin-left: 5px;
                    }
                    .holder {
                        height: 100%;
                        display: flex;
                        align-items: center;
                    }
                    .${Config.CLASS_NAMES.BUTTON} {
                        border-radius: 18px;
                        border: none;
                        padding: 0px 10px;
                        font-size: 14px;
                        height: 36px;
                        color: white;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        text-decoration: none;
                        margin: 0px 0 0 8px;
                        background-color: #f8f8f8;
                        color: #0f0f0f;
                        transition: background-color .3s;
                    }
                    .${Config.CLASS_NAMES.BUTTON}:hover {
                        background-color: #e0e0e0;
                    }
                    .${Config.CLASS_NAMES.BUTTON}[disabled] {
                        opacity: 0.7;
                        cursor: not-allowed;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_READY} {
                        background-color: #BA478F;
                        color: white;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_READY}:hover {
                        background-color: #a53f7c;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_ADDED} {
                        background-color: #a4a4a4;
                        color: white;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_ADDED}:hover {
                        background-color: #8c8c8c;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_UPDATE} {
                        background-color: #3ea6ff; /* A different color to stand out */
                        color: white;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_UPDATE}:hover {
                        background-color: #3593e0;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_ERROR} {
                        background-color: #cc0000;
                        color: white;
                    }
                    .${Config.CLASS_NAMES.BUTTON}.${Config.CLASS_NAMES.BUTTON_INFO} {
                        background-color: #3ea6ff;
                        color: white;
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
                console.log(`[${GM.info.script.name}] 'yt-navigate-finish' event detected.`);

                if (this._navigationTimeoutId) {
                    clearTimeout(this._navigationTimeoutId);
                    this._navigationTimeoutId = null;
                    console.log(`[${GM.info.script.name}] Cleared previous navigation timeout.`);
                }

                this._navigationTimeoutId = setTimeout(() => {
                    const currentVideoId = DOMScanner.getVideoId();
                    this.triggerUpdate(currentVideoId);
                }, 500);
            });
        },

        /**
         * Sets up event listeners for URL changes to initiate pre-fetching of data.
         */
        _setupUrlChangeListeners: function () {
            document.addEventListener('yt-navigate-start', () => {
                const currentVideoId = DOMScanner.getVideoId();
                if (currentVideoId && currentVideoId !== this._prefetchedVideoId) {
                    console.log(`[${GM.info.script.name}] 'yt-navigate-start' detected for video ID: ${currentVideoId}. Initiating pre-fetch.`);
                    this._prefetchedVideoId = currentVideoId;
                    this._prefetchedDataPromise = this._startPrefetching(currentVideoId);
                } else if (!currentVideoId && this._prefetchedVideoId) {
                    console.log(`[${GM.info.script.name}] Navigated away from video page. Clearing pre-fetch state.`);
                    this._prefetchedVideoId = null;
                    this._prefetchedDataPromise = null;
                }
            });

            window.addEventListener('popstate', () => {
                const currentVideoId = DOMScanner.getVideoId();
                if (currentVideoId && currentVideoId !== this._prefetchedVideoId) {
                    console.log(`[${GM.info.script.name}] 'popstate' detected for video ID: ${currentVideoId}. Initiating pre-fetch.`);
                    this._prefetchedVideoId = currentVideoId;
                    this._prefetchedDataPromise = this._startPrefetching(currentVideoId);
                } else if (!currentVideoId && this._prefetchedVideoId) {
                    console.log(`[${GM.info.script.name}] Navigated away from video page. Clearing pre-fetch state.`);
                    this._prefetchedVideoId = null;
                    this._prefetchedDataPromise = null;
                }
            });

            console.log(`[${GM.info.script.name}] URL change listeners (yt-navigate-start, popstate) set up.`);
        },


        /**
         * Initiates the pre-fetching of YouTube and MusicBrainz data for a given video ID.
         * @param {string} videoId - The YouTube video ID.
         * @returns {Promise<[Object|null, Map<string, Object|null>]>} A promise that resolves with an array
         * containing [youtubeVideoData, musicBrainzUrlResultsMap] or [null, null] on error.
         */
        _startPrefetching: async function (videoId) {
            try {
                const ytDataPromise = YouTubeAPI.fetchVideoData(videoId);
                const canonicalYtUrl = new URL(`https://www.youtube.com/watch?v=${videoId}`).toString();

                const ytData = await ytDataPromise;

                if (!ytData) {
                    console.warn(`[${GM.info.script.name}] YT data not available for pre-fetching ${videoId}. Skipping MB pre-fetch.`);
                    return [null, null];
                }

                const youtubeChannelUrl = ytData.snippet.channelId ? new URL(`https://www.youtube.com/channel/${ytData.snippet.channelId}`).toString() : null;
                const urlsToQuery = [canonicalYtUrl];
                if (youtubeChannelUrl) {
                    urlsToQuery.push(youtubeChannelUrl);
                }
                const mbResultsPromise = MusicBrainzAPI.lookupUrls(urlsToQuery);

                const [finalYtData, finalMbResults] = await Promise.all([Promise.resolve(ytData), mbResultsPromise]);
                console.log(`[${GM.info.script.name}] Pre-fetching completed for video ID: ${videoId}.`);
                return [finalYtData, finalMbResults];
            } catch (error) {
                console.error(`[${GM.info.script.name}] Error during pre-fetching for video ID: ${videoId}:`, error);
                return [null, null];
            }
        },

        /**
         * Triggers the update process for a given video ID.
         * This function acts as a gatekeeper to ensure only one update runs at a time.
         * @param {string|null} videoId - The YouTube video ID to process.
         */
        triggerUpdate: function (videoId) {
            if (this._processingVideoId === videoId && this._currentProcessingPromise) {
                console.log(`[${GM.info.script.name}] Already processing video ID: ${videoId}. Skipping trigger.`);
                return;
            }

            ButtonManager.resetState();
            if (!videoId) {
                ButtonManager._containerDiv.style.display = 'none';
                this._processingVideoId = null;
                this._currentProcessingPromise = null;
                console.log(`[${GM.info.script.name}] Not a YouTube video page. Hiding button.`);
                return;
            }

            this._processingVideoId = videoId;
            console.log(`[${GM.info.script.name}] Triggering update for video ID: ${videoId}`);

            if (videoId === this._prefetchedVideoId && this._prefetchedDataPromise) {
                console.log(`[${GM.info.script.name}] Using pre-fetched data for video ID: ${videoId}.`);
                this._currentProcessingPromise = this._prefetchedDataPromise
                    .then(([ytData, mbResults]) => this._performUpdate(videoId, ytData, mbResults))
                    .finally(() => {
                        if (this._processingVideoId === videoId) {
                            this._processingVideoId = null;
                            this._currentProcessingPromise = null;
                            this._prefetchedDataPromise = null;
                            this._prefetchedVideoId = null;
                        }
                    });
            } else {
                console.log(`[${GM.info.script.name}] No pre-fetched data or different video. Performing full update for video ID: ${videoId}.`);
                this._currentProcessingPromise = this._performUpdate(videoId)
                    .finally(() => {
                        if (this._processingVideoId === videoId) {
                            this._processingVideoId = null;
                            this._currentProcessingPromise = null;
                        }
                    });
            }
        },

        /**
         * The actual function that performs the API calls and UI updates.
         * @param {string} videoId - The YouTube video ID to process.
         * @param {Object|null} [prefetchedYtData=null] - Optional pre-fetched YouTube video data.
         * @param {Map<string, Object|null>|null} [prefetchedMbResults=null] - Optional pre-fetched MusicBrainz URL lookup results.
         * @returns {Promise<void>} A promise that resolves when the update is complete.
         */
        _performUpdate: async function (videoId, prefetchedYtData = null, prefetchedMbResults = null) {
            let ytData = prefetchedYtData;
            let mbResults = prefetchedMbResults;

            try {
                const dockElement = await DOMScanner.getButtonAnchorElement();
                ButtonManager.appendToDock(dockElement);

                if (!ytData) {
                    ytData = await YouTubeAPI.fetchVideoData(videoId);
                }
                if (!ytData) {
                    ButtonManager.displayInfo(L10n.getString('errorVideoNotFound'));
                    return;
                }

                const canonicalYtUrl = new URL(`https://www.youtube.com/watch?v=${videoId}`).toString();
                const youtubeChannelUrl = ytData.snippet.channelId ? new URL(`https://www.youtube.com/channel/${ytData.snippet.channelId}`).toString() : null;

                const urlsToQuery = [canonicalYtUrl];
                if (youtubeChannelUrl) {
                    urlsToQuery.push(youtubeChannelUrl);
                }

                if (!mbResults) {
                    mbResults = await MusicBrainzAPI.lookupUrls(urlsToQuery);
                }

                const mbVideoUrlEntity = mbResults.get(canonicalYtUrl);
                const artistMbid = youtubeChannelUrl ? MusicBrainzAPI._extractArtistMbid(mbResults.get(youtubeChannelUrl)) : null;

                if (mbVideoUrlEntity) {
                    const allRelevantRecordingRelations = (mbVideoUrlEntity.relations || []).filter(
                        rel => rel['type-id'] === Config.MUSICBRAINZ_FREE_STREAMING_RELATION_TYPE_ID &&
                            rel['target-type'] === "recording" &&
                            rel.recording && rel.recording.id
                    );

                    if (allRelevantRecordingRelations.length > 0) {
                        console.log(`[${GM.info.script.name}] Video already linked on MusicBrainz.`);
                        ButtonManager.displayExistingButton(allRelevantRecordingRelations, mbVideoUrlEntity.id, ytData);
                    } else {
                        console.log(`[${GM.info.script.name}] URL entity found, but no relevant recording relations. Proceeding to add button.`);
                        ButtonManager.prepareAddButton(ytData, canonicalYtUrl, artistMbid, videoId);
                    }
                } else {
                    console.log(`[${GM.info.script.name}] YouTube URL not found as a URL entity on MusicBrainz. Preparing add button.`);
                    ButtonManager.prepareAddButton(ytData, canonicalYtUrl, artistMbid, videoId);
                }
            } catch (error) {
                console.error(`[${GM.info.script.name}] Unhandled error during update for video ID: ${videoId}:`, error);

                const apiName = error.apiName || 'API';

                if (error.status === 503) {
                    ButtonManager.displayError(L10n.getString('errorApiRateLimit', {
                        apiName
                    }));
                } else if (error.status === 0) {
                    ButtonManager.displayError(L10n.getString('errorApiNetwork', {
                        apiName
                    }));
                } else {
                    ButtonManager.displayError(L10n.getString('errorProcessing'));
                }
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

                console.log(`[${GM.info.script.name}] Initializing for MusicBrainz recording create page.`);
                this._setupListeners();
                this._setupMutationObserver();
                this._initialSync();
            } catch (error) {
                console.log(`[${GM.info.script.name}] Not on MusicBrainz recording create page or elements not found:`, error.message);
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
                    console.log(`[${GM.info.script.name}] Main video checkbox toggled by user. Synced to individual checkboxes.`);
                });
            });

            this._getIndividualVideoCheckboxes().forEach(checkbox => {
                checkbox.addEventListener('change', () => {
                    this._withSyncGuard(() => {
                        this._syncIndividualToMain();
                        console.log(`[${GM.info.script.name}] Individual video checkbox toggled by user. Synced to main checkbox.`);
                    });
                });
            });
            console.log(`[${GM.info.script.name}] Initial listeners set up.`);
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
                                                console.log(`[${GM.info.script.name}] New individual video checkbox toggled. Synced to main checkbox.`);
                                            });
                                        });
                                        checkbox.dataset.mbSyncListenerAdded = 'true';
                                        console.log(`[${GM.info.script.name}] Listener attached to new individual video checkbox.`);

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
            console.log(`[${GM.info.script.name}] MutationObserver set up for external links editor.`);
        },

        /**
         * Performs an initial synchronization of checkbox states when the script loads.
         */
        _initialSync: function () {
            this._withSyncGuard(() => {
                if (this._mainVideoCheckbox.checked) {
                    this._syncMainToIndividual(true);
                    console.log(`[${GM.info.script.name}] Main video checkbox was pre-checked by URL. Synced all individual checkboxes to true.`);
                } else {
                    this._syncIndividualToMain();
                    console.log(`[${GM.info.script.name}] Main video checkbox not pre-checked by URL. Synced main checkbox based on individual links.`);
                }
            });
            console.log(`[${GM.info.script.name}] Initial sync completed.`);
        }
    };


    if (window.location.href.includes('musicbrainz.org/recording/create')) {
        MusicBrainzRecordingCreatePage.init();
    } else if (window.location.hostname.includes('youtube.com')) {
        YouTubeMusicBrainzImporter.init();
    }

})();
