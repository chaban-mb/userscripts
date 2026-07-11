// ==UserScript==
// @name         MusicBrainz: Subscriber Spam Filter
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.1
// @tag          ai-created
// @description  Filters spammers on your MusicBrainz subscriber list by detecting blocked profiles, stats, and name similarities.
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/user/*/subscribers
// @match        *://*.musicbrainz.eu/user/*/subscribers
// @connect      self
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Subscriber%20Spam%20Filter.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Subscriber%20Spam%20Filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = GM.info.script.name;
    const CACHE_KEY = 'UserJS.MusicBrainz.SubscriberSpamFilter.Cache';
    const SPAMMER_TEXT = 'This user was blocked and their profile is hidden';
    const CONCURRENCY_LIMIT = 3;

    /**
     * @typedef {Object} ProfileData
     * @property {boolean} isSpammer - True if profile is hidden or deleted.
     * @property {number} totalEdits - Total number of edits the user has made.
     * @property {string|null} memberSince - The registration date string.
     * @property {boolean} [isDeleted] - True if a 404 was returned.
     * @property {number} [lastChecked] - Timestamp of the last profile scrape.
     */

    /**
     * @typedef {Object} Subscriber
     * @property {string} username - The extracted username.
     * @property {HTMLElement} element - The DOM element representing the row.
     * @property {HTMLAnchorElement} linkElement - The anchor linking to the profile.
     */

    // Logging
    function log(msg, ...args) {
        console.log(`[${SCRIPT_NAME}] ${msg}`, ...args);
    }
    function error(msg, ...args) {
        console.error(`[${SCRIPT_NAME}] ${msg}`, ...args);
    }

    function parseStatNumber(text) {
        return text ? parseInt(text.replace(/,/g, '').match(/^(-?\d+)/)?.[1] || 0, 10) : 0;
    }

    /**
     * @summary Extracts user statistics from the profile page DOM.
     * @param {Document} doc - The parsed HTML document of the user's profile.
     * @returns {Object} An object containing structured edit, vote, and tag counts.
     */
    function scrapeStats(doc) {
        const stats = { edits: {}, votes: {}, added: {}, secondary: {} };
        doc.querySelectorAll('table.statistics').forEach(table => {
            const header = table.querySelector('thead th')?.textContent || '';
            const type = header.includes('Edits') ? 'edits' : header.includes('Added') ? 'added' : header.includes('Tags') ? 'secondary' : null;

            if (type) {
                table.querySelectorAll('tbody tr').forEach(row => {
                    const k = row.querySelector('th')?.textContent.trim();
                    const v = row.querySelector('td')?.textContent;
                    if (k && v) stats[type][k] = parseStatNumber(v);
                });
            } else if (header.includes('Votes')) {
                table.querySelectorAll('tbody tr').forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length >= 3) stats.votes[cells[0].textContent.trim()] = parseStatNumber(cells[2].textContent);
                });
            }
        });
        return stats;
    }

    // Helper for requests
    /**
     * @summary Fetches a user's profile page and extracts spammer status and statistics.
     * @param {string} username - The username to fetch.
     * @returns {Promise<ProfileData>} The extracted profile data.
     */
    async function fetchProfile(username) {
        const url = `/user/${encodeURIComponent(username)}`;
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: (res) => {
                    if (res.status === 200) {
                        const doc = new DOMParser().parseFromString(res.responseText, 'text/html');
                        const isSpammer = res.responseText.includes(SPAMMER_TEXT);
                        const stats = scrapeStats(doc);
                        const totalEdits = Object.values(stats.edits || {}).reduce((sum, val) => sum + val, 0);
                        const getMeta = (label) => [...doc.querySelectorAll('.profileinfo th')].find(th => th.textContent.trim() === label)?.nextElementSibling;
                        const memberSince = getMeta('Member since:')?.textContent.trim() || null;

                        resolve({ isSpammer, totalEdits, memberSince });
                    } else if (res.status === 404) {
                        // User is deleted or doesn't exist anymore
                        resolve({ isSpammer: true, isDeleted: true, totalEdits: 0, memberSince: null });
                    } else {
                        reject(new Error(`HTTP ${res.status}`));
                    }
                },
                onerror: () => reject(new Error('Network error'))
            });
        });
    }

    // Cache management
    const storage = {
        getCache: () => GM_getValue(CACHE_KEY) || {},
        setCache: (cache) => GM_setValue(CACHE_KEY, cache),
        saveUser: (username, data) => {
            const cache = storage.getCache();
            cache[username] = { ...data, lastChecked: Date.now() };
            storage.setCache(cache);
        }
    };

    // Levenshtein distance calculation
    /**
     * @summary Calculates the Levenshtein distance (edit distance) between two strings.
     * @param {string} a - First string.
     * @param {string} b - Second string.
     * @returns {number} The distance score.
     */
    function levenshtein(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    // Heuristic: check if username has suspicious patterns (e.g. Adjective [Noun] Number pattern)
    function isSuspiciousNamePattern(name) {
        return /^[a-z]+(?:\s?[a-z]+)?\s?\d{2,}$/i.test(name);
    }

    // Precompute potential spammers map to avoid O(N^2) Levenshtein computations inside loops
    /**
     * @summary Precomputes potential spammer reasons to avoid O(N^2) computations inside the DOM loop.
     * @param {Subscriber[]} subscribers - The list of current subscribers.
     * @param {Object} cache - The current user data cache.
     * @returns {Map<string, string>} A map of usernames to their suspicion reason.
     */
    function getPotentialSpammersMap(subscribers, cache) {
        const potentialReasons = new Map();

        // 1. Identify users with 0 edits who are not marked as spammer
        const zeroEditUsers = subscribers.filter(sub => {
            const data = cache[sub.username];
            return data && !data.isSpammer && data.totalEdits === 0;
        });

        // 2. Identify all known spammers or 0-edit users in cache to compare against
        const comparisonUsers = subscribers.filter(sub => {
            const data = cache[sub.username];
            return data && (data.isSpammer || data.totalEdits === 0);
        });

        // 3. Precompute suspicious name pattern status
        const suspiciousNameMap = new Map();
        zeroEditUsers.forEach(sub => {
            suspiciousNameMap.set(sub.username, isSuspiciousNamePattern(sub.username));
        });

        // 4. Perform Levenshtein similarity check between zero-edit users and the comparison pool
        zeroEditUsers.forEach(sub => {
            const username = sub.username;
            if (suspiciousNameMap.get(username)) {
                potentialReasons.set(username, '0 edits + suspicious name pattern');
                return;
            }

            const cleanName = username.toLowerCase();
            let similarUser = null;
            for (const other of comparisonUsers) {
                if (other.username === username) continue;
                const dist = levenshtein(cleanName, other.username.toLowerCase());
                if (dist <= 2) {
                    similarUser = other.username;
                    break;
                }
            }

            if (similarUser) {
                potentialReasons.set(username, `0 edits + similar to another 0-edit or confirmed spammer user: ${similarUser}`);
            }
        });

        return potentialReasons;
    }

    /**
     * @summary Applies visual tags, row colors, and display filters based on spammer status.
     * @param {Subscriber[]} subscribers - The list of subscribers.
     * @param {string} currentFilter - The active filter mode ('all', 'hideSpammers', etc.).
     * @param {Map<string, string>} potentialReasons - The precomputed suspicion map.
     */
    function applyFilters(subscribers, currentFilter, potentialReasons) {
        const cache = storage.getCache();

        subscribers.forEach(sub => {
            const userData = cache[sub.username];
            const isSpammer = userData ? userData.isSpammer : false;
            const potentialReason = potentialReasons.get(sub.username) || null;
            const isPotential = potentialReason !== null;

            // Clean previous tags/rows
            let tag = sub.element.querySelector('.mbsf-spammer-tag, .mbsf-potential-tag');
            if (tag) tag.remove();
            sub.element.classList.remove('mbsf-spammer-row', 'mbsf-potential-row');

            // Apply styles and tags
            if (isSpammer) {
                sub.element.classList.add('mbsf-spammer-row');
                tag = document.createElement('span');
                tag.className = 'mbsf-spammer-tag';
                tag.textContent = 'SPAMMER';
                sub.linkElement.after(tag);
            } else if (isPotential) {
                sub.element.classList.add('mbsf-potential-row');
                tag = document.createElement('span');
                tag.className = 'mbsf-potential-tag';
                tag.textContent = 'POTENTIAL';
                tag.title = potentialReason;
                sub.linkElement.after(tag);
            }

            // Filter visibility
            if (currentFilter === 'hideSpammers' && (isSpammer || isPotential)) {
                sub.element.style.display = 'none';
            } else if (currentFilter === 'spammersOnly' && !isSpammer) {
                sub.element.style.display = 'none';
            } else if (currentFilter === 'potentialOnly' && !isPotential) {
                sub.element.style.display = 'none';
            } else {
                sub.element.style.display = '';
            }
        });
    }

    // Style addition
    /**
     * @summary Injects the required CSS styles for the subscriber spam filter UI.
     */
    function addStyles() {
        GM_addStyle(`
            #mbsf-control-panel {
                background: #fcfcfc;
                border: 1px solid #ccc;
                border-radius: 4px;
                padding: 12px;
                margin: 15px 0;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 15px;
                font-size: 0.9em;
            }
            .mbsf-btn {
                background: #007bff;
                color: #fff;
                border: none;
                border-radius: 4px;
                padding: 5px 12px;
                cursor: pointer;
            }
            .mbsf-btn:hover {
                background: #0056b3;
            }
            .mbsf-btn-secondary {
                background: #6c757d;
            }
            .mbsf-btn-secondary:hover {
                background: #5a6268;
            }
            .mbsf-btn:disabled, .mbsf-btn-secondary:disabled {
                background: #ccc;
                cursor: not-allowed;
            }
            .mbsf-filter-group {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .mbsf-filter-group label {
                margin: 0;
                font-weight: normal;
                cursor: pointer;
            }
            .mbsf-spammer-row {
                background-color: #ffe6e6 !important;
            }
            .mbsf-potential-row {
                background-color: #fff3cd !important;
            }
            .mbsf-spammer-tag {
                background-color: #ff4d4d;
                color: white;
                font-size: 0.8em;
                font-weight: bold;
                padding: 2px 6px;
                border-radius: 3px;
                margin-left: 8px;
                display: inline-block;
            }
            .mbsf-potential-tag {
                background-color: #ffc107;
                color: black;
                font-size: 0.8em;
                font-weight: bold;
                padding: 2px 6px;
                border-radius: 3px;
                margin-left: 8px;
                display: inline-block;
            }
            #mbsf-progress {
                margin-left: auto;
                font-weight: bold;
                color: #555;
            }
        `);
    }

    // Extract subscribers from page
    /**
     * @summary Extracts the list of subscribers and their corresponding DOM elements from the page.
     * @returns {Subscriber[]} An array of subscriber objects.
     */
    function getSubscribers() {
        const listItems = document.querySelectorAll('#page > ul > li');
        const subscribers = [];

        listItems.forEach(li => {
            const link = li.querySelector('a[href^="/user/"]');
            if (link) {
                const href = link.getAttribute('href');
                const match = href.match(/^\/user\/([^/]+)/);
                if (match) {
                    const username = decodeURIComponent(match[1]);
                    subscribers.push({
                        username,
                        element: li,
                        linkElement: link
                    });
                }
            }
        });

        return subscribers;
    }

    /**
     * @summary Initiates an asynchronous scan of subscriber profiles to determine spammer status.
     * @param {Subscriber[]} subscribers - The list of subscribers to scan.
     * @param {boolean} force - If true, bypasses the local cache.
     * @param {Function} updateProgressCallback - Callback to report scan progress.
     */
    async function scanSubscribers(subscribers, force = false, updateProgressCallback) {
        const cache = storage.getCache();
        const toScan = subscribers.filter(sub => force || cache[sub.username] === undefined);
        const total = toScan.length;
        let processed = 0;

        if (total === 0) {
            return;
        }

        const queue = [...toScan];
        const workers = Array(Math.min(CONCURRENCY_LIMIT, total)).fill(null).map(async () => {
            while (queue.length > 0) {
                const sub = queue.shift();
                if (!sub) continue;

                try {
                    const result = await fetchProfile(sub.username);
                    storage.saveUser(sub.username, result);
                } catch (err) {
                    error(`Failed to scan ${sub.username}`, err);
                }

                processed++;
                updateProgressCallback(processed, total);
                // Introduce a tiny delay between requests
                await new Promise(r => setTimeout(r, 100));
            }
        });

        await Promise.all(workers);
    }

    async function init() {
        const subscribers = getSubscribers();
        if (subscribers.length === 0) {
            log('No subscribers found on page.');
            return;
        }

        addStyles();

        // Control Panel
        const controlPanel = document.createElement('div');
        controlPanel.id = 'mbsf-control-panel';

        // Scan Button (Smart)
        const scanBtn = document.createElement('button');
        scanBtn.className = 'mbsf-btn';
        scanBtn.id = 'mbsf-scan-btn';
        scanBtn.textContent = 'Scan (Smart)';

        // Rescan Button (Full)
        const rescanBtn = document.createElement('button');
        rescanBtn.className = 'mbsf-btn mbsf-btn-secondary';
        rescanBtn.id = 'mbsf-rescan-btn';
        rescanBtn.textContent = 'Force Rescan';

        // Filter Group
        const filterGroup = document.createElement('div');
        filterGroup.className = 'mbsf-filter-group';
        filterGroup.innerHTML = `
            <strong>Filter:</strong>
            <label><input type="radio" name="mbsf-filter" value="all"> Show All</label>
            <label><input type="radio" name="mbsf-filter" value="hideSpammers" checked> Hide Spammers</label>
            <label><input type="radio" name="mbsf-filter" value="spammersOnly"> Confirmed Only</label>
            <label><input type="radio" name="mbsf-filter" value="potentialOnly"> Potential Only</label>
        `;

        // Stats Text
        const statsSpan = document.createElement('span');
        statsSpan.id = 'mbsf-stats';
        statsSpan.style.marginLeft = '10px';
        statsSpan.style.color = '#555';

        // Progress Text
        const progressSpan = document.createElement('span');
        progressSpan.id = 'mbsf-progress';

        controlPanel.appendChild(scanBtn);
        controlPanel.appendChild(rescanBtn);
        controlPanel.appendChild(filterGroup);
        controlPanel.appendChild(statsSpan);
        controlPanel.appendChild(progressSpan);

        // Find the location to insert: right above the ul
        const firstUl = document.querySelector('#page ul');
        if (firstUl) {
            firstUl.before(controlPanel);
        } else {
            document.getElementById('page').appendChild(controlPanel);
        }

        let currentFilter = 'hideSpammers';

        const updateStats = (potentialReasons) => {
            const cache = storage.getCache();
            const total = subscribers.length;
            const spammers = subscribers.filter(sub => cache[sub.username]?.isSpammer === true).length;
            const potential = potentialReasons.size;
            const regular = total - spammers - potential;
            statsSpan.textContent = `| Total: ${total} | Confirmed: ${spammers} | Potential: ${potential} | Regular: ${regular}`;
        };

        const updateFilters = () => {
            const cache = storage.getCache();
            const potentialReasons = getPotentialSpammersMap(subscribers, cache);
            applyFilters(subscribers, currentFilter, potentialReasons);
            updateStats(potentialReasons);
        };

        // Throttle helper to avoid lag during active scanning
        const throttle = (fn, limit) => {
            let inThrottle;
            return function (...args) {
                if (!inThrottle) {
                    fn.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        };

        const updateFiltersThrottled = throttle(updateFilters, 500);

        // Filter selection change listener
        filterGroup.addEventListener('change', (e) => {
            if (e.target.name === 'mbsf-filter') {
                currentFilter = e.target.value;
                updateFilters();
            }
        });

        const runScan = async (force) => {
            scanBtn.disabled = true;
            rescanBtn.disabled = true;
            progressSpan.textContent = force ? ' Rescanning...' : ' Scanning...';

            await scanSubscribers(subscribers, force, (processed, total) => {
                progressSpan.textContent = ` Progress: ${processed}/${total}`;
                updateFiltersThrottled();
            });

            progressSpan.textContent = ' Done!';
            scanBtn.disabled = false;
            rescanBtn.disabled = false;
            updateFilters();
        };

        // Scan button click listener
        scanBtn.addEventListener('click', () => runScan(false));
        rescanBtn.addEventListener('click', () => runScan(true));

        // Initial application of filter and visual styles (if cached data is already present)
        updateFilters();
    }

    // Wait until DOM is ready
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init().catch(error);
    } else {
        document.addEventListener('DOMContentLoaded', () => init().catch(error));
    }
})();
