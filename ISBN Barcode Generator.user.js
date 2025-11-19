// ==UserScript==
// @name         ISBN Barcode Generator
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.1.0
// @tag          ai-created
// @description  Erkennt ISBNs und bettet einen scanbaren Barcode direkt ein. Mit An/Aus-Schalter im Menü.
// @author       chaban
// @license      MIT
// @match        https://www.thalia.de/*
// @match        https://www.manga-passion.de/*
// @connect      barcode.tec-it.com
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addElement
// ==/UserScript==

(function () {
    'use strict';

    const TEC_IT_BASE_URL = 'https://barcode.tec-it.com/barcode.ashx';
    const ISBN_REGEX = /\b(?:(97[89])[- ]?)?([\d][- ]?){9}[\dxX]\b/g;

    const SETTING_KEY = 'isbnBarcodeEmbedState';
    const WRAPPER_CLASS = 'isbn-barcode-wrapper';
    const IMAGE_WRAPPER_CLASS = 'isbn-barcode-embed-container';

    let menuCommandId = null;

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    // --- Validierungsfunktionen ---

    function cleanISBN(isbn) {
        return isbn.replace(/[- ]/g, '').toUpperCase();
    }

    function isValidISBN10(isbn) {
        if (isbn.length !== 10) return false;
        let sum = 0;
        for (let i = 0; i < 9; i++) {
            sum += parseInt(isbn[i], 10) * (10 - i);
        }
        const checksum = isbn[9] === 'X' ? 10 : parseInt(isbn[9], 10);
        return (sum + checksum) % 11 === 0;
    }

    function isValidISBN13(isbn) {
        if (isbn.length !== 13 || !(isbn.startsWith('978') || isbn.startsWith('979'))) {
            return false;
        }
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            sum += parseInt(isbn[i], 10) * (i % 2 === 0 ? 1 : 3);
        }
        const checksum = parseInt(isbn[12], 10);
        return (10 - (sum % 10)) % 10 === checksum;
    }

    function convertISBN10to13(isbn10) {
        const isbn13 = '978' + isbn10.substring(0, 9);
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            sum += parseInt(isbn13[i], 10) * (i % 2 === 0 ? 1 : 3);
        }
        const checksum = (10 - (sum % 10)) % 10;
        return isbn13 + checksum;
    }

    function validateISBN(rawIsbn) {
        const clean = cleanISBN(rawIsbn);
        if (clean.length === 13 && isValidISBN13(clean)) {
            return clean;
        }
        if (clean.length === 10 && isValidISBN10(clean)) {
            return convertISBN10to13(clean);
        }
        return null;
    }

    // --- UI-Funktionen ---

    function createTecItLink() {
        const link = document.createElement('a');
        link.href = 'https://www.tec-it.com';
        link.title = 'Barcode Software by TEC-IT';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Barcode generiert mit TEC-IT';
        return link;
    }

    /**
     * Erstellt den Barcode-Container (Bild + Link) für die direkte Einbettung.
     */
    function createEmbeddedBarcode(isbn13) {
        const imageUrl = `${TEC_IT_BASE_URL}?data=${encodeURIComponent(isbn13)}&code=ISBN13&dpi=96`;
        const altText = `Barcode für ISBN ${isbn13}`;

        const imageWrapper = document.createElement('div');
        imageWrapper.className = IMAGE_WRAPPER_CLASS;

        GM_addElement(imageWrapper, 'img', {
            src: imageUrl,
            alt: altText
        });

        imageWrapper.appendChild(createTecItLink());

        return imageWrapper;
    }

    /**
     * Injiziert das CSS für die eingebetteten Barcodes.
     */
    function addGlobalStyle() {
        GM_addStyle(`
            .${WRAPPER_CLASS} {
                display: inline-block;
                vertical-align: bottom;
                line-height: 1.2;
                text-align: center;
            }
            .${IMAGE_WRAPPER_CLASS} {
                display: block;
                margin-top: 5px;
                padding: 4px;
                background-color: #f9f9f9;
                border: 1px solid #eee;
                border-radius: 4px;
                font-size: 10px;
                color: #555;
                height: auto !important;
                max-height: none !important;
            }
            .${IMAGE_WRAPPER_CLASS} img {
                max-width: 100% !important;
                height: auto !important;
                max-height: none !important;
                display: block !important;
                margin: 0 auto !important;
                image-rendering: pixelated;
                border: none !important;
                padding: 0 !important;
                background: none !important;
            }
            .${IMAGE_WRAPPER_CLASS} a {
                color: #555 !important;
                text-decoration: none !important;
            }
            .${IMAGE_WRAPPER_CLASS} a:hover {
                text-decoration: underline !important;
            }
        `);
    }

    // --- KERNLOGIK: Scannen und Toggles ---

    function scanAndWrapISBNs() {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    if (node.parentElement.closest(`script, style, .${WRAPPER_CLASS}, a[href*='isbn']`)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    ISBN_REGEX.lastIndex = 0;
                    if (ISBN_REGEX.test(node.nodeValue)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_REJECT;
                }
            }
        );

        const nodesToProcess = [];
        while (walker.nextNode()) {
            nodesToProcess.push(walker.currentNode);
        }

        for (const node of nodesToProcess) {
            if (!node.parentElement) continue;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            ISBN_REGEX.lastIndex = 0;
            const text = node.nodeValue;

            while ((match = ISBN_REGEX.exec(text)) !== null) {
                const rawIsbn = match[0];
                const cleanIsbn = validateISBN(rawIsbn);

                if (cleanIsbn) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));

                    const mainWrapper = document.createElement('span');
                    mainWrapper.className = WRAPPER_CLASS;
                    mainWrapper.appendChild(document.createTextNode(rawIsbn));
                    mainWrapper.appendChild(createEmbeddedBarcode(cleanIsbn));

                    fragment.appendChild(mainWrapper);
                    lastIndex = match.index + rawIsbn.length;
                }
            }

            if (lastIndex > 0) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
                node.parentElement.replaceChild(fragment, node);
            }
        }
    }

    function removeEmbeddedBarcodes() {
        document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(wrapper => {
            if (wrapper.parentElement && wrapper.firstChild) {
                wrapper.parentElement.replaceChild(wrapper.firstChild, wrapper);
            }
        });
    }

    function enableBarcodeEmbedding() {
        GM_setValue(SETTING_KEY, true);
        scanAndWrapISBNs();
        updateMenuCommand();
    }

    function disableBarcodeEmbedding() {
        GM_setValue(SETTING_KEY, false);
        removeEmbeddedBarcodes();
        updateMenuCommand();
    }

    function updateMenuCommand() {
        if (menuCommandId) {
            GM_unregisterMenuCommand(menuCommandId);
        }

        const isEnabled = GM_getValue(SETTING_KEY, true);
        const label = isEnabled ? "✅ ISBN-Barcodes ausblenden" : "❌ ISBN-Barcodes einbetten";
        const commandFunc = isEnabled ? disableBarcodeEmbedding : enableBarcodeEmbedding;

        menuCommandId = GM_registerMenuCommand(label, commandFunc);
    }

    // --- Skriptstart ---

    addGlobalStyle();
    updateMenuCommand();

    const debouncedScan = debounce(() => {
        if (GM_getValue(SETTING_KEY, true)) {
            scanAndWrapISBNs();
        }
    }, 500);

    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Filter, um nicht auf die eigenen Änderungen zu reagieren
                let addedOurOwnNode = false;
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1 && (node.classList.contains(WRAPPER_CLASS) || node.closest(`.${WRAPPER_CLASS}`))) {
                        addedOurOwnNode = true;
                    }
                });

                if (!addedOurOwnNode) {
                    debouncedScan();
                    break;
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (GM_getValue(SETTING_KEY, true)) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', scanAndWrapISBNs);
        } else {
            setTimeout(scanAndWrapISBNs, 500);
        }
    }

})();