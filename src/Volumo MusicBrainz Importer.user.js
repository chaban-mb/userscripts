// ==UserScript==
// @name        Volumo: MusicBrainz Importer
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.4.4
// @description Allows importing releases from Volumo into MusicBrainz.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://*.volumo.com/*
// @connect     musicbrainz.org
// @require     ../lib/MusicBrainzAPI.js
// @require     https://raw.githubusercontent.com/murdos/musicbrainz-userscripts/master/lib/mbimport.js
// @icon        https://volumo.com/favicon.ico
// @grant       GM.xmlHttpRequest
// @grant       GM.addStyle
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/Volumo%20MusicBrainz%20Importer.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/Volumo%20MusicBrainz%20Importer.user.js
// ==/UserScript==


(function () {
    'use strict';

    class VolumoMusicBrainzImporter {
        static SCRIPT_NAME = GM.info.script.name;
        static SELECTORS = {
            RANDOM_HINT: '[class*="RandomHint_root"]',
        };
        static URLS = {
            MUSICBRAINZ_BASE: 'https://musicbrainz.org',
            HARMONY_BASE: 'https://harmony.pulsewidth.org.uk/release',
        };
        static SOCIAL_DOMAINS = [
            { patterns: ['youtube.com', 'youtu.be'], artist: 193, label: 225 },
            { patterns: ['soundcloud.com'], artist: 291, label: 290 },
            { patterns: ['bandcamp.com'], artist: 718, label: 719 },
            { patterns: ['instagram.com', 'facebook.com', 'tiktok.com', 'twitter.com', 'x.com'], artist: 192, label: 218 },
        ];

        /**
         * @typedef {Object} PageInfo
         * @property {string} type - The page type (album, artist, label).
         * @property {string} id - The extracted Volumo ID.
         */

        /**
         * @typedef {Object} MbInfo
         * @property {string} mbid - The matching MusicBrainz ID.
         * @property {string} [foundVia] - How the MBID was found (e.g., 'url', 'barcode').
         */

        /**
         * @typedef {Object} VolumoArtist
         * @property {number} id
         * @property {string} name
         */

        /**
         * @typedef {Object} VolumoRecordLabel
         * @property {number} id
         * @property {string} name
         */

        /**
         * @typedef {Object} VolumoTrack
         * @property {number} id
         * @property {string} title
         * @property {string} [composed_title]
         * @property {string|null} [version]
         * @property {number} [duration]
         * @property {VolumoArtist[]} [artists]
         * @property {VolumoArtist[]} [featured_artists]
         * @property {VolumoArtist[]} [remixers]
         */

        /**
         * @typedef {Object} AlbumData
         * @property {number} id
         * @property {string} title
         * @property {string|null} [icpn]
         * @property {string|null} [catalog_number]
         * @property {boolean} [exclusive]
         * @property {string} [release_start_at]
         * @property {string|null} [original_release_date]
         * @property {string} [published_at]
         * @property {string} [first_live]
         * @property {VolumoRecordLabel|null} [recordlabel]
         * @property {VolumoArtist[]} [artists]
         * @property {VolumoTrack[]} [tracks]
         */

        /**
         * @typedef {Object} ContributorData
         * @property {number} id
         * @property {string} name
         * @property {string} [country_code]
         * @property {string[]} [social_links]
         */

        #mbApi = null;
        #currentUrl = '';
        #observer = null;
        #runId = 0;
        #container = null;
        #lastRenderArgs = null;
        #areaCache = new Map();

        constructor() {
            this.#mbApi = new MusicBrainzAPI({
                user_agent: `${VolumoMusicBrainzImporter.SCRIPT_NAME}/${GM.info.script.version} ( ${GM_info.script.namespace} )`
            });
            this.#addStyles();


            this.#currentUrl = window.location.href;
            this.#initializeObserver();

            if (document.readyState === 'complete') {
                this.#run();
            } else {
                window.addEventListener('load', () => this.#run(), { once: true });
            }
        }

        #initializeObserver() {
            this.#observer = new MutationObserver(() => {
                const url = window.location.href;
                if (url !== this.#currentUrl) {
                    this.#currentUrl = url;
                    this.#run();
                } else {
                    const page = this.#detectPage(url);
                    const containerExists = document.getElementById('mb-volumo-button-container');

                    if (page && !containerExists) {
                        this.#handleDomRecreation();
                    }
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
            const urlForThisRun = window.location.href;
            console.debug(`[Volumo Importer] Starting run #${runId} for ${urlForThisRun}`);

            this.#cleanup();

            const page = this.#detectPage(urlForThisRun);
            if (!page) {
                return;
            }

            try {
                let targetSelector;
                if (page.type === 'album') {
                    targetSelector = VolumoMusicBrainzImporter.SELECTORS.RANDOM_HINT;
                } else {
                    targetSelector = 'h1[class*="ContributorInfo_title"], h1[class*="DesktopContributorInfo_title"]';
                }

                const targetEl = await this.#waitForElement(targetSelector, 10000);
                if (this.#runId !== runId) return;

                this.#createButtonContainer(targetEl, page.type);

                const normalizedUrl = this.#normalizeUrl(urlForThisRun, page);
                this.#setupLoadingState();

                if (page.type === 'album') {
                    // Fetch metadata
                    const albumData = await this.#fetchAlbumData(page.id);
                    if (this.#runId !== runId) return;

                    if (!albumData) {
                        this.#showErrorState('Failed to extract album data');
                        return;
                    }


                    // Collect all candidate URLs for MusicBrainz relationship lookup
                    const releaseUrl = normalizedUrl;
                    const labelUrl = albumData.recordlabel ? this.#getLabelUrl(albumData.recordlabel) : null;
                    const uniqueArtists = this.#collectArtists(albumData);
                    const artistUrls = uniqueArtists.map(a => this.#getArtistUrl(a)).filter(Boolean);

                    const allUrls = [releaseUrl];
                    if (labelUrl) allUrls.push(labelUrl);
                    allUrls.push(...artistUrls);

                    // Dynamically build the required inc parameters for uncached resources
                    const inc = [];
                    if (!this.#mbApi.cache.has(releaseUrl)) {
                        inc.push('release-rels');
                    }
                    if (labelUrl && !this.#mbApi.cache.has(labelUrl)) {
                        inc.push('label-rels');
                    }
                    const hasUncachedArtist = artistUrls.some(url => !this.#mbApi.cache.has(url));
                    if (hasUncachedArtist) {
                        inc.push('artist-rels');
                    }

                    // Single batched lookup call!
                    const lookupResults = await this.#mbApi.lookupUrl(allUrls, inc);
                    if (this.#runId !== runId) return;

                    // Extract release MBID
                    let mbInfo = null;
                    const releaseData = lookupResults.get(releaseUrl);
                    if (releaseData && Array.isArray(releaseData.relations)) {
                        const relation = releaseData.relations.find(rel =>
                            rel['target-type'] === 'release' && rel.release
                        );
                        if (relation) {
                            mbInfo = { mbid: relation.release.id, foundVia: 'url' };
                        }
                    }

                    // Fallback to searching by barcode/icpn if not found via URL
                    if (!mbInfo && albumData.icpn) {
                        try {
                            const searchResults = await this.#mbApi.search('release', `barcode:${albumData.icpn}`, 1);
                            if (this.#runId !== runId) return;
                            if (searchResults && searchResults.releases && searchResults.releases.length > 0) {
                                mbInfo = { mbid: searchResults.releases[0].id, foundVia: 'barcode' };
                            }
                        } catch (e) {
                            console.warn('[Volumo Importer] Failed to search release by barcode', e);
                        }
                    }

                    // Extract label MBID
                    let labelMbid = null;
                    if (labelUrl) {
                        const labelData = lookupResults.get(labelUrl);
                        if (labelData && Array.isArray(labelData.relations)) {
                            const relation = labelData.relations.find(rel =>
                                rel['target-type'] === 'label' && rel.label
                            );
                            if (relation) {
                                labelMbid = relation.label.id;
                            }
                        }
                    }

                    // Extract artist MBIDs
                    const artistMbidMap = new Map();
                    artistUrls.forEach(url => {
                        const artistData = lookupResults.get(url);
                        if (artistData && Array.isArray(artistData.relations)) {
                            const relation = artistData.relations.find(rel =>
                                rel['target-type'] === 'artist' && rel.artist
                            );
                            if (relation?.artist?.id) {
                                artistMbidMap.set(url, relation.artist.id);
                            }
                        }
                    });

                    this.#renderButtons(albumData, normalizedUrl, mbInfo, labelMbid, artistMbidMap);
                } else {
                    // Artist / Label flow
                    const contributorData = await this.#fetchContributorData(page.type, page.id);

                    if (this.#runId !== runId) return;

                    if (!contributorData) {
                        this.#showErrorState('Failed to extract contributor data');
                        return;
                    }

                    // Look up Area GID if country_code is present
                    let areaGid = null;
                    if (contributorData.country_code) {
                        const cachedGid = this.#areaCache.get(contributorData.country_code);
                        if (cachedGid !== undefined) {
                            areaGid = cachedGid;
                        } else {
                            try {
                                const areaResults = await this.#mbApi.search('area', `iso:${contributorData.country_code}`, 1);
                                if (areaResults && areaResults.areas && areaResults.areas.length > 0) {
                                    areaGid = areaResults.areas[0].id;
                                }
                                this.#areaCache.set(contributorData.country_code, areaGid);
                            } catch (e) {
                                console.warn('[Volumo Importer] Failed to lookup area GID by ISO code', e);
                            }
                        }
                    }
                    if (this.#runId !== runId) return;

                    const lookupUrl = normalizedUrl;
                    const inc = [];
                    if (!this.#mbApi.cache.has(lookupUrl)) {
                        inc.push(page.type === 'artist' ? 'artist-rels' : 'label-rels');
                    }

                    const lookupResults = await this.#mbApi.lookupUrl([lookupUrl], inc);
                    if (this.#runId !== runId) return;

                    let mbInfo = null;
                    const entityData = lookupResults.get(lookupUrl);
                    if (entityData && Array.isArray(entityData.relations)) {
                        const relation = entityData.relations.find(rel =>
                            rel['target-type'] === page.type && rel[page.type]
                        );
                        if (relation) {
                            mbInfo = { mbid: relation[page.type].id };
                        }
                    }

                    this.#renderContributorButtons(contributorData, normalizedUrl, mbInfo, page.type, areaGid);
                }


            } catch (error) {
                if (this.#runId !== runId) return;
                console.error('[Volumo Importer] Execution failed', error);
                this.#showErrorState(error.message);
            }
        }

        #detectPage(url) {
            try {
                const parsed = new URL(url);
                const albumMatch = parsed.pathname.match(/\/(?:[a-z]{2}\/)?album\/(\d+)(?:-|$)/);
                if (albumMatch) {
                    return { type: 'album', id: albumMatch[1] };
                }
                const artistMatch = parsed.pathname.match(/\/(?:[a-z]{2}\/)?artist\/(\d+)(?:-|$)/);
                if (artistMatch) {
                    return { type: 'artist', id: artistMatch[1] };
                }
                const labelMatch = parsed.pathname.match(/\/(?:[a-z]{2}\/)?label\/(\d+)(?:-|$)/);
                if (labelMatch) {
                    return { type: 'label', id: labelMatch[1] };
                }
            } catch (e) { }
            return null;
        }

        #normalizeUrl(url, page) {
            if (!page) page = this.#detectPage(url);
            if (!page) return url;
            return `https://volumo.com/${page.type}/${page.id}`;
        }


        #getNextDataQueries() {
            const nextDataScript = document.getElementById('__NEXT_DATA__');
            if (nextDataScript?.textContent) {
                try {
                    const nextData = JSON.parse(nextDataScript.textContent);
                    return nextData.props?.pageProps?.dehydratedState?.queries || [];
                } catch (e) {
                    console.warn('[Volumo Importer] Failed to parse __NEXT_DATA__', e);
                }
            }
            return [];
        }

        /**
         * @summary Fetches album metadata either from Next.js injected state or via API fallback.
         * @param {string|number} idOrBarcode - The Volumo album ID or ICPN barcode.
         * @returns {Promise<AlbumData|null>} The structured album data.
         */
        async #fetchAlbumData(idOrBarcode) {
            const queries = this.#getNextDataQueries();
            const albumQuery = queries.find(q => {
                const key = q.queryKey?.[0];
                if (key && key.scope === 'Album') {
                    return String(key.albumIdOrIcpn) === String(idOrBarcode) ||
                        String(q.state?.data?.id || '') === String(idOrBarcode) ||
                        String(q.state?.data?.icpn || '') === String(idOrBarcode);
                }
                return false;
            });
            if (albumQuery?.state?.data) {
                console.debug('[Volumo Importer] Successfully extracted metadata from __NEXT_DATA__');
                return albumQuery.state.data;
            }

            // 2. Fallback to API fetch
            const isBarcode = /^\d{12,}$/.test(idOrBarcode);
            const url = isBarcode
                ? `/api/v1/album_by_icpn/${idOrBarcode}`
                : `/api/v1/albums/${idOrBarcode}`;

            console.debug(`[Volumo Importer] Fetching metadata from API: ${url}`);
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`API returned HTTP ${response.status}`);
                }
                const data = await response.json();
                return Array.isArray(data) ? data[0] : data;
            } catch (error) {
                console.error('[Volumo Importer] API fetch failed', error);
                return null;
            }
        }

        /**
         * @summary Fetches contributor (artist/label) metadata either from Next.js injected state or via API fallback.
         * @param {string} type - 'artist' or 'label'.
         * @param {string|number} id - The Volumo contributor ID.
         * @returns {Promise<ContributorData|null>} The structured contributor data.
         */
        async #fetchContributorData(type, id) {
            const queries = this.#getNextDataQueries();
            const contributorQuery = queries.find(q => {
                const key = q.queryKey?.[0];
                return key && key.scope === 'Contributor' && String(key.contributorId) === String(id);
            });
            if (contributorQuery?.state?.data) {
                console.debug('[Volumo Importer] Successfully extracted contributor metadata from __NEXT_DATA__');
                return contributorQuery.state.data;
            }

            // 2. Fallback to API fetch
            const apiType = type === 'label' ? 'recordlabel' : 'artist';
            const url = `/api/v1/contributors/${apiType}/${id}?public=true`;
            console.debug(`[Volumo Importer] Fetching contributor metadata from API: ${url}`);
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`API returned HTTP ${response.status}`);
                }
                const data = await response.json();
                return data;
            } catch (error) {
                console.error('[Volumo Importer] Contributor API fetch failed', error);
                return null;
            }
        }


        #getLabelUrl(recordlabel) {
            if (!recordlabel || !recordlabel.id) return null;
            return `https://volumo.com/label/${recordlabel.id}`;
        }

        #getArtistUrl(artist) {
            if (!artist || !artist.id) return null;
            return `https://volumo.com/artist/${artist.id}`;
        }

        #collectArtists(albumData) {
            const artistsMap = new Map();
            if (Array.isArray(albumData.artists)) {
                albumData.artists.forEach(a => {
                    if (a && a.id) artistsMap.set(a.id, a);
                });
            }
            if (Array.isArray(albumData.tracks)) {
                albumData.tracks.forEach(track => {
                    if (Array.isArray(track.artists)) {
                        track.artists.forEach(a => {
                            if (a && a.id) artistsMap.set(a.id, a);
                        });
                    }
                    if (Array.isArray(track.featured_artists)) {
                        track.featured_artists.forEach(a => {
                            if (a && a.id) artistsMap.set(a.id, a);
                        });
                    }
                });
            }
            return Array.from(artistsMap.values());
        }

        #cleanup() {
            this.#lastRenderArgs = null;
            // Restore the hint text we hid when injecting buttons
            const hint = document.querySelector('[class*="RandomHint_hint"]');
            if (hint) hint.style.display = '';
            document.getElementById('mb-volumo-button-container')?.remove();
            this.#container = null;
        }

        #createButtonContainer(targetEl, pageType) {
            this.#container = document.createElement('div');
            this.#container.id = 'mb-volumo-button-container';

            if (pageType === 'album') {
                // Hide the rotating hint text and take over the slot
                const hint = targetEl.querySelector('[class*="RandomHint_hint"]');
                if (hint) hint.style.display = 'none';
                targetEl.appendChild(this.#container);
            } else {
                // Find Left Column (parent of title element)
                const leftColumn = targetEl.parentElement;
                if (!leftColumn) return;

                // Try to insert before the counters block
                const countersEl = leftColumn.querySelector('[class*="ContributorInfo_counters"], [class*="DesktopContributorInfo_counters"]');
                if (countersEl) {
                    countersEl.before(this.#container);
                } else {
                    leftColumn.appendChild(this.#container);
                }
            }
        }

        #handleDomRecreation() {
            const args = this.#lastRenderArgs;
            if (!args) {
                this.#run();
                return;
            }

            const page = this.#detectPage(window.location.href);
            if (!page) return;

            let targetSelector;
            if (page.type === 'album') {
                targetSelector = VolumoMusicBrainzImporter.SELECTORS.RANDOM_HINT;
            } else {
                targetSelector = 'h1[class*="ContributorInfo_title"], h1[class*="DesktopContributorInfo_title"]';
            }

            const targetEl = document.querySelector(targetSelector);
            if (!targetEl) return;

            this.#createButtonContainer(targetEl, page.type);

            if (page.type === 'album') {
                const { albumData, normalizedUrl, mbInfo, labelMbid, artistMbidMap } = args;
                this.#renderButtons(albumData, normalizedUrl, mbInfo, labelMbid, artistMbidMap);
            } else {
                const { contributorData, normalizedUrl, mbInfo, entityType, areaGid } = args;
                this.#renderContributorButtons(contributorData, normalizedUrl, mbInfo, entityType, areaGid);
            }
            console.debug(`[Volumo Importer] Re-injected buttons into new DOM element for ${page.type}`);
        }

        /**
         * @summary Renders UI buttons for artist/label pages (Open in MB, Add to MB, Search in MB).
         * @param {ContributorData} contributorData - The Volumo contributor object.
         * @param {string} normalizedUrl - Canonical URL for the contributor.
         * @param {MbInfo|null} mbInfo - Existing MBID context.
         * @param {string} entityType - 'artist' or 'label'.
         * @param {string|null} areaGid - The resolved MB Area GID.
         */
        #renderContributorButtons(contributorData, normalizedUrl, mbInfo, entityType, areaGid) {
            if (!this.#container) return;
            // Persist args so we can re-inject after a React remount
            this.#lastRenderArgs = { contributorData, normalizedUrl, mbInfo, entityType, areaGid };
            this.#container.innerHTML = '';

            const displayName = contributorData.name;

            if (mbInfo) {
                // Open in MusicBrainz
                this.#container.appendChild(
                    this.#createAnchorLink('Open in MusicBrainz', `${VolumoMusicBrainzImporter.URLS.MUSICBRAINZ_BASE}/${entityType}/${mbInfo.mbid}`, 'mb-btn-open')
                );
            } else {
                // Import/Add directly into MusicBrainz (using GET parameters)
                const addLink = this.#createAnchorLink('Add to MusicBrainz', this.#buildContributorCreateUrl(contributorData, normalizedUrl, entityType, areaGid), 'mb-btn-import');
                addLink.addEventListener('click', () => {
                    this.#mbApi.invalidateCacheForUrl(normalizedUrl);
                });
                this.#container.appendChild(addLink);

                // Search in MB button
                this.#container.appendChild(
                    this.#createAnchorLink('Search in MusicBrainz', `${VolumoMusicBrainzImporter.URLS.MUSICBRAINZ_BASE}/search?query=${encodeURIComponent(displayName)}&type=${entityType}`, 'mb-btn-search')
                );
            }
        }

        /**
         * @summary Constructs the URL and pre-filled parameters for creating a new artist/label on MusicBrainz.
         * @param {ContributorData} contributorData - The Volumo contributor object.
         * @param {string} normalizedUrl - Canonical URL for the contributor.
         * @param {string} entityType - 'artist' or 'label'.
         * @param {string|null} areaGid - The resolved MB Area GID.
         * @returns {string} The formatted MusicBrainz submission URL.
         */
        #buildContributorCreateUrl(contributorData, normalizedUrl, entityType, areaGid) {
            const params = new URLSearchParams();

            const displayName = contributorData.name;
            params.set(`edit-${entityType}.name`, displayName);

            if (entityType === 'artist') {
                params.set('edit-artist.sort_name', displayName);
            }

            // Resolve area country
            if (contributorData.country_code) {
                try {
                    const countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(contributorData.country_code);
                    if (countryName) {
                        params.set(`edit-${entityType}.area.name`, countryName);
                        if (areaGid) {
                            params.set(`edit-${entityType}.area.gid`, areaGid);
                        }
                    }
                } catch (e) {
                    console.warn('[Volumo Importer] Failed to resolve country name using Intl.DisplayNames', e);
                }
            }

            // Add URLs
            const urls = [];
            // Index 0 is always the Volumo page itself
            urls.push({
                url: normalizedUrl,
                typeId: entityType === 'artist' ? 176 : 959
            });

            // Subsequent ones are social links
            if (Array.isArray(contributorData.social_links)) {
                contributorData.social_links.forEach(linkUrl => {
                    const typeId = this.#getSocialLinkType(linkUrl, entityType);
                    if (typeId) {
                        urls.push({
                            url: linkUrl,
                            typeId: typeId
                        });
                    }
                });
            }

            urls.forEach((u, index) => {
                params.set(`edit-${entityType}.url.${index}.text`, u.url);
                params.set(`edit-${entityType}.url.${index}.link_type_id`, u.typeId);
            });

            // Add edit note
            const editNote = `Imported from Volumo (${normalizedUrl}) using Volumo MusicBrainz Importer userscript.`;
            params.set(`edit-${entityType}.edit_note`, editNote);

            return `${VolumoMusicBrainzImporter.URLS.MUSICBRAINZ_BASE}/${entityType}/create?${params.toString()}`;
        }

        #getSocialLinkType(url, entityType) {
            try {
                const hostname = new URL(url).hostname.toLowerCase();
                const match = VolumoMusicBrainzImporter.SOCIAL_DOMAINS.find(domain =>
                    domain.patterns.some(pattern => hostname.includes(pattern))
                );
                if (match) {
                    return entityType === 'artist' ? match.artist : match.label;
                }
            } catch (e) { }
            return null;
        }

        #createAnchorLink(text, href, className) {
            const link = document.createElement('a');
            link.href = href;
            link.target = '_blank';
            link.className = `mb-btn ${className}`;
            link.textContent = text;
            return link;
        }


        #setupLoadingState() {
            if (!this.#container) return;
            this.#container.innerHTML = '<span class="mb-loading-spinner"></span>';
        }

        #showErrorState(message) {
            if (!this.#container) return;
            this.#container.innerHTML = `<span class="mb-error-message" title="${message}">Error</span>`;
        }

        #renderButtons(albumData, normalizedUrl, mbInfo, labelMbid, artistMbidMap) {
            if (!this.#container) return;
            // Persist args so we can re-inject after a React remount
            this.#lastRenderArgs = { albumData, normalizedUrl, mbInfo, labelMbid, artistMbidMap };
            this.#container.innerHTML = '';

            if (mbInfo) {
                // Open in MusicBrainz
                this.#container.appendChild(
                    this.#createAnchorLink('Open in MusicBrainz', `${VolumoMusicBrainzImporter.URLS.MUSICBRAINZ_BASE}/release/${mbInfo.mbid}`, 'mb-btn-open')
                );

                // If found via barcode only, the Volumo URL is not yet linked — offer to add it
                if (mbInfo.foundVia === 'barcode') {
                    const addUrlBtn = document.createElement('button');
                    addUrlBtn.className = 'mb-btn mb-btn-import';
                    addUrlBtn.textContent = 'Add Volumo URL to MB';
                    addUrlBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.#submitAddUrlForm(mbInfo.mbid, normalizedUrl);
                    });
                    this.#container.appendChild(addUrlBtn);
                }
            } else {
                // Import directly into MusicBrainz
                const importBtn = document.createElement('button');
                importBtn.className = 'mb-btn mb-btn-import';
                importBtn.textContent = 'Import into MB';
                importBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.#submitImportForm(albumData, normalizedUrl, labelMbid, artistMbidMap);
                });
                this.#container.appendChild(importBtn);
            }

            // Search in MB button (standard murdos pattern)
            const mbRelease = this.#mapToMbRelease(albumData, normalizedUrl, labelMbid, artistMbidMap);
            const searchWrapper = document.createElement('div');
            searchWrapper.innerHTML = MBImport.buildSearchButton(mbRelease);
            this.#container.appendChild(searchWrapper.firstChild);

            // Import with Harmony button
            const hasGtin = !!albumData.icpn;
            const harmonyLink = this.#createAnchorLink('Import with Harmony', '#', 'mb-btn-harmony');
            if (hasGtin) {
                const harmonyParams = new URLSearchParams({
                    gtin: albumData.icpn || '',
                    category: 'preferred',
                });
                if (mbInfo?.mbid) {
                    harmonyParams.set('musicbrainz', mbInfo.mbid);
                }
                harmonyLink.href = `${VolumoMusicBrainzImporter.URLS.HARMONY_BASE}?${harmonyParams.toString()}`;
            } else {
                harmonyLink.style.pointerEvents = 'none';
                harmonyLink.style.opacity = '0.5';
                harmonyLink.style.cursor = 'not-allowed';
            }

            harmonyLink.addEventListener('click', (e) => {
                if (!hasGtin) {
                    e.preventDefault();
                    return;
                }
                this.#invalidateReleaseCache(albumData, normalizedUrl);
            });
            this.#container.appendChild(harmonyLink);
        }

        #makeEditNote(normalizedUrl) {
            return MBImport.makeEditNote(
                normalizedUrl,
                VolumoMusicBrainzImporter.SCRIPT_NAME,
                '',
                'https://github.com/chaban-mb/userscripts'
            );
        }

        #submitPostForm(action, params) {
            const form = document.createElement('form');
            form.method = 'post';
            form.action = action;
            form.target = '_blank';
            form.style.display = 'none';

            for (const [name, value] of Object.entries(params)) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = name;
                input.value = value;
                form.appendChild(input);
            }

            document.body.appendChild(form);
            form.submit();
            setTimeout(() => form.remove(), 1000);
        }

        #submitImportForm(albumData, normalizedUrl, labelMbid, artistMbidMap) {
            const release = this.#mapToMbRelease(albumData, normalizedUrl, labelMbid, artistMbidMap);
            // buildFormParameters returns [{name, value}] — convert to plain object for #submitPostForm
            const params = Object.fromEntries(
                MBImport.buildFormParameters(release, this.#makeEditNote(normalizedUrl))
                    .map(({ name, value }) => [name, value])
            );
            this.#invalidateReleaseCache(albumData, normalizedUrl);
            this.#submitPostForm(`${VolumoMusicBrainzImporter.URLS.MUSICBRAINZ_BASE}/release/add`, params);
        }

        #submitAddUrlForm(mbid, normalizedUrl) {
            this.#mbApi.invalidateCacheForUrl(normalizedUrl);
            this.#submitPostForm(
                `${VolumoMusicBrainzImporter.URLS.MUSICBRAINZ_BASE}/release/${mbid}/edit`,
                {
                    'urls.0.url': normalizedUrl,
                    'urls.0.link_type': MBImport.URL_TYPES.purchase_for_download,
                    'edit_note': this.#makeEditNote(normalizedUrl),
                }
            );
        }

        #invalidateReleaseCache(albumData, normalizedUrl) {
            const invalidateUrls = [normalizedUrl];
            if (albumData.recordlabel) {
                const labelUrl = this.#getLabelUrl(albumData.recordlabel);
                if (labelUrl) invalidateUrls.push(labelUrl);
            }
            const uniqueArtists = this.#collectArtists(albumData);
            const artistUrls = uniqueArtists.map(a => this.#getArtistUrl(a)).filter(Boolean);
            invalidateUrls.push(...artistUrls);

            this.#mbApi.invalidateCacheForUrl(invalidateUrls);
        }

        #mapToMbRelease(albumData, normalizedUrl, labelMbid, artistMbidMap) {
            const rawDate = albumData.exclusive
                ? (albumData.release_start_at || albumData.original_release_date)
                : (albumData.original_release_date || albumData.release_start_at);
            const releaseDate = this.#parseReleaseDate(rawDate || albumData.published_at || albumData.first_live);
            const totalDuration = albumData.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
            const type = MBImport.guessReleaseType(albumData.title, albumData.tracks.length, totalDuration);

            // Collect regular track artists and remixers to filter out pure remixers from the release level
            const allRegularArtistIds = new Set();
            const allRegularArtistNames = new Set();
            const allRemixerIds = new Set();
            const allRemixerNames = new Set();

            albumData.tracks.forEach(track => {
                const trackRemixers = track.remixers || [];
                trackRemixers.forEach(r => {
                    if (r.id) allRemixerIds.add(r.id);
                    if (r.name) allRemixerNames.add(r.name.toLowerCase());
                });

                const trackRemixerIds = new Set(trackRemixers.map(r => r.id).filter(Boolean));
                const trackRemixerNames = new Set(trackRemixers.map(r => r.name?.toLowerCase()).filter(Boolean));

                const trackArtists = track.artists || [];
                trackArtists.forEach(a => {
                    const isRemixer = trackRemixerIds.has(a.id) || trackRemixerNames.has(a.name?.toLowerCase());
                    if (!isRemixer) {
                        if (a.id) allRegularArtistIds.add(a.id);
                        if (a.name) allRegularArtistNames.add(a.name.toLowerCase());
                    }
                });
            });

            const pureRemixerIds = new Set([...allRemixerIds].filter(id => !allRegularArtistIds.has(id)));
            const pureRemixerNames = new Set([...allRemixerNames].filter(name => !allRegularArtistNames.has(name)));

            const releaseArtists = (albumData.artists || []).filter(a =>
                !pureRemixerIds.has(a.id) && !pureRemixerNames.has(a.name?.toLowerCase())
            );

            const labels = [];
            if (albumData.recordlabel) {
                const labelInfo = {
                    name: albumData.recordlabel.name,
                    catno: albumData.catalog_number || 'none',
                };
                if (labelMbid) {
                    labelInfo.mbid = labelMbid;
                }
                labels.push(labelInfo);
            }

            return {
                title: albumData.title,
                artist_credit: releaseArtists.length > 4
                    ? [MBImport.specialArtist('various_artists')]
                    : this.#getArtistCredits(releaseArtists, [], artistMbidMap),
                type,
                status: 'official',
                packaging: 'none',
                country: 'XW',
                barcode: albumData.icpn || '',
                comment: '',
                annotation: '',
                year: releaseDate.year,
                month: releaseDate.month,
                day: releaseDate.day,
                labels,
                urls: [
                    {
                        url: normalizedUrl,
                        link_type: MBImport.URL_TYPES.purchase_for_download
                    }
                ],
                discs: [
                    {
                        title: '',
                        format: 'Digital Media',
                        tracks: albumData.tracks.map((track, index) => {
                            let title = track.composed_title || track.title;
                            if (track.version) {
                                const version = track.version.trim();
                                const isOriginalMix = version.toLowerCase() === 'original mix';
                                if (version && !isOriginalMix && !title.toLowerCase().includes(`(${version.toLowerCase()})`)) {
                                    title = `${title} (${version})`;
                                }
                            }

                            let trackArtists = track.artists || [];
                            if (Array.isArray(track.remixers) && track.remixers.length > 0) {
                                const remixerIds = new Set(track.remixers.map(r => r.id).filter(Boolean));
                                const remixerNames = new Set(track.remixers.map(r => r.name?.toLowerCase()).filter(Boolean));
                                trackArtists = trackArtists.filter(a => !remixerIds.has(a.id) && !remixerNames.has(a.name?.toLowerCase()));
                            }

                            return {
                                number: (index + 1).toString(),
                                title,
                                duration: track.duration,
                                artist_credit: this.#getArtistCredits(trackArtists, track.featured_artists, artistMbidMap)
                            };
                        })
                    }
                ]
            };
        }

        #getArtistCredits(artists, featured, artistMbidMap) {
            if (!artists || artists.length === 0) {
                return [MBImport.specialArtist('unknown')];
            }
            const primaryCredits = this.#makeArtistCreditsWithMbids(artists, artistMbidMap);

            if (featured && featured.length > 0) {
                const featuredCredits = this.#makeArtistCreditsWithMbids(featured, artistMbidMap);
                if (primaryCredits.length > 0) {
                    primaryCredits[primaryCredits.length - 1].joinphrase = ' feat. ';
                }
                return [...primaryCredits, ...featuredCredits];
            }
            return primaryCredits;
        }

        #makeArtistCreditsWithMbids(artists, artistMbidMap) {
            const names = artists.map(a => a.name);
            const credits = MBImport.makeArtistCredits(names);

            if (artistMbidMap) {
                credits.forEach(credit => {
                    const artist = artists.find(a => a.name.toLowerCase() === credit.artist_name.toLowerCase());
                    if (artist) {
                        const artistUrl = this.#getArtistUrl(artist);
                        const mbid = artistMbidMap.get(artistUrl);
                        if (mbid) {
                            credit.mbid = mbid;
                        }
                    }
                });
            }
            return credits;
        }

        #parseReleaseDate(dateStr) {
            if (!dateStr) return { year: 0, month: 0, day: 0 };
            const dateParts = dateStr.substring(0, 10).split('-');
            if (dateParts.length === 3) {
                return {
                    year: parseInt(dateParts[0], 10) || 0,
                    month: parseInt(dateParts[1], 10) || 0,
                    day: parseInt(dateParts[2], 10) || 0
                };
            }
            return { year: 0, month: 0, day: 0 };
        }

        #addStyles() {
            GM.addStyle(`
                #mb-volumo-button-container {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .mb-btn, .musicbrainz_import_search button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    border-radius: 8px;
                    padding: 8px 16px;
                    font-family: inherit;
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff !important;
                    cursor: pointer;
                    text-decoration: none !important;
                    transition: filter 0.2s ease, transform 0.1s ease;
                }
                .mb-btn:hover, .musicbrainz_import_search button:hover {
                    filter: brightness(1.1);
                    transform: scale(1.02);
                }
                .mb-btn:active, .musicbrainz_import_search button:active {
                    transform: scale(0.98);
                }
                .mb-btn-open, .mb-btn-import {
                    background-color: #BA478F;
                }
                .mb-btn-harmony {
                    background-color: #c45555;
                }
                .mb-btn-search, .musicbrainz_import_search button {
                    background-color: #5c6bc0;
                }

                .musicbrainz_import_search {
                    margin: 0;
                    padding: 0;
                    display: inline-flex;
                }
                .mb-loading-spinner {
                    width: 20px;
                    height: 20px;
                    border: 2px solid rgba(255, 255, 255, 0.2);
                    border-top-color: #BA478F;
                    border-radius: 50%;
                    animation: mb-spin 0.8s linear infinite;
                }
                .mb-error-message {
                    color: #ff4a4a;
                    font-weight: 600;
                    font-size: 14px;
                }
                @keyframes mb-spin {
                    to { transform: rotate(360deg); }
                }
            `);
        }

        #waitForElement(selector, timeout = 10000) {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) return resolve(element);

                const observer = new MutationObserver(() => {
                    const el = document.querySelector(selector);
                    if (el) {
                        observer.disconnect();
                        clearTimeout(timer);
                        resolve(el);
                    }
                });

                const timer = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Timeout waiting for selector: ${selector}`));
                }, timeout);

                observer.observe(document.body, { childList: true, subtree: true });
            });
        }
    }

    // Initialize userscript
    new VolumoMusicBrainzImporter();
})();
