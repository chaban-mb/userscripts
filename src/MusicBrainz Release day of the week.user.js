// ==UserScript==
// @name           MusicBrainz: Release day of the week
// @namespace      https://github.com/chaban-mb/userscripts
// @description    Display the day of the week for release events.
// @version        2024.03.08.1
// @author         Jugdish, SultS, chaban
// @include        http*://*musicbrainz.org/release*
// @include        http*://*musicbrainz.org/recording/*
// @include        http*://*musicbrainz.org/edit/*
// @include        http*://*musicbrainz.org/*/edits
// @include        http*://*musicbrainz.org/label/*
// @include        http*://*musicbrainz.org/area/*
// @include        http*://*musicbrainz.org/search/*
// @include        http*://*musicbrainz.org/artist/*/releases*
// @include        http*://*musicbrainz.org/area/*/releases*
// @grant          none
// @run-at         document-idle
// ==/UserScript==

(function () {
    'use strict';

    const dayNames = new Intl.DateTimeFormat('en', { weekday: 'short' });

    const COUNTRY_RELEASE_DAYS = {
        'Australia': 1,      // Mon
        'France': 1,         // Mon
        'Germany': (date) => (date < new Date('2005-09-01') ? 1 : 5), // Mon before Sep 2005, Fri after
        'Japan': 3,          // Wed
        'New Zealand': 1,    // Mon
        'United Kingdom': 1, // Mon
        'United States': 2,  // Tue
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

    function getExpectedDay(country, date) {
        const expected = COUNTRY_RELEASE_DAYS[country];
        if (typeof expected === 'function') {
            return expected(date);
        }
        return expected;
    }

    function processDateElement(el) {
        if (el.dataset.processed) return;
        el.dataset.processed = 'true';

        const dateStr = el.textContent.trim();
        // Match YYYY-MM-DD
        const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return;

        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return;

        const dayOfWeek = date.getUTCDay();
        const dayName = dayNames.format(date);

        // Try to find country
        let country = null;
        const container = el.closest('li, td, tr');
        if (container) {
            // Check for flags/abbr tags which usually contain country info
            const countryEl = container.querySelector('abbr[title], bdi, .flag');
            if (countryEl) {
                country = (countryEl.title || countryEl.textContent || '').trim();
                // Special case for flags that might just have country code in text
                if (country && country.length === 2 && countryEl.title) {
                    country = countryEl.title.trim();
                }
            }
        }

        const expectedDay = country ? getExpectedDay(country, date) : null;
        let statusClass = 'unknown';

        if (expectedDay !== null) {
            statusClass = (dayOfWeek === expectedDay) ? 'standard' : 'non-standard';
        }

        const daySpan = document.createElement('span');
        daySpan.className = `mb-day-of-week ${statusClass}`;
        daySpan.textContent = dayName;
        el.appendChild(daySpan);
    }

    function processTextNodes(root) {
        const releaseEvents = root.querySelectorAll('.release-events li');
        releaseEvents.forEach(li => {
            if (li.querySelector('.mb-day-of-week')) return;

            for (const node of li.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const match = node.nodeValue.match(/(\d{4})-(\d{2})-(\d{2})/);
                    if (match) {
                        const dateStr = match[0];
                        const date = new Date(dateStr);
                        if (!isNaN(date.getTime())) {
                            const dayName = dayNames.format(date);
                            const dayOfWeek = date.getUTCDay();

                            let country = null;
                            const countryEl = li.querySelector('abbr[title], bdi, .flag');
                            if (countryEl) {
                                country = (countryEl.title || countryEl.textContent || '').trim();
                            }

                            const expectedDay = country ? getExpectedDay(country, date) : null;
                            let statusClass = 'unknown';
                            if (expectedDay !== null) {
                                statusClass = (dayOfWeek === expectedDay) ? 'standard' : 'non-standard';
                            }

                            const daySpan = document.createElement('span');
                            daySpan.className = `mb-day-of-week ${statusClass}`;
                            daySpan.textContent = dayName;
                            node.after(daySpan);
                            break;
                        }
                    }
                }
            }
        });
    }

    function run(root = document) {
        if (!(root instanceof Element || root instanceof HTMLDocument)) return;

        const selectors = [
            'span.release-date',
            'span.diff-only-a',
            'span.diff-only-b'
        ];

        root.querySelectorAll(selectors.join(', ')).forEach(processDateElement);

        // Fallback for release page sidebar where dates might be direct text nodes
        processTextNodes(root);
    }

    let timeout = null;
    const addedNodes = new Set();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    addedNodes.add(node);
                }
            }
        }

        if (addedNodes.size > 0) {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                addedNodes.forEach(node => {
                    // Check if node is still in document
                    if (document.contains(node)) {
                        run(node);
                    }
                });
                addedNodes.clear();
            }, 50);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    run();
})();
