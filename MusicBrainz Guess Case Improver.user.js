// ==UserScript==
// @name         MusicBrainz: Guess Case Improver
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.3.0
// @tag          ai-created
// @description  Improves the native "Guess Case" for release, recording and track titles with advanced artist and ETI parsing. Also removes duplicate artists after using "Guess feat. artists" on tracklists.
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
        'official visualizer', 'slowed' , 'super slowed', 'speed up', 'sped up'
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

    function enhanceReactGuessCase(button) {
        if (button.dataset.enhanced) return;
        log('Found React-based "Guess Case" button to enhance.', button);

        const input = findAssociatedInput(button);
        if (!input) {
            warn('Could not find associated input for guess case button.', button);
            return;
        }

        button.addEventListener('click', () => {
            log('"Guess Case" click detected. Allowing native script to run first.');
            // A click finalizes the action, so we must clear the preview state
            // immediately to prevent the subsequent mouseleave event from
            // reverting the change.
            originalValueForPreview = null;

            setTimeout(() => {
                const nativeValue = input.value;
                log(`Value after native guess case is: "${nativeValue}". Applying advanced rules.`);
                const enhancedValue = applyAdvancedRules(nativeValue, button);
                if (enhancedValue !== nativeValue) {
                    log(`Enhanced value is: "${enhancedValue}".`);
                    setReactValue(input, enhancedValue);
                }
            }, 0);
        });

        // --- Preview Logic ---
        let originalValueForPreview = null;

        button.addEventListener('mouseenter', (event) => {
            if (event.buttons !== 0) return;
            originalValueForPreview = input.value;

            setTimeout(() => {
                const nativePreviewValue = input.value;
                const enhancedPreviewValue = applyAdvancedRules(nativePreviewValue, button);

                if (enhancedPreviewValue !== originalValueForPreview) {
                    // There is a change, so we must show a preview.
                    input.classList.add('preview');
                    input.value = enhancedPreviewValue;
                } else {
                    // There is NO net change. Ensure no preview is shown.
                    // The native script might have added the class, so we must remove it.
                    input.classList.remove('preview');
                    // Ensure the value is reset, in case the native preview changed it.
                    input.value = originalValueForPreview;

                }
            }, 0);
        });

        button.addEventListener('mouseleave', () => {
            input.classList.remove('preview');
            // If originalValueForPreview is set, it means we have an active preview state.
            if (originalValueForPreview !== null) {
                // Always restore the original value and clean up the preview state.
                log('Hiding preview and restoring original value.');
                input.value = originalValueForPreview;
                input.classList.remove('preview');
                originalValueForPreview = null;

            }
        });

        button.dataset.enhanced = 'true';
    }

    // ====================================================================================
    // --- Initialization
    // ====================================================================================

    function enhanceLegacyGuessCase() {
        const releaseEditor = window.MB?._releaseEditor;
        if (!releaseEditor || releaseEditor.guessCaseTrackName.isEnhanced) return;
        log('Found release editor, enhancing legacy (track name) guess case.');

        const originalGuessCaseTrackName = releaseEditor.guessCaseTrackName;
        releaseEditor.guessCaseTrackName = function(track, event) {
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
    }

    const observer = new MutationObserver(() => {
        if (window.MB?._releaseEditor) enhanceLegacyGuessCase();
        document.querySelectorAll('.guesscase-title:not([data-enhanced])').forEach(button => !button.closest('table.tracklist') && enhanceReactGuessCase(button));
        document.querySelectorAll('button.guessfeat:not([data-enhanced])').forEach(button => (button.closest('tr.track') ? enhanceTrackGuessFeat(button) : (button.closest('fieldset.advanced-medium') && enhanceMediumGuessFeat(button))));
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();