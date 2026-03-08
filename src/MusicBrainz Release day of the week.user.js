// ==UserScript==
// @name           MusicBrainz: Release day of the week
// @namespace      https://musicbrainz.org/user/chaban
// @description    Display the day of the week for release events.
// @version        1.0.0
// @author         Jugdish, SultS, chaban
// @match          https://*.musicbrainz.org/release*
// @match          https://*.musicbrainz.org/recording/*
// @match          https://*.musicbrainz.org/edit/*
// @match          https://*.musicbrainz.org/*/edits
// @match          https://*.musicbrainz.org/label/*
// @match          https://*.musicbrainz.org/area/*
// @match          https://*.musicbrainz.org/search*
// @match          https://*.musicbrainz.org/artist/*/releases*
// @match          https://*.musicbrainz.org/area/*/releases*
// @grant          none
// @run-at         document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Safari fallback for requestIdleCallback
    const requestIdle = window.requestIdleCallback || function (cb) {
        return setTimeout(function () { cb(); }, 1);
    };

    const dayNames = new Intl.DateTimeFormat('en', { weekday: 'short' });
    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;

    const COUNTRY_RELEASE_DAYS = {
        'Australia': 1, 'AU': 1,
        'France': 1, 'FR': 1,
        'Germany': (date) => (date < new Date('2005-09-01') ? 1 : 5),
        'DE': (date) => (date < new Date('2005-09-01') ? 1 : 5),
        'Japan': 3, 'JP': 3,
        'New Zealand': 1, 'NZ': 1,
        'United Kingdom': 1, 'GB': 1,
        'United States': 2, 'US': 2,
        '[Worldwide]': (date) => (date >= new Date('2015-07-10') ? 5 : null),
        'XW': (date) => (date >= new Date('2015-07-10') ? 5 : null),
    };

    const style = document.createElement('style');
    style.textContent = `
        .mb-day-of-week { font-weight: bold; margin-left: 0.3em; white-space: nowrap; }
        .mb-day-of-week.standard { color: green; }
        .mb-day-of-week.non-standard { color: #F60; }
        .mb-day-of-week.unknown { color: grey; }
        span.release-date, span.diff-only-a, span.diff-only-b { white-space: nowrap !important; }
    `;
    document.head.appendChild(style);

    function buildWriteTasks(nodesToProcess) {
        const tasks = [];
        // Track nodes we've seen in this batch so we don't process them twice
        const seenTextNodes = new Set();

        // Places where dates usually show up, including fallbacks for other userscripts
        const validContainersSelector = [
            '.release-events',
            '.release-events-diff',
            '.edit-release-events',
            'table.details.add-release',
            'table.details.edit-release',
            'span.release-date',
            'span[data-name="release-date"]'
        ].join(', ');

        nodesToProcess.forEach(root => {
            if (!document.contains(root)) return;

            let containers = Array.from(root.querySelectorAll(validContainersSelector));

            if (root.matches && root.matches(validContainersSelector)) {
                containers.push(root);
            } else if (containers.length === 0) {
                // Catch small DOM mutations happening inside our containers
                const parentContainer = root.closest ? root.closest(validContainersSelector) : null;
                if (parentContainer) containers = [root];
            }

            containers.forEach(container => {
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
                let textNode;

                while (textNode = walker.nextNode()) {
                    // Skip disambiguation comments to avoid highlighting dates mentioned in them
                    if (textNode.parentNode && textNode.parentNode.classList && textNode.parentNode.classList.contains('comment')) {
                        continue;
                    }

                    if (seenTextNodes.has(textNode)) continue;
                    if (!dateRegex.test(textNode.nodeValue)) continue;

                    // Skip if we already added a weekday tag next to this date
                    if (textNode.nextSibling && textNode.nextSibling.nodeType === Node.ELEMENT_NODE && textNode.nextSibling.classList.contains('mb-day-of-week')) {
                        continue;
                    }

                    seenTextNodes.add(textNode);

                    const match = textNode.nodeValue.match(dateRegex);
                    if (!match) continue;

                    const dateStr = match[1];
                    const date = new Date(dateStr);
                    if (isNaN(date.getTime())) continue;

                    const dayOfWeek = date.getUTCDay();
                    const dayName = dayNames.format(date);

                    let country = null;
                    let countryEl = null;
                    const parentContainer = textNode.parentElement ? textNode.parentElement.closest('li, td') : null;

                    if (parentContainer) {
                        countryEl = parentContainer.querySelector('abbr[title]') || parentContainer.querySelector('bdi') || parentContainer.querySelector('.flag');

                        // On historic edit tables, the country column is right after the date column
                        if (!countryEl && parentContainer.tagName === 'TD') {
                            let next = parentContainer.nextElementSibling;
                            while (next && !countryEl) {
                                countryEl = next.querySelector('abbr[title]') || next.querySelector('bdi') || next.querySelector('.flag');
                                next = next.nextElementSibling;
                            }
                        }
                    }

                    if (countryEl) {
                        country = (countryEl.title || countryEl.textContent || '').trim();
                        if (country && country.length === 2 && countryEl.title) country = countryEl.title.trim();
                    } else if (textNode.parentNode && textNode.parentNode.tagName === 'SPAN') {
                        // Fallback for custom layouts like the "Supercharged Cover Art Edits" script
                        let sibling = textNode.parentNode.nextSibling;
                        if (sibling && sibling.nodeType === Node.TEXT_NODE) {
                            let rMatch = sibling.nodeValue.match(/^\s*\(([A-Z]{2})(?:,.*)?\)/);
                            if (rMatch) country = rMatch[1];
                        }
                    }

                    // Make sure undefined countries don't accidentally get flagged as non-standard
                    let expectedDay = null;
                    if (country && COUNTRY_RELEASE_DAYS[country] !== undefined) {
                        const expected = COUNTRY_RELEASE_DAYS[country];
                        expectedDay = typeof expected === 'function' ? expected(date) : expected;
                    }

                    const statusClass = (expectedDay !== null) ? ((dayOfWeek === expectedDay) ? 'standard' : 'non-standard') : 'unknown';

                    // Queue the DOM update to avoid layout thrashing
                    tasks.push({
                        textNode,
                        splitIndex: match.index + dateStr.length,
                        statusClass,
                        dayName
                    });
                }
            });
        });

        return tasks;
    }

    function flushWriteTasks(tasks) {
        tasks.forEach(task => {
            if (!task.textNode.parentNode) return;

            const daySpan = document.createElement('span');
            daySpan.className = `mb-day-of-week ${task.statusClass}`;
            daySpan.textContent = task.dayName;

            const splitNode = task.textNode.splitText(task.splitIndex);
            task.textNode.parentNode.insertBefore(daySpan, splitNode);
        });
    }

    const collectedNodes = new Set();
    let isScheduled = false;

    function scheduleProcessing() {
        if (isScheduled) return;
        isScheduled = true;

        // Do the heavy lifting during browser idle time so scrolling stays smooth
        requestIdle(() => {
            const nodesArray = Array.from(collectedNodes);
            collectedNodes.clear();

            const tasks = buildWriteTasks(nodesArray);

            if (tasks.length > 0) {
                // Do all visual DOM updates together in the next frame
                requestAnimationFrame(() => {
                    flushWriteTasks(tasks);
                });
            }

            isScheduled = false;
        });
    }

    collectedNodes.add(document.body);
    scheduleProcessing();

    const observer = new MutationObserver((mutations) => {
        let needsProcessing = false;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Don't let our own injected spans trigger another update loop
                    if (node.classList && node.classList.contains('mb-day-of-week')) continue;

                    collectedNodes.add(node);
                    needsProcessing = true;
                }
            }
        }

        if (needsProcessing) {
            scheduleProcessing();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();