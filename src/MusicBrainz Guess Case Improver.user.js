// ==UserScript==
// @name         MusicBrainz: Guess Case Improver
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.11.0
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

    info('Script loaded and running.');

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
    const BRACKETED_FEAT_PATTERN = /\s*[\(\[【]\s*\b(featuring|feat\.?|ft\.?)(?!\w)\s*([^()\[\]【】]+)[\)\]】]/i;
    const UNBRACKETED_FEAT_PATTERN = /(?:^|\s+|(?<=[\u3000-\u303f\u3040-\u30ff\u4e00-\u9fff\uff00-\uffef]))\b(featuring|feat\.?|ft\.?)(?!\w)\s*([^\s-–—/].*?)(?=\s+[-–—/]\s+|\s*[-–—/]\s+|$)/i;
    const BRACKETED_WITH_PATTERN = /\s*[\(\[]\b(with)\b\s*([^)\]]+?)[\)\]]/i;
    const ETI_PATTERN = /\s*(\[[^\]]+\]|\([^)]+\)|【[^】]+】)$/;
    const PARENS_CONTENT_PATTERN = /\(([^)]+)\)/g;
    const ETI_FEAT_PATTERN = /\s*\b(?:featuring|feat\.?|ft\.?|with)(?!\w)/i;
    const REMIX_KEYWORDS = ['remix', 'rework', 'edit', 'mix', 'flip', 'bootleg', 'mashup', 'vip', 'dub', 'version'];
    const IS_STANDALONE_RECORDING_PAGE = /[\/.]recording\/create|[\/.]recording\/[a-f0-9-]{36}\/edit/.test(window.location.pathname);



    /**
     * @summary Cleans a string for comparison by normalizing Unicode, removing diacritics,
     * normalizing punctuation variants, lowercasing, and stripping all whitespace & hyphens.
     * Used only for matching purposes — never mutates editor data.
     * @param {string} str - The string to clean.
     * @returns {string} The cleaned string.
     */
    function cleanStringForComparison(str) {
        if (!str) return '';
        return str
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')        // strip combining diacritics (e.g. à → a)
            .replace(/[\u2010-\u2015\u2212\-]/g, '') // normalize and strip hyphens/dashes
            .replace(/[\u2018\u2019\u201a\u201b\u02bc']/g, '') // strip apostrophes
            .replace(/\./g, '')                     // strip dots for comparison robustness
            .toLowerCase()
            .replace(/\s+/g, '');
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
        // Trim at the very end to guarantee no trailing spaces remain after bracket replacement
        return str.trim().replace(/^[+(\[【]+|[+\)\]】]+$/g, '').trim();
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
        let featMatch;
        while ((featMatch = current.match(BRACKETED_FEAT_PATTERN) || current.match(UNBRACKETED_FEAT_PATTERN) || current.match(BRACKETED_WITH_PATTERN))) {
            const fullFeatClause = featMatch[0];
            const rawWord = (featMatch[1] || '').trim().toLowerCase();

            if (!joinPhrase) {
                joinPhrase = rawWord ? ` ${rawWord} ` : ' feat. ';
            }

            const guestStr = featMatch[2] ? featMatch[2].trim() : '';
            const parsedGuests = parseArtistsAndJoins(guestStr, knownArtists);
            featured.push(...parsedGuests);

            current = current.replace(fullFeatClause, '').replace(/\s+/g, ' ').trim();
            // Bug 1 fix: strip any trailing orphaned opening bracket left when feat. was inside [...]
            current = current.replace(/\s*[(\[【]\s*$/, '').trim();
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
     * @param {string} rawText - The raw original string being evaluated.
     * @returns {number} The resolved index of the artist part, or -1 if unresolvable.
     */
    function resolveArtistPartIndex(parts, pristineLower, editorLower, structure, rawText, currentAC = null) {
        let idx = findArtistPartIndex(parts, pristineLower, editorLower);
        if (idx !== -1) {
            const artistPartLower = parts[idx].toLowerCase();
            if (hasRemixKeyword(artistPartLower)) {
                const isExactArtistMatch = pristineLower.some(a => cleanStringForComparison(artistPartLower) === cleanStringForComparison(a)) ||
                    editorLower.some(a => cleanStringForComparison(artistPartLower) === cleanStringForComparison(a));
                if (!isExactArtistMatch) {
                    idx = -1;
                }
            }
        }
        if (idx !== -1) return idx;

        // Fallback 1: If currentAC has no primary artist remaining (e.g. all seeded artists were removed as remixers,
        // or currentAC only contains the guest artist that native MB just appended), and title is 2-part "Artist - Title",
        // resolve parts[0] as the primary artist.
        if (parts.length === 2 && currentAC) {
            const featNames = structure.featured.map(f => cleanStringForComparison(f.name));
            const remainingNonFeatAC = currentAC.filter(n => {
                const cleanN = cleanStringForComparison(n.name);
                return !featNames.includes(cleanN) && !structure.featured.some(f => isPrefixWithSeparator(n.name, f.name));
            });
            if (remainingNonFeatAC.length === 0) {
                return 0;
            }
        }

        if (parts.length === 2 && structure.joinPhrase) {
            const joinPhraseStr = structure.joinPhrase.trim();

            const anyPartIsKnown = parts.some(part => {
                const cleanPart = cleanStringForComparison(part);
                return pristineLower.some(a => cleanStringForComparison(a) === cleanPart) ||
                    editorLower.some(a => cleanStringForComparison(a) === cleanPart);
            });
            const anyFeaturedArtistIsKnown = structure.featured.some(f => {
                const cleanFeat = cleanStringForComparison(f.name);
                return pristineLower.some(a => cleanStringForComparison(a) === cleanFeat);
            });
            if (!anyPartIsKnown && !anyFeaturedArtistIsKnown) return -1;

            const escapedPart0 = parts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedPart1 = parts[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const sepMatch = rawText.match(new RegExp(`${escapedPart0}\\s*([\\\/\\-–—])\\s*${escapedPart1}`, 'i'));
            const isSlashSeparator = sepMatch && sepMatch[1] === '/';

            if (!isSlashSeparator) {
                const lowerRaw = rawText.toLowerCase();
                const part0HasFeat = lowerRaw.includes(parts[0].toLowerCase() + ' (' + joinPhraseStr) ||
                    lowerRaw.includes(parts[0].toLowerCase() + structure.joinPhrase.toLowerCase());

                const part1HasFeat = lowerRaw.includes(parts[1].toLowerCase() + ' (' + joinPhraseStr) ||
                    lowerRaw.includes(parts[1].toLowerCase() + structure.joinPhrase.toLowerCase());

                if (part1HasFeat && !part0HasFeat) {
                    const part1IsKnown = pristineLower.some(a => cleanStringForComparison(a) === cleanStringForComparison(parts[1])) ||
                        editorLower.some(a => cleanStringForComparison(a) === cleanStringForComparison(parts[1]));
                    if (part1IsKnown) {
                        return 1;
                    }
                    return -1;
                }

                if (part0HasFeat) {
                    return -1;
                }
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

                return uniqueNames;
            }

            const singleArtistInput = document.getElementById('ac-source-single-artist');
            if (singleArtistInput?.value) {

                return parseArtistNamesFromString(singleArtistInput.value);
            }
        }

        try {
            const namesData = window?.__MB__?.$c?.stash?.artist_credit?.names ??
                window?.__MB__?.$c?.stash?.source_entity?.artistCredit?.names;

            if (namesData?.length > 0) {
                const names = namesData.flatMap(part => [
                    ...(parseArtistNamesFromString(part.name)),
                    ...(parseArtistNamesFromString(part.artist?.name)),
                    ...(parseArtistNamesFromString(part.artist?.sort_name))
                ]).filter(Boolean);

                const uniqueNames = [...new Set(names)];
                if (uniqueNames.length > 0) {
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

    /**
     * Checks if fullName starts with baseName followed by a title/remix separator (whitespace, hyphen, bracket, etc.).
     * Used to detect native guessFeat mis-parsed strings like "ひかり - Jafunk Remix".
     * @param {string} fullName
     * @param {string} baseName
     * @returns {boolean}
     */
    function isPrefixWithSeparator(fullName, baseName) {
        if (!fullName || !baseName) return false;
        const lowerFull = fullName.trim().toLowerCase();
        const lowerBase = baseName.trim().toLowerCase();
        if (lowerFull === lowerBase) return false;
        if (!lowerFull.startsWith(lowerBase)) return false;
        const rest = lowerFull.slice(lowerBase.length);
        return /^[\s\-_(\[\/]/.test(rest);
    }

    /**
     * @summary Maps a parsed artist credit object from a title to an existing credit in the editor viewmodel.
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
                parseArtistNamesFromString(n.name).map(x => cleanStringForComparison(x)).includes(cleanTA) ||
                isPrefixWithSeparator(n.name, ta.name) ||
                isPrefixWithSeparator(n.artist?.name, ta.name);
        });

        // Explicitly check if the match has a real entity database link (non-empty ID)
        const hasRealArtistEntity = match?.artist && (match.artist.id || match.artist.gid);
        const useExistingName = match && (
            cleanStringForComparison(match.name) === cleanTA ||
            parseArtistNamesFromString(match.name).length === 1
        ) && !isPrefixWithSeparator(match.name, ta.name);

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
                    (!cleanSort || !titleNamesLower.includes(cleanSort)) &&
                    !parsedTitleArtists.some(ta => isPrefixWithSeparator(n.name, ta.name) || isPrefixWithSeparator(n.artist?.name, ta.name));
            });

            const orderedTitleArtists = parsedTitleArtists.map(ta => mapParsedToCurrentArtist(ta, currentNames));

            const updatedSeeded = [...seededNames];
            if (updatedSeeded.length > 0) {
                const lastJoin = updatedSeeded[updatedSeeded.length - 1].joinPhrase ?? '';
                const titleHasFeatBoundary = orderedTitleArtists.some(ta => FEAT_PATTERN.test(ta.joinPhrase ?? ''));
                if (!FEAT_PATTERN.test(lastJoin) || titleHasFeatBoundary) {
                    updatedSeeded[updatedSeeded.length - 1] = {
                        ...updatedSeeded[updatedSeeded.length - 1],
                        joinPhrase: ' & '
                    };
                }
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
     * @summary Extracts candidate artist names from a remix-related phrase or block.
     * @param {string} phrase - The parenthesized or separated phrase.
     * @returns {string[]} Candidate remixer names.
     */
    function extractRemixerCandidates(phrase) {
        if (!phrase || !hasRemixKeyword(phrase)) return [];
        const stripped = phrase
            .replace(/\b(?:remixed?\s+by|reworked?\s+by)\b/gi, ' ')
            .replace(/['’]s\s+\b(?:remix|rework|edit|mix|flip|bootleg|mashup|vip|dub|version)\b/gi, ' ')
            .replace(/\b(?:remix(?:es)?|rework|edit|mix|flip|bootleg|mashup|vip|dub|version|club|extended|radio|original|vocal|instrumental|acoustic)\b/gi, ' ')
            .trim();

        if (!stripped) return [];
        const parsed = parseArtistNamesFromString(stripped);
        return [stripped, ...parsed];
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
        if (!cleanName) return false;

        const matchesRemixer = (c) => {
            const cc = cleanStringForComparison(c);
            return cc === cleanName || (cleanName.startsWith(cc) && hasRemixKeyword(artistName));
        };

        const parenthesizedMatches = title.match(/\(([^)]+)\)|\[([^\]]+)\]|【([^】]+)】/g) ?? [];
        for (const match of parenthesizedMatches) {
            const inside = match.slice(1, -1).trim();
            const candidates = extractRemixerCandidates(inside);
            if (candidates.some(matchesRemixer)) {
                return true;
            }
        }

        const separatorPattern = /\s+[-–—/]\s+|\s+[-–—/]\s*|\s*[-–—/]\s+(?=.)/g;
        const parts = title.split(separatorPattern).map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
            for (let i = 1; i < parts.length; i++) {
                const unbracketed = parts[i].replace(/\([^)]+\)|\[[^\]]+\]|【[^】]+】/g, '').trim();
                const candidates = extractRemixerCandidates(unbracketed);
                if (candidates.some(matchesRemixer)) {
                    return true;
                }
            }
        }

        return false;
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
     * @summary Pure function: Removes detected remixers from an artist credit array and normalizes standard join phrases.
     * @param {object[]} acNames - The array of artist credit node objects.
     * @param {string} title - The track title.
     * @returns {object[]} Filtered and repaired array of artist credit node objects.
     */
    function removeRemixersFromACList(acNames, title) {
        if (!acNames?.length || !title) return acNames || [];

        const firstFeatIdxOrig = acNames.findIndex(n => FEAT_PATTERN.test(n.joinPhrase ?? ''));
        const featJoinPhrase = firstFeatIdxOrig !== -1 ? (acNames[firstFeatIdxOrig].joinPhrase ?? ' feat. ') : null;

        const filteredNames = acNames.filter(n => {
            const isRemixer = isArtistRemixerInTitle(n.name, title);
            if (isRemixer) {
                log(`removeRemixersFromACList: Removing remixer "${n.name}" from artist credit based on title.`);
            }
            return !isRemixer;
        });

        if (filteredNames.length === acNames.length) {
            return acNames;
        }

        let repaired = repairStandardJoins(filteredNames);
        if (featJoinPhrase !== null && firstFeatIdxOrig !== -1) {
            const featuredNamesSet = new Set(acNames.slice(firstFeatIdxOrig + 1).map(n => n.name));
            const firstRemainingFeatIdx = repaired.findIndex(n => featuredNamesSet.has(n.name));
            if (firstRemainingFeatIdx > 0) {
                repaired[firstRemainingFeatIdx - 1] = {
                    ...repaired[firstRemainingFeatIdx - 1],
                    joinPhrase: featJoinPhrase
                };
            }
        }
        return repaired;
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

        const repaired = removeRemixersFromACList(ac.names, title);
        if (repaired !== ac.names) {
            acObservable({ ...ac, names: repaired });
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
            const singleArtistInput = document.getElementById('ac-source-single-artist');
            if (singleArtistInput && artistNodes.length === 1 && singleArtistInput.value !== artistNodes[0].name) {
                setInputValue(singleArtistInput, artistNodes[0].name);
            }
        }, 60);
    }



    function createSafeRegex(str) {
        const escapedStr = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escapedStr, 'i');
    }

    function getBooleanCookie(name) {
        if (typeof document === 'undefined' || !document.cookie) return false;
        const value = document.cookie.split(/;\s*/).find(row => row.startsWith(name + '='))?.split('=')[1]?.replace(/;$/, '');
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
     * @summary Applies advanced rule sets like French/Swedish apostrophe corrections and acronym fixes.
     * @param {string} text - The current guessed text string.
     * @param {HTMLElement} [button] - The button element that was clicked to trigger the guess case.
     * @param {string} [originalTitle] - The original un-guessed title to preserve CamelCase.
     * @returns {string} The text processed by advanced rules.
     */
    function applyAdvancedRules(text, button, originalTitle) {
        if (typeof text !== 'string') return text;

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
            newText += ` ${extractedEtis}`;
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
     * @summary Pure function that identifies duplicate artist credit nodes and merges their properties.
     * @param {object[]} names - List of artist credit nodes.
     * @param {number} [titleFeaturedCount=0] - Number of featured artists parsed from title.
     * @returns {{dedupedNames: object[], toRemove: Set<number>, survivorMap: Map<number, number>, firstFeatJoinIdx: number, featJoinPhrase: string|null}} Duplicate resolution map.
     */
    function findDuplicateACNodes(names, titleFeaturedCount = 0) {
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

        const seenEntries = [];
        const survivorMap = new Map();
        const toRemove = new Set();
        const dedupedNames = [...names];

        let featJoinPhrase = names.find(n => FEAT_PATTERN.test(n.joinPhrase ?? ''))?.joinPhrase ?? null;

        for (let i = 0; i < names.length; i++) {
            const keys = getMatchKeys(names[i]);
            if (keys.length === 0) continue;

            const duplicateMatch = seenEntries.find(seen => {
                if (seen.keys.some(k => keys.includes(k))) return true;
                if (!names[i].artist?.gid && !names[i].artist?.id) {
                    const entryName = names[i].name;
                    if (isPrefixWithSeparator(entryName, seen.name) || isPrefixWithSeparator(entryName, seen.artistName) ||
                        isPrefixWithSeparator(seen.name, entryName) || isPrefixWithSeparator(seen.artistName, entryName)) {
                        return true;
                    }
                } else if (seen.name && names[i].name) {
                    if (isPrefixWithSeparator(seen.name, names[i].name) || isPrefixWithSeparator(names[i].name, seen.name)) {
                        return true;
                    }
                }
                return false;
            });

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

                const isMisparsedSuffix = isPrefixWithSeparator(names[i].name, dedupedNames[survivorIdx].name) ||
                    isPrefixWithSeparator(names[i].name, dedupedNames[survivorIdx].artist?.name) ||
                    isPrefixWithSeparator(dedupedNames[survivorIdx].name, names[i].name) ||
                    isPrefixWithSeparator(dedupedNames[survivorIdx].artist?.name, names[i].name);
                const keepDuplicate = isDuplicateFeatured && !isMisparsedSuffix;

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
                    if (!isMisparsedSuffix) {
                        dedupedNames[survivorIdx] = {
                            ...dedupedNames[survivorIdx],
                            name: names[i].name
                        };
                    }
                    toRemove.add(i);
                }
            } else {
                seenEntries.push({
                    index: i,
                    keys,
                    name: names[i].name,
                    artistName: names[i].artist?.name ?? ''
                });
            }
        }

        if (toRemove.size > 0) {
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
        }

        return { dedupedNames, toRemove, survivorMap, firstFeatJoinIdx, featJoinPhrase };
    }

    /**
     * @summary Pure function that repairs join phrases at featured artist boundaries.
     * @param {object[]} filteredNames - Deduped artist credit nodes.
     * @param {object[]} names - Original artist credit nodes before dedup.
     * @param {Set<number>} toRemove - Indices of removed duplicate nodes.
     * @param {Map<number, number>} survivorMap - Map of removed node indices to survivor indices.
     * @param {string|null} featJoinPhrase - The original feat join phrase.
     * @param {number} firstFeatJoinIdx - Index of first featured join phrase in original array.
     * @returns {object[]} Array of artist credit nodes with repaired join phrases.
     */
    function repairFeatBoundary(filteredNames, names, toRemove, survivorMap, featJoinPhrase, firstFeatJoinIdx) {
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

        const primaryBoundaryIdx = filteredNames.findIndex(n => FEAT_PATTERN.test(n.joinPhrase ?? ''));
        const hasFeatures = primaryBoundaryIdx !== -1;
        const numPrimary = hasFeatures ? primaryBoundaryIdx + 1 : filteredNames.length;

        let allPrimaryJoinsAreDefault = true;
        for (let i = 0; i < numPrimary - 1; i++) {
            const join = (filteredNames[i].joinPhrase ?? '').trim().toLowerCase();
            const isDefault = join === ',' || join === '&';
            if (!isDefault) {
                allPrimaryJoinsAreDefault = false;
                break;
            }
        }

        let allFeaturedJoinsAreDefault = true;
        if (firstFeatJoinIdx !== -1) {
            for (let i = firstFeatJoinIdx + 1; i < filteredNames.length - 1; i++) {
                const join = (filteredNames[i].joinPhrase ?? '').trim().toLowerCase();
                const isDefault = join === ',' || join === '&' ||
                    join === 'feat' || join === 'feat.' || join === 'ft' || join === 'ft.';
                if (!isDefault) {
                    allFeaturedJoinsAreDefault = false;
                    break;
                }
            }
        }

        const lastIdx = filteredNames.length - 1;
        return filteredNames.map((node, i) => {
            if (i === lastIdx) {
                return { ...node, joinPhrase: '' };
            }
            let currentJoin = node.joinPhrase ?? '';

            if (allPrimaryJoinsAreDefault && i < numPrimary - 1) {
                currentJoin = i === numPrimary - 2 ? ' & ' : ', ';
            }

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
    }

    /**
     * @summary Pure function: Deduplicates and cleans up duplicate artists in an artist credit node array.
     * @param {object[]} acNames - Array of artist credit node objects.
     * @param {number} [titleFeaturedCount=0] - Number of featured artists parsed from title.
     * @returns {object[]} Deduplicated and repaired array of artist credit node objects.
     */
    function deduplicateACNamesList(acNames, titleFeaturedCount = 0) {
        if (!acNames?.length) return acNames || [];

        const { dedupedNames, toRemove, survivorMap, firstFeatJoinIdx, featJoinPhrase } = findDuplicateACNodes(acNames, titleFeaturedCount);

        if (toRemove.size > 0) {
            log(`deduplicateACNamesList: Removing ${toRemove.size} duplicate(s).`);
        }

        const filteredNames = dedupedNames.filter((_, i) => !toRemove.has(i));
        return repairFeatBoundary(filteredNames, acNames, toRemove, survivorMap, featJoinPhrase, firstFeatJoinIdx);
    }

    /**
     * @summary Deduplicates and cleans up duplicate artists in the Knockout artist credit observable.
     * @param {ko.Observable} acObservable - The entity.artistCredit ko.observable.
     * @param {number} [titleFeaturedCount=0] - Number of featured artists parsed from title.
     * @returns {void}
     */
    function deduplicateACFromObservable(acObservable, titleFeaturedCount = 0) {
        if (typeof acObservable !== 'function') return;

        const ac = acObservable();
        if (!ac?.names?.length) return;

        const repairedNames = deduplicateACNamesList(ac.names, titleFeaturedCount);
        acObservable({ ...ac, names: repairedNames });
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
        // Bug 7 fix: also index by canonical artist.name for cases where credit name differs
        // (e.g. credit "RPT MCK" but artist.name is "MCK")
        const artistMapByCanonicalName = new Map(
            trackNodesWithGids
                .filter(node => node.artist?.name && cleanStringForComparison(node.artist.name) !== cleanStringForComparison(node.name))
                .map(node => [cleanStringForComparison(node.artist.name), node.artist])
        );

        if (artistMap.size === 0) return;

        let modified = false;
        const updatedNames = releaseAC.names.map(nameNode => {
            if (!nameNode.artist && nameNode.name) {
                const key = cleanStringForComparison(nameNode.name);
                const matchedArtist = artistMap.get(key) ?? artistMapByCanonicalName.get(key);
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
     * @summary Syncs track artist credits to release artist credits if single-track or all tracks share identical credit and track credit is more detailed.
     * @param {object} release - The Knockout release model.
     * @param {object} [options] - Options object (e.g. removeRemixers).
     * @returns {boolean} True if release artist credit was modified.
     */
    function syncTrackCreditsToRelease(release, options = {}) {
        if (!release || typeof release.artistCredit !== 'function') return false;

        const releaseAC = release.artistCredit();
        if (!releaseAC?.names?.length) return false;

        const mediums = release.mediums?.() ?? [];
        const allTracks = mediums.flatMap(medium => medium.tracks?.() ?? []);
        if (allTracks.length === 0) return false;

        const getArtistSignature = (names) => {
            if (!Array.isArray(names) || names.length === 0) return null;
            return names.map(n => n.artist?.gid || cleanStringForComparison(n.name || '')).join('|');
        };

        const firstTrackAC = allTracks[0].artistCredit?.();
        const firstNames = firstTrackAC?.names ?? [];
        const firstSignature = getArtistSignature(firstNames);
        if (!firstSignature) return false;

        const allTracksHaveSameArtists = allTracks.every(t =>
            getArtistSignature(t.artistCredit?.()?.names ?? []) === firstSignature
        );
        if (!allTracksHaveSameArtists) return false;

        const releaseNames = releaseAC.names ?? [];
        if (firstNames.length <= releaseNames.length) return false;

        // Guardrail: Primary artist must match between track and release
        const trackPrimary = firstNames[0];
        const releasePrimary = releaseNames[0];
        const primaryGidMatches = trackPrimary?.artist?.gid && releasePrimary?.artist?.gid && trackPrimary.artist.gid === releasePrimary.artist.gid;
        const primaryNameMatches = cleanStringForComparison(trackPrimary?.name || '') === cleanStringForComparison(releasePrimary?.name || '') ||
            (trackPrimary?.artist?.name && cleanStringForComparison(trackPrimary.artist.name) === cleanStringForComparison(releasePrimary?.name || '')) ||
            (releasePrimary?.artist?.name && cleanStringForComparison(trackPrimary?.name || '') === cleanStringForComparison(releasePrimary.artist.name));

        if (!primaryGidMatches && !primaryNameMatches) return false;

        // Deduplicate & normalize join phrases on the candidate credit
        const clonedCandidateNames = firstNames.map(n => ({
            ...n,
            artist: n.artist ? { ...n.artist } : undefined
        }));

        const releaseTitleInput = (typeof document !== 'undefined')
            ? (document.getElementById('name') || document.querySelector('input[name="name"]'))
            : null;
        const releaseTitle = releaseTitleInput?.value || (typeof release.name === 'function' ? release.name() : (release.name || ''));
        const allTitleText = (allTracks.length === 1)
            ? [releaseTitle, ...allTracks.map(t => (typeof t.name === 'function' ? t.name() : ''))].join(' ')
            : releaseTitle;

        const { updatedACNames } = transformEntityTitleAndCredits({
            title: allTitleText,
            acNames: clonedCandidateNames,
            options: {
                removeRemixers: options.removeRemixers ?? getBooleanCookie('guesscase_remove_remixers')
            }
        });

        const finalNames = updatedACNames || clonedCandidateNames;
        if (finalNames.length > releaseNames.length || getArtistSignature(finalNames) !== getArtistSignature(releaseNames)) {
            log('Synced more detailed track artist credit to release artist credit:', finalNames.map(n => n.name).join(', '));
            release.artistCredit({
                ...releaseAC,
                names: finalNames
            });
            return true;
        }

        return false;
    }

    function enhanceReleaseGuessFeat(button) {
        if (button.dataset.enhanced) return;
        info('Enhancing Release/Recording "Guess Feat." button.');

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
                        syncTrackCreditsToRelease(release);
                    } catch (e) {
                        err('Error propagating GIDs and syncing track credits to release:', e);
                    }

                    const { updatedACNames } = transformEntityTitleAndCredits({
                        title: input?.value || '',
                        acNames: release.artistCredit().names,
                        options: {
                            removeRemixers: getBooleanCookie('guesscase_remove_remixers')
                        }
                    });
                    if (updatedACNames && updatedACNames !== release.artistCredit().names) {
                        release.artistCredit({ ...release.artistCredit(), names: updatedACNames });
                    }
                } else if (source) {
                    cleanEntityModel({
                        model: source,
                        originalTitle,
                        originalArtists,
                        input
                    });
                    if (input) {
                        pristineValues.set(input, input.value);
                        pristineArtistNames.set(input, getCurrentArtistNames(button));
                    }
                } else if (input) {
                    removeArtistFromTitle(input, button);
                    pristineValues.set(input, input.value);
                    pristineArtistNames.set(input, getCurrentArtistNames(button));
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
        info('Enhancing React-based "Guess Case" button.');

        const input = findAssociatedInput(button);
        if (!input) {
            warn('Could not find associated input for guess case button.', button);
            return;
        }

        if (!pristineValues.has(input)) {
            pristineValues.set(input, input.value);
        }

        const updatePristineValue = (event) => {
            if (event && !event.isTrusted) return;
            pristineValues.set(input, input.value);
        };

        input.addEventListener('focus', updatePristineValue);
        input.addEventListener('input', updatePristineValue);

        let activePreview = false;

        const handleMouseEnter = (event) => {
            if (event.buttons !== 0) return;

            const originalValue = pristineValues.get(input);
            activePreview = true;

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



        let attempts = 0;
        const interval = setInterval(() => {
            if (creditedAsInput.value !== currentValue) {
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
     * @summary Pure transformation function that parses title structure, extracts featured/part artists, merges artist credits, and reconstructs title.
     * @param {object} params - Options object.
     * @summary Pure transformation engine: transforms title and artist credit nodes in a 5-stage pipeline without side-effects.
     * @param {object} params
     * @param {string} params.title - The title to transform.
     * @param {object[]|null} [params.acNames=null] - Array of artist credit node objects.
     * @param {string[]} [params.knownArtists=[]] - Known artist names for boundary detection.
     * @param {string[]} [params.pristineArtists=[]] - Pristine artist names before edits.
     * @param {string[]} [params.editorArtists=[]] - Current editor artist names.
     * @param {object} [params.options={}] - Options object (e.g. { removeRemixers: boolean }).
     * @returns {{ finalTitle: string, updatedACNames: object[]|null, modified: boolean }}
     */
    function transformEntityTitleAndCredits({
        title,
        acNames = null,
        knownArtists = [],
        pristineArtists = [],
        editorArtists = [],
        options = {}
    }) {
        if (!title) return { finalTitle: title, updatedACNames: acNames, modified: false };

        const resolvedKnownArtists = [...new Set([...knownArtists, ...pristineArtists, ...editorArtists])];

        // --- Stage 1: Parse Title Structure (core, featured, etis, joinPhrase) ---
        const structure = parseTitleStructure(title, resolvedKnownArtists);
        const parts = structure.core.split(SEPARATOR_PATTERN).map(p => p.trim()).filter(Boolean);

        let currentAC = acNames ? acNames.map(n => ({ ...n })) : null;
        let finalTitle = title;
        let modified = false;

        // --- Stage 2: Remixer Removal on AC Array (if option enabled) ---
        if (currentAC?.length && options.removeRemixers) {
            currentAC = removeRemixersFromACList(currentAC, title);
        }

        // --- Stage 3: Artist Part Extraction & AC Merge ---
        if (parts.length > 1 || structure.featured.length > 0) {
            const pristineLower = pristineArtists.map(a => a.toLowerCase());
            const editorLower = editorArtists.map(a => a.toLowerCase());

            const artistPartIndex = parts.length > 1
                ? resolveArtistPartIndex(parts, pristineLower, editorLower, structure, title, currentAC)
                : -1;

            if (artistPartIndex !== -1) {
                const artistPart = parts[artistPartIndex];
                let parsedTitleArtists = parseArtistsAndJoins(artistPart, resolvedKnownArtists);
                const titleParts = parts.filter((_, index) => index !== artistPartIndex);
                const newCoreTitle = titleParts.join(' - ');

                if (structure.joinPhrase && parsedTitleArtists.length > 0) {
                    const last = parsedTitleArtists.length - 1;
                    parsedTitleArtists = parsedTitleArtists.map((a, i) =>
                        i === last ? { ...a, joinPhrase: structure.joinPhrase } : a
                    );
                }
                parsedTitleArtists = [...parsedTitleArtists, ...structure.featured];

                if (currentAC?.length) {
                    currentAC = mergeArtistCredits(currentAC, parsedTitleArtists, pristineArtists);
                } else {
                    currentAC = parsedTitleArtists.map(a => ({ ...a, artist: null }));
                }

                finalTitle = newCoreTitle;
                if (structure.etis.length > 0) {
                    finalTitle += ' ' + structure.etis.join(' ');
                }
                finalTitle = finalTitle.trim();
                modified = true;
            } else if (structure.featured.length > 0) {
                const featJoinPhrase = structure.joinPhrase || ' feat. ';
                const featNamesLower = structure.featured.map(f => cleanStringForComparison(f.name));

                if (currentAC?.length) {
                    const firstFeatIdxInAC = currentAC.findIndex(n =>
                        featNamesLower.includes(cleanStringForComparison(n.name))
                    );
                    const preppedACNames = currentAC.map((n, i) => {
                        if (firstFeatIdxInAC > 0 && i === firstFeatIdxInAC - 1) {
                            return { ...n, joinPhrase: featJoinPhrase };
                        } else if (firstFeatIdxInAC === -1 && i === currentAC.length - 1) {
                            return { ...n, joinPhrase: featJoinPhrase };
                        }
                        return n;
                    });
                    currentAC = mergeArtistCredits(preppedACNames, structure.featured, pristineArtists);
                } else {
                    currentAC = structure.featured.map(f => ({ ...f, artist: null }));
                }

                finalTitle = structure.core;
                if (structure.etis.length > 0) {
                    finalTitle += ' ' + structure.etis.join(' ');
                }
                finalTitle = finalTitle.trim();
                modified = true;
            }
        }

        // --- Stage 4: Pure AC Deduplication & Join Phrase Normalization ---
        if (currentAC?.length) {
            currentAC = deduplicateACNamesList(currentAC, structure.featured.length);
        }

        // --- Stage 5: Final Title Assembly ---
        if (finalTitle !== title || (currentAC && acNames && JSON.stringify(currentAC) !== JSON.stringify(acNames))) {
            modified = true;
        }

        return { finalTitle, updatedACNames: currentAC, modified };
    }

    /**
     * @summary Intercepts and cleans artist prefix/suffix and featured artists from an input element.
     * @param {HTMLElement} input - The input element.
     * @param {HTMLElement} button - The guess button.
     */
    function removeArtistFromTitle(input, button) {
        if (!input || !button) return;
        let initialText = pristineValues.get(input) || input.value;
        log('removeArtistFromTitle: Initial text:', initialText);

        initialText = flattenEtiMisguess(initialText);

        const acObservable = getACObservable(input, button);
        const pristineArtists = pristineArtistNames.get(input) || [];
        const editorArtists = getCurrentArtistNames(button);
        const currentAC = (acObservable && typeof acObservable === 'function') ? acObservable() : null;

        const { finalTitle, updatedACNames, modified } = transformEntityTitleAndCredits({
            title: initialText,
            acNames: currentAC?.names ?? null,
            knownArtists: [...new Set([...pristineArtists, ...editorArtists])],
            pristineArtists,
            editorArtists,
            options: {
                removeRemixers: getBooleanCookie('guesscase_remove_remixers')
            }
        });

        if (modified && finalTitle !== initialText) {
            if (acObservable && typeof acObservable === 'function' && updatedACNames && updatedACNames !== currentAC.names) {
                acObservable({ ...currentAC, names: updatedACNames });
                if (IS_STANDALONE_RECORDING_PAGE) {
                    syncAutocompleteInputs(acObservable().names);
                }
            }
            info(`Removed artist part from title: "${initialText}" -> "${finalTitle}"`);
            setInputValue(input, finalTitle);
            pristineValues.set(input, input.value);
        }
    }

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
        const textToProcess = originalTitle || titleVal;

        const currentAC = model.artistCredit?.();
        const originalArtistsResolved = originalACNames ? originalACNames.map(n => n.name) : (originalArtists || []);
        const knownArtists = [...originalArtistsResolved];
        if (currentAC?.names) {
            currentAC.names.forEach(n => {
                if (n.name) knownArtists.push(n.name);
                if (n.artist?.name) knownArtists.push(n.artist.name);
                if (n.artist?.sort_name) knownArtists.push(n.artist.sort_name);
            });
        }

        const editorArtists = [];
        (model.artistCredit?.()?.names ?? []).forEach(n => {
            if (n.name) editorArtists.push(n.name);
            if (n.artist?.name) editorArtists.push(n.artist.name);
            if (n.artist?.sort_name) editorArtists.push(n.artist.sort_name);
        });

        const { finalTitle, updatedACNames, modified } = transformEntityTitleAndCredits({
            title: textToProcess,
            acNames: model.artistCredit?.()?.names ?? null,
            knownArtists,
            pristineArtists: originalArtistsResolved,
            editorArtists,
            options: {
                removeRemixers: getBooleanCookie('guesscase_remove_remixers')
            }
        });

        if (typeof model.artistCredit === 'function' && updatedACNames && updatedACNames !== model.artistCredit()?.names) {
            model.artistCredit({ ...model.artistCredit(), names: updatedACNames });
            if (IS_STANDALONE_RECORDING_PAGE) {
                syncAutocompleteInputs(model.artistCredit().names);
            }
        }
        if (typeof model.name === 'function' && model.name() !== finalTitle) {
            model.name(finalTitle);
        }
        if (input && input.value !== finalTitle) {
            setInputValue(input, finalTitle);
        }
        if (modified && finalTitle !== textToProcess) {
            info(`Removed artist part from title (model): "${textToProcess}" -> "${finalTitle}"`);
        }
    }

    function cleanTrackModelAfterGuessFeat(track, originalTitle, originalArtists, originalACNames) {
        cleanEntityModel({ model: track, originalTitle, originalArtists, originalACNames });

        try {
            const release = track.medium?.release || (typeof MB !== 'undefined' && MB.releaseEditor?.rootField?.release?.());
            if (release) {
                propagateGidsFromTracksToRelease(release);
                syncTrackCreditsToRelease(release);
            }
        } catch (e) {
            err('Error syncing track credits to release in cleanTrackModelAfterGuessFeat:', e);
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
        info('Enhancing release editor viewmodel actions.');

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

                trackData.forEach(({ track, originalTitle, originalArtists }) => {
                    try {
                        cleanTrackModelAfterGuessFeat(track, originalTitle, originalArtists);
                    } catch (e) {
                        err('Error cleaning track model after guessReleaseFeatArtists:', e);
                    }
                });

                try {
                    propagateGidsFromTracksToRelease(release);
                    syncTrackCreditsToRelease(release);
                    if (release.artistCredit) {
                        const releaseTitleInput = document.getElementById('name') || document.querySelector('input[name="name"]');
                        const releaseTitle = releaseTitleInput?.value || (typeof release.name === 'function' ? release.name() : '');
                        const tracks = (release.mediums?.() ?? []).flatMap(medium => medium.tracks?.() ?? []);
                        const allTitleText = (tracks.length === 1)
                            ? [releaseTitle, ...tracks.map(t => (typeof t.name === 'function' ? t.name() : ''))].join(' ')
                            : releaseTitle;

                        const { updatedACNames } = transformEntityTitleAndCredits({
                            title: allTitleText,
                            acNames: release.artistCredit().names,
                            options: {
                                removeRemixers: getBooleanCookie('guesscase_remove_remixers')
                            }
                        });
                        if (updatedACNames && updatedACNames !== release.artistCredit().names) {
                            release.artistCredit({ ...release.artistCredit(), names: updatedACNames });
                        }
                    }
                } catch (e) {
                    err('Error propagating GIDs and transforming release AC:', e);
                }
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