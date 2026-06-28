// ==UserScript==
// @name         MusicBrainz: Guess Case Improver
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.8.0
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
    const DEBUG_MODE = true;

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

    const JOIN_PHRASE_PATTERN = /\s*\b(?:featuring|feat|ft|vs)\b\.?\s*|\s*(?:[,，、&・×/])\s*|\s+(?:and|x)\s+/gi;

    log('User configuration loaded.');

    // ====================================================================================
    // --- Editor Control Class ---
    // ====================================================================================

    class ArtistCreditsEditor {
        #bubble;

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

        close() {
            if (!this.#bubble) return;
            this.#bubble.querySelector('.buttons .positive')?.click();
            this.#bubble = null;
        }

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
        // Priority 1: Track-specific artist credit input (Release Editor)
        const trackRow = button.closest('tr.track');
        if (trackRow) {
            const trackArtistInput = trackRow.querySelector('.artist .autocomplete2 input');
            if (trackArtistInput?.value) {
                log('Found artist from track row input:', trackArtistInput.value);
                return parseArtistNamesFromString(trackArtistInput.value);
            }
        }

        // Priority 2: Main artist credit editor (Standalone Recording, Release Editor global AC)
        const artistCreditEditor = document.getElementById('artist-credit-editor');
        if (artistCreditEditor) {
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

        // Priority 3: Fallback to seeded data in the stash
        try {
            const namesData = window?.__MB__?.$c?.stash?.artist_credit?.names ??
                window?.__MB__?.$c?.stash?.source_entity?.artistCredit?.names;

            if (namesData?.length > 0) {
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

        warn('Could not determine current artists from any source.');
        return [];
    }


    function parseArtistNamesFromString(artistString) {
        if (!artistString) return [];
        return artistString.split(JOIN_PHRASE_PATTERN)
            .map(name => name.trim().replace(/^\.+|\.+$/g, '').toLowerCase())
            .filter(Boolean);
    }

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
            // Append non-duplicate parsed artists
            const currentNamesLower = currentNames.map(n => n.name.trim().toLowerCase());
            const newTitleArtists = parsedTitleArtists.filter(ta => !currentNamesLower.includes(ta.name.trim().toLowerCase()));

            if (newTitleArtists.length === 0) {
                return currentNames;
            }

            const updatedNames = [...currentNames];
            let joinPhraseToUse = ' feat. ';
            const firstNewIdx = parsedTitleArtists.findIndex(ta => !currentNamesLower.includes(ta.name.trim().toLowerCase()));
            if (firstNewIdx > 0) {
                joinPhraseToUse = parsedTitleArtists[firstNewIdx - 1].joinPhrase || ' & ';
            }

            if (updatedNames.length > 0) {
                const lastIdx = updatedNames.length - 1;
                updatedNames[lastIdx] = {
                    ...updatedNames[lastIdx],
                    joinPhrase: joinPhraseToUse
                };
            }

            newTitleArtists.forEach((ta) => {
                updatedNames.push({
                    artist: null,
                    name: ta.name,
                    credit: ta.name,
                    joinPhrase: ta.joinPhrase
                });
            });

            if (updatedNames.length > 0) {
                const lastIdx = updatedNames.length - 1;
                updatedNames[lastIdx] = {
                    ...updatedNames[lastIdx],
                    joinPhrase: ''
                };
            }

            return updatedNames;
        }
    }

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

    function removeArtistFromTitle(input, button) {
        if (!input || !button) return;
        let newText = pristineValues.get(input) || input.value;

        // Handle native MB mis-guess in ETI (flattening)
        // This ensures the separator split can correctly identify the artist part
        const etiMatch = newText.match(/\s*(\[[^\]]+\]|\([^)]+\))$/);
        if (etiMatch) {
            const potentialEti = etiMatch[1];
            const etiContent = potentialEti.slice(1, -1).trim();
            if (etiContent.match(/\s+[-–]\s+/) && etiContent.match(/^(?:feat|ft|featuring)\.?\s+/i)) {
                newText = newText.substring(0, newText.lastIndexOf(potentialEti)).trim() + ' ' + etiContent;
            }
        }

        // Extract all trailing ETIs recursively to preserve them
        let eti = '';
        const etiPattern = /\s*(\([^)]+\)|\[[^\]]+\])$/;
        let match;
        while ((match = newText.match(etiPattern))) {
            eti = match[1] + (eti ? ' ' + eti : '');
            newText = newText.substring(0, newText.lastIndexOf(match[1])).trim();
        }

        const reassembleOriginal = () => {
            return newText + (eti ? ' ' + eti : '');
        };

        // Split by separators (CJK-aware)
        const separatorPattern = /\s+[-–—/]\s+|\s+[-–—/]\s*|\s*[-–—/]\s+(?=.)|(?<=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])[-–—/]|[-–—/](?=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])/g;
        const parts = newText.split(separatorPattern).map(p => p.trim()).filter(Boolean);

        if (parts.length > 1) {
            const artistsInEditor = getCurrentArtistNames(button);
            const editorLower = artistsInEditor.map(a => a.toLowerCase());

            const partMatches = parts.map(part => {
                const artistsInPart = parseArtistNamesFromString(part);
                const matches = artistsInPart.filter(name => editorLower.includes(name.toLowerCase()));
                return {
                    part,
                    artists: artistsInPart,
                    matchCount: matches.length
                };
            });

            // Find the index of the artist part
            let artistPartIndex = -1;
            let candidateIndices = [];
            partMatches.forEach((pm, idx) => {
                if (pm.matchCount > 0) {
                    candidateIndices.push(idx);
                }
            });

            if (candidateIndices.length === 1) {
                artistPartIndex = candidateIndices[0];
            } else if (candidateIndices.length > 1) {
                candidateIndices.sort((a, b) => partMatches[b].matchCount - partMatches[a].matchCount);
                if (partMatches[candidateIndices[0]].matchCount > partMatches[candidateIndices[1]].matchCount) {
                    artistPartIndex = candidateIndices[0];
                }
            }

            if (artistPartIndex !== -1) {
                const artistPart = parts[artistPartIndex];
                let parsedTitleArtists = parseArtistsAndJoins(artistPart);

                // Re-assemble the remaining parts (the title part)
                const titleParts = parts.filter((_, index) => index !== artistPartIndex);
                let newTitle = titleParts.join(' - '); // standard en-dash join

                // Check if the title part contains a featured artist pattern (e.g. feat. Guest)
                const featPattern = /\s*\(?(feat\.?|ft\.?|featuring|with)\s*([^)]+)\)?/i;
                const featMatch = newTitle.match(featPattern);
                let titleGuests = [];
                if (featMatch) {
                    const joinWord = featMatch[1].toLowerCase();
                    const joinPhrase = joinWord.startsWith('feat') || joinWord.startsWith('ft') ? ' feat. '
                        : joinWord.startsWith('with') ? ' with '
                            : ` ${joinWord} `;
                    const guestStr = featMatch[2].trim();
                    titleGuests = parseArtistsAndJoins(guestStr);

                    newTitle = newTitle.replace(featMatch[0], '').trim();

                    if (parsedTitleArtists.length > 0) {
                        parsedTitleArtists[parsedTitleArtists.length - 1].joinPhrase = joinPhrase;
                    }
                }

                parsedTitleArtists = [...parsedTitleArtists, ...titleGuests];

                const acObservable = getACObservable(input, button);
                if (acObservable && typeof acObservable === 'function') {
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
                    // Fallback DOM Mode: only strip if all parsed artists are already in editor
                    const allArtistsInTitle = parsedTitleArtists.map(n => n.name.toLowerCase());
                    const allArtistsMatch = allArtistsInTitle.every(a => editorLower.includes(a));

                    if (allArtistsMatch) {
                        let finalTitle = newTitle;
                        if (eti) {
                            finalTitle += ' ' + eti;
                        }
                        log(`Removed artist part from title (fallback): "${input.value}" -> "${finalTitle}"`);
                        setInputValue(input, finalTitle.trim());
                        pristineValues.set(input, input.value);
                    } else {
                        // Keep current value intact
                        setInputValue(input, reassembleOriginal());
                        pristineValues.set(input, input.value);
                    }
                }
            }
        }
    }

    function applyAdvancedRules(text, button) {
        log('--- applyAdvancedRules START ---');
        let newText = text;
        const keepUpperCase = getBooleanCookie('guesscase_keepuppercase');

        // Preserve MusicBrainz special track titles in square brackets and convert them to lowercase
        const bracketExceptions = [];
        const exceptionPattern = /\[(untitled|unknown|data track)\]/gi;
        newText = newText.replace(exceptionPattern, (match, p1) => {
            const index = bracketExceptions.length;
            bracketExceptions.push(`[${p1.toLowerCase()}]`);
            return `___MB_GUESS_CASE_EXCEPTION_${index}___`;
        });

        let trailingEti = '';
        const etiMatch = newText.match(/\s*(\[[^\]]+\]|\([^)]+\))$/);
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
        const etiRegex = /\(([^)]+)\)/g;
        newText = newText.replace(etiRegex, (match, etiContent) => {
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
                    // Handled here to cleanly extract multiple guests and isolate any trailing ETIs
                    {
                        regex: /^(.*?)\s+-\s+([^([]+?)\s+(?:feat\.?|ft\.?|featuring)\s+([^([]+?)((?:\s*(?:\([^)]+\)|\[[^\]]+\]))*)$/i,
                        parse: (m) => ({ main: m[1], join: ' feat. ', guests: m[3], title: m[2], eti: m[4] || '' })
                    },
                    // Layout Style B: "Artist feat. Guest - Title (ETI)"
                    // Handled here to fix the native standalone form scrapper
                    {
                        regex: /^(.*?)\s+(?:feat\.?|ft\.?|featuring)\s+([^([]+?)\s+-\s+(.*)$/i,
                        parse: (m) => ({ main: m[1], join: ' feat. ', guests: m[2], title: m[3], eti: '' })
                    },
                    // Layout Style C: Braced hyphen layout "Artist (feat. Guest - Title) (ETI)"
                    {
                        regex: /^(.*?)\s+\((?:feat\.?|ft\.?|featuring)\s+(.*?)\s+-\s+(.*?)\)((?:\s*(?:\([^)]+\)|\[[^\]]+\]))*)$/i,
                        parse: (m) => ({ main: m[1], join: ' feat. ', guests: m[2], title: m[3], eti: m[4] || '' })
                    },
                    // Layout Style D: Suffix "with" addition "Artist - Title (with Guest) (ETI)" (Greedy title match)
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
                        const iEtiMatch = trackTitle.match(/\s*(\[[^\]]+\]|\([^)]+\))$/);
                        if (iEtiMatch && !trailingEti) {
                            trailingEti = iEtiMatch[1];
                            trackTitle = trackTitle.substring(0, trackTitle.lastIndexOf(trailingEti)).trim();
                        }

                        // Programmatically run Advanced Case Correction rules on variables
                        let correctedTitle = applyAdvancedRules(trackTitle, button);
                        let correctedEti = trailingEti ? applyAdvancedRules(trailingEti, button) : '';

                        const finalTrackTitleText = correctedEti ? `${correctedTitle} ${correctedEti}` : correctedTitle;
                        setInputValue(input, finalTrackTitleText);

                        // Access core underlying Knockout models
                        const sourceInstance = window.MB?.getSourceEntityInstance?.();
                        if (sourceInstance && sourceInstance.artistCredit) {
                            const acObservable = sourceInstance.artistCredit;
                            const currentAC = acObservable();

                            if (currentAC && currentAC.names && currentAC.names.length > 0) {
                                const originalFirstArtistNode = currentAC.names[0];

                                // Preserves unlinked data correctly to avoid blank rows
                                const preservedName = originalFirstArtistNode.name || mainArtistText;
                                const preservedCredit = originalFirstArtistNode.credit || mainArtistText;

                                const updatedFirstArtistNode = {
                                    ...originalFirstArtistNode,
                                    name: preservedName,
                                    credit: preservedCredit,
                                    joinPhrase: joinPhraseText
                                };

                                // Split multiple featured guest nodes cleanly on common delimiters
                                const guestList = parseArtistsAndJoins(matchedData.guests);
                                const parsedArtistNodes = [updatedFirstArtistNode];

                                guestList.forEach((guestNode, idx) => {
                                    parsedArtistNodes.push({
                                        artist: null,
                                        name: guestNode.name,
                                        credit: guestNode.name,
                                        joinPhrase: (idx < guestList.length - 1) ? guestNode.joinPhrase || ', ' : ''
                                    });
                                });

                                // Update the model array cleanly
                                acObservable({
                                    ...currentAC,
                                    names: parsedArtistNodes
                                });

                                // Synchronize the Autocomplete search elements to display the visible values on screen
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
                // Release editor (tracklist page): release.artistCredit
                const release = window.MB?.releaseEditor?.rootField?.release?.();
                if (release?.artistCredit) {
                    log('Deduplicating release AC via Knockout model.');
                    deduplicateACFromObservable(release.artistCredit);
                } else {
                    // Standalone recording/entity page: source entity via forms.js
                    const source = window.MB?.getSourceEntityInstance?.();
                    if (source?.artistCredit) {
                        log('Deduplicating standalone entity AC via Knockout model.');
                        deduplicateACFromObservable(source.artistCredit);
                    } else {
                        log('No Knockout AC observable found for release/recording dedup.');
                    }
                }

                const input = findAssociatedInput(button);
                if (input) {
                    removeArtistFromTitle(input, button);
                    // Update pristine value state for the guesscase button
                    pristineValues.set(input, input.value);
                    pristineArtistNames.set(input, getCurrentArtistNames(button));
                    log(`Updated pristine value for ${input.name || input.id} after Guess Feat cleanup: "${input.value}"`);
                }
            }, 100);
        }, true);

        button.dataset.enhanced = 'true';
    }

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
        // This is our reliable "original value" source.
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

            // Get the *true* original value from our map
            const originalValue = pristineValues.get(input);
            activePreview = true;
            log(`Pristine value from map: "${originalValue}"`);

            // Run *after* the native preview handler
            setTimeout(() => {
                if (!activePreview) return; // Mouse already left

                const nativePreviewValue = input.value; // Value *after* native handler ran
                const enhancedPreviewValue = applyAdvancedRules(nativePreviewValue, button);

                if (enhancedPreviewValue !== originalValue) {
                    input.classList.add('preview');
                    input.value = enhancedPreviewValue;
                } else {
                    input.classList.remove('preview');
                    input.value = originalValue; // Restore, just in case native changed it
                }
            }, 0);
        };

        const handleMouseLeave = () => {
            if (activePreview) {
                log('Hiding preview and restoring original value.');
                const originalValue = pristineValues.get(input);
                setInputValue(input, originalValue); // Use dispatch to notify React/Knockout
                input.classList.remove('preview');
                activePreview = false;
            }
        };

        const handleClick = () => {
            log('"Guess Case" click detected.');
            activePreview = false; // Disarm mouseleave

            setTimeout(() => {
                const nativeValue = input.value;
                const enhancedValue = applyAdvancedRules(nativeValue, button);
                log(`Native: "${nativeValue}", Enhanced: "${enhancedValue}"`);

                setInputValue(input, enhancedValue); // Set the final value

                // This is now the new "original" value
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
        let eti = '';
        const etiPattern = /\s*(\[[^\]]+\]|\([^)]+\))$/;
        let match;
        while ((match = newText.match(etiPattern))) {
            eti = match[1] + (eti ? ' ' + eti : '');
            newText = newText.substring(0, newText.lastIndexOf(match[1])).trim();
        }

        const separatorPattern = /\s+[-–—/]\s+|\s+[-–—/]\s*|\s*[-–—/]\s+(?=.)|(?<=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])[-–—/]|[-–—/](?=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])/g;
        const parts = newText.split(separatorPattern).map(p => p.trim()).filter(Boolean);

        if (parts.length > 1) {
            const currentAC = track.artistCredit();
            const artistsInEditor = (currentAC?.names ?? []).map(n => n.name);
            const editorLower = artistsInEditor.map(a => a.toLowerCase());

            const partMatches = parts.map(part => {
                const artistsInPart = parseArtistNamesFromString(part);
                const matches = artistsInPart.filter(name => editorLower.includes(name.toLowerCase()));
                return {
                    part,
                    artists: artistsInPart,
                    matchCount: matches.length
                };
            });

            let artistPartIndex = -1;
            let candidateIndices = [];
            partMatches.forEach((pm, idx) => {
                if (pm.matchCount > 0) {
                    candidateIndices.push(idx);
                }
            });

            if (candidateIndices.length === 1) {
                artistPartIndex = candidateIndices[0];
            } else if (candidateIndices.length > 1) {
                candidateIndices.sort((a, b) => partMatches[b].matchCount - partMatches[a].matchCount);
                if (partMatches[candidateIndices[0]].matchCount > partMatches[candidateIndices[1]].matchCount) {
                    artistPartIndex = candidateIndices[0];
                }
            }

            if (artistPartIndex !== -1) {
                const artistPart = parts[artistPartIndex];
                let parsedTitleArtists = parseArtistsAndJoins(artistPart);

                const titleParts = parts.filter((_, index) => index !== artistPartIndex);
                let newTitle = titleParts.join(' - ');

                const featPattern = /\s*\(?(feat\.?|ft\.?|featuring|with)\s*([^)]+)\)?/i;
                const featMatch = newTitle.match(featPattern);
                let titleGuests = [];
                if (featMatch) {
                    const joinWord = featMatch[1].toLowerCase();
                    const joinPhrase = joinWord.startsWith('feat') || joinWord.startsWith('ft') ? ' feat. '
                        : joinWord.startsWith('with') ? ' with '
                            : ` ${joinWord} `;
                    const guestStr = featMatch[2].trim();
                    titleGuests = parseArtistsAndJoins(guestStr);

                    newTitle = newTitle.replace(featMatch[0], '').trim();

                    if (parsedTitleArtists.length > 0) {
                        parsedTitleArtists[parsedTitleArtists.length - 1].joinPhrase = joinPhrase;
                    }
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

    function enhanceLegacyGuessCase() {
        const releaseEditor = window.MB?._releaseEditor;
        if (!releaseEditor || releaseEditor.guessCaseTrackName.isEnhanced) return;
        log('Found release editor, enhancing legacy (track name) guess case.');

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
    }

    const observer = new MutationObserver(() => {
        if (window.MB?._releaseEditor) enhanceLegacyGuessCase();

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
