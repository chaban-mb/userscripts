// ==UserScript==
// @name         mb. MASS MERGE FROM EDIT
// @namespace    https://musicbrainz.org/user/chaban
// @version      2025.10.23.9
// @tag          ai-created
// @description  Batch merge recordings from an "Edit medium" page.
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/edit/*
// @connect      musicbrainz.org
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // 1. === Constants and State ===
    const SCRIPT_NAME = GM.info.script.name;
    const SCRIPT_ID = 'mmfe-' + GM.info.script.version.replace(/\./g, '-');
    const STORAGE_KEY = SCRIPT_ID + '_edit_note';
    const MBS = `${location.protocol}//${location.host}`;
    const MBSminimumDelay = 1000;
    const retryDelay = 2000;

    /* COLOURS (from original script) */
    var cOK = "greenyellow";
    var cNG = "pink";
    var cInfo = "gold";
    var cWarning = "yellow";
    var cMerge = "#fcc";
    var cCancel = "#cfc";

    // State variables
    var mergeStatus = null, editNote = null, from = null, to = null, swap = null, queueAll = null, queuetrack = null; // Initialize as null
    var currentButt = null;
    var mergeQueue = [];
    var retry = { count: 0, checking: false, message: '' };
    var lastTick = new Date().getTime();

    // 2. === Initialization ===
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /**
     * Checks if the script should run on the current page and initializes the UI.
     */
    function init() {
        const editHeader = document.querySelector('h1');
        let recordingsTable = null;
        const allHeaders = document.querySelectorAll('table.details.edit-medium th');
        for (const th of allHeaders) {
            if (th.textContent.trim() === 'Recordings:') {
                const td = th.nextElementSibling;
                if (td) {
                    recordingsTable = td.querySelector('table.tbl');
                }
                break;
            }
        }

        if (!location.pathname.startsWith('/edit/') ||
            !editHeader || !editHeader.textContent.includes('Edit medium') ||
            !recordingsTable) {
            return;
        }

        console.log(`[${SCRIPT_NAME}] Initializing on "Edit medium" page.`);
        try {
            buildMergePanel(recordingsTable);
            parseAndFetch(recordingsTable);
        } catch (e) {
             console.error(`[${SCRIPT_NAME}] Error during initialization:`, e);
        }
    }


    // 3. === GUI Building ===
    /**
     * Builds the main control panel for merging.
     * @param {HTMLElement} recordingsTable - The table to insert the panel above.
     */
    function buildMergePanel(recordingsTable) {
        const panel = createTag('div', { a: { id: SCRIPT_ID + '-panel' } });
        panel.style.cssText = `
            background-color: #fcf;
            text-shadow: 1px 1px 2px #663;
            padding: 4px;
            margin: 0px 0px 12px;
            border: 2px dotted white;
        `;

        panel.appendChild(createTag('h2', { s: { color: 'maroon', margin: '0' } }, SCRIPT_NAME));

        // Assign to global variable
        mergeStatus = panel.appendChild(createInput('text', 'mergeStatus', '', 'Parsing edit page...'));
        mergeStatus.style.width = '100%';
        mergeStatus.disabled = true;

        panel.appendChild(createTag('p', { s: { marginBottom: '0px' } }, 'Merge edit notes:'));
        // Assign to global variable
        editNote = panel.appendChild(createInput('textarea', 'merge.edit_note'));
        editNote.style.width = '100%';
        editNote.rows = 5;
        editNote.addEventListener('input', function() {
            this.style.removeProperty('background-color');
            this.removeAttribute('title');
        });

        const saveButt = createInput('button', '', 'Save edit note');
        saveButt.title = 'Save edit note text to local storage for next time';
        saveButt.addEventListener('click', saveEditNote);
        const loadButt = createInput('button', '', 'Load edit note');
        loadButt.title = 'Reload edit note text from local storage';
        loadButt.addEventListener('click', loadEditNote);
        panel.appendChild(createTag('p', {}, [saveButt, ' ', loadButt]));
        loadEditNote(); // Auto-load

        // Assign to global variables
        from = panel.appendChild(createInput('hidden', 'from', ''));
        to = panel.appendChild(createInput('hidden', 'to', ''));
        swap = panel.appendChild(createInput('hidden', 'swap', ''));

        // Assign to global variable
        queueAll = createInput('button', '', 'Merge all');
        queueAll.disabled = true;
        queueAll.style.backgroundColor = cMerge;
        queueAll.addEventListener('click', () => {
            document.querySelectorAll(`.${SCRIPT_ID}-merge-butt`).forEach(btn => {
                if (btn.value === 'Merge') {
                    btn.click();
                }
            });
        });

        const emptyQueueButt = createInput('button', '', 'Empty merge queue');
        emptyQueueButt.style.backgroundColor = cCancel;
        emptyQueueButt.addEventListener('click', () => {
            while (mergeQueue.length > 0) {
                const unqueuedbutt = mergeQueue.shift();
                unqueuedbutt.style.setProperty('background-color', cMerge);
                enableInputs(unqueuedbutt);
                unqueuedbutt.value = 'Merge';
            }
            mmfe_queueTrack();
        });
        panel.appendChild(createTag('p', {}, [queueAll, ' ', emptyQueueButt]));

        // Assign to global variable
        queuetrack = panel.appendChild(createTag('div', {
            s: { textAlign: 'center', backgroundColor: cInfo, display: 'none' }
        }, '\u00A0'));

        recordingsTable.parentNode.insertBefore(panel, recordingsTable);
    }


    // 4. === Data Parsing and Fetching ===
    /**
     * Parses the recording table, fetches row IDs from /data HTML, and injects merge buttons.
     * @param {HTMLElement} recordingsTable - The table to parse.
     */
    function parseAndFetch(recordingsTable) {
        const rows = recordingsTable.querySelectorAll('tbody > tr');
        const pairs = [];

        recordingsTable.querySelector('thead tr').prepend(createTag('th', {}, 'Merge'));

        rows.forEach(row => {
            const oldLink = row.querySelector('span.diff-only-a a[href*="/recording/"]');
            const newLink = row.querySelector('span.diff-only-b a[href*="/recording/"]');
            const cell = createTag('td');
            row.prepend(cell);

            if (oldLink && newLink) {
                const oldMBID = oldLink.href.match(/([a-f0-9-]{36})$/)[1];
                const newMBID = newLink.href.match(/([a-f0-9-]{36})$/)[1];

                if (oldMBID === newMBID) {
                    cell.innerHTML = 'Same';
                    return;
                }

                cell.innerHTML = '...';
                pairs.push({ row, cell, oldMBID, newMBID });
            } else {
                cell.innerHTML = 'N/A';
            }
        });

        if (pairs.length === 0) {
            mmfe_infoMerge('No recording changes found.', true, false);
            return;
        }

        mmfe_infoMerge('Fetching edit data...', null, false);
        GM_xmlhttpRequest({
            method: "GET",
            url: location.pathname + "/data",
            timeout: 30000,
            onload: (response) => {
                try {
                    const mbidToRowId = new Map();
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = response.responseText;

                    let recordingsLi = null;
                    const relatedLists = tempDiv.querySelectorAll('p + ul');
                    relatedLists.forEach(ul => {
                        const previousP = ul.previousElementSibling;
                        if (previousP && previousP.textContent.includes('Related entities:')) {
                           for (const li of ul.children) {
                               if (li.textContent.trim().startsWith('Recordings:')) {
                                   recordingsLi = li;
                                   break;
                               }
                           }
                        }
                    });

                    if (!recordingsLi) {
                        throw new Error("Could not find 'Recordings:' list under 'Related entities:'.");
                    }

                    const recordingLinks = recordingsLi.querySelectorAll('a[href*="/recording/"]');
                    recordingLinks.forEach(link => {
                        const mbidMatch = link.href.match(/([a-f0-9-]{36})$/);
                        const rowId = link.textContent.trim();
                        if (mbidMatch && rowId && /^\d+$/.test(rowId)) {
                            mbidToRowId.set(mbidMatch[1], rowId);
                        } else {
                             console.warn(`[${SCRIPT_NAME}] Could not parse MBID/RowID from link:`, link.outerHTML);
                        }
                    });

                    let readyPairs = 0;
                    pairs.forEach(p => {
                        const oldRowID = mbidToRowId.get(p.oldMBID);
                        const newRowID = mbidToRowId.get(p.newMBID);

                        if (!oldRowID || !newRowID) {
                            p.cell.innerHTML = 'Error';
                            console.error(`[${SCRIPT_NAME}] Row ID lookup failed: oldMBID=${p.oldMBID} -> ${oldRowID}, newMBID=${p.newMBID} -> ${newRowID}`);
                            p.cell.title = `Could not find row ID in /data related entities list for ${!oldRowID ? p.oldMBID : ''} ${!newRowID ? p.newMBID : ''}`;
                            return;
                        }

                        readyPairs++;
                        const form = createTag('form', { a: { class: SCRIPT_ID + '-form' }, s: { display: 'inline' } });
                        const isOldRowTheTarget = parseInt(oldRowID, 10) < parseInt(newRowID, 10);

                        const fromID = isOldRowTheTarget ? newRowID : oldRowID;
                        const toID = isOldRowTheTarget ? oldRowID : newRowID;
                        const fromMBID = isOldRowTheTarget ? p.newMBID : p.oldMBID;
                        const toMBID = isOldRowTheTarget ? p.oldMBID : p.newMBID;

                        const fromInput = form.appendChild(createInput('hidden', 'merge-from', String(fromID)));
                        fromInput.dataset.mbid = fromMBID;
                        const toInput = form.appendChild(createInput('hidden', 'merge-to', String(toID)));
                        toInput.dataset.mbid = toMBID;

                        const dirButt = createInput('button', 'direction', isOldRowTheTarget ? '▶' : '◀');
                        dirButt.type = 'button';
                        dirButt.style.cssText = 'padding: 0 1em .5em 1em; margin: 0 4px;';
                        dirButt.style.backgroundColor = (dirButt.value === '◀') ? cInfo : cOK;
                        dirButt.title = 'Change merge direction. Arrow points to target.';

                        dirButt.addEventListener('click', function(e) {
                            const oldFrom = fromInput.value;
                            const oldTo = toInput.value;
                            const oldFromMBID = fromInput.dataset.mbid;
                            const oldToMBID = toInput.dataset.mbid;

                            fromInput.value = oldTo;
                            toInput.value = oldFrom;
                            fromInput.dataset.mbid = oldToMBID;
                            toInput.dataset.mbid = oldFromMBID;

                            this.value = (this.value === '▶') ? '◀' : '▶';
                            this.style.backgroundColor = (this.value === '◀') ? cInfo : cOK;
                        });

                        const mergeButt = createInput('button', '', 'Merge');
                        mergeButt.type = 'button';
                        mergeButt.className = SCRIPT_ID + '-merge-butt';
                        mergeButt.style.backgroundColor = cMerge;
                        mergeButt.addEventListener('click', handleMergeClick);

                        form.appendChild(dirButt);
                        form.appendChild(mergeButt);
                        removeChildren(p.cell);
                        p.cell.appendChild(form);
                    });

                    mmfe_infoMerge(`Ready to merge ${readyPairs} pairs.`, readyPairs > 0, false);
                    enableInputs(queueAll, readyPairs > 0);

                } catch (e) {
                    console.error(`[${SCRIPT_NAME}] Error parsing data page HTML:`, e);
                    mmfe_infoMerge('Error: Could not parse edit data.', false, false);
                }
            },
            onerror: (e) => {
                console.error(`[${SCRIPT_NAME}] Error fetching data page:`, e);
                mmfe_infoMerge('Error: Could not fetch edit data.', false, false);
            },
            ontimeout: () => {
                console.error(`[${SCRIPT_NAME}] Timeout fetching data page`);
                mmfe_infoMerge('Error: Timeout fetching edit data.', false, false);
            }
        });
    }

    // 5. === Merge Logic (Adapted from original script) ===

    /**
     * Handles the click event for an individual merge button.
     * @param {Event} event - The click event.
     */
    function handleMergeClick(event) {
        event.preventDefault();
        const butt = event.target;
        const form = butt.closest('form');
        const dirButt = form.querySelector('button[name="direction"]');

        butt.style.backgroundColor = cInfo;

        if (butt.value == 'Merge') {
            if (from.value === '') {
                const mergeFromInput = form.querySelector('input[name="merge-from"]');
                const mergeToInput = form.querySelector('input[name="merge-to"]');
                from.value = mergeFromInput.value;
                to.value = mergeToInput.value;
                from.setAttribute('ref', mergeFromInput.dataset.mbid);
                to.setAttribute('ref', mergeToInput.dataset.mbid);

                currentButt = butt;
                mmfe_mergeRecsStep();
            } else if (retry.checking || retry.count > 0 || mergeQueue.indexOf(butt) < 0) {
                butt.value = 'Unqueue';
                enableInputs([butt, dirButt]);
                mergeQueue.push(butt);
            }
        } else if (butt.value == 'Unqueue') {
            const queuedItem = mergeQueue.indexOf(butt);
            if (queuedItem > -1) {
                mergeQueue.splice(queuedItem, 1);
                butt.value = 'Merge';
            }
        } else if (butt.getAttribute('ref') === '0') {
            mmfe_infoMerge('Cancelling merge…', true, true);
            disableInputs(butt);
            butt.removeAttribute('ref');
            butt.value = 'Cancelling…';
        }
        mmfe_queueTrack();
    }

    /**
     * Performs the two-step merge process (queue, then merge).
     * @param {number} [_step=0] - The current step (0 or 1).
     */
    function mmfe_mergeRecsStep(_step) {
         // --- FIX: Add null checks for UI elements ---
        if (!editNote) {
            console.error(`[${SCRIPT_NAME}] editNote element not found!`);
            return;
        }
        // --- END FIX ---

        if (!MBJS.isValidEditNote(editNote.value)) {
            if (!editNote.nextSibling || !editNote.nextSibling.matches('p.error.' + SCRIPT_ID)) {
                addAfter(createTag('p', { a: { class: 'error ' + SCRIPT_ID } }, MBJS.getText('invalid_edit_note')), editNote);
            }
            editNote.style.setProperty('background-color', cNG);
            mmfe_infoMerge('Invalid edit note.', false, true);
             if (currentButt) { // --- FIX: Add null check ---
                currentButt.value = 'Merge';
                currentButt.style.backgroundColor = cMerge;
                enableInputs(currentButt);
            }
            from.value = '';
            to.value = '';
            currentButt = null;
            return;
        }

        editNote.style.removeProperty('background-color');
        const errorP = editNote.nextSibling;
        if (errorP && errorP.matches('p.error.' + SCRIPT_ID)) {
            removeNode(errorP);
        }

        const step = _step || 0;
        const statuses = ['adding recs. to merge', 'applying merge edit'];
        const buttStatuses = ['Stacking…', 'Merging…'];
        const urls = ['/recording/merge_queue', '/recording/merge'];
        const params = [
            `add-to-merge=${to.value}&add-to-merge=${from.value}`,
            `merge.merging.0=${to.value}&merge.target=${to.value}&merge.merging.1=${from.value}`
        ];

        // --- FIX: Add null check for mergeStatus ---
        if (mergeStatus) {
            disableInputs([mergeStatus]);
        }
        // --- END FIX ---

        if (step == 1) {
            const directionButton = currentButt ? currentButt.closest('form').querySelector('button[name="direction"]') : null;
            disableInputs([editNote, currentButt, directionButton].filter(el => el)); // Filter out nulls before disabling

            params[step] += '&merge.edit_note=';
            let paramsup = editNote.value.trim();
            if (paramsup) paramsup += '\n —\n';

            paramsup += `Merging recordings based on /edit/${location.pathname.split('/')[2]}\n`;
            paramsup += `Source: ${MBS}/recording/${from.getAttribute('ref')}\n`;
            paramsup += `Target: ${MBS}/recording/${to.getAttribute('ref')}\n`;
            paramsup += ` —\n${SCRIPT_NAME} (${GM.info.script.version})`;
            if (retry.count > 0) {
                paramsup += ` — '''retry'''${(retry.count > 1 ? ' #' + retry.count : '')} (${protectEditNoteText(retry.message)})`;
            }

            params[step] += encodeURIComponent(paramsup);
        }

        mmfe_infoMerge(`#${from.value} to #${to.value} ${statuses[step]}…`, null, false);
        // --- FIX: Add null check for currentButt ---
        if (currentButt) {
            currentButt.setAttribute('value', `${buttStatuses[step]} ${step + 1}/2`);
            currentButt.setAttribute('ref', String(step));
        } else {
             console.error(`[${SCRIPT_NAME}] currentButt is null in step ${step}. Merge cannot proceed.`);
             mmfe_infoMerge(`Error: Merge button reference lost in step ${step}.`, false, true);
             return; // Stop the process if button reference is lost
        }
        // --- END FIX ---


        GM_xmlhttpRequest({
            method: 'POST',
            url: MBS + urls[step],
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: params[step],
            timeout: 30000,
            onload: (response) => {
                if (to.value === '') {
                    mmfe_nextButt(false);
                    return;
                }

                const html = document.createElement('html');
                html.innerHTML = response.responseText;

                if (step === 0) {
                    if (html.querySelector(`form[method='post'] input[name='merge.target'][value='${from.value}']`) &&
                        html.querySelector(`form[method='post'] input[name='merge.target'][value='${to.value}']`)) {
                        setTimeout(() => mmfe_mergeRecsStep(1), chrono(MBSminimumDelay));
                    } else {
                        mmfe_tryAgain('Did not queue');
                    }
                } else if (step === 1) {
                    if (html.querySelector(`a[href*='/recording/merge_queue?add-to-merge=${to.value}']`)) {
                        mmfe_nextButt(true);
                    } else {
                        mmfe_checkMerge('Did not merge');
                    }
                }
            },
            onerror: (e) => {
                const errorText = `Error ${e.status || 'XHR'} “${e.statusText || 'error'}” in step ${step + 1}/2`;
                if (step === 0) mmfe_tryAgain(errorText);
                else mmfe_checkMerge(errorText);
            },
            ontimeout: () => {
                const errorText = `Timeout in step ${step + 1}/2`;
                if (step === 0) mmfe_tryAgain(errorText);
                else mmfe_checkMerge(errorText);
            }
        });
    }

    /**
     * Checks if a merge edit was created after a potential failure.
     * @param {string} errorText - The error message to log.
     */
    function mmfe_checkMerge(errorText) {
        retry.checking = true;
        mmfe_infoMerge(`Checking merge (${errorText})…`, false, false);

        const queryParams = [
            `conditions.0.field=recording`, `conditions.0.operator=%3D`, `conditions.0.name=${from.value}`, `conditions.0.args.0=${from.value}`,
            `conditions.1.field=recording`, `conditions.1.operator=%3D`, `conditions.1.name=${to.value}`, `conditions.1.args.0=${to.value}`,
            `conditions.2.field=type`, `conditions.2.operator=%3D`, `conditions.2.args=74`,
            `conditions.3.field=status`, `conditions.3.operator=%3D`, `conditions.3.args=1`
        ].join('&');

        setTimeout(() => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${MBS}/search/edits?negation=0&combinator=and&${queryParams}`,
                timeout: 30000,
                onload: (response) => {
                    retry.checking = false;
                    if (response.status < 200 || response.status >= 400) {
                        mmfe_tryAgain(`Check merge error: ${response.status}`);
                    } else {
                        const html = response.responseText;
                        if (html.includes('class="edit-list"')) {
                            const editID = html.match(/>Edit #(\d+)/);
                            mmfe_nextButt(editID ? parseInt(editID[1], 10) : true);
                        } else if (html.includes(`id="remove.${from.value}"`) && html.includes(`id="remove.${to.value}"`)) {
                            retry.count++;
                            retry.message = errorText;
                            mmfe_mergeRecsStep(1);
                        } else {
                            mmfe_tryAgain(errorText);
                        }
                    }
                },
                onerror: () => {
                    retry.checking = false;
                    mmfe_tryAgain('Check merge XHR error');
                },
                ontimeout: () => {
                    retry.checking = false;
                    mmfe_tryAgain('Check merge timeout');
                }
            });
        }, chrono(retryDelay));
    }

    /**
     * Handles the UI update after a merge is complete or cancelled.
     * @param {boolean|number} successOrEditID - false for cancel, true for success, number for edit ID.
     */
    function mmfe_nextButt(successOrEditID) {
        // --- FIX: Add null check ---
        if (!currentButt) {
            console.warn(`[${SCRIPT_NAME}] mmfe_nextButt called but currentButt is null. Success: ${successOrEditID}`);
            // Attempt to recover state if possible, otherwise just log and exit cleanly
            retry.count = 0;
            if (mergeStatus) enableInputs([mergeStatus]);
            if (editNote) enableInputs([editNote]);
            const nextButtFromQueue = mergeQueue.shift();
             if (nextButtFromQueue) {
                enableAndClick(nextButtFromQueue); // Try processing next item
            }
            return;
        }
        // --- END FIX ---


        if (successOrEditID !== false) {
            const form = currentButt.closest('form');
            const cell = form.closest('td');
            removeNode(form);

            cell.prepend(createTag('span', { s: { color: 'green', fontWeight: 'bold' } }, 'Merged!'));

            if (typeof successOrEditID === 'number' || (retry.count > 0)) {
                const infoSpan = addAfter(createTag('span', { s: { opacity: '.5' } }, [' (', createTag('span'), ')']), cell.firstChild).querySelector('span > span');
                if (typeof successOrEditID === 'number') {
                    infoSpan.appendChild(createA('edit:' + successOrEditID, '/edit/' + successOrEditID));
                }
                if (retry.count > 0) {
                    if (infoSpan.childNodes.length > 0) infoSpan.appendChild(document.createTextNode(', '));
                    infoSpan.appendChild(document.createTextNode(`after ${retry.count} retr${retry.count > 1 ? 'ies' : 'y'}`));
                }
            }
            mmfe_infoMerge(`#${from.value} to #${to.value} merged OK`, true, true);
        } else {
            mmfe_infoMerge('Merge cancelled', true, true);
            currentButt.value = 'Merge';
            enableInputs(currentButt);
        }

        retry.count = 0;
        currentButt = null; // Set to null *after* potential re-enabling
        // --- FIX: Add null checks ---
        if (mergeStatus) enableInputs([mergeStatus]);
        if (editNote) enableInputs([editNote]);
        // --- END FIX ---
        const nextButtFromQueue = mergeQueue.shift();
        if (nextButtFromQueue) {
            enableAndClick(nextButtFromQueue);
        }
    }

    /**
     * Schedules a retry for the current merge operation.
     * @param {string} errorText - The error message.
     */
    function mmfe_tryAgain(errorText) {
        retry.count++;
        retry.message = errorText;
        let errormsg = errorText;
        if (currentButt) {
            errormsg = `Retry in ${Math.ceil(retryDelay / 1000)}s (${errormsg}).`;
            setTimeout(() => {
                // Check if currentButt still exists before clicking
                if(currentButt) enableAndClick(currentButt);
                else console.warn(`[${SCRIPT_NAME}] Tried to retry, but currentButt was null.`);
            }, retryDelay);
        }
        mmfe_infoMerge(errormsg, false, true); // Reset from/to here
    }


    // 6. === Shared Helper Functions ===

    /**
     * Updates the merge status bar.
     */
    function mmfe_infoMerge(msg, goodNews, reset) {
        // --- FIX: Add null check ---
        if (mergeStatus) {
            mergeStatus.value = msg;
            if (goodNews != null) {
                mergeStatus.style.setProperty('background-color', goodNews ? cOK : cNG);
            } else {
                mergeStatus.style.setProperty('background-color', cInfo);
            }
        } else {
             console.warn(`[${SCRIPT_NAME}] Tried to update mergeStatus, but it was null. Message: ${msg}`);
        }
        // --- END FIX ---

        if (reset) {
            if (from) from.value = '';
            if (to) to.value = '';
        }
    }

    /**
     * Updates the queue counter display.
     */
    function mmfe_queueTrack() {
        // --- FIX: Add null check ---
        if (queuetrack) {
            queuetrack.textContent = `${mergeQueue.length} queued merge${(mergeQueue.length > 1 ? 's' : '')}`;
            queuetrack.style.display = (mergeQueue.length > 0) ? 'block' : 'none';
        }
        // --- END FIX ---
    }

    /**
     * Re-enables and clicks a button.
     */
    function enableAndClick(butt) {
        // --- FIX: Add null check ---
        if (!butt) {
             console.error(`[${SCRIPT_NAME}] enableAndClick called with null button.`);
             return;
        }
        // --- END FIX ---
        enableInputs(butt);
        butt.value = 'Merge';
        butt.click();
    }


    // 7. === Helper Functions (self-contained) ===
    // These are copied from the original script and its libraries
    // to make this userscript standalone.

    var MBJS = {
        lang: document.querySelector('html[lang]')?.getAttribute('lang') || 'en',
        texts: {
            invalid_edit_note: {
                de: "Deine Bearbeitungsbemerkung scheint keinen tatsächlichen Inhalt zu haben. Bitte gib einen Bemerkung ab, die den anderen Bearbeitern helfen wird!",
                en: "Your edit note seems to have no actual content. Please provide a note that will be helpful to your fellow editors!",
                fr: "Votre note de modification semble n’avoir aucun contenu. Veuillez ajouter une note qui soit utile à vos pairs éditeurs !",
                it: "La tua nota di modifica sembra non avere nessun contenuto reale. Sei pregato di fornire una nota che sia di aiuto agli altri editor!",
                nl: "Je bewerkingsnotitie lijkt geen echte inhoud te hebben. Voeg een notitie toe waar je collegaredacteurs wat aan hebben!",
            },
        },
        isValidEditNote: function(EDIT_NOTE) {
             // --- FIX: Add null check ---
             if (typeof EDIT_NOTE !== 'string') return false;
            // --- END FIX ---
            return !EDIT_NOTE.trim().match(/^[\p{White_Space}\p{Punctuation}]*\p{ASCII}{0,1}[\p{White_Space}\p{Punctuation}]*$/u);
        },
        getText: function(TEXT_ID) {
            if (MBJS.texts[TEXT_ID] && MBJS.texts[TEXT_ID][MBJS.lang]) {
                return MBJS.texts[TEXT_ID][MBJS.lang];
            } else if (MBJS.texts[TEXT_ID]) {
                return MBJS.texts[TEXT_ID].en;
            }
            return '';
        }
    };

    /**
     * createTag (from SUPER.js)
     */
    function createTag(tag, gadgets, children) {
        var t = (tag == "fragment" ? document.createDocumentFragment() : document.createElement(tag));
        if (t.tagName) {
            if (gadgets) {
                for (var attri in gadgets.a) if (Object.prototype.hasOwnProperty.call(gadgets.a, attri)) {
                    t.setAttribute(attri, gadgets.a[attri]);
                }
                for (var style in gadgets.s) if (Object.prototype.hasOwnProperty.call(gadgets.s, style)) {
                    t.style.setProperty(
                        style.replace(/!/g, "").replace(/[A-Z]/g, "-$&").toLowerCase(),
                        gadgets.s[style].replace(/!/g, ""),
                        style.match(/!/) || gadgets.s[style].match(/!/) ? "important" : ""
                    );
                }
                for (var event in gadgets.e) if (Object.prototype.hasOwnProperty.call(gadgets.e, event)) {
                    var listeners = Array.isArray(gadgets.e[event]) ? gadgets.e[event] : [gadgets.e[event]];
                    for (var l = 0; l < listeners.length; l++) { t.addEventListener(event, listeners[l]); }
                }
            }
            if (t.tagName == "A" && !t.getAttribute("href") && !t.style.getPropertyValue("cursor")) { t.style.setProperty("cursor", "pointer"); }
        }
        if (children) {
            var _children = Array.isArray(children) ? children : [children];
            for (var c = 0; c < _children.length; c++) {
                // --- FIX: Ensure child is not null/undefined before appending ---
                 if (_children[c] !== null && typeof _children[c] !== 'undefined') {
                    t.appendChild((typeof _children[c]).match(/number|string/) ? document.createTextNode(_children[c]) : _children[c]);
                }
                // --- END FIX ---
            }
            t.normalize();
        }
        return t;
    }

    /**
     * createInput (from mb_MASS-MERGE-RECORDINGS.user.js)
     */
    function createInput(type, name, value, placeholder) {
        var input;
        if (type == "textarea") {
            input = createTag("textarea", {}, value);
        } else {
            input = createTag("input", {a: {type: type, value: value}});
        }
        if (placeholder) input.setAttribute("placeholder", placeholder);
        input.setAttribute("name", name);
        input.style.setProperty("font-size", ".8em");
        if (type == "text") {
            input.addEventListener("focus", function(event) {
                this.select();
            });
        }
        return input;
    }

    /**
     * createA (from mb_MASS-MERGE-RECORDINGS.user.js)
     */
    function createA(text, link) {
        var a = document.createElement("a");
        if (link) {
            a.setAttribute("href", link);
            a.setAttribute("target", "_blank");
        } else {
            a.style.setProperty("cursor", "pointer");
        }
        a.appendChild(document.createTextNode(text));
        return a;
    }

    /**
     * addAfter (from SUPER.js)
     */
    function addAfter(newNode, existingNode) {
        if (newNode && existingNode && existingNode.parentNode) {
            if (existingNode.nextSibling) {
                return existingNode.parentNode.insertBefore(newNode, existingNode.nextSibling);
            } else {
                return existingNode.parentNode.appendChild(newNode);
            }
        } else {
             console.warn(`[${SCRIPT_NAME}] addAfter failed: newNode or existingNode invalid.`);
            return null;
        }
    }

    /**
     * removeNode (from SUPER.js)
     */
    function removeNode(node) {
        // --- FIX: Add null check ---
        if (node && node.parentNode) {
            return node.parentNode.removeChild(node);
        } else {
            console.warn(`[${SCRIPT_NAME}] removeNode failed: Node or parentNode invalid.`, node);
            return null;
        }
        // --- END FIX ---
    }

    /**
     * removeChildren (from SUPER.js)
     */
    function removeChildren(parent) {
         // --- FIX: Add null check ---
        if (!parent) {
             console.warn(`[${SCRIPT_NAME}] removeChildren called with null parent.`);
             return;
        }
        // --- END FIX ---
        while (parent.hasChildNodes()) {
            parent.removeChild(parent.firstChild);
        }
    }

    /**
     * disableInputs (from SUPER.js)
     */
    function disableInputs(inputs, setAsDisabled) {
        if (!inputs) { // --- FIX: Add null check for the whole input list/element ---
            console.warn(`[${SCRIPT_NAME}] disableInputs called with null/undefined input.`);
            return;
        } // --- END FIX ---

        if (Array.isArray(inputs) || inputs instanceof NodeList) {
            for (var i = 0; i < inputs.length; i++) {
                 // --- FIX: Add null check for individual items ---
                 if (inputs[i]) {
                    disableInputs(inputs[i], setAsDisabled);
                } else {
                     console.warn(`[${SCRIPT_NAME}] disableInputs found null item in array/NodeList at index ${i}.`);
                 }
                 // --- END FIX ---
            }
        } else if (typeof setAsDisabled == "undefined" || setAsDisabled == true) {
            // --- FIX: Check if setAttribute exists before calling ---
            if (typeof inputs.setAttribute === 'function') {
                inputs.setAttribute("disabled", "disabled");
            } else {
                 console.warn(`[${SCRIPT_NAME}] disableInputs: Input element lacks setAttribute method.`, inputs);
            }
            // --- END FIX ---
        } else {
             // --- FIX: Check if removeAttribute exists before calling ---
             if (typeof inputs.removeAttribute === 'function') {
                 inputs.removeAttribute("disabled");
             } else {
                 console.warn(`[${SCRIPT_NAME}] disableInputs: Input element lacks removeAttribute method.`, inputs);
             }
             // --- END FIX ---
        }
    }

    /**
     * enableInputs (from SUPER.js)
     */
    function enableInputs(inputs, setAsEnabled) {
        disableInputs(inputs, !(typeof setAsEnabled == "undefined" || setAsEnabled));
    }

    /**
     * protectEditNoteText (from mb_MASS-MERGE-RECORDINGS.user.js)
     */
    function protectEditNoteText(text) {
         // --- FIX: Add null/type check ---
         if (typeof text !== 'string') return '';
         // --- END FIX ---
        return text.replace(/'/g, "'");
    }

    /**
     * chrono (from mb_MASS-MERGE-RECORDINGS.user.js)
     */
    function chrono(minimumDelay) {
        if (minimumDelay) {
            var del = minimumDelay + lastTick - new Date().getTime();
            del = del > 0 ? del : 0;
            return del;
        } else {
            lastTick = new Date().getTime();
            return lastTick;
        }
    }

    /**
     * stop (from SUPER.js)
     */
    function stop(event) {
         // --- FIX: Add null check ---
        if (!event) {
             console.warn(`[${SCRIPT_NAME}] stop called with null event.`);
             return false;
        }
         // --- END FIX ---
        event.cancelBubble = true;
        if (event.stopPropagation) event.stopPropagation();
        event.preventDefault();
        return false;
    }

    /**
     * saveEditNote (modified from mb_MASS-MERGE-RECORDINGS.user.js)
     */
    function saveEditNote(event) {
        // --- FIX: Add null check ---
        if (!editNote) {
             console.error(`[${SCRIPT_NAME}] saveEditNote failed: editNote element not found.`);
             return stop(event); // Still stop default event behavior if possible
        }
        // --- END FIX ---
        if (localStorage) {
            localStorage.setItem(STORAGE_KEY, editNote.value);
            editNote.style.setProperty("background-color", cOK);
            editNote.setAttribute("title", "Saved to local storage");
        } else {
            editNote.style.setProperty("background-color", cInfo);
            editNote.setAttribute("title", "Could not save to local storage");
        }
        return stop(event);
    }

    /**
     * loadEditNote (modified from mb_MASS-MERGE-RECORDINGS.user.js)
     */
    function loadEditNote(event) {
         // --- FIX: Add null check ---
         if (!editNote) {
             console.warn(`[${SCRIPT_NAME}] loadEditNote called but editNote element not found yet.`);
            if(event) return stop(event); // Still stop default event behavior if possible
            return;
         }
         // --- END FIX ---
        if (localStorage) {
            var savedEditNote = localStorage.getItem(STORAGE_KEY);
            if (savedEditNote) {
                editNote.value = savedEditNote;
                editNote.style.setProperty("background-color", cOK);
                editNote.setAttribute("title", "Reloaded from local storage");
            }
        }
        if (event) {
            return stop(event);
        }
    }

})();