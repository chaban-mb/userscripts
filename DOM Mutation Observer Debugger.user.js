// ==UserScript==
// @name        DOM Mutation Observer Debugger
// @namespace   https://musicbrainz.org/user/chaban
// @version     1.0.0
// @tag         ai-created
// @description Logs all DOM mutations (additions, removals, attribute changes) to the console for debugging purposes.
// @author      chaban
// @license     MIT
// @match       *://*/*
// @grant       none
// ==/UserScript==

(function() {
    'use strict';

    console.log('Mutation Observer Debugger: Initialized and watching for DOM changes.');

    const config = {
        attributes: true, // Watch for attribute changes
        childList: true, // Watch for additions or removals of child nodes
        subtree: true, // Extend the observation to the entire DOM subtree
        attributeOldValue: true, // Record the previous value of changed attributes
        characterData: false, // Watch for changes to character data (text nodes)
        characterDataOldValue: false // Record the previous value of changed text
    };

    /**
     * The callback function that will be executed when mutations are observed.
     * @param {MutationRecord[]} mutationsList - An array of MutationRecord objects.
     * @param {MutationObserver} observer - The MutationObserver instance.
     */
    const callback = function(mutationsList, observer) {
        const timestamp = new Date().toISOString();

        for (const mutation of mutationsList) {
            console.group(`%c[Mutation Observer @ ${timestamp}] Change detected: ${mutation.type}`, 'color: #4CAF50; font-weight: bold;');

            console.log('Target:', mutation.target);

            switch (mutation.type) {
                case 'childList':
                    if (mutation.addedNodes.length > 0) {
                        console.log('Added Nodes:', Array.from(mutation.addedNodes));
                    }
                    if (mutation.removedNodes.length > 0) {
                        console.log('Removed Nodes:', Array.from(mutation.removedNodes));
                    }
                    break;

                case 'attributes':
                    console.log(`Attribute '${mutation.attributeName}' changed.`);
                    console.log('New Value:', mutation.target.getAttribute(mutation.attributeName));
                    console.log('Old Value:', mutation.oldValue);
                    break;

                case 'characterData':
                     console.log('Character data changed.');
                     console.log('New Value:', mutation.target.nodeValue);
                     console.log('Old Value:', mutation.oldValue);
                    break;
            }

            console.groupEnd();
        }
    };

    const observer = new MutationObserver(callback);

    if (document.body) {
        observer.observe(document.body, config);
    } else {
        window.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, config);
        });
    }
})();
