// ==UserScript==
// @name        MusicBrainz: Release day of the week
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.2.2
// @description Display the day of the week for release events.
// @tag         ai-created
// @author      Jugdish, SultS, chaban
// @license     MIT
// @match       https://*.musicbrainz.org/release*
// @match       https://*.musicbrainz.org/recording/*
// @match       https://*.musicbrainz.org/edit/*
// @match       https://*.musicbrainz.org/*/edits
// @match       https://*.musicbrainz.org/label/*
// @match       https://*.musicbrainz.org/area/*
// @match       https://*.musicbrainz.org/search*
// @match       https://*.musicbrainz.org/artist/*/releases*
// @match       https://*.musicbrainz.org/area/*/releases*
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       none
// @run-at      document-idle
// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Release%20day%20of%20the%20week.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Release%20day%20of%20the%20week.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Safari fallback for requestIdleCallback
    const requestIdle = window.requestIdleCallback || function (cb) {
        return setTimeout(function () { cb(); }, 1);
    };

    const locale = document.documentElement.lang || 'en';
    const dayNames = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const fullDayNamesFormatter = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
    const fullDayNames = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(Date.UTC(2006, 0, i + 1));
        return fullDayNamesFormatter.format(date);
    });
    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;

    const SWITCH_DATE_2015 = new Date('2015-07-10T00:00:00');
    const SWITCH_DATE_DE = new Date('2005-09-23T00:00:00');

    const COUNTRY_RULES = {
        'AU': { name: 'Australia', expectedDay: 5 },
        'FR': { name: 'France', expectedDay: (date) => (date >= SWITCH_DATE_2015 ? 5 : 1) },
        'CA': { name: 'Canada', expectedDay: (date) => (date >= SWITCH_DATE_2015 ? 5 : 2) },
        'DE': { name: 'Germany', expectedDay: (date) => (date < SWITCH_DATE_DE ? 1 : 5) },
        'IT': { name: 'Italy', expectedDay: (date) => (date >= SWITCH_DATE_2015 ? 5 : 2) },
        'JP': { name: 'Japan', expectedDay: 3 },
        'NL': { name: 'Netherlands', expectedDay: 5 },
        'NZ': { name: 'New Zealand', expectedDay: (date) => (date >= SWITCH_DATE_2015 ? 5 : 1) },
        'GB': { name: 'United Kingdom', expectedDay: (date) => (date >= SWITCH_DATE_2015 ? 5 : 1) },
        'US': { name: 'United States', expectedDay: (date) => (date >= SWITCH_DATE_2015 ? 5 : 2) },
        'XW': { name: 'Worldwide', expectedDay: (date) => (date >= SWITCH_DATE_2015 ? 5 : null) }
    };

    const COUNTRY_MAP = new Map();
    for (const [code, rule] of Object.entries(COUNTRY_RULES)) {
        COUNTRY_MAP.set(code, rule);
        COUNTRY_MAP.set(rule.name, rule);
    }
    COUNTRY_MAP.set('[Worldwide]', COUNTRY_RULES['XW']);

    const style = document.createElement('style');
    style.textContent = `
        .mb-day-of-week { font-weight: bold; margin-left: 0.3em; white-space: nowrap; }
        .mb-day-of-week.standard { color: green; }
        .mb-day-of-week.non-standard { color: #F60; }
        .mb-day-of-week.unknown { color: grey; }
        span.release-date, span.diff-only-a, span.diff-only-b { white-space: nowrap !important; }
    `;
    document.head.appendChild(style);

    /**
     * @typedef {Object} WriteTask
     * @property {Text} textNode - The text node containing the parsed date.
     * @property {number} splitIndex - The string index where the text node should be split.
     * @property {string} statusClass - The CSS class indicating if the release day is standard.
     * @property {string} dayName - The localized name of the day of the week.
     * @property {string} tooltipText - Additional information about the expected release day.
     */

    /**
     * @summary Scans DOM nodes for release dates and builds a list of DOM injection tasks.
     * @param {Node[]} nodesToProcess - An array of DOM nodes to search within.
     * @returns {WriteTask[]} An array of tasks representing planned DOM updates.
     */
    function buildWriteTasks(nodesToProcess) {
        const tasks = [];
        // Track nodes we've seen in this batch so we don't process them twice
        const seenTextNodes = new Set();

        // Places where dates usually show up, including fallbacks for other userscripts
        const validContainersSelector = [
            '.release-events',
            '.release-events-diff',
            '.edit-release-events',
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
                    // Append T00:00 to force the browser to treat this as local time, not UTC
                    const date = new Date(dateStr + 'T00:00:00');
                    if (isNaN(date.getTime())) continue;

                    // Use getDay() instead of getUTCDay() if treating as local time
                    const dayOfWeek = date.getDay();
                    const dayName = dayNames.format(date);

                    let countryCode = null;
                    let countryName = null;
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
                        const title = (countryEl.title || '').trim();
                        const text = (countryEl.textContent || '').trim();

                        if (text.length === 2) {
                            countryCode = text;
                            countryName = title;
                        } else if (title.length === 2) {
                            countryCode = title;
                            countryName = text;
                        } else {
                            countryName = title || text;
                        }
                    } else if (textNode.parentNode && textNode.parentNode.tagName === 'SPAN') {
                        // Fallback for custom layouts like the "Supercharged Cover Art Edits" script
                        let sibling = textNode.parentNode.nextSibling;
                        if (sibling && sibling.nodeType === Node.TEXT_NODE) {
                            let rMatch = sibling.nodeValue.match(/^\s*\(([A-Z]{2})(?:,.*)?\)/);
                            if (rMatch) countryCode = rMatch[1];
                        }
                    }

                    // Make sure undefined countries don't accidentally get flagged as non-standard
                    let expectedDay = null;
                    let rule = null;

                    if (countryCode) {
                        rule = COUNTRY_MAP.get(countryCode);
                    }
                    if (!rule && countryName) {
                        rule = COUNTRY_MAP.get(countryName);
                    }

                    if (rule !== null && rule !== undefined) {
                        expectedDay = typeof rule.expectedDay === 'function' ? rule.expectedDay(date) : rule.expectedDay;
                    }

                    const statusClass = (expectedDay !== null) ? ((dayOfWeek === expectedDay) ? 'standard' : 'non-standard') : 'unknown';

                    let tooltipText = '';
                    const displayCountry = rule ? rule.name : (countryName || countryCode || '');

                    if (expectedDay !== null && dayOfWeek !== expectedDay) {
                        tooltipText = `Expected ${fullDayNames[expectedDay]} for ${displayCountry}, but is ${fullDayNames[dayOfWeek]}.`;
                    } else if (expectedDay !== null && dayOfWeek === expectedDay) {
                        tooltipText = `Standard release day for ${displayCountry}.`;
                    } else if (displayCountry === 'Worldwide') {
                        tooltipText = 'No standard Global Release Day existed prior to July 10, 2015.';
                    } else if (displayCountry) {
                        tooltipText = `No standard release day known for ${displayCountry}.`;
                    } else {
                        tooltipText = 'Could not determine country.';
                    }

                    // Queue the DOM update to avoid layout thrashing
                    tasks.push({
                        textNode,
                        splitIndex: match.index + dateStr.length,
                        statusClass,
                        dayName,
                        tooltipText
                    });
                }
            });
        });

        return tasks;
    }

    /**
     * @summary Executes the planned DOM updates in a single batch to minimize layout thrashing.
     * @param {WriteTask[]} tasks - The list of prepared DOM manipulation tasks.
     */
    function flushWriteTasks(tasks) {
        tasks.forEach(task => {
            if (!task.textNode.parentNode) return;

            const daySpan = document.createElement('span');
            daySpan.className = `mb-day-of-week ${task.statusClass}`;
            daySpan.textContent = task.dayName;

            if (task.tooltipText) {
                daySpan.title = task.tooltipText;
                daySpan.style.cursor = 'help';
            }

            const splitNode = task.textNode.splitText(task.splitIndex);
            task.textNode.parentNode.insertBefore(daySpan, splitNode);
        });
    }

    const collectedNodes = new Set();
    let isScheduled = false;

    /**
     * @summary Schedules background DOM processing of collected text nodes using requestIdleCallback to avoid layout thrashing.
     */
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