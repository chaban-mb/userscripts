// ==UserScript==
// @name         ISRC Hunt: Hide a-tisket links, normalize link style
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0
// @description  Hides a-tisket links on ISRC Hunt and normalizes link style
// @tag          ai-created
// @author       chaban
// @license      MIT
// @match        *://isrchunt.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function addGlobalStyle(css) {
        const style = document.createElement('style');
        style.type = 'text/css';
        style.textContent = css;
        document.head.appendChild(style);
    }

    const customCss = `
        a {
            all: revert;
        }
    `;
    addGlobalStyle(customCss);

    /**
     * Hides elements matching a given CSS selector by setting their display style to 'none'.
     * @param {string} selector - The CSS selector for the elements to hide.
     */
    function hideElementsBySelector(selector) {
        document.querySelectorAll(selector).forEach(element => {
            element.style.display = 'none';
        });
    }

    /**
     * Replaces text instances within text nodes that match a given regular expression.
     * If no replacement text is provided, the matched text is effectively deleted.
     * This emulates uBlock Origin's `rpnt` (replace-node-text) scriptlet.
     * @param {RegExp} textToFindRegex - The regular expression to find in text nodes.
     * @param {string} [replacementText=''] - The text to replace the matched text with. Defaults to an empty string (deletion).
     */
    function replaceTextInNodes(textToFindRegex, replacementText = '') {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function(node) {
                    if (node.nodeValue.trim() !== '' && textToFindRegex.test(node.nodeValue)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            },
            false
        );

        let node;
        const nodesToProcess = [];

        while ((node = walker.nextNode())) {
            nodesToProcess.push(node);
        }

        nodesToProcess.forEach(node => {
            node.nodeValue = node.nodeValue.replace(textToFindRegex, replacementText);
        });
    }

    /**
     * Applies all defined filters to the current DOM.
     */
    function applyFilters() {
        hideElementsBySelector('[href^="https://atisket.pulsewidth.org.uk/"]');

        replaceTextInNodes(/^ \/ $/, '');
    }

    const observer = new MutationObserver(applyFilters);

    observer.observe(document.body, { childList: true, subtree: true });

    applyFilters();
})();
