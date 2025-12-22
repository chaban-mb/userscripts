// ==UserScript==
// @name         ListenBrainz: Link with MusicBrainz Quick Button
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.2
// @tag          ai-created
// @description  Adds a "Link with MusicBrainz" button directly to the listen row and automatically handles the copy text action.
// @author       chaban
// @match        https://*.listenbrainz.org/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    /**
     * WeakSet to store references to buttons that have already been clicked automatically.
     * This prevents infinite loops without modifying the DOM.
     * @type {WeakSet<HTMLElement>}
     */
    const processedButtons = new WeakSet();

    /**
     * Adds a direct "Link with MusicBrainz" button to a specific listen card.
     * @param {HTMLElement} card - The listen card DOM element.
     */
    function addLinkButton(card) {
        // Prevent duplicate buttons on the same card
        if (card.querySelector('.lb-quick-link-btn')) return;

        const controlsDiv = card.querySelector('.listen-controls');
        if (!controlsDiv) return;

        // Find the original button within the dropdown menu to clone functionality and icon
        const originalButton = card.querySelector('button[title="Link with MusicBrainz"]');
        if (!originalButton) return;

        // Create the new button mirroring the native style
        const newBtn = document.createElement('button');
        newBtn.className = 'btn btn-transparent lb-quick-link-btn';
        newBtn.title = 'Link with MusicBrainz';

        // Clone the icon from the original button
        const originalIcon = originalButton.querySelector('svg');
        if (originalIcon) {
            newBtn.appendChild(originalIcon.cloneNode(true));
        } else {
            newBtn.innerText = "Link";
        }

        // Trigger the original button click when this button is clicked
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            originalButton.click();
        });

        // Insert the button before the menu dropdown toggle
        const menuButton = controlsDiv.querySelector('.dropdown-toggle');
        if (menuButton) {
            controlsDiv.insertBefore(newBtn, menuButton);
        } else {
            controlsDiv.appendChild(newBtn);
        }
    }

    /**
     * Detects the MBID Mapping Modal and automatically clicks the "copy text" button.
     */
    function handleModal() {
        const modalContext = document.getElementById('MBIDMappingModal');
        if (!modalContext) return;

        const buttons = modalContext.querySelectorAll('button');

        for (let btn of buttons) {
            // Skip if this specific button instance was already processed
            if (processedButtons.has(btn)) continue;

            if (btn.innerText.toLowerCase().includes('copy text')) {
                processedButtons.add(btn);
                btn.click();
                break;
            }
        }
    }

    /**
     * Scans the page for listen cards and active modals.
     */
    function scanPage() {
        // Check if we are on the specific settings page where buttons should NOT be added
        const isSettingsPage = window.location.pathname.includes('/settings/link-listens');

        // Only add buttons if we are NOT on the settings page
        if (!isSettingsPage) {
            const listens = document.querySelectorAll('.listen-card');
            listens.forEach(addLinkButton);
        }

        // Always handle the modal, regardless of the page
        handleModal();
    }

    // Initial scan on script load
    scanPage();

    // Set up an observer to handle dynamic content loading (React)
    const observer = new MutationObserver(() => {
        scanPage();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

})();
