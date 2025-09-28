// ==UserScript==
// @name         MusicBrainz: Guess Case Improver
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.2.0
// @tag          ai-created
// @description  Improves the native guess case with multi-word parsing and adds duplicate artist removal after using "Guess feat. artists".
// @author       chaban
// @license      MIT
// @match        https://*.musicbrainz.org/recording/create*
// @match        https://*.musicbrainz.org/recording/*/edit
// @match        https://*.musicbrainz.org/release/*/edit*
// @match        https://*.musicbrainz.org/release/add*
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        none
// ==/UserScript==

(function() {
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

    // ====================================================================================
    // --- ✨ USER CONFIGURATION ✨ ---
    // ====================================================================================

    const etiPhrasesToLowercase = [
        'official lyric video', 'official music video', 'backing track',
        'kinetic lyric video', 'animated', 'animation', 'official video',
        'official visualizer',
    ];

    const JOIN_PHRASE_PATTERN = /\s*(?:featuring|feat|ft|vs)\.?\s*|\s*(?:[,，、&・×/])\s*|\s+and\s+/gi;

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
            // The hidden inputs hold the definitive state of the AC
            const nameInputs = artistCreditEditor.querySelectorAll('input[name$=".artist.name"]');
            const names = Array.from(nameInputs)
                .map(input => input.value.trim().toLowerCase())
                .filter(Boolean);

            if (names.length > 0) {
                log('Found artist(s) from AC editor hidden inputs:', names.join('; '));
                return names;
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
                const names = namesData.map(part => part.name?.trim().toLowerCase()).filter(Boolean);
                if (names.length > 0) {
                    log('Found artist(s) from __MB__ stash:', names.join('; '));
                    return names;
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
            .map(name => name.trim().toLowerCase())
            .filter(Boolean);
    }

    function createSafeRegex(str) {
        const escapedStr = str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escapedStr, 'i');
    }

    function getBooleanCookie(name) {
        const value = document.cookie.split('; ').find(row => row.startsWith(name + '='))?.split('=')[1];
        return value === 'true';
    }

    function setReactValue(element, value) {
        if (!element || typeof value === 'undefined') return;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
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

    function applyAdvancedRules(text, button) {
        let newText = text;
        const keepUpperCase = getBooleanCookie('guesscase_keepuppercase');

        let trailingEti = '';
        const etiMatch = newText.match(/\s*(\[[^\]]+\]|\([^)]+\))$/);
        if (etiMatch) {
            trailingEti = etiMatch[1];
            newText = newText.substring(0, newText.lastIndexOf(trailingEti)).trim();
        }

        const separator = ' - ';
        const normalizedForSeparatorSearch = newText.replace(/\s*[-–]\s*/g, separator);
        const parts = normalizedForSeparatorSearch.split(separator);

        if (parts.length > 1) {
            const artistsInEditor = getCurrentArtistNames(button);
            let artistPartIndex = -1;
            for (let i = 0; i < parts.length; i++) {
                const artistsInPart = parseArtistNamesFromString(parts[i]);
                if (artistsInPart.length > 0 && artistsInEditor.length > 0 && artistsInPart.every(a => artistsInEditor.includes(a))) {
                    artistPartIndex = i;
                    break;
                }
            }
            if (artistPartIndex !== -1) {
                newText = parts.filter((_, index) => index !== artistPartIndex).join(separator);
            }
        }

        if (trailingEti) {
            newText += ` ${trailingEti}`;
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

        return newText.trim();
    }

    async function deduplicateTrackAC(trackRow) {
        const openBubbleButton = trackRow.querySelector('.artist .open-ac');
        if (!openBubbleButton) return;

        const editor = new ArtistCreditsEditor();
        const bubbleOpened = await editor.open(openBubbleButton);

        if (bubbleOpened) {
            const artistRows = editor.getArtistRows();
            const seenArtists = new Set();
            const rowsToRemove = [];

            for (const row of artistRows) {
                const artistInput = row.querySelector('div.autocomplete2 input[type="text"]');
                if (artistInput) {
                    const artistName = artistInput.value.trim().toLowerCase();
                    if (artistName && seenArtists.has(artistName)) {
                        rowsToRemove.push(row);
                    } else if (artistName) {
                        seenArtists.add(artistName);
                    }
                }
            }

            if (rowsToRemove.length > 0) {
                log(`Found ${rowsToRemove.length} duplicate artist row(s) to remove.`);
                for (const row of rowsToRemove) {
                    row.querySelector('.remove-artist-credit')?.click();
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            } else {
                log('No duplicate artists found in the editor.');
            }

            editor.close();
            log('De-duplication check complete.');
        } else {
            log('Failed to open AC bubble.');
        }
    }

    function enhanceGuessCase(button) {
        if (button.dataset.enhanced) return;
        log('Found "Guess Case" button to enhance.', button);
        const input = findAssociatedInput(button);
        if (!input) return;

        const runFullProcess = () => setReactValue(input, applyAdvancedRules(input.value, button));

        button.addEventListener('click', () => setTimeout(runFullProcess, 0), true);
        button.addEventListener('mouseenter', (event) => {
            if (event.buttons !== 0) return;
            setTimeout(() => {
                if (input.classList.contains('preview')) {
                    input.value = applyAdvancedRules(input.value, button);
                }
            }, 0);
        }, true);

        button.dataset.enhanced = 'true';
    }

    function enhanceTrackGuessFeat(button) {
        if (button.dataset.enhanced) return;
        log('Found track "Guess Feat." button to enhance.', button);
        const trackRow = button.closest('tr.track');
        if (!trackRow) return;

        button.addEventListener('click', () => {
            log(`'Guess Feat.' click detected for track. Allowing native script to run first.`);
            setTimeout(() => deduplicateTrackAC(trackRow), 100);
        }, true);

        button.dataset.enhanced = 'true';
    }

    function enhanceMediumGuessFeat(button) {
        if (button.dataset.enhanced) return;
        log('Found medium-wide "Guess Feat." button to enhance.', button);

        button.addEventListener('click', () => {
            log('Medium-wide "Guess Feat." clicked. Allowing native script to run first.');
            setTimeout(async () => {
                const medium = button.closest('fieldset.advanced-medium');
                if (!medium) return;

                log('Applying de-duplication to all tracks in this medium.');
                const tracks = medium.querySelectorAll('tr.track');
                for (const trackRow of tracks) {
                    await deduplicateTrackAC(trackRow);
                }
                log('De-duplication sweep complete for medium.');
            }, 100);
        }, true);

        button.dataset.enhanced = 'true';
    }

    // ====================================================================================
    // --- Initialization
    // ====================================================================================

    function enhanceAllButtons(node) {
        if (!node.querySelectorAll) return;
        node.querySelectorAll('button.guesscase-title').forEach(enhanceGuessCase);
        node.querySelectorAll('tr.track button.guessfeat').forEach(enhanceTrackGuessFeat);
        node.querySelectorAll('button[data-click="guessMediumFeatArtists"]').forEach(enhanceMediumGuessFeat);
    }

    log('Setting up MutationObserver.');
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    enhanceAllButtons(node);
                }
            });
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    enhanceAllButtons(document);

})();