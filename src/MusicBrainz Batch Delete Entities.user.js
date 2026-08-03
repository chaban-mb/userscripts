// ==UserScript==
// @name         MusicBrainz: Batch Delete Entities
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Batch deletes entities like releases or recordings.
// @tag          ai-created
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/artist*
// @match        *://*.musicbrainz.org/release-group*
// @match        *://*.musicbrainz.org/release*
// @match        *://*.musicbrainz.org/recording*
// @match        *://*.musicbrainz.org/work*
// @match        *://*.musicbrainz.org/label*
// @match        *://*.musicbrainz.org/series*
// @match        *://*.musicbrainz.org/event*
// @match        *://*.musicbrainz.org/place*
// @match        *://*.musicbrainz.org/area*
// @match        *://*.musicbrainz.org/instrument*
// @match        *://*.musicbrainz.org/genre*
// @match        *://*.musicbrainz.org/collection*
// @match        *://*.musicbrainz.org/*/*/artists*
// @match        *://*.musicbrainz.org/*/*/releases*
// @match        *://*.musicbrainz.org/*/*/recordings*
// @match        *://*.musicbrainz.org/*/*/release-groups*
// @match        *://*.musicbrainz.org/*/*/events*
// @match        *://*.musicbrainz.org/*/*/labels*
// @match        *://*.musicbrainz.org/*/*/places*
// @exclude      *://*.musicbrainz.org/*/create*
// @exclude      *://*.musicbrainz.org/*/*/edit*
// @exclude      *://*.musicbrainz.org/*/*/edits*
// @exclude      *://*.musicbrainz.org/*/*/open_edits*
// @exclude      *://*.musicbrainz.org/release/add*
// @exclude      *://*.musicbrainz.org/release/*/edit-relationships*
// @exclude      *://*.musicbrainz.org/release/*/add-cover-art*
// @grant        none
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Batch%20Delete%20Entities.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Batch%20Delete%20Entities.user.js
// ==/UserScript==

