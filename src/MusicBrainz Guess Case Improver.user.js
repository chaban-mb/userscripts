// ==UserScript==
// @name         MusicBrainz: Guess Case Improver
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.6.0
// @tag          ai-created
// @description  Improves the native "Guess Case" for release, recording and track titles with advanced artist and ETI parsing. Also removes duplicate artists after using "Guess feat. artists" on tracklists.
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
        log('--- applyAdvancedRules START ---');
        let newText = text;
        const keepUpperCase = getBooleanCookie('guesscase_keepuppercase');

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

        const separator = ' - ';
        const normalizedForSeparatorSearch = newText.replace(/\s+[-–]\s+/g, separator);
        const parts = normalizedForSeparatorSearch.split(separator);
        log(`Split text into parts:`, parts);

        if (parts.length > 1) {
            const artistsInEditor = getCurrentArtistNames(button);
            log(`Artists from editor:`, artistsInEditor);
            let artistPartIndex = -1;
            for (let i = 0; i < parts.length; i++) {
                const currentPart = parts[i];
                const partNameLower = currentPart.trim().toLowerCase();
                const artistsInPart = parseArtistNamesFromString(currentPart);
                log(`Checking part ${i} ("${currentPart}") -> artists:`, artistsInPart);

                // Check if the full unsplit part matches an artist (e.g. "Pete & Bas")
                const fullPartMatch = artistsInEditor.includes(partNameLower);
                const hasArtists = artistsInPart.length > 0 && artistsInEditor.length > 0;
                const allArtistsMatch = fullPartMatch || (hasArtists && artistsInPart.every(a => artistsInEditor.includes(a)));

                log(`Part ${i} match? ${allArtistsMatch}`);

                if (allArtistsMatch) {
                    artistPartIndex = i;
                    log(`Part ${i} is a match. Breaking loop.`);
                    break;
                }
            }
            if (artistPartIndex !== -1) {
                newText = parts.filter((_, index) => index !== artistPartIndex).join(separator);
                log(`Removed artist part. New text: "${newText}"`);
            } else {
                log('No artist part was found in title.');
            }
        }

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

        log('--- applyAdvancedRules END ---');
        return newText.trim();
    }

    async function deduplicateAC(openBubbleButton) {
        if (!openBubbleButton) return;

        const editor = new ArtistCreditsEditor();
        const bubbleOpened = await editor.open(openBubbleButton);

        if (bubbleOpened) {
            const artistRows = editor.getArtistRows();
            const seenArtists = new Map();
            const rowsToRemove = [];
            const joinPhraseUpdates = [];

            for (let i = 0; i < artistRows.length; i++) {
                const row = artistRows[i];
                const artistInput = row.querySelector('div.autocomplete2 input[type="text"]');
                if (artistInput) {
                    const artistName = artistInput.value.trim().toLowerCase();
                    if (artistName && seenArtists.has(artistName)) {
                        rowsToRemove.push(row);

                        const existingIdx = seenArtists.get(artistName);
                        const prevRow = artistRows[i - 1];
                        const prevJoinInput = prevRow?.querySelector('td:nth-child(3) input[type="text"]');
                        const customJoinPhrase = prevJoinInput ? prevJoinInput.value : '';

                        if (existingIdx > 0 && customJoinPhrase && customJoinPhrase.trim().match(/feat|ft|vs/i)) {
                            joinPhraseUpdates.push({
                                targetIdx: existingIdx - 1,
                                newPhrase: customJoinPhrase
                            });
                        }
                    } else if (artistName) {
                        seenArtists.set(artistName, i);
                    }
                }
            }

            for (const update of joinPhraseUpdates) {
                const targetRow = artistRows[update.targetIdx];
                const joinInput = targetRow?.querySelector('td:nth-child(3) input[type="text"]');
                if (joinInput) {
                    log(`Updating join phrase for row ${update.targetIdx} to "${update.newPhrase}"`);
                    setReactValue(joinInput, update.newPhrase);
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

    async function deduplicateTrackAC(trackRow) {
        const openBubbleButton = trackRow.querySelector('.artist .open-ac');
        await deduplicateAC(openBubbleButton);
        // Wait for React to completely unmount the bubble and flush track state
        // before the medium-loop sweeps to the very next track
        await new Promise(resolve => setTimeout(resolve, 300));
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

    function enhanceReleaseGuessFeat(button) {
        if (button.dataset.enhanced) return;
        log('Found Release/Recording "Guess Feat." button to enhance.', button);

        button.addEventListener('click', () => {
            log(`'Guess Feat.' click detected for release/recording. Allowing native script to run first.`);

            // Fix the pristine value state for the guesscase button
            const input = findAssociatedInput(button);
            if (input) {
                setTimeout(() => {
                    pristineValues.set(input, input.value);
                    log(`Updated pristine value for ${input.name || input.id} after Guess Feat click: "${input.value}"`);
                }, 100);
            }

            // Deduplicate the global artist credit editor by opening its bubble
            setTimeout(async () => {
                const openBubbleButton = document.querySelector('.release-artist .open-ac, #artist-credit-editor .open-ac');
                if (!openBubbleButton) {
                    log('No open-ac button found for release/recording AC editor.');
                    return;
                }
                await deduplicateAC(openBubbleButton);
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

        const updatePristineValue = () => {
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
                setReactValue(input, originalValue); // Use dispatch to notify React/Knockout
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

                setReactValue(input, enhancedValue); // Set the final value

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
                setReactValue(creditedAsInput, currentValue);
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
