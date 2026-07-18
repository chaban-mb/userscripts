// ==UserScript==
// @name         MusicBrainz: Guess Case Improver
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.9.0
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

    const log = (...args) => {
        console.debug(`[${SCRIPT_NAME}]`, ...args);
    };
    const info = (...args) => {
        console.info(`[${SCRIPT_NAME}]`, ...args);
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
    const FEAT_PATTERN = /\s*\b(?:featuring|feat\.?|ft\.?|with)(?!\w)/i;
    // Contextual safeguard: Match standard feature terms anywhere, but 'with' only inside brackets or clear separations
    const STANDARD_FEAT_PATTERN = /\s*\(?\b(featuring|feat\.?|ft\.?)(?!\w)\s*([^)\]]+?)(?=\s+[-–—/]\s+|\s*[-–—/]\s+|$|[\)\]])\)?\]?/i;
    const BRACKETED_WITH_PATTERN = /\s*[\(\[]\b(with)\b\s*([^)\]]+?)[\)\]]/i;
    const ETI_PATTERN = /\s*(\[[^\]]+\]|\([^)]+\)|【[^】]+】)$/;
    const PARENS_CONTENT_PATTERN = /\(([^)]+)\)/g;
    const ETI_FEAT_PATTERN = /\s*\b(?:featuring|feat\.?|ft\.?|with)(?!\w)/i;
    const REMIX_KEYWORDS = ['remix', 'rework', 'edit', 'mix', 'flip', 'bootleg', 'mashup', 'vip', 'dub', 'version'];
    const IS_STANDALONE_RECORDING_PAGE = /[\/.]recording\/create|[\/.]recording\/[a-f0-9-]{36}\/edit/.test(window.location.pathname);

    log('User configuration loaded.');

    /**
     * @summary Cleans a string for comparison by lowercasing and stripping all whitespace.
     * @param {string} str - The string to clean.
     * @returns {string} The cleaned string.
     */
    function cleanStringForComparison(str) {
        if (!str) return '';
        return str.toLowerCase().replace(/\s+/g, '');
    }

    /**
     * @summary Checks if a string contains any remix-related keyword.
     * @param {string} str - The string to check.
     * @returns {boolean} True if a remix keyword is found.
     */
    function hasRemixKeyword(str) {
        if (!str) return false;
        return REMIX_KEYWORDS.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(str));
    }


    // ====================================================================================
    // --- Architectural Pre-Processing & Inference Tier
    // ====================================================================================

    /**
     * @summary Trims wrapping structural punctuation and spaces from token boundaries.
     * @param {string} str - The token string to clean.
     * @returns {string} The cleaned token.
     */
    function cleanTokenBoundaries(str) {
        if (!str) return '';
        // Fix: Trim at the very end to guarantee no trailing spaces remain after bracket replacement
        return str.trim().replace(/^[\.+(\[【]+|[\.+\)\]】]+$/g, '').trim();
    }

    /**
     * @summary Deeply parses a title string to unpack layout-dependent blocks before split evaluation.
     * @param {string} text - The raw input title.
     * @returns {{ core: string, featured: object[], etis: string[], joinPhrase: string|null }}
     */
    function parseTitleStructure(text, knownArtists) {
        if (!text) return { core: '', featured: [], etis: [], joinPhrase: null };

        let current = text.trim();
        const etis = [];
        let featured = [];
        let joinPhrase = null;

        // 1. Unroll trailing ETIs cleanly without catching embedded guest markers
        let match;
        while ((match = current.match(ETI_PATTERN))) {
            const fullBlock = match[1];
            const inside = fullBlock.slice(1, -1).trim();

            if (inside.match(ETI_FEAT_PATTERN)) {
                break;
            }
            etis.unshift(fullBlock);
            current = current.substring(0, current.lastIndexOf(fullBlock)).trim();
        }

        // 2. Isolate embedded feature patterns completely out of the core literal string
        const featMatch = current.match(STANDARD_FEAT_PATTERN) || current.match(BRACKETED_WITH_PATTERN);
        if (featMatch) {
            const fullFeatClause = featMatch[0];
            const joinWord = featMatch[1].toLowerCase();

            joinPhrase = joinWord.startsWith('feat') || joinWord.startsWith('ft') ? ' feat. '
                : joinWord.startsWith('with') ? ' with '
                    : ` ${joinWord} `;

            const guestStr = featMatch[2] ? featMatch[2].trim() : '';
            featured = parseArtistsAndJoins(guestStr, knownArtists);

            current = current.replace(fullFeatClause, '').replace(/\s+/g, ' ').trim();
        }

        return {
            core: current,
            featured,
            etis,
            joinPhrase
        };
    }

    /**
     * @summary Determines the index of the artist part using token matching and structural inference fallbacks.
     * @param {string[]} parts - The separated core title parts.
     * @param {string[]} pristineLower - Pristine artist names in lowercase.
     * @param {string[]} editorLower - Active editor artist names in lowercase.
     * @param {object} structure - The parsed title structure map from parseTitleStructure.
     * @param {string} rawText - The raw original string being evaluated (initialText or textToProcess).
     * @returns {number} The resolved index of the artist part, or -1 if unresolvable.
     */
    function resolveArtistPartIndex(parts, pristineLower, editorLower, structure, rawText) {
        let idx = findArtistPartIndex(parts, pristineLower, editorLower);
        if (idx !== -1) return idx;

        if (parts.length === 2 && structure.joinPhrase) {
            const joinPhraseStr = structure.joinPhrase.trim();
            const lowerRaw = rawText.toLowerCase();

            // 1. Check if it's a bracketed feature attached to a part: "Part (feat. Guest)"
            const bracketedTitleIdx = parts.findIndex(part =>
                lowerRaw.includes(part.toLowerCase() + ' (' + joinPhraseStr)
            );
            if (bracketedTitleIdx !== -1) {
                return bracketedTitleIdx === 0 ? 1 : 0;
            }

            // 2. Check if it's an unbracketed feature attached to a part: "Part feat. Guest"
            const unbracketedArtistIdx = parts.findIndex(part =>
                lowerRaw.includes(part.toLowerCase() + structure.joinPhrase.toLowerCase())
            );
            if (unbracketedArtistIdx !== -1) {
                return unbracketedArtistIdx;
            }
        }

        return -1;
    }


    // ====================================================================================
    // --- Core Logic & Helper Functions
    // ====================================================================================

    /**
     * @summary Programmatically resolves the relevant Knockout viewmodel based on context.
     * @param {HTMLButtonElement} [button] - The trigger button context.
     * @returns {object|null} The resolved Knockout model.
     */
    function resolveModelFromContext(button) {
        const trackRow = button?.closest?.('tr.track');
        if (window.ko && trackRow) {
            try {
                return window.ko.dataFor(trackRow);
            } catch (e) {
                warn('Error reading track viewmodel via ko.dataFor:', e);
            }
        }
        return window.MB?._releaseEditor?.rootField?.release?.()
            || window.MB?.releaseEditor?.rootField?.release?.()
            || window.MB?.getSourceEntityInstance?.();
    }

    /**
     * @summary Extracts artist names from DOM input fields when Knockout models are unavailable.
     * @param {HTMLButtonElement} [button] - The trigger button context.
     * @returns {string[]} Trimmed, lowercase artist names.
     */
    function getDOMFallbackArtistNames(button) {
        const trackRow = button?.closest?.('tr.track');
        if (trackRow) {
            const trackArtistInput = trackRow.querySelector('.artist .autocomplete2 input');
            if (trackArtistInput?.value) {
                log('Found artist from track row input:', trackArtistInput.value);
                return parseArtistNamesFromString(trackArtistInput.value);
            }
        }

        const artistCreditEditor = document.getElementById('artist-credit-editor');
        if (artistCreditEditor) {
            const nameInputs = artistCreditEditor.querySelectorAll('input[name*=".artist_credit.names."][name$=".name"]');
            const names = Array.from(nameInputs)
                .flatMap(input => parseArtistNamesFromString(input.value))
                .filter(Boolean);

            const uniqueNames = [...new Set(names)];
            if (uniqueNames.length > 0) {
                log('Found artist(s) from AC editor hidden inputs:', uniqueNames.join('; '));
                return uniqueNames;
            }

            const singleArtistInput = document.getElementById('ac-source-single-artist');
            if (singleArtistInput?.value) {
                log('Found artist from single artist input field:', singleArtistInput.value);
                return parseArtistNamesFromString(singleArtistInput.value);
            }
        }

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

        return [];
    }

    /**
     * @summary Retrieves the current artist names from the most reliable source available.
     * @param {HTMLButtonElement} [button] The button that triggered the action, used for context.
     * @returns {string[]} An array of artist names, trimmed and in lowercase.
     */
    function getCurrentArtistNames(button) {
        const model = resolveModelFromContext(button);
        if (model?.artistCredit) {
            try {
                const ac = model.artistCredit();
                if (ac?.names?.length > 0) {
                    const allNames = [];
                    ac.names.forEach(n => {
                        if (n.name) {
                            allNames.push(...parseArtistNamesFromString(n.name));
                        }
                        if (n.artist?.name) {
                            allNames.push(...parseArtistNamesFromString(n.artist.name));
                        }
                        if (n.artist?.sort_name) {
                            allNames.push(...parseArtistNamesFromString(n.artist.sort_name));
                        }
                    });
                    if (allNames.length > 0) {
                        const uniqueNames = [...new Set(allNames)];
                        log('Found artist(s) from resolved viewmodel:', uniqueNames.join('; '));
                        return uniqueNames;
                    }
                }
            } catch (e) {
                warn('Error reading artistCredit from resolved viewmodel:', e);
            }
        }

        const fallbackNames = getDOMFallbackArtistNames(button);
        if (fallbackNames.length > 0) {
            return fallbackNames;
        }

        warn('Could not determine current artists from any source. Falling back to regex-only title parsing.');
        return [];
    }


    function parseArtistNamesFromString(artistString) {
        if (!artistString) return [];
        return artistString.split(JOIN_PHRASE_PATTERN)
            .map(name => cleanTokenBoundaries(name).toLowerCase())
            .filter(Boolean);
    }

    /**
     * @summary Parses a string containing artist names and their join phrases into structured objects.
     * @param {string} artistPartString - The string part containing one or more artists.
     * @returns {{name: string, joinPhrase: string}[]} Array of parsed artist and join phrase objects.
     */
    function parseArtistsAndJoins(artistPartString, knownArtists) {
        if (!artistPartString) return [];

        if (knownArtists && knownArtists.length > 0) {
            const cleanPart = cleanStringForComparison(artistPartString);
            const isKnown = knownArtists.some(art => cleanStringForComparison(art) === cleanPart);
            if (isKnown) {
                return [{
                    name: cleanTokenBoundaries(artistPartString),
                    joinPhrase: ''
                }];
            }
        }

        const names = artistPartString.split(JOIN_PHRASE_PATTERN);
        const joins = artistPartString.match(JOIN_PHRASE_PATTERN) ?? [];
        return names.map((name, index) => ({
            name: cleanTokenBoundaries(name),
            joinPhrase: joins[index] ?? ''
        })).filter(item => item.name !== '');
    }

    /**
     * @summary Maps a parsed title artist to the corresponding existing editor artist credit node, preserving casing/MBID if matched.
     * @param {object} ta - The parsed title artist object.
     * @param {object[]} currentNames - Current artist credit objects in the editor viewmodel.
     * @returns {object} The merged/mapped artist credit node.
     */

    function mapParsedToCurrentArtist(ta, currentNames) {
        const cleanTA = cleanStringForComparison(ta.name);
        const match = currentNames.find(n => {
            const cleanN = cleanStringForComparison(n.name);
            // Fallback safely if the linked artist property is just an empty placeholder
            const cleanArtistName = n.artist?.name ? cleanStringForComparison(n.artist.name) : '';
            const cleanSortName = n.artist?.sort_name ? cleanStringForComparison(n.artist.sort_name) : '';
            return cleanN === cleanTA ||
                cleanArtistName === cleanTA ||
                cleanSortName === cleanTA ||
                parseArtistNamesFromString(n.name).map(x => cleanStringForComparison(x)).includes(cleanTA);
        });

        // Explicitly check if the match has a real entity database link (non-empty ID)
        const hasRealArtistEntity = match?.artist && (match.artist.id || match.artist.gid);
        const useExistingName = match && (
            cleanStringForComparison(match.name) === cleanTA ||
            parseArtistNamesFromString(match.name).length === 1
        );

        return {
            artist: hasRealArtistEntity ? match.artist : null,
            name: useExistingName ? match.name : ta.name,
            joinPhrase: ta.joinPhrase
        };
    }

    /**
     * @summary Merges parsed guest/featured artists from a title into the current artist credit viewmodel/hidden inputs.
     * @param {object[]} currentNames - Current artist credit objects in the editor viewmodel.
     * @param {{name: string, joinPhrase: string}[]} parsedTitleArtists - List of artists parsed from the title.
     * @param {string[]} seededArtists - List of original seeded/pristine artist names.
     * @returns {object[]} The updated/merged artist credit list.
     */
    function mergeArtistCredits(currentNames, parsedTitleArtists, seededArtists) {
        const seededIndividualNamesLower = [];
        const artistsToCheck = seededArtists || [];
        artistsToCheck.forEach(name => {
            const parsed = parseArtistNamesFromString(name);
            seededIndividualNamesLower.push(...parsed.map(n => cleanStringForComparison(n)));
        });

        const hasPartialMatch = parsedTitleArtists.some(ta =>
            seededIndividualNamesLower.includes(cleanStringForComparison(ta.name))
        );

        const containsPrimaryArtist = seededIndividualNamesLower && seededIndividualNamesLower.length > 0 && parsedTitleArtists.some(ta => {
            const cleanTA = cleanStringForComparison(ta.name);
            return cleanTA === seededIndividualNamesLower[0] || parseArtistNamesFromString(ta.name).map(n => cleanStringForComparison(n)).includes(seededIndividualNamesLower[0]);
        });

        if (hasPartialMatch && containsPrimaryArtist) {
            const updatedNames = parsedTitleArtists.map(ta => mapParsedToCurrentArtist(ta, currentNames));

            if (updatedNames.length > 0) {
                updatedNames[updatedNames.length - 1].joinPhrase = '';
            }
            return updatedNames;
        } else {
            const knownNamesLower = [];
            currentNames.forEach(n => {
                if (n.name) knownNamesLower.push(cleanStringForComparison(n.name));
                if (n.artist?.name) knownNamesLower.push(cleanStringForComparison(n.artist.name));
                if (n.artist?.sort_name) knownNamesLower.push(cleanStringForComparison(n.artist.sort_name));
            });
            const newTitleArtists = parsedTitleArtists.filter(ta => !knownNamesLower.includes(cleanStringForComparison(ta.name)));

            if (newTitleArtists.length === 0) {
                return currentNames;
            }

            const titleNamesLower = parsedTitleArtists.map(ta => cleanStringForComparison(ta.name));
            const seededNames = currentNames.filter(n => {
                const cleanN = n.name ? cleanStringForComparison(n.name) : '';
                const cleanArt = n.artist?.name ? cleanStringForComparison(n.artist.name) : '';
                const cleanSort = n.artist?.sort_name ? cleanStringForComparison(n.artist.sort_name) : '';
                return !titleNamesLower.includes(cleanN) &&
                    (!cleanArt || !titleNamesLower.includes(cleanArt)) &&
                    (!cleanSort || !titleNamesLower.includes(cleanSort));
            });

            const orderedTitleArtists = parsedTitleArtists.map(ta => mapParsedToCurrentArtist(ta, currentNames));

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
     * @summary Checks if a given artist is identified as a remixer in the track title.
     * @param {string} artistName - The name of the artist to check.
     * @param {string} title - The track title.
     * @returns {boolean} True if the artist is identified as a remixer.
     */
    function isArtistRemixerInTitle(artistName, title) {
        if (!artistName || !title) return false;
        const cleanName = cleanStringForComparison(artistName);
        const cleanTitle = title.toLowerCase();

        const parenthesizedMatches = cleanTitle.match(/\(([^)]+)\)|\[([^\]]+)\]|【([^】]+)】/g) ?? [];
        const hasRemixInParens = parenthesizedMatches.some(match => cleanStringForComparison(match).includes(cleanName) && hasRemixKeyword(match));
        if (hasRemixInParens) return true;

        const separatorPattern = /\s+[-–—/]\s+|\s+[-–—/]\s*|\s*[-–—/]\s+(?=.)/g;
        const parts = cleanTitle.split(separatorPattern).map(p => p.trim()).filter(Boolean);
        return parts.length > 1 && parts.some(part => cleanStringForComparison(part).includes(cleanName) && hasRemixKeyword(part));
    }

    /**
     * @summary Reconstructs and repairs standard join phrases for a list of artist credit nodes.
     * @param {object[]} names - The list of artist credit objects.
     * @returns {object[]} The repaired list of artist credit objects.
     */
    function repairStandardJoins(names) {
        if (!names || names.length === 0) return [];
        const isStandardJoin = (join) => !join || /^\s*(?:,|&|and|＆)\s*$/i.test(join);
        const lastIdx = names.length - 1;
        return names.map((node, i) => {
            if (i === lastIdx) {
                return { ...node, joinPhrase: '' };
            }
            if (isStandardJoin(node.joinPhrase)) {
                return { ...node, joinPhrase: (i === lastIdx - 1) ? ' & ' : ', ' };
            }
            return node;
        });
    }

    /**
     * @summary Removes detected remixers from a Knockout artist credit observable and normalizes standard join phrases.
     * @param {Function} acObservable - The Knockout observable function for the artist credit.
     * @param {string} title - The track title.
     */
    function removeRemixersFromAC(acObservable, title) {
        if (typeof acObservable !== 'function' || !title) return;
        const ac = acObservable();
        if (!ac?.names?.length) return;

        const filteredNames = ac.names.filter(n => {
            const isRemixer = isArtistRemixerInTitle(n.name, title);
            if (isRemixer) {
                log(`removeRemixersFromAC: Removing remixer "${n.name}" from artist credit based on title.`);
            }
            return !isRemixer;
        });

        if (filteredNames.length !== ac.names.length) {
            acObservable({ ...ac, names: repairStandardJoins(filteredNames) });
        }
    }


    /**
     * @summary Resolves the Knockout artist credit observable for the given context.
     * @param {HTMLElement|null} input - The input element (usually track name input).
     * @param {HTMLElement|null} button - The guess button element.
     * @returns {Function|null} The Knockout observable function for artistCredit, or null if not found.
     */
    function getACObservable(input, button) {
        const model = resolveModelFromContext(input || button);
        return model?.artistCredit || null;
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
            const descriptor = (window.HTMLTextAreaElement && Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value'))
                || (window.HTMLInputElement && Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'));
            if (descriptor?.set) {
                descriptor.set.call(element, value);
            } else {
                element.value = value;
            }
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }


    function findAssociatedInput(button) {
        const trackRow = button.closest('tr.track');
        if (trackRow) return trackRow.querySelector('input.track-name');

        const parentContainer = button.closest('.row, td');
        if (parentContainer) {
            const input = parentContainer.querySelector('input[type="text"]:not([class*="autocomplete"])');
            if (input) return input;
        }

        if (IS_STANDALONE_RECORDING_PAGE) {
            const standaloneInput = document.querySelector('input[name="edit-recording.name"]') || document.getElementById('id-edit-recording.name');
            if (standaloneInput) return standaloneInput;
        }

        const releaseInput = document.getElementById('name') || document.querySelector('input[name="name"]');
        if (releaseInput) return releaseInput;

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
            const isFeat = etiContent.match(ETI_FEAT_PATTERN);
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
            const potentialEti = match[1];
            const etiContent = potentialEti.slice(1, -1).trim();
            const hasSeparator = etiContent.match(/\s+(?:[-–—]|\/)\s+/);
            const isFeat = potentialEti.match(ETI_FEAT_PATTERN);

            if (hasSeparator && isFeat) {
                cleanTitle = cleanTitle.substring(0, cleanTitle.lastIndexOf(potentialEti)).trim() + ' ' + etiContent;
            } else if (isFeat) {
                break;
            } else {
                eti = potentialEti + (eti ? ' ' + eti : '');
                cleanTitle = cleanTitle.substring(0, cleanTitle.lastIndexOf(potentialEti)).trim();
            }
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
            const cleanPart = cleanStringForComparison(part);
            if (artistList.some(art => cleanStringForComparison(art) === cleanPart)) {
                return 1;
            }

            const artistsInPart = parseArtistNamesFromString(part);
            return artistsInPart.filter(name => {
                const cleanName = cleanStringForComparison(name);
                return artistList.some(art => cleanStringForComparison(art) === cleanName);
            }).length;
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
        const featMatch = cleanTitle.match(STANDARD_FEAT_PATTERN) || cleanTitle.match(BRACKETED_WITH_PATTERN);
        let titleGuests = [];
        let joinPhrase = null;

        if (featMatch) {
            const joinWord = (featMatch[1] || featMatch[2]).toLowerCase();
            joinPhrase = joinWord.startsWith('feat') || joinWord.startsWith('ft') ? ' feat. '
                : joinWord.startsWith('with') ? ' with '
                    : ` ${joinWord} `;
            const guestStr = featMatch[3] ? featMatch[3].trim() : '';
            titleGuests = parseArtistsAndJoins(guestStr);
            cleanTitle = cleanTitle.replace(featMatch[0], '').trim();
        }
        return { cleanTitle, titleGuests, joinPhrase };
    }

    function removeArtistFromTitle(input, button) {
        if (!input || !button) return;
        let initialText = pristineValues.get(input) || input.value;
        log('removeArtistFromTitle: Initial text:', initialText);

        initialText = flattenEtiMisguess(initialText);

        const acObservable = getACObservable(input, button);
        if (acObservable && typeof acObservable === 'function' && getBooleanCookie('guesscase_remove_remixers')) {
            removeRemixersFromAC(acObservable, initialText);
        }

        const pristineArtists = pristineArtistNames.get(input);
        const editorArtists = getCurrentArtistNames(button);
        const knownArtists = [...new Set([...(pristineArtists || []), ...editorArtists])];

        // Run structural pre-parsing
        const structure = parseTitleStructure(initialText, knownArtists);
        log('Parsed title structural map:', structure);

        // Split ONLY the clean, non-bracketed core string literal by hyphens
        const parts = structure.core.split(SEPARATOR_PATTERN).map(p => p.trim()).filter(Boolean);
        log('removeArtistFromTitle: Core split parts:', parts);

        if (parts.length > 1) {
            const pristineLower = (pristineArtists && pristineArtists.length > 0) ? pristineArtists.map(a => a.toLowerCase()) : [];
            const editorLower = editorArtists.map(a => a.toLowerCase());

            // Call the centralized index resolver
            let artistPartIndex = resolveArtistPartIndex(parts, pristineLower, editorLower, structure, initialText);
            log('removeArtistFromTitle: Resolved artist part index:', artistPartIndex);

            if (artistPartIndex !== -1) {
                const primaryArtist = pristineLower[0] || editorLower[0];
                if (primaryArtist) {
                    const artistPartLower = parts[artistPartIndex].toLowerCase();
                    const primaryNames = parseArtistNamesFromString(primaryArtist);
                    const isPrimaryInPart = primaryNames.some(name => cleanStringForComparison(artistPartLower).includes(cleanStringForComparison(name)));
                    if (!isPrimaryInPart && hasRemixKeyword(artistPartLower)) {
                        artistPartIndex = -1;
                    }
                }
            }

            if (artistPartIndex !== -1) {
                const artistPart = parts[artistPartIndex];
                let parsedTitleArtists = parseArtistsAndJoins(artistPart, knownArtists);

                // Reassemble core title from parts excluding artist
                const titleParts = parts.filter((_, index) => index !== artistPartIndex);
                let newCoreTitle = titleParts.join(' - ');

                if (structure.joinPhrase && parsedTitleArtists.length > 0) {
                    parsedTitleArtists[parsedTitleArtists.length - 1].joinPhrase = structure.joinPhrase;
                }

                parsedTitleArtists = [...parsedTitleArtists, ...structure.featured];

                if (acObservable && typeof acObservable === 'function') {
                    const currentAC = acObservable();
                    if (currentAC?.names) {
                        const seededArtists = pristineArtistNames.get(input) || getCurrentArtistNames(button);
                        const updatedNames = mergeArtistCredits(currentAC.names, parsedTitleArtists, seededArtists);
                        if (updatedNames !== currentAC.names) {
                            acObservable({ ...currentAC, names: updatedNames });
                            if (IS_STANDALONE_RECORDING_PAGE) {
                                syncAutocompleteInputs(acObservable().names);
                            }
                        }
                    }

                    // Reconstruct title using structural components
                    let finalTitle = newCoreTitle;
                    if (structure.etis.length > 0) {
                        finalTitle += ' ' + structure.etis.join(' ');
                    }
                    info(`Removed artist part from title: "${input.value}" -> "${finalTitle}"`);
                    setInputValue(input, finalTitle.trim());
                    pristineValues.set(input, input.value);
                }
            }
        }
    }


    /**
     * @summary Applies advanced rule sets like French/Swedish apostrophe corrections and acronym fixes.
     * @param {string} text - The current guessed text string.
     * @param {HTMLElement} [button] - The button element that was clicked to trigger the guess case.
     * @param {string} [originalTitle] - The original un-guessed title to preserve CamelCase.
     * @returns {string} The text processed by advanced rules.
     */
    function applyAdvancedRules(text, button, originalTitle) {
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

        const { cleanTitle: cleanTitleWithoutEtis, eti: extractedEtis } = extractTrailingEtis(newText);
        newText = cleanTitleWithoutEtis;

        if (extractedEtis) {
            log(`Found ETI(s): ${extractedEtis}`);
            log(`Text after ETI removal: "${newText}"`);
        } else {
            log('No ETI found.');
        }

        if (extractedEtis) {
            newText += ` ${extractedEtis}`;
            log(`Re-added ETI(s). Final text before ETI processing: "${newText}"`);
        }

        newText = newText.replace(/\[/g, '(').replace(/\]/g, ')');
        newText = newText.replace(PARENS_CONTENT_PATTERN, (match, etiContent) => {
            const processedEti = etiPhrasesToLowercase.reduce((acc, phrase) => {
                return acc.replace(createSafeRegex(phrase), matched => {
                    const isAllCaps = matched === matched.toUpperCase() && matched !== matched.toLowerCase();
                    return (keepUpperCase && isAllCaps) ? matched : phrase.toLowerCase();
                });
            }, etiContent);
            return `(${processedEti})`;
        });

        // Restore CamelCase words from originalTitle
        if (keepUpperCase && originalTitle && typeof originalTitle === 'string') {
            const matches = originalTitle.match(/\b[a-zA-Z\d]+\b/g) ?? [];
            const camelCaseWords = matches.filter(word => /[a-z]+[A-Z]/.test(word));
            newText = camelCaseWords.reduce((accText, camelWord) => {
                const regex = new RegExp(`\\b${camelWord}\\b`, 'i');
                return accText.replace(regex, camelWord);
            }, newText);
        }

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
    /**
     * @summary Deduplicates and cleans up duplicate artists in the Knockout artist credit observable.
     * @param {ko.Observable} acObservable - The entity.artistCredit ko.observable.
     * @returns {void}
     */
    function deduplicateACFromObservable(acObservable, titleFeaturedCount = 0) {
        if (typeof acObservable !== 'function') return;

        const ac = acObservable();
        if (!ac?.names?.length) return;

        const names = ac.names;
        const fmtAC = (arr) => arr.map(n => ({ name: n.name, join: n.joinPhrase, gid: n.artist?.gid ?? null }));
        log('deduplicateACFromObservable: names before dedup:', fmtAC(names));

        // Find the index of the first featured join phrase in the array
        const firstFeatJoinIdx = names.findIndex(n => FEAT_PATTERN.test(n.joinPhrase ?? ''));

        const getMatchKeys = (entry) => {
            const keys = new Set();
            const addNameKeys = (nameStr) => {
                if (!nameStr) return;
                keys.add(cleanStringForComparison(nameStr));
                if (nameStr.includes(',')) {
                    const parts = nameStr.split(',').map(p => p.trim());
                    if (parts.length === 2) {
                        keys.add(cleanStringForComparison(parts[0] + parts[1]));
                        keys.add(cleanStringForComparison(parts[1] + parts[0]));
                    }
                }
            };

            addNameKeys(entry.name);
            addNameKeys(entry.artist?.name);
            addNameKeys(entry.artist?.sort_name);
            if (entry.artist?.gid) keys.add(entry.artist.gid.toLowerCase());
            return [...keys];
        };

        // Determine if all featured artists match
        let allMatch = false;
        if (titleFeaturedCount > 0 && firstFeatJoinIdx !== -1) {
            const existingFeats = names.slice(firstFeatJoinIdx + 1, names.length - titleFeaturedCount);
            const newFeats = names.slice(names.length - titleFeaturedCount);
            allMatch = existingFeats.length === newFeats.length &&
                       newFeats.every(nf => {
                           const nfKeys = getMatchKeys(nf);
                           return existingFeats.some(ef => {
                               const efKeys = getMatchKeys(ef);
                               return efKeys.some(k => nfKeys.includes(k));
                           });
                       });
        }

        const seenEntries = []; // array of { index: number, keys: string[] }
        const survivorMap = new Map(); // dupIdx -> survivorIdx
        const toRemove = new Set();
        const dedupedNames = [...names];

        let featJoinPhrase = null;

        for (let i = 0; i < names.length; i++) {
            const keys = getMatchKeys(names[i]);
            if (keys.length === 0) continue;

            const duplicateMatch = seenEntries.find(seen =>
                seen.keys.some(k => keys.includes(k))
            );

            if (duplicateMatch) {
                const survivorIdx = duplicateMatch.index;
                survivorMap.set(i, survivorIdx);

                if (featJoinPhrase === null && i > 0) {
                    const prevPhrase = names[i - 1].joinPhrase ?? '';
                    if (FEAT_PATTERN.test(prevPhrase)) {
                        featJoinPhrase = prevPhrase;
                    }
                }

                const isSurvivorFeatured = firstFeatJoinIdx !== -1 && survivorIdx > firstFeatJoinIdx;
                const isDuplicateFeatured = firstFeatJoinIdx !== -1 && i > firstFeatJoinIdx;

                const keepDuplicate = (isDuplicateFeatured && !isSurvivorFeatured) ||
                                      (isDuplicateFeatured && isSurvivorFeatured && allMatch);

                if (keepDuplicate) {
                    const hasRealSurvivorArtist = dedupedNames[survivorIdx].artist && (dedupedNames[survivorIdx].artist.id || dedupedNames[survivorIdx].artist.gid);
                    
                    dedupedNames[i] = {
                        ...dedupedNames[i],
                        artist: hasRealSurvivorArtist ? dedupedNames[survivorIdx].artist : (dedupedNames[i].artist || dedupedNames[survivorIdx].artist)
                    };

                    toRemove.add(survivorIdx);
                    survivorMap.set(survivorIdx, i);

                    duplicateMatch.index = i;
                    keys.forEach(k => {
                        if (!duplicateMatch.keys.includes(k)) duplicateMatch.keys.push(k);
                    });
                } else {
                    const hasRealSurvivorArtist = dedupedNames[survivorIdx].artist && (dedupedNames[survivorIdx].artist.id || dedupedNames[survivorIdx].artist.gid);
                    const hasRealDuplicateArtist = names[i].artist && (names[i].artist.id || names[i].artist.gid);
                    if (!hasRealSurvivorArtist && hasRealDuplicateArtist) {
                        dedupedNames[survivorIdx] = {
                            ...dedupedNames[survivorIdx],
                            artist: names[i].artist
                        };
                        keys.forEach(k => {
                            if (!duplicateMatch.keys.includes(k)) duplicateMatch.keys.push(k);
                        });
                    }
                    dedupedNames[survivorIdx] = {
                        ...dedupedNames[survivorIdx],
                        name: names[i].name
                    };
                    toRemove.add(i);
                }
            } else {
                seenEntries.push({ index: i, keys });
            }
        }

        if (toRemove.size > 0) {
            log(`deduplicateACFromObservable: Removing ${toRemove.size} duplicate(s). Feat join phrase: "${featJoinPhrase}"`);

            // Propagate join phrases from duplicate entries to their survivors
            toRemove.forEach(dupIdx => {
                const survivorIdx = survivorMap.get(dupIdx);
                if (survivorIdx !== undefined) {
                    const isDupFeatured = firstFeatJoinIdx !== -1 && dupIdx > firstFeatJoinIdx;
                    const isSurvivorFeatured = firstFeatJoinIdx !== -1 && survivorIdx > firstFeatJoinIdx;

                    if (isDupFeatured === isSurvivorFeatured && survivorIdx < dupIdx) {
                        const dupJoin = names[dupIdx].joinPhrase ?? '';
                        const survivorJoin = names[survivorIdx].joinPhrase ?? '';

                        if (isSurvivorFeatured || !FEAT_PATTERN.test(survivorJoin)) {
                            dedupedNames[survivorIdx] = {
                                ...dedupedNames[survivorIdx],
                                joinPhrase: dupJoin
                            };
                        }
                    }
                }
            });
        } else {
            log('deduplicateACFromObservable: No duplicates found.');
        }

        const filteredNames = dedupedNames.filter((_, i) => !toRemove.has(i));

        // Repair the join phrase at the true feat boundary.
        if (featJoinPhrase !== null) {
            const firstFeatJoinIdxOrig = names.findIndex(n => FEAT_PATTERN.test(n.joinPhrase ?? ''));

            let firstFeatIdx = filteredNames.length;
            if (firstFeatJoinIdxOrig !== -1) {
                const firstFeatStartIdx = firstFeatJoinIdxOrig + 1;
                const featuredOriginalIndices = new Set(
                    Array.from({ length: names.length - firstFeatStartIdx }, (_, i) => firstFeatStartIdx + i)
                        .map(idx => {
                            if (toRemove.has(idx)) {
                                return survivorMap.get(idx);
                            }
                            return idx;
                        })
                        .filter(idx => idx !== undefined)
                );

                firstFeatIdx = Array.from(featuredOriginalIndices)
                    .filter(origIdx => !toRemove.has(origIdx))
                    .map(origIdx => {
                        return Array.from({ length: origIdx }, (_, i) => i)
                            .filter(i => !toRemove.has(i)).length;
                    })
                    .reduce((min, idx) => Math.min(min, idx), filteredNames.length);
            }

            const boundaryIdx = firstFeatIdx - 1;
            if (boundaryIdx >= 0 && boundaryIdx < filteredNames.length) {
                const current = filteredNames[boundaryIdx].joinPhrase ?? '';
                if (current !== featJoinPhrase) {
                    log(`Repairing join phrase at index ${boundaryIdx}: "${current}" → "${featJoinPhrase}"`);
                    filteredNames[boundaryIdx] = { ...filteredNames[boundaryIdx], joinPhrase: featJoinPhrase };
                }
            }
        }

        // Check if all featured join phrases are default ones (commas, ampersands, "and", feat, ft, or empty)
        let allFeaturedJoinsAreDefault = true;
        if (firstFeatJoinIdx !== -1) {
            for (let i = firstFeatJoinIdx + 1; i < filteredNames.length - 1; i++) {
                const join = (filteredNames[i].joinPhrase ?? '').trim().toLowerCase();
                const isDefault = join === '' || join === ',' || join === '&' || join === 'and' ||
                                  join === 'feat' || join === 'feat.' || join === 'ft' || join === 'ft.';
                if (!isDefault) {
                    allFeaturedJoinsAreDefault = false;
                    break;
                }
            }
        }

        // Apply default join phrase rules for empty join phrases and ensure the last entry is empty
        const lastIdx = filteredNames.length - 1;
        const repairedNames = filteredNames.map((node, i) => {
            if (i === lastIdx) {
                return { ...node, joinPhrase: '' };
            }
            let currentJoin = node.joinPhrase ?? '';

            if (firstFeatJoinIdx !== -1 && i > firstFeatJoinIdx) {
                if (allFeaturedJoinsAreDefault || FEAT_PATTERN.test(currentJoin)) {
                    currentJoin = '';
                }
            }

            const trimmedJoin = currentJoin.trim();
            if (!trimmedJoin) {
                return {
                    ...node,
                    joinPhrase: i === lastIdx - 1 ? ' & ' : ', '
                };
            }
            return { ...node, joinPhrase: currentJoin };
        });

        acObservable({ ...ac, names: repairedNames });
        log('deduplicateACFromObservable: Done.', fmtAC(repairedNames));
    }

    /**
     * @summary Propagates GIDs from track artist credits to release artist credits if release artist names have null GIDs.
     * @param {object} release - The Knockout release model.
     */
    function propagateGidsFromTracksToRelease(release) {
        if (!release || typeof release.artistCredit !== 'function') return;

        const releaseAC = release.artistCredit();
        if (!releaseAC?.names?.length) return;

        const mediums = release.mediums?.() ?? [];
        const trackNodesWithGids = mediums
            .flatMap(medium => medium.tracks?.() ?? [])
            .flatMap(track => track.artistCredit?.()?.names ?? [])
            .filter(nameNode => nameNode.artist?.gid && nameNode.name);

        const artistMap = new Map(
            trackNodesWithGids.map(node => [cleanStringForComparison(node.name), node.artist])
        );

        if (artistMap.size === 0) return;

        let modified = false;
        const updatedNames = releaseAC.names.map(nameNode => {
            if (!nameNode.artist && nameNode.name) {
                const key = cleanStringForComparison(nameNode.name);
                const matchedArtist = artistMap.get(key);
                if (matchedArtist) {
                    log(`Propagating GID for artist "${nameNode.name}" from tracks to release:`, matchedArtist.gid);
                    modified = true;
                    return {
                        ...nameNode,
                        artist: matchedArtist
                    };
                }
            }
            return nameNode;
        });

        if (modified) {
            release.artistCredit({
                ...releaseAC,
                names: updatedNames
            });
        }
    }

    /**
     * Returns the Knockout track model for a given tr.track DOM element.
     * Uses the element's id ("track-row-{uniqueID}") to match against
     * the MB._releaseEditor model tree.
     */
    function getTrackModel(trackRow) {
        const id = trackRow?.id;
        if (!id) return null;
        const release = window.MB?.releaseEditor?.rootField?.release?.();
        if (!release) return null;

        return (release.mediums?.() ?? [])
            .flatMap(medium => medium.tracks?.() ?? [])
            .find(track => track.elementID === id) ?? null;
    }


    function enhanceReleaseGuessFeat(button) {
        if (button.dataset.enhanced) return;
        log('Found Release/Recording "Guess Feat." button to enhance.', button);

        button.addEventListener('click', (event) => {
            const input = findAssociatedInput(button);
            if (!input) return;

            const originalTitle = input.value;
            const originalArtists = getCurrentArtistNames(button);

            pristineValues.set(input, originalTitle);
            pristineArtistNames.set(input, originalArtists);

            log(`'Guess Feat.' click detected for release/recording. Allowing native script to run first.`);

            setTimeout(() => {
                const release = window.MB?.releaseEditor?.rootField?.release?.();
                const source = window.MB?.getSourceEntityInstance?.();
                if (release?.artistCredit) {
                    try {
                        propagateGidsFromTracksToRelease(release);
                    } catch (e) {
                        err('Error propagating GIDs from tracks to release:', e);
                    }
                    log('Deduplicating release AC via Knockout model.');
                    deduplicateACFromObservable(release.artistCredit);
                    if (getBooleanCookie('guesscase_remove_remixers') && input) {
                        removeRemixersFromAC(release.artistCredit, input.value);
                    }
                } else if (source) {
                    cleanEntityModel({
                        model: source,
                        originalTitle,
                        originalArtists,
                        input
                    });
                }

                if (input) {
                    removeArtistFromTitle(input, button);
                    pristineValues.set(input, input.value);
                    pristineArtistNames.set(input, getCurrentArtistNames(button));
                    log(`Updated pristine value for ${input.name || input.id} after Guess Feat cleanup: "${input.value}"`);
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

        let activePreview = false;

        const handleMouseEnter = (event) => {
            if (event.buttons !== 0) return;

            const originalValue = pristineValues.get(input);
            activePreview = true;
            log(`Pristine value from map: "${originalValue}"`);

            setTimeout(() => {
                if (!activePreview) return;

                const nativePreviewValue = input.value;
                const enhancedPreviewValue = applyAdvancedRules(nativePreviewValue, button, originalValue);

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
            const originalValue = pristineValues.get(input);

            setTimeout(() => {
                const nativeValue = input.value;
                const enhancedValue = applyAdvancedRules(nativeValue, button, originalValue);
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
        if (!currentValue) return;

        log(`Tracking 'credited as' field for selection overwrite: "${currentValue}"`);

        let attempts = 0;
        const interval = setInterval(() => {
            if (creditedAsInput.value !== currentValue) {
                log(`Overwritten 'credited as' field detected. Restoring pristine value: "${currentValue}"`);
                setInputValue(creditedAsInput, currentValue);
                clearInterval(interval);
            }
            if (++attempts > 40) clearInterval(interval);
        }, 50);
    }

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

    /**
     * @summary Cleans a Knockout entity model (Track or Standalone Recording) after a Guess Feat action.
     * @param {object} model - The Knockout model (must have name and artistCredit observables).
     * @param {string} originalTitle - The original title before the action.
     * @param {string[]} originalArtists - The original artist names before the action.
     * @param {HTMLInputElement} [input] - The associated DOM input element for the title.
     * @param {object[]} [originalACNames] - Optional pre-native artist credit names list array.
     */
    function cleanEntityModel({ model, originalTitle, originalArtists, input, originalACNames }) {
        if (!model) return;
        log('Starting cleanEntityModel for model:', model);

        const titleVal = (input ? input.value : '') || (typeof model.name === 'function' ? model.name() : '') || '';
        let textToProcess = originalTitle || titleVal;

        const currentAC = model.artistCredit();
        const originalArtistsResolved = originalACNames ? originalACNames.map(n => n.name) : originalArtists;
        const knownArtists = [];
        if (originalArtistsResolved) knownArtists.push(...originalArtistsResolved);
        if (currentAC?.names) {
            currentAC.names.forEach(n => {
                if (n.name) knownArtists.push(n.name);
                if (n.artist?.name) knownArtists.push(n.artist.name);
                if (n.artist?.sort_name) knownArtists.push(n.artist.sort_name);
            });
        }
        const uniqueKnownArtists = [...new Set(knownArtists)];

        // Run structural pre-parsing
        const structure = parseTitleStructure(textToProcess, uniqueKnownArtists);

        deduplicateACFromObservable(model.artistCredit, structure.featured.length);

        if (getBooleanCookie('guesscase_remove_remixers')) {
            removeRemixersFromAC(model.artistCredit, textToProcess);
        }

        const parts = structure.core.split(SEPARATOR_PATTERN).map(p => p.trim()).filter(Boolean);

        if (parts.length > 1) {
            const currentAC = model.artistCredit();
            const originalArtistsResolved = originalACNames ? originalACNames.map(n => n.name) : originalArtists;
            const pristineLower = (originalArtistsResolved && originalArtistsResolved.length > 0) ? originalArtistsResolved.map(a => a.toLowerCase()) : [];
            const editorLower = (currentAC?.names ?? []).map(n => n.name.toLowerCase());

            // Call the exact same centralized index resolver
            let artistPartIndex = resolveArtistPartIndex(parts, pristineLower, editorLower, structure, textToProcess);
            log('cleanEntityModel: Resolved artist part index:', artistPartIndex);

            if (artistPartIndex !== -1) {
                const primaryArtist = pristineLower[0] || editorLower[0];
                if (primaryArtist) {
                    const artistPartLower = parts[artistPartIndex].toLowerCase();
                    const primaryNames = parseArtistNamesFromString(primaryArtist);
                    const isPrimaryInPart = primaryNames.some(name => cleanStringForComparison(artistPartLower).includes(cleanStringForComparison(name)));
                    if (!isPrimaryInPart && hasRemixKeyword(artistPartLower)) {
                        artistPartIndex = -1;
                    }
                }
            }

            if (artistPartIndex !== -1) {
                const artistPart = parts[artistPartIndex];
                let parsedTitleArtists = parseArtistsAndJoins(artistPart, uniqueKnownArtists);

                const titleParts = parts.filter((_, index) => index !== artistPartIndex);
                let newCoreTitle = titleParts.join(' - ');

                if (structure.joinPhrase && parsedTitleArtists.length > 0) {
                    parsedTitleArtists[parsedTitleArtists.length - 1].joinPhrase = structure.joinPhrase;
                }

                parsedTitleArtists = [...parsedTitleArtists, ...structure.featured];

                if (currentAC?.names) {
                    const updatedNames = mergeArtistCredits(currentAC.names, parsedTitleArtists, originalArtistsResolved);
                    if (updatedNames !== currentAC.names) {
                        model.artistCredit({ ...currentAC, names: updatedNames });
                    }
                    if (IS_STANDALONE_RECORDING_PAGE) {
                        syncAutocompleteInputs(model.artistCredit().names);
                    }
                }

                let finalTitle = newCoreTitle;
                if (structure.etis.length > 0) {
                    finalTitle += ' ' + structure.etis.join(' ');
                }
                info(`Removed artist part from title (model): "${titleVal}" -> "${finalTitle}"`);
                if (typeof model.name === 'function') {
                    model.name(finalTitle.trim());
                }
                if (input) {
                    setInputValue(input, finalTitle.trim());
                }
            } else {
                log('cleanEntityModel: Restoring original title.');
                if (typeof model.name === 'function') {
                    model.name(originalTitle);
                }
                if (input) {
                    setInputValue(input, originalTitle);
                }
            }
        }
    }

    function cleanTrackModelAfterGuessFeat(track, originalTitle, originalArtists, originalACNames) {
        cleanEntityModel({ model: track, originalTitle, originalArtists, originalACNames });
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
            const originalTitle = track.name.peek();
            originalGuessCaseTrackName.call(this, track, event);
            switch (event.type) {
                case 'mouseenter':
                    track.previewName(applyAdvancedRules(track.previewName.peek(), event.target, originalTitle));
                    break;
                case 'click':
                    track.name(applyAdvancedRules(track.name.peek(), event.target, originalTitle));
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
                const trackData = (release.mediums?.() ?? [])
                    .flatMap(medium => medium.tracks?.() ?? [])
                    .map(track => ({
                        track,
                        originalTitle: track.name(),
                        originalArtists: (track.artistCredit()?.names ?? []).map(n => n.name)
                    }));

                originalGuessReleaseFeatArtists.call(this, release, event);

                try {
                    propagateGidsFromTracksToRelease(release);
                    if (release.artistCredit) {
                        deduplicateACFromObservable(release.artistCredit);
                        const releaseTitleInput = document.getElementById('name') || document.querySelector('input[name="name"]');
                        if (getBooleanCookie('guesscase_remove_remixers') && releaseTitleInput) {
                            removeRemixersFromAC(release.artistCredit, releaseTitleInput.value);
                        }
                    }
                } catch (e) {
                    err('Error propagating GIDs and deduplicating release AC:', e);
                }

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
                const originalTitle = medium.name.peek();
                originalGuessCaseMediumName.call(this, medium, event);
                switch (event.type) {
                    case 'mouseenter':
                        if (medium.previewName) {
                            medium.previewName(applyAdvancedRules(medium.previewName.peek(), event.target, originalTitle));
                        }
                        break;
                    case 'click':
                        medium.name(applyAdvancedRules(medium.name.peek(), event.target, originalTitle));
                        break;
                    default:
                        if (event.type !== 'mouseleave') {
                            medium.name(applyAdvancedRules(medium.name.peek(), event.target, originalTitle));
                        }
                        break;
                }
            };
            releaseEditor.guessCaseMediumName.isEnhanced = true;
        }
    }

    const observer = new MutationObserver(() => {
        if (window.MB?._releaseEditor) enhanceReleaseEditorActions();

        document.querySelectorAll('.guesscase-title:not([data-enhanced])').forEach(button => {
            if (button.title === 'Guess case') {
                enhanceReactGuessCase(button);
            }
        });

        if (IS_STANDALONE_RECORDING_PAGE) {
            document.querySelectorAll('button.guessfeat:not([data-enhanced])').forEach(button => {
                enhanceReleaseGuessFeat(button);
            });
        }

        document.querySelectorAll('button[data-click="guessReleaseFeatArtists"]:not([data-enhanced])').forEach(button => {
            enhanceReleaseGuessFeat(button);
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();