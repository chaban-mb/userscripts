// ==UserScript==
// @name         Volumo: MusicBrainz Importer
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.1.2
// @description  Allows importing releases from Volumo into MusicBrainz.
// @tag          ai-created
// @author       chaban
// @license      MIT
// @icon         https://volumo.com/favicon.ico
// @match        *://*.volumo.com/*
// @connect      musicbrainz.org
// @grant        GM.xmlHttpRequest
// @grant        GM.addStyle
// @require      ../lib/MusicBrainzAPI.js
// @require      https://raw.githubusercontent.com/murdos/musicbrainz-userscripts/master/lib/mbimport.js
// @require      https://raw.githubusercontent.com/murdos/musicbrainz-userscripts/master/lib/mbimportstyle.js
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/Volumo%20MusicBrainz%20Importer.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/Volumo%20MusicBrainz%20Importer.user.js
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

        #mbApi = null;
        #currentUrl = '';
        #observer = null;
        #runId = 0;
        #container = null;
        #lastRenderArgs = null;

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
                    const barcode = this.#extractBarcodeFromUrl(url);
                    const containerExists = document.getElementById('mb-volumo-button-container');
                    
                    if (barcode && !containerExists) {
                        this.#handleDomRecreation();
                    }
                }
            });
            this.#observer.observe(document.body, { childList: true, subtree: true });
        }

        async #run() {
            const runId = ++this.#runId;
            const urlForThisRun = window.location.href;
            console.debug(`[Volumo Importer] Starting run #${runId} for ${urlForThisRun}`);

            this.#cleanup();

            const barcode = this.#extractBarcodeFromUrl(urlForThisRun);
            if (!barcode) {
                return;
            }

            try {
                const hintRoot = await this.#waitForElement(VolumoMusicBrainzImporter.SELECTORS.RANDOM_HINT, 10000);
                if (this.#runId !== runId) return;

                this.#createButtonContainer(hintRoot);

                const normalizedUrl = this.#normalizeUrl(urlForThisRun);
                this.#setupLoadingState();

                // Fetch metadata
                const albumData = await this.#fetchAlbumData(barcode);
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
                        mbInfo = { mbid: relation.release.id };
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

            } catch (error) {
                if (this.#runId !== runId) return;
                console.error('[Volumo Importer] Execution failed', error);
                this.#showErrorState(error.message);
            }
        }

        #extractBarcodeFromUrl(url) {
            try {
                const parsed = new URL(url);
                const match = parsed.pathname.match(/\/(?:[a-z]{2}\/)?album\/(\d+)(?:-|$)/);
                return match ? match[1] : null;
            } catch (e) {
                return null;
            }
        }

        #normalizeUrl(url) {
            const barcode = this.#extractBarcodeFromUrl(url);
            return barcode ? `https://volumo.com/album/${barcode}` : url;
        }

        async #fetchAlbumData(barcode) {
            // 1. Try __NEXT_DATA__
            const nextDataScript = document.getElementById('__NEXT_DATA__');
            if (nextDataScript?.textContent) {
                try {
                    const nextData = JSON.parse(nextDataScript.textContent);
                    const queries = nextData.props?.pageProps?.dehydratedState?.queries || [];
                    const albumQuery = queries.find(q =>
                        q.queryKey && q.queryKey[0] && q.queryKey[0].scope === 'Album' &&
                        (q.queryKey[0].albumIdOrIcpn === barcode || q.state?.data?.icpn === barcode)
                    );
                    if (albumQuery?.state?.data) {
                        console.debug('[Volumo Importer] Successfully extracted metadata from __NEXT_DATA__');
                        return albumQuery.state.data;
                    }
                } catch (e) {
                    console.warn('[Volumo Importer] Failed to parse __NEXT_DATA__', e);
                }
            }

            // 2. Fallback to API fetch
            console.debug(`[Volumo Importer] Fetching metadata from API for barcode ${barcode}`);
            try {
                const response = await fetch(`/api/v1/album_by_icpn/${barcode}`);
                if (!response.ok) {
                    throw new Error(`API returned HTTP ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                console.error('[Volumo Importer] API fetch failed', error);
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

        #createButtonContainer(hintRoot) {
            // Hide the rotating hint text and take over the slot
            const hint = hintRoot.querySelector('[class*="RandomHint_hint"]');
            if (hint) hint.style.display = 'none';

            this.#container = document.createElement('div');
            this.#container.id = 'mb-volumo-button-container';
            hintRoot.appendChild(this.#container);
        }

        #handleDomRecreation() {
            const args = this.#lastRenderArgs;
            if (!args) {
                this.#run();
                return;
            }

            const hintRoot = document.querySelector(VolumoMusicBrainzImporter.SELECTORS.RANDOM_HINT);
            if (!hintRoot) return;

            this.#createButtonContainer(hintRoot);

            const { albumData, normalizedUrl, mbInfo, labelMbid, artistMbidMap } = args;
            this.#renderButtons(albumData, normalizedUrl, mbInfo, labelMbid, artistMbidMap);
            console.debug('[Volumo Importer] Re-injected buttons into new DOM element');
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
                const mbLink = document.createElement('a');
                mbLink.href = `${VolumoMusicBrainzImporter.URLS.MUSICBRAINZ_BASE}/release/${mbInfo.mbid}`;
                mbLink.target = '_blank';
                mbLink.className = 'mb-btn mb-btn-open';
                mbLink.textContent = 'Open in MusicBrainz';
                this.#container.appendChild(mbLink);
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
            const harmonyLink = document.createElement('a');
            const harmonyParams = new URLSearchParams({
                gtin: albumData.icpn || '',
                url: normalizedUrl,
                category: 'preferred',
            });
            if (mbInfo?.mbid) {
                harmonyParams.set('musicbrainz', mbInfo.mbid);
            }
            harmonyLink.href = `${VolumoMusicBrainzImporter.URLS.HARMONY_BASE}?${harmonyParams.toString()}`;
            harmonyLink.target = '_blank';
            harmonyLink.className = 'mb-btn mb-btn-harmony';
            harmonyLink.textContent = 'Import with Harmony';
            harmonyLink.addEventListener('click', () => {
                this.#mbApi.invalidateCacheForUrl(normalizedUrl);
            });
            this.#container.appendChild(harmonyLink);
        }

        #submitImportForm(albumData, normalizedUrl, labelMbid, artistMbidMap) {
            const release = this.#mapToMbRelease(albumData, normalizedUrl, labelMbid, artistMbidMap);
            const editNote = MBImport.makeEditNote(
                normalizedUrl,
                VolumoMusicBrainzImporter.SCRIPT_NAME,
                '',
                'https://github.com/chaban-mb/userscripts'
            );
            const parameters = MBImport.buildFormParameters(release, editNote);
            const formHtml = MBImport.buildFormHTML(parameters);

            const tempDiv = document.createElement('div');
            tempDiv.style.display = 'none';
            tempDiv.innerHTML = formHtml;
            document.body.appendChild(tempDiv);

            const form = tempDiv.querySelector('form');
            if (form) {
                form.submit();
            }

            setTimeout(() => tempDiv.remove(), 1000);
        }

        #mapToMbRelease(albumData, normalizedUrl, labelMbid, artistMbidMap) {
            const releaseDate = this.#parseReleaseDate(albumData.release_start_at || albumData.original_release_date);
            const totalDuration = albumData.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
            const type = MBImport.guessReleaseType(albumData.title, albumData.tracks.length, totalDuration);

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
                artist_credit: this.#getArtistCredits(albumData.artists, [], artistMbidMap),
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
                        tracks: albumData.tracks.map((track, index) => ({
                            number: (index + 1).toString(),
                            title: track.composed_title || track.title,
                            duration: track.duration,
                            artist_credit: this.#getArtistCredits(track.artists, track.featured_artists, artistMbidMap)
                        }))
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
                .mb-btn {
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
                .mb-btn:hover {
                    filter: brightness(1.1);
                    transform: scale(1.02);
                }
                .mb-btn:active {
                    transform: scale(0.98);
                }
                .mb-btn-open {
                    background-color: #BA478F;
                }
                .mb-btn-import {
                    background-color: #BA478F;
                }
                .mb-btn-harmony {
                    background-color: #c45555;
                }
                .musicbrainz_import_search {
                    margin: 0;
                    padding: 0;
                    display: inline-flex;
                }
                .musicbrainz_import_search button {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    border-radius: 8px;
                    padding: 8px 16px;
                    font-family: inherit;
                    font-size: 14px;
                    font-weight: 600;
                    color: #fff;
                    cursor: pointer;
                    background-color: #5c6bc0;
                    transition: filter 0.2s ease, transform 0.1s ease;
                }
                .musicbrainz_import_search button:hover {
                    filter: brightness(1.1);
                    transform: scale(1.02);
                }
                .musicbrainz_import_search button:active {
                    transform: scale(0.98);
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
