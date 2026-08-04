// ==UserScript==
// @name        MusicBrainz: Batch Remove Cover Art
// @namespace   https://musicbrainz.org/user/chaban
// @version     0.7.1
// @description Allows batch removing cover art from MusicBrainz releases.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://*.musicbrainz.org/release/*/cover-art
// @connect     self
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       GM.xmlHttpRequest
// @grant       GM.addStyle
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Batch%20Remove%20Cover%20Art.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Batch%20Remove%20Cover%20Art.user.js
// ==/UserScript==

(function () {
    'use strict';

    function isArtStationActive() {
        const root = document.getElementById('as-root');
        return !!(root && !root.classList.contains('as-orig'));
    }

    GM.addStyle(`
        .batch-remove-container {
            margin-top: 1.5em;
            margin-bottom: 1.5em;
        }
        .batch-remove-container h3 {
            margin-top: 0;
            margin-bottom: 0.5em;
        }
        .batch-remove-container fieldset.editnote {
            margin-top: 1em;
            margin-bottom: 1em;
        }
        .batch-remove-container .select-all-wrapper {
            margin-bottom: 1em;
        }
        .mb-batch-remove-artwork-wrapper {
            position: relative;
            display: inline-block;
        }
        .mb-batch-remove-artwork-wrapper .cover-art-checkbox {
            position: absolute;
            top: 5px;
            left: 5px;
            z-index: 10;
            margin: 0;
        }
        .mb-batch-remove-artwork-wrapper .status {
            position: absolute;
            top: 5px;
            right: 5px;
            z-index: 10;
            margin: 0;
            font-size: 0.9em;
            font-weight: bold;
            text-align: right;
            width: 150px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .mb-batch-remove-artwork-wrapper .status.has-content {
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 3px 6px;
            border-radius: 3px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .mb-batch-remove-artwork-wrapper .status.status-success { color: var(--positive-emphasis, lightgreen); }
        .mb-batch-remove-artwork-wrapper .status.status-error { color: var(--negative-emphasis, red); }
        .progress-bar-container {
            width: 100%;
            background-color: var(--background-dimmed, #f3f3f3);
            border-radius: 5px;
            overflow: hidden;
            margin-top: 10px;
            height: 20px;
        }
        .progress-bar {
            height: 100%;
            width: 0%;
            background-color: var(--positive-emphasis, #4CAF50);
            text-align: center;
            color: var(--text, white);
            line-height: 20px;
            font-size: 0.8em;
            transition: width 0.3s ease-in-out;
        }
    `);

    // --- START OF BATCH REMOVE SCRIPT ---
    const getReleaseId = () => {
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length >= 4 && pathParts[1] === 'release' && pathParts[3] === 'cover-art') {
            return pathParts[2];
        }
        return null;
    };

    const releaseId = getReleaseId();
    if (!releaseId) {
        console.error('[MusicBrainz: Batch Remove Cover Art] Could not determine release ID. Script will not run.');
        return;
    }

    let isAborting = false;

    /**
     * @summary Observes the DOM to detect when cover art elements are loaded, handling ArtStation compatibility.
     */
    const observeDOM = () => {
        const contentArea = document.getElementById('content');
        if (!contentArea) {
            setTimeout(observeDOM, 500);
            return;
        }

        let initialized = false;
        const init = () => {
            if (initialized) return;
            if (document.querySelector('.artwork-cont .buttons a[href*="/remove-cover-art/"]')) {
                initialized = true;
                observer.disconnect();
                initBatchRemove();

                const styleSheet = document.createElement('style');
                styleSheet.type = 'text/css';
                styleSheet.innerText = `
                    body.artstation-active .batch-remove-container,
                    body.artstation-active .cover-art-checkbox,
                    body.artstation-active .mb-batch-remove-artwork-wrapper .status {
                        display: none !important;
                    }
                `;
                document.head.appendChild(styleSheet);

                let lastActive = null;
                let artStationObserver = null;

                const handleArtStationState = () => {
                    const active = isArtStationActive();
                    if (active === lastActive) return;
                    lastActive = active;
                    console.log('[MusicBrainz: Batch Remove Cover Art] Art Station status:', active ? 'active (deactivating script)' : 'inactive (activating script)');
                    document.body.classList.toggle('artstation-active', active);
                };

                const contentObserver = new MutationObserver(() => {
                    handleArtStationState();
                    const root = document.getElementById('as-root');
                    if (root && !artStationObserver) {
                        artStationObserver = new MutationObserver(handleArtStationState);
                        artStationObserver.observe(root, { attributes: true, attributeFilter: ['class'] });
                    } else if (!root && artStationObserver) {
                        artStationObserver.disconnect();
                        artStationObserver = null;
                    }
                });

                contentObserver.observe(document.getElementById('content'), { childList: true });

                handleArtStationState();
            }
        };

        const observer = new MutationObserver(init);
        observer.observe(contentArea, { childList: true, subtree: true });
        init();
    };

    /**
     * @summary Initializes the UI and logic for batch selecting and removing cover art.
     */
    const initBatchRemove = () => {
        const coverArtDivs = Array.from(document.querySelectorAll('.artwork-cont'));
        if (coverArtDivs.length === 0) {
            return;
        }

        const batchControlsContainer = document.createElement('form');
        batchControlsContainer.className = 'batch-remove-container cover-art';
        batchControlsContainer.setAttribute('onsubmit', 'return false;');
        batchControlsContainer.innerHTML = `
            <div class="buttons ui-helper-clearfix" style="margin-top: 1em; margin-bottom: 1em;">
                <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-weight: bold; user-select: none;">
                    <input type="checkbox" id="selectAllCovers" style="margin: 0;"> Select all cover art
                </label>
            </div>

            <fieldset class="editnote">
                <legend>Edit note</legend>
                <p>
                    Entering an <a href="https://musicbrainz.org/doc/Edit_Note" target="_blank">edit note</a> that describes where you got your information is highly recommended. Not only does it make it clear where you got your information, but it can also encourage other users to vote on your edit — thus making your edit get applied faster.
                </p>
                <p>Even just providing a URL or two is helpful! For more suggestions, see <a href="https://musicbrainz.org/doc/How_to_Write_Edit_Notes" target="_blank">our guide for writing good edit notes</a>.</p>
                <div class="row">
                    <label for="editNote">Edit note:</label>
                    <textarea id="editNote" class="edit-note" name="edit-cover-art.edit_note" cols="80" rows="5" required></textarea>
                </div>
            </fieldset>

            <div class="row no-label buttons">
                <button type="submit" id="removeSelectedBtn" class="submit positive">Remove selected cover art</button>
                <button type="button" id="abortBtn" class="submit negative" disabled>Abort</button>
            </div>
            <div class="progress-bar-container" style="display: none;"><div class="progress-bar" id="progressBar">0%</div></div>
            <div id="statusMessages"></div>
        `;

        const addCoverArtButton = document.querySelector('.buttons.ui-helper-clearfix');
        if (addCoverArtButton) {
            addCoverArtButton.after(batchControlsContainer);
        } else {
            document.getElementById('content')?.appendChild(batchControlsContainer);
        }

        const selectAllCheckbox = document.getElementById('selectAllCovers');
        const removeSelectedBtn = document.getElementById('removeSelectedBtn');
        const abortBtn = document.getElementById('abortBtn');
        const editNoteTextarea = document.getElementById('editNote');
        const progressBarContainer = document.querySelector('.progress-bar-container');
        const progressBar = document.getElementById('progressBar');
        const statusMessages = document.getElementById('statusMessages');

        let totalRemovals = 0;
        let completedRemovals = 0;
        let lastChecked = null;

        coverArtDivs.forEach((artworkContDiv) => {
            if (artworkContDiv.closest('.mb-batch-remove-artwork-wrapper')) return;

            const removeLink = artworkContDiv.querySelector('.buttons a[href*="/remove-cover-art/"]');
            if (removeLink) {
                const newWrapper = document.createElement('div');
                newWrapper.className = 'mb-batch-remove-artwork-wrapper';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'cover-art-checkbox';
                checkbox.dataset.removeUrl = removeLink.href;
                const statusSpan = document.createElement('span');
                statusSpan.className = 'status';
                artworkContDiv.parentNode.insertBefore(newWrapper, artworkContDiv);
                newWrapper.appendChild(artworkContDiv);
                newWrapper.appendChild(checkbox);
                newWrapper.appendChild(statusSpan);
            }
        });

        const resetUI = (aborted = false) => {
            removeSelectedBtn.disabled = false;
            selectAllCheckbox.disabled = false;
            editNoteTextarea.disabled = false;
            abortBtn.disabled = true;
            progressBarContainer.style.display = 'none';
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
            statusMessages.innerHTML = aborted ? '<p>Batch removal aborted.</p>' : '';
            document.querySelectorAll('input.cover-art-checkbox').forEach(cb => {
                if (!cb.dataset.processed) { cb.disabled = false; }
            });
            document.querySelectorAll('.mb-batch-remove-artwork-wrapper .status').forEach(span => {
                span.textContent = '';
                span.classList.remove('has-content', 'status-success', 'status-error');
            });
            isAborting = false;
            lastChecked = null;
        };

        selectAllCheckbox.addEventListener('change', (event) => {
            if (isArtStationActive()) return;
            document.querySelectorAll('input.cover-art-checkbox:not(:disabled)').forEach(cb => {
                cb.checked = event.target.checked;
            });
        });

        removeSelectedBtn.addEventListener('click', async () => {
            if (isArtStationActive()) return;
            const selectedCheckboxes = Array.from(document.querySelectorAll('input.cover-art-checkbox:checked'));
            if (selectedCheckboxes.length === 0) {
                alert('Please select at least one cover art to remove.');
                return;
            }
            const editNote = editNoteTextarea.value.trim();
            if (!editNote) {
                alert('Please provide an edit note for the removal.');
                editNoteTextarea.focus();
                return;
            }

            removeSelectedBtn.disabled = true;
            selectAllCheckbox.disabled = true;
            editNoteTextarea.disabled = true;
            abortBtn.disabled = false;
            progressBarContainer.style.display = 'block';
            statusMessages.innerHTML = '';

            totalRemovals = selectedCheckboxes.length;
            completedRemovals = 0;
            updateProgressBar();

            for (const checkbox of selectedCheckboxes) {
                if (isAborting) {
                    statusMessages.innerHTML += '<p>Batch process interrupted.</p>';
                    break;
                }
                const statusSpan = checkbox.closest('.mb-batch-remove-artwork-wrapper').querySelector('.status');
                statusSpan.className = 'status';
                statusSpan.textContent = 'Submitting...';
                statusSpan.classList.add('has-content');

                try {
                    await submitRemoval(checkbox.dataset.removeUrl, editNote);
                    statusSpan.textContent = 'Removal submitted.';
                    statusSpan.classList.add('status-success');
                    checkbox.dataset.processed = 'true';
                } catch (error) {
                    statusSpan.textContent = `Error: ${error.message || 'Failed to submit.'}`;
                    statusSpan.classList.add('status-error');
                    console.error(`Error removing image:`, error);
                } finally {
                    completedRemovals++;
                    updateProgressBar();
                    checkbox.disabled = true;
                    checkbox.checked = false;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            resetUI(isAborting);
            if (!isAborting) {
                statusMessages.innerHTML += `<p>Batch removal complete. Processed ${completedRemovals} of ${totalRemovals} selected images.</p>`;
            }
        });

        abortBtn.addEventListener('click', () => {
            isAborting = true;
            statusMessages.innerHTML = '<p>Aborting process, please wait...</p>';
            abortBtn.disabled = true;
        });

        const updateProgressBar = () => {
            const percentage = totalRemovals > 0 ? (completedRemovals / totalRemovals) * 100 : 0;
            progressBar.style.width = `${percentage}%`;
            progressBar.textContent = `${Math.round(percentage)}%`;
            if (completedRemovals > 0 && completedRemovals === totalRemovals) {
                progressBar.textContent = 'Complete!';
            }
        };

        /**
         * @summary Submits a POST request to remove a specific cover art image.
         * @param {string} url - The URL endpoint for removing the specific cover art.
         * @param {string} editNote - The edit note to include in the removal request.
         * @returns {Promise<Object>} A promise resolving to the GM.xmlHttpRequest response if successful.
         */
        const submitRemoval = (url, editNote) => {
            const formData = new URLSearchParams();
            formData.append('confirm.edit_note', editNote);

            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'POST',
                    url: url,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': window.location.href
                    },
                    data: formData.toString(),
                    onload: (response) => {
                        if (response.status === 200 && response.finalUrl.includes('/cover-art')) {
                            resolve(response);
                        } else {
                            reject(new Error(`Server returned status ${response.status}.`));
                        }
                    },
                    onerror: () => reject(new Error('Network error or request failed.')),
                    ontimeout: () => reject(new Error('Request timed out.'))
                });
            });
        };

        document.getElementById('content').addEventListener('click', (event) => {
            if (isArtStationActive()) return;
            if (event.target.classList.contains('cover-art-checkbox')) {
                const checkbox = event.target;
                if (event.shiftKey && lastChecked && lastChecked !== checkbox) {
                    const checkboxes = Array.from(document.querySelectorAll('input.cover-art-checkbox:not(:disabled)'));
                    const start = checkboxes.indexOf(lastChecked);
                    const end = checkboxes.indexOf(checkbox);

                    if (start > -1 && end > -1) {
                        const low = Math.min(start, end);
                        const high = Math.max(start, end);
                        const shouldCheck = checkbox.checked;
                        for (let i = low; i <= high; i++) {
                            checkboxes[i].checked = shouldCheck;
                        }
                    }
                }
                lastChecked = checkbox;
            }
        });
    };

    observeDOM();
})();