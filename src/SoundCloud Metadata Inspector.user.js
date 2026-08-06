// ==UserScript==
// @name        SoundCloud Metadata Inspector
// @namespace   https://github.com/chaban-mb/userscripts
// @version     1.1.2
// @description Metadata inspector for viewing hidden data like ISRC, UPCs, timestamps, etc.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       https://soundcloud.com/*
// @icon        https://a-v2.sndcdn.com/assets/images/sc-icons/favicon-48x48-8466dd3758.png
// @grant       none
// @run-at      document-start
// @updateURL   https://github.com/chaban-mb/userscripts/raw/dist/src/SoundCloud%20Metadata%20Inspector.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/dist/src/SoundCloud%20Metadata%20Inspector.user.js
// ==/UserScript==

(function () {
    "use strict";

    const PANEL_ID = "sc-metadata-dashboard";
    const STYLE_ID = "sc-metadata-dashboard-styles";
    const SETTINGS_KEY = "sc_inspector_settings";

    const SCRIPT_NAME = GM.info.script.name;

    /**
     * Evaluates whether a metadata field value should be considered empty or unset.
     * Checks for standard nullish/empty values as well as API/UI fallback placeholders ("—" and "null").
     *
     * @param {unknown} val - The field value to evaluate.
     * @returns {boolean} `true` if the value is null, undefined, an empty string, "—", or "null"; otherwise `false`.
     */
    const isEmptyVal = (val) => val == null || val === "" || val === "—" || val === "null";    /**

     * @typedef {Object} InspectorSettings
     * @property {boolean} minimized - Whether the panel is currently minimized.
     * @property {boolean} showCommon - Whether common track fields are visible.
     */

    /**
     * @typedef {Object} InspectorFieldSpec
     * @property {string} label - Human-readable label.
     * @property {string|number|null} [textValue] - Plain text representation.
     * @property {Element|null} [uiVal] - Pre-formatted UI element.
     * @property {Element|null} [middleNode] - Middle alignment node.
     * @property {boolean} [isFaded] - Whether field is dimmed as common data.
     */

    /**
     * @typedef {Object} InspectorSectionSpec
     * @property {string} [title] - Section title.
     * @property {Array<[string, string|number|null, Element|null, Element|null, boolean]>} [items] - Field row tuples.
     * @property {string|null} [customText] - Raw text block.
     * @property {Element[]|Element|null} [customUI] - Pre-constructed UI elements.
     * @property {boolean} [isTrackCard] - Whether section represents a track card.
     * @property {Object} [trackData] - Track metadata object.
     * @property {number} [trackIndex] - Zero-indexed track position.
     * @property {Set<string>} [commonKeys] - Set of keys common across tracks.
     */

    /**
     * @typedef {Object} InspectorSpec
     * @property {string} title - Main header title.
     * @property {string} type - Human-readable format type.
     * @property {string} user - Creator username.
     * @property {string|null} artworkUrl - Entity artwork URL.
     * @property {string|null} profileUrl - Creator profile URL.
     * @property {boolean} isUser - Whether entity represents a user profile.
     * @property {InspectorSectionSpec[]} sections - Ordered section specifications for current tab.
     */

    /**
     * Single Source of Truth Promise-deduplicated entity cache.
     */
    class EntityCache {
        constructor() {
            /** @type {Map<string, Object>} */
            this._data = new Map();
            /** @type {Map<string, Promise<Object|null>>} */
            this._promises = new Map();
        }

        /**
         * @summary Checks if an entity is cached for the specified URL.
         * @param {string} url - Clean permalink URL.
         * @returns {boolean}
         */
        has(url) {
            return Boolean(url && this._data.has(url));
        }

        /**
         * @summary Synchronously retrieves a cached entity payload.
         * @param {string} url - Clean permalink URL.
         * @returns {Object|null}
         */
        get(url) {
            if (!url) return null;
            return this._data.get(url) ?? null;
        }

        /**
         * @summary Synchronously stores an entity payload in the cache.
         * @param {string} url - Clean permalink URL.
         * @param {Object} entity - The entity payload object.
         */
        set(url, entity) {
            if (!url || !entity) return;
            this._data.set(url, entity);
        }

        /**
         * @summary Resolves or fetches an entity, deduplicating concurrent in-flight requests.
         * @param {string} url - Clean permalink URL.
         * @param {function(): Promise<Object|null>} fetcher - Fetcher function executing the network request.
         * @returns {Promise<Object|null>}
         */
        async resolve(url, fetcher) {
            if (!url) return null;
            if (this._data.has(url)) {
                return this._data.get(url);
            }
            if (this._promises.has(url)) {
                return this._promises.get(url);
            }

            const promise = (async () => {
                try {
                    const result = await fetcher();
                    if (result) {
                        this._data.set(url, result);
                    }
                    return result;
                } catch (err) {
                    console.error(`[${SCRIPT_NAME}] EntityCache resolve error for URL:`, url, err);
                    return null;
                } finally {
                    this._promises.delete(url);
                }
            })();

            this._promises.set(url, promise);
            return promise;
        }

        /**
         * @summary Immutably updates a cached entity without in-place mutation.
         * @param {string} url - Clean permalink URL.
         * @param {function(Object): Object} updater - Transformation function returning an updated clone.
         */
        merge(url, updater) {
            if (!url || !this._data.has(url)) return;
            const current = this._data.get(url);
            const updated = updater(current);
            if (updated) {
                this._data.set(url, updated);
            }
        }
    }

    const cache = new EntityCache();

    /**
     * Declarative tab registry defining available tabs and dynamic labels.
     */
    const TAB_REGISTRY = [
        { id: "release", getLabel: m => m.isUser ? "Profile" : "Release", show: () => true, getSections: (m, opts) => getReleaseSections(m, opts) },
        { id: "tracks", getLabel: () => "Tracks", show: m => !m.isUser, getSections: (m, opts) => getTracksSections(m, opts) },
        { id: "creator", getLabel: () => "Creator", show: m => !m.isUser, getSections: (m, opts) => getCreatorSections(m, opts) },
        { id: "tech", getLabel: () => "Technical", show: () => true, getSections: (m, opts) => getTechSections(m, opts) }
    ];

    let currentActiveTab = "release";

    function getSettings() {
        try {
            const data = sessionStorage.getItem(SETTINGS_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                return {
                    minimized: Boolean(parsed.minimized)
                };
            }
        } catch (e) {
            console.warn(`[${SCRIPT_NAME}] Failed to read settings from sessionStorage`, e);
        }
        return { minimized: true };
    }

    function saveSettings(settings) {
        try {
            const current = getSettings();
            const updated = { ...current, ...settings };
            sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
        } catch (e) {
            console.warn(`[${SCRIPT_NAME}] Failed to save settings to sessionStorage`, e);
        }
    }

    const initialSettings = getSettings();
    let isMinimized = initialSettings.minimized;

    let meUserId = null;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            :root {
                --sc-panel-bg: rgba(255, 255, 255, 0.96);
                --sc-panel-border: rgba(0, 0, 0, 0.12);
                --sc-header-bg: rgba(0, 0, 0, 0.03);
                --sc-card-bg: rgba(0, 0, 0, 0.025);
                --sc-card-border: rgba(0, 0, 0, 0.06);
                --sc-text-main: #18181b;
                --sc-text-sub: #52525b;
                --sc-text-muted: #71717a;
                --sc-orange: #ff5500;
                --sc-badge-orange-bg: rgba(255, 85, 0, 0.12);
                --sc-badge-green-bg: rgba(16, 185, 129, 0.12);
                --sc-badge-green-txt: #059669;
                --sc-badge-blue-bg: rgba(14, 165, 233, 0.12);
                --sc-badge-blue-txt: #0284c7;
                --sc-badge-purple-bg: rgba(147, 51, 234, 0.12);
                --sc-badge-purple-txt: #9333ea;
                --sc-badge-red-bg: rgba(239, 68, 68, 0.12);
                --sc-badge-red-txt: #dc2626;
                --sc-badge-teal-bg: rgba(20, 184, 166, 0.12);
                --sc-badge-teal-txt: #0d9488;
                --sc-badge-amber-bg: rgba(245, 158, 11, 0.12);
                --sc-badge-amber-txt: #d97706;
                --sc-badge-indigo-bg: rgba(99, 102, 241, 0.12);
                --sc-badge-indigo-txt: #4f46e5;
                --sc-badge-gray-bg: rgba(0, 0, 0, 0.06);
                --sc-badge-gray-txt: #52525b;
                --sc-btn-bg: rgba(0, 0, 0, 0.05);
                --sc-btn-border: rgba(0, 0, 0, 0.1);
                --sc-btn-txt: #27272a;
                --sc-shadow: 0 12px 40px -10px rgba(0, 0, 0, 0.18);
            }

            @media (prefers-color-scheme: dark) {
                :root {
                    --sc-panel-bg: rgba(18, 18, 20, 0.96);
                    --sc-panel-border: rgba(255, 255, 255, 0.08);
                    --sc-header-bg: rgba(255, 255, 255, 0.02);
                    --sc-card-bg: rgba(255, 255, 255, 0.025);
                    --sc-card-border: rgba(255, 255, 255, 0.05);
                    --sc-text-main: #f4f4f5;
                    --sc-text-sub: #a1a1aa;
                    --sc-text-muted: #71717a;
                    --sc-badge-orange-bg: rgba(255, 85, 0, 0.18);
                    --sc-badge-green-bg: rgba(16, 185, 129, 0.18);
                    --sc-badge-green-txt: #10b981;
                    --sc-badge-blue-bg: rgba(14, 165, 233, 0.18);
                    --sc-badge-blue-txt: #38bdf8;
                    --sc-badge-purple-bg: rgba(147, 51, 234, 0.18);
                    --sc-badge-purple-txt: #c084fc;
                    --sc-badge-red-bg: rgba(239, 68, 68, 0.18);
                    --sc-badge-red-txt: #ef4444;
                    --sc-badge-teal-bg: rgba(20, 184, 166, 0.18);
                    --sc-badge-teal-txt: #2dd4bf;
                    --sc-badge-amber-bg: rgba(245, 158, 11, 0.18);
                    --sc-badge-amber-txt: #fbbf24;
                    --sc-badge-indigo-bg: rgba(99, 102, 241, 0.18);
                    --sc-badge-indigo-txt: #818cf8;
                    --sc-badge-gray-bg: rgba(255, 255, 255, 0.08);
                    --sc-badge-gray-txt: #d4d4d8;
                    --sc-btn-bg: rgba(255, 255, 255, 0.06);
                    --sc-btn-border: rgba(255, 255, 255, 0.1);
                    --sc-btn-txt: #e4e4e7;
                    --sc-shadow: 0 12px 40px -10px rgba(0, 0, 0, 0.75);
                }
            }

            #${PANEL_ID} {
                position: fixed;
                right: 20px;
                top: 75px;
                z-index: 999999;
                width: 400px;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                color: var(--sc-text-main);
                transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
            }

            .sc-dashboard-wrapper {
                background: var(--sc-panel-bg);
                backdrop-filter: blur(14px);
                border: 1px solid var(--sc-panel-border);
                border-radius: 14px;
                box-shadow: var(--sc-shadow);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                max-height: 84vh;
                position: relative;
            }

            .sc-dashboard-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                background: var(--sc-header-bg);
                border-bottom: 1px solid var(--sc-card-border);
            }

            .sc-dashboard-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 700;
                font-size: 13px;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                color: var(--sc-orange);
            }

            .sc-dashboard-controls {
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .sc-control-btn {
                background: none;
                border: none;
                color: var(--sc-text-sub);
                cursor: pointer;
                padding: 5px;
                border-radius: 6px;
                transition: background 0.2s, color 0.2s;
            }
            .sc-control-btn:hover {
                background: var(--sc-btn-bg);
                color: var(--sc-text-main);
            }

            .sc-dashboard-tabs {
                display: flex;
                background: var(--sc-header-bg);
                padding: 4px;
                gap: 4px;
                border-bottom: 1px solid var(--sc-card-border);
            }

            .sc-tab-btn {
                flex: 1;
                background: none;
                border: none;
                color: var(--sc-text-sub);
                padding: 8px 2px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                border-radius: 6px;
                transition: all 0.2s;
                text-align: center;
                white-space: nowrap;
            }
            .sc-tab-btn:hover {
                color: var(--sc-text-main);
                background: var(--sc-btn-bg);
            }
            .sc-tab-btn.active {
                color: var(--sc-orange);
                background: var(--sc-badge-orange-bg);
            }

            .sc-dashboard-body {
                overflow-y: auto;
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .sc-meta-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
                background: var(--sc-card-bg);
                border: 1px solid var(--sc-card-border);
                padding: 12px;
                border-radius: 8px;
            }

            .sc-meta-group-title {
                font-size: 11px;
                font-weight: 700;
                color: var(--sc-orange);
                margin-bottom: 2px;
                text-transform: uppercase;
                letter-spacing: 0.03em;
            }

            .sc-meta-row {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                font-size: 12px;
                line-height: 1.5;
                gap: 12px;
            }

            .sc-meta-row-3col {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                font-size: 12px;
                line-height: 1.5;
                gap: 12px;
            }

            .sc-meta-row-3col > .sc-meta-label {
                flex: 0 0 35%;
                text-align: left;
            }

            .sc-meta-row-3col > .sc-meta-center {
                flex: 0 0 auto;
                display: flex;
                justify-content: center;
                align-items: center;
            }

            .sc-meta-row-3col > .sc-meta-value {
                flex: 1 1 65%;
                text-align: right;
                word-break: break-all;
                overflow-wrap: break-word;
            }

            .sc-meta-label {
                color: var(--sc-text-muted);
                font-weight: 500;
                flex: 0 0 38%;
            }

            .sc-meta-value {
                color: var(--sc-text-main);
                font-weight: 400;
                text-align: right;
                flex: 1 1 62%;
                word-break: break-all;
                overflow-wrap: break-word;
            }

            .sc-badge {
                font-size: 10px;
                padding: 2px 7px;
                border-radius: 4px;
                font-weight: 700;
                text-transform: uppercase;
                display: inline-flex;
                align-items: center;
                gap: 2px;
            }

            .sc-badge-orange { background: var(--sc-badge-orange-bg); color: var(--sc-orange); }
            .sc-badge-green { background: var(--sc-badge-green-bg); color: var(--sc-badge-green-txt); }
            .sc-badge-blue { background: var(--sc-badge-blue-bg); color: var(--sc-badge-blue-txt); }
            .sc-badge-purple { background: var(--sc-badge-purple-bg); color: var(--sc-badge-purple-txt); }
            .sc-badge-red { background: var(--sc-badge-red-bg); color: var(--sc-badge-red-txt); }
            .sc-badge-teal { background: var(--sc-badge-teal-bg); color: var(--sc-badge-teal-txt); }
            .sc-badge-amber { background: var(--sc-badge-amber-bg); color: var(--sc-badge-amber-txt); }
            .sc-badge-indigo { background: var(--sc-badge-indigo-bg); color: var(--sc-badge-indigo-txt); }
            .sc-badge-gray { background: var(--sc-badge-gray-bg); color: var(--sc-badge-gray-txt); }
            .sc-badge-group { display: flex; align-items: center; gap: 4px; }
            .sc-tab-link { cursor: pointer; user-select: none; transition: opacity 0.15s ease; }
            .sc-tab-link:hover { opacity: 0.8; text-decoration: underline; }

            .sc-track-card {
                background: var(--sc-card-bg);
                border: 1px solid var(--sc-card-border);
                border-radius: 8px;
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                transition: border-color 0.2s;
            }
            .sc-track-card:hover { border-color: var(--sc-orange); }

            .sc-track-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 8px;
            }

            .sc-track-header-left {
                display: flex;
                flex-direction: column;
                gap: 2px;
                max-width: 75%;
            }

            .sc-track-header-right {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 4px;
            }

            .sc-track-title {
                font-size: 13px;
                font-weight: 600;
                color: var(--sc-text-main);
            }

            .sc-track-author {
                font-size: 11.5px;
                color: var(--sc-text-sub);
            }

            .sc-track-stats {
                display: flex;
                gap: 10px;
                font-size: 11px;
                color: var(--sc-text-muted);
                margin-top: 2px;
            }

            .sc-track-meta {
                display: flex;
                flex-direction: column;
                gap: 6px;
                border-top: 1px solid var(--sc-card-border);
                padding-top: 8px;
                margin-top: 2px;
            }

            .sc-bio-box {
                font-size: 11.5px;
                line-height: 1.5;
                color: var(--sc-text-sub);
                background: var(--sc-card-bg);
                border: 1px dashed var(--sc-card-border);
                padding: 8px 10px;
                border-radius: 6px;
                max-height: 100px;
                overflow-y: auto;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .sc-export-menu {
                position: absolute;
                top: 45px;
                right: 16px;
                background: var(--sc-panel-bg);
                border: 1px solid var(--sc-panel-border);
                border-radius: 8px;
                padding: 6px;
                display: none;
                flex-direction: column;
                gap: 4px;
                z-index: 100000;
                box-shadow: var(--sc-shadow);
            }
            .sc-export-menu.show { display: flex; }

            .sc-export-item {
                background: none;
                border: none;
                color: var(--sc-text-main);
                padding: 7px 12px;
                font-size: 12px;
                text-align: left;
                cursor: pointer;
                border-radius: 5px;
                white-space: nowrap;
                transition: background 0.2s, color 0.2s;
            }
            .sc-export-item:hover {
                background: var(--sc-badge-orange-bg);
                color: var(--sc-orange);
            }

            .sc-minimized-pill {
                display: none;
                position: fixed;
                right: 20px;
                top: 75px;
                z-index: 999999;
                background: var(--sc-orange);
                color: white;
                padding: 8px 14px;
                border-radius: 20px;
                font-weight: 700;
                font-size: 12px;
                box-shadow: 0 4px 14px rgba(255, 85, 0, 0.4);
                cursor: pointer;
                align-items: center;
                gap: 6px;
                transition: transform 0.2s;
            }
            .sc-minimized-pill:hover { transform: scale(1.04); }

            .sc-tags-container {
                display: flex;
                flex-wrap: wrap;
                justify-content: flex-end;
                gap: 4px;
                margin-top: 2px;
            }

            .sc-tag-pill {
                font-size: 10.5px;
                background: var(--sc-btn-bg);
                border: 1px solid var(--sc-card-border);
                color: var(--sc-text-sub);
                padding: 2px 7px;
                border-radius: 12px;
                line-height: 1.3;
            }

            .sc-entity-header { display: flex; gap: 10px; align-items: center; }
            .sc-entity-details { display: flex; flex-direction: column; overflow: hidden; }
            .sc-entity-title { font-size: 13.5px; font-weight: 700; color: var(--sc-text-main); display: flex; align-items: center; gap: 4px; }
            .sc-entity-title-truncate { font-size: 13px; font-weight: 600; color: var(--sc-text-main); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
            .sc-entity-subtitle { font-size: 11px; color: var(--sc-orange); }
            .sc-entity-subtitle-link,
            .sc-entity-subtitle-link:visited,
            #${PANEL_ID} a,
            #${PANEL_ID} a:visited { color: var(--sc-orange); text-decoration: none; }
            .sc-entity-subtitle-link:hover,
            #${PANEL_ID} a:hover { text-decoration: underline; }
            .sc-verified-badge { color: var(--sc-badge-blue-txt); }

            .sc-avatar-circle { width: 48px; height: 48px; border-radius: 50%; border: 2px solid var(--sc-orange); object-fit: cover; }
            .sc-avatar-square { width: 48px; height: 48px; border-radius: 6px; border: 1px solid var(--sc-card-border); object-fit: cover; }

            .sc-creator-banner { height: 60px; border-radius: 8px; border: 1px solid var(--sc-card-border); background-position: center; background-size: cover; background-repeat: no-repeat; margin-bottom: 8px; }

            .sc-upc-warning { font-size: 11px; color: var(--sc-badge-red-txt); margin-top: 4px; }
            .sc-preset-item { font-size: 11px; background: var(--sc-card-bg); border: 1px solid var(--sc-card-border); padding: 5px 8px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
            .sc-preset-name { color: var(--sc-text-sub); font-weight: 600; }
            .sc-preset-detail { color: var(--sc-orange); font-family: monospace; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
            .sc-notice-box { font-size: 11.5px; color: var(--sc-text-muted); text-align: center; padding: 10px; }
            .sc-track-timeline { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
            .sc-badge-explicit { margin-left: 4px; transform: scale(0.9); }

            .sc-meta-mono { font-family: monospace; font-size: 12px; word-break: break-all; }
            .sc-meta-mono-sm { font-family: monospace; font-size: 11px; word-break: break-all; }

            /* ISRC Highlight Styles */
            .sc-isrc-highlighted {
                display: inline-block;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 11.5px;
                font-weight: 700;
                user-select: text;
                -webkit-user-select: text;
            }
            .sc-isrc-part {
                display: inline-block;
                padding: 1px 3px;
                border-radius: 3px;
                letter-spacing: 0.02em;
                position: relative;
                line-height: 1.2;
            }
            .sc-isrc-part:not(:last-child) {
                margin-right: 4px;
            }
            .sc-isrc-part:not(:last-child)::after {
                content: "·";
                position: absolute;
                right: -3px;
                top: 50%;
                transform: translateY(-50%);
                color: var(--sc-text-muted);
                font-size: 9px;
                opacity: 0.4;
                user-select: none;
                -webkit-user-select: none;
                pointer-events: none;
            }
            .sc-isrc-cc { background: rgba(14, 165, 233, 0.15); color: var(--sc-badge-blue-txt); }
            .sc-isrc-reg { background: rgba(147, 51, 234, 0.15); color: var(--sc-badge-purple-txt); }
            .sc-isrc-yr { background: rgba(255, 85, 0, 0.15); color: var(--sc-orange); }
            .sc-isrc-des { background: rgba(16, 185, 129, 0.15); color: var(--sc-badge-green-txt); }

            /* UPC Barcode Badge Styles */
            .sc-upc-badge {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 11.5px;
                font-weight: 700;
                color: var(--sc-orange);
                background: var(--sc-badge-orange-bg);
                border: 1px solid rgba(255, 85, 0, 0.22);
                padding: 2px 7px;
                border-radius: 5px;
                user-select: text;
                -webkit-user-select: text;
            }
            .sc-upc-badge svg {
                flex-shrink: 0;
                opacity: 0.85;
                pointer-events: none;
                user-select: none;
                -webkit-user-select: none;
            }
            .sc-upc-text {
                letter-spacing: 0.04em;
                user-select: text;
                -webkit-user-select: text;
            }
        `;
        document.head.appendChild(style);
    }

    const cleanUrl = (url) => url ? url.split("?")[0].split("#")[0].replace(/\/$/, "") : "";

    const formatTime = (ms) => {
        if (!ms) return "—";
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
        }
        return `${minutes}:${String(seconds).padStart(2, "0")}`;
    };

    const formatDate = (dateStr) => dateStr ? dateStr.slice(0, 10) : null;
    const formatNumber = (num) => num != null ? num.toLocaleString() : "0";

    /**
     * Parses a raw space-delimited or double-quoted SoundCloud tag list string
     * into clean, normalized hashtag strings.
     *
     * @param {string|null|undefined} tagStr - Raw `tag_list` payload string (e.g., `"hip hop" rap #electronic`).
     * @returns {string[]} Array of formatted hashtag strings (e.g., `["#hip hop", "#rap", "#electronic"]`).
     */
    function parseTagList(tagStr) {
        if (!tagStr || typeof tagStr !== "string") return [];
        const tags = [];
        const regex = /"([^"]+)"|(\S+)/g;
        let match;
        while ((match = regex.exec(tagStr)) !== null) {
            const tag = match[1] || match[2];
            if (tag) {
                const clean = tag.replace(/^#/, "").replace(/[\"\\]/g, "").trim();
                if (clean) tags.push(`#${clean}`);
            }
        }
        return tags;
    }

    function formatImgUrl(url, isAvatar = false) {
        if (!url) return "";
        if (isAvatar || url.includes("avatars-")) {
            return url.replace("-large.", "-t500x500.");
        }
        return url.replace("-large.", "-t200x200.");
    }

    function formatIsrcElement(isrc) {
        if (!isrc) return null;
        const clean = String(isrc).replace(/[^A-Z0-9]/gi, "").toUpperCase();
        if (clean.length === 12) {
            const country = clean.slice(0, 2);
            const registrant = clean.slice(2, 5);
            const year = clean.slice(5, 7);
            const designation = clean.slice(7, 12);

            return el("span", { className: "sc-isrc-highlighted" }, [
                el("span", { className: "sc-isrc-part sc-isrc-cc", title: `Country Code` }, country),
                el("span", { className: "sc-isrc-part sc-isrc-reg", title: `Registrant Code` }, registrant),
                el("span", { className: "sc-isrc-part sc-isrc-yr", title: `Year` }, year),
                el("span", { className: "sc-isrc-part sc-isrc-des", title: `Designation` }, designation)
            ]);
        }
        return el("span", { className: "sc-meta-mono", textContent: isrc });
    }

    function formatUpcElement(upc) {
        if (isEmptyVal(upc)) return null;
        if (upc === "Varied / Mixed Barcodes") {
            return badge("red", upc);
        }
        const clean = String(upc).trim();
        const barcodeSvg = createIcon("barcode", 12, { strokeWidth: 2 });

        return el("span", { className: "sc-upc-badge", title: `UPC/EAN Barcode: ${clean}` }, [
            barcodeSvg,
            el("span", { className: "sc-upc-text" }, clean)
        ]);
    }

    function formatTrackRanges(indices) {
        if (!indices || indices.length === 0) return "";
        const sorted = [...indices].sort((a, b) => a - b);
        const ranges = [];
        let start = sorted[0];
        let prev = sorted[0];

        for (let i = 1; i <= sorted.length; i++) {
            if (i < sorted.length && sorted[i] === prev + 1) {
                prev = sorted[i];
            } else {
                ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
                if (i < sorted.length) {
                    start = sorted[i];
                    prev = sorted[i];
                }
            }
        }
        return ranges.join(", ");
    }

    function el(tag, props = {}, children = []) {
        const node = document.createElement(tag);
        Object.entries(props).forEach(([key, val]) => {
            if (key === "className") node.className = val;
            else if (key === "textContent") node.textContent = val;
            else if (key.startsWith("data-") || key === "dataset") {
                if (typeof val === "object") Object.assign(node.dataset, val);
                else node.setAttribute(key, val);
            } else if (key in node) node[key] = val;
            else node.setAttribute(key, val);
        });

        const childArr = Array.isArray(children) ? children : [children];
        childArr.forEach(c => {
            if (c != null) {
                node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
            }
        });
        return node;
    }

    const ICON_REGISTRY = {
        inspector: {
            viewBox: "0 0 24 24",
            strokeWidth: 2,
            elements: [
                { tag: "circle", attrs: { cx: "11", cy: "11", r: "7" } },
                { tag: "line", attrs: { x1: "21", y1: "21", x2: "16.65", y2: "16.65" } },
                { tag: "path", attrs: { d: "M7 11h1.5l1-3 2 6 1.5-4 1 2h1.5", "stroke-width": "1.75" } }
            ]
        },
        export: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
        minimize: "M5 12h14",
        barcode: "M3 4h2v16H3zm4 0h1v16H7zm3 0h3v16h-3zm5 0h1v16h-1zm3 0h3v16h-3z"
    };

    /**
     * Creates an SVG icon element from the ICON_REGISTRY or raw path data.
     * @param {string} name - Registered icon key or SVG path string.
     * @param {number} [size=14] - Icon width and height in pixels.
     * @param {Object} [options={}] - Custom attributes like strokeWidth.
     * @returns {SVGSVGElement}
     */
    function createIcon(name, size = 14, options = {}) {
        const entry = ICON_REGISTRY[name] || name;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const viewBox = (typeof entry === "object" && entry.viewBox) ? entry.viewBox : "0 0 24 24";
        const strokeWidth = options.strokeWidth ?? (typeof entry === "object" && entry.strokeWidth ? entry.strokeWidth : 2.5);

        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        svg.setAttribute("viewBox", viewBox);
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", String(strokeWidth));
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");

        if (typeof entry === "string") {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", entry);
            svg.appendChild(path);
        } else if (typeof entry === "object" && Array.isArray(entry.elements)) {
            entry.elements.forEach((elDef) => {
                const node = document.createElementNS("http://www.w3.org/2000/svg", elDef.tag);
                Object.entries(elDef.attrs).forEach(([key, val]) => node.setAttribute(key, String(val)));
                svg.appendChild(node);
            });
        }
        return svg;
    }

    function badge(type, text, extraClass = "") {
        return el("span", { className: `sc-badge sc-badge-${type} ${extraClass}`.trim(), textContent: text });
    }

    function formatValueNode(textVal, options = {}) {
        if (!options || typeof options !== "object") {
            if (options instanceof Node) return options;
            return null;
        }

        if (options.badge) {
            const badgeNode = badge(options.badge, options.badgeText || String(textVal), options.switchTab ? "sc-tab-link" : "");
            if (options.switchTab) {
                badgeNode.setAttribute("data-switch-tab", options.switchTab);
                badgeNode.setAttribute("title", `Click to switch to ${options.switchTab} tab`);
            }
            return badgeNode;
        }
        if (options.switchTab) {
            const linkNode = el("span", { className: "sc-tab-link sc-meta-value", textContent: String(textVal) });
            linkNode.setAttribute("data-switch-tab", options.switchTab);
            linkNode.setAttribute("title", `Click to switch to ${options.switchTab} tab`);
            return linkNode;
        }
        if (options.format === "upc") {
            return formatUpcElement(textVal);
        }
        if (options.format === "isrc") {
            return formatIsrcElement(textVal);
        }
        if (options.format === "tags" || (options.tags && Array.isArray(options.tags))) {
            const tagArr = Array.isArray(options.tags) ? options.tags : parseTagList(String(textVal));
            if (tagArr.length === 0) return null;
            return el("div", { className: "sc-tags-container" }, tagArr.map(t => el("span", { className: "sc-tag-pill", textContent: t })));
        }
        if (options.link) {
            return el("a", { href: options.link, target: "_blank", className: "sc-entity-subtitle-link", textContent: options.linkText || textVal });
        }
        if (options.mono) {
            return el("span", { className: "sc-meta-mono-sm sc-meta-value", textContent: String(textVal) });
        }
        return null;
    }

    function metaRow(label, textVal, formatOpt = null, middleNode = null, isCommon = false) {
        if (isEmptyVal(textVal)) return null;

        const options = (typeof formatOpt === "object" && formatOpt !== null && !(formatOpt instanceof Node))
            ? { ...formatOpt, isCommon: isCommon || formatOpt.isCommon }
            : { isCommon };

        let valNode = formatValueNode(textVal, formatOpt);
        if (!valNode) {
            if (formatOpt instanceof Node) {
                valNode = formatOpt;
            } else if (typeof textVal === "string" && (textVal.startsWith("http://") || textVal.startsWith("https://"))) {
                valNode = el("a", { href: textVal, target: "_blank", className: "sc-entity-subtitle-link sc-meta-mono-sm sc-meta-value", textContent: textVal });
            } else if (options.format !== "tags") {
                valNode = el("span", { className: "sc-meta-value", textContent: String(textVal) });
            }
        }

        if (!valNode) return null;

        const extraClasses = [options.isHoisted ? "sc-hoisted-row" : ""].filter(Boolean).join(" ");
        const rowClassSuffix = extraClasses ? ` ${extraClasses}` : "";

        if (middleNode) {
            return el("div", { className: `sc-meta-row-3col${rowClassSuffix}` }, [
                el("span", { className: "sc-meta-label", textContent: label }),
                el("div", { className: "sc-meta-center" }, [middleNode]),
                valNode
            ]);
        }

        return el("div", { className: `sc-meta-row${rowClassSuffix}` }, [
            el("span", { className: "sc-meta-label", textContent: label }),
            valNode
        ]);
    }

    function metaGroup(title, children) {
        const childArr = (Array.isArray(children) ? children : [children]).filter(Boolean);
        if (childArr.length === 0) return null;

        const group = el("div", { className: "sc-meta-group" });
        if (title) {
            group.appendChild(el("div", { className: "sc-meta-group-title", textContent: title }));
        }
        childArr.forEach(c => group.appendChild(c));
        return group;
    }

    function extractMeUser() {
        if (window.__sc_hydration) {
            const meUser = window.__sc_hydration.find((x) => x.hydratable === "meUser")?.data;
            if (meUser?.id) {
                meUserId = meUser.id;
            }
        }
    }

    async function copyToClipboard(text, buttonElement) {
        let success = false;
        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(text);
                success = true;
            } catch (e) {
                console.warn("[SC Inspector] Clipboard writeText failed, falling back", e);
            }
        }

        if (!success) {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            try {
                success = document.execCommand("copy");
            } catch (err) {
                console.error("[SC Inspector] Clipboard copy failed", err);
            } finally {
                document.body.removeChild(textarea);
            }
        }

        if (buttonElement) {
            const originalText = buttonElement.textContent;
            buttonElement.textContent = "✓ Copied!";
            buttonElement.style.color = "var(--sc-badge-green-txt)";
            setTimeout(() => {
                buttonElement.textContent = originalText;
                buttonElement.style.color = "";
            }, 1200);
        }
    }

    /**
     * @summary Serializes an InspectorSpec tree into a Markdown report for clipboard copy.
     * @param {InspectorSpec} spec - The InspectorSpec blueprint.
     * @returns {string} Formatted Markdown report text.
     */
    function renderSpecToText(spec) {
        const lines = [];
        lines.push(`# SoundCloud Inspector Export: ${spec.title}`);
        lines.push(`- **Category:** ${spec.type}`);
        lines.push(`- **Active Tab:** ${spec.activeTab.toUpperCase()}`);
        lines.push(`- **Timestamp:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}\n`);

        spec.sections.forEach((sec) => {
            if (sec.title) lines.push(`## ${sec.title}`);
            if (sec.items && sec.items.length > 0) {
                sec.items.forEach(([label, textVal, opts]) => {
                    if (label && !isEmptyVal(textVal)) {
                        const badgeSuffix = opts?.sourceBadge ? ` (${opts.sourceBadge})` : "";
                        lines.push(`- **${label}:** ${textVal}${badgeSuffix}`);
                    }
                });
            }
            if (sec.customText) {
                lines.push(sec.customText);
            }
            lines.push("");
        });

        return lines.join("\n").trim();
    }

    /**
     * @summary Exports inspector data to the clipboard using the declarative Spec architecture.
     * @param {string} type - Export mode ('raw', 'current', or 'mb').
     * @param {Object} meta - Normalized entity model.
     * @param {Element} buttonElement - Button element for visual copy confirmation.
     */
    function exportData(type, meta, buttonElement) {
        let content = "";

        if (type === "raw") {
            content = JSON.stringify(meta.raw, null, 2);
        } else if (type === "current") {
            const spec = generateInspectorSpec(meta, currentActiveTab, { isExport: true });
            content = renderSpecToText(spec);
        } else if (type === "mb") {
            content = meta.tracks.map((t, i) => `${i + 1}. ${t.title} - ${t.artist} (${t.fullDuration || t.duration})`).join("\n");
        }

        if (content) {
            copyToClipboard(content, buttonElement);
        }
    }

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        const url = typeof args[0] === "string" ? args[0] : args[0]?.url;

        if (url && url.includes("api-v2.soundcloud.com")) {
            try {
                const urlObj = new URL(url);
                const clientId = urlObj.searchParams.get("client_id");
                if (clientId && !window.sc_client_id) {
                    window.sc_client_id = clientId;
                }
            } catch (err) {
                console.debug(`[${SCRIPT_NAME}] Unable to parse client_id from fetch URL`, err);
            }

            try {
                const clone = response.clone();
                clone.json().then((data) => {
                    if (!data) return;

                    if (data.kind === "track" && data.permalink_url) {
                        cache.set(cleanUrl(data.permalink_url), data);
                        if (data.user?.permalink_url) cache.set(cleanUrl(data.user.permalink_url), data.user);
                    } else if (data.kind === "playlist") {
                        if (data.permalink_url) cache.set(cleanUrl(data.permalink_url), data);
                        if (data.user?.permalink_url) cache.set(cleanUrl(data.user.permalink_url), data.user);
                        data.tracks?.forEach((t) => {
                            if (t.permalink_url) cache.set(cleanUrl(t.permalink_url), t);
                            if (t.user?.permalink_url) cache.set(cleanUrl(t.user.permalink_url), t.user);
                        });
                    } else if (data.kind === "user" && data.permalink_url) {
                        cache.set(cleanUrl(data.permalink_url), data);
                    } else if (Array.isArray(data.collection)) {
                        data.collection.forEach((item) => {
                            if (item.kind === "track" && item.permalink_url) {
                                cache.set(cleanUrl(item.permalink_url), item);
                                if (item.user?.permalink_url) cache.set(cleanUrl(item.user.permalink_url), item.user);
                            } else if (item.kind === "user" && item.permalink_url) {
                                cache.set(cleanUrl(item.permalink_url), item);
                            } else if (item.kind === "playlist" && item.permalink_url) {
                                cache.set(cleanUrl(item.permalink_url), item);
                            }
                        });
                    }

                    const pageParentUrl = getParentProfileUrl(cleanUrl(location.href));
                    if (cleanUrl(location.href) === cleanUrl(data.permalink_url) || pageParentUrl === cleanUrl(data.permalink_url)) {
                        renderDashboard(data);
                    }
                }).catch((err) => {
                    console.debug(`[${SCRIPT_NAME}] Cloned response json parsing skipped`, err);
                });
            } catch (e) {
                console.debug(`[${SCRIPT_NAME}] Response clone failed`, e);
            }
        }
        return response;
    };

    /**
     * @summary Returns the active SoundCloud client_id captured from hydration or network traffic.
     * @returns {string} Client ID string or empty string.
     */
    function getClientId() {
        if (window.sc_client_id) return window.sc_client_id;
        if (window.__sc_hydration) {
            const apiClient = window.__sc_hydration.find((x) => x.hydratable === "apiClient")?.data;
            if (apiClient?.id) {
                window.sc_client_id = apiClient.id;
                return apiClient.id;
            }
        }
        console.warn(`[${SCRIPT_NAME}] Unable to resolve SoundCloud client_id from window.sc_client_id or hydration apiClient.`);
        return "";
    }

    const fetchingPlaylists = new Set();
    const fetchingUsers = new Set();

    /**
     * @summary Asynchronously backfills missing track details for playlists in batches.
     * @param {string} playlistUrl - Clean playlist permalink URL.
     * @param {number[]} incompleteTrackIds - Array of missing track IDs.
     * @returns {Promise<void>}
     */
    async function fetchIncompleteTracks(playlistUrl, incompleteTrackIds) {
        const cleanedUrl = cleanUrl(playlistUrl);
        if (fetchingPlaylists.has(cleanedUrl)) return;
        fetchingPlaylists.add(cleanedUrl);

        const clientId = getClientId();
        if (!clientId) {
            console.warn(`[${SCRIPT_NAME}] Background track backfill skipped for '${cleanedUrl}': client_id unavailable.`);
            fetchingPlaylists.delete(cleanedUrl);
            return;
        }

        const batchSize = 50;
        const tracksFetched = [];

        try {
            for (let i = 0; i < incompleteTrackIds.length; i += batchSize) {
                const chunk = incompleteTrackIds.slice(i, i + batchSize);
                const url = `https://api-v2.soundcloud.com/tracks?ids=${chunk.join(",")}&client_id=${clientId}`;
                const response = await originalFetch(url);
                if (response.ok) {
                    const data = await response.json();
                    let tracks = Array.isArray(data) ? data :
                        (data && Array.isArray(data.collection) ? data.collection :
                            (data && typeof data === "object" ? Object.values(data).filter(x => x?.kind === "track") : []));
                    tracksFetched.push(...tracks);
                } else {
                    console.error(`[${SCRIPT_NAME}] Track backfill request failed (${response.status} ${response.statusText}): ${url}`);
                }
            }

            if (tracksFetched.length > 0) {
                const fetchedMap = new Map();
                tracksFetched.forEach((t) => {
                    if (t?.id) {
                        fetchedMap.set(t.id, t);
                        if (t.permalink_url) cache.set(cleanUrl(t.permalink_url), t);
                    }
                });

                cache.merge(cleanedUrl, (playlist) => {
                    if (!playlist?.tracks) return playlist;
                    const updatedTracks = playlist.tracks.map((t) => fetchedMap.has(t.id) ? { ...t, ...fetchedMap.get(t.id) } : t);
                    const updatedPlaylist = { ...playlist, tracks: updatedTracks };

                    const parentProfileUrl = getParentProfileUrl(cleanUrl(location.href));
                    if (cleanUrl(location.href) === cleanedUrl || parentProfileUrl === cleanedUrl) {
                        renderDashboard(updatedPlaylist);
                    }
                    return updatedPlaylist;
                });
            }
        } catch (err) {
            console.error(`[${SCRIPT_NAME}] Background track backfill failed`, err);
        } finally {
            fetchingPlaylists.delete(cleanedUrl);
        }
    }

    /**
     * @summary Asynchronously backfills detailed creator stats for profiles.
     * @param {string|number} userId - Creator user ID.
     * @param {string} pageEntityUrl - Active page permalink URL.
     * @returns {Promise<void>}
     */
    async function fetchCreatorDetails(userId, pageEntityUrl) {
        if (fetchingUsers.has(userId)) return;
        fetchingUsers.add(userId);

        const clientId = getClientId();
        if (!clientId) {
            console.warn(`[${SCRIPT_NAME}] Creator details backfill skipped for user ${userId}: client_id unavailable.`);
            fetchingUsers.delete(userId);
            return;
        }

        try {
            const url = `https://api-v2.soundcloud.com/users/${userId}?client_id=${clientId}`;
            const response = await originalFetch(url);
            if (response.ok) {
                const userData = await response.json();
                if (userData?.permalink_url) {
                    const cleanUserUrl = cleanUrl(userData.permalink_url);
                    cache.set(cleanUserUrl, userData);

                    const targetUrl = cleanUrl(pageEntityUrl);
                    cache.merge(targetUrl, (activeEntity) => {
                        if (!activeEntity) return userData;

                        let updated = activeEntity;
                        if (activeEntity.kind === "user" && activeEntity.id === userId) {
                            updated = { ...activeEntity, ...userData };
                        } else if (activeEntity.user && activeEntity.user.id === userId) {
                            updated = { ...activeEntity, user: { ...activeEntity.user, ...userData } };
                        }
                        renderDashboard(updated);
                        return updated;
                    });
                }
            } else {
                console.error(`[${SCRIPT_NAME}] Creator details backfill request failed (${response.status} ${response.statusText}): ${url}`);
            }
        } catch (err) {
            console.error(`[${SCRIPT_NAME}] Creator backfill failed`, err);
        } finally {
            fetchingUsers.delete(userId);
        }
    }

    /**
     * @summary Extracts a common attribute value across a tracklist if identical for all tracks.
     * @param {Object[]} tracks - Array of track metadata objects.
     * @param {function(Object): (string|null)} getter - Attribute extractor function.
     * @returns {string|null} Common value or null if varied/absent.
     */
    function resolveCommonAttribute(tracks, getter) {
        if (!tracks || tracks.length === 0) return null;
        const validTracks = tracks.filter(t => !t.isIncomplete);
        if (validTracks.length === 0) return null;
        const values = validTracks.map(getter);
        const nonNullValues = values.filter(v => !isEmptyVal(v));
        if (nonNullValues.length !== validTracks.length) return null;
        const unique = [...new Set(nonNullValues)];
        return unique.length === 1 ? unique[0] : null;
    }

    /**
     * @summary Determines a human-readable format type label for an entity.
     * @param {Object} entity - Raw SoundCloud entity object.
     * @returns {string} Human-readable format type.
     */
    function determineFormatType(entity) {
        if (entity.kind === "user") return "Creator Profile";
        if (entity.kind === "playlist") {
            if (entity.is_album) {
                const st = (entity.set_type || "").toLowerCase().trim();
                return (st && st !== "album") ? `Album [${st.toUpperCase()}]` : "Album";
            }
            return "Playlist";
        }
        if (entity.kind === "track") return "Single / Track";
        return "Unknown Entity";
    }

    /**
     * @summary Collates release and track dates into a sorted timeline event list.
     * @param {Object} meta - Parsed entity model.
     * @returns {Array<[string, string, Element|null, Element|null, boolean]>} Array of timeline row specifications.
     */
    function parseReleaseTimeline(meta) {
        const trackBadgeText = meta.isPlaylist ? "TRACKS" : "TRACK";
        const releaseBadgeText = "RELEASE";
        const combinedBadgeText = `RELEASE, ${trackBadgeText}`;

        const makeReleaseBadge = () => badge("orange", releaseBadgeText);
        const makeTrackBadge = () => meta.isPlaylist ? badge("blue", trackBadgeText) : badge("gray", trackBadgeText);
        const makeCombinedBadges = () => el("div", { className: "sc-badge-group" }, [makeReleaseBadge(), makeTrackBadge()]);

        const relDates = {
            "Created Date": meta.createdDate,
            "Published Date": meta.publishedDate,
            "Released Date": meta.releasedDate,
            "Display Date": meta.displayDate,
            "Last Modified Date": meta.lastModified
        };

        const trkDates = {};
        if (meta.tracks.length > 0) {
            const getCommonVal = (arr, key) => {
                const first = arr[0]?.[key];
                if (isEmptyVal(first)) return null;
                return arr.every(t => t[key] === first) ? first : null;
            };

            trkDates["Created Date"] = getCommonVal(meta.tracks, "createdDate") || meta.tracks[0]?.createdDate || null;
            trkDates["Released Date"] = getCommonVal(meta.tracks, "releasedDate") || meta.tracks[0]?.releasedDate || null;
            trkDates["Display Date"] = getCommonVal(meta.tracks, "displayDate") || meta.tracks[0]?.displayDate || null;
            trkDates["Last Modified Date"] = getCommonVal(meta.tracks, "lastModified") || meta.tracks[0]?.lastModified || null;
        }

        const dateKeyMap = {
            "Created Date": "createdDate",
            "Released Date": "releasedDate",
            "Display Date": "displayDate",
            "Last Modified Date": "lastModified"
        };

        const allKeys = ["Created Date", "Published Date", "Released Date", "Display Date", "Last Modified Date"];
        const timelineItems = [];

        allKeys.forEach(key => {
            const rVal = relDates[key];
            const tVal = trkDates[key];
            const fieldKey = dateKeyMap[key];
            const baseOpts = fieldKey ? getFieldSpecOptions(fieldKey, meta) : {};

            if (rVal && tVal) {
                if (rVal === tVal) {
                    timelineItems.push([key, rVal, { ...baseOpts, sourceBadge: combinedBadgeText }, makeCombinedBadges()]);
                } else {
                    timelineItems.push([key, rVal, { ...baseOpts, sourceBadge: releaseBadgeText }, makeReleaseBadge()]);
                    timelineItems.push([key, tVal, { sourceBadge: trackBadgeText }, makeTrackBadge()]);
                }
            } else if (rVal) {
                timelineItems.push([key, rVal, { ...baseOpts, sourceBadge: releaseBadgeText }, makeReleaseBadge()]);
            } else if (tVal) {
                timelineItems.push([key, tVal, { sourceBadge: trackBadgeText }, makeTrackBadge()]);
            }
        });

        timelineItems.sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
        return timelineItems;
    }

    /** Helper function for boolean to Content Type string parsing */
    const resolveContentType = (val) => {
        if (val == null) return null;
        if (val === "Multiple") return "Multiple";
        return val ? "Music Detected" : "Spoken / Other";
    };

    /**
     * @summary Universal Single Source of Truth Field Registry for SoundCloud Metadata.
     * Defines extraction getters, labels, formatting options, hoisting rules, and commonality checks.
     */
    const FIELD_REGISTRY = {
        title: { label: "Title", getValue: e => e.title },
        artist: { label: "Artist Profile", getValue: e => e.artist || e.user?.username || e.publisher_metadata?.artist, link: e => e.user?.permalink_url, checkCommon: true },
        albumTitle: { label: "Album Title", getValue: e => e.albumTitle || e.publisher_metadata?.album_title, hoistable: true, checkCommon: true },
        label: { label: "Record Label", getValue: e => e.label || e.label_name || e.publisher_metadata?.publisher, hoistable: true, checkCommon: true },
        writerComposer: { label: "Writer / Composer", getValue: e => e.writerComposer || e.publisher_metadata?.writer_composer || e.writer_composer, hoistable: true, checkCommon: true },
        genre: { label: "Genre", getValue: e => e.genre, hoistable: true, checkCommon: true },
        tags: { label: "Tags", getValue: e => e.tags || e.tag_list || null, format: "tags", hoistable: true, checkCommon: true },
        bpm: { label: "BPM", getValue: e => e.bpm ? String(e.bpm) : null, checkCommon: true },
        keySignature: { label: "Key Signature", getValue: e => e.keySignature || e.key_signature, checkCommon: true },
        pLine: { label: "℗ Line", getValue: e => e.pLine || e.publisher_metadata?.p_line || e.publisher_metadata?.p_line_for_display, hoistable: true, checkCommon: true },
        cLine: { label: "© Line", getValue: e => e.cLine || e.publisher_metadata?.c_line || e.publisher_metadata?.c_line_for_display, hoistable: true, checkCommon: true },
        license: { label: "Rights License", getValue: e => e.license, format: "mono", hoistable: true, checkCommon: true },
        upc: { label: "UPC / EAN Barcode", getValue: e => e.upc || e.publisher_metadata?.upc_or_ean, format: "upc", hoistable: true, checkCommon: true },
        isrc: { label: "ISRC", getValue: e => e.isrc || e.publisher_metadata?.isrc, format: "isrc", checkCommon: false },
        id: { label: "Track ID", getValue: e => e.id ? String(e.id) : null, format: "mono", checkCommon: false },
        urn: { label: "Track URN", getValue: e => e.urn, format: "mono", checkCommon: false },
        createdDate: { label: "Uploaded Date", getValue: e => e.createdDate || (e.created_at ? formatDate(e.created_at) : null), hoistable: true, checkCommon: true },
        releasedDate: { label: "Released Date", getValue: e => e.releasedDate || (e.release_date ? formatDate(e.release_date) : (e.display_date ? formatDate(e.display_date) : null)), hoistable: true, checkCommon: true },
        displayDate: { label: "Displayed Date", getValue: e => e.displayDate || (e.display_date ? formatDate(e.display_date) : null), hoistable: true, checkCommon: true },
        lastModified: { label: "Last Modified", getValue: e => e.lastModified || (e.last_modified ? formatDate(e.last_modified) : null), hoistable: true, checkCommon: true },
        containsMusic: { label: "Content Type", getValue: e => resolveContentType(e.containsMusic ?? e.contains_music ?? e.publisher_metadata?.contains_music), badge: e => e.containsMusic === "Multiple" ? "orange" : (e.contains_music ? "teal" : "gray"), hoistable: true },
        policy: { label: "Policy", getValue: e => e.policy || null, badge: e => e.policy === "ALLOW" ? "blue" : (e.policy === "Multiple" ? "orange" : "red"), hoistable: true },
        monetizationModel: { label: "Monetization Model", getValue: e => e.monetizationModel || e.monetization_model || null, badge: e => e.monetizationModel === "Multiple" ? "orange" : "purple", hoistable: true },
        commentable: { label: "Comments Enabled", getValue: e => e.commentable != null ? (e.commentable === "Multiple" ? "Multiple" : (e.commentable ? "Yes" : "No")) : null, badge: e => e.commentable ? "green" : "gray", hoistable: true },
        streamable: { label: "Streamable", getValue: e => e.streamable != null ? (e.streamable === "Multiple" ? "Multiple" : (e.streamable ? "Yes" : "No")) : null, badge: e => e.streamable ? "green" : "gray", hoistable: true },
        downloadable: { label: "Downloadable", getValue: e => e.downloadable != null ? (e.downloadable === "Multiple" ? "Multiple" : (typeof e.downloadable === "string" ? e.downloadable : (e.downloadable ? `Yes (${formatNumber(e.downloadCount || e.download_count || 0)})` : "No"))) : null, badge: e => e.downloadable ? "green" : "gray", hoistable: true }
    };

    /**
     * @summary Resolves formatting options for a FIELD_REGISTRY key, including hoisted state.
     * @param {string} key - The FIELD_REGISTRY key.
     * @param {Object} meta - The normalized entity model.
     * @param {Object} [extraOpts] - Additional UI options (e.g., link, switchTab).
     * @returns {Object} Combined options object.
     */
    function getFieldSpecOptions(key, meta, extraOpts = {}) {
        const spec = FIELD_REGISTRY[key] || {};
        return {
            ...(spec.format ? { format: spec.format } : {}),
            ...(spec.mono ? { mono: spec.mono } : {}),
            isHoisted: Boolean(meta?.hoistedKeys?.has(key)),
            ...extraOpts
        };
    }

    /**
     * @summary Normalizes a raw SoundCloud API entity into a structured model.
     * @param {Object} entity - Raw SoundCloud API response object.
     * @returns {Object|null} Normalized entity model.
     */
    function parseEntity(entity) {
        if (!entity) return null;

        const isUser = entity.kind === "user";
        const isPlaylist = entity.kind === "playlist";
        const isTrack = entity.kind === "track";
        const rawTracks = isPlaylist ? (entity.tracks || []) : (isUser ? [] : [entity]);

        const normalizedTracks = rawTracks.map((t) => {
            const isIncomplete = t.kind === "track" && (!t.title || !t.permalink_url);
            const isSnippet = t.duration && t.full_duration && (t.duration < t.full_duration) && (t.policy === "SNIP");
            const trackLabel = t.label_name || t.publisher_metadata?.publisher || entity.publisher_metadata?.publisher || null;
            return {
                id: t.id,
                urn: t.urn || null,
                permalinkUrl: t.permalink_url || null,
                title: t.title || "Loading track details...",
                isrc: t.publisher_metadata?.isrc || null,
                upc: t.publisher_metadata?.upc_or_ean || null,
                user: t.user || null,
                artist: t.publisher_metadata?.artist || t.user?.username || "—",
                albumTitle: t.publisher_metadata?.album_title || null,
                writerComposer: t.publisher_metadata?.writer_composer || t.writer_composer || null,
                label: trackLabel,
                genre: t.genre || null,
                tags: t.tag_list || "",
                bpm: t.bpm || null,
                keySignature: t.key_signature || null,
                duration: formatTime(t.duration),
                fullDuration: formatTime(t.full_duration),
                isSnippet,
                explicit: t.publisher_metadata?.explicit || t.explicit || false,
                containsMusic: t.publisher_metadata?.contains_music ?? true,
                commentable: t.commentable ?? true,
                streamable: t.streamable ?? true,
                playbackCount: t.playback_count ?? 0,
                likesCount: t.likes_count ?? 0,
                repostsCount: t.reposts_count ?? 0,
                commentCount: t.comment_count ?? 0,
                downloadable: t.downloadable ?? false,
                downloadCount: t.download_count ?? 0,
                waveformUrl: t.waveform_url || null,
                transcodings: t.media?.transcodings || [],
                policy: t.policy || "ALLOW",
                monetizationModel: t.monetization_model || "N/A",
                sharing: t.sharing || "public",
                isIncomplete: isIncomplete,

                createdDate: formatDate(t.created_at),
                releasedDate: formatDate(t.release_date),
                displayDate: formatDate(t.display_date),
                lastModified: formatDate(t.last_modified),

                pLine: t.publisher_metadata?.p_line || null,
                cLine: t.publisher_metadata?.c_line || null
            };
        });

        const associatedUser = isUser ? entity : (entity.user || {});
        const badgesList = [];
        if (associatedUser.verified) badgesList.push("Verified");
        if (associatedUser.badges?.pro_unlimited) badgesList.push("Pro Unlimited");
        else if (associatedUser.badges?.pro) badgesList.push("Pro");
        if (associatedUser.badges?.creator_mid_tier) badgesList.push("Mid Tier");

        const validTracksForUpc = normalizedTracks.filter(t => !t.isIncomplete);
        const trackUpcs = validTracksForUpc.map(t => t.upc).filter(Boolean);
        const uniqueTrackUpcs = [...new Set(trackUpcs)];
        const hasUpcVariations = uniqueTrackUpcs.length > 1;

        // Automated hoisting for hoistable fields via FIELD_REGISTRY
        const hoistedValues = {};
        const hoistedKeys = new Set();
        Object.entries(FIELD_REGISTRY).forEach(([key, spec]) => {
            if (!spec.hoistable) return;
            const rootVal = spec.getValue(entity);
            if (!isEmptyVal(rootVal)) {
                hoistedValues[key] = rootVal;
                if (isPlaylist) {
                    hoistedKeys.add(key);
                }
            } else if (isPlaylist && normalizedTracks.length > 0) {
                const commonVal = resolveCommonAttribute(normalizedTracks, spec.getValue);
                if (commonVal) {
                    hoistedValues[key] = commonVal;
                    hoistedKeys.add(key);
                }
            }
        });

        let rootUpc = entity.publisher_metadata?.upc_or_ean || hoistedValues.upc || null;
        if (isPlaylist && !rootUpc) {
            if (trackUpcs.length === validTracksForUpc.length && validTracksForUpc.length > 0 && uniqueTrackUpcs.length === 1) {
                rootUpc = uniqueTrackUpcs[0];
            } else if (hasUpcVariations) {
                rootUpc = "Multiple";
            }
        }

        const cityClean = associatedUser.city?.trim() || null;
        const countryClean = associatedUser.country_code?.trim() || null;
        const fullNameClean = associatedUser.full_name?.trim() || null;
        const firstLastClean = (associatedUser.first_name || associatedUser.last_name) ? `${associatedUser.first_name || ""} ${associatedUser.last_name || ""}`.trim() : null;

        const formatType = determineFormatType(entity);

        return {
            raw: entity,
            isUser,
            isPlaylist,
            isTrack,
            type: formatType,
            title: isUser ? (entity.username || "—") : (entity.title || "Untitled"),
            user: associatedUser.username || "—",
            userId: associatedUser.id || null,
            userUrn: associatedUser.urn || null,
            entityUrn: entity.urn || null,
            profileUrl: associatedUser.permalink_url || "#",
            permalinkUrl: entity.permalink_url || null,
            apiUri: entity.uri || null,
            embeddableBy: entity.embeddable_by || null,
            managedByFeeds: entity.managed_by_feeds ?? null,
            genre: entity.genre || hoistedValues.genre || null,
            albumTitle: hoistedValues.albumTitle || null,
            bpm: entity.bpm || null,
            keySignature: entity.key_signature || null,
            commentable: entity.commentable ?? hoistedValues.commentable ?? true,
            streamable: entity.streamable ?? hoistedValues.streamable ?? true,
            containsMusic: entity.contains_music ?? hoistedValues.containsMusic ?? null,
            policy: entity.policy || hoistedValues.policy || null,
            monetizationModel: entity.monetization_model || hoistedValues.monetizationModel || null,
            downloadable: entity.downloadable ?? hoistedValues.downloadable ?? null,
            writerComposer: hoistedValues.writerComposer || null,
            upc: rootUpc || "—",
            hasUpcVariations,
            label: hoistedValues.label || "—",
            pLine: hoistedValues.pLine || null,
            cLine: hoistedValues.cLine || null,
            sharing: entity.sharing || "public",
            license: entity.license || hoistedValues.license || "all-rights-reserved",
            likesCount: entity.likes_count ?? 0,
            repostsCount: entity.reposts_count ?? 0,
            trackCount: isPlaylist ? (entity.track_count ?? rawTracks.length) : (isUser ? (entity.track_count ?? 0) : 1),
            purchaseUrl: entity.purchase_url || null,
            purchaseTitle: entity.purchase_title || null,
            artworkUrl: entity.artwork_url || associatedUser.avatar_url || "",
            secretToken: entity.secret_token || null,
            tags: entity.tag_list || hoistedValues.tags || "",

            createdDate: formatDate(entity.created_at) || hoistedValues.createdDate || null,
            publishedDate: formatDate(entity.published_at) || null,
            releasedDate: formatDate(entity.release_date) || (entity.display_date ? formatDate(entity.display_date) : null) || hoistedValues.releasedDate || null,
            displayDate: formatDate(entity.display_date) || hoistedValues.displayDate || null,
            lastModified: formatDate(entity.last_modified) || hoistedValues.lastModified || null,
            hoistedKeys,

            creator: {
                id: associatedUser.id || "—",
                city: cityClean,
                countryCode: countryClean,
                followers: associatedUser.followers_count ?? null,
                followings: associatedUser.followings_count ?? null,
                groupsCount: associatedUser.groups_count ?? null,
                stationUrn: associatedUser.station_urn || null,
                stationPermalink: associatedUser.station_permalink || null,
                trackCount: associatedUser.track_count ?? 0,
                playlistCount: associatedUser.playlist_count ?? 0,
                likesCount: associatedUser.likes_count ?? 0,
                playlistLikes: associatedUser.playlist_likes_count ?? 0,
                repostsCount: associatedUser.reposts_count ?? null,
                description: associatedUser.description || "",
                badges: badgesList,
                bannerUrl: associatedUser.visuals?.visuals?.[0]?.visual_url || null,
                realName: fullNameClean || firstLastClean,
                subscriptionProduct: associatedUser.creator_subscription?.product?.id || associatedUser.creator_subscriptions?.[0]?.product?.id || null,
                createdDate: formatDate(associatedUser.created_at),
                lastModified: formatDate(associatedUser.last_modified),
                commentsCount: associatedUser.comments_count ?? null
            },

            tracks: normalizedTracks
        };
    }

    function formatProStatus(c) {
        const subProduct = c.subscriptionProduct && c.subscriptionProduct !== "free"
            ? c.subscriptionProduct.replace(/^creator-/, "").replace(/[-_]/g, " ").toUpperCase()
            : null;
        const badgeList = c.badges.filter(b => b !== "Verified");

        const labels = [];
        if (subProduct) labels.push(subProduct);
        badgeList.forEach(b => {
            const bNorm = b.toUpperCase().replace(/[-_]/g, " ");
            if (!subProduct || !subProduct.includes(bNorm)) {
                labels.push(b);
            }
        });

        return labels.length > 0 ? labels.join(", ") : "Free Account";
    }

    /**
     * @summary Generates a single-source-of-truth InspectorSpec tree for the active tab.
     * @param {Object} meta - Normalized entity model from parseEntity().
     * @param {string} tab - Currently active tab identifier.
     * @returns {InspectorSpec} Declarative spec containing section and field definitions.
     */
    function generateInspectorSpec(meta, tab, opts = {}) {
        const sections = getTabSchema(meta, tab, opts);
        return {
            title: meta.title,
            type: meta.type,
            user: meta.user,
            artworkUrl: meta.artworkUrl,
            profileUrl: meta.profileUrl,
            isUser: meta.isUser,
            activeTab: tab,
            sections: sections || []
        };
    }

    function getCreatorSections(meta) {
        const c = meta.creator;
        const proBadgesStr = formatProStatus(c);
        const locationStr = [c.city, c.countryCode].filter(Boolean).join(", ");

        return [
            {
                title: "CREATOR PROFILE",
                items: [
                    ["Name", meta.user],
                    c.realName ? ["Real Name", c.realName] : null,
                    locationStr ? ["Location Base", locationStr] : null,
                    ["Followers", c.followers !== null ? formatNumber(c.followers) : "Loading..."],
                    ["Following", c.followings !== null ? formatNumber(c.followings) : "Loading..."],
                    ["Public Tracks", formatNumber(c.trackCount)],
                    ["Playlists Formed", formatNumber(c.playlistCount)],
                    ["Pro Status", proBadgesStr, { badge: proBadgesStr !== "Free Account" ? "indigo" : "gray" }],
                    ["Account Created", c.createdDate],
                    ["Account Modified", c.lastModified]
                ].filter(item => item && !isEmptyVal(item[1]))
            },
            {
                title: "ACTIVITY METRICS",
                items: [
                    ["Likes Submitted", formatNumber(c.likesCount)],
                    ["Liked Playlists", formatNumber(c.playlistLikes)],
                    ["Comments Written", c.commentsCount !== null ? formatNumber(c.commentsCount) : null],
                    ["Groups Joined", c.groupsCount !== null ? formatNumber(c.groupsCount) : null]
                ].filter(item => item && !isEmptyVal(item[1]))
            },
            c.description ? {
                title: "CREATOR BIO",
                items: [],
                customText: c.description
            } : null
        ].filter(Boolean);
    }

    function getReleaseSections(meta) {
        if (meta.isUser) {
            return getCreatorSections(meta);
        }

        const showAlbumTitle = meta.albumTitle && (meta.albumTitle.trim().toLowerCase() !== meta.title.trim().toLowerCase());

        const releaseItems = [
            ["Title", meta.title],
            ["Artist Profile", meta.user, { link: meta.profileUrl }],
            ["Format Type", meta.type, { badge: "orange" }],
            ["Total Tracks", meta.trackCount],
            ["Total Duration", formatTime(meta.raw.duration)],
            ["Release Likes", formatNumber(meta.likesCount)],
            ["Release Reposts", formatNumber(meta.repostsCount)],
            showAlbumTitle ? ["Album Title", meta.albumTitle, getFieldSpecOptions("albumTitle", meta)] : null,
            ["Writer / Composer", meta.writerComposer, getFieldSpecOptions("writerComposer", meta)],
            ["Genre", meta.genre, getFieldSpecOptions("genre", meta)],
            ["BPM", meta.bpm, getFieldSpecOptions("bpm", meta)],
            ["Key Signature", meta.keySignature, getFieldSpecOptions("keySignature", meta)],
            ["℗ Line", meta.pLine, getFieldSpecOptions("pLine", meta)],
            ["© Line", meta.cLine, getFieldSpecOptions("cLine", meta)],
            ["Record Label", meta.label, getFieldSpecOptions("label", meta)],
            ["Rights License", meta.license, getFieldSpecOptions("license", meta)],
            ["UPC / EAN Barcode", meta.upc, meta.hasUpcVariations ? getFieldSpecOptions("upc", meta, { badge: "orange", switchTab: "tracks" }) : getFieldSpecOptions("upc", meta)],
            ["Buy Link", meta.purchaseUrl, meta.purchaseUrl ? { link: meta.purchaseUrl, linkText: meta.purchaseTitle || "Store Link" } : null]
        ].filter(item => item && !isEmptyVal(item[1]));

        const releaseTimelineItems = parseReleaseTimeline(meta);

        return [
            {
                title: "RELEASE DETAIL",
                items: releaseItems
            },
            meta.raw.description ? {
                title: "RELEASE DESCRIPTION",
                items: [],
                customText: meta.raw.description
            } : null,
            {
                title: "TIMELINE",
                items: releaseTimelineItems
            },
            !isEmptyVal(meta.tags) ? {
                title: "RELEASE TAGS",
                items: [["Tags", meta.tags, { format: "tags" }]]
            } : null
        ].filter(Boolean);
    }

    function getTracksSections(meta, opts = {}) {
        const c = meta.creator;

        if (meta.isUser) {
            return [
                {
                    title: "ACTIVITY METRICS",
                    items: [
                        ["Public Tracks", formatNumber(c.trackCount)],
                        ["Playlists Formed", formatNumber(c.playlistCount)],
                        ["Likes Submitted", formatNumber(c.likesCount)],
                        ["Liked Playlists", formatNumber(c.playlistLikes)],
                        ["Comments Written", formatNumber(c.commentsCount)],
                        ["Groups Joined", c.groupsCount !== null ? formatNumber(c.groupsCount) : null]
                    ].filter(item => item && !isEmptyVal(item[1]))
                }
            ];
        }

        return meta.tracks.map((t, i) => {
            const trackItems = getTrackFieldItems(t, meta, opts);
            return {
                title: `TRACK ${i + 1}: ${t.title}`,
                items: trackItems,
                isTrackCard: true,
                trackData: t,
                trackIndex: i
            };
        });
    }

    function getTechSections(meta) {
        const c = meta.creator;

        if (meta.isUser) {
            return [{
                title: "TECHNICAL METADATA",
                items: [
                    ["Creator ID", c.id, { mono: true }],
                    ["Creator URN", meta.userUrn, { mono: true }],
                    c.stationUrn ? ["Station URN", c.stationUrn, { mono: true }] : null,
                    c.stationPermalink ? ["Station Permalink", c.stationPermalink] : null,
                    ["API URI", meta.apiUri],
                    ["Permalink URL", meta.profileUrl]
                ].filter(Boolean)
            }];
        }

        const presetMap = new Map();
        const totalTracks = meta.tracks.length;

        meta.tracks.forEach((t, trackIndex) => {
            (t.transcodings || []).forEach(tr => {
                const key = `${tr.preset}|${tr.format?.protocol || 'N/A'}|${tr.quality || 'sq'}`;
                if (!presetMap.has(key)) {
                    presetMap.set(key, {
                        preset: tr.preset,
                        protocol: tr.format?.protocol || 'N/A',
                        quality: tr.quality || 'sq',
                        trackIndexes: []
                    });
                }
                presetMap.get(key).trackIndexes.push(trackIndex + 1);
            });
        });

        const presetsNodes = [];
        if (presetMap.size > 0) {
            presetMap.forEach((info) => {
                const isAllTracks = totalTracks === 1 || info.trackIndexes.length === totalTracks;
                const rangeStr = formatTrackRanges(info.trackIndexes);
                const trackTag = isAllTracks
                    ? (totalTracks > 1 ? badge("gray", "All Tracks") : null)
                    : badge("orange", `Tracks ${rangeStr}`);

                const detailSpan = el("span", { className: "sc-preset-detail" }, [
                    document.createTextNode(`${info.protocol} (${info.quality}) `),
                    trackTag
                ]);

                presetsNodes.push(el("div", { className: "sc-preset-item" }, [
                    el("span", { className: "sc-preset-name", textContent: info.preset }),
                    detailSpan
                ]));
            });
        } else {
            presetsNodes.push(el("div", { className: "sc-notice-box", textContent: "No active stream presets detected." }));
        }

        return [
            {
                title: "STREAM PRESETS",
                items: [],
                customUI: presetsNodes
            },
            {
                title: "TECHNICAL METADATA",
                items: [
                    ["Visibility Status", meta.sharing, { badge: meta.sharing === "public" ? "blue" : "orange" }],
                    meta.containsMusic != null ? ["Content Type", meta.containsMusic === "Multiple" ? "Multiple" : (meta.containsMusic ? "Music Detected" : "Spoken / Other"), getFieldSpecOptions("containsMusic", meta, { badge: meta.containsMusic === "Multiple" ? "orange" : (meta.containsMusic ? "teal" : "gray") })] : null,
                    meta.policy ? ["Policy", meta.policy, getFieldSpecOptions("policy", meta, { badge: meta.policy === "ALLOW" ? "blue" : (meta.policy === "Multiple" ? "orange" : "red") })] : null,
                    meta.monetizationModel ? ["Monetization Model", meta.monetizationModel, getFieldSpecOptions("monetizationModel", meta, { badge: meta.monetizationModel === "Multiple" ? "orange" : "purple" })] : null,
                    meta.commentable != null ? ["Comments Enabled", meta.commentable === "Multiple" ? "Multiple" : (meta.commentable ? "Yes" : "No"), getFieldSpecOptions("commentable", meta, { badge: meta.commentable === "Multiple" ? "orange" : (meta.commentable ? "green" : "gray") })] : null,
                    meta.streamable != null ? ["Streamable", meta.streamable === "Multiple" ? "Multiple" : (meta.streamable ? "Yes" : "No"), getFieldSpecOptions("streamable", meta, { badge: meta.streamable === "Multiple" ? "orange" : (meta.streamable ? "green" : "gray") })] : null,
                    meta.downloadable != null ? ["Downloadable", meta.downloadable === "Multiple" ? "Multiple" : (typeof meta.downloadable === "string" ? meta.downloadable : (meta.downloadable ? `Yes (${formatNumber(meta.raw.download_count || 0)})` : "No")), getFieldSpecOptions("downloadable", meta, { badge: meta.downloadable === "Multiple" ? "orange" : (meta.downloadable ? "green" : "gray") })] : null,
                    ["Embeddable By", meta.embeddableBy, meta.embeddableBy ? { badge: "amber" } : null],
                    meta.managedByFeeds != null ? ["Managed By Feeds", meta.managedByFeeds ? "Yes" : "No", { badge: meta.managedByFeeds ? "green" : "gray" }] : null,
                    meta.secretToken ? ["Secret Token", meta.secretToken, { mono: true }] : null,
                    ["Entity ID", meta.raw.id, getFieldSpecOptions("id", meta)],
                    ["Entity URN", meta.entityUrn, getFieldSpecOptions("urn", meta)],
                    ["API URI", meta.apiUri],
                    ["Permalink URL", meta.permalinkUrl]
                ].filter(Boolean)
            }
        ].filter(Boolean);
    }

    function getTabSchema(meta, tabId, opts = {}) {
        const tabDef = TAB_REGISTRY.find(t => t.id === tabId);
        return tabDef ? tabDef.getSections(meta, opts) : [];
    }

    const OMIT_FROM_TRACK_CARDS = new Set(["title", "artist", "license"]);

    /**
     * @summary Extracts metadata field row tuples for a track item.
     * @param {Object} track - Normalized track metadata object.
     * @param {Object} [meta] - Normalized entity metadata model.
     * @param {Object} [opts] - Spec generation options ({ isExport: boolean }).
     * @returns {Array<[string, string|number|null, Element|null, Element|null, boolean]>} Array of field tuples.
     */
    function getTrackFieldItems(track, meta, opts = {}) {
        if (!track || track.isIncomplete) return [];

        return Object.entries(FIELD_REGISTRY)
            .filter(([key]) => !OMIT_FROM_TRACK_CARDS.has(key))
            .filter(([key, spec]) => {
                if (!opts.isExport && meta?.hoistedKeys?.has(key)) {
                    const trackVal = spec.getValue(track);
                    const hoistedVal = meta[key] ?? meta.hoistedValues?.[key];
                    if (trackVal === hoistedVal) return false;
                }
                return true;
            })
            .map(([key, spec]) => {
                const val = spec.getValue(track);
                if (isEmptyVal(val)) return null;

                return [
                    spec.label,
                    val,
                    {
                        badge: spec.badge ? spec.badge(track) : null,
                        format: spec.format,
                        link: spec.link ? spec.link(track) : null,
                        mono: spec.format === "mono"
                    }
                ];
            })
            .filter(Boolean);
    }

    function renderTrackCard(sec) {
        const track = sec.trackData;
        const i = sec.trackIndex;
        const trackCard = el("div", { className: `sc-track-card ${track.isIncomplete ? "sc-track-incomplete" : ""}` });

        const titleNode = el("div", { className: "sc-track-title" }, [
            document.createTextNode(`${i + 1}. `),
            track.permalinkUrl ? el("a", { href: track.permalinkUrl, target: "_blank", className: "sc-entity-subtitle-link", textContent: track.title }) : document.createTextNode(track.title),
            track.explicit ? badge("red", "E", "sc-badge-explicit") : null
        ]);

        const artistNode = track.user?.permalink_url
            ? el("a", { href: track.user.permalink_url, target: "_blank", className: "sc-entity-subtitle-link", textContent: track.artist })
            : document.createTextNode(track.artist);

        const leftHeader = el("div", { className: "sc-track-header-left" }, [
            titleNode,
            track.isIncomplete ? null : el("div", { className: "sc-track-author" }, [document.createTextNode("Artist: "), artistNode]),
            track.isIncomplete ? null : el("div", { className: "sc-track-stats" }, [
                el("span", { textContent: `▶ ${formatNumber(track.playbackCount)}` }),
                el("span", { textContent: `♥ ${formatNumber(track.likesCount)}` }),
                el("span", { textContent: `🔄 ${formatNumber(track.repostsCount)}` }),
                el("span", { textContent: `💬 ${formatNumber(track.commentCount)}` })
            ])
        ]);

        const rightHeader = el("div", { className: "sc-track-header-right" }, [
            track.isIncomplete ? null : badge("gray", track.fullDuration || track.duration),
            track.isSnippet ? badge("red", `Preview [${track.duration}]`) : null
        ]);

        trackCard.appendChild(el("div", { className: "sc-track-header" }, [leftHeader, rightHeader]));

        if (!track.isIncomplete) {
            const metaSection = el("div", { className: "sc-track-meta" });
            const fieldItems = (sec.items && sec.items.length > 0) ? sec.items : getTrackFieldItems(track);

            const rows = fieldItems.map(([label, textVal, uiVal, middleNode, isFaded]) => {
                return metaRow(label, textVal, uiVal, middleNode, isFaded);
            }).filter(Boolean);

            if (rows.length > 0) {
                metaSection.appendChild(el("div", { className: "sc-track-timeline" }, rows));
            }

            trackCard.appendChild(metaSection);
        }

        return trackCard;
    }

    function renderSections(sections) {
        const fragment = document.createDocumentFragment();
        sections.filter(Boolean).forEach(sec => {
            if (sec.isTrackCard) {
                fragment.appendChild(renderTrackCard(sec));
                return;
            }

            const rows = (sec.items || []).filter(Boolean).map(([label, textVal, uiVal, middleNode, isFaded]) => {
                return metaRow(label, textVal, uiVal, middleNode, isFaded);
            }).filter(Boolean);

            const customUI = Array.isArray(sec.customUI) ? sec.customUI : (sec.customUI ? [sec.customUI] : []);
            if (customUI.length === 0 && sec.customText) {
                customUI.push(el("div", { className: "sc-bio-box", textContent: sec.customText }));
            }
            const children = [...rows, ...customUI];

            const grp = metaGroup(sec.title, children);
            if (grp) fragment.appendChild(grp);
        });
        return fragment;
    }

    /**
     * @summary Renders tab header and section body from an InspectorSpec tree.
     * @param {InspectorSpec} spec - The InspectorSpec blueprint.
     * @param {Object} meta - The normalized entity model.
     * @returns {DocumentFragment} Rendered DOM fragment.
     */
    function buildTabContentFromSpec(spec, meta) {
        const fragment = document.createDocumentFragment();

        if (spec.activeTab === "release") {
            if (spec.isUser) {
                if (meta.creator.bannerUrl) {
                    const banner = el("div", { className: "sc-creator-banner" });
                    banner.style.backgroundImage = `url('${meta.creator.bannerUrl}')`;
                    fragment.appendChild(banner);
                }

                const titleText = el("span", { className: "sc-entity-title" }, [
                    document.createTextNode(spec.title),
                    meta.creator.badges.includes("Verified") ? el("span", { className: "sc-verified-badge", title: "Verified Artist", textContent: "☑" }) : null
                ]);

                fragment.appendChild(el("div", { className: "sc-entity-header" }, [
                    spec.artworkUrl ? el("img", { src: formatImgUrl(spec.artworkUrl, true), className: "sc-avatar-circle" }) : null,
                    el("div", { className: "sc-entity-details" }, [
                        titleText,
                        el("span", { className: "sc-entity-subtitle", textContent: "Creator Profile" })
                    ])
                ]));
            } else {
                fragment.appendChild(el("div", { className: "sc-entity-header" }, [
                    spec.artworkUrl ? el("img", { src: formatImgUrl(spec.artworkUrl, false), className: "sc-avatar-square" }) : null,
                    el("div", { className: "sc-entity-details" }, [
                        el("span", { className: "sc-entity-title-truncate", textContent: spec.title }),
                        el("span", { className: "sc-entity-subtitle" }, [
                            spec.profileUrl
                                ? el("a", { href: spec.profileUrl, target: "_blank", className: "sc-entity-subtitle-link", textContent: spec.user })
                                : document.createTextNode(spec.user)
                        ])
                    ])
                ]));
            }
        }

        fragment.appendChild(renderSections(spec.sections));
        return fragment;
    }

    /**
     * @summary Renders or updates the main SoundCloud Metadata Inspector dashboard UI.
     * @param {Object} rawData - Raw entity response payload from SoundCloud.
     */
    function renderDashboard(rawData) {
        if (!rawData) return;

        extractMeUser();

        if (meUserId && rawData.id === meUserId && rawData.kind === "user") {
            removePanel();
            return;
        }

        const meta = parseEntity(rawData);
        if (!meta) return;

        const availableTabs = TAB_REGISTRY.filter(t => t.show(meta)).map(t => t.id);
        if (!availableTabs.includes(currentActiveTab)) {
            currentActiveTab = availableTabs[0] || "release";
        }

        window._sc_active_meta = meta;

        if (rawData.kind === "playlist" && rawData.tracks) {
            const incompleteIds = rawData.tracks.filter(t => t.kind === "track" && (!t.title || !t.permalink_url)).map(t => t.id);
            if (incompleteIds.length > 0) fetchIncompleteTracks(rawData.permalink_url, incompleteIds);
        }

        if (meta.userId) {
            const cachedUser = cache.get(cleanUrl(meta.profileUrl));
            const needsBackfill = !cachedUser || cachedUser.followers_count === undefined || (meta.isUser && !cachedUser.created_at);
            if (needsBackfill) {
                fetchCreatorDetails(meta.userId, rawData.permalink_url);
            }
        }

        removePanel();
        injectStyles();

        const container = el("div", { id: PANEL_ID });
        container.style.display = isMinimized ? "none" : "block";

        const pill = el("div", { className: "sc-minimized-pill", id: `${PANEL_ID}-pill` }, [
            createIcon("inspector", 15),
            el("span", { textContent: "Show Inspector" })
        ]);
        pill.style.display = isMinimized ? "flex" : "none";
        pill.addEventListener("click", () => toggleMinimize(false));

        const wrapper = el("div", { className: "sc-dashboard-wrapper" });

        const exportToggleBtn = el("button", { className: "sc-control-btn", id: "sc-export-toggle-btn", title: "Export Panel Content" }, [
            createIcon("export", 14)
        ]);

        const minimizeBtn = el("button", { className: "sc-control-btn", id: "sc-minimize-btn", title: "Minimize" }, [
            createIcon("minimize", 14)
        ]);

        const activeTabLabel = TAB_REGISTRY.find(t => t.id === currentActiveTab)?.getLabel(meta) || "Current Tab";
        const exportMenuItems = [
            el("button", { className: "sc-export-item", dataset: { action: "raw" }, textContent: "Copy Raw JSON" }),
            el("button", { className: "sc-export-item", dataset: { action: "current" }, textContent: `Copy ${activeTabLabel} Tab Data` })
        ];

        if (!meta.isUser && meta.isPlaylist) {
            exportMenuItems.push(
                el("button", { className: "sc-export-item", dataset: { action: "mb" }, textContent: "Copy MusicBrainz Tracklist" })
            );
        }

        const exportMenu = el("div", { className: "sc-export-menu", id: "sc-export-menu" }, exportMenuItems);

        const header = el("div", { className: "sc-dashboard-header" }, [
            el("div", { className: "sc-dashboard-title" }, [
                createIcon("inspector", 16),
                el("span", { textContent: "SC Inspector" })
            ]),
            el("div", { className: "sc-dashboard-controls" }, [exportToggleBtn, minimizeBtn]),
            exportMenu
        ]);

        const tabButtons = TAB_REGISTRY.filter(t => t.show(meta)).map(t => {
            return el("button", {
                className: `sc-tab-btn ${currentActiveTab === t.id ? "active" : ""}`,
                dataset: { tab: t.id },
                textContent: t.getLabel(meta)
            });
        });

        const tabs = el("div", { className: "sc-dashboard-tabs" }, tabButtons);

        const spec = generateInspectorSpec(meta, currentActiveTab);
        const body = el("div", { className: "sc-dashboard-body" }, [buildTabContentFromSpec(spec, meta)]);

        wrapper.appendChild(header);
        wrapper.appendChild(tabs);
        wrapper.appendChild(body);
        container.appendChild(wrapper);

        document.body.appendChild(container);
        document.body.appendChild(pill);

        bindEventListeners(meta, container);
    }

    function bindEventListeners(meta, container) {
        container.querySelectorAll(".sc-tab-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const targetTab = e.currentTarget.getAttribute("data-tab");
                if (targetTab) {
                    currentActiveTab = targetTab;
                    renderDashboard(meta.raw);
                }
            });
        });

        container.querySelectorAll("[data-switch-tab]").forEach(el => {
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                const targetTab = e.currentTarget.getAttribute("data-switch-tab");
                if (targetTab) {
                    currentActiveTab = targetTab;
                    renderDashboard(meta.raw);
                }
            });
        });

        const exportBtn = container.querySelector("#sc-export-toggle-btn");
        const exportMenu = container.querySelector("#sc-export-menu");
        if (exportBtn && exportMenu) {
            exportBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                exportMenu.classList.toggle("show");
            });
        }

        container.querySelectorAll(".sc-export-item").forEach(item => {
            item.addEventListener("click", (e) => {
                e.stopPropagation();
                exportData(e.target.getAttribute("data-action"), meta, e.target);
                setTimeout(() => exportMenu?.classList.remove("show"), 1000);
            });
        });

        document.addEventListener("click", () => exportMenu?.classList.remove("show"));
        container.querySelector("#sc-minimize-btn")?.addEventListener("click", () => toggleMinimize(true));
    }

    function toggleMinimize(minimize) {
        isMinimized = minimize;
        saveSettings({ minimized: isMinimized });

        const container = document.getElementById(PANEL_ID);
        const pill = document.getElementById(`${PANEL_ID}-pill`);

        if (container && pill) {
            container.style.display = minimize ? "none" : "block";
            pill.style.display = minimize ? "flex" : "none";
        }
    }

    function removePanel() {
        document.getElementById(PANEL_ID)?.remove();
        document.getElementById(`${PANEL_ID}-pill`)?.remove();
    }

    function getParentProfileUrl(url) {
        const match = url.match(/^(https:\/\/soundcloud\.com\/[^/]+)(?:\/(?:tracks|sets|albums|reposts|popular-tracks))?$/);
        return match ? match[1] : url;
    }

    async function resolveCurrentUrl(targetUrl) {
        const clientId = getClientId();
        if (!clientId) return;

        try {
            const res = await originalFetch(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(targetUrl)}&client_id=${clientId}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.permalink_url) {
                    const cleanDataUrl = cleanUrl(data.permalink_url);
                    cache.set(cleanDataUrl, data);
                    if (data.kind === "playlist" && data.tracks) {
                        data.tracks.forEach(t => {
                            if (t.permalink_url) cache.set(cleanUrl(t.permalink_url), t);
                        });
                    }
                    if (cleanUrl(location.href) === cleanDataUrl || getParentProfileUrl(cleanUrl(location.href)) === cleanDataUrl) {
                        renderDashboard(data);
                    }
                }
            }
        } catch (e) {
            console.error("[SC Inspector] Dynamic endpoint resolution failed", e);
        }
    }

    function handleNavigation() {
        const currentUrl = cleanUrl(location.href);
        const parentUrl = getParentProfileUrl(currentUrl);

        if (cache.has(currentUrl)) {
            renderDashboard(cache.get(currentUrl));
            return;
        }
        if (cache.has(parentUrl)) {
            renderDashboard(cache.get(parentUrl));
            return;
        }

        if (window.__sc_hydration) {
            const sound = window.__sc_hydration.find((x) => x.hydratable === "sound")?.data;
            const playlist = window.__sc_hydration.find((x) => x.hydratable === "playlist")?.data;
            const user = window.__sc_hydration.find((x) => x.hydratable === "user")?.data;

            if (sound) cache.set(cleanUrl(sound.permalink_url), sound);
            if (playlist) cache.set(cleanUrl(playlist.permalink_url), playlist);
            if (user) cache.set(cleanUrl(user.permalink_url), user);

            const currentData = user || playlist || sound;
            if (currentData) {
                const dataUrl = cleanUrl(currentData.permalink_url);
                if (dataUrl === currentUrl || dataUrl === parentUrl) {
                    renderDashboard(currentData);
                    return;
                }
            }
        }

        resolveCurrentUrl(currentUrl);
    }

    function hookHistory() {
        const pushState = history.pushState;
        const replaceState = history.replaceState;

        history.pushState = function (...args) {
            pushState.apply(this, args);
            setTimeout(handleNavigation, 150);
        };

        history.replaceState = function (...args) {
            replaceState.apply(this, args);
            setTimeout(handleNavigation, 150);
        };

        window.addEventListener("popstate", () => setTimeout(handleNavigation, 150));
    }

    function hookTitleObserver() {
        let lastTitle = document.title;
        new MutationObserver(() => {
            if (document.title !== lastTitle) {
                lastTitle = document.title;
                setTimeout(handleNavigation, 200);
            }
        }).observe(document.querySelector("title") || document.documentElement, {
            subtree: true,
            characterData: true,
            childList: true,
        });
    }

    function init() {
        extractMeUser();
        hookHistory();
        hookTitleObserver();

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", handleNavigation);
        } else {
            handleNavigation();
        }
    }

    init();
})();
