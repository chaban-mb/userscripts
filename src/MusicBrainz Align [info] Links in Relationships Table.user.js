// ==UserScript==
// @name         MusicBrainz: Align [info] Links in Relationships Table
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @tag          ai-created
// @description  Aligns [info] metadata links uniformly after the longest URL.
// @author       chaban
// @license      MIT
// @homepageURL  https://github.com/chaban-mb/userscripts
// @supportURL   https://github.com/chaban-mb/userscripts/issues
// @match        *://*.musicbrainz.org/*/*/relationships*
// @match        *://*.musicbrainz.eu/*/*/relationships*
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @grant        GM.unregisterMenuCommand
// @run-at       document-idle
// @updateURL    https://github.com/chaban-mb/userscripts/raw/dist/src/MusicBrainz%20Align%20%5Binfo%5D%20Links%20in%20Relationships%20Table.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/dist/src/MusicBrainz%20Align%20%5Binfo%5D%20Links%20in%20Relationships%20Table.user.js
// ==/UserScript==

/**
 * @file Aligns [info] metadata links uniformly after the longest URL in MusicBrainz relationship tables,
 * adding reactive GM menu toggles for direct URL edit and history navigation.
 */

(function () {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const STYLE_ID = 'mb-align-info-links-css';

    /**
     * @typedef {Object} ConfigOption
     * @property {string} name - Internal name of the option.
     * @property {string} key - GM storage key.
     * @property {string} text - Label shown in the GM menu.
     * @property {boolean} defaultValue - Default boolean state.
     */

    /**
     * Manages reactive configuration state and synchronizes with GM storage.
     */
    class ReactiveConfig {
        #options = {};
        #listeners = {};
        #configDefinition;

        /**
         * @param {ConfigOption[]} configDefinition
         */
        constructor(configDefinition) {
            this.#configDefinition = configDefinition;
            configDefinition.forEach((opt) => {
                this.#listeners[opt.name] = [];
            });
        }

        async load() {
            await Promise.all(
                this.#configDefinition.map(async (opt) => {
                    this.#options[opt.name] = await GM.getValue(opt.key, opt.defaultValue);
                })
            );
        }

        get(optionName) {
            if (!(optionName in this.#options)) {
                throw new Error(`[${SCRIPT_NAME}] Unknown configuration option: "${optionName}"`);
            }
            return this.#options[optionName];
        }

        async update(optionName, newValue) {
            const config = this.#configDefinition.find((opt) => opt.name === optionName);
            if (!config) {
                throw new Error(`[${SCRIPT_NAME}] Unknown configuration option: "${optionName}"`);
            }
            if (this.#options[optionName] === newValue) return;

            this.#options[optionName] = newValue;
            await GM.setValue(config.key, newValue);
            this.#listeners[optionName].forEach((callback) => callback(newValue));
        }

        subscribe(optionName, callback) {
            if (!this.#listeners[optionName]) {
                throw new Error(`[${SCRIPT_NAME}] Cannot subscribe to unknown option: "${optionName}"`);
            }
            this.#listeners[optionName].push(callback);
        }
    }

    function injectStylesheet() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .mb-info-row {
                display: flex;
                align-items: baseline;
                width: -moz-fit-content;
                width: fit-content;
            }
            .mb-info-target {
                width: var(--mb-info-target-width, auto);
                white-space: nowrap;
            }
            .mb-info-action {
                margin-left: 20px;
                flex-shrink: 0;
                white-space: nowrap;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Re-renders the contents of an action container based on active configuration.
     * @param {HTMLElement} action
     * @param {string} baseUrl
     * @param {ReactiveConfig} config
     */
    function renderActionContent(action, baseUrl, config) {
        action.innerHTML = '';

        const infoLink = document.createElement('a');
        infoLink.href = baseUrl;
        infoLink.textContent = 'info';
        infoLink.title = 'URL information';

        const actionLinks = [infoLink];

        if (config.get('showEditLink')) {
            const editLink = document.createElement('a');
            editLink.href = `${baseUrl}/edit`;
            editLink.textContent = 'edit';
            editLink.title = 'Edit URL';
            actionLinks.push(editLink);
        }

        if (config.get('showEditsLink')) {
            const editsLink = document.createElement('a');
            editsLink.href = `${baseUrl}/edits`;
            editsLink.textContent = 'edits';
            editsLink.title = 'Editing history';
            actionLinks.push(editsLink);
        }

        action.append('[');
        actionLinks.forEach((link, idx) => {
            if (idx > 0) action.append(' | ');
            action.appendChild(link);
        });
        action.append(']');
    }

    /**
     * Updates all existing action brackets inline on configuration change.
     * @param {ReactiveConfig} config
     */
    function updateAllActions(config) {
        document.querySelectorAll('.mb-info-action').forEach((action) => {
            const baseUrl = action.dataset.mbUrl;
            if (!baseUrl) {
                console.warn(`[${SCRIPT_NAME}] Action container missing data-mb-url:`, action);
                return;
            }
            renderActionContent(action, baseUrl, config);
        });
        console.debug(`[${SCRIPT_NAME}] Action links re-rendered inline`);
    }

    /**
     * Parses a single relationship line, separating target content from action brackets.
     * @param {Node[]} lineNodes
     * @param {ReactiveConfig} config
     * @returns {HTMLDivElement|null} The formatted row or null if no [info] link is present.
     */
    function parseLine(lineNodes, config) {
        const infoIndex = lineNodes.findIndex(
            (n) =>
                n.nodeType === Node.ELEMENT_NODE &&
                n.nodeName === 'A' &&
                n.textContent.trim() === 'info' &&
                /\/url\/[0-9a-f-]{36}/i.test(n.getAttribute('href') || '')
        );

        if (infoIndex === -1) return null;

        const infoLink = lineNodes[infoIndex];
        const rawHref = infoLink.getAttribute('href');
        if (!rawHref) {
            console.error(`[${SCRIPT_NAME}] Info link missing href:`, infoLink);
            return null;
        }

        // Collect target nodes (excluding preceding '[' and whitespace)
        let openBracketFound = false;
        const targetNodes = [];
        for (let i = infoIndex - 1; i >= 0; i--) {
            const node = lineNodes[i];
            if (!openBracketFound) {
                if (node.nodeType === Node.COMMENT_NODE) continue;
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    const bracketIdx = text.lastIndexOf('[');
                    if (bracketIdx !== -1) {
                        openBracketFound = true;
                        const beforeBracket = text.slice(0, bracketIdx).trimEnd();
                        if (beforeBracket) {
                            targetNodes.unshift(document.createTextNode(beforeBracket));
                        }
                        continue;
                    } else if (text.trim() === '') {
                        continue;
                    }
                }
            }
            targetNodes.unshift(node);
        }

        // Collect trailing nodes after ']'
        let closeBracketFound = false;
        const extraAfterNodes = [];
        for (let i = infoIndex + 1; i < lineNodes.length; i++) {
            const node = lineNodes[i];
            if (!closeBracketFound) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent;
                    const bracketIdx = text.indexOf(']');
                    if (bracketIdx !== -1) {
                        closeBracketFound = true;
                        const afterBracket = text.slice(bracketIdx + 1).trimStart();
                        if (afterBracket) {
                            extraAfterNodes.push(document.createTextNode(afterBracket));
                        }
                        continue;
                    }
                }
            }
            extraAfterNodes.push(node);
        }

        const row = document.createElement('div');
        row.className = 'mb-info-row';

        const target = document.createElement('div');
        target.className = 'mb-info-target';
        targetNodes.forEach((n) => target.appendChild(n));

        const action = document.createElement('div');
        action.className = 'mb-info-action';

        const baseUrl = rawHref.split(/[?#]/)[0].replace(/\/+$/, '');
        action.dataset.mbUrl = baseUrl;

        renderActionContent(action, baseUrl, config);

        extraAfterNodes.forEach((n) => action.appendChild(n));

        row.appendChild(target);
        row.appendChild(action);

        return row;
    }

    /**
     * Recalculates and updates the aligned target column width for a table.
     * @param {HTMLTableElement} table
     */
    function recalculateTableWidth(table) {
        const targets = table.querySelectorAll('.mb-info-target');
        if (targets.length === 0) return;

        const prevWidth = table.style.getPropertyValue('--mb-info-target-width');
        table.style.setProperty('--mb-info-target-width', 'auto');

        let maxWidth = 0;
        targets.forEach((t) => {
            const width = Math.ceil(t.getBoundingClientRect().width);
            if (width > maxWidth) maxWidth = width;
        });

        const newWidth = `${maxWidth}px`;
        table.style.setProperty('--mb-info-target-width', newWidth);

        if (prevWidth !== newWidth) {
            console.debug(`[${SCRIPT_NAME}] Table column width aligned to ${newWidth}`);
        }
    }

    /**
     * Scans and aligns relationship tables.
     * @param {ParentNode} root
     * @param {ReactiveConfig} config
     */
    function alignAllTables(root, config) {
        const tables = root.querySelectorAll('table.details');
        if (tables.length === 0) return;

        injectStylesheet();

        tables.forEach((table) => {
            try {
                const cells = table.querySelectorAll('td');
                let modified = false;

                cells.forEach((td) => {
                    if (td.dataset.infoAligned === 'true') return;

                    const hasInfo = Array.from(td.querySelectorAll('a')).some((a) =>
                        a.textContent.trim() === 'info' && /\/url\/[0-9a-f-]{36}/i.test(a.getAttribute('href') || '')
                    );
                    if (!hasInfo) return;

                    const lines = [];
                    let currentLine = [];
                    Array.from(td.childNodes).forEach((node) => {
                        if (node.nodeName === 'BR') {
                            if (currentLine.length > 0) lines.push(currentLine);
                            currentLine = [];
                        } else {
                            currentLine.push(node);
                        }
                    });
                    if (currentLine.length > 0) lines.push(currentLine);

                    const fragment = document.createDocumentFragment();
                    lines.forEach((lineNodes) => {
                        const row = parseLine(lineNodes, config);
                        if (row) {
                            fragment.appendChild(row);
                        } else {
                            lineNodes.forEach((n) => fragment.appendChild(n));
                            fragment.appendChild(document.createElement('br'));
                        }
                    });

                    td.innerHTML = '';
                    td.appendChild(fragment);
                    td.dataset.infoAligned = 'true';
                    modified = true;
                });

                if (modified || table.querySelectorAll('.mb-info-target').length > 0) {
                    recalculateTableWidth(table);
                }
            } catch (err) {
                console.error(`[${SCRIPT_NAME}] Error processing table:`, err, table);
            }
        });
    }

    async function init() {
        const OPTIONS_CONFIG = [
            { name: 'showEditLink', key: 'show-edit-link', text: 'Show "edit" link', defaultValue: true },
            { name: 'showEditsLink', key: 'show-edits-link', text: 'Show "edits" history link', defaultValue: true },
        ];

        const config = new ReactiveConfig(OPTIONS_CONFIG);
        await config.load();

        config.subscribe('showEditLink', () => updateAllActions(config));
        config.subscribe('showEditsLink', () => updateAllActions(config));

        const commandIds = {};
        const registerAllCommands = async () => {
            try {
                for (const id of Object.values(commandIds)) {
                    await GM.unregisterMenuCommand(id);
                }
                for (const opt of OPTIONS_CONFIG) {
                    const commandText = `${opt.text}: ${config.get(opt.name) ? 'ON' : 'OFF'}`;
                    commandIds[opt.key] = await GM.registerMenuCommand(commandText, async () => {
                        try {
                            await config.update(opt.name, !config.get(opt.name));
                            await registerAllCommands();
                        } catch (err) {
                            console.error(`[${SCRIPT_NAME}] Failed to update menu option "${opt.name}":`, err);
                        }
                    });
                }
            } catch (err) {
                console.error(`[${SCRIPT_NAME}] Failed to register menu commands:`, err);
            }
        };

        await registerAllCommands();

        alignAllTables(document, config);

        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            const hasRelevantChanges = mutations.some((mutation) =>
                Array.from(mutation.addedNodes).some(
                    (node) =>
                        node.nodeType === Node.ELEMENT_NODE &&
                        (node.matches('table.details, table.details *') || node.querySelector('table.details'))
                )
            );

            if (hasRelevantChanges) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => alignAllTables(document, config), 100);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    init().catch((err) => console.error(`[${SCRIPT_NAME}] Initialization failed:`, err));
})();
