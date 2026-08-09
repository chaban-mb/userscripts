// ==UserScript==
// @name        MusicBrainz: Pending Edits Logger
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.0.2
// @description Real-time diagnostic & debug auditor logging pending changes across MusicBrainz editors (Relationship Editors, External Links Editor, and HTML Form fields).
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       https://musicbrainz.org/*
// @match       https://*.musicbrainz.org/*
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       none
// @run-at      document-end
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Pending%20Edits%20Logger.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Pending%20Edits%20Logger.user.js
// ==/UserScript==

(function () {
    'use strict';

    const scriptName = 'Pending Edits Logger';
    const logStyle = 'font-weight: bold; color: #d97706; background-color: #fef3c7; padding: 2px 6px; border-radius: 3px;';

    /**
     * Predicate checking if the current page is an active MusicBrainz editor page.
     * @returns {boolean} True if page is an edit route or contains active editor containers.
     */
    const isEditPage = () => {
        const path = location.pathname;

        // Non-editor subpages to explicitly exclude (e.g. /tags, /aliases, /details, /history)
        if (path.endsWith('/tags') || path.endsWith('/aliases') || path.endsWith('/details') ||
            path.endsWith('/subscribers') || path.endsWith('/history') || path.endsWith('/ratings') ||
            path.endsWith('/relationships') || path.endsWith('/discids') || path.endsWith('/edits')) {
            return false;
        }

        const isEditorRoute = (
            path.endsWith('/edit') ||
            path.endsWith('/edit-relationships') ||
            path.endsWith('/add-cover-art') ||
            path.endsWith('/add-event-art') ||
            path.endsWith('/reorder-cover-art') ||
            path.endsWith('/reorder-event-art') ||
            path.includes('/edit-event-art') ||
            path.includes('/remove-event-art') ||
            path.endsWith('/add') ||
            path.includes('/create') ||
            path.includes('/merge')
        );

        const hasEditorContainer = Boolean(
            document.getElementById('relationship-editor') ||
            document.getElementById('external-links-editor') ||
            document.getElementById('release-editor') ||
            document.getElementById('add-cover-art') ||
            document.getElementById('add-event-art') ||
            document.getElementById('reorder-cover-art') ||
            document.getElementById('reorder-event-art') ||
            document.querySelector('.release-relationship-editor') ||
            document.querySelector('form[action*="/edit"] button.submit.positive[type="submit"]') ||
            document.querySelector('button#add-cover-art-submit, button#add-event-art-submit')
        );

        return isEditorRoute || hasEditorContainer;
    };

    /**
     * Diagnostic auditor inspecting state across:
     * - Release Relationship Editor & Entity Relationship Editor (MB.relationshipEditor)
     * - External Links Editor (React Fiber)
     * - Standard HTML Form input fields (name, area, dates, type, disambiguation, edit note)
     * - Submit button state in DOM
     * @returns {Object} Diagnostic audit report object.
     */
    function auditPageForPendingEdits() {
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const report = {
            timestamp: new Date().toISOString(),
            url: location.href,
            isEditPage: isEditPage(),
            hasPendingEdits: false,
            releaseEditorEdits: { count: 0, items: [] },
            relationshipEdits: { count: 0, items: [] },
            externalLinkEdits: { count: 0, items: [] },
            formInputEdits: { count: 0, items: [] },
            submitButtonStatus: { found: false, enabled: false, selector: '' }
        };

        if (!report.isEditPage) {
            return report;
        }

        // 0. Release Editor Audit (Knockout Release Editor)
        const releaseEditor = win.MB?.releaseEditor;
        if (releaseEditor?.allEdits) {
            try {
                const edits = releaseEditor.allEdits();
                if (Array.isArray(edits)) {
                    edits.forEach((editItem, idx) => {
                        const edit = typeof editItem === 'function' ? editItem() : editItem;
                        const editType = edit?.editType || edit?.type || edit?.name || `edit_${idx}`;
                        report.releaseEditorEdits.items.push({
                            editType,
                            details: edit
                        });
                    });
                    report.releaseEditorEdits.count = report.releaseEditorEdits.items.length;
                }
            } catch (e) { }
        }

        // 1. Relationship Editor Audit
        const relState = win.MB?.relationshipEditor?.state;
        const tree = win.MB?.tree;
        if (relState && tree) {
            const visited = new Set();
            const traverseRels = (node, path = 'root') => {
                if (!node || typeof node !== 'object' || visited.has(node)) return;
                visited.add(node);

                if ('linkTypeID' in node || '_status' in node || 'entity0' in node) {
                    const status = node._status ?? node.status ?? 0;
                    const statusName = status === 1 ? 'ADD' : status === 2 ? 'EDIT' : status === 3 ? 'REMOVE' : status === 0 ? 'NOOP' : `UNKNOWN(${status})`;

                    if (status > 0) {
                        report.relationshipEdits.items.push({
                            path,
                            id: node.id,
                            status: statusName,
                            linkTypeID: node.linkTypeID,
                            entity0: node.entity0?.name || node.entity0?.gid || node.entity0,
                            entity1: node.entity1?.name || node.entity1?.gid || node.entity1
                        });
                    }
                }

                if ('weight' in node || 'left' in node || 'right' in node) {
                    try {
                        for (const entry of tree.iterate(node)) {
                            const val = Array.isArray(entry) ? entry[1] : entry;
                            traverseRels(val, path);
                        }
                    } catch (e) { }
                    return;
                }

                if (Array.isArray(node)) {
                    node.forEach((item, idx) => traverseRels(item, `${path}[${idx}]`));
                    return;
                }

                for (const key of Object.keys(node)) {
                    if (key === '_original') continue;
                    if (node[key] && typeof node[key] === 'object') {
                        traverseRels(node[key], `${path}.${key}`);
                    }
                }
            };

            if (relState.relationshipsBySource) traverseRels(relState.relationshipsBySource, 'relationshipsBySource');
            if (relState.mediums) traverseRels(relState.mediums, 'mediums');
            report.relationshipEdits.count = report.relationshipEdits.items.length;
        }

        // 2. External Links Editor Audit (Release Editor State + DOM Highlight Fallback)
        let handledViaReleaseEditor = false;
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
                            } catch (e) { }
                        }
                        if (linksTree && typeof linksTree.values === 'function') {
                            return Array.from(linksTree.values());
                        }
                        if (Array.isArray(linksTree)) return linksTree;
                        return [];
                    };

                    const arePartialDatesEqual = (d1, d2) => {
                        if (!d1 && !d2) return true;
                        if (!d1 || !d2) return false;
                        return (d1.year ?? null) === (d2.year ?? null) &&
                            (d1.month ?? null) === (d2.month ?? null) &&
                            (d1.day ?? null) === (d2.day ?? null);
                    };

                    const formatPartialDate = (d) => {
                        if (!d) return null;
                        const parts = [d.year, d.month, d.day].filter(Boolean);
                        return parts.length > 0 ? parts.join('-') : null;
                    };

                    const isRelationshipPending = (rel) => {
                        if (!rel) return false;
                        if (rel.originalState == null) return true;
                        if (rel.removed) return true;

                        const orig = rel.originalState;
                        if (rel.url !== orig.url) return true;
                        if (rel.linkTypeID !== orig.linkTypeID) return true;
                        if (rel.entityCredit !== orig.entityCredit) return true;
                        if (rel.video !== orig.video) return true;
                        if (Boolean(rel.ended) !== Boolean(orig.ended)) return true;
                        if (!arePartialDatesEqual(rel.beginDate, orig.beginDate)) return true;
                        if (!arePartialDatesEqual(rel.endDate, orig.endDate)) return true;
                        return false;
                    };

                    const linkList = iterateLinks(links);
                    linkList.forEach(link => {
                        const rels = Array.isArray(link.relationships) ? link.relationships : [];
                        rels.forEach(rel => {
                            if (isRelationshipPending(rel)) {
                                const isNew = rel.originalState == null;
                                const isRemove = rel.removed === true;

                                const beginStr = formatPartialDate(rel.beginDate);
                                const endStr = formatPartialDate(rel.endDate);
                                let datePeriod = null;
                                if (beginStr || endStr) datePeriod = `${beginStr || '?'} - ${endStr || '?'}`;
                                if (rel.ended) datePeriod = datePeriod ? `${datePeriod} (ended)` : '(ended)';

                                report.externalLinkEdits.items.push({
                                    source: 'release_editor_state',
                                    type: isNew ? 'new_relationship' : isRemove ? 'removed_relationship' : 'edited_relationship',
                                    url: link.url || 'External Link',
                                    linkTypeID: rel.linkTypeID,
                                    datePeriod: datePeriod || undefined,
                                    entityCredit: rel.entityCredit || undefined,
                                    video: rel.video,
                                    ended: rel.ended
                                });
                            }
                        });
                    });
                    report.externalLinkEdits.count = report.externalLinkEdits.items.length;
                    handledViaReleaseEditor = true;
                }
            } catch (e) { }
        }

        if (!handledViaReleaseEditor) {
            const externalEditorDom = document.getElementById('external-links-editor') ||
                document.querySelector('.external-links-editor-container');
            if (externalEditorDom) {
                const rows = new Set();
                const highlightNodes = externalEditorDom.querySelectorAll('.rel-add, .rel-edit, .rel-remove');
                highlightNodes.forEach(node => {
                    const parentRow = node.closest('tr') || node;
                    if (!rows.has(parentRow)) {
                        rows.add(parentRow);
                        const isAdd = parentRow.querySelector('.rel-add') !== null || parentRow.classList.contains('rel-add');
                        const isRemove = parentRow.querySelector('.rel-remove') !== null || parentRow.classList.contains('rel-remove');
                        const isEdit = parentRow.querySelector('.rel-edit') !== null || parentRow.classList.contains('rel-edit');

                        let url = null;
                        let currRow = parentRow;
                        while (currRow) {
                            const a = currRow.querySelector('a.url');
                            if (a?.href) { url = a.href; break; }
                            const input = currRow.querySelector('input[type="url"], input.value');
                            if (input?.value) { url = input.value; break; }
                            currRow = currRow.previousElementSibling;
                        }

                        const select = parentRow.querySelector('select[id*="url-link-type"]');
                        let typeName = select ? select.options[select.selectedIndex]?.text?.trim() : null;
                        if (!typeName) {
                            const relNameEl = parentRow.querySelector('.relationship-name');
                            typeName = relNameEl?.textContent?.replace(/[\s\u00a0]+/g, ' ')?.trim();
                        }

                        const datePeriod = parentRow.querySelector('.date-period')?.textContent?.replace(/[\s\u00a0]+/g, ' ')?.trim();
                        const entityCredit = parentRow.querySelector('.entity-credit')?.textContent?.replace(/[\s\u00a0]+/g, ' ')?.trim();
                        const videoInput = parentRow.querySelector('.attribute-container input[type="checkbox"]');
                        const isVideo = videoInput ? videoInput.checked : undefined;

                        report.externalLinkEdits.items.push({
                            source: 'dom_fallback',
                            type: isAdd ? 'new_relationship' : isRemove ? 'removed_relationship' : isEdit ? 'edited_relationship' : 'unknown',
                            url: url || 'External Link',
                            linkType: typeName || undefined,
                            datePeriod: datePeriod || undefined,
                            entityCredit: entityCredit || undefined,
                            video: isVideo,
                            class: isAdd ? 'rel-add' : isRemove ? 'rel-remove' : 'rel-edit'
                        });
                    }
                });
                report.externalLinkEdits.count = report.externalLinkEdits.items.length;
            }
        }

        const normalizeText = (str) => {
            if (typeof str !== 'string') return str;
            return str.replace(/\u00a0/g, ' ').trim();
        };

        // 3. HTML Form Inputs Audit via Native DOM Properties & FormData
        const getEditForms = () => {
            return Array.from(document.forms).filter(form => {
                const action = form.getAttribute('action') || '';
                const className = form.className || '';
                const id = form.id || '';
                return className.includes('edit-') || className.includes('cover-art') || className.includes('event-art') ||
                    action.includes('/edit') || action.includes('/add') || action.includes('/reorder') || action.includes('/create') || action.includes('/merge') ||
                    id.includes('reorder') ||
                    form.closest('#release-editor, #relationship-editor, #external-links-editor, #reorder-cover-art, #reorder-event-art') !== null;
            });
        };

        const isNativeElementDirty = (el) => {
            if (!el || !el.name) return false;
            const name = el.name;
            if (name.includes('csrf') || name.includes('confirm') || name === 'tag' || name.includes('edit_note') || name.includes('edit-note')) {
                return false;
            }

            if (el instanceof HTMLInputElement) {
                if (el.type === 'checkbox' || el.type === 'radio') {
                    return el.defaultChecked !== el.checked;
                } else if (el.type !== 'submit' && el.type !== 'button' && el.type !== 'hidden') {
                    return normalizeText(el.defaultValue) !== normalizeText(el.value);
                }
            } else if (el instanceof HTMLTextAreaElement) {
                return normalizeText(el.defaultValue) !== normalizeText(el.value);
            } else if (el instanceof HTMLSelectElement) {
                return Array.from(el.options).some(opt => opt.defaultSelected !== opt.selected);
            }
            return false;
        };

        const isNativeFormDirty = (form) => {
            if (!form || !form.elements) return false;
            for (const el of form.elements) {
                if (isNativeElementDirty(el)) return true;
            }
            return false;
        };

        const getFormDataMap = (form) => {
            const map = new Map();
            try {
                const formData = new FormData(form);
                const removedKeys = new Set();

                // Capture DOM element ordering of artwork IDs on reorder pages
                const artIdInputs = Array.from(form.querySelectorAll('div.editimage input.id, .image-position input.id'));
                if (artIdInputs.length > 0) {
                    map.set('__art_sequence', artIdInputs.map(input => input.value));
                }

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
                    // Do not sort __art_sequence so sequence changes are preserved
                    if (arr !== map.get('__art_sequence')) {
                        arr.sort();
                    }
                }
            } catch (e) { }
            return map;
        };

        const editForms = getEditForms();

        if (!window.__mbInitialFormSnapshots) {
            window.__mbInitialFormSnapshots = new Map();
        }
        editForms.forEach(form => {
            if (!window.__mbInitialFormSnapshots.has(form) && !isNativeFormDirty(form)) {
                window.__mbInitialFormSnapshots.set(form, getFormDataMap(form));
            }
        });

        if (!window.__mbHydrationListenerAdded) {
            window.__mbHydrationListenerAdded = true;

            const refreshBaseline = (eventSource) => {
                setTimeout(() => {
                    const currentForms = getEditForms();
                    currentForms.forEach(form => {
                        if (!window.__mbInitialFormSnapshots.has(form) && !isNativeFormDirty(form)) {
                            window.__mbInitialFormSnapshots.set(form, getFormDataMap(form));
                        }
                    });
                    window.__mbHydrationCaptured = true;
                    checkAndLogChanges(eventSource);
                }, 100);
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => refreshBaseline('dom_content_loaded'), { once: true });
            } else {
                refreshBaseline('page_load_immediate');
            }

            document.addEventListener('mb-hydration', () => refreshBaseline('mb_hydration'));
        }

        const recordedFieldKeys = new Set();

        editForms.forEach(form => {
            // First check native DOM dirty inputs directly
            if (form.elements) {
                for (const el of form.elements) {
                    if (isNativeElementDirty(el)) {
                        const name = el.name;
                        let origVal = '';
                        let currVal = '';
                        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
                            origVal = String(el.defaultChecked);
                            currVal = String(el.checked);
                        } else if (el instanceof HTMLSelectElement) {
                            const origOpts = Array.from(el.options).filter(o => o.defaultSelected).map(o => o.value);
                            const currOpts = Array.from(el.options).filter(o => o.selected).map(o => o.value);
                            origVal = origOpts.join(', ');
                            currVal = currOpts.join(', ');
                        } else {
                            origVal = normalizeText(el.defaultValue);
                            currVal = normalizeText(el.value);
                        }

                        if (!recordedFieldKeys.has(name)) {
                            recordedFieldKeys.add(name);
                            report.formInputEdits.items.push({
                                name,
                                original: origVal,
                                current: currVal
                            });
                        }
                    }
                }
            }

            // Also check FormData snapshot diffs for hidden/dynamic inputs
            if (!window.__mbInitialFormSnapshots.has(form)) {
                window.__mbInitialFormSnapshots.set(form, getFormDataMap(form));
            }
            const initialMap = window.__mbInitialFormSnapshots.get(form);
            const currentMap = getFormDataMap(form);

            const allKeys = new Set([...initialMap.keys(), ...currentMap.keys()]);
            for (const key of allKeys) {
                if (recordedFieldKeys.has(key)) continue;
                const origVals = initialMap.get(key) || [];
                const currVals = currentMap.get(key) || [];

                const origStr = origVals.join(', ');
                const currStr = currVals.join(', ');

                if (origStr !== currStr) {
                    recordedFieldKeys.add(key);
                    report.formInputEdits.items.push({
                        name: key,
                        original: origStr,
                        current: currStr
                    });
                }
            }
        });
        report.formInputEdits.count = report.formInputEdits.items.length;

        // 4. Submit Button Audit
        const submitBtn = document.querySelector('form[action*="/edit"] button.submit.positive[type="submit"], form[action*="/add"] button.submit.positive[type="submit"], button.submit.positive[type="submit"], button#enter-edit, button#add-cover-art-submit, button#add-event-art-submit');
        if (submitBtn) {
            report.submitButtonStatus = {
                found: true,
                enabled: !submitBtn.disabled,
                selector: submitBtn.className || submitBtn.tagName
            };
        }

        report.hasPendingEdits = (
            report.releaseEditorEdits.count > 0 ||
            report.relationshipEdits.count > 0 ||
            report.externalLinkEdits.count > 0 ||
            report.formInputEdits.count > 0
        );

        return report;
    }

    // Expose auditPageForPendingEdits on window / unsafeWindow for manual console inspection
    if (typeof window !== 'undefined') window.auditPageForPendingEdits = auditPageForPendingEdits;
    if (typeof unsafeWindow !== 'undefined') unsafeWindow.auditPageForPendingEdits = auditPageForPendingEdits;

    // --- Real-Time Immediate Change Monitoring ---
    let lastSummary = '';

    function checkAndLogChanges(triggerEvent = 'state_check') {
        if (!isEditPage()) return;

        const report = auditPageForPendingEdits();
        const currentSummary = JSON.stringify({
            relEdCount: report.releaseEditorEdits.count,
            relCount: report.relationshipEdits.count,
            extCount: report.externalLinkEdits.count,
            formCount: report.formInputEdits.count,
            btnEnabled: report.submitButtonStatus.enabled,
            relEdItems: report.releaseEditorEdits.items,
            formItems: report.formInputEdits.items,
            relItems: report.relationshipEdits.items,
            extItems: report.externalLinkEdits.items
        });

        if (currentSummary !== lastSummary) {
            lastSummary = currentSummary;

            console.group(`%c[${scriptName}] Pending Edits State Change Detected (${triggerEvent})`, logStyle);
            console.log(`Has Pending Edits: %c${report.hasPendingEdits}`, report.hasPendingEdits ? 'color: #16a34a; font-weight: bold;' : 'color: #dc2626;');
            if (report.releaseEditorEdits.count > 0) {
                console.log(`Release Editor Edits (${report.releaseEditorEdits.count}):`, report.releaseEditorEdits.items);
            }
            if (report.relationshipEdits.count > 0) {
                console.log(`Relationship Edits (${report.relationshipEdits.count}):`, report.relationshipEdits.items);
            }
            if (report.externalLinkEdits.count > 0) {
                console.log(`External Link Edits (${report.externalLinkEdits.count}):`, report.externalLinkEdits.items);
            }
            if (report.formInputEdits.count > 0) {
                console.log(`Form Input Edits (${report.formInputEdits.count}):`, report.formInputEdits.items);
            }
            console.log(`Submit Button Enabled: %c${report.submitButtonStatus.enabled}`, report.submitButtonStatus.enabled ? 'color: #16a34a;' : 'color: #dc2626;');
            console.groupEnd();
        }
    }

    // 1. Immediate Event Listeners (Form inputs, textareas, selects)
    document.addEventListener('input', (e) => checkAndLogChanges(`input:${e.target.name || e.target.tagName}`), true);
    document.addEventListener('change', (e) => checkAndLogChanges(`change:${e.target.name || e.target.tagName}`), true);
    document.addEventListener('blur', (e) => checkAndLogChanges(`blur:${e.target.name || e.target.tagName}`), true);

    // 2. DOM MutationObserver for React/Knockout Editor updates
    const observer = new MutationObserver(() => {
        checkAndLogChanges('dom_mutation');
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    // 3. Periodic Poll (Fallback for React internal state changes without DOM mutation)
    setInterval(() => {
        checkAndLogChanges('periodic_poll');
    }, 1000);

    if (isEditPage()) {
        console.log(`%c[${scriptName}] Live change logger active on edit page. Use window.auditPageForPendingEdits() for manual audit.`, 'color: #d97706; font-weight: bold;');
    }
})();
