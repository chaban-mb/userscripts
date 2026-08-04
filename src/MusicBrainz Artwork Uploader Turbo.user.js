// ==UserScript==
// @name        MusicBrainz: Artwork Uploader Turbo
// @namespace   https://musicbrainz.org/user/chaban
// @version     3.3.10
// @description Allows for multiple artwork images to be uploaded simultaneously and recursively upload directories.
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       *://*.musicbrainz.org/release/*/add-cover-art*
// @match       *://*.musicbrainz.org/event/*/add-event-art*
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       none
// @run-at      document-start
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Artwork%20Uploader%20Turbo.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Artwork%20Uploader%20Turbo.user.js
// ==/UserScript==

(function () {
    'use strict';

    function isArtStationActive() {
        const root = document.getElementById('as-root');
        return !!(root && !root.classList.contains('as-orig'));
    }

    // --- MAIN APPLICATION ---
    const ArtworkUploaderTurbo = {
        // --- CONFIGURATION ---
        UPLOAD_WORKER_LIMIT: 4,
        INITIAL_RETRY_DELAY_MS: 2000,
        MAX_RETRY_DELAY_MS: 60000,
        SCRIPT_NAME: '[MusicBrainz: Artwork Uploader Turbo]',

        // --- STATE ---
        state: {
            files: [],
            ui: {},
            upvm: null, // To hold the captured ViewModel instance
            antiThrottlingPCs: null,
            antiThrottlingTimer: null,
        },

        // --- LOGGER UTILITY ---
        logger: {
            log: (...args) => console.log(ArtworkUploaderTurbo.SCRIPT_NAME, ...args),
            warn: (...args) => console.warn(ArtworkUploaderTurbo.SCRIPT_NAME, ...args),
            error: (...args) => console.error(ArtworkUploaderTurbo.SCRIPT_NAME, ...args),
        },

        // --- PROMISE HELPERS ---
        toNativePromise(deferred) {
            return new Promise((resolve, reject) => {
                deferred.done(resolve).fail((...args) => reject(args));
            });
        },

        // --- WEB RTC THROTTLING BYPASS ---
        /**
         * @summary Discharges active WebRTC peer connections to restore normal OS power state.
         * @param {string} [reason='Manual discharge'] - Descriptive reason for discharging connections.
         */
        teardownThrottlingBypass(reason = 'Manual discharge') {
            if (ArtworkUploaderTurbo.state.antiThrottlingTimer) {
                clearTimeout(ArtworkUploaderTurbo.state.antiThrottlingTimer);
                ArtworkUploaderTurbo.state.antiThrottlingTimer = null;
            }
            if (ArtworkUploaderTurbo.state.antiThrottlingPCs) {
                ArtworkUploaderTurbo.logger.log(`Discharging WebRTC throttling bypass [Reason: ${reason}].`);
                ArtworkUploaderTurbo.state.antiThrottlingPCs.forEach(pc => {
                    try {
                        pc.close();
                    } catch (e) {
                        ArtworkUploaderTurbo.logger.error('Error closing RTCPeerConnection:', e);
                    }
                });
                ArtworkUploaderTurbo.state.antiThrottlingPCs = null;
            }
        },

        /**
         * @summary Acquires or refreshes WebRTC local loopback connections to bypass Intensive Throttling.
         * Resets a 30-second watchdog timer to automatically discharge connections if idle.
         * @param {number} [timeoutMs=30000] - Duration in milliseconds before auto-discharging.
         */
        async setupThrottlingBypass(timeoutMs = 30000) {
            if (ArtworkUploaderTurbo.state.antiThrottlingTimer) {
                clearTimeout(ArtworkUploaderTurbo.state.antiThrottlingTimer);
            }
            ArtworkUploaderTurbo.state.antiThrottlingTimer = setTimeout(() => {
                ArtworkUploaderTurbo.teardownThrottlingBypass('Safety watchdog timeout (30s inactivity)');
            }, timeoutMs);

            if (ArtworkUploaderTurbo.state.antiThrottlingPCs) return;
            if (typeof RTCPeerConnection === 'undefined') {
                ArtworkUploaderTurbo.logger.warn('WebRTC not supported or disabled. Intensive throttling bypass skipped.');
                return;
            }
            ArtworkUploaderTurbo.logger.log('Initializing WebRTC loopback to bypass Intensive Throttling...');
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
                ArtworkUploaderTurbo.state.antiThrottlingPCs = [pc1, pc2];
            } catch (e) {
                ArtworkUploaderTurbo.logger.error('Failed to setup WebRTC throttling bypass:', e);
                ArtworkUploaderTurbo.teardownThrottlingBypass('Initialization failure');
            }
        },

        // --- UI RENDERING ---
        UI: {
            init() {
                this.injectStyles();
                this.createMainContainer();
                this.createDebugUI(ArtworkUploaderTurbo.state.ui.mainContainer);
            },

            injectStyles() {
                const styleSheet = document.createElement('style');
                styleSheet.type = 'text/css';
                styleSheet.innerText = `
                    #mb-artwork-uploader-turbo-container {
                        background-color: var(--background-accent, #f9f9f9); border: 1px solid #ccc;
                        color: var(--text, black); position: fixed; left: 10px; bottom: 10px;
                        padding: 10px; max-width: 450px; box-shadow: 1pt 1pt 2pt gray;
                        z-index: 1000; font-size: small;
                    }
                    #mb-artwork-uploader-turbo-container summary { font-weight: bold; cursor: pointer; }
                    #mb-artwork-uploader-turbo-container .status-list-item.done { color: var(--positive-emphasis, lightgreen); }
                    #mb-artwork-uploader-turbo-container .status-list-item.error { color: var(--negative-emphasis, red); }
                `;
                document.head.appendChild(styleSheet);
            },

            createMainContainer() {
                if (ArtworkUploaderTurbo.state.ui.mainContainer) return;
                const container = document.createElement('div');
                container.id = 'mb-artwork-uploader-turbo-container';
                document.body.append(container);
                ArtworkUploaderTurbo.state.ui.mainContainer = container;
            },

            createCollapsibleSection(container, title, isOpen = false) {
                const details = document.createElement('details');
                details.open = isOpen;
                const summary = document.createElement('summary');
                summary.textContent = title;
                details.append(summary);
                container.append(details);
                return details;
            },

            createDebugUI(container) {
                const section = this.createCollapsibleSection(container, 'Upload Status', true);
                const list = document.createElement('ul');
                list.style.cssText = 'list-style: none; padding: 0 0 0 10px; margin-top: 10px; max-height: 150px; overflow-y: auto;';
                section.append(list);
                ArtworkUploaderTurbo.state.ui.fileList = list;
            },

            updateDebugUI() {
                const { fileList } = ArtworkUploaderTurbo.state.ui;
                if (!fileList) return;

                requestAnimationFrame(() => {
                    fileList.innerHTML = '';
                    for (const file of ArtworkUploaderTurbo.state.files) {
                        const item = document.createElement('li');
                        item.className = 'status-list-item';
                        const status = file.status();
                        const stage = file._script?.stage ?? 'Pending';
                        const errorDetail = file._script?.errorDetail ?? '';
                        let statusText = '';

                        if (stage === 'Failed' && file._script?.httpStatus !== undefined) {
                            statusText = `(${status}, HTTP ${file._script.httpStatus ?? 'N/A'})`;
                        } else if (status.includes('error') || stage.toLowerCase() !== status.toLowerCase()) {
                            statusText = `(${status})`;
                        }

                        item.textContent = `${file.name}: ${stage}${statusText ? ' ' + statusText : ''}`;
                        if (errorDetail) {
                            item.title = errorDetail;
                        }

                        if (status === 'done') item.classList.add('done');
                        else if (status?.includes('error') || stage === 'Failed') item.classList.add('error');
                        fileList.append(item);
                    }
                });
            },
        },

        // --- DIRECTORY UPLOADER FEATURE ---
        DirectoryUploader: {
            _addFilesButton: null,
            _dirInput: null,
            _originalButtonText: '',

            init() {
                const observer = new MutationObserver((mutations, obs) => {
                    const button = document.querySelector('span.fileinput-button.buttons button.add-files');
                    if (button) {
                        this._enhanceButton(button);
                        obs.disconnect();
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });
            },

            _enhanceButton(button) {
                this._addFilesButton = button;
                this._originalButtonText = button.textContent;

                this._dirInput = document.createElement('input');
                this._dirInput.type = 'file';
                this._dirInput.webkitdirectory = true;
                this._dirInput.multiple = true;
                this._dirInput.style.display = 'none';
                document.body.append(this._dirInput);

                this._addFilesButton.addEventListener('click', this._handleClick.bind(this), true);
                this._dirInput.addEventListener('change', this._handleDirectorySelection.bind(this));
                document.addEventListener('keydown', this._handleShiftState.bind(this));
                document.addEventListener('keyup', this._handleShiftState.bind(this));
                window.addEventListener('blur', () => {
                    this._addFilesButton.textContent = this._originalButtonText;
                });

                this._addFilesButton.setAttribute('title', 'Hold Shift to select a directory');
            },

            _handleClick(event) {
                if (isArtStationActive()) return;
                if (event.shiftKey) {
                    event.stopImmediatePropagation();
                    event.preventDefault();
                    this._dirInput.click();
                }
            },

            _handleShiftState(event) {
                if (isArtStationActive()) return;
                if (event.key === 'Shift') {
                    this._addFilesButton.textContent = event.type === 'keydown'
                        ? 'Select directory...'
                        : this._originalButtonText;
                }
            },

            /**
             * @summary Processes the selected directory of files, validates them, and updates the form.
             * @param {Event} event - The directory input change event.
             */
            async _handleDirectorySelection(event) {
                try {
                    const files = Array.from(event.target.files);
                    if (files.length === 0) {
                        ArtworkUploaderTurbo.logger.warn('No files found in selected directory.');
                        return;
                    }

                    const validationPromises = files.map(file =>
                        ArtworkUploaderTurbo.toNativePromise(MB.Art.validate_file(file))
                            .then(() => ({ file, valid: true }))
                            .catch(() => ({ file, valid: false }))
                    );

                    const results = await Promise.all(validationPromises);
                    const validFiles = results.filter(r => r.valid).map(r => r.file);

                    if (validFiles.length > 0) {
                        ArtworkUploaderTurbo.logger.log(`Adding ${validFiles.length} valid files.`);
                    }
                    if (validFiles.length < files.length) {
                        ArtworkUploaderTurbo.logger.log(`Ignoring ${files.length - validFiles.length} invalid files.`);
                    }

                    if (validFiles.length > 0) {
                        const dt = new DataTransfer();
                        validFiles.forEach(file => dt.items.add(file));

                        const $input = $('input.add-files');
                        if ($input.length) {
                            $input[0].files = dt.files;
                            $input.trigger('change');
                        } else {
                            const fileInput = document.querySelector('input.add-files');
                            if (fileInput) {
                                fileInput.files = dt.files;
                                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                            } else {
                                ArtworkUploaderTurbo.logger.error("Could not find page's input.add-files element.");
                            }
                        }
                    }
                } catch (error) {
                    ArtworkUploaderTurbo.logger.error("Failed to process directory selection:", error);
                } finally {
                    event.target.value = '';
                }
            },
        },

        // --- MAIN UPLOADER LOGIC ---
        Uploader: {
            init() {
                const { name: actionName } = window.__MB__.$c.action;
                const pageInfo = this._getPageInfo(actionName);
                if (!pageInfo) return;

                const originalAddArtSubmit = MB.Art.add_art_submit;
                MB.Art.add_art_submit = (gid, upvm) => {
                    if (isArtStationActive()) {
                        return originalAddArtSubmit(gid, upvm);
                    }
                    return this.run(pageInfo, gid, upvm);
                };
            },


            _getPageInfo(actionName) {
                let entityType, archiveName;
                switch (actionName) {
                    case 'add_cover_art': [entityType, archiveName] = ['release', 'cover']; break;
                    case 'add_event_art': [entityType, archiveName] = ['event', 'event']; break;
                    default: return null;
                }
                const formName = actionName.replace(/_/g, '-');
                return { entityType, archiveName, formName };
            },

            /**
             * @summary Initiates the upload pipeline for the given entity and file list.
             * @param {Object} pageInfo - The extracted page context.
             * @param {string} gid - The MBID of the entity.
             * @param {Object} upvm - The Knockout ViewModel containing the files.
             */
            async run({ entityType, archiveName, formName }, gid, upvm) {
                ArtworkUploaderTurbo.state.files = upvm.files_to_upload().filter(f => f.status() !== 'done');
                if (ArtworkUploaderTurbo.state.files.length === 0) return;

                ArtworkUploaderTurbo.UI.updateDebugUI();
                this._prepareUI(formName);

                try {
                    await ArtworkUploaderTurbo.setupThrottlingBypass();

                    const pipeline = new this.Pipeline(gid, ArtworkUploaderTurbo.state.files, formName);
                    await pipeline.start();
                    this._finalize(pipeline.hasCriticalError, entityType, archiveName, gid, formName);
                } finally {
                    ArtworkUploaderTurbo.teardownThrottlingBypass('Upload process finished');
                }
            },

            _prepareUI(formName) {
                $('.add-files.row, #cover-art-position-row, #event-art-position-row').hide();
                document.querySelector('#content').scrollIntoView({ behavior: 'smooth' });
                document.querySelector(`#${formName}-submit`).disabled = true;
            },

            _finalize(hasError, entityType, archiveName, gid, formName) {
                if (!hasError) {
                    const container = ArtworkUploaderTurbo.state.ui.mainContainer;
                    if (container) container.remove();
                    window.location.href = `/${entityType}/${gid}/${archiveName}-art`;
                } else {
                    ArtworkUploaderTurbo.logger.log('Process finished. Some files failed and could not be retried.');
                    document.querySelector(`#${formName}-submit`).disabled = false;
                }
            },

            Pipeline: class {
                /**
                 * @param {string} gid - The MBID of the entity.
                 * @param {Object[]} allFiles - Array of file objects from the ViewModel.
                 * @param {string} formName - The HTML form name for UI selectors.
                 */
                constructor(gid, allFiles, formName) {
                    this.gid = gid;
                    this.allFiles = allFiles;
                    this.formName = formName;
                    this.filesToSign = [...allFiles];
                    this.filesToUpload = [];
                    this.filesToSubmit = [];
                    this.processedFileCount = 0;
                    this.hasCriticalError = false;
                }

                async start() {
                    const workerCount = Math.min(this.allFiles.length, ArtworkUploaderTurbo.UPLOAD_WORKER_LIMIT);

                    const promises = [
                        this._signerThread(),
                        this._submitterThread(),
                        ...Array(workerCount).fill(null).map(() => this._uploaderWorker())
                    ];
                    await Promise.all(promises);
                }

                /**
                 * @summary Determines if a failed request is retriable (HTTP 5xx, 429, etc.) and handles exponential backoff.
                 * @param {Object} file - The file object being processed.
                 * @param {Array|Error|Object} error - The jQuery deferred error array, Error object, or custom error.
                 * @returns {Promise<boolean>} True if the request should be retried, false if it's a fatal error.
                 */
                async _handleRetry(file, error) {
                    const errorList = Array.isArray(error) ? error : [error];
                    let httpStatus = null;

                    const textSources = [];
                    for (const err of errorList) {
                        if (typeof err === 'string') textSources.push(err);
                        else if (err instanceof Error) textSources.push(err.message);
                        else if (err && typeof err.responseText === 'string') textSources.push(err.responseText);
                        else if (err && typeof err.statusText === 'string') textSources.push(err.statusText);
                    }

                    if (typeof file.signErrorMessage === 'function') textSources.push(file.signErrorMessage());
                    if (typeof file.editErrorMessage === 'function') textSources.push(file.editErrorMessage());

                    // Prioritize upstream 5xx / 429 / 408 status codes embedded in error strings (e.g. upload_image: "error uploading image: 503 ...")
                    for (const text of textSources) {
                        if (!text) continue;
                        const match = text.match(/\b([5]\d{2}|429|408)\b/);
                        if (match) {
                            httpStatus = parseInt(match[1], 10);
                            break;
                        }
                    }

                    if (httpStatus === null) {
                        for (const err of errorList) {
                            if (typeof err === 'number' && err >= 0) { httpStatus = err; break; }
                            if (err && typeof err.status === 'number' && err.status >= 0) { httpStatus = err.status; break; }
                        }
                    }

                    const signMsg = typeof file.signErrorMessage === 'function' ? file.signErrorMessage() : '';
                    const editMsg = typeof file.editErrorMessage === 'function' ? file.editErrorMessage() : '';
                    // Fall back to the raw rejection string for upload-phase errors (upload_image sets no observables)
                    const rawStr = errorList.find(e => typeof e === 'string' && e) ?? '';
                    const errorDetail = [signMsg, editMsg].filter(Boolean).join(' - ') || rawStr;

                    // Recognize temporary Internet Archive or server timeout error phrases suggesting retry
                    const hasRetryPhrase = textSources.some(text =>
                        /\b(try again|temporary delay|Internet Archive|timeout|timed out)\b/i.test(text)
                    );

                    const isRetriable = (
                        httpStatus >= 500 ||
                        httpStatus === 429 ||
                        httpStatus === 408 ||
                        httpStatus === 0 ||
                        httpStatus === null ||
                        hasRetryPhrase
                    );

                    if (isRetriable && (httpStatus === null || httpStatus === 400)) {
                        const match5xx = textSources.map(t => t.match(/\b([5]\d{2}|429|408)\b/)).find(Boolean);
                        if (match5xx) {
                            httpStatus = parseInt(match5xx[1], 10);
                        } else if (hasRetryPhrase) {
                            httpStatus = 503;
                        }
                    }

                    const logDetail = errorDetail.replace(/\s{2,}/g, ' ').trim().slice(0, 200);

                    if (isRetriable) {
                        file._script.retryDelay = file._script.retryDelay || ArtworkUploaderTurbo.INITIAL_RETRY_DELAY_MS;
                        file._script.stage = `Retrying (HTTP ${httpStatus ?? 'N/A'})...`;
                        file._script.errorDetail = logDetail;
                        ArtworkUploaderTurbo.logger.warn(`Retrying file "${file.name}" (HTTP ${httpStatus ?? 'N/A'})${logDetail ? ': ' + logDetail : ''}`);
                        ArtworkUploaderTurbo.UI.updateDebugUI();
                        await new Promise(resolve => setTimeout(resolve, file._script.retryDelay));
                        file._script.retryDelay = Math.min(file._script.retryDelay * 2, ArtworkUploaderTurbo.MAX_RETRY_DELAY_MS);
                        return true;
                    }

                    file._script.stage = `Failed`;
                    file._script.httpStatus = httpStatus;
                    file._script.errorDetail = logDetail;
                    this.hasCriticalError = true;
                    ArtworkUploaderTurbo.logger.error(`Unrecoverable error for file "${file.name}": ${file.status()} (HTTP Status: ${httpStatus ?? 'N/A'})${logDetail ? ' - ' + logDetail : ''}`);
                    ArtworkUploaderTurbo.UI.updateDebugUI();
                    return false;
                }

                /**
                 * @summary Continuously signs files in the queue using the MusicBrainz API, shifting them to the upload queue.
                 */
                async _signerThread() {
                    while (this.processedFileCount < this.allFiles.length && !this.hasCriticalError) {
                        if (this.filesToUpload.length >= ArtworkUploaderTurbo.UPLOAD_WORKER_LIMIT * 2) {
                            await new Promise(r => setTimeout(r, 500));
                            continue;
                        }

                        const file = this.filesToSign.shift();
                        if (!file) { await new Promise(r => setTimeout(r, 100)); continue; }
                        await ArtworkUploaderTurbo.setupThrottlingBypass();
                        if (!file._script) file._script = {};

                        while (true) {
                            try {
                                file.status(MB.Art.upload_status_enum.signing);
                                file._script.stage = 'Signing';
                                ArtworkUploaderTurbo.UI.updateDebugUI();
                                file.postfields = await ArtworkUploaderTurbo.toNativePromise(MB.Art.sign_upload(file, this.gid, file.mimeType()));
                                ArtworkUploaderTurbo.logger.log(`[DEBUG] Successfully signed file ${file.name}`);
                                this.filesToUpload.push(file);
                                break;
                            } catch (error) {
                                if (!(await this._handleRetry(file, error))) break;
                            }
                        }
                    }
                }

                /**
                 * @summary Consumes signed files from the upload queue, pushing binary data to the Internet Archive.
                 */
                async _uploaderWorker() {
                    while (this.processedFileCount < this.allFiles.length && !this.hasCriticalError) {
                        const file = this.filesToUpload.shift();
                        if (!file) { await new Promise(r => setTimeout(r, 100)); continue; }
                        await ArtworkUploaderTurbo.setupThrottlingBypass();

                        while (true) {
                            try {
                                file.status(MB.Art.upload_status_enum.uploading);
                                file._script.stage = 'Uploading';
                                ArtworkUploaderTurbo.UI.updateDebugUI();
                                await ArtworkUploaderTurbo.toNativePromise(MB.Art.upload_image(file.postfields, file.data)
                                    .progress(value => { file.progress(10 + (value * 0.8)); }));
                                ArtworkUploaderTurbo.logger.log(`[DEBUG] Successfully uploaded file ${file.name}`);
                                this.filesToSubmit.push(file);
                                break;
                            } catch (error) {
                                if (!(await this._handleRetry(file, error))) break;
                            }
                        }
                    }
                }

                /**
                 * @summary Consumes uploaded files from the submit queue, finalizing the edit on MusicBrainz.
                 */
                async _submitterThread() {
                    const startingPosition = parseInt($(`#id-${this.formName}\\.position`).val(), 10);
                    while (this.processedFileCount < this.allFiles.length && !this.hasCriticalError) {
                        const file = this.filesToSubmit.shift();
                        if (!file) { await new Promise(r => setTimeout(r, 100)); continue; }
                        await ArtworkUploaderTurbo.setupThrottlingBypass();

                        const position = startingPosition + this.allFiles.indexOf(file);

                        while (true) {
                            try {
                                file.status(MB.Art.upload_status_enum.submitting);
                                file._script.stage = 'Submitting';
                                ArtworkUploaderTurbo.UI.updateDebugUI();
                                 await ArtworkUploaderTurbo.toNativePromise(MB.Art.submit_edit(file, file.postfields, file.mimeType(), position));
                                file.progress(100);
                                file.status(MB.Art.upload_status_enum.done);
                                file._script.stage = 'Done';
                                this.processedFileCount++;
                                ArtworkUploaderTurbo.UI.updateDebugUI();
                                ArtworkUploaderTurbo.logger.log(`[DEBUG] Successfully submitted edit for file ${file.name}`);
                                break;
                            } catch (error) {
                                const errMsg = typeof file.editErrorMessage === 'function' ? file.editErrorMessage() : '';
                                if (errMsg && errMsg.includes('expired')) {
                                    ArtworkUploaderTurbo.logger.warn(`Nonce expired for ${file.name}, refreshing signature...`);
                                    file._script.stage = 'Refreshing nonce';
                                    ArtworkUploaderTurbo.UI.updateDebugUI();
                                    file.editErrorMessage(''); // clear out old error

                                    const archiveName = this.formName === 'add-cover-art' ? 'cover' : 'event';
                                    try {
                                        const response = await fetch(`/ws/js/${archiveName}-art-upload/${this.gid}?mime_type=${encodeURIComponent(file.mimeType())}&image_id=${file.postfields.image_id}&t=${Date.now()}`);
                                        if (!response.ok) {
                                            throw new Error(`Failed to refresh signature: HTTP ${response.status}`);
                                        }
                                        const newPostfields = await response.json();
                                        file.postfields = newPostfields;
                                        ArtworkUploaderTurbo.logger.log(`[DEBUG] Successfully refreshed signature for ${file.name}`);
                                        continue; // retry submission
                                    } catch (refreshError) {
                                        ArtworkUploaderTurbo.logger.error(`Failed to refresh signature`, { fileName: file.name, gid: this.gid, error: refreshError });
                                        if (!(await this._handleRetry(file, [refreshError]))) break;
                                    }
                                }
                                if (!(await this._handleRetry(file, error))) break;
                            }
                        }
                    }
                }
            }
        },

        // --- SCRIPT INITIALIZATION ---
        init() {
            const checkMB = setInterval(() => {
                if (window.MB?.Art?.add_art_submit && window.MB?.Art?.UploadProcessViewModel && window.__MB__?.$c && window.$) {
                    clearInterval(checkMB);

                    this.UI.init();
                    this.Uploader.init();
                    this.DirectoryUploader.init();

                    let lastActive = null;
                    let artStationObserver = null;

                    const handleArtStationState = () => {
                        const active = isArtStationActive();
                        if (active === lastActive) return;
                        lastActive = active;
                        ArtworkUploaderTurbo.logger.log(`Art Station status: ${active ? 'active (deactivating script)' : 'inactive (activating script)'}`);
                        const container = document.getElementById('mb-artwork-uploader-turbo-container');
                        if (container) {
                            container.style.display = active ? 'none' : '';
                        }
                        const button = this.DirectoryUploader._addFilesButton;
                        if (button) {
                            if (active) {
                                button.textContent = this.DirectoryUploader._originalButtonText;
                                button.removeAttribute('title');
                            } else {
                                button.setAttribute('title', 'Hold Shift to select a directory');
                            }
                        }
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

                    const contentArea = document.getElementById('content') || document.body;
                    contentObserver.observe(contentArea, { childList: true });

                    handleArtStationState();
                }
            }, 50);
        }
    };

    ArtworkUploaderTurbo.init();

})();
