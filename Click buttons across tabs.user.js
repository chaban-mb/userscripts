// ==UserScript==
// @name         Click buttons across tabs
// @namespace    https://musicbrainz.org/user/chaban
// @version      4.4.0
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
// ==/UserScript==

(async function () {
    'use strict';

    const scriptName = GM.info.script.name;
    const tabId = `[${Math.random().toString(36).substring(2, 6)}]`;
    console.log(`%c[${scriptName}] ${tabId} Script initialization started on ${location.href}`, 'font-weight: bold;');

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
     * @property {() => boolean} [isNoOp] - A function that checks if the current page state represents a no-op submission (e.g., a "no changes" banner).
     * @property {(config: SiteConfig, triggerAction: () => Promise<boolean>) => void} [submissionHandler] - Custom logic to execute when a submission is triggered.
     * @property {{hostnames: string[], paths: (string|RegExp)[]}} [referrerPatterns] - If present, this rule becomes a referrer-based closer. A click on `buttonSelector` on a matching page will set a flag. If the next page's referrer matches these patterns, it will be closed.
     */

    /** @type {SiteConfig[]} */
    const siteConfigurations = [
        // Rule to close tab after a manual merge submission.
        {
            hostnames: ['musicbrainz.org'],
            paths: ['/merge'],
            buttonSelector: 'button.submit.positive[type="submit"]',
            shouldCloseAfterSuccess: true,
            referrerPatterns: {
                hostnames: ['musicbrainz.org'],
                paths: ['/merge'],
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
            paths: ['/edit', '/edit-relationships', '/add-cover-art'],
            channelName: 'mb_edit_channel',
            messageTrigger: 'submit-edit',
            buttonSelector: 'button.submit.positive[type="submit"]',
            menuCommandName: 'MusicBrainz: Submit Edit (All Tabs)',
            successUrlPatterns: [/^https?:\/\/(?:beta\.)?musicbrainz\.org\/(?!collection\/)[^/]+\/[a-f0-9\-]{36}(?:\/cover-art)?\/?$/],
            shouldCloseAfterSuccess: true,
            isNoOp: () => {
                const noChangesBanner = document.querySelector('.banner.warning-header');
                return noChangesBanner?.textContent.includes(
                    'The data you have submitted does not make any changes to the data already present.'
                );
            },
            submissionHandler: (_config, triggerAction) => {
                rateLimitedMBSubmit(triggerAction);
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

    const SUBMISSION_TRIGGERED_FLAG = 'broadcastChannelSubmissionState';
    const REFERRER_CLOSE_TRIGGERED_FLAG = 'referrerCloseTriggeredState';
    const RELOAD_ATTEMPTS_KEY = 'magicisrc_reload_attempts';
    const RELOAD_LOCK_KEY = 'magicisrc-reload-lock';
    const MAGICISRC_SUBMIT_LOCK_KEY = 'magicisrc-submit-lock';
    const ISRC_HUNT_SUBMIT_LOCK_KEY = 'isrc-hunt-submit-lock';
    const MB_SUBMIT_COORDINATION_LOCK_KEY = 'mb-submit-coordination-lock';
    const MB_LAST_SUBMIT_TIMESTAMP_KEY = 'mb_last_submit_timestamp';
    const DEBUG_LOG_CHANNEL_NAME = `${scriptName}_debug_log`;
    const MUSICBRAINZ_SUBMITS_PER_SECOND_SETTING = 'mb_submits_per_second';
    const MUSICBRAINZ_DISABLE_RATE_LIMITER_SETTING = 'mb_disable_rate_limiter';
    const DISABLE_AUTO_CLOSE_SETTING = 'mb_button_clicker_disableAutoClose';
    const MAGICISRC_ENABLE_AUTO_RELOAD = 'magicisrc_enableAutoReload';
    const DEBUG_LOGGING_SETTING = 'debug_logging_enabled';

    let registeredMenuCommandIDs = [];
    let debugLogChannel;

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
     * @summary Waits for a button to appear and become enabled, then clicks it.
     * @param {SiteConfig} config - The configuration object for the button.
     * @param {Function} [onClick] - An optional callback to execute immediately after the click.
     * @returns {Promise<boolean>} Resolves to true if clicked, false otherwise.
     */
    async function waitForButtonAndClick(config, onClick) {
        return new Promise(resolve => {
            const checkAndClick = (obs) => {
                const btn = document.querySelector(config.buttonSelector);
                if (btn && !btn.disabled) {
                    debugLog(`Button "${config.buttonSelector}" found and enabled. Clicking.`, 'green');
                    btn.click();
                    onClick?.(btn);
                    if (obs) obs.disconnect();
                    resolve(true);
                    return true;
                }
                return false;
            };

            onDOMLoaded(() => {
                if (checkAndClick(null)) return;
                const observer = new MutationObserver((_, obs) => checkAndClick(obs));
                observer.observe(document.body, { childList: true, subtree: true, attributes: true });
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
                if (checkAndHandleError()) {
                    Observer.disconnect();
                }
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
                    const newRate = parseInt(newValue, 10);
                    if (!isNaN(newRate) && newRate > 0) {
                        await GM.setValue(MUSICBRAINZ_SUBMITS_PER_SECOND_SETTING, newRate);
                    } else if (newValue !== null) {
                        alert('Please enter a valid positive number.');
                    }
                },
                defaultValue: 10,
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
            registerCommand(config.menuCommandName, () => {
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
        if (limiterDisabled) {
            debugLog('MusicBrainz rate limiter is disabled. Submitting immediately.', 'orange');
            callback();
            return;
        }

        const submitsPerSecond = await GM.getValue(MUSICBRAINZ_SUBMITS_PER_SECOND_SETTING, 10);
        const requiredInterval = 1000 / submitsPerSecond;

        debugLog(`Requesting MB submission lock...`);
        navigator.locks.request(MB_SUBMIT_COORDINATION_LOCK_KEY, async () => {
            debugLog(`Acquired MB submission lock.`, 'green');
            const lastSubmit = await GM.getValue(MB_LAST_SUBMIT_TIMESTAMP_KEY, 0);
            const now = Date.now();
            const elapsed = now - lastSubmit;

            if (elapsed < requiredInterval) {
                const waitTime = requiredInterval - elapsed;
                debugLog(`Rate limiting: waiting ${waitTime.toFixed(0)}ms...`, 'orange');
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            await GM.setValue(MB_LAST_SUBMIT_TIMESTAMP_KEY, Date.now().toString());
            debugLog(`Executing submission.`, 'darkgreen');
            callback();
        });
    }

    /**
     * @summary Sets up listeners for specified configurations.
     * @param {SiteConfig[]} configs - An array of configuration objects.
     */
    function setupConfigListeners(configs) {
        const pendingSubmissionJSON = sessionStorage.getItem(SUBMISSION_TRIGGERED_FLAG);
        if (pendingSubmissionJSON) {
            try {
                const state = JSON.parse(pendingSubmissionJSON);
                const pendingConfig = siteConfigurations.find(c => c.channelName === state.channel && c.messageTrigger === state.messageTrigger);

                if (pendingConfig && (isSubmissionSuccessful(pendingConfig, true) || pendingConfig.isNoOp?.())) {
                    debugLog(`Found pending submission flag on a success/no-op page. Letting success handler take over.`, 'purple');
                } else {
                    const activePendingConfig = configs.find(c => c.channelName === state.channel && c.messageTrigger === state.messageTrigger);
                    if (activePendingConfig && activePendingConfig.submissionHandler) {
                        debugLog(`Found pending submission flag on page load for "${activePendingConfig.menuCommandName}". Re-triggering handler.`, 'purple');
                        const triggerAction = () => waitForButtonAndClick(activePendingConfig);
                        activePendingConfig.submissionHandler(activePendingConfig, triggerAction);
                    }
                }
            } catch (e) {
                console.error(`[${scriptName}] Error parsing pending submission state:`, e);
                sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
            }
        }

        for (const config of configs) {
            const triggerAction = () => waitForButtonAndClick(config);

            if (config.referrerPatterns && config.buttonSelector) {
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
                    const triggerState = JSON.stringify({
                        channel: config.channelName,
                        messageTrigger: config.messageTrigger
                    });
                    sessionStorage.setItem(SUBMISSION_TRIGGERED_FLAG, triggerState);

                    if (config.submissionHandler) {
                        config.submissionHandler(config, triggerAction);
                    } else {
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
                console.error(`[${scriptName}] Error during referrer-close check:`, e);
            }
        }

        // --- 2. Check for Submission-Based Close Condition ---
        const submissionFlag = sessionStorage.getItem(SUBMISSION_TRIGGERED_FLAG);
        if (submissionFlag) {
            try {
                const state = JSON.parse(submissionFlag);
                const config = siteConfigurations.find(c =>
                    c.channelName === state.channel && c.messageTrigger === state.messageTrigger
                );

                if (!config) return;

                const isSuccess = isSubmissionSuccessful(config, true);
                const isPostSubmissionNoOp = config.isNoOp?.() ?? false;

                if (state.isPreSubmissionNoOp || isSuccess || isPostSubmissionNoOp) {
                    sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
                    const reason = isSuccess ? 'Submission successful' : 'Submission was a no-op';
                    await closeTab(reason);
                }
            } catch (e) {
                console.error(`[${scriptName}] Error parsing submission state:`, e);
                sessionStorage.removeItem(SUBMISSION_TRIGGERED_FLAG);
            }
        }
    }

    /**
     * @summary Main script entry point.
     */
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
            setupConfigListeners(activeConfigs);
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