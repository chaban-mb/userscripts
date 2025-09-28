// ==UserScript==
// @name         SecondHandSongs to MusicBrainz Linker
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.3
// @tag          ai-created
// @description  Adds links from secondhandsongs.com to MusicBrainz entities.
// @author       chaban
// @license      MIT
// @match        https://secondhandsongs.com/*
// @require      https://ajax.googleapis.com/ajax/libs/jquery/2.2.4/jquery.min.js
// @require      https://raw.githubusercontent.com/murdos/musicbrainz-userscripts/master/lib/mblinks.js
// @require      https://raw.githubusercontent.com/murdos/musicbrainz-userscripts/master/lib/mbimportstyle.js
// @grant        none
// ==/UserScript==

// prevent JQuery conflicts, see http://wiki.greasespot.net/@grant
this.$ = this.jQuery = jQuery.noConflict(true);

$(document).ready(function () {
    MBSearchItStyle();
    const mblinks = new MBLinks('SHS_MBLINKS_CACHE');

    /**
     * Cleans up a SecondHandSongs URL to its canonical form.
     * @param {string} url - The URL to clean.
     * @returns {string} The cleaned URL.
     */
    function cleanUrl(url) {
        return url.replace(/^(https:\/\/secondhandsongs\.com\/(?:artist|performance|work|release|label)\/\d+).*/, '$1');
    }

    /**
     * Maps SecondHandSongs URL paths to MusicBrainz entity types.
     * @param {string} path - The path segment from a SecondHandSongs URL.
     * @returns {string|null} The corresponding MusicBrainz entity type or null.
     */
    function getMbTypeFromPath(path) {
        const typeMap = {
            'artist': 'artist',
            'performance': 'recording',
            'work': 'work',
            'release': 'release',
            'label': 'label',
        };
        return typeMap[path] || null;
    }

    /**
     * Gathers all relevant entity links from a given context, groups them by type, and processes them in batches.
     * @param {Node} context - The DOM node to search within for links.
     */
    function addLinksToPage(context) {
        const $context = $(context || document);
        const canonicalPathRegex = /^\/(?:artist|performance|work|release|label)\/\d+\/?$/;
        const urlsToProcess = {}; // Group URLs by mb_type

        // Main entity on the page
        if (!context || context === document) {
            const pageUrl = cleanUrl(window.location.href);
            const path = pageUrl.split('/')[3];
            const pageType = getMbTypeFromPath(path);

            if (pageType) {
                if (!urlsToProcess[pageType]) {
                    urlsToProcess[pageType] = [];
                }
                urlsToProcess[pageType].push({
                    url: pageUrl,
                    mb_type: pageType,
                    insert_func: function (link) {
                        const $mbLink = $(link).css({
                            'margin-left': '8px',
                            'vertical-align': 'middle',
                        });
                        $('h1[itemprop="name"]').append($mbLink);
                    }
                });
            }
        }

        // Other entity links within the context
        $context.find('a[href*="/artist/"], a[href*="/performance/"], a[href*="/work/"], a[href*="/release/"], a[href*="/label/"]').each(function () {
            const $anchor = $(this);
            if ($anchor.data('mblinks-added')) {
                return;
            }
            $anchor.data('mblinks-added', true);

            const urlObject = new URL($anchor.attr('href'), window.location.href);

            if (!canonicalPathRegex.test(urlObject.pathname)) {
                return;
            }

            const url = cleanUrl(urlObject.href);
            const path = url.split('/')[3];
            const type = getMbTypeFromPath(path);

            if (type) {
                if (!urlsToProcess[type]) {
                    urlsToProcess[type] = [];
                }
                urlsToProcess[type].push({
                    url: url,
                    mb_type: type,
                    insert_func: function (link) {
                        const $mbLink = $(link).css({
                            'margin-left': '4px',
                            'vertical-align': 'middle',
                        });
                         const $parentSpan = $anchor.closest('span[itemprop="name"]');
                        if ($parentSpan.length) {
                            $parentSpan.after($mbLink);
                        } else {
                            $anchor.after($mbLink);
                        }
                    }
                });
            }
        });

        // Process each group of URLs with the correct entity type
        for (const type in urlsToProcess) {
            if (urlsToProcess.hasOwnProperty(type)) {
                mblinks.searchAndDisplayMbLinks(urlsToProcess[type]);
            }
        }
    }

    // Initial run on page load
    addLinksToPage();

    // Observe for dynamically loaded content
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        addLinksToPage(node);
                    }
                });
            }
        });
    });

    const targetNode = document.getElementById('root');
    if (targetNode) {
        observer.observe(targetNode, {
            childList: true,
            subtree: true,
        });
    }
});
