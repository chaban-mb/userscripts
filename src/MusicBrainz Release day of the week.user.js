// ==UserScript==
// @name           MusicBrainz: Release day of the week
// @namespace      https://github.com/chaban-mb/userscripts
// @description    Display the day of the week for release events.
// @version        1.0.0
// @author         Jugdish, SultS, chaban
// @include        http*://*musicbrainz.org/release*
// @include        http*://*musicbrainz.org/recording/*
// @include        http*://*musicbrainz.org/edit/*
// @include        http*://*musicbrainz.org/*/edits
// @include        http*://*musicbrainz.org/label/*
// @include        http*://*musicbrainz.org/area/*
// @include        http*://*musicbrainz.org/search*
// @include        http*://*musicbrainz.org/artist/*/releases*
// @include        http*://*musicbrainz.org/area/*/releases*
// @grant          none
// @run-at         document-idle
// ==/UserScript==

(function () {
    'use strict';

    // Safari Fallback für requestIdleCallback
    const requestIdle = window.requestIdleCallback || function (cb) {
        return setTimeout(function () { cb(); }, 1);
    };

    const dayNames = new Intl.DateTimeFormat('en', { weekday: 'short' });
    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;

    const COUNTRY_RELEASE_DAYS = {
        'Australia': 1,
        'France': 1,
        'Germany': (date) => (date < new Date('2005-09-01') ? 1 : 5),
        'Japan': 3,
        'New Zealand': 1,
        'United Kingdom': 1,
        'United States': 2,
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

    // --- PHASE 1: BACKGROUND PROCESSING (DOM Reads & Logic) ---
    function buildWriteTasks(nodesToProcess) {
        const tasks = [];
        const seenTextNodes = new Set();

        // Punktgenaue Selektoren für alle bekannten Orte, an denen Release-Daten stehen
        const validContainersSelector = [
            '.release-events',               // Reguläre Listen (Recording-, Artist-, Label-Pages)
            '.release-events-diff',          // Diff-Tabellen (Edit-Pages)
            '.edit-release-events',          // Historische Edits
            'table.details.add-release',     // "Add release" Edit-Tables
            'table.details.edit-release',    // "Edit release" Edit-Tables
            'span.release-date',             // Nativ gerenderte Daten (z.B. Sidebar, Release-Tab)
            'span[data-name="release-date"]' // Fallback für "Supercharged CAA Edits"
        ].join(', ');

        nodesToProcess.forEach(root => {
            if (!document.contains(root)) return;

            let containers = Array.from(root.querySelectorAll(validContainersSelector));

            // Wenn der mutierte Node selbst ein gesuchter Container ist
            if (root.matches && root.matches(validContainersSelector)) {
                containers.push(root);
            } else if (containers.length === 0) {
                // Sicherheitsnetz für kleine Mutationen: Liegt der Node in einem gültigen Container?
                const parentContainer = root.closest ? root.closest(validContainersSelector) : null;
                if (parentContainer) {
                    containers = [root];
                }
            }

            containers.forEach(container => {
                const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
                let textNode;

                while (textNode = walker.nextNode()) {
                    // SCHUTZ: Ignoriere Texte innerhalb von Disambiguations oder Kommentaren
                    if (textNode.parentNode && textNode.parentNode.classList && textNode.parentNode.classList.contains('comment')) {
                        continue;
                    }

                    if (seenTextNodes.has(textNode)) continue;
                    if (!dateRegex.test(textNode.nodeValue)) continue;

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

                        // Tabellen-Logik für historische Edits
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
                        // Fallback für Userscripte wie "Supercharged Cover Art Edits"
                        let sibling = textNode.parentNode.nextSibling;
                        if (sibling && sibling.nodeType === Node.TEXT_NODE) {
                            let rMatch = sibling.nodeValue.match(/^\s*\(([A-Z]{2})(?:,.*)?\)/);
                            if (rMatch) country = rMatch[1];
                        }
                    }

                    let expectedDay = null;
                    if (country && COUNTRY_RELEASE_DAYS[country] !== undefined) {
                        const expected = COUNTRY_RELEASE_DAYS[country];
                        expectedDay = typeof expected === 'function' ? expected(date) : expected;
                    }

                    const statusClass = (expectedDay !== null) ? ((dayOfWeek === expectedDay) ? 'standard' : 'non-standard') : 'unknown';

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

    // --- PHASE 2: VISUAL UPDATES (DOM Writes) ---
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


    // --- DER OBSERVER (Die Orchestrierung) ---
    const collectedNodes = new Set();
    let isScheduled = false;

    function scheduleProcessing() {
        if (isScheduled) return;
        isScheduled = true;

        requestIdle(() => {
            const nodesArray = Array.from(collectedNodes);
            collectedNodes.clear();

            const tasks = buildWriteTasks(nodesArray);

            if (tasks.length > 0) {
                requestAnimationFrame(() => {
                    flushWriteTasks(tasks);
                });
            }

            isScheduled = false;
        });
    }

    // Initialer Durchlauf
    collectedNodes.add(document.body);
    scheduleProcessing();

    // Dynamischer Observer
    const observer = new MutationObserver((mutations) => {
        let needsProcessing = false;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
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