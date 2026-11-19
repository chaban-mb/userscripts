// ==UserScript==
// @name        Site Bookmarklet Toolbar
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.0.0
// @description Replaces the browser bookmarks bar with an in-page site-scoped bookmarklet toolbar, command palette, and drag-and-drop manager.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @homepageURL https://github.com/chaban-mb/userscripts
// @supportURL  https://github.com/chaban-mb/userscripts/issues
// @match       *://*/*
// @require     ../lib/BookmarkletToolbarCore.js
// @require     ../lib/BookmarkletToolbarPacks.js
// @require     ../lib/BookmarkletToolbarAdapters.js
// @require     ../lib/BookmarkletToolbarUI.js
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM.deleteValue
// @grant       GM.registerMenuCommand
// @run-at      document-end
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/Site%20Bookmarklet%20Toolbar.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/Site%20Bookmarklet%20Toolbar.user.js
// ==/UserScript==

(function () {
    'use strict';

    (async function main() {
        const LOG_PREFIX = '[Bookmarklet Toolbar]';
        const log = {
            debug: (...args) => console.debug(LOG_PREFIX, ...args),
            info: (...args) => console.info(LOG_PREFIX, ...args),
            warn: (...args) => console.warn(LOG_PREFIX, ...args),
            error: (...args) => console.error(LOG_PREFIX, ...args),
        };

        const Core =
            typeof BookmarkletToolbarCore !== 'undefined' ? BookmarkletToolbarCore : null;
        const Adapters =
            typeof BookmarkletToolbarAdapters !== 'undefined'
                ? BookmarkletToolbarAdapters
                : null;
        const UI =
            typeof BookmarkletToolbarUI !== 'undefined' ? BookmarkletToolbarUI : null;
        const BundledPacks =
            typeof BUNDLED_BOOKMARKLET_PACKS !== 'undefined' &&
            Array.isArray(BUNDLED_BOOKMARKLET_PACKS)
                ? BUNDLED_BOOKMARKLET_PACKS
                : [];

        if (!Core || !Adapters || !UI) {
            log.error('Required Bookmarklet Toolbar libraries failed to load.');
            return;
        }

        const win = typeof window !== 'undefined' ? window : null;
        const doc =
            (win && win.document) || (typeof document !== 'undefined' ? document : null);
        if (!win || !doc) {
            return;
        }

        function isPlainObject(val) {
            return Boolean(val && typeof val === 'object' && !Array.isArray(val));
        }

        function parseStoredValue(raw, fallback) {
            if (raw === undefined || raw === null) {
                return fallback;
            }
            if (typeof raw === 'string') {
                try {
                    const parsed = JSON.parse(raw);
                    return parsed !== undefined && parsed !== null ? parsed : fallback;
                } catch {
                    return fallback;
                }
            }
            return raw;
        }

        async function safeGetValue(key, fallback) {
            if (typeof GM === 'undefined' || typeof GM.getValue !== 'function') {
                return fallback;
            }
            try {
                const raw = await GM.getValue(key, fallback);
                return parseStoredValue(raw, fallback);
            } catch (err) {
                log.error(`Failed to read storage key "${key}":`, err);
                return fallback;
            }
        }

        async function safeSetValue(key, value) {
            if (typeof GM === 'undefined' || typeof GM.setValue !== 'function') {
                return false;
            }
            try {
                await GM.setValue(key, value);
                return true;
            } catch (err) {
                log.error(`Failed to write storage key "${key}":`, err);
                return false;
            }
        }

        async function safeDeleteValue(key) {
            if (typeof GM === 'undefined' || typeof GM.deleteValue !== 'function') {
                return false;
            }
            try {
                await GM.deleteValue(key);
                return true;
            } catch (err) {
                log.error(`Failed to delete storage key "${key}":`, err);
                return false;
            }
        }

        function getCurrentUrl() {
            return (win.location && win.location.href) || '';
        }

        const [rawSettings, rawLocalScripts, rawLayout, rawRecents, ...rawPackCaches] =
            await Promise.all([
                safeGetValue(Core.STORAGE_KEYS.settings, null),
                safeGetValue(Core.STORAGE_KEYS.localScripts, null),
                safeGetValue(Core.STORAGE_KEYS.layout, null),
                safeGetValue(Core.STORAGE_KEYS.recents, null),
                ...BundledPacks.map((pack) =>
                    safeGetValue(Core.STORAGE_KEYS.packKey(pack.id), null)
                ),
            ]);

        const state = {
            url: getCurrentUrl(),
            settings: {
                hotkey: 'Alt+B',
                ...(isPlainObject(rawSettings) ? rawSettings : {}),
            },
            localScripts: isPlainObject(rawLocalScripts) ? { ...rawLocalScripts } : {},
            layout: Array.isArray(rawLayout) ? rawLayout : [],
            recents: isPlainObject(rawRecents) ? { ...rawRecents } : {},
            packs: {},
        };

        if (typeof state.settings.hotkey !== 'string' || !state.settings.hotkey.trim()) {
            state.settings.hotkey = 'Alt+B';
        }

        const packSyncPromises = [];
        for (let i = 0; i < BundledPacks.length; i += 1) {
            const bundledPack = BundledPacks[i];
            if (!bundledPack || !bundledPack.id) {
                continue;
            }
            const cachedPack = isPlainObject(rawPackCaches[i]) ? rawPackCaches[i] : null;
            const syncResult = Core.syncPackCache(cachedPack, bundledPack, state.layout);
            state.packs[bundledPack.id] = syncResult.packCache;
            if (syncResult.changed) {
                packSyncPromises.push(
                    safeSetValue(
                        Core.STORAGE_KEYS.packKey(bundledPack.id),
                        syncResult.packCache
                    )
                );
                log.info(
                    `Synced pack "${bundledPack.id}" v${bundledPack.version} (+${syncResult.stats.added} added, ~${syncResult.stats.updated} updated, !${syncResult.stats.removedFlagged} flagged removed).`
                );
            }
        }
        if (packSyncPromises.length > 0) {
            await Promise.all(packSyncPromises);
        }

        async function saveLayout(nextLayout) {
            state.layout = Array.isArray(nextLayout) ? nextLayout : [];
            await safeSetValue(Core.STORAGE_KEYS.layout, state.layout);
        }

        async function saveLocalScripts(nextLocalScripts) {
            state.localScripts = isPlainObject(nextLocalScripts)
                ? { ...nextLocalScripts }
                : {};
            await safeSetValue(Core.STORAGE_KEYS.localScripts, state.localScripts);
        }

        async function savePackCache(packId, nextPackCache) {
            if (typeof packId !== 'string' || !packId.trim()) {
                return;
            }
            const key = Core.STORAGE_KEYS.packKey(packId);
            if (!nextPackCache) {
                delete state.packs[packId];
                await safeDeleteValue(key);
                return;
            }
            state.packs[packId] = nextPackCache;
            await safeSetValue(key, nextPackCache);
        }

        async function saveSettings(nextSettings) {
            state.settings = {
                hotkey: 'Alt+B',
                ...(isPlainObject(nextSettings) ? nextSettings : {}),
            };
            if (
                typeof state.settings.hotkey !== 'string' ||
                !state.settings.hotkey.trim()
            ) {
                state.settings.hotkey = 'Alt+B';
            }
            await safeSetValue(Core.STORAGE_KEYS.settings, state.settings);
        }

        async function recordExecution(scriptId, nextRecents = null) {
            if (isPlainObject(nextRecents)) {
                state.recents = { ...nextRecents };
            } else if (typeof scriptId === 'string' && scriptId) {
                state.recents = {
                    ...state.recents,
                    [scriptId]: {
                        lastRunAt: Date.now(),
                        count: (state.recents[scriptId]?.count || 0) + 1,
                    },
                };
            }
            await safeSetValue(Core.STORAGE_KEYS.recents, state.recents);
        }

        let uiInstance = null;

        function getScriptsMap() {
            return Core.buildScriptsMap(state.packs, state.localScripts);
        }

        function getUI() {
            if (!uiInstance) {
                uiInstance = UI.createToolbarUI({
                    doc,
                    win,
                    initialState: {
                        url: state.url,
                        packs: state.packs,
                        localScripts: state.localScripts,
                        layout: state.layout,
                        recents: state.recents,
                        settings: state.settings,
                    },
                    callbacks: {
                        onStateChange(partial) {
                            if (!isPlainObject(partial)) {
                                return;
                            }
                            if ('layout' in partial) {
                                void saveLayout(partial.layout);
                            }
                            if ('localScripts' in partial) {
                                void saveLocalScripts(partial.localScripts);
                            }
                            if ('packs' in partial && isPlainObject(partial.packs)) {
                                const prevPackIds = new Set(Object.keys(state.packs));
                                for (const [packId, packCache] of Object.entries(
                                    partial.packs
                                )) {
                                    prevPackIds.delete(packId);
                                    void savePackCache(packId, packCache);
                                }
                                for (const removedPackId of prevPackIds) {
                                    void savePackCache(removedPackId, null);
                                }
                            }
                            if ('settings' in partial) {
                                void saveSettings(partial.settings);
                            }
                            if ('recents' in partial) {
                                void recordExecution(null, partial.recents);
                            }
                        },
                        onRunScript(scriptId, script) {
                            if (!script || typeof script.code !== 'string') {
                                return;
                            }
                            Adapters.executeScriptInPage(script.code, {
                                doc,
                                win,
                                onError(errMsg) {
                                    log.warn(
                                        `Execution error for "${script.name || scriptId}":`,
                                        errMsg
                                    );
                                    if (uiInstance) {
                                        uiInstance.showToast(
                                            `Bookmarklet error: ${errMsg}`
                                        );
                                    }
                                },
                            });
                        },
                    },
                });
            }
            return uiInstance;
        }

        // Register Violentmonkey / Tampermonkey / GM4 menu commands unconditionally
        if (
            typeof GM !== 'undefined' &&
            typeof GM.registerMenuCommand === 'function'
        ) {
            try {
                GM.registerMenuCommand('Open Command Palette', () => {
                    state.url = getCurrentUrl();
                    const ui = getUI();
                    ui.update({ url: state.url });
                    ui.openPalette();
                });
                GM.registerMenuCommand('Open Bookmarklet Manager', () => {
                    state.url = getCurrentUrl();
                    const ui = getUI();
                    ui.update({ url: state.url });
                    ui.openManager();
                });
            } catch (err) {
                log.warn('Failed to register menu commands:', err);
            }
        }

        function isEditableTarget(el) {
            if (!el || typeof el !== 'object') {
                return false;
            }
            if (el.isContentEditable === true || el.contentEditable === 'true') {
                return true;
            }
            if (
                typeof el.getAttribute === 'function' &&
                el.getAttribute('contenteditable') === 'true'
            ) {
                return true;
            }
            const tag = String(el.tagName || '').toUpperCase();
            if (tag === 'TEXTAREA' || tag === 'SELECT') {
                return true;
            }
            if (tag === 'INPUT') {
                const type = String(el.type || 'text').toLowerCase();
                const nonTextTypes = new Set([
                    'button',
                    'checkbox',
                    'color',
                    'file',
                    'hidden',
                    'image',
                    'radio',
                    'range',
                    'reset',
                    'submit',
                ]);
                return !nonTextTypes.has(type);
            }
            return false;
        }

        function handleGlobalKeydown(event) {
            if (!event || event.defaultPrevented || event._btHotkeyHandled) {
                return;
            }
            if (uiInstance && uiInstance.isRecordingHotkey()) {
                return;
            }
            const path =
                typeof event.composedPath === 'function' ? event.composedPath() : [];
            const target = path[0] || event.target || doc.activeElement || null;
            const hasNonShiftModifier = Boolean(
                event.ctrlKey || event.altKey || event.metaKey
            );
            if (isEditableTarget(target) && !hasNonShiftModifier) {
                return;
            }
            const activeHotkey = state.settings?.hotkey || 'Alt+B';
            if (Core.matchesHotkey(event, activeHotkey)) {
                event._btHotkeyHandled = true;
                if (typeof event.preventDefault === 'function') {
                    event.preventDefault();
                }
                if (typeof event.stopPropagation === 'function') {
                    event.stopPropagation();
                }
                state.url = getCurrentUrl();
                const ui = getUI();
                ui.update({ url: state.url });
                ui.openPalette();
            }
        }

        if (typeof win.addEventListener === 'function') {
            win.addEventListener('keydown', handleGlobalKeydown);
        }
        if (typeof doc.addEventListener === 'function') {
            doc.addEventListener('keydown', handleGlobalKeydown);
        }

        // Fast-path check on startup: only instantiate and mount Toolbar if at least one placed script matches current URL
        if (Core.shouldMountToolbar(state.layout, getScriptsMap(), state.url)) {
            getUI();
        }

        // SPA URL & DOM re-evaluation watcher (throttled without duplicate listeners)
        let urlCheckScheduled = false;

        function evaluateUrlAndMountState() {
            urlCheckScheduled = false;
            const currentUrl = getCurrentUrl();
            const urlChanged = Boolean(currentUrl && currentUrl !== state.url);
            if (urlChanged) {
                state.url = currentUrl;
            }

            const shouldMount = Core.shouldMountToolbar(
                state.layout,
                getScriptsMap(),
                state.url
            );

            if (shouldMount) {
                if (!uiInstance) {
                    getUI();
                } else {
                    const host = uiInstance.getToolbarHost();
                    const hostDetached = !host || !host.parentNode;
                    if (urlChanged || !uiInstance.isToolbarMounted() || hostDetached) {
                        uiInstance.update({ url: state.url });
                    }
                }
            } else if (uiInstance && (urlChanged || uiInstance.isToolbarMounted())) {
                uiInstance.update({ url: state.url });
            }
        }

        function scheduleUrlCheck() {
            if (urlCheckScheduled) {
                return;
            }
            urlCheckScheduled = true;
            setTimeout(evaluateUrlAndMountState, 16);
        }

        if (typeof win.addEventListener === 'function') {
            win.addEventListener('popstate', scheduleUrlCheck);
            win.addEventListener('hashchange', scheduleUrlCheck);
        }

        if (win.history && !win.history._btHistoryWrapped) {
            win.history._btHistoryWrapped = true;
            for (const method of ['pushState', 'replaceState']) {
                const original = win.history[method];
                if (typeof original === 'function') {
                    win.history[method] = function (...args) {
                        const result = original.apply(this, args);
                        scheduleUrlCheck();
                        return result;
                    };
                }
            }
        }

        const ObserverCtor =
            (win && typeof win.MutationObserver === 'function' && win.MutationObserver) ||
            (typeof MutationObserver === 'function' ? MutationObserver : null);
        const observeRoot = doc.body || doc.documentElement;
        if (ObserverCtor && observeRoot) {
            const observer = new ObserverCtor(() => {
                const currentUrl = getCurrentUrl();
                if (currentUrl && currentUrl !== state.url) {
                    scheduleUrlCheck();
                } else if (
                    uiInstance &&
                    uiInstance.isToolbarMounted() &&
                    !uiInstance.getToolbarHost()?.parentNode
                ) {
                    scheduleUrlCheck();
                }
            });
            observer.observe(observeRoot, { childList: true, subtree: true });
        }
    })().catch((err) => {
        console.error('[Bookmarklet Toolbar] Fatal initialization error:', err);
    });
})();
