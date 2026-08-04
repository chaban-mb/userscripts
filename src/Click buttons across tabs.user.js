// ==UserScript==
// @name         Click buttons across tabs
// @namespace    https://musicbrainz.org/user/chaban
// @version      4.10.5
// @tag          ai-created
// @description  Clicks specified buttons across tabs using the Broadcast Channel API and closes tabs after successful submission.
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/*
// @match        *://magicisrc.kepstin.ca/*
// @match        *://magicisrc-beta.kepstin.ca/*
// @match        *://isrchunt.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        window.close
// @grant        unsafeWindow
// @noframes
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/Click%20buttons%20across%20tabs.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/Click%20buttons%20across%20tabs.user.js
// ==/UserScript==

(async function () {
    'use strict';

    const scriptName = GM.info.script.name;
    const tabId = `[${Math.random().toString(36).substring(2, 6)}]`;
    console.debug(`[${scriptName}] ${tabId} Script initialization started on ${location.href}`);

    const SUBMISSION_TRIGGERED_FLAG = 'broadcastChannelSubmissionState';
    const REFERRER_CLOSE_TRIGGERED_FLAG = 'referrerCloseTriggeredState';
    const RELOAD_ATTEMPTS_KEY = 'magicisrc_reload_attempts';
    const RELOAD_LOCK_KEY = 'magicisrc-reload-lock';
    const MAGICISRC_SUBMIT_LOCK_KEY = 'magicisrc-submit-lock';
    const ISRC_HUNT_SUBMIT_LOCK_KEY = 'isrc-hunt-submit-lock';
    const MB_SUBMIT_COORDINATION_LOCK_KEY = 'mb-submit-coordination-lock';
    const DEBUG_LOG_CHANNEL_NAME = `${scriptName}_debug_log`;

    // --- Settings Keys ---
    const MUSICBRAINZ_SUBMITS_PER_SECOND_SETTING = 'mb_submits_per_second';
    const MUSICBRAINZ_DISABLE_RATE_LIMITER_SETTING = 'mb_disable_rate_limiter';
    const DISABLE_AUTO_CLOSE_SETTING = 'mb_button_clicker_disableAutoClose';
    const MB_ENABLE_MANUAL_MERGE_AUTOCLOSE = 'mb_enable_manual_merge_autoclose';
    const MAGICISRC_ENABLE_AUTO_RELOAD = 'magicisrc_enableAutoReload';
    const DEBUG_LOGGING_SETTING = 'debug_logging_enabled';
    const DEFAULT_MB_SUBMITS_PER_SECOND = 5;

    let registeredMenuCommandIDs = [];
    let debugLogChannel;
    let activeClosureObserver = null;
    let activeKeepAlives = [];
    let throttlingBypassTimer = null;

    const navEntry = performance.getEntriesByType('navigation')[0];
    if (navEntry && navEntry.type === 'reload') {
        sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
        console.debug(`[${scriptName}] ${tabId} Manual reload detected — cleared ${SUBMISSION_TRIGGERED_FLAG}`);
    } else {
        console.debug(`[${scriptName}] ${tabId} Navigation type "${navEntry?.type || 'navigate'}" — retaining session state`);
    }

    /**
     * @summary Discharges and closes active WebRTC loopback peer connections, restoring normal OS standby state.
     * @param {string} [reason='Manual discharge'] - Descriptive reason for discharging WebRTC peer connections.
     */
    function teardownThrottlingBypass(reason = 'Manual discharge') {
        if (throttlingBypassTimer) {
            clearTimeout(throttlingBypassTimer);
            throttlingBypassTimer = null;
        }
        if (activeKeepAlives.length > 0) {
            debugLog(`Discharging WebRTC throttling bypass [Reason: ${reason}].`, '#d97706');
            activeKeepAlives.forEach(pc => {
                try {
                    pc.close();
                } catch (e) {
                    console.error(`[${scriptName}] ${tabId} Failed closing RTCPeerConnection:`, e);
                }
            });
            activeKeepAlives = [];
        }
    }

    /**
     * @summary Acquires or refreshes WebRTC local loopback connections on demand to bypass Chrome Intensive Throttling.
     * Starts or resets a 30-second safety watchdog timer to automatically discharge connections if idle.
     * @param {number} [timeoutMs=30000] - Duration in milliseconds before auto-discharging if not refreshed.
     */
    async function acquireThrottlingBypass(timeoutMs = 30000) {
        if (throttlingBypassTimer) {
            clearTimeout(throttlingBypassTimer);
        }
        throttlingBypassTimer = setTimeout(() => {
            teardownThrottlingBypass('Safety watchdog timeout (30s inactivity)');
        }, timeoutMs);

        if (activeKeepAlives.length > 0) return;
        if (typeof RTCPeerConnection === 'undefined') {
            debugLog('WebRTC is undefined. Skipping throttling bypass.', 'orange');
            return;
        }
        debugLog('Acquiring WebRTC loopback on demand to bypass Intensive Throttling.', 'green');
        try {
            const pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection();
            pc1.createDataChannel("keep-alive");
            pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate);
            pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate);
            const offer = await pc1.createOffer();
            await pc1.setLocalDescription(offer);
            await pc2.setRemoteDescription(offer);
            const answer = await pc2.createAnswer();
            await pc2.setLocalDescription(answer);
            await pc1.setRemoteDescription(answer);
            activeKeepAlives = [pc1, pc2];
        } catch (e) {
            console.error(`[${scriptName}] ${tabId} Failed to initialize WebRTC throttling bypass:`, { href: location.href, error: e });
            teardownThrottlingBypass('Initialization failure');
        }
    }

    /**
     * @typedef {Object} SiteConfig
     * @property {string|string[]} hostnames - Hostnames where this configuration applies.
     * @property {string|string[]} paths - URL paths where this configuration is active.
     * @property {string} buttonSelector - The CSS selector for the button to be clicked or monitored.
     * @property {string} [channelName] - The BroadcastChannel name for cross-tab communication.
     * @property {string} [messageTrigger] - The message that triggers the action on the channel.
     * @property {string} [menuCommandName] - The name for the userscript menu command.
     * @property {(RegExp|string)[]} [successUrlPatterns] - URL patterns that indicate a successful submission.
     * @property {boolean} [shouldCloseAfterSuccess=false] - Whether to close the tab after a successful submission.
     * @property {boolean} [autoClick=false] - Whether to click the button automatically on page load.
     * @property {string} [requiredSetting] - A GM setting key that must be true for this rule to activate.
     * @property {() => boolean} [isNoOp] - A function that checks if the current page state represents a no-op submission.
     * @property {(config: SiteConfig, triggerAction: () => Promise<boolean>) => void} [submissionHandler] - Custom logic to execute when a submission is triggered.
     * @property {{hostnames: string[], paths: (string|RegExp)[]}} [referrerPatterns] - If present, this rule becomes a referrer-based closer.
     */

    /** @type {SiteConfig[]} */
    const siteConfigurations = [
        // Rule for closing tab after manual merge or edit submission.
        {
            hostnames: ['musicbrainz.org'],
            paths: ['/merge', '/edit', '/add-cover-art', '/add-event-art'],
            buttonSelector: 'button.submit.positive[type="submit"], button#enter-edit, button#add-cover-art-submit, button#add-event-art-submit',
            shouldCloseAfterSuccess: true,
            requiredSetting: MB_ENABLE_MANUAL_MERGE_AUTOCLOSE,
            referrerPatterns: {
                hostnames: ['musicbrainz.org'],
                paths: ['/merge', '/edit', '/add-cover-art', '/add-event-art'],
            },
        },
        // Rules for clicking buttons
        {
            hostnames: ['musicbrainz.org'],
            paths: ['/edit-relationships'],
            buttonSelector: '.rel-editor > button',
            autoClick: true,
            successUrlPatterns: [],
            shouldCloseAfterSuccess: false,
        },
        {
            hostnames: ['musicbrainz.org'],
            paths: ['/edit', '/edit-relationships', '/add-cover-art', '/add-event-art'],
            channelName: 'mb_edit_channel',
            messageTrigger: 'submit-edit',
            buttonSelector: 'button.submit.positive[type="submit"], button#enter-edit, button#add-cover-art-submit, button#add-event-art-submit',
            menuCommandName: 'MusicBrainz: Submit Edit (All Tabs)',
            successUrlPatterns: [/^https?:\/\/(?:beta\.)?musicbrainz\.org\/(?!collection\/)[^/]+\/[a-f0-9\-]{36}(?:\/(?:cover|event)-art)?\/?$/],
            shouldCloseAfterSuccess: true,
            isNoOp: () => {
                const noChangesBanner = document.querySelector('.banner.warning-header');
                return noChangesBanner?.textContent.includes(
                    'The data you have submitted does not make any changes to the data already present.'
                );
            },
            submissionHandler: (config, _ignoredTrigger) => {
                const isRelationshipEditor = location.pathname.endsWith('/edit-relationships');
                const isCoverArtPage = location.pathname.endsWith('/add-cover-art') || location.pathname.endsWith('/add-event-art');
                const hasSeedingHash = location.hash.includes('seed-urls-v1') || location.hash.includes('seed-');

                /**
                 * Detects if the current page was opened with seeded or injected parameters.
                 * @returns {boolean} True if page has URL parameters or hash indicating external seeding/injection.
                 */
                const hasSeededOrInjectedParams = () => {
                    if (hasSeedingHash) return true;
                    const search = location.search;
                    return search.includes('x_seed') || search.includes('seed') || search.includes('add-link') || search.includes('edit-artist.url');
                };

                /**
                 * Validates if the location.hash contains a parseable JSON seeding payload.
                 * @returns {boolean} True if hash is valid JSON or not present.
                 */
                const isValidSeedingHash = () => {
                    if (!hasSeedingHash) return true;
                    try {
                        const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
                        const urlParams = new URLSearchParams(hash);
                        const rawJson = urlParams.get('seed-urls-v1') || urlParams.get('seed');
                        if (rawJson) {
                            JSON.parse(rawJson);
                        }
                        return true;
                    } catch (e) {
                        debugLog('Malformed/truncated seeding JSON hash detected in URL.', 'red');
                        return false;
                    }
                };

                /**
                 * Inspects Relationship Editor state for newly added/edited relationships (_status > 0).
                 * @returns {number} Count of active pending relationship edits.
                 */
                function getPendingRelationshipEditsCount() {
                    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                    const editor = win.MB?.relationshipEditor;
                    const tree = win.MB?.tree;
                    const state = editor?.state;

                    if (!state || !tree) return 0;

                    const uniqueEditIds = new Set();
                    const visited = new Set();

                    function traverse(node) {
                        if (!node || typeof node !== 'object' || visited.has(node)) return;
                        visited.add(node);

                        // Check if current node is a relationship object
                        if ('linkTypeID' in node || '_status' in node || 'entity0' in node) {
                            const status = node._status ?? node.status ?? 0;
                            if (status > 0) {
                                uniqueEditIds.add(node);
                            }
                        }

                        // Iterate WBT tree nodes
                        if ('weight' in node || 'left' in node || 'right' in node) {
                            try {
                                for (const entry of tree.iterate(node)) {
                                    const val = Array.isArray(entry) ? entry[1] : entry;
                                    traverse(val);
                                }
                            } catch (e) {
                                console.debug(`[${scriptName}] WBT node traversal fallback:`, e);
                            }
                            return;
                        }

                        // Iterate Arrays
                        if (Array.isArray(node)) {
                            for (const item of node) traverse(item);
                            return;
                        }

                        // Recursively walk properties (skip circular _original references)
                        for (const key of Object.keys(node)) {
                            if (key === '_original') continue;
                            if (node[key] && typeof node[key] === 'object') {
                                traverse(node[key]);
                            }
                        }
                    }

                    if (state.relationshipsBySource) traverse(state.relationshipsBySource);

                    return uniqueEditIds.size;
                }

                /**
                 * Programmatically checks if the External Links Editor has pending edits.
                 * Hybrid approach: MB.releaseEditor.externalLinksData() programmatic state in Release Editor,
                 * DOM highlight class inspection (.rel-add, .rel-edit, .rel-remove) for standalone editors.
                 * @returns {boolean} True if any link or relationship is new, removed, or modified.
                 */
                const hasPendingExternalLinkEdits = () => {
                    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

                    // 1. Release Editor State
                    const relEdLinksData = win.MB?.releaseEditor?.externalLinksData;
                    if (relEdLinksData) {
                        try {
                            const links = typeof relEdLinksData === 'function' ? relEdLinksData() : relEdLinksData;
                            if (links && (links.size !== undefined || Array.isArray(links))) {
                                const iterateLinks = (linksTree) => {
                                    const result = [];
                                    if (win.MB?.tree?.iterate) {
                                        try {
                                            for (const link of win.MB.tree.iterate(linksTree)) {
                                                result.push(link);
                                            }
                                            return result;
                                        } catch (e) {
                                            console.debug(`[${scriptName}] Tree iterate fallback for external links:`, e);
                                        }
                                    }
                                    if (linksTree && typeof linksTree.values === 'function') {
                                        return Array.from(linksTree.values());
                                    }
                                    if (Array.isArray(linksTree)) return linksTree;
                                    return [];
                                };

                                const isRelationshipPending = (rel) => {
                                    if (!rel) return false;
                                    if (rel.originalState == null || rel.removed) return true;

                                    const orig = rel.originalState;
                                    return Object.keys(orig).some(key => {
                                        if (key === 'originalState' || key === 'removed') return false;
                                        return JSON.stringify(rel[key] ?? null) !== JSON.stringify(orig[key] ?? null);
                                    });
                                };

                                const linkList = iterateLinks(links);
                                for (const link of linkList) {
                                    const rels = Array.isArray(link.relationships) ? link.relationships : [];
                                    for (const rel of rels) {
                                        if (isRelationshipPending(rel)) return true;
                                    }
                                }
                                return false;
                            }
                        } catch (e) {
                            console.debug(`[${scriptName}] External links viewmodel check fallback:`, e);
                        }
                    }

                    // 2. DOM Highlight Fallback (Standalone Entity Editors)
                    const editor = document.getElementById('external-links-editor') ||
                                   document.querySelector('.external-links-editor-container');
                    if (!editor) return false;

                    const highlights = editor.querySelectorAll('.rel-add, .rel-edit, .rel-remove');
                    if (highlights.length > 0) return true;

                    const newInputs = Array.from(editor.querySelectorAll('input.value.with-button, tr.add-relationship input'))
                        .filter(input => input.value.trim() !== '');
                    if (newInputs.length > 0) return true;

                    return false;
                };

                const normalizeText = (str) => {
                    if (typeof str !== 'string') return str;
                    return str.replace(/\u00a0/g, ' ').trim();
                };

                /**
                 * Programmatically checks standard HTML form inputs (name, artist credit, ISRCs, dates, comment, edit_note) via FormData snapshots.
                 * @returns {boolean} True if any form data field differs from its initial page load snapshot.
                 */
                const getFormDataMap = (form) => {
                    const map = new Map();
                    try {
                        const formData = new FormData(form);
                        const removedKeys = new Set();

                        for (const [key, val] of formData.entries()) {
                            if (key.endsWith('.removed') && val === '1') {
                                removedKeys.add(key.slice(0, -8));
                            }
                        }

                        for (const [key, val] of formData.entries()) {
                            if (!key || key.includes('csrf') || key.includes('confirm') || key === 'tag' || key.includes('edit_note') || key.includes('edit-note')) continue;
                            if (key.endsWith('.removed')) continue;
                            if (removedKeys.has(key)) continue;

                            const cleanVal = normalizeText(val);
                            if (!cleanVal) continue;

                            // Group indexed keys e.g. "edit-recording.isrcs.3" -> "edit-recording.isrcs"
                            const groupKey = key.replace(/\.\d+$/, '');

                            if (!map.has(groupKey)) map.set(groupKey, []);
                            map.get(groupKey).push(cleanVal);
                        }

                        for (const arr of map.values()) {
                            arr.sort();
                        }
                    } catch (e) {}
                    return map;
                };

                const initialFormSnapshots = new Map();
                let hydrationCaptured = false;
                let hydrationListenerAdded = false;

                const getEditForms = () => {
                    return Array.from(document.forms).filter(form => {
                        const action = form.getAttribute('action') || '';
                        const className = form.className || '';
                        return className.includes('edit-') ||
                               action.includes('/edit') || action.includes('/add') || action.includes('/create') || action.includes('/merge') ||
                               form.closest('#release-editor, #relationship-editor, #external-links-editor') !== null;
                    });
                };

                const hasDirtyFormInputs = () => {
                    const editForms = getEditForms();
                    
                    if (!hydrationCaptured) {
                        editForms.forEach(form => {
                            if (!initialFormSnapshots.has(form)) {
                                initialFormSnapshots.set(form, getFormDataMap(form));
                            }
                        });
                    }

                    if (!hydrationListenerAdded) {
                        hydrationListenerAdded = true;

                        const refreshBaseline = () => {
                            setTimeout(() => {
                                const currentForms = getEditForms();
                                currentForms.forEach(form => {
                                    initialFormSnapshots.set(form, getFormDataMap(form));
                                });
                                hydrationCaptured = true;
                            }, 100);
                        };

                        if (document.readyState === 'complete') {
                            refreshBaseline();
                        } else {
                            window.addEventListener('load', refreshBaseline, { once: true });
                        }

                        document.addEventListener('mb-hydration', refreshBaseline);
                    }

                    for (const form of editForms) {
                        if (!initialFormSnapshots.has(form)) {
                            initialFormSnapshots.set(form, getFormDataMap(form));
                        }
                        const initialMap = initialFormSnapshots.get(form);
                        const currentMap = getFormDataMap(form);

                        const allKeys = new Set([...initialMap.keys(), ...currentMap.keys()]);
                        for (const key of allKeys) {
                            const origVals = initialMap.get(key) || [];
                            const currVals = currentMap.get(key) || [];

                            if (origVals.join(', ') !== currVals.join(', ')) {
                                return true;
                            }
                        }
                    }
                    return false;
                };

                /**
                 * Inspects Release Editor viewmodel for pending edits (MB.releaseEditor.allEdits()).
                 * @returns {number} Count of active pending edits in Release Editor.
                 */
                const getPendingReleaseEditorEditsCount = () => {
                    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                    const editor = win.MB?.releaseEditor;
                    if (editor?.allEdits) {
                        try {
                            const edits = editor.allEdits();
                            if (Array.isArray(edits)) return edits.length;
                        } catch (e) {}
                    }
                    return 0;
                };

                /**
                 * Determines total pending edits count for current page type.
                 * @returns {number} Count of pending edits (or >0 if edits exist).
                 */
                const getPendingEditsCount = () => {
                    let totalCount = 0;

                    const releaseEditorEdits = getPendingReleaseEditorEditsCount();
                    if (releaseEditorEdits > 0) {
                        totalCount += releaseEditorEdits;
                    }

                    if (isRelationshipEditor) {
                        totalCount += getPendingRelationshipEditsCount();
                    }

                    if (hasPendingExternalLinkEdits()) {
                        totalCount += 1;
                    }

                    if (hasDirtyFormInputs()) {
                        totalCount += 1;
                    }

                    if (totalCount > 0) return totalCount;

                    if (isCoverArtPage) {
                        return document.querySelector(config.buttonSelector) ? 1 : 0;
                    }

                    return 0;
                };

                /**
                 * Locates third-party seeding button specifically (e.g. rinsuki's script).
                 * @returns {HTMLButtonElement|null}
                 */
                const findSeedButton = () => {
                    return Array.from(document.querySelectorAll('button'))
                        .find(btn => btn.textContent.includes('Seed URLs to Recordings') || btn.textContent.includes('URLs seeded successfully')) || null;
                };

                const seedingStartTime = Date.now();
                const SEEDING_TIMEOUT_MS = 15000; // 15-second safety fallback timeout

                const waitForSeedingAndProceed = () => {
                    const validHash = isValidSeedingHash();
                    const isSeededOrInjected = hasSeededOrInjectedParams();

                    // If NOT seeding (or hash is invalid), evaluate general page state
                    if (!isRelationshipEditor || !hasSeedingHash || !validHash) {
                        const pendingEdits = getPendingEditsCount();

                        // Only auto-close as a pre-submission no-op if the tab has seeded/injected parameters!
                        if (pendingEdits === 0 && isSeededOrInjected) {
                            debugLog('No edits present (0 changes) on seeded/injected tab. Closing tab cleanly as a no-op...', 'orange');
                            const noOpState = JSON.stringify({
                                channel: config.channelName,
                                messageTrigger: config.messageTrigger,
                                isPreSubmissionNoOp: true,
                            });
                            sessionStorage.setItem(SUBMISSION_TRIGGERED_FLAG, noOpState);
                            evaluatePageForClosure();
                            return;
                        }

                        // If unseeded tab has 0 edits, do not submit or close; ignore trigger
                        if (pendingEdits === 0 && !isSeededOrInjected) {
                            debugLog('Unseeded tab has 0 edits. Skipping submit trigger to preserve tab for user...', 'orange');
                            sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
                            return;
                        }

                        waitForButtonAndClick(config, null, false).then(() => {
                            setTimeout(() => {
                                rateLimitedMBSubmit(async () => {
                                    const triggerState = JSON.stringify({
                                        channel: config.channelName,
                                        messageTrigger: config.messageTrigger
                                    });
                                    sessionStorage.setItem(SUBMISSION_TRIGGERED_FLAG, triggerState);
                                    await waitForButtonAndClick(config, null, true);
                                });
                            }, 0);
                        });
                        return;
                    }

                    const seedBtn = findSeedButton();

                    // Phase 1: If seed button is not in DOM yet, wait for it to be injected
                    if (!seedBtn) {
                        if (Date.now() - seedingStartTime > SEEDING_TIMEOUT_MS) {
                            debugLog('Timed out waiting for seed button injection (15s). Auditing state...', 'red');
                            evaluateSeedingResultAndSubmit();
                            return;
                        }
                        debugLog('Waiting for seed button to be injected into DOM...', 'orange');
                        setTimeout(waitForSeedingAndProceed, 200);
                        return;
                    }

                    // Phase 1b: Expand all collapsed mediums before seeding execution
                    const expandAllBtn = Array.from(document.querySelectorAll('button'))
                        .find(btn => btn.textContent.includes('Expand medium') || btn.textContent.includes('Expand all'));
                    if (expandAllBtn && !expandAllBtn.disabled && !expandAllBtn.dataset.importerExpanded) {
                        expandAllBtn.dataset.importerExpanded = 'true';
                        debugLog('Expanding collapsed mediums before seeding...', 'green');
                        expandAllBtn.click();
                    }

                    // Phase 2: If seed button exists, wait until it has been clicked and completed
                    const seedFinished = seedBtn.disabled || seedBtn.textContent.includes('URLs seeded successfully');

                    if (!seedFinished) {
                        if (Date.now() - seedingStartTime > SEEDING_TIMEOUT_MS) {
                            debugLog('Timed out waiting for seed execution (15s, possible seed script crash). Auditing state...', 'red');
                            evaluateSeedingResultAndSubmit();
                            return;
                        }
                        debugLog('Seed button found. Waiting for seeding execution to complete...', 'orange');
                        setTimeout(waitForSeedingAndProceed, 200);
                        return;
                    }

                    // Phase 3: Seeding finished.
                    evaluateSeedingResultAndSubmit();
                };

                const evaluateSeedingResultAndSubmit = () => {
                    const pendingEdits = getPendingEditsCount();

                    if (pendingEdits > 0) {
                        debugLog(`Seeding finished with ${pendingEdits} pending relationship edits. Proceeding to submit...`, 'green');
                        waitForButtonAndClick(config, null, false).then(() => {
                            setTimeout(() => {
                                rateLimitedMBSubmit(async () => {
                                    await waitForButtonAndClick(config, null, true);
                                });
                            }, 0);
                        });
                    } else {
                        debugLog('Seeding finished with 0 changes (No-Op). Closing tab cleanly without submitting...', 'orange');
                        const noOpState = JSON.stringify({
                            channel: config.channelName,
                            messageTrigger: config.messageTrigger,
                            isPreSubmissionNoOp: true,
                        });
                        sessionStorage.setItem(SUBMISSION_TRIGGERED_FLAG, noOpState);
                        evaluatePageForClosure();
                    }
                };

                waitForSeedingAndProceed();
            },
        },
        {
            hostnames: ['magicisrc.kepstin.ca', 'magicisrc-beta.kepstin.ca'],
            paths: ['/'],
            channelName: 'magicisrc_submit_channel',
            messageTrigger: 'submit-isrcs',
            buttonSelector: '[onclick^="doSubmitISRCs"]',
            menuCommandName: 'MagicISRC: Submit ISRCs (All Tabs)',
            successUrlPatterns: [/\?.*submit=1/],
            shouldCloseAfterSuccess: true,
            submissionHandler: (config, triggerAction) => {
                onDOMLoaded(() => {
                    const performCheck = (obs) => {
                        const cleanupAndExit = () => {
                            if (obs) obs.disconnect();
                            return true;
                        };

                        const submitButton = document.querySelector(config.buttonSelector);
                        const isrcForm = document.querySelector('form#check-isrcs');
                        const loginButton = document.querySelector('button[onclick^="doLogin();"]');
                        const logoutButton = document.querySelector('button[onclick^="doLogout();"]');

                        if (isSubmissionSuccessful(config, true)) {
                            evaluatePageForClosure();
                            return cleanupAndExit();
                        }
                        if (submitButton) {
                            debugLog('MagicISRC submit button found. Proceeding with submission.', 'green');
                            sessionStorage.removeItem(RELOAD_ATTEMPTS_KEY);
                            navigator.locks.request(MAGICISRC_SUBMIT_LOCK_KEY, async () => {
                                debugLog(`Acquired MagicISRC submit lock. Waiting 1s before submission.`, 'green');
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                triggerAction();
                            });
                            return cleanupAndExit();
                        }
                        if (isrcForm && logoutButton && !submitButton) {
                            const noOpState = JSON.stringify({
                                channel: config.channelName,
                                messageTrigger: config.messageTrigger,
                                isPreSubmissionNoOp: true,
                            });
                            sessionStorage.setItem(SUBMISSION_TRIGGERED_FLAG, noOpState);
                            evaluatePageForClosure();
                            return cleanupAndExit();
                        }
                        if (loginButton) {
                            debugLog('User is not logged into MagicISRC. Aborting submission on this tab.', 'orange');
                            sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
                            return cleanupAndExit();
                        }
                        return false;
                    };
                    if (performCheck(null)) return;
                    const observer = new MutationObserver(() => performCheck(observer));
                    observer.observe(document.body, { childList: true, subtree: true });
                });
            },
        },
        {
            hostnames: ['isrchunt.com'],
            paths: ['/spotify/importisrc', '/deezer/importisrc'],
            channelName: 'isrc_hunt_submit_channel',
            messageTrigger: 'submit-isrcs',
            buttonSelector: 'form[action$="/importisrc"][method="post"] button[type="submit"]',
            menuCommandName: 'ISRC Hunt: Submit ISRCs (All Tabs)',
            successUrlPatterns: [/\?.*submitted=1/],
            shouldCloseAfterSuccess: true,
            submissionHandler: (_config, triggerAction) => {
                debugLog(`Requesting ISRC Hunt submit lock...`);
                navigator.locks.request(ISRC_HUNT_SUBMIT_LOCK_KEY, async () => {
                    debugLog(`Acquired ISRC Hunt submit lock. Waiting 1s before submission.`, 'green');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    triggerAction();
                });
            },
        },
    ];

    /**
     * @summary Sends a log message to all tabs if debug logging is enabled.
     * @param {string} message The message to log.
     * @param {string} [color] Optional CSS color for the message.
     */
    async function debugLog(message, color = 'teal') {
        const debugEnabled = await GM.getValue(DEBUG_LOGGING_SETTING, false);
        if (!debugEnabled) return;

        if (!debugLogChannel) {
            debugLogChannel = new BroadcastChannel(DEBUG_LOG_CHANNEL_NAME);
        }

        debugLogChannel.postMessage({
            tabId,
            message,
            color,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * @summary Executes a callback when the DOM is ready, or immediately if it's already loaded.
     * @param {Function} callback The function to execute.
     */
    function onDOMLoaded(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    }

    /**
     * @summary Finds all site configurations that are active for the current page URL path.
     * @returns {SiteConfig[]} An array of active configurations.
     */
    function getActiveConfigs() {
        const currentHostname = location.hostname;
        const currentPathname = location.pathname;
        return siteConfigurations.filter(config => {
            const hostnames = Array.isArray(config.hostnames) ? config.hostnames : [config.hostnames];
            const paths = Array.isArray(config.paths) ? config.paths : [config.paths];
            const hostnameMatches = hostnames.some(h => currentHostname.includes(h));
            const pathMatches = paths.some(p => currentPathname.endsWith(p));
            return hostnameMatches && pathMatches;
        });
    }

    /**
     * @summary Waits for a button to appear and become enabled. Can optionally click it.
     * @param {SiteConfig} config - The configuration object for the button.
     * @param {Function} [onClick] - An optional callback to execute immediately after the click.
     * @param {boolean} [performClick=true] - If false, resolves once the button is ready WITHOUT clicking.
     * @returns {Promise<boolean>} Resolves to true if found/clicked.
     */
    async function waitForButtonAndClick(config, onClick, performClick = true) {
        return new Promise(resolve => {
            const checkAndAct = (obs) => {
                const btn = document.querySelector(config.buttonSelector);

                // Only proceed if button exists AND is enabled
                if (btn && !btn.disabled) {
                    if (performClick) {
                        debugLog(`Button "${config.buttonSelector}" ready. Clicking.`, 'green');
                        btn.click();
                        onClick?.(btn);
                    } else {
                        debugLog(`Button "${config.buttonSelector}" is ready (waiting mode complete).`, 'green');
                    }

                    if (obs) obs.disconnect();
                    resolve(true);
                    return true;
                }
                return false;
            };

            onDOMLoaded(() => {
                if (checkAndAct(null)) return;

                let rafId = null;
                const observer = new MutationObserver((mutations, obs) => {
                    // Throttle the heavy DOM check to once per frame
                    if (!rafId) {
                        rafId = requestAnimationFrame(() => {
                            rafId = null;
                            checkAndAct(obs);
                        });
                    }
                });

                // Optimized config: only watch relevant attributes instead of every single one
                const optimizedConfig = {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['disabled', 'class', 'style', 'value']
                };

                observer.observe(document.body, optimizedConfig);
            });
        });
    }

    /**
     * @summary Checks if the current URL matches a success pattern for a given configuration.
     * @param {SiteConfig} config - The site configuration.
     * @param {boolean} [quiet=false] - If true, suppresses console logs.
     * @returns {boolean} True if the URL matches a success pattern.
     */
    function isSubmissionSuccessful(config, quiet = false) {
        if (!config?.successUrlPatterns?.length) return false;
        const url = location.href;
        const isSuccess = config.successUrlPatterns.some(pattern =>
            (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url))
        );
        if (isSuccess && !quiet) {
            debugLog(`URL "${url}" matches success pattern.`);
        }
        return isSuccess;
    }

    /**
     * @summary Closes the tab after checking the user's auto-close preference.
     * @param {string} reason - The reason for closing, used in debug logs.
     */
    async function closeTab(reason) {
        teardownThrottlingBypass(`Tab closing: ${reason}`);
        const disableAutoClose = await GM.getValue(DISABLE_AUTO_CLOSE_SETTING, false);

        if (disableAutoClose) {
            debugLog(`Auto-closing is DISABLED by user setting. Reason: ${reason}`, 'orange');
            return;
        }

        debugLog(`Closing tab. Reason: ${reason}`, 'green');
        setTimeout(() => window.close(), 200);
    }

    /**
     * @summary Handles the reload logic for MagicISRC pages with exponential backoff and a Web Lock.
     * @param {boolean} [manual=false] - If true, bypasses the 'enableReload' check and forces the reload logic.
     */
    async function handleMagicISRCReload(manual = false) {
        const enableReload = await GM.getValue(MAGICISRC_ENABLE_AUTO_RELOAD, true);
        if (!enableReload && !manual) {
            debugLog(`MagicISRC automatic reload is DISABLED.`, 'orange');
            return;
        }

        debugLog(`An error occurred. Requesting reload lock...`, 'red');
        navigator.locks.request(RELOAD_LOCK_KEY, async () => {
            debugLog(`Acquired reload lock. This tab will handle the reload.`, 'red');
            let attempts = parseInt(sessionStorage.getItem(RELOAD_ATTEMPTS_KEY) || '0');
            attempts++;
            const backoffSeconds = Math.pow(2, Math.min(attempts, 6));
            const jitter = Math.random();
            const delay = (backoffSeconds + jitter) * 1000;
            debugLog(`MagicISRC error detected. Reload attempt ${attempts}. Retrying in ${Math.round(delay / 1000)}s.`, 'red');
            sessionStorage.setItem(RELOAD_ATTEMPTS_KEY, attempts.toString());
            await new Promise(resolve => setTimeout(resolve, delay));
            debugLog(`Performing full page reload to re-trigger logic.`, 'red');
            location.reload();
        });
    }

    /**
     * @summary Sets up a observer to watch for all errors on MagicISRC pages.
     */
    function setupMagicISRC() {
        if (!location.hostname.includes('magicisrc')) return;
        debugLog('Setting up MagicISRC error observer.');
        onDOMLoaded(() => {
            const checkAndHandleError = () => {
                const errorHeader = document.querySelector('#container h1');
                if (errorHeader?.textContent.includes('An error occured')) {
                    debugLog('MagicISRC error detected by observer. Triggering reload.', 'red');
                    handleMagicISRCReload();
                    return true;
                }
                return false;
            };
            if (checkAndHandleError()) return;
            const Observer = new MutationObserver(() => {
                if (checkAndHandleError()) Observer.disconnect();
            });
            Observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    /**
     * @summary Registers all userscript menu commands and settings toggles.
     */
    async function setupMenuCommands() {
        for (const commandId of registeredMenuCommandIDs) {
            try {
                GM_unregisterMenuCommand(commandId);
            } catch (e) { /* ignore */ }
        }
        registeredMenuCommandIDs = [];

        const registerCommand = (name, func) => {
            const id = GM_registerMenuCommand(name, func);
            registeredMenuCommandIDs.push(id);
        };

        const settings = [
            {
                key: DISABLE_AUTO_CLOSE_SETTING,
                getLabel: async (value) => `Auto Close Tabs: ${value ? 'DISABLED' : 'ENABLED'}`,
                onClick: async (currentValue) => GM.setValue(DISABLE_AUTO_CLOSE_SETTING, !currentValue),
                defaultValue: false,
            },
            {
                key: MB_ENABLE_MANUAL_MERGE_AUTOCLOSE,
                getLabel: async (value) => `Auto Close Manual Merges/Edits: ${value ? 'ENABLED' : 'DISABLED'}`,
                onClick: async (currentValue) => GM.setValue(MB_ENABLE_MANUAL_MERGE_AUTOCLOSE, !currentValue),
                defaultValue: true,
            },
            {
                key: MAGICISRC_ENABLE_AUTO_RELOAD,
                getLabel: async (value) => `MagicISRC Auto Reload: ${value ? 'ENABLED' : 'DISABLED'}`,
                onClick: async (currentValue) => GM.setValue(MAGICISRC_ENABLE_AUTO_RELOAD, !currentValue),
                defaultValue: true,
            },
            {
                key: DEBUG_LOGGING_SETTING,
                getLabel: async (value) => `Debug Logging: ${value ? 'ENABLED' : 'DISABLED'}`,
                onClick: async (currentValue) => GM.setValue(DEBUG_LOGGING_SETTING, !currentValue),
                defaultValue: false,
            },
            {
                key: MUSICBRAINZ_SUBMITS_PER_SECOND_SETTING,
                getLabel: async (value) => `MusicBrainz Edit Submits / sec (Current: ${value})`,
                onClick: async (currentValue) => {
                    const newValue = prompt(`Enter new max submissions per second for MusicBrainz:`, currentValue);
                    const newRate = parseFloat(newValue);
                    if (!isNaN(newRate) && newRate > 0) {
                        await GM.setValue(MUSICBRAINZ_SUBMITS_PER_SECOND_SETTING, newRate);
                    } else if (newValue !== null) {
                        alert('Please enter a valid positive number (you can use decimals like 0.5 for a 2-second delay).');
                    }
                },
                defaultValue: DEFAULT_MB_SUBMITS_PER_SECOND,
            },
            {
                key: MUSICBRAINZ_DISABLE_RATE_LIMITER_SETTING,
                getLabel: async (value) => `MusicBrainz Rate Limiter: ${value ? 'DISABLED' : 'ENABLED'}`,
                onClick: async (currentValue) => GM.setValue(MUSICBRAINZ_DISABLE_RATE_LIMITER_SETTING, !currentValue),
                defaultValue: false,
            },
        ];

        for (const setting of settings) {
            const value = await GM.getValue(setting.key, setting.defaultValue);
            registerCommand(await setting.getLabel(value), async () => {
                await setting.onClick(value);
                await setupMenuCommands();
            });
        }

        const activeConfigs = getActiveConfigs();
        const configsForMenu = activeConfigs.filter(c => !c.autoClick && c.menuCommandName);

        for (const config of configsForMenu) {
            registerCommand(config.menuCommandName, async () => {
                await acquireThrottlingBypass();
                const channel = new BroadcastChannel(config.channelName);
                channel.postMessage(config.messageTrigger);
                channel.close();
            });
        }

        debugLog(`Menu commands updated.`);
    }

    /**
     * @summary Executes a callback after ensuring the configured rate limit is not exceeded.
     * @param {Function} callback The function to execute.
     */
    async function rateLimitedMBSubmit(callback) {
        const limiterDisabled = await GM.getValue(MUSICBRAINZ_DISABLE_RATE_LIMITER_SETTING, false);
        const submitsPerSecond = await GM.getValue(MUSICBRAINZ_SUBMITS_PER_SECOND_SETTING, DEFAULT_MB_SUBMITS_PER_SECOND);
        const requiredInterval = 1000 / submitsPerSecond;

        await acquireThrottlingBypass();
        debugLog(`Requesting MB submission lock...`);
        navigator.locks.request(MB_SUBMIT_COORDINATION_LOCK_KEY, async () => {
            await acquireThrottlingBypass();
            debugLog(`Acquired MB submission lock.`, 'green');
            await callback();
            if (!limiterDisabled) {
                debugLog(`Holding lock for ${requiredInterval.toFixed(0)}ms to respect rate limit...`, 'orange');
                await new Promise(resolve => setTimeout(resolve, requiredInterval));
            } else {
                debugLog(`Rate limiter disabled. Releasing lock immediately.`, 'green');
            }
        });
    }

    /**
     * @summary Sets up listeners for specified configurations.
     * @param {SiteConfig[]} configs - An array of configuration objects.
     */
    async function setupConfigListeners(configs) {
        const pendingSubmissionJSON = sessionStorage.getItem(SUBMISSION_TRIGGERED_FLAG);
        if (pendingSubmissionJSON) {
            try {
                const state = JSON.parse(pendingSubmissionJSON);
                const pendingConfig = siteConfigurations.find(c => c.channelName === state.channel && c.messageTrigger === state.messageTrigger);

                if (pendingConfig && (isSubmissionSuccessful(pendingConfig, true))) {
                    debugLog(`Found pending submission flag on a success page. Letting success handler take over.`, 'purple');
                } else {
                    const activePendingConfig = configs.find(c => c.channelName === state.channel && c.messageTrigger === state.messageTrigger);
                    if (activePendingConfig && activePendingConfig.submissionHandler) {
                        debugLog(`Found pending submission flag on page load for "${activePendingConfig.menuCommandName}". Re-triggering handler.`, 'purple');
                        const triggerAction = () => waitForButtonAndClick(activePendingConfig);
                        activePendingConfig.submissionHandler(activePendingConfig, triggerAction);
                    }
                }
            } catch (e) {
                console.error(`[${scriptName}] ${tabId} Error parsing pending submission state:`, { key: SUBMISSION_TRIGGERED_FLAG, error: e });
                sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
            }
        }

        for (const config of configs) {
            const triggerAction = () => waitForButtonAndClick(config);

            if (config.referrerPatterns && config.buttonSelector) {
                if (config.requiredSetting) {
                    const isEnabled = await GM.getValue(config.requiredSetting, true);
                    if (!isEnabled) {
                        debugLog(`Referrer-close rule disabled by setting for ${config.paths}`, 'royalblue');
                        continue;
                    }
                }

                if (window.history.length === 1) {
                    debugLog(`Page is in a new tab (history length: 1). Setting up referrer-based close trigger for "${config.buttonSelector}".`, 'royalblue');
                    onDOMLoaded(() => {
                        const button = document.querySelector(config.buttonSelector);
                        if (button) {
                            button.addEventListener('click', () => {
                                debugLog(`Referrer-close button clicked. Setting session flag.`, 'purple');
                                const state = JSON.stringify(config.referrerPatterns);
                                sessionStorage.setItem(REFERRER_CLOSE_TRIGGERED_FLAG, state);
                            });
                        } else {
                            debugLog(`Failed to attach listener: button "${config.buttonSelector}" not found in DOM.`, 'red');
                        }
                    });
                } else {
                    debugLog(`Page is in an existing tab (history length: ${window.history.length}). Skipping referrer-based close trigger.`, 'olivedrab');
                }
                continue;
            }

            if (config.autoClick) {
                debugLog(`Setting up auto-click for "${config.buttonSelector}".`);
                triggerAction();
                continue;
            }

            if (config.channelName) {
                const channel = new BroadcastChannel(config.channelName);

                channel.onmessage = async (event) => {
                    if (event.data !== config.messageTrigger) return;

                    debugLog(`Received trigger "${event.data}".`);

                    if (config.submissionHandler) {
                        config.submissionHandler(config, triggerAction);
                    } else {
                        const triggerState = JSON.stringify({
                            channel: config.channelName,
                            messageTrigger: config.messageTrigger
                        });
                        sessionStorage.setItem(SUBMISSION_TRIGGERED_FLAG, triggerState);
                        await acquireThrottlingBypass();
                        triggerAction();
                    }
                };
            }
        }
    }

    /**
     * @summary Wraps a method on the history object to call a callback after it executes.
     * @param {'pushState'|'replaceState'} methodName The name of the history method to wrap.
     * @param {Function} callback The function to call after the original method.
     */
    function wrapHistoryMethod(methodName, callback) {
        const original = history[methodName];
        history[methodName] = function (...args) {
            original.apply(this, args);
            callback();
        };
    }

    /**
     * @summary Checks all conditions (referrer-based or submission-based) to determine if the tab should be closed.
     * Uses an active observer if a submission flag exists but conditions aren't met yet (hydration handling).
     */
    async function evaluatePageForClosure() {
        // --- 1. Check for Referrer-Based Close Condition ---
        const referrerFlag = sessionStorage.getItem(REFERRER_CLOSE_TRIGGERED_FLAG);
        if (document.referrer && referrerFlag) {
            if (document.referrer === window.location.href) {
                sessionStorage.removeItem(REFERRER_CLOSE_TRIGGERED_FLAG);
                return;
            }
            sessionStorage.removeItem(REFERRER_CLOSE_TRIGGERED_FLAG);
            try {
                const patterns = JSON.parse(referrerFlag);
                const referrerUrl = new URL(document.referrer);
                const hostMatches = patterns.hostnames.some(h => referrerUrl.hostname.includes(h));
                const pathMatches = patterns.paths.some(p => p instanceof RegExp ? p.test(referrerUrl.pathname) : referrerUrl.pathname.includes(p));

                if (hostMatches && pathMatches) {
                    await closeTab(`Referrer match from ${document.referrer}`);
                    return;
                }
            } catch (e) {
                console.error(`[${scriptName}] ${tabId} Error during referrer-close check:`, { referrer: document.referrer, error: e });
            }
        }

        // --- 2. Check for Submission-Based Close Condition ---
        const submissionFlag = sessionStorage.getItem(SUBMISSION_TRIGGERED_FLAG);
        if (!submissionFlag) return;

        let config = null;
        let state = null;
        try {
            state = JSON.parse(submissionFlag);
            config = siteConfigurations.find(c =>
                c.channelName === state.channel && c.messageTrigger === state.messageTrigger
            );
        } catch (e) {
            console.error(`[${scriptName}] ${tabId} Error parsing submission state:`, { flag: submissionFlag, error: e });
            sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
            return;
        }

        if (!config) return;

        // Cleanup any previous observer to prevent duplicates if history state changes rapidly
        if (activeClosureObserver) {
            activeClosureObserver.disconnect();
            activeClosureObserver = null;
        }

        const checkAndClose = async () => {
            const isSuccess = isSubmissionSuccessful(config, true);
            const isNoOp = config.isNoOp ? config.isNoOp() : false;

            if (state.isPreSubmissionNoOp || isSuccess || isNoOp) {
                if (activeClosureObserver) {
                    activeClosureObserver.disconnect();
                    activeClosureObserver = null;
                }
                sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
                const reason = isSuccess ? 'Submission successful' : 'Submission was a no-op';
                await closeTab(reason);
                return true;
            }
            return false;
        };

        if (await checkAndClose()) return;
        if (config.isNoOp) {
            debugLog('Submission flag present, but conditions not met yet. Observing for delayed UI updates...', 'olivedrab');
            activeClosureObserver = new MutationObserver(() => checkAndClose());
            activeClosureObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    async function main() {
        await setupMenuCommands();

        const debugEnabled = await GM.getValue(DEBUG_LOGGING_SETTING, false);
        if (debugEnabled) {
            const logReceiver = new BroadcastChannel(DEBUG_LOG_CHANNEL_NAME);
            logReceiver.onmessage = (event) => {
                const { tabId: msgTabId, message, color, timestamp } = event.data;
                console.log(`%c[${scriptName}] [${timestamp}] ${msgTabId} ${message}`, `color: ${color}`);
            };
        }

        const activeConfigs = getActiveConfigs();
        if (activeConfigs.length > 0) {
            await setupConfigListeners(activeConfigs);
        }

        setupMagicISRC();

        onDOMLoaded(evaluatePageForClosure);
        wrapHistoryMethod('pushState', evaluatePageForClosure);
        wrapHistoryMethod('replaceState', evaluatePageForClosure);
        window.addEventListener('popstate', evaluatePageForClosure);

        debugLog(`Initialization finished.`);
    }

    main();

})();
