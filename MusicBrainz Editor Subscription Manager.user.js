// ==UserScript==
// @name         MusicBrainz: Editor Subscription Manager
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.1.0
// @tag          ai-created
// @description  Manages editor subscriptions by checking for spammers and inactivity, and allowing batch unsubscription.
// @author       chaban
// @license      MIT
// @match        *://musicbrainz.org/user/*/subscriptions/editor*
// @match        *://musicbrainz.eu/user/*/subscriptions/editor*
// @connect      self
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const CONCURRENCY_LIMIT = 5;
    const EDITORS_PER_PAGE = 100;
    const SPAMMER_TEXT = 'This user was blocked and their profile is hidden';

    /**
     * @typedef {object} EditorInfo
     * @property {string} id - The editor's MusicBrainz ID.
     * @property {string} name - The editor's username.
     * @property {string} profileUrl - The absolute URL to the editor's profile page.
     * @property {boolean | null} isSpammer - True if the editor is flagged as a spammer, false if not, null if check failed.
     * @property {string | null} lastEditDate - ISO 8601 string of the last closed edit, or null if no closed edits found.
     * @property {string | null} restrictions - Text content of any account restrictions (e.g., "Editing disabled").
     * @property {string | null} memberSince - ISO 8601 string of the registration date.
     * @property {string | null} userType - Text content of the user's type (e.g., "Auto-editor, Account admin").
     * @property {string | null} error - An error message if processing this editor failed.
     */

    /**
     * In-memory store for all processed editor data.
     * @type {EditorInfo[]}
     */
    let allEditorData = [];

    /**
     * Stores the current sort state for the report table.
     * @type {{key: keyof EditorInfo, asc: boolean}}
     */
    const sortState = {
        key: 'name',
        asc: true,
    };

    // #region Utility Functions

    /**
     * Fetches a URL via GM_xmlhttpRequest and returns a parsed HTML Document.
     * @param {string} url - The URL to fetch.
     * @returns {Promise<Document>} A promise that resolves with the parsed HTML document.
     */
    function fetchDOM(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        const doc = new DOMParser().parseFromString(
                            response.responseText,
                            'text/html'
                        );
                        resolve(doc);
                    } else {
                        reject(
                            new Error(
                                `Failed to fetch ${url}: ${response.status}`
                            )
                        );
                    }
                },
                onerror: (error) => {
                    reject(new Error(`Failed to fetch ${url}: ${error.error}`));
                },
            });
        });
    }

    /**
     * Performs a batched POST request to unsubscribe from a list of editors.
     * Updates the UI dynamically on success without reloading the page.
     * @param {string[]} ids - Array of editor IDs to unsubscribe.
     * @returns {Promise<void>}
     */
    async function unsubscribe(ids) {
        if (!ids || ids.length === 0) {
            alert('No editors selected for unsubscription.');
            return;
        }

        updateProgress(
            `Starting unsubscription for ${ids.length} editor(s)...`
        );
        const BATCH_SIZE = 100;
        let unsubscribedCount = 0;

        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            const chunk = ids.slice(i, i + BATCH_SIZE);
            const postData = chunk
                .map((id) => `id=${encodeURIComponent(id)}`)
                .join('&');

            updateProgress(
                `Unsubscribing batch ${i / BATCH_SIZE + 1}/${Math.ceil(
                    ids.length / BATCH_SIZE
                )}...`
            );

            try {
                await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: `${location.origin}/account/subscriptions/editor/remove`,
                        headers: {
                            'Content-Type':
                                'application/x-www-form-urlencoded',
                        },
                        data: postData,
                        onload: (response) => {
                            if (
                                response.status >= 200 &&
                                response.status < 400
                            ) {
                                unsubscribedCount += chunk.length;
                                resolve(response);
                            } else {
                                reject(
                                    new Error(
                                        `Failed to unsubscribe: ${response.status}`
                                    )
                                );
                            }
                        },
                        onerror: (error) => reject(error.error),
                    });
                });
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] Batch unsubscribe failed:`, error);
                alert(
                    `An error occurred during unsubscription. ${error.message}. Check console for details.`
                );
                showProgress(false);
                return;
            }
        }

        // --- UI Update Logic (No Reload) ---
        allEditorData = allEditorData.filter(
            (editor) => !ids.includes(editor.id)
        );
        renderReportTable();
        updateReportStats();
        showProgress(false);
        alert(
            `Successfully unsubscribed from ${unsubscribedCount} editor(s). The report has been updated.`
        );
    }

    /**
     * Shows or hides the floating progress bar.
     * @param {boolean} show - True to show, false to hide.
     * @param {string} [text=''] - The text to display in the progress bar.
     */
    function showProgress(show, text = '') {
        const progressEl =
            document.getElementById('esm-progress-ui') || createProgressUI();
        if (show) {
            progressEl.style.display = 'block';
            updateProgress(text);
        } else {
            progressEl.style.display = 'none';
        }
    }

    /**
     * Updates the text content of the progress bar.
     * @param {string} text - The text to display.
     */
    function updateProgress(text) {
        const progressEl = document.getElementById('esm-progress-text');
        if (progressEl) {
            progressEl.textContent = text;
        }
    }

    /**
     * Enables or disables the main 'Manage' buttons.
     * @param {boolean} disabled - True to disable, false to enable.
     */
    function setButtonsDisabled(disabled) {
        const testBtn = document.getElementById('esm-test-button');
        const fullBtn = document.getElementById('esm-full-button');
        if (testBtn) testBtn.disabled = disabled;
        if (fullBtn) fullBtn.disabled = disabled;
    }

    // #endregion

    // #region Data Fetching and Processing

    /**
     * Scrapes the total number of editor subscriptions from the page.
     * @returns {number} The total count of subscribed editors.
     */
    function getTotalEditorCount() {
        const listItems = document.querySelectorAll('#page > p + ul > li');
        const editorLi = [...listItems].find((li) =>
            li.textContent.includes(' editors')
        );
        if (editorLi) {
            return parseInt(editorLi.textContent.replace(/,/g, ''), 10) || 0;
        }
        return 0;
    }

    /**
     * Parses a subscription page DOM for basic editor info.
     * @param {Document} doc - The HTML document of a subscription page.
     * @returns {Pick<EditorInfo, 'id' | 'name' | 'profileUrl'>[]} An array of basic editor info objects.
     */
    function parseEditorsFromPage(doc) {
        const rows = doc.querySelectorAll(
            'form[action*="/account/subscriptions/editor/remove"] tbody tr'
        );
        const editors = [];
        rows.forEach((row) => {
            const idInput = row.querySelector('input[name="id"]');
            const link = row.querySelector('a[href*="/user/"]');
            if (idInput && link) {
                editors.push({
                    id: idInput.value,
                    name: link.textContent.trim(),
                    profileUrl: link.href,
                });
            }
        });
        return editors;
    }

    /**
     * Fetches all pages of editor subscriptions and returns a complete list of basic editor info.
     * @param {number} totalEditors - The total number of editors to fetch.
     * @returns {Promise<Pick<EditorInfo, 'id' | 'name' | 'profileUrl'>[]>} A promise resolving to the full list of editors.
     */
    async function fetchAllSubscribedEditors(totalEditors) {
        const totalPages = Math.ceil(totalEditors / EDITORS_PER_PAGE);
        const baseUrl = location.pathname;
        const pagePromises = [];

        updateProgress(`Fetching ${totalPages} subscription pages...`);

        for (let i = 1; i <= totalPages; i++) {
            const currentPage = parseInt(
                new URLSearchParams(location.search).get('page') || '1',
                10
            );
            if (i === currentPage) {
                pagePromises.push(Promise.resolve(document));
            } else {
                pagePromises.push(fetchDOM(`${baseUrl}?page=${i}`));
            }
        }

        const pages = await Promise.all(pagePromises);

        let allEditors = [];
        pages.forEach((doc) => {
            allEditors.push(...parseEditorsFromPage(doc));
        });

        allEditors = allEditors.filter(
            (editor, index, self) =>
                index === self.findIndex((e) => e.id === editor.id)
        );

        return allEditors;
    }

    /**
     * Fetches and scrapes a single editor's profile and edits pages.
     * @param {Pick<EditorInfo, 'id' | 'name' | 'profileUrl'>} editor - Basic editor info.
     * @returns {Promise<EditorInfo>} A promise resolving to the full, processed editor info.
     */
    async function processEditor(editor) {
        const processedEditor = {
            ...editor,
            isSpammer: null,
            lastEditDate: null,
            restrictions: null,
            memberSince: null,
            userType: null,
            error: null,
        };

        try {
            // 1. Fetch profile page
            const profileDoc = await fetchDOM(editor.profileUrl);
            const ths = profileDoc.querySelectorAll('.profileinfo th');

            // 2. Check for spammer
            const pageContent = profileDoc.getElementById('page')?.textContent || '';
            if (pageContent.includes(SPAMMER_TEXT)) {
                processedEditor.isSpammer = true;
            } else {
                processedEditor.isSpammer = false;
            }

            // 3. Scrape Restrictions
            const restrictionsTh = [...ths].find(
                (th) => th.textContent.trim() === 'Restrictions:'
            );
            if (restrictionsTh && restrictionsTh.nextElementSibling) {
                processedEditor.restrictions =
                    restrictionsTh.nextElementSibling.textContent.trim();
            }

            // 4. Scrape Member Since
            const memberSinceTh = [...ths].find(
                (th) => th.textContent.trim() === 'Member since:'
            );
            if (memberSinceTh && memberSinceTh.nextElementSibling) {
                const memberSinceStr =
                    memberSinceTh.nextElementSibling.textContent.trim();
                try {
                    processedEditor.memberSince = new Date(
                        memberSinceStr
                    ).toISOString();
                } catch (e) {
                    console.warn(
                        `[${SCRIPT_NAME}] Could not parse memberSince date: ${memberSinceStr}`,
                        e
                    );
                    processedEditor.memberSince = memberSinceStr;
                }
            }

            // 5. Scrape User Type
            const userTypeTh = [...ths].find(
                (th) => th.textContent.trim() === 'User type:'
            );
            if (userTypeTh && userTypeTh.nextElementSibling) {
                // Select only the <a> tags linking to editor docs to exclude other links
                const userTypeLinks = userTypeTh.nextElementSibling.querySelectorAll(
                    'a[href*="/doc/Editor#"]'
                );
                processedEditor.userType = [...userTypeLinks]
                    .map((link) => link.textContent.trim())
                    .join(', ');
            }

            if (processedEditor.isSpammer) {
                return processedEditor;
            }

            // 6. Check for 0 edits on profile page
            let totalEdits = -1;
            const statsThs = profileDoc.querySelectorAll('.statistics th');
            const totalEditsTh = [...statsThs].find(
                (th) => th.textContent.trim() === 'Total'
            );
            if (totalEditsTh && totalEditsTh.nextElementSibling) {
                totalEdits = parseInt(
                    totalEditsTh.nextElementSibling.textContent,
                    10
                );
            }

            if (totalEdits === 0) {
                // Editor has 0 edits. lastEditDate remains null.
                // This is an optimization, avoids fetching the edits page.
                return processedEditor;
            }

            // 7. Fetch edits page (HTML)
            const editsDoc = await fetchDOM(`${editor.profileUrl}/edits`);

            // 8. Find last *closed* edit
            const expirationCell = editsDoc.querySelector(
                'div.edit-header:not(.open) td.edit-expiration'
            );
            if (expirationCell && expirationCell.lastChild) {
                const dateStr = expirationCell.lastChild.textContent.trim();
                if (dateStr) {
                    try {
                        processedEditor.lastEditDate = new Date(
                            dateStr
                        ).toISOString();
                    } catch (e) {
                        console.warn(
                            `[${SCRIPT_NAME}] Could not parse date: ${dateStr}`,
                            e
                        );
                        processedEditor.error = 'Could not parse date';
                    }
                }
            } else {
                // 9. No closed edits found. Check for *open* edits.
                const openEdit = editsDoc.querySelector('div.edit-header.open');
                if (openEdit) {
                    // This editor has pending edits, so they are active.
                    processedEditor.lastEditDate = new Date().toISOString();
                }
                // If no closed edits AND no open edits, lastEditDate remains null.
            }
            return processedEditor;
        } catch (error) {
            console.error(
                `[${SCRIPT_NAME}] Failed to process editor ${editor.name}:`,
                error
            );
            processedEditor.error = error.message;
            return processedEditor;
        }
    }

    /**
     * Manages a concurrent queue of editors to process.
     * @param {Pick<EditorInfo, 'id' | 'name' | 'profileUrl'>[]} editors - A list of basic editor info objects.
     * @returns {Promise<EditorInfo[]>} A promise that resolves when all editors have been processed.
     */
    async function processEditorQueue(editors) {
        const queue = [...editors];
        const results = [];
        let processedCount = 0;
        const totalCount = editors.length;

        async function worker() {
            while (queue.length > 0) {
                const editor = queue.shift();
                if (!editor) continue;

                const data = await processEditor(editor);
                results.push(data);
                processedCount++;
                updateProgress(
                    `Processing editor ${processedCount} of ${totalCount}: ${editor.name}`
                );
            }
        }

        const workers = Array(CONCURRENCY_LIMIT).fill(0).map(worker);
        await Promise.all(workers);
        return results;
    }

    // #endregion

    // #region Report UI

    /**
     * Reads the current `allEditorData` and updates the statistics block in the report UI.
     * Dynamically calculates the "inactive" count based on the user's input.
     */
    function updateReportStats() {
        const yearsInput = document.getElementById('esm-inactive-years');
        const years = parseInt(yearsInput?.value, 10) || 5;

        const stats = {
            total: allEditorData.length,
            spammers: allEditorData.filter((e) => e.isSpammer).length,
            noEdits: allEditorData.filter(
                (e) => !e.isSpammer && !e.lastEditDate && !e.error
            ).length,
            errors: allEditorData.filter((e) => e.error).length,
        };

        const cutoffDate = new Date();
        cutoffDate.setFullYear(cutoffDate.getFullYear() - years);
        const inactiveCount = allEditorData.filter((e) => {
            if (e.isSpammer || e.error) return false;
            if (!e.lastEditDate) return true;
            return new Date(e.lastEditDate) < cutoffDate;
        }).length;

        const statsContainer = document.querySelector('.esm-stats');
        if (statsContainer) {
            statsContainer.querySelector(
                '#esm-stats-total'
            ).textContent = ` ${stats.total}`;
            statsContainer.querySelector(
                '#esm-stats-spammers'
            ).textContent = ` ${stats.spammers}`;
            document.getElementById('esm-inactive-years-text').textContent =
                years;
            document.getElementById('esm-inactive-count').textContent =
                ` ${inactiveCount}`;
            statsContainer.querySelector(
                '#esm-stats-no-edits'
            ).textContent = ` ${stats.noEdits}`;
            statsContainer.querySelector(
                '#esm-stats-errors'
            ).textContent = ` ${stats.errors}`;
        }

        const spamBtn = document.getElementById('esm-unsub-spammers');
        if (spamBtn) {
            spamBtn.textContent = `Unsubscribe All Spammers (${stats.spammers})`;
            spamBtn.disabled = stats.spammers === 0;
        }

        const selectedBtn = document.getElementById('esm-unsub-selected');
        if (selectedBtn) {
            selectedBtn.textContent = 'Unsubscribe Selected (0)';
            selectedBtn.disabled = true;
        }
    }

    /**
     * Builds the main report UI.
     */
    function buildReportUI() {
        const reportContainer = document.createElement('div');
        reportContainer.id = 'esm-report-ui';
        reportContainer.innerHTML = `
            <h1>Editor Subscription Report</h1>
            <div class="esm-controls">
                <div class="esm-stats">
                    <ul>
                        <li><strong>Total Processed:</strong><span id="esm-stats-total">...</span></li>
                        <li><strong>Spammers:</strong><span id="esm-stats-spammers">...</span></li>
                        <li>
                            <strong>Inactive (> <span id="esm-inactive-years-text">5</span> years):</strong>
                            <span id="esm-inactive-count">...</span>
                        </li>
                        <li><strong>No Edits:</strong><span id="esm-stats-no-edits">...</span></li>
                        <li><strong>Processing Errors:</strong><span id="esm-stats-errors">...</span></li>
                    </ul>
                </div>
                <div class="esm-actions">
                    <h3>Batch Actions</h3>
                    <div class="esm-action-row">
                        <button id="esm-unsub-spammers" disabled>
                            Unsubscribe All Spammers (0)
                        </button>
                    </div>
                    <div class="esm-action-row">
                        <label>Unsubscribe if last edit > </label>
                        <input type="number" id="esm-inactive-years" value="5" min="1" max="20" />
                        <label> years ago</label>
                        <button id="esm-unsub-inactive">Unsubscribe Inactive</button>
                    </div>
                    <div class="esm-action-row">
                        <button id="esm-unsub-selected" disabled>Unsubscribe Selected (0)</button>
                    </div>
                    <hr>
                    <button id="esm-close-report">Close Report</button>
                </div>
            </div>
            <table class="tbl" id="esm-report-table">
                <thead>
                    <tr>
                        <th class="checkbox-cell"><input type="checkbox" id="esm-select-all" /></th>
                        <th class="esm-sortable" data-key="name">Name</th>
                        <th class="esm-sortable" data-key="id">ID</th>
                        <th class="esm-sortable" data-key="isSpammer">Spammer?</th>
                        <th class="esm-sortable" data-key="userType">User Type</th>
                        <th class="esm-sortable" data-key="restrictions">Restrictions</th>
                        <th class="esm-sortable" data-key="memberSince">Member Since</th>
                        <th class="esm-sortable" data-key="lastEditDate">Last Closed Edit</th>
                        <th class="esm-sortable" data-key="error">Error</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `;

        // Hide the original page content
        const pageDiv = document.getElementById('page');
        const contentElements = pageDiv.querySelectorAll(
            'h2, p, ul, nav, form'
        );
        contentElements.forEach((el) => {
            // Ensure we only hide direct children of #page
            if (el.parentElement === pageDiv) {
                el.style.display = 'none';
            }
        });
        // Append the report inside the #page div
        pageDiv.appendChild(reportContainer);

        // Call functions *after* UI is in the DOM
        updateReportStats();
        renderReportTable();
        addReportListeners();
    }

    /**
     * Sorts `allEditorData` and renders the HTML table body.
     */
    function renderReportTable() {
        const tbody = document.querySelector('#esm-report-table tbody');
        if (!tbody) return;

        const { key, asc } = sortState;
        allEditorData.sort((a, b) => {
            let valA = a[key];
            let valB = b[key];

            if (valA === null || valA === undefined) valA = asc ? 'zzz' : '...';
            if (valB === null || valB === undefined) valB = asc ? 'zzz' : '...';
            if (typeof valA === 'boolean') valA = valA.toString();
            if (typeof valB === 'boolean') valB = valB.toString();

            let result = 0;
            if (valA < valB) {
                result = -1;
            } else if (valA > valB) {
                result = 1;
            }
            return asc ? result : -result;
        });

        tbody.innerHTML = allEditorData
            .map((editor) => {
                const lastEditStr = editor.lastEditDate
                    ? new Date(editor.lastEditDate).toLocaleDateString()
                    : 'N/A';
                const memberSinceStr = editor.memberSince
                    ? new Date(editor.memberSince).toLocaleDateString()
                    : 'N/A';
                return `
                <tr>
                    <td><input type="checkbox" class="esm-select-row" data-id="${
                        editor.id
                    }" /></td>
                    <td><a href="${editor.profileUrl}" target="_blank">${
                    editor.name
                }</a></td>
                    <td>${editor.id}</td>
                    <td>${
                        editor.isSpammer === null
                            ? '?'
                            : editor.isSpammer
                            ? '<strong>Yes</strong>'
                            : 'No'
                    }</td>
                    <td>${editor.userType || ''}</td>
                    <td>${editor.restrictions || ''}</td>
                    <td>${memberSinceStr}</td>
                    <td>${lastEditStr}</td>
                    <td>${editor.error || ''}</td>
                </tr>
            `;
            })
            .join('');
    }

    /**
     * Attaches all event listeners for the report UI.
     */
    function addReportListeners() {
        document
            .getElementById('esm-close-report')
            .addEventListener('click', () => {
                document.getElementById('esm-report-ui').remove();

                // Unhide the original page content
                const pageDiv = document.getElementById('page');
                const contentElements = pageDiv.querySelectorAll(
                    'h2, p, ul, nav, form'
                );
                contentElements.forEach((el) => {
                    if (el.parentElement === pageDiv) {
                        el.style.display = '';
                    }
                });

                showProgress(false);
                setButtonsDisabled(false);
            });

        // Listener for the years input
        document
            .getElementById('esm-inactive-years')
            .addEventListener('input', updateReportStats);

        // Table header sorting
        document
            .querySelectorAll('#esm-report-table th.esm-sortable')
            .forEach((th) => {
                th.addEventListener('click', () => {
                    const key = th.dataset.key;
                    if (sortState.key === key) {
                        sortState.asc = !sortState.asc;
                    } else {
                        sortState.key = key;
                        sortState.asc = true;
                    }
                    renderReportTable();
                });
            });

        // Checkbox logic
        const updateSelectedCount = () => {
            const count = document.querySelectorAll(
                '.esm-select-row:checked'
            ).length;
            const btn = document.getElementById('esm-unsub-selected');
            btn.textContent = `Unsubscribe Selected (${count})`;
            btn.disabled = count === 0;
        };

        document
            .getElementById('esm-select-all')
            .addEventListener('change', (e) => {
                document
                    .querySelectorAll('.esm-select-row')
                    .forEach((cb) => (cb.checked = e.target.checked));
                updateSelectedCount();
            });

        document
            .querySelector('#esm-report-table tbody')
            .addEventListener('change', (e) => {
                if (e.target.classList.contains('esm-select-row')) {
                    updateSelectedCount();
                }
            });

        // Action buttons
        document
            .getElementById('esm-unsub-spammers')
            .addEventListener('click', async () => {
                const ids = allEditorData
                    .filter((e) => e.isSpammer)
                    .map((e) => e.id);
                if (
                    ids.length > 0 &&
                    confirm(
                        `Are you sure you want to unsubscribe from ${ids.length} spammer(s)?`
                    )
                ) {
                    showProgress(true);
                    await unsubscribe(ids);
                }
            });

        document
            .getElementById('esm-unsub-inactive')
            .addEventListener('click', async () => {
                const years = parseInt(
                    document.getElementById('esm-inactive-years').value,
                    10
                );
                if (isNaN(years) || years < 1) {
                    alert('Please enter a valid number of years.');
                    return;
                }

                const cutoffDate = new Date();
                cutoffDate.setFullYear(cutoffDate.getFullYear() - years);

                const ids = allEditorData
                    .filter((e) => {
                        if (e.isSpammer || e.error) return false;
                        if (!e.lastEditDate) return true;
                        return new Date(e.lastEditDate) < cutoffDate;
                    })
                    .map((e) => e.id);

                if (
                    ids.length > 0 &&
                    confirm(
                        `Are you sure you want to unsubscribe from ${ids.length} editor(s) inactive for > ${years} years?`
                    )
                ) {
                    showProgress(true);
                    await unsubscribe(ids);
                } else if (ids.length === 0) {
                    alert('No editors match the inactivity criteria.');
                }
            });

        document
            .getElementById('esm-unsub-selected')
            .addEventListener('click', async () => {
                const ids = [
                    ...document.querySelectorAll('.esm-select-row:checked'),
                ].map((cb) => cb.dataset.id);

                if (
                    ids.length > 0 &&
                    confirm(
                        `Are you sure you want to unsubscribe from ${ids.length} selected editor(s)?`
                    )
                ) {
                    showProgress(true);
                    await unsubscribe(ids);
                }
            });
    }

    // #endregion

    // #region Initialization

    /**
     * Creates the main "Manage" buttons and appends them to the page.
     * @returns {HTMLDivElement} The container holding the buttons.
     */
    function createMainButtons() {
        const container = document.createElement('div');
        container.className = 'esm-main-button-container';

        const testButton = document.createElement('button');
        testButton.type = 'button';
        testButton.id = 'esm-test-button';
        testButton.className = 'esm-main-button';
        testButton.textContent = 'Manage Current Page (Test)';
        testButton.addEventListener('click', () => runManager(false));

        const fullButton = document.createElement('button');
        fullButton.type = 'button';
        fullButton.id = 'esm-full-button';
        fullButton.className = 'esm-main-button';
        fullButton.textContent = 'Manage All Subscriptions';
        fullButton.addEventListener('click', () => runManager(true));

        container.appendChild(testButton);
        container.appendChild(fullButton);
        return container;
    }

    /**
     * Creates the progress bar UI element and appends it to the body.
     * @returns {HTMLDivElement} The progress bar element.
     */
    function createProgressUI() {
        const progressUI = document.createElement('div');
        progressUI.id = 'esm-progress-ui';
        progressUI.innerHTML = `<p id="esm-progress-text">Starting...</p>`;
        document.body.appendChild(progressUI);
        return progressUI;
    }

    /**
     * The main execution flow.
     * @param {boolean} [isFullRun=false] - True to run on all pages, false for current page only.
     */
    async function runManager(isFullRun = false) {
        setButtonsDisabled(true);
        showProgress(true, 'Initializing...');

        try {
            let basicEditorList = [];

            if (isFullRun) {
                const totalEditors = getTotalEditorCount();
                if (totalEditors === 0) {
                    throw new Error('Could not find total editor count.');
                }
                basicEditorList = await fetchAllSubscribedEditors(totalEditors);
            } else {
                updateProgress('Processing current page...');
                basicEditorList = parseEditorsFromPage(document);
            }

            if (basicEditorList.length === 0) {
                throw new Error('No editors found to process.');
            }

            allEditorData = await processEditorQueue(basicEditorList);

            showProgress(false);
            buildReportUI();
        } catch (error) {
            console.error(`[${SCRIPT_NAME}] A critical error occurred:`, error);
            alert(`A critical error occurred: ${error.message}`);
            showProgress(false);
            setButtonsDisabled(false);
        }
    }

    /**
     * Adds the required CSS styles for the UI.
     */
    function addStyles() {
        GM_addStyle(`
            .esm-main-button-container {
                display: inline-block;
                margin-left: 1em;
                vertical-align: middle;
            }
            .esm-main-button {
                margin-left: 0.5em;
            }
            #esm-progress-ui {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                background: #363636;
                color: white;
                padding: 10px;
                text-align: center;
                z-index: 9998;
                border-bottom: 2px solid #f2a600;
                font-size: 1.2em;
                display: none; /* Hidden by default */
            }
            #esm-report-ui {
                padding: 1em;
                background: #f1f1ff;
                border: 1px solid #ccc;
                margin-top: 1em;
            }
            #esm-report-ui h1 {
                margin-top: 0;
            }
            .esm-controls {
                display: grid;
                grid-template-columns: 1fr 2fr;
                gap: 2em;
                margin-bottom: 1em;
                padding: 1em;
                background: white;
                border: 1px solid #ddd;
            }
            .esm-stats ul {
                list-style: none;
                padding: 0;
                margin: 0;
            }
            .esm-stats li {
                margin-bottom: 0.5em;
            }
            .esm-stats li > strong {
                min-width: 150px;
                display: inline-block;
            }
            .esm-action-row {
                margin-bottom: 1em;
            }
            .esm-action-row input[type="number"] {
                width: 50px;
            }
            #esm-report-table {
                width: 100%;
            }
            #esm-report-table th.esm-sortable {
                cursor: pointer;
            }
            #esm-report-table th.esm-sortable:hover {
                background: #eee;
            }
            #esm-report-table th.esm-sortable::after {
                content: ' \\25B8'; /* Small triangle */
                font-size: 0.8em;
                opacity: 0.5;
            }
            /* Widen columns */
            #esm-report-table th[data-key="userType"],
            #esm-report-table td:nth-child(5),
            #esm-report-table th[data-key="restrictions"],
            #esm-report-table td:nth-child(6) {
                min-width: 200px;
            }
        `);
    }

    /**
     * Initializes the script by adding the buttons to the page.
     */
    function init() {
        if (!location.pathname.match(/\/user\/.*\/subscriptions\/editor/)) {
            return;
        }

        const heading = document.querySelector('#page > h2');
        if (heading && heading.textContent.includes('Editor subscriptions')) {
            addStyles();
            const buttons = createMainButtons();
            heading.appendChild(buttons);
            createProgressUI();
        }
    }

    init();
})();