(function () {
    'use strict';

    const ACTION_EVENT_NAME = 'UserJS:MusicBrainz';

    const DELETABLE_ENTITY_TYPES = new Set([
        'release', 'recording', 'area', 'instrument', 'genre'
    ]);

    // ==========================================
    // Helpers & Utilities
    // ==========================================
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function h(tag, props = {}, ...children) {
        const el = document.createElement(tag);
        for (const [key, val] of Object.entries(props)) {
            if (key.startsWith('on') && typeof val === 'function') {
                el.addEventListener(key.slice(2).toLowerCase(), val);
            } else if (key === 'style' && typeof val === 'object') {
                Object.assign(el.style, val);
            } else if (key in el) {
                el[key] = val;
            } else {
                el.setAttribute(key, val);
            }
        }
        children.flat().forEach(child => {
            if (child != null) {
                el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
            }
        });
        return el;
    }

    function extractEntityFromInput(input) {
        if (!input) return null;
        const str = typeof input === 'string' ? input : (input.url || input.mbid || '');
        const match = str.match(/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (match) {
            return { type: match[1].toLowerCase(), mbid: match[2] };
        }
        const mbidMatch = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (mbidMatch) {
            return { type: typeof input === 'object' ? (input.type || null) : null, mbid: mbidMatch[0] };
        }
        return null;
    }

    function formatEntityItem(item) {
        const info = extractEntityFromInput(item);
        if (!info) return typeof item === 'string' ? item.trim() : '';
        return info.type ? `https://musicbrainz.org/${info.type}/${info.mbid}` : info.mbid;
    }

    function showToast(message, type = 'info', duration = 4000) {
        const dialog = document.getElementById('mb-batch-delete-dialog');
        const parent = dialog || document.body;
        let container = document.getElementById('mb-toast-container');
        if (!container || container.parentElement !== parent) {
            container?.remove();
            container = h('div', { id: 'mb-toast-container', role: 'status', 'aria-live': 'polite' });
            parent.appendChild(container);
        }

        const toast = h('div', { className: `mb-toast mb-toast-${type}` }, message);
        container.appendChild(toast);

        void toast.offsetWidth;
        toast.classList.add('mb-toast-show');

        setTimeout(() => {
            toast.classList.remove('mb-toast-show');
            toast.addEventListener('transitionend', () => toast.remove());
        }, duration);
    }

    function injectStyles() {
        if (document.getElementById('mb-batch-delete-styles')) return;
        document.head.appendChild(h('style', { id: 'mb-batch-delete-styles' }, `
            #mb-toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 100000; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
            .mb-toast { background: #333; color: #fff; padding: 10px 16px; border-radius: 4px; font-family: sans-serif; font-size: 0.9em; box-shadow: 0 3px 8px rgba(0,0,0,0.25); opacity: 0; transform: translateY(10px); transition: all 0.25s ease; pointer-events: auto; max-width: 350px; }
            .mb-toast-show { opacity: 1; transform: translateY(0); }
            .mb-toast-info { background: #1e293b; border-left: 4px solid #3b82f6; }
            .mb-toast-success { background: #14532d; border-left: 4px solid #22c55e; }
            .mb-toast-warning { background: #78350f; border-left: 4px solid #f59e0b; }
            .mb-toast-error { background: #7f1d1d; border-left: 4px solid #ef4444; }

            #mb-batch-delete-dialog { border: 1px solid #ccc; border-radius: 6px; width: 620px; max-width: 90vw; padding: 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); font-family: sans-serif; color: #333; }
            #mb-batch-delete-dialog::backdrop { background: rgba(0, 0, 0, 0.5); }

            .mb-modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .mb-modal-header h3 { margin: 0; font-size: 1.2em; }
            .mb-modal-close { background: none; border: none; font-size: 1.2em; font-weight: bold; cursor: pointer; color: #666; }
            .mb-modal-close:hover { color: #000; }

            .mb-modal-body label { display: block; margin-top: 10px; font-weight: bold; font-size: 0.9em; }
            .mb-modal-body textarea, .mb-modal-body input[type="text"] { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; }
            .mb-modal-body textarea { height: 90px; resize: vertical; font-family: monospace; font-size: 0.85em; white-space: pre; }

            .mb-modal-footer { margin-top: 15px; display: flex; justify-content: flex-end; gap: 8px; }
            .mb-modal-footer button { padding: 6px 14px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; }
            .mb-btn-primary { background: #db3939; color: #fff; border-color: #a82323 !important; }
            .mb-btn-primary:hover { background: #b82828; }
            .mb-btn-primary:disabled { background: #e0a1a1; cursor: not-allowed; }
            .mb-btn-retry { background: #d97706; color: #fff; border-color: #b45309 !important; }
            .mb-btn-retry:hover { background: #b45309; }

            #mb-delete-output { display: block; margin-top: 12px; }
            #mb-delete-log-list { font-size: 0.85em; height: 180px; overflow-y: auto; background: #f9f9f9; padding: 8px 8px 8px 32px; border: 1px solid #ccc; border-radius: 4px; line-height: 1.5; font-family: monospace; margin: 8px 0 0 0; }

            .mb-icon-slot { display: inline-block; width: 1.5em; text-align: center; }
            .mb-spin { display: inline-block; animation: mb-spin-anim 1s infinite steps(8); }
            @keyframes mb-spin-anim { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

            .mb-log-status-success { color: #15803d; }
            .mb-log-status-error { color: #b91c1c; }
            .mb-log-status-pending { color: #d97706; }
            #mb-delete-log-list a { color: #0066cc; text-decoration: underline; }

            .mb-inline-retry-btn { margin-left: 8px; font-size: 0.8em; padding: 1px 6px; cursor: pointer; border: 1px solid #ccc; border-radius: 3px; background: #fff; }
            .mb-inline-retry-btn:hover { background: #eee; }
        `));
    }

    // ==========================================
    // State Models
    // ==========================================
    class LogEntry {
        constructor(mbid, index, total, type = 'release', hasExplicitType = false) {
            this.mbid = mbid;
            this.index = index;
            this.total = total;
            this.type = type;
            this.hasExplicitType = hasExplicitType;
            this.status = 'pending'; // 'pending' | 'retrying' | 'success' | 'error' | 'aborted' | 'cancelled'
            this.attempt = 0;
            this.maxAttempts = 3;
            this.backoffMs = 0;
            this.editId = null;
            this.errorMsg = null;
            this.manualRetries = 0;
        }
    }

    // ==========================================
    // API Layer
    // ==========================================
    class MusicBrainzApi {
        /**
         * Resolves the exact entity type for an MBID via /ws/js/entity lookup.
         * @param {string} mbid - Entity MBID UUID.
         * @returns {Promise<string|null>} Resolved entity type or null.
         */
        static async resolveEntityType(mbid) {
            try {
                const res = await fetch(`/ws/js/entity/${mbid}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data?.entityType) return data.entityType;
                }
            } catch { }
            return null;
        }

        /**
         * Extracts the edit ID from response HTML text.
         * @param {string} htmlText - HTML string returned from entity edit POST.
         * @returns {string|null} The edit ID if found, otherwise null.
         */
        static parseEditId(htmlText) {
            try {
                const doc = new DOMParser().parseFromString(htmlText, 'text/html');
                const link = doc.querySelector('.banner.flash a[href*="/edit/"]') || doc.querySelector('.banner a[href*="/edit/"]');
                return link ? link.getAttribute('href').match(/\/edit\/(\d+)/)?.[1] || null : null;
            } catch {
                return null;
            }
        }

        /**
         * Sends an entity deletion POST request to MusicBrainz.
         * @param {string} mbid - The entity MBID UUID.
         * @param {string} editNote - Required edit note explanation.
         * @param {AbortSignal} signal - AbortSignal to cancel in-flight request.
         * @param {Function} [onAttemptUpdate] - Callback invoked on retry attempt updates.
         * @param {string} [entityType='release'] - Target entity type (release, recording, area, etc.).
         * @param {number} [maxRetries=3] - Maximum retry attempts for transient errors.
         * @returns {Promise<string>} Resolves with the created edit ID.
         * @throws {Error} Throws if deletion fails, is aborted, or returns no edit ID.
         */
        static async deleteEntity(mbid, editNote, signal, onAttemptUpdate, entityType = 'release', maxRetries = 3) {
            let attempt = 0;

            while (attempt < maxRetries) {
                attempt++;
                if (onAttemptUpdate) onAttemptUpdate(attempt, maxRetries, 0);

                try {
                    const res = await fetch(`/${entityType}/${mbid}/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ 'confirm.edit_note': editNote }),
                        signal
                    });

                    if (res.ok || res.redirected) {
                        const editId = this.parseEditId(await res.text());
                        if (!editId) {
                            throw new Error('Edit not created (session expired or invalid response)');
                        }
                        return editId;
                    }

                    // Fail immediately on fatal client-side 4xx errors (except rate-limit 429)
                    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
                        const fatalError = new Error(`HTTP ${res.status}`);
                        fatalError.isFatal = true;
                        throw fatalError;
                    }

                    if (attempt < maxRetries) {
                        const backoffMs = 1500 * attempt;
                        if (onAttemptUpdate) onAttemptUpdate(attempt, maxRetries, backoffMs);
                        await sleep(backoffMs);
                    } else {
                        throw new Error(`HTTP ${res.status}`);
                    }
                } catch (err) {
                    if (err.name === 'AbortError' || err.isFatal || attempt >= maxRetries) {
                        throw err;
                    }
                    const backoffMs = 1500 * attempt;
                    if (onAttemptUpdate) onAttemptUpdate(attempt, maxRetries, backoffMs);
                    await sleep(backoffMs);
                }
            }
        }

        /**
         * Verifies if an open removal edit exists for an entity on /<entityType>/<mbid>/edits.
         * @param {string} mbid - Entity MBID UUID.
         * @param {string} [entityType='release'] - Entity type.
         * @returns {Promise<string|null>} Resolves with edit ID if found, otherwise null.
         */
        static async verifyExistingDeleteEdit(mbid, entityType = 'release') {
            try {
                const res = await fetch(`/${entityType}/${mbid}/edits`);
                if (!res.ok) return null;
                const html = await res.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');

                const classSelector = `.edit-header.remove-${entityType}, .edit-header.delete-${entityType}`;
                const editHeader = Array.from(doc.querySelectorAll(classSelector))
                    .find(el => !el.classList.contains('cancelled') && !el.classList.contains('rejected'));

                if (editHeader) {
                    const titleLink = editHeader.querySelector('h2 a[href*="/edit/"]');
                    const match = titleLink?.getAttribute('href')?.match(/\/edit\/(\d+)/);
                    return match ? match[1] : null;
                }
                return null;
            } catch {
                return null;
            }
        }

        /**
         * Cancels an open edit on MusicBrainz via POST /edit/<edit_id>/cancel.
         * @param {string} editId - The edit ID to cancel.
         * @param {string} [editNote=''] - Reason for cancellation.
         * @returns {Promise<boolean>} True if cancellation succeeded.
         */
        static async cancelEdit(editId, editNote = '') {
            try {
                const res = await fetch(`/edit/${editId}/cancel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ 'confirm.edit_note': editNote })
                });
                return res.ok || res.redirected;
            } catch {
                return false;
            }
        }
    }

    // ==========================================
    // Core Engine / Controller
    // ==========================================
    class BatchDeleteManager {
        constructor() {
            this.logStore = new Map();
            this.isProcessing = false;
            this.abortController = null;
            this.ui = null;
        }

        bindUI(uiController) {
            this.ui = uiController;
        }

        getFailedEntries() {
            return Array.from(this.logStore.values()).filter(e => e.status === 'error');
        }

        getCreatedEntries() {
            return Array.from(this.logStore.values()).filter(e => e.editId && e.status === 'success');
        }

        abort() {
            this.abortController?.abort();
        }

        /**
         * Bulk-cancels all created deletion edits from the current session on MusicBrainz.
         * @param {string} editNote - Cancellation edit note.
         * @returns {Promise<void>}
         */
        async cancelEnteredEdits(editNote) {
            if (this.isProcessing) return;

            const createdEntries = this.getCreatedEntries();
            if (!createdEntries.length) return showToast('No created edits to cancel.', 'warning');

            this.isProcessing = true;
            this.ui.setProcessingState(true, true);

            let cancelledCount = 0;
            for (const entry of createdEntries) {
                const ok = await MusicBrainzApi.cancelEdit(entry.editId, editNote);
                if (ok) {
                    entry.status = 'cancelled';
                    this.ui.renderLogRow(entry);
                    cancelledCount++;
                }
            }

            showToast(`Cancelled ${cancelledCount} entered deletion edit(s).`, 'info');
            this.isProcessing = false;
            this.ui.setProcessingState(false);
            this.ui.updateButtons(this.getFailedEntries(), this.getCreatedEntries());
        }

        /**
         * Executes sequential batch processing for a list of entity MBIDs or item objects.
         * @param {Array<{mbid: string, type?: string}|string>} rawItems - List of items or raw strings/URLs.
         * @param {string} editNote - Required edit note.
         * @param {Array<{mbid: string, type?: string}>|null} [targetItems=null] - Explicit target items list if retrying.
         * @returns {Promise<void>}
         */
        async processBatch(rawItems, editNote, targetItems = null) {
            if (!rawItems.length) return showToast('No valid MBIDs found.', 'warning');

            this.isProcessing = true;
            this.ui.setProcessingState(true);

            const normalizedItems = rawItems.map(item => {
                if (typeof item === 'object' && item !== null && item.mbid) {
                    return { mbid: item.mbid, type: item.type || null, hasExplicitType: Boolean(item.type) };
                }
                const extracted = extractEntityFromInput(String(item));
                return extracted ? { mbid: extracted.mbid, type: extracted.type || null, hasExplicitType: Boolean(extracted?.type) } : null;
            }).filter(Boolean);

            if (!targetItems) {
                normalizedItems.forEach((item, i) => {
                    if (!this.logStore.has(item.mbid)) {
                        this.logStore.set(item.mbid, new LogEntry(item.mbid, i + 1, normalizedItems.length, item.type, item.hasExplicitType));
                    }
                });
            }

            this.abortController = new AbortController();

            for (let i = 0; i < normalizedItems.length; i++) {
                if (this.abortController.signal.aborted) break;

                const item = normalizedItems[i];
                const entry = this.logStore.get(item.mbid);
                if (!entry) continue;

                if (!entry.hasExplicitType) {
                    const resolvedType = await MusicBrainzApi.resolveEntityType(entry.mbid);
                    if (resolvedType) {
                        entry.type = resolvedType;
                        entry.hasExplicitType = true;
                    }
                }

                if (!DELETABLE_ENTITY_TYPES.has(entry.type)) {
                    entry.status = 'error';
                    entry.errorMsg = `Entity type '${entry.type}' cannot be deleted directly`;
                    this.ui.renderLogRow(entry);
                    continue;
                }

                if (entry.status === 'success') {
                    this.ui.renderLogRow(entry);
                    continue;
                }

                if (entry.status === 'aborted') {
                    const verifiedEditId = await MusicBrainzApi.verifyExistingDeleteEdit(entry.mbid, entry.type);
                    if (verifiedEditId) {
                        entry.status = 'success';
                        entry.editId = verifiedEditId;
                        this.ui.renderLogRow(entry);
                        continue;
                    }
                }

                entry.status = 'pending';
                this.ui.renderLogRow(entry);

                const onAttemptUpdate = (attempt, maxAttempts, backoffMs) => {
                    entry.status = 'retrying';
                    entry.attempt = attempt;
                    entry.maxAttempts = maxAttempts;
                    entry.backoffMs = backoffMs;
                    this.ui.renderLogRow(entry);
                };

                try {
                    const editId = await MusicBrainzApi.deleteEntity(
                        entry.mbid, editNote, this.abortController.signal, onAttemptUpdate, entry.type
                    );
                    entry.status = 'success';
                    entry.editId = editId;
                } catch (err) {
                    const isAbort = err.name === 'AbortError';
                    entry.status = isAbort ? 'aborted' : 'error';
                    entry.errorMsg = err.message;
                }

                this.ui.renderLogRow(entry);

                if (entry.status === 'aborted') break;
                if (i < normalizedItems.length - 1 && !this.abortController.signal.aborted) {
                    await sleep(1000);
                }
            }

            if (!this.abortController.signal.aborted) {
                showToast('Batch execution complete.', 'info');
                this.ui.clearInputs();
            }

            this.isProcessing = false;
            this.ui.setProcessingState(false);
            this.ui.updateButtons(this.getFailedEntries(), this.getCreatedEntries());
        }

        /**
         * Retries deletion for a single failed LogEntry.
         * @param {LogEntry} entry - The log entry instance to retry.
         * @param {string} editNote - Required edit note.
         * @returns {Promise<void>}
         */
        async retrySingle(entry, editNote) {
            if (this.isProcessing) return;

            this.isProcessing = true;
            this.ui.setProcessingState(true, true);

            entry.manualRetries++;
            entry.status = 'pending';
            this.ui.renderLogRow(entry);

            const onAttemptUpdate = (attempt, maxAttempts, backoffMs) => {
                entry.status = 'retrying';
                entry.attempt = attempt;
                entry.maxAttempts = maxAttempts;
                entry.backoffMs = backoffMs;
                this.ui.renderLogRow(entry);
            };

            try {
                const editId = await MusicBrainzApi.deleteEntity(
                    entry.mbid, editNote, new AbortController().signal, onAttemptUpdate, entry.type
                );
                entry.status = 'success';
                entry.editId = editId;
                showToast(`Successfully deleted ${entry.mbid}`, 'success');
            } catch (err) {
                entry.status = 'error';
                entry.errorMsg = err.message;
            } finally {
                this.ui.renderLogRow(entry);
                this.isProcessing = false;
                this.ui.setProcessingState(false);
                this.ui.updateButtons(this.getFailedEntries(), this.getCreatedEntries());
            }
        }
    }

    class BatchDeleteDialog {
        constructor(manager) {
            this.manager = manager;
            this.dialogElement = null;
            this.els = {};
            this.manager.bindUI(this);
        }

        open(initialItems = []) {
            if (this.dialogElement) return;
            injectStyles();

            const initialText = initialItems.map(formatEntityItem).filter(Boolean).join('\n');

            this.els = {
                targetInput: h('textarea', { id: 'mb-target-input', name: 'target-mbids', rows: 4, required: true, placeholder: 'Paste MBIDs or entity URLs (releases, recordings, areas, etc.)...', value: initialText }),
                noteInput: h('input', { type: 'text', id: 'mb-edit-note', name: 'edit-note', required: true, placeholder: 'Reason for deletion...' }),
                logContainer: h('ol', { id: 'mb-delete-log-list' }),
                abortBtn: h('button', { type: 'button', id: 'mb-btn-abort', style: { display: 'none' }, onClick: () => this.manager.abort() }, 'Abort'),
                retryAllBtn: h('button', { type: 'button', id: 'mb-btn-retry-all', className: 'mb-btn-retry', style: { display: 'none' } }),
                cancelEditsBtn: h('button', { type: 'button', id: 'mb-btn-cancel-edits', className: 'mb-btn-retry', style: { display: 'none' } }),
                submitBtn: h('button', { type: 'submit', id: 'mb-btn-submit', className: 'mb-btn-primary' }, 'Delete Entities'),
                closeBtn: h('button', { type: 'button', className: 'mb-modal-close', 'aria-label': 'Close dialog', onClick: () => this.close() }, '×')
            };

            const logOutput = h('output', { id: 'mb-delete-output', 'aria-live': 'polite', style: { display: 'none' } }, this.els.logContainer);

            this.els.retryAllBtn.onclick = () => {
                const failed = this.manager.getFailedEntries();
                if (failed.length) {
                    const note = this.els.noteInput.value.trim();
                    this.manager.processBatch(failed, note, failed);
                }
            };

            this.els.cancelEditsBtn.onclick = () => {
                const note = this.els.noteInput.value.trim();
                this.manager.cancelEnteredEdits(note);
            };

            const form = h('form', {
                method: 'dialog',
                onSubmit: (e) => {
                    e.preventDefault();
                    const note = this.els.noteInput.value.trim();
                    const lines = this.els.targetInput.value.split(/[\n,\s]+/);

                    const items = lines.map(line => {
                        const extracted = extractEntityFromInput(line);
                        return extracted ? { mbid: extracted.mbid, type: extracted.type || null } : null;
                    }).filter(Boolean);

                    // De-duplicate by MBID
                    const uniqueItems = Array.from(new Map(items.map(item => [item.mbid, item])).values());
                    this.manager.processBatch(uniqueItems, note);
                }
            },
                h('header', { className: 'mb-modal-header' }, h('h3', { id: 'mb-modal-title' }, 'Batch Delete Entities'), this.els.closeBtn),
                h('section', { className: 'mb-modal-body' },
                    h('p', {}, h('label', { htmlFor: 'mb-target-input' }, 'Entities (MBIDs or URLs):'), this.els.targetInput),
                    h('p', {}, h('label', { htmlFor: 'mb-edit-note' }, 'Edit Note (Required):'), this.els.noteInput),
                    logOutput
                ),
                h('footer', { className: 'mb-modal-footer' }, this.els.abortBtn, this.els.retryAllBtn, this.els.cancelEditsBtn, this.els.submitBtn)
            );

            this.dialogElement = h('dialog', { id: 'mb-batch-delete-dialog', 'aria-labelledby': 'mb-modal-title' }, form);
            this.dialogElement.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                }
            });
            this.dialogElement.addEventListener('cancel', (e) => {
                if (this.manager.isProcessing) {
                    e.preventDefault();
                    this.manager.abort();
                    showToast('Batch processing aborted via Escape key.', 'warning');
                }
            });
            this.dialogElement.addEventListener('close', () => this.close());

            document.body.appendChild(this.dialogElement);
            this.dialogElement.showModal();
        }

        close() {
            if (this.manager.isProcessing) return;
            this.dialogElement?.close();
            this.dialogElement?.remove();
            this.dialogElement = null;
        }

        clearLog() {
            this.els.logContainer?.replaceChildren();
        }

        clearInputs() {
            if (this.els.targetInput) this.els.targetInput.value = '';
        }

        setProcessingState(isProcessing, isSingleRetry = false) {
            this.els.submitBtn.disabled = isProcessing;
            if (!isSingleRetry) {
                this.els.targetInput.disabled = isProcessing;
                this.els.noteInput.disabled = isProcessing;
                this.els.retryAllBtn.style.display = 'none';
                this.els.cancelEditsBtn.style.display = 'none';
                this.els.abortBtn.style.display = isProcessing ? 'inline-block' : 'none';
                if (this.els.logContainer.parentElement) {
                    this.els.logContainer.parentElement.style.display = 'block';
                }
            }
        }

        updateButtons(failedEntries, createdEntries) {
            if (this.manager.isProcessing) {
                this.els.retryAllBtn.style.display = 'none';
                this.els.cancelEditsBtn.style.display = 'none';
                return;
            }

            if (failedEntries.length > 0) {
                this.els.retryAllBtn.textContent = `Retry Failed (${failedEntries.length})`;
                this.els.retryAllBtn.style.display = 'inline-block';
            } else {
                this.els.retryAllBtn.style.display = 'none';
            }

            if (createdEntries.length > 0) {
                this.els.cancelEditsBtn.textContent = `Cancel Entered Edits (${createdEntries.length})`;
                this.els.cancelEditsBtn.style.display = 'inline-block';
            } else {
                this.els.cancelEditsBtn.style.display = 'none';
            }
        }

        renderLogRow(entry) {
            let li = document.getElementById(`mb-log-${entry.mbid}`);
            if (!li) {
                li = h('li', { id: `mb-log-${entry.mbid}` });
                this.els.logContainer.appendChild(li);
            }

            const idxStr = `[${entry.index}/${entry.total}]`;
            const typeBadge = `[${entry.type}] `;
            let statusClass = 'mb-log-status-pending';
            let symbol = '⏳';
            let text = `${idxStr} ${typeBadge}Deleting ${entry.mbid}...`;
            let linkInfo = null;
            let showRetryBtn = false;

            switch (entry.status) {
                case 'pending':
                    symbol = '⏳';
                    text = `${idxStr} ${typeBadge}Deleting ${entry.mbid}...`;
                    break;

                case 'retrying':
                    symbol = '⏳';
                    text = `${idxStr} ${typeBadge}${entry.mbid} (Attempt ${entry.attempt}/${entry.maxAttempts}${entry.backoffMs ? `, retrying in ${entry.backoffMs / 1000}s` : ''})...`;
                    break;

                case 'success':
                    statusClass = 'mb-log-status-success';
                    symbol = '✓';
                    text = `${idxStr} ${typeBadge}${entry.mbid}${entry.manualRetries > 0 ? ` (Succeeded on retry #${entry.manualRetries})` : ''}`;
                    if (entry.editId) {
                        linkInfo = { url: `/edit/${entry.editId}`, label: `Edit #${entry.editId}` };
                    }
                    break;

                case 'error':
                    statusClass = 'mb-log-status-error';
                    symbol = '✗';
                    text = `${idxStr} ${typeBadge}${entry.mbid} (${entry.errorMsg || 'Failed'})`;
                    showRetryBtn = true;
                    break;

                case 'aborted':
                    statusClass = 'mb-log-status-pending';
                    symbol = '⏹';
                    text = `${idxStr} ${typeBadge}${entry.mbid} (Aborted)`;
                    break;

                case 'cancelled':
                    statusClass = 'mb-log-status-pending';
                    symbol = '⏹';
                    text = `${idxStr} ${typeBadge}${entry.mbid} (Cancelled Edit #${entry.editId || ''})`;
                    break;
            }

            const statusSpan = h('span', { className: statusClass },
                h('span', { className: 'mb-icon-slot', 'aria-hidden': 'true' },
                    symbol === '⏳' ? h('span', { className: 'mb-spin' }, '⏳') : symbol
                ),
                text
            );

            if (linkInfo) {
                statusSpan.append(' → ', h('a', { href: linkInfo.url, target: '_blank', rel: 'noopener' }, linkInfo.label));
            }

            if (showRetryBtn) {
                statusSpan.append(
                    h('button', {
                        type: 'button',
                        className: 'mb-inline-retry-btn',
                        onClick: () => {
                            const note = this.els.noteInput.value.trim();
                            if (!note) return showToast('An Edit Note is required.', 'error');
                            this.manager.retrySingle(entry, note);
                        }
                    }, 'Retry')
                );
            }

            li.replaceChildren(statusSpan);
            this.els.logContainer.scrollTo({ top: this.els.logContainer.scrollHeight, behavior: 'smooth' });
        }
    }

    // ==========================================
    // Bootstrap & Event Listeners
    // ==========================================
    const manager = new BatchDeleteManager();
    const dialog = new BatchDeleteDialog(manager);

    function injectSidebarLink() {
        if (document.getElementById('mb-sidebar-batch-delete')) return;
        const editingHeader = Array.from(document.querySelectorAll('#sidebar h2.editing')).find(h2 => h2.textContent.trim() === 'Editing');
        if (!editingHeader) return;

        const editingList = editingHeader.nextElementSibling;
        if (editingList && editingList.tagName.toLowerCase() === 'ul') {
            const li = h('li', { id: 'mb-sidebar-batch-delete' },
                h('a', { href: '#', onClick: (e) => { e.preventDefault(); dialog.open([]); } }, 'Batch delete entities')
            );
            editingList.appendChild(li);
        }
    }

    document.addEventListener(ACTION_EVENT_NAME, (e) => {
        const detail = e.detail;
        if (!detail || detail.action !== 'delete' || !Array.isArray(detail.items)) return;

        const items = detail.items
            .map(extractEntityFromInput)
            .filter(item => item && item.mbid && (!item.type || DELETABLE_ENTITY_TYPES.has(item.type)));

        if (detail.items.length > 0 && items.length === 0) {
            e.preventDefault();
            showToast(`None of the selected entities are deletable (supported: ${Array.from(DELETABLE_ENTITY_TYPES).join(', ')}).`, 'warning');
            return;
        }

        e.preventDefault();
        dialog.open(items);
    });

    injectSidebarLink();
})();