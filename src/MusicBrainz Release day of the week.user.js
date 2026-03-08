// ==UserScript==
// @name           MusicBrainz: Release day of the week
// @namespace      https://github.com/chaban-mb/userscripts
// @description    Display the day of the week for release events.
// @version        2024.03.08.3
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

    const dayNames = new Intl.DateTimeFormat('en', { weekday: 'short' });

    const COUNTRY_RELEASE_DAYS = {
        'Australia': 1,      // Mon
        'France': 1,         // Mon
        'Germany': (date) => (date < new Date('2005-09-01') ? 1 : 5), // Mon before Sep 2005, Fri after
        'Japan': 3,          // Wed
        'New Zealand': 1,    // Mon
        'United Kingdom': 1, // Mon
        'United States': 2,  // Tue
        '[Worldwide]': (date) => (date >= new Date('2015-07-10') ? 5 : null),
        'XW': (date) => (date >= new Date('2015-07-10') ? 5 : null),
    };

    // Stylesheet injizieren
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

    function processDates(root) {
        if (!(root instanceof Element || root instanceof HTMLDocument)) return;

        // Container definieren, in denen nach Daten gesucht werden soll
        let containers = Array.from(root.querySelectorAll('.release-events, table.details, table.tbl, .edit-list'));

        // Falls der übergebene Root-Knoten selbst ein gültiger Container ist
        if (root instanceof Element && root.matches && root.matches('.release-events, table.details, table.tbl, .edit-list')) {
            containers.push(root);
        }

        // Fallback: Wenn keine spezifischen Container gefunden wurden, nutze den Root (z.B. für kleine DOM-Updates)
        if (containers.length === 0) {
            containers = [root];
        }

        const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;

        containers.forEach(container => {
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let node;
            const nodesToProcess = [];

            // Alle relevanten Textknoten sammeln
            while (node = walker.nextNode()) {
                if (dateRegex.test(node.nodeValue)) {
                    nodesToProcess.push(node);
                }
            }

            // Knoten verarbeiten und DOM manipulieren
            nodesToProcess.forEach(textNode => {
                // Verhindern, dass bereits verarbeitete Daten doppelt markiert werden
                if (textNode.nextSibling &&
                    textNode.nextSibling.nodeType === Node.ELEMENT_NODE &&
                    textNode.nextSibling.classList.contains('mb-day-of-week')) {
                    return;
                }

                const match = textNode.nodeValue.match(dateRegex);
                if (!match) return;

                const dateStr = match[1];
                const date = new Date(dateStr);
                if (isNaN(date.getTime())) return;

                const dayOfWeek = date.getUTCDay();
                const dayName = dayNames.format(date);

                // Land aus dem übergeordneten Kontext ermitteln
                let country = null;
                const parentEl = textNode.parentElement.closest('li, td, tr');
                if (parentEl) {
                    let countryEl = parentEl.querySelector('abbr[title]');
                    if (!countryEl) countryEl = parentEl.querySelector('bdi');
                    if (!countryEl) countryEl = parentEl.querySelector('.flag');

                    if (countryEl) {
                        country = (countryEl.title || countryEl.textContent || '').trim();
                        // Spezialfall: Flaggen, bei denen das Kürzel im Title steht
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

                // Tag-Anzeige erstellen
                const daySpan = document.createElement('span');
                daySpan.className = `mb-day-of-week ${statusClass}`;
                daySpan.textContent = dayName;

                // Textknoten exakt nach dem Datum aufspalten und das Span einfügen
                const splitIndex = match.index + dateStr.length;
                const splitNode = textNode.splitText(splitIndex);
                textNode.parentNode.insertBefore(daySpan, splitNode);
            });
        });
    }

    // Initialer Durchlauf
    processDates(document);

    // Observer für dynamisch nachgeladene Inhalte (z.B. Edits aufklappen)
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
                    if (document.contains(node)) {
                        processDates(node);
                    }
                });
                addedNodes.clear();
            }, 50); // Leichtes Debouncing für bessere Performance
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();