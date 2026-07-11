// ==UserScript==
// @name         MusicBrainz: Guess Case Improver
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.8.5
// @tag          ai-created
// @description  Improves the native "Guess Case" for release, recording and track titles with advanced artist and ETI parsing. Also removes artist from title and duplicate artists after using "Guess feat. artists" on tracklists.
// @author       chaban
// @license      MIT
// @match        https://*.musicbrainz.org/recording/create*
// @match        https://*.musicbrainz.org/recording/*/edit
// @match        https://*.musicbrainz.org/release/*/edit*
// @match        https://*.musicbrainz.org/release/add*
// @match        https://*.musicbrainz.org/artist/*/credit/*/edit
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        none
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Guess%20Case%20Improver.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Guess%20Case%20Improver.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const DEBUG_MODE = false;

    const log = (...args) => {
        if (DEBUG_MODE) {
            console.log(`[${SCRIPT_NAME}]`, ...args);
        }
    };
    const warn = (...args) => {
        console.warn(`[${SCRIPT_NAME}]`, ...args);
    };
    const err = (...args) => {
        console.error(`[${SCRIPT_NAME}]`, ...args);
    };

    log('Script loaded and running.');

    // We use a WeakMap to store the "pristine" (original) value of an input,
    // side-stepping any event race conditions with native preview handlers.
    const pristineValues = new WeakMap();
    const pristineArtistNames = new WeakMap();

    // ====================================================================================
    // --- ✨ USER CONFIGURATION ✨ ---
    // ====================================================================================

    const etiPhrasesToLowercase = [
        'official lyric video', 'official music video', 'backing track',
        'kinetic lyric video', 'animated', 'animation', 'official video',
        'official visualizer', 'slowed', 'super slowed', 'speed up', 'sped up',
        'super speed up', 'extra slowed', 'ultra slowed', 'slowed & reverb', 'slowed + reverb',
        'music video', 'super sped up', 'low pitched', 'slowed down'
    ];


    // ====================================================================================
    // --- 🔮 REGULAR EXPRESSION PATTERNS 🔮 ---
    // ====================================================================================

    const JOIN_PHRASE_PATTERN = /\s*\b(?:featuring|feat|ft|vs)\b\.?\s*|\s*(?:[,，、&・×/])\s*|\s+(?:and|x)\s+/gi;
    const SEPARATOR_PATTERN = /\s+[-–—/]\s+|\s+[-–—/]\s*|\s*[-–—/]\s+(?=.)|(?<=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])[-–—/]|[-–—/](?=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])/g;
    const BRACKET_EXCEPTION_PATTERN = /\[(untitled|unknown|data track|silence)\]/gi;
    const FEAT_PATTERN = /\s*\(?(feat\.?|ft\.?|featuring|with)\s*([^)]+)\)?/i;
    const ETI_PATTERN = /\s*(\[[^\]]+\]|\([^)]+\)|【[^】]+】)$/;
    const PARENS_CONTENT_PATTERN = /\(([^)]+)\)/g;

    log('User configuration loaded.');



    // ====================================================================================
    // --- Editor Control Class ---
    // ====================================================================================


    /**
     * @class ArtistCreditsEditor
     * @summary Utility wrapper to programmatically open, close, and inspect the MusicBrainz Artist Credits dialog.
     */
    class ArtistCreditsEditor {
        #bubble;

        /**
         * Opens the artist credit dialog by simulating a click on the edit button.
         * @param {HTMLElement} openButton - The button element that opens the dialog.
         * @returns {Promise<boolean>} A promise resolving to true if the dialog opened successfully, or false if it timed out.
         */
        async open(openButton) {
            openButton.click();
            return new Promise(resolve => {
                const observer = new MutationObserver(() => {
                    const bubble = document.getElementById('artist-credit-bubble');
                    if (bubble) {
                        this.#bubble = bubble;
                        observer.disconnect();
                        resolve(true);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => { observer.disconnect(); resolve(false); }, 1000); // Failsafe timeout
            });
        }

        /**
         * Closes the artist credit dialog by simulating a click on the positive action button.
         */
        close() {
            if (!this.#bubble) return;
            this.#bubble.querySelector('.buttons .positive')?.click();
            this.#bubble = null;
        }

        /**
         * Retrieves all artist row elements in the currently open editor dialog.
         * @returns {HTMLElement[]} An array of table row elements matching the artist rows.
         */
        getArtistRows() {
            if (!this.#bubble) return [];
            return Array.from(this.#bubble.querySelectorAll('tbody > tr:has(div.autocomplete2)'));
        }
    }


    // ====================================================================================
    // --- Core Logic & Helper Functions
    // ====================================================================================

    /**
     * Retrieves the current artist names from the most reliable source available.
     * It checks track-specific inputs, the main page's artist credit editor, and falls back to the page stash.
     * @param {HTMLButtonElement} button The button that triggered the action, used for context.
     * @returns {string[]} An array of artist names, trimmed and in lowercase.
     */
    function getCurrentArtistNames(button) {
        // Priority 1: Track-specific viewmodel check (Knockout model of the track row)
        const trackRow = button?.closest?.('tr.track');
        let koTrackFound = false;
        if (window.ko && trackRow) {
            try {
                const trackViewModel = window.ko.dataFor(trackRow);
                if (trackViewModel?.artistCredit) {
                    koTrackFound = true;
                    const ac = trackViewModel.artistCredit();
                    if (ac?.names?.length > 0) {
                        const names = ac.names.map(n => n.name).filter(Boolean);
                        if (names.length > 0) {
                            log('Found artist(s) from track viewmodel:', names.join('; '));
                            return names.flatMap(name => parseArtistNamesFromString(name));
                        }
                    }
                }
            } catch (e) {
                warn('Error reading track viewmodel:', e);
            }
        }

        // Priority 2: Track-specific DOM check (fallback)
        if (trackRow) {
            const trackArtistInput = trackRow.querySelector('.artist .autocomplete2 input');
            if (trackArtistInput?.value) {
                log('Found artist from track row input:', trackArtistInput.value);
                return parseArtistNamesFromString(trackArtistInput.value);
            }
        }

        // Priority 3: Global Release-level viewmodel check (Knockout release model)
        let koReleaseFound = false;
        if (window.MB?._releaseEditor?.rootField?.release) {
            try {
                const release = window.MB._releaseEditor.rootField.release();
                if (release?.artistCredit) {
                    koReleaseFound = true;
                    const ac = release.artistCredit();
                    if (ac?.names?.length > 0) {
                        const names = ac.names.map(n => n.name).filter(Boolean);
                        if (names.length > 0) {
                            log('Found artist(s) from release viewmodel:', names.join('; '));
                            return names.flatMap(name => parseArtistNamesFromString(name));
                        }
                    }
                }
            } catch (e) {
                warn('Error reading release viewmodel:', e);
            }
        }

        // Priority 4: Main artist credit editor (Standalone Recording, Release Editor global AC)
        const artistCreditEditor = document.getElementById('artist-credit-editor');
        let acEditorFound = false;
        if (artistCreditEditor) {
            acEditorFound = true;
            // The hidden inputs hold the definitive state of the AC.
            // We target both the canonical artist name (.artist.name) and the "credited as" name (.name).
            // The credited name is crucial for matching what's usually in the title.
            const nameInputs = artistCreditEditor.querySelectorAll('input[name*=".artist_credit.names."][name$=".name"]');
            const names = Array.from(nameInputs)
                .flatMap(input => parseArtistNamesFromString(input.value))
                .filter(Boolean);

            const uniqueNames = [...new Set(names)];
            if (uniqueNames.length > 0) {
                log('Found artist(s) from AC editor hidden inputs:', uniqueNames.join('; '));
                return uniqueNames;
            }

            // Fallback for single-artist AC on standalone recording page before full editor is opened
            const singleArtistInput = document.getElementById('ac-source-single-artist');
            if (singleArtistInput?.value) {
                log('Found artist from single artist input field:', singleArtistInput.value);
                return parseArtistNamesFromString(singleArtistInput.value);
            }
        }

        // Priority 5: Fallback to seeded data in the stash
        let stashFound = false;
        try {
            const namesData = window?.__MB__?.$c?.stash?.artist_credit?.names ??
                window?.__MB__?.$c?.stash?.source_entity?.artistCredit?.names;

            if (namesData?.length > 0) {
                stashFound = true;
                const names = namesData.flatMap(part => [
                    ...(parseArtistNamesFromString(part.name)),
                    ...(parseArtistNamesFromString(part.artist?.name))
                ]).filter(Boolean);

                const uniqueNames = [...new Set(names)];
                if (uniqueNames.length > 0) {
                    log('Found artist(s) from __MB__ stash:', uniqueNames.join('; '));
                    return uniqueNames;
                }
            }
        } catch (e) {
            err('Error accessing __MB__ stash:', e);
        }

        log('getCurrentArtistNames trace:');
        log(`- Priority 1 (Track VM): ${koTrackFound ? 'Found VM, but names empty' : 'VM not found/applicable'}`);
        log(`- Priority 2 (Track DOM): ${trackRow ? 'Found row, but input empty or missing' : 'Not in a track row'}`);
        log(`- Priority 3 (Release VM): ${koReleaseFound ? 'Found VM, but names empty' : 'VM not found/applicable'}`);
        log(`- Priority 4 (AC Editor / Single Input): ${acEditorFound ? 'Found editor, but inputs empty' : 'Editor not found'}`);
        log(`- Priority 5 (MB Stash): ${stashFound ? 'Found stash, but empty or missing names' : 'Stash not found'}`);
        log('-> Falling back to regex-only title parsing.');

        warn('Could not determine current artists from any source. Falling back to regex-only title parsing.');
        return [];
    }


    function parseArtistNamesFromString(artistString) {
        if (!artistString) return [];
        return artistString.split(JOIN_PHRASE_PATTERN)
            .map(name => name.trim().replace(/^\.+|\.+$/g, '').toLowerCase())
            .filter(Boolean);
    }

    /**
     * @summary Parses a string containing artist names and their join phrases into structured objects.
     * @param {string} artistPartString - The string part containing one or more artists.
     * @returns {{name: string, joinPhrase: string}[]} Array of parsed artist and join phrase objects.
     */
    function parseArtistsAndJoins(artistPartString) {
        const pattern = /\s*(?:\b(?:featuring|feat|ft|vs)\b\.?|[,，、&・×/])\s*|\s+\b(?:and|x)\b\s+/gi;
        const names = artistPartString.split(pattern);
        const joins = [];
        let match;
        const regex = new RegExp(pattern);
        while ((match = regex.exec(artistPartString)) !== null) {
            joins.push(match[0]);
        }
        return names.map((name, index) => ({
            name: name.trim(),
            joinPhrase: index < joins.length ? joins[index] : ''
        })).filter(item => item.name !== '');
    }

    /**
     * @summary Merges parsed guest/featured artists from a title into the current artist credit viewmodel/hidden inputs.
     * @param {object[]} currentNames - Current artist credit objects in the editor viewmodel.
     * @param {{name: string, joinPhrase: string}[]} parsedTitleArtists - List of artists parsed from the title.
     * @param {string[]} seededArtists - List of original seeded/pristine artist names.
     * @returns {object[]} The updated/merged artist credit list.
     */
    function mergeArtistCredits(currentNames, parsedTitleArtists, seededArtists) {
        // Flatten all seeded names into individual lowercase names for matching
        const seededIndividualNamesLower = [];
        const artistsToCheck = seededArtists || [];
        artistsToCheck.forEach(name => {
            const parsed = parseArtistNamesFromString(name);
            seededIndividualNamesLower.push(...parsed);
        });

        // Check if any parsed title artist is in the editor's individual seeded names
        const hasPartialMatch = parsedTitleArtists.some(ta =>
            seededIndividualNamesLower.includes(ta.name.trim().toLowerCase())
        );

        if (hasPartialMatch) {
            // Precedence Rule: Overwrite/replace seeded credits with parsed title credits.
            const updatedNames = parsedTitleArtists.map((ta) => {
                const taLower = ta.name.trim().toLowerCase();
                const match = currentNames.find(n => {
                    const nLower = n.name.trim().toLowerCase();
                    return nLower === taLower || parseArtistNamesFromString(n.name).includes(taLower);
                });
                return {
                    artist: match ? match.artist : null,
                    name: ta.name,
                    credit: ta.name,
                    joinPhrase: ta.joinPhrase
                };
            });

            if (updatedNames.length > 0) {
                updatedNames[updatedNames.length - 1].joinPhrase = '';
            }
            return updatedNames;
        } else {
            // Append non-duplicate parsed artists while preserving the order defined by parsedTitleArtists
            const currentNamesLower = currentNames.map(n => n.name.trim().toLowerCase());
            const newTitleArtists = parsedTitleArtists.filter(ta => !currentNamesLower.includes(ta.name.trim().toLowerCase()));

            if (newTitleArtists.length === 0) {
                return currentNames;
            }

            // Partition currentNames: seeded (not in title) vs title artists (already in currentNames)
            const titleNamesLower = parsedTitleArtists.map(ta => ta.name.trim().toLowerCase());
            const seededNames = currentNames.filter(n => !titleNamesLower.includes(n.name.trim().toLowerCase()));

            // Re-assemble title artists in their correct order from parsedTitleArtists
            const orderedTitleArtists = parsedTitleArtists.map(ta => {
                const taLower = ta.name.trim().toLowerCase();
                const match = currentNames.find(n => {
                    const nLower = n.name.trim().toLowerCase();
                    return nLower === taLower || parseArtistNamesFromString(n.name).includes(taLower);
                });
                return {
                    artist: match ? match.artist : null,
                    name: ta.name,
                    credit: ta.name,
                    joinPhrase: ta.joinPhrase
                };
            });

            // Seeded artists should be joined to the title artists.
            // We set the join phrase of the last seeded artist to ' & '.
            const updatedSeeded = [...seededNames];
            if (updatedSeeded.length > 0) {
                updatedSeeded[updatedSeeded.length - 1] = {
                    ...updatedSeeded[updatedSeeded.length - 1],
                    joinPhrase: ' & '
                };
            }

            const updatedNames = [...updatedSeeded, ...orderedTitleArtists];

            if (updatedNames.length > 0) {
                updatedNames[updatedNames.length - 1] = {
                    ...updatedNames[updatedNames.length - 1],
                    joinPhrase: ''
                };
            }

            return updatedNames;
        }
    }


    /**
     * @summary Resolves the Knockout artist credit observable for the given context.
     * @param {HTMLElement|null} input - The input element (usually track name input).
     * @param {HTMLElement|null} button - The guess button element.
     * @returns {Function|null} The Knockout observable function for artistCredit, or null if not found.
     */
    function getACObservable(input, button) {
        const trackRow = (input || button).closest('tr.track');
        if (trackRow) {
            const track = getTrackModel(trackRow);
            if (track?.artistCredit) return track.artistCredit;
        }

        const release = window.MB?.releaseEditor?.rootField?.release?.();
        if (release?.artistCredit) return release.artistCredit;

        const source = window.MB?.getSourceEntityInstance?.();
        if (source?.artistCredit) return source.artistCredit;

        return null;
    }

    function syncAutocompleteInputs(artistNodes) {
        setTimeout(() => {
            artistNodes.forEach((node, index) => {
                const acInputEl = document.getElementById(`ac-source-artist-${index}`);
                if (acInputEl && acInputEl.value !== node.name) {
                    setInputValue(acInputEl, node.name);
                }
            });
        }, 60);
    }



    function createSafeRegex(str) {
        const escapedStr = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escapedStr, 'i');
    }

    function getBooleanCookie(name) {
        const value = document.cookie.split('; ').find(row => row.startsWith(name + '='))?.split('=')[1];
        return value === 'true';
    }

    /**
     * @summary Safely sets the value of an input element, firing necessary events for React/Knockout framework integration.
     * @param {HTMLInputElement|HTMLTextAreaElement} element - The target form element to update.
     * @param {string} value - The text value to set.
     */
    function setInputValue(element, value) {
        if (!element || typeof value === 'undefined') return;
        let ok = false;
        try {
            element.focus();
            element.setSelectionRange(0, element.value.length);
            ok = value ? document.execCommand('insertText', false, value)
                : document.execCommand('delete', false, null);
            if (ok && element.value !== value) ok = false;
        } catch (e) { ok = false; }
        if (!ok) {
            const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
                || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            descriptor.set.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }


    function findAssociatedInput(button) {
        const trackRow = button.closest('tr.track');
        if (trackRow) return trackRow.querySelector('input.track-name');
        const parentContainer = button.closest('.row, td');
        if (parentContainer) return parentContainer.querySelector('input[type="text"]');
        return null;
    }

    // ====================================================================================
    // --- Enhancement Logic
    // ====================================================================================

    /**
     * @summary Flattens the title when a native MB mis-guess wraps the artist and title inside parentheses/brackets in the ETI.
     * @param {string} title - The track/recording title to inspect.
     * @returns {string} The flattened title string.
     */
    function flattenEtiMisguess(title) {
        let text = title;
        const etiMatch = text.match(ETI_PATTERN);
        if (etiMatch) {
            const potentialEti = etiMatch[1];
            const etiContent = potentialEti.slice(1, -1).trim();
            const hasSeparator = etiContent.match(/\s+(?:[-–—]|\/)\s+/);
            const isFeat = etiContent.match(/^(?:feat|ft|featuring)\.?\s+/i);
            if (hasSeparator && isFeat) {
                text = text.substring(0, text.lastIndexOf(potentialEti)).trim() + ' ' + etiContent;
            }
        }
        return text;
    }

    /**
     * @summary Recursively extracts trailing ETIs (bracketed/parenthesized suffixes) from the title.
     * @param {string} title - The title to extract from.
     * @returns {{cleanTitle: string, eti: string}} An object containing the cleaned title and the extracted ETI suffix.
     */
    function extractTrailingEtis(title) {
        let cleanTitle = title;
        let eti = '';
        let match;
        while ((match = cleanTitle.match(ETI_PATTERN))) {
            eti = match[1] + (eti ? ' ' + eti : '');
            cleanTitle = cleanTitle.substring(0, cleanTitle.lastIndexOf(match[1])).trim();
        }
        return { cleanTitle, eti };
    }

    /**
     * @summary Finds the index of the split part that represents the artist name by matching against known artists.
     * @param {string[]} parts - The separated text parts of the title.
     * @param {string[]} pristineLower - List of pristine artist names in lowercase.
     * @param {string[]} editorLower - List of active editor artist names in lowercase.
     * @returns {number} The index of the artist part, or -1 if no match.
     */
    function findArtistPartIndex(parts, pristineLower, editorLower) {
        const getMatchCount = (part, artistList) => {
            const artistsInPart = parseArtistNamesFromString(part);
            return artistsInPart.filter(name => artistList.includes(name.toLowerCase())).length;
        };

        const scoreParts = (artistList) => {
            const scores = parts.map((part, idx) => ({ idx, count: getMatchCount(part, artistList) }));
            const candidates = scores.filter(s => s.count > 0);
            if (candidates.length === 1) return candidates[0].idx;
            if (candidates.length > 1) {
                candidates.sort((a, b) => b.count - a.count);
                if (candidates[0].count > candidates[1].count) {
                    return candidates[0].idx;
                }
            }
            return -1;
        };

        const idx = scoreParts(pristineLower);
        if (idx !== -1) return idx;

        return scoreParts(editorLower);
    }

    /**
     * @summary Parses featured guest artists out of the re-assembled title text.
     * @param {string} title - The track/recording title text.
     * @returns {{cleanTitle: string, titleGuests: {name: string, joinPhrase: string}[], joinPhrase: string|null}} The clean title and parsed guests.
     */
    function extractFeaturedFromTitle(title) {
        let cleanTitle = title;
        const featMatch = cleanTitle.match(FEAT_PATTERN);
        let titleGuests = [];
        let joinPhrase = null;

        if (featMatch) {
            const joinWord = featMatch[1].toLowerCase();
            joinPhrase = joinWord.startsWith('feat') || joinWord.startsWith('ft') ? ' feat. '
                : joinWord.startsWith('with') ? ' with '
                    : ` ${joinWord} `;
            const guestStr = featMatch[2].trim();
            titleGuests = parseArtistsAndJoins(guestStr);
            cleanTitle = cleanTitle.replace(featMatch[0], '').trim();
        }
        return { cleanTitle, titleGuests, joinPhrase };
    }

    function removeArtistFromTitle(input, button) {
        if (!input || !button) return;
        let newText = pristineValues.get(input) || input.value;
        log('removeArtistFromTitle: Initial title input value:', newText);

        // Handle native MB mis-guess in ETI (flattening)
        newText = flattenEtiMisguess(newText);

        // Extract all trailing ETIs recursively to preserve them
        const { cleanTitle: cleanTitleWithoutEtis, eti } = extractTrailingEtis(newText);
        newText = cleanTitleWithoutEtis;
        log('removeArtistFromTitle: ETI extracted:', eti || '(none)', 'Clean title for processing:', newText);

        const reassembleOriginal = () => {
            return newText + (eti ? ' ' + eti : '');
        };

        // Split by separators (CJK-aware)
        const parts = newText.split(SEPARATOR_PATTERN).map(p => p.trim()).filter(Boolean);
        log('removeArtistFromTitle: Split title parts:', parts);

        if (parts.length > 1) {
            const pristineArtists = pristineArtistNames.get(input);
            const pristineLower = (pristineArtists && pristineArtists.length > 0) ? pristineArtists.map(a => a.toLowerCase()) : [];
            const editorLower = getCurrentArtistNames(button).map(a => a.toLowerCase());

            const artistPartIndex = findArtistPartIndex(parts, pristineLower, editorLower);
            log('removeArtistFromTitle: Artist part matching index:', artistPartIndex, artistPartIndex !== -1 ? `("${parts[artistPartIndex]}")` : '(no artist part match)');

            if (artistPartIndex !== -1) {
                const artistPart = parts[artistPartIndex];
                let parsedTitleArtists = parseArtistsAndJoins(artistPart);
                log('removeArtistFromTitle: Parsed artists from title part:', parsedTitleArtists);

                // Re-assemble the remaining parts (the title part)
                const titleParts = parts.filter((_, index) => index !== artistPartIndex);
                let newTitle = titleParts.join(' - '); // standard en-dash join

                // Check if the title part contains a featured artist pattern (e.g. feat. Guest)
                const { cleanTitle: cleanTitleWithoutFeat, titleGuests, joinPhrase } = extractFeaturedFromTitle(newTitle);
                newTitle = cleanTitleWithoutFeat;

                if (joinPhrase && parsedTitleArtists.length > 0) {
                    parsedTitleArtists[parsedTitleArtists.length - 1].joinPhrase = joinPhrase;
                }

                parsedTitleArtists = [...parsedTitleArtists, ...titleGuests];
                log('removeArtistFromTitle: Total parsed/extracted guest artists:', parsedTitleArtists);

                const acObservable = getACObservable(input, button);
                if (acObservable && typeof acObservable === 'function') {
                    log('removeArtistFromTitle: Running in Knockout Model Mode.');
                    // Knockout Model Mode: merge and strip completely
                    const currentAC = acObservable();
                    if (currentAC?.names) {
                        const seededArtists = pristineArtistNames.get(input) || getCurrentArtistNames(button);
                        const updatedNames = mergeArtistCredits(currentAC.names, parsedTitleArtists, seededArtists);
                        if (updatedNames !== currentAC.names) {
                            log('Updating AC observable with merged artists:', updatedNames);
                            acObservable({
                                ...currentAC,
                                names: updatedNames
                            });

                            if (/[\/.]recording\/create/.test(window.location.pathname)) {
                                syncAutocompleteInputs(updatedNames);
                            }
                        }
                    }

                    let finalTitle = newTitle;
                    if (eti) {
                        finalTitle += ' ' + eti;
                    }
                    log(`Removed artist part from title: "${input.value}" -> "${finalTitle}"`);
                    setInputValue(input, finalTitle.trim());
                    pristineValues.set(input, input.value);
                } else {
                    log('removeArtistFromTitle: Running in Fallback DOM Mode.');
                    // Fallback DOM Mode: only strip if all parsed artists are already in editor
                    const allArtistsInTitle = parsedTitleArtists.map(n => n.name.toLowerCase());
                    const allArtistsMatch = allArtistsInTitle.every(a => editorLower.includes(a));
                    log('removeArtistFromTitle (fallback): Do all title artists match the editor?', allArtistsMatch, 'Title artists:', allArtistsInTitle, 'Editor artists:', editorLower);

                    if (allArtistsMatch) {
                        let finalTitle = newTitle;
                        if (eti) {
                            finalTitle += ' ' + eti;
                        }
                        log(`Removed artist part from title (fallback): "${input.value}" -> "${finalTitle}"`);
                        setInputValue(input, finalTitle.trim());
                        pristineValues.set(input, input.value);
                    } else {
                        log('removeArtistFromTitle (fallback): Not all artists matched. Keeping current value intact.');
                        setInputValue(input, reassembleOriginal());
                        pristineValues.set(input, input.value);
                    }
                }
            }
        }
    }


    /**
     * @summary Applies advanced rule sets like French/Swedish apostrophe corrections and acronym fixes.
     * @param {string} text - The current guessed text string.
     * @param {HTMLElement} [button] - The button element that was clicked to trigger the guess case.
     * @returns {string} The text processed by advanced rules.
     */
    function applyAdvancedRules(text, button) {
        if (typeof text !== 'string') return text;
        log('--- applyAdvancedRules START ---');
        let newText = text;
        const keepUpperCase = getBooleanCookie('guesscase_keepuppercase');

        // Preserve MusicBrainz special track titles in square brackets and convert them to lowercase
        const bracketExceptions = [];
        newText = newText.replace(BRACKET_EXCEPTION_PATTERN, (match, p1) => {
            const index = bracketExceptions.length;
            bracketExceptions.push(`[${p1.toLowerCase()}]`);
            return `___MB_GUESS_CASE_EXCEPTION_${index}___`;
        });

        let trailingEti = '';
        const etiMatch = newText.match(ETI_PATTERN);
        if (etiMatch) {
            const potentialEti = etiMatch[1];
            // Check if the native script made a mess by wrapping the title in "feat." parens
            const etiContent = potentialEti.slice(1, -1).trim();
            const hasSeparator = etiContent.match(/\s+[-–]\s+/);
            const isFeat = etiContent.match(/^(?:feat|ft|featuring)\.?\s+/i);

            if (hasSeparator && isFeat) {
                log(`Detected likely native MB mis-guess in ETI: "${potentialEti}". Flattening for reprocessing.`);
                newText = newText.substring(0, newText.lastIndexOf(potentialEti)).trim() + ' ' + etiContent;
            } else {
                trailingEti = potentialEti;
                newText = newText.substring(0, newText.lastIndexOf(trailingEti)).trim();
                log(`Found ETI: "${trailingEti}"`);
                log(`Text after ETI removal: "${newText}"`);
            }
        } else {
            log('No ETI found.');
        }

        log(`Text for ETI processing: "${newText}"`);

        if (trailingEti) {
            newText += ` ${trailingEti}`;
            log(`Re-added ETI. Final text before ETI processing: "${newText}"`);
        }

        newText = newText.replace(/\[/g, '(').replace(/\]/g, ')');
        newText = newText.replace(PARENS_CONTENT_PATTERN, (match, etiContent) => {
            let processedEti = etiContent;
            for (const phrase of etiPhrasesToLowercase) {
                processedEti = processedEti.replace(createSafeRegex(phrase), matched => {
                    const isAllCaps = matched === matched.toUpperCase() && matched !== matched.toLowerCase();
                    return (keepUpperCase && isAllCaps) ? matched : phrase.toLowerCase();
                });
            }
            return `(${processedEti})`;
        });

        // Restore square bracket exceptions
        bracketExceptions.forEach((val, index) => {
            newText = newText.replace(`___MB_GUESS_CASE_EXCEPTION_${index}___`, val);
        });

        log('--- applyAdvancedRules END ---');
        return newText.trim();
    }

    /**
     * Deduplicates an artist credit by reading and writing directly to a
     * Knockout observable — no DOM bubble needed.
     *
     * After MB's native guessFeat appends feat. artists, the resulting names
     * array may contain duplicates of artists already in the AC.
     * This function removes those duplicates and repairs the join phrase at
     * the boundary so it reflects the feat. join phrase rather than the
     * original one (e.g. ", " → " feat. ").
     *
     * @param {ko.Observable} acObservable - The entity.artistCredit ko.observable.
     */
    function deduplicateACFromObservable(acObservable) {
        if (typeof acObservable !== 'function') return;

        const ac = acObservable();
        if (!ac?.names?.length) return;

        const names = ac.names;
        const fmtAC = (arr) => arr.map(n => ({ name: n.name, join: n.joinPhrase, gid: n.artist?.gid ?? null }));
        log('deduplicateACFromObservable: names before dedup:', fmtAC(names));

        // Always key by lowercased name for dedup purposes.
        // guessFeat appends entries via expandCredit with artist:null when
        // no relatedArtists are available, even if the original seeded entry
        // has a linked MBID. Keying by MBID would miss those cross-MBID/no-MBID
        // duplicates. The first occurrence (which may carry the MBID) is always
        // kept, so linked entity data is preserved.
        const getKey = (entry) => entry.name.trim().toLowerCase();

        const seenKeys = new Map(); // key → index of first occurrence
        const toRemove = new Set();

        // Identify duplicates and collect the feat join phrase.
        // guessFeat sets the feat join phrase on the LAST entry of the original
        // AC (the entry just before the first appended artist). We read it there.
        let featJoinPhrase = null;

        for (let i = 0; i < names.length; i++) {
            const key = getKey(names[i]);
            if (!key) continue;

            if (seenKeys.has(key)) {
                // Capture the feat join phrase from the entry immediately before
                // the first appended duplicate — that's where guessFeat placed it.
                if (featJoinPhrase === null && i > 0) {
                    const prevPhrase = names[i - 1].joinPhrase ?? '';
                    if (/feat|ft/i.test(prevPhrase)) {
                        featJoinPhrase = prevPhrase;
                    }
                }
                toRemove.add(i);
            } else {
                seenKeys.set(key, i);
            }
        }

        if (toRemove.size === 0) {
            log('deduplicateACFromObservable: No duplicates found.');
            return;
        }

        log(`deduplicateACFromObservable: Removing ${toRemove.size} duplicate(s). Feat join phrase: "${featJoinPhrase}"`);

        const dedupedNames = names.filter((_, i) => !toRemove.has(i));

        // Repair the join phrase at the true feat boundary.
        // guessFeat.concat() appended copies of artists already in the AC.
        // The feat block in the deduplicated result starts at the EARLIEST
        // first-occurrence index of any removed duplicate — e.g. if KASANE TETO
        // (a dup of index-1 Kasane Teto) and Una Otomachi (dup of index-2) were
        // removed, the feat block starts at index 1, so the boundary entry that
        // needs the feat join phrase is at index 0 (Dada).
        if (featJoinPhrase !== null) {
            let firstFeatIdx = Infinity;
            for (const dupIdx of toRemove) {
                const firstOccIdx = seenKeys.get(getKey(names[dupIdx]));
                if (firstOccIdx !== undefined && firstOccIdx < firstFeatIdx) {
                    firstFeatIdx = firstOccIdx;
                }
            }
            const boundaryIdx = firstFeatIdx - 1;
            if (boundaryIdx >= 0 && boundaryIdx < dedupedNames.length) {
                const current = dedupedNames[boundaryIdx].joinPhrase ?? '';
                if (current !== featJoinPhrase) {
                    log(`Repairing join phrase at index ${boundaryIdx}: "${current}" → "${featJoinPhrase}"`);
                    dedupedNames[boundaryIdx] = { ...dedupedNames[boundaryIdx], joinPhrase: featJoinPhrase };
                }
            }
        }

        // Ensure the last entry always has an empty join phrase.
        const last = dedupedNames.length - 1;
        if (dedupedNames[last]?.joinPhrase) {
            dedupedNames[last] = { ...dedupedNames[last], joinPhrase: '' };
        }

        acObservable({ ...ac, names: dedupedNames });
        log('deduplicateACFromObservable: Done.', fmtAC(dedupedNames));
    }

    /**
     * Returns the Knockout track model for a given tr.track DOM element.
     * Uses the element's id ("track-row-{uniqueID}") to match against
     * the MB._releaseEditor model tree.
     */
    function getTrackModel(trackRow) {
        const id = trackRow?.id; // e.g. "track-row-abc123"
        if (!id) return null;
        const release = window.MB?.releaseEditor?.rootField?.release?.();
        if (!release) return null;
        for (const medium of release.mediums?.() ?? []) {
            for (const track of medium.tracks?.() ?? []) {
                if (track.elementID === id) return track;
            }
        }
        return null;
    }

    function deduplicateTrackAC(trackRow) {
        // Try model-level dedup first (fast, no DOM/timing issues).
        const track = getTrackModel(trackRow);
        if (track) {
            deduplicateACFromObservable(track.artistCredit);
            return;
        }
        // Fallback: DOM bubble (standalone recording page, no release editor model).
        log('No track model found for row, falling back to bubble dedup.', trackRow);
        const openBubbleButton = trackRow.querySelector('.artist .open-ac');
        if (!openBubbleButton) return;
        const editor = new ArtistCreditsEditor();
        editor.open(openBubbleButton).then(opened => {
            if (!opened) { log('Failed to open AC bubble (fallback).'); return; }
            // Minimal bubble dedup for the fallback path.
            const rows = editor.getArtistRows();
            const seen = new Set();
            for (const row of rows) {
                const inp = row.querySelector('div.autocomplete2 input[type="text"]');
                const name = inp?.value.trim().toLowerCase();
                if (name && seen.has(name)) {
                    row.querySelector('.remove-artist-credit')?.click();
                } else if (name) {
                    seen.add(name);
                }
            }
            editor.close();
        });
    }

    /**
     * @summary Enhances a track-specific "Guess Feat" button.
     * @param {HTMLElement} button - The track-specific guess feat button element.
     */
    function enhanceTrackGuessFeat(button) {
        if (button.dataset.enhanced) return;
        log('Found track "Guess Feat." button to enhance.', button);
        const trackRow = button.closest('tr.track');
        if (!trackRow) return;

        button.addEventListener('click', () => {
            log(`'Guess Feat.' click detected for track. Allowing native script to run first.`);
            const input = trackRow.querySelector('input.track-name');
            if (input) {
                pristineValues.set(input, input.value);
                pristineArtistNames.set(input, getCurrentArtistNames(button));
            }
            setTimeout(() => {
                deduplicateTrackAC(trackRow);
                if (input) removeArtistFromTitle(input, button);
            }, 100);
        }, true);

        button.dataset.enhanced = 'true';
    }

    /**
     * @summary Enhances a medium-wide "Guess Feat" button.
     * @param {HTMLElement} button - The medium-wide guess feat button element.
     */
    function enhanceMediumGuessFeat(button) {
        if (button.dataset.enhanced) return;
        log('Found medium-wide "Guess Feat." button to enhance.', button);

        button.addEventListener('click', () => {
            log('Medium-wide "Guess Feat." clicked. Allowing native script to run first.');
            const medium = button.closest('fieldset.advanced-medium');
            if (!medium) return;

            // Capture all pristine values before native script modifies them
            const inputs = Array.from(medium.querySelectorAll('tr.track input.track-name'));
            inputs.forEach(input => {
                pristineValues.set(input, input.value);
                pristineArtistNames.set(input, getCurrentArtistNames(button));
            });

            setTimeout(() => {
                log('Applying de-duplication and title cleanup to all tracks in this medium.');
                medium.querySelectorAll('tr.track').forEach(trackRow => {
                    deduplicateTrackAC(trackRow);
                    const input = trackRow.querySelector('input.track-name');
                    if (input) removeArtistFromTitle(input, button);
                });
                log('De-duplication and title sweep complete for medium.');
            }, 100);
        }, true);

        button.dataset.enhanced = 'true';
    }

    /**
     * @summary Enhances the release-wide or global "Guess Feat" button.
     * @param {HTMLElement} button - The release-wide or global guess feat button element.
     */
    function enhanceReleaseGuessFeat(button) {
        if (button.dataset.enhanced) return;
        log('Found Release/Recording "Guess Feat." button to enhance.', button);

        button.addEventListener('click', (event) => {
            const input = findAssociatedInput(button);
            if (input) {
                pristineValues.set(input, input.value);
                pristineArtistNames.set(input, getCurrentArtistNames(button));
            }

            // --- Standalone Form Advanced Correction Interception ---
            if (input && /[\/.]recording\/create/.test(window.location.pathname)) {
                const titleVal = input.value.trim();

                const patterns = [
                    // Layout Style A: "Artist - Title feat. Guest 1, Guest 2 (ETI)"
                    {
                        regex: /^(.*?)\s+-\s+([^([]+?)\s+(?:feat\.?|ft\.?|featuring)\s+([^([]+?)((?:\s*(?:\([^)]+\)|\[[^\]]+\]))*)$/i,
                        parse: (m) => ({ main: m[1], join: ' feat. ', guests: m[3], title: m[2], eti: m[4] || '' })
                    },
                    // Layout Style B: "Artist feat. Guest - Title (ETI)"
                    {
                        regex: /^(.*?)\s+(?:feat\.?|ft\.?|featuring)\s+([^([]+?)\s+-\s+(.*)$/i,
                        parse: (m) => ({ main: m[1], join: ' feat. ', guests: m[2], title: m[3], eti: '' })
                    },
                    // Layout Style C: Braced hyphen layout "Artist (feat. Guest - Title) (ETI)"
                    {
                        regex: /^(.*?)\s+\((?:feat\.?|ft\.?|featuring)\s+(.*?)\s+-\s+(.*?)\)((?:\s*(?:\([^)]+\)|\[[^\]]+\]))*)$/i,
                        parse: (m) => ({ main: m[1], join: ' feat. ', guests: m[2], title: m[3], eti: m[4] || '' })
                    },
                    // Layout Style D: Suffix "with" addition "Artist - Title (with Guest) (ETI)"
                    {
                        regex: /^(.*?)\s+-\s+(.*)\s+\((with|and|feat\.?|ft\.?|featuring)\s+([^)]+)\)((?:\s*(?:\([^)]+\)|\[[^\]]+\]))*)$/i,
                        parse: (m) => ({ main: m[1], join: ` ${m[3]} `, guests: m[4], title: m[2], eti: m[5] || '' })
                    }
                ];

                let matchedData = null;
                for (const p of patterns) {
                    const m = titleVal.match(p.regex);
                    if (m) {
                        matchedData = p.parse(m);
                        break;
                    }
                }

                if (matchedData) {
                    const artistsInEditor = getCurrentArtistNames(button);
                    const editorLower = artistsInEditor.map(a => a.toLowerCase());

                    let validated = true;
                    let swapMainAndTitle = false;

                    if (editorLower.length > 0) {
                        const mainArtists = parseArtistNamesFromString(matchedData.main);
                        const titleArtists = parseArtistNamesFromString(matchedData.title);
                        const mainMatches = mainArtists.some(a => editorLower.includes(a.toLowerCase()));
                        const titleMatches = titleArtists.some(a => editorLower.includes(a.toLowerCase()));

                        if (mainMatches || titleMatches) {
                            if (titleMatches && !mainMatches) {
                                swapMainAndTitle = true;
                            }
                        } else {
                            validated = false;
                        }
                    }

                    if (validated) {
                        log('Intercepting standalone seeded formatting pattern via custom structural layout rules.');
                        event.stopImmediatePropagation(); // Disarm standard misbehaving script execution loop completely

                        let mainArtistText = matchedData.main.trim();
                        const joinPhraseText = matchedData.join;
                        let trackTitle = matchedData.title.trim();
                        let trailingEti = matchedData.eti ? matchedData.eti.trim() : '';

                        if (swapMainAndTitle) {
                            log('Reversed title/artist layout detected. Swapping candidates.');
                            const tmp = mainArtistText;
                            mainArtistText = trackTitle;
                            trackTitle = tmp;
                        }

                        // Fall-through safety check to pick up any nested trailing parentheticals
                        const iEtiMatch = trackTitle.match(/\s*(\[[^\]]+\]|\([^)]+\)|【[^】]+】)$/);
                        if (iEtiMatch && !trailingEti) {
                            trailingEti = iEtiMatch[1];
                            trackTitle = trackTitle.substring(0, trackTitle.lastIndexOf(trailingEti)).trim();
                        }

                        const finalTrackTitleText = trailingEti ? `${trackTitle} ${trailingEti}` : trackTitle;
                        setInputValue(input, finalTrackTitleText);

                        const sourceInstance = window.MB?.getSourceEntityInstance?.();
                        if (sourceInstance && sourceInstance.artistCredit) {
                            const acObservable = sourceInstance.artistCredit;
                            const currentAC = acObservable();

                            if (currentAC && currentAC.names && currentAC.names.length > 0) {
                                const parsedMainArtists = parseArtistsAndJoins(mainArtistText);
                                if (parsedMainArtists.length > 0) {
                                    parsedMainArtists[parsedMainArtists.length - 1].joinPhrase = joinPhraseText;
                                }
                                const guestList = parseArtistsAndJoins(matchedData.guests);
                                const parsedTitleArtists = [...parsedMainArtists, ...guestList];

                                const parsedArtistNodes = mergeArtistCredits(currentAC.names, parsedTitleArtists, artistsInEditor);

                                acObservable({
                                    ...currentAC,
                                    names: parsedArtistNodes
                                });

                                syncAutocompleteInputs(parsedArtistNodes);
                            }
                        }

                        setTimeout(() => {
                            pristineValues.set(input, input.value);
                            pristineArtistNames.set(input, getCurrentArtistNames(button));
                        }, 50);
                        return;
                    }
                }
            }

            log(`'Guess Feat.' click detected for release/recording. Allowing native script to run first.`);

            // Deduplicate the global artist credit editor and clean up title
            setTimeout(() => {
                const release = window.MB?.releaseEditor?.rootField?.release?.();
                if (release?.artistCredit) {
                    log('Deduplicating release AC via Knockout model.');
                    deduplicateACFromObservable(release.artistCredit);
                } else {
                    const source = window.MB?.getSourceEntityInstance?.();
                    if (source?.artistCredit) {
                        log('Deduplicating standalone entity AC via Knockout model.');
                        deduplicateACFromObservable(source.artistCredit);
                    } else {
                        log('No Knockout AC observable found for release/recording dedup.');
                    }
                }

                const associatedInput = findAssociatedInput(button);
                if (associatedInput) {
                    removeArtistFromTitle(associatedInput, button);
                    pristineValues.set(associatedInput, associatedInput.value);
                    pristineArtistNames.set(associatedInput, getCurrentArtistNames(button));
                    log(`Updated pristine value for ${associatedInput.name || associatedInput.id} after Guess Feat cleanup: "${associatedInput.value}"`);
                }
            }, 100);

        }, true);

        button.dataset.enhanced = 'true';
    }


    /**
     * @summary Enhances a React-based "Guess Case" button with advanced rules and hover previews.
     * @param {HTMLElement} button - The Guess Case button element.
     */
    function enhanceReactGuessCase(button) {
        if (button.dataset.enhanced) return;
        log('Found React-based "Guess Case" button to enhance.', button);

        const input = findAssociatedInput(button);
        if (!input) {
            warn('Could not find associated input for guess case button.', button);
            return;
        }

        // --- Pristine Value Management ---
        // We set the initial value and update it on focus or input.
        if (!pristineValues.has(input)) {
            pristineValues.set(input, input.value);
            log(`Set initial pristine value for ${input.name || input.id}: "${input.value}"`);
        }

        const updatePristineValue = (event) => {
            if (event && !event.isTrusted) return;
            pristineValues.set(input, input.value);
            log(`Updated pristine value for ${input.name || input.id}: "${input.value}"`);
        };

        input.addEventListener('focus', updatePristineValue);
        input.addEventListener('input', updatePristineValue);

        // --- Event Handlers ---
        let activePreview = false;

        const handleMouseEnter = (event) => {
            if (event.buttons !== 0) return;

            const originalValue = pristineValues.get(input);
            activePreview = true;
            log(`Pristine value from map: "${originalValue}"`);

            setTimeout(() => {
                if (!activePreview) return; // Mouse already left

                const nativePreviewValue = input.value;
                const enhancedPreviewValue = applyAdvancedRules(nativePreviewValue, button);

                if (enhancedPreviewValue !== originalValue) {
                    input.classList.add('preview');
                    input.value = enhancedPreviewValue;
                } else {
                    input.classList.remove('preview');
                    input.value = originalValue;
                }
            }, 0);
        };

        const handleMouseLeave = () => {
            if (activePreview) {
                log('Hiding preview and restoring original value.');
                const originalValue = pristineValues.get(input);
                setInputValue(input, originalValue);
                input.classList.remove('preview');
                activePreview = false;
            }
        };

        const handleClick = () => {
            log('"Guess Case" click detected.');
            activePreview = false;

            setTimeout(() => {
                const nativeValue = input.value;
                const enhancedValue = applyAdvancedRules(nativeValue, button);
                log(`Native: "${nativeValue}", Enhanced: "${enhancedValue}"`);

                setInputValue(input, enhancedValue);

                pristineValues.set(input, enhancedValue);
            }, 0);
        };


        button.addEventListener('click', handleClick);
        button.addEventListener('mouseenter', handleMouseEnter);
        button.addEventListener('mouseleave', handleMouseLeave);

        button.dataset.enhanced = 'true';
    }


    // ====================================================================================
    // --- Preserve Artist As Credited
    // ====================================================================================

    const pristineCreditedAsValues = new WeakMap();

    // Track manual edits to the credited-as fields
    document.addEventListener('input', (event) => {
        if (event.isTrusted && event.target.tagName === 'INPUT' && event.target.id.includes('-credited-as-')) {
            pristineCreditedAsValues.set(event.target, event.target.value);
        }
    }, true);

    function restorePristineCreditedAs(element) {
        const row = element.closest('tr');
        if (!row) return;

        const creditedAsInput = row.querySelector('input[id*="-credited-as-"]');
        if (!creditedAsInput) return;

        const currentValue = creditedAsInput.value;
        if (!currentValue) return; // Empty row, nothing to preserve

        log(`Tracking 'credited as' field for selection overwrite: "${currentValue}"`);

        // Use a lightweight 2-second polling interval to monitor the input directly.
        // This securely waits out all browser 'click' delays and React unmounting phases,
        // cleanly capturing the update only after React has fully rendered and settled "初音ミク".
        let attempts = 0;
        const interval = setInterval(() => {
            if (creditedAsInput.value !== currentValue) {
                log(`Overwritten 'credited as' field detected. Restoring pristine value: "${currentValue}"`);
                setInputValue(creditedAsInput, currentValue);
                clearInterval(interval);
            }
            if (++attempts > 40) clearInterval(interval); // Timeout safely after ~2 seconds
        }, 50);
    }

    // Capture phase listeners ensure we arm the observer BEFORE the selection finishes
    document.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        const li = event.target.closest('li.option-item');
        if (li) {
            const container = li.closest('.autocomplete2');
            if (container) restorePristineCreditedAs(container);
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === 'Tab') && event.target.tagName === 'INPUT') {
            const container = event.target.closest('.autocomplete2');
            if (container) {
                const expanded = event.target.parentElement?.getAttribute('aria-expanded') === 'true';
                if (expanded) restorePristineCreditedAs(container);
            }
        }
    }, true);


    // ====================================================================================
    // --- Model-Level Support for Apollo & Custom Editors
    // ====================================================================================

    function cleanTrackModelAfterGuessFeat(track, originalTitle, originalArtists) {
        if (!track) return;
        log('Starting cleanTrackModelAfterGuessFeat for track model:', track);

        // 1. Deduplicate the artist credit observable
        deduplicateACFromObservable(track.artistCredit);

        // 2. Remove artist from title on the model level
        const titleVal = track.name() || '';
        let newText = originalTitle || titleVal;

        // Extract trailing ETIs recursively
        const { cleanTitle: cleanTitleWithoutEtis, eti } = extractTrailingEtis(newText);
        newText = cleanTitleWithoutEtis;

        const separatorPattern = /\s+[-–—/]\s+|\s+[-–—/]\s*|\s*[-–—/]\s+(?=.)|(?<=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])[-–—/]|[-–—/](?=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])/g;
        const parts = newText.split(separatorPattern).map(p => p.trim()).filter(Boolean);

        if (parts.length > 1) {
            const currentAC = track.artistCredit();
            const pristineLower = (originalArtists && originalArtists.length > 0) ? originalArtists.map(a => a.toLowerCase()) : [];
            const editorLower = (currentAC?.names ?? []).map(n => n.name.toLowerCase());

            const artistPartIndex = findArtistPartIndex(parts, pristineLower, editorLower);

            if (artistPartIndex !== -1) {
                const artistPart = parts[artistPartIndex];
                let parsedTitleArtists = parseArtistsAndJoins(artistPart);

                const titleParts = parts.filter((_, index) => index !== artistPartIndex);
                let newTitle = titleParts.join(' - ');

                const { cleanTitle: cleanTitleWithoutFeat, titleGuests, joinPhrase } = extractFeaturedFromTitle(newTitle);
                newTitle = cleanTitleWithoutFeat;

                if (joinPhrase && parsedTitleArtists.length > 0) {
                    parsedTitleArtists[parsedTitleArtists.length - 1].joinPhrase = joinPhrase;
                }

                parsedTitleArtists = [...parsedTitleArtists, ...titleGuests];

                if (currentAC?.names) {
                    const updatedNames = mergeArtistCredits(currentAC.names, parsedTitleArtists, originalArtists);
                    if (updatedNames !== currentAC.names) {
                        log('Updating AC observable with merged artists:', updatedNames);
                        track.artistCredit({
                            ...currentAC,
                            names: updatedNames
                        });
                    }
                }

                let finalTitle = newTitle;
                if (eti) {
                    finalTitle += ' ' + eti;
                }
                log(`Removed artist part from title (model): "${titleVal}" -> "${finalTitle}"`);
                track.name(finalTitle.trim());
            }
        }
    }


    // ====================================================================================
    // --- Initialization
    // ====================================================================================

    /**
     * @summary Enhances MB.releaseEditor actions with custom formatting and de-duplication behaviors.
     */
    function enhanceReleaseEditorActions() {
        const releaseEditor = window.MB?._releaseEditor;
        if (!releaseEditor || releaseEditor.guessCaseTrackName.isEnhanced) return;
        log('Found release editor, enhancing viewmodel actions.');

        const originalGuessCaseTrackName = releaseEditor.guessCaseTrackName;
        releaseEditor.guessCaseTrackName = function (track, event) {
            originalGuessCaseTrackName.call(this, track, event);
            switch (event.type) {
                case 'mouseenter':
                    track.previewName(applyAdvancedRules(track.previewName.peek(), event.target));
                    break;
                case 'click':
                    track.name(applyAdvancedRules(track.name.peek(), event.target));
                    break;
            }
        };
        releaseEditor.guessCaseTrackName.isEnhanced = true;

        if (releaseEditor.guessTrackFeatArtists && !releaseEditor.guessTrackFeatArtists.isEnhanced) {
            const originalGuessTrackFeatArtists = releaseEditor.guessTrackFeatArtists;
            releaseEditor.guessTrackFeatArtists = function (track, event) {
                log('Intercepted guessTrackFeatArtists on model.');
                const originalTitle = track.name();
                const originalArtists = (track.artistCredit()?.names ?? []).map(n => n.name);

                originalGuessTrackFeatArtists.call(this, track, event);

                try {
                    cleanTrackModelAfterGuessFeat(track, originalTitle, originalArtists);
                } catch (e) {
                    err('Error cleaning track model after guessTrackFeatArtists:', e);
                }
            };
            releaseEditor.guessTrackFeatArtists.isEnhanced = true;
        }

        if (releaseEditor.guessMediumFeatArtists && !releaseEditor.guessMediumFeatArtists.isEnhanced) {
            const originalGuessMediumFeatArtists = releaseEditor.guessMediumFeatArtists;
            releaseEditor.guessMediumFeatArtists = function (medium, event) {
                log('Intercepted guessMediumFeatArtists on model.');
                const trackData = (medium.tracks?.() ?? []).map(track => ({
                    track,
                    originalTitle: track.name(),
                    originalArtists: (track.artistCredit()?.names ?? []).map(n => n.name)
                }));

                originalGuessMediumFeatArtists.call(this, medium, event);

                trackData.forEach(({ track, originalTitle, originalArtists }) => {
                    try {
                        cleanTrackModelAfterGuessFeat(track, originalTitle, originalArtists);
                    } catch (e) {
                        err('Error cleaning track model after guessMediumFeatArtists:', e);
                    }
                });
            };
            releaseEditor.guessMediumFeatArtists.isEnhanced = true;
        }

        if (releaseEditor.guessReleaseFeatArtists && !releaseEditor.guessReleaseFeatArtists.isEnhanced) {
            const originalGuessReleaseFeatArtists = releaseEditor.guessReleaseFeatArtists;
            releaseEditor.guessReleaseFeatArtists = function (release, event) {
                log('Intercepted guessReleaseFeatArtists on model.');
                const trackData = [];
                for (const medium of release.mediums?.() ?? []) {
                    for (const track of medium.tracks?.() ?? []) {
                        trackData.push({
                            track,
                            originalTitle: track.name(),
                            originalArtists: (track.artistCredit()?.names ?? []).map(n => n.name)
                        });
                    }
                }

                originalGuessReleaseFeatArtists.call(this, release, event);

                trackData.forEach(({ track, originalTitle, originalArtists }) => {
                    try {
                        cleanTrackModelAfterGuessFeat(track, originalTitle, originalArtists);
                    } catch (e) {
                        err('Error cleaning track model after guessReleaseFeatArtists:', e);
                    }
                });
            };
            releaseEditor.guessReleaseFeatArtists.isEnhanced = true;
        }

        if (releaseEditor.guessCaseMediumName && !releaseEditor.guessCaseMediumName.isEnhanced) {
            const originalGuessCaseMediumName = releaseEditor.guessCaseMediumName;
            releaseEditor.guessCaseMediumName = function (medium, event) {
                originalGuessCaseMediumName.call(this, medium, event);
                switch (event.type) {
                    case 'mouseenter':
                        if (medium.previewName) {
                            medium.previewName(applyAdvancedRules(medium.previewName.peek(), event.target));
                        }
                        break;
                    case 'click':
                        medium.name(applyAdvancedRules(medium.name.peek(), event.target));
                        break;
                    default:
                        if (event.type !== 'mouseleave') {
                            medium.name(applyAdvancedRules(medium.name.peek(), event.target));
                        }
                        break;
                }
            };
            releaseEditor.guessCaseMediumName.isEnhanced = true;
        }
    }

    const observer = new MutationObserver(() => {
        if (window.MB?._releaseEditor) enhanceReleaseEditorActions();

        // We must be very specific. The 'legacy' enhancer handles track titles.
        // The 'react' enhancer handles all *other* titles (release, standalone recording).
        // We can distinguish them by their `title` attribute.
        document.querySelectorAll('.guesscase-title:not([data-enhanced])').forEach(button => {
            if (button.title === 'Guess case') { // e.g., Release Title, Recording Title
                enhanceReactGuessCase(button);
            }
            // Buttons with `title="Guess case track"` are left alone,
            // as they are handled by `enhanceLegacyGuessCase`.
        });

        // Catch typical guessfeat icons, AND the standard MBS bottom-list action buttons
        const guessFeatSelectors = [
            'button.guessfeat:not([data-enhanced])',
            'button[data-click="guessMediumFeatArtists"]:not([data-enhanced])',
            'button[data-click="guessReleaseFeatArtists"]:not([data-enhanced])'
        ].join(', ');

        document.querySelectorAll(guessFeatSelectors).forEach(button => {
            if (button.closest('tr.track') || button.dataset.click === 'guessTrackFeatArtists') {
                enhanceTrackGuessFeat(button);
            } else if (button.closest('fieldset.advanced-medium') || button.dataset.click === 'guessMediumFeatArtists') {
                enhanceMediumGuessFeat(button);
            } else {
                enhanceReleaseGuessFeat(button);
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
