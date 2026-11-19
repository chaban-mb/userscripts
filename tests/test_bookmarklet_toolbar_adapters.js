'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Adapters = require('../lib/BookmarkletToolbarAdapters.js');

function createMockElement(tagName, className = '') {
    const el = {
        tagName: String(tagName || 'DIV').toUpperCase(),
        className,
        style: {
            cssText: '',
        },
        textContent: '',
        parentNode: null,
        children: [],
        appendChild(child) {
            if (child.parentNode) {
                child.parentNode.removeChild(child);
            }
            this.children.push(child);
            child.parentNode = this;
            if (typeof this._onAppendChild === 'function') {
                this._onAppendChild(child);
            }
            return child;
        },
        insertBefore(newNode, referenceNode) {
            if (!referenceNode) {
                return this.appendChild(newNode);
            }
            const refIdx = this.children.indexOf(referenceNode);
            if (refIdx === -1) {
                throw new Error('Reference node is not a child of this element');
            }
            if (newNode.parentNode) {
                newNode.parentNode.removeChild(newNode);
            }
            const targetIdx = this.children.indexOf(referenceNode);
            this.children.splice(targetIdx, 0, newNode);
            newNode.parentNode = this;
            return newNode;
        },
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx === -1) {
                throw new Error('Node to remove is not a child of this element');
            }
            this.children.splice(idx, 1);
            child.parentNode = null;
            return child;
        },
        remove() {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        },
        contains(target) {
            if (target === this) {
                return true;
            }
            return this.children.some((c) => (typeof c.contains === 'function' ? c.contains(target) : c === target));
        },
        querySelector(selector) {
            if (selector === '.search-container') {
                return this.children.find((c) => c.className === 'search-container') || null;
            }
            if (selector === '.links-container') {
                return this.children.find((c) => c.className === 'links-container') || null;
            }
            return null;
        },
    };
    return el;
}

function createMockMBDocument({ includeHeader = true, includeSearch = true } = {}) {
    const head = createMockElement('HEAD');
    const body = createMockElement('BODY');
    const documentElement = createMockElement('HTML');
    documentElement.appendChild(head);
    documentElement.appendChild(body);

    let header = null;
    let right = null;
    let topRow = null;
    let bottomRow = null;
    let linksContainer = null;
    let searchContainer = null;

    if (includeHeader) {
        header = createMockElement('DIV', 'header');
        right = createMockElement('DIV', 'right');
        topRow = createMockElement('DIV', 'top');
        bottomRow = createMockElement('DIV', 'bottom');
        linksContainer = createMockElement('DIV', 'links-container');
        linksContainer.textContent = 'User Links';
        bottomRow.textContent = 'Bottom Nav Links';

        topRow.appendChild(linksContainer);
        if (includeSearch) {
            searchContainer = createMockElement('DIV', 'search-container');
            searchContainer.textContent = 'Search Input';
            topRow.appendChild(searchContainer);
        }

        right.appendChild(topRow);
        right.appendChild(bottomRow);
        header.appendChild(right);
        body.appendChild(header);
    }

    const listeners = new Map();

    const doc = {
        head,
        body,
        documentElement,
        createElement(tag) {
            return createMockElement(tag);
        },
        querySelector(selector) {
            if (!includeHeader) {
                return null;
            }
            if (
                selector === 'div.header .right .top' ||
                selector === '.header .right .top'
            ) {
                return topRow;
            }
            if (
                selector === 'div.header .right .top .search-container' ||
                selector === '.header .right .top .search-container' ||
                selector === '.search-container'
            ) {
                return includeSearch ? searchContainer : null;
            }
            if (selector === '.header .right .top .links-container' || selector === '.links-container') {
                return linksContainer;
            }
            if (selector === '.header .bottom' || selector === 'div.header .bottom') {
                return bottomRow;
            }
            return null;
        },
        addEventListener(type, fn, options) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn, options) {
            if (listeners.has(type)) {
                listeners.get(type).delete(fn);
            }
        },
        dispatchEvent(event) {
            const set = listeners.get(event.type);
            if (set) {
                for (const fn of [...set]) {
                    fn(event);
                }
            }
        },
        _listeners: listeners,
        _elements: {
            header,
            right,
            topRow,
            bottomRow,
            linksContainer,
            searchContainer,
        },
    };

    return doc;
}

function createMockWindow() {
    const listeners = new Map();
    return {
        addEventListener(type, fn, options) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn, options) {
            if (listeners.has(type)) {
                listeners.get(type).delete(fn);
            }
        },
        dispatchEvent(event) {
            const set = listeners.get(event.type);
            if (set) {
                for (const fn of [...set]) {
                    fn(event);
                }
            }
        },
        _listeners: listeners,
    };
}

test('resolveMountAdapter selects musicbrainz adapter for *.musicbrainz.org and *.musicbrainz.eu when header DOM exists, and fallback otherwise', () => {
    const mbDoc = createMockMBDocument({ includeHeader: true, includeSearch: true });

    const a1 = Adapters.resolveMountAdapter('https://musicbrainz.org/release/abc', mbDoc);
    assert.equal(a1.id, 'musicbrainz');

    const a2 = Adapters.resolveMountAdapter('https://beta.musicbrainz.org/artist/abc', mbDoc);
    assert.equal(a2.id, 'musicbrainz');

    const a3 = Adapters.resolveMountAdapter('https://musicbrainz.eu/recording/123', mbDoc);
    assert.equal(a3.id, 'musicbrainz');

    // Non-MB site falls back even if similar DOM exists
    const ytAdapter = Adapters.resolveMountAdapter('https://www.youtube.com/watch?v=123', mbDoc);
    assert.equal(ytAdapter.id, 'fallback');

    // MB URL without .header .right .top (e.g. 502 error page) falls back to fallback adapter
    const errorPageDoc = createMockMBDocument({ includeHeader: false });
    const errAdapter = Adapters.resolveMountAdapter('https://musicbrainz.org/release/abc', errorPageDoc);
    assert.equal(errAdapter.id, 'fallback');

    // MB URL with .header .right .top but missing .search-container falls back
    const missingSearchDoc = createMockMBDocument({ includeHeader: true, includeSearch: false });
    const noSearchAdapter = Adapters.resolveMountAdapter('https://musicbrainz.org/release/abc', missingSearchDoc);
    assert.equal(noSearchAdapter.id, 'fallback');
});

test('musicbrainz.mount inserts host directly before .search-container without perturbing surrounding MB elements, is idempotent, and unmounts cleanly', () => {
    const doc = createMockMBDocument({ includeHeader: true, includeSearch: true });
    const { topRow, bottomRow, linksContainer, searchContainer } = doc._elements;
    const hostEl = createMockElement('DIV', 'bt-host');

    const mbAdapter = Adapters.resolveMountAdapter('https://musicbrainz.org/release/abc', doc);
    assert.equal(mbAdapter.id, 'musicbrainz');

    topRow.style.cssText = 'color: rgb(17, 24, 39);';
    topRow.style.display = 'block';

    mbAdapter.mount(doc, hostEl);

    // Order in .header .right .top must be: [linksContainer, hostEl, searchContainer]
    assert.deepEqual(topRow.children, [linksContainer, hostEl, searchContainer]);
    assert.equal(linksContainer.textContent, 'User Links');
    assert.equal(searchContainer.textContent, 'Search Input');
    assert.equal(bottomRow.textContent, 'Bottom Nav Links');

    // Flex styles applied on topRow and hostEl
    assert.equal(topRow.style.display, 'flex');
    assert.equal(topRow.style.alignItems, 'center');
    assert.equal(hostEl.style.display, 'inline-flex');
    assert.equal(hostEl.style.flex, '1 1 auto');
    assert.equal(hostEl.style.minWidth, '0');

    // Re-mounting is idempotent and does not overwrite the saved original topRow styles
    mbAdapter.mount(doc, hostEl);
    assert.deepEqual(topRow.children, [linksContainer, hostEl, searchContainer]);

    // Unmount removes hostEl cleanly and restores topRow's original inline style.cssText
    mbAdapter.unmount(doc, hostEl);
    assert.deepEqual(topRow.children, [linksContainer, searchContainer]);
    assert.equal(hostEl.parentNode, null);
    assert.equal(topRow.style.cssText, 'color: rgb(17, 24, 39);');
    assert.equal(topRow.style.display, 'block');
    assert.equal(topRow.style.alignItems, '');

    // Re-mounting after unmount restores exact position before .search-container
    mbAdapter.mount(doc, hostEl);
    assert.deepEqual(topRow.children, [linksContainer, hostEl, searchContainer]);
    assert.equal(topRow.style.display, 'flex');
});

test('fallback.mount attaches fixed bottom-right host to document.body or document.documentElement and unmounts cleanly', () => {
    const doc = createMockMBDocument({ includeHeader: false });
    const hostEl = createMockElement('DIV', 'bt-host');

    const fallbackAdapter = Adapters.resolveMountAdapter('https://www.youtube.com/', doc);
    assert.equal(fallbackAdapter.id, 'fallback');

    fallbackAdapter.mount(doc, hostEl);
    assert.equal(hostEl.parentNode, doc.body);
    assert.equal(hostEl.style.position, 'fixed');
    assert.equal(hostEl.style.right, '16px');
    assert.equal(hostEl.style.bottom, '16px');
    assert.equal(hostEl.style.zIndex, '2147483640');

    // Idempotent re-mount
    fallbackAdapter.mount(doc, hostEl);
    assert.equal(doc.body.children.filter((c) => c === hostEl).length, 1);

    // Unmount removes cleanly
    fallbackAdapter.unmount(doc, hostEl);
    assert.equal(hostEl.parentNode, null);
    assert.equal(doc.body.children.includes(hostEl), false);

    // Fallback to document.documentElement when document.body is missing
    const bodylessDoc = {
        head: null,
        body: null,
        documentElement: createMockElement('HTML'),
    };
    fallbackAdapter.mount(bodylessDoc, hostEl);
    assert.equal(hostEl.parentNode, bodylessDoc.documentElement);
    fallbackAdapter.unmount(bodylessDoc, hostEl);
    assert.equal(hostEl.parentNode, null);
});

test('executeScriptInPage injects normalized inline <script>, removes it immediately, and surfaces CSP or runtime errors via onError', () => {
    const doc = createMockMBDocument({ includeHeader: false });
    const win = createMockWindow();

    const appendedScripts = [];
    doc.head._onAppendChild = (scriptEl) => {
        appendedScripts.push({
            tagName: scriptEl.tagName,
            textContent: scriptEl.textContent,
            parentDuringAppend: scriptEl.parentNode,
        });
    };

    const errors = [];
    const res1 = Adapters.executeScriptInPage(
        'javascript:(function()%7Bconst%20x%20%3D%2010%20%25%203%3B%20window.__ran%20%3D%20x%3B%7D)()',
        {
            doc,
            win,
            onError: (msg) => errors.push(msg),
        }
    );

    assert.deepEqual(res1, { ok: true });
    assert.equal(errors.length, 0);
    assert.equal(appendedScripts.length, 1);
    assert.equal(appendedScripts[0].tagName, 'SCRIPT');
    assert.equal(
        appendedScripts[0].textContent,
        '(function(){const x = 10 % 3; window.__ran = x;})()'
    );
    assert.equal(appendedScripts[0].parentDuringAppend, doc.head);
    // Script element is removed immediately after execution
    assert.equal(doc.head.children.length, 0);

    // Simulate CSP securitypolicyviolation during synchronous <script> insertion
    doc.head._onAppendChild = () => {
        doc.dispatchEvent({
            type: 'securitypolicyviolation',
            blockedURI: 'inline',
            violatedDirective: 'script-src-elem',
            effectiveDirective: 'script-src-elem',
        });
    };

    const cspErrors = [];
    const resCsp = Adapters.executeScriptInPage('javascript:alert(1)', {
        doc,
        win,
        onError: (msg) => cspErrors.push(msg),
    });

    assert.equal(resCsp.ok, false);
    assert.match(resCsp.error, /CSP|Content Security Policy|script-src/i);
    assert.equal(cspErrors.length, 1);
    assert.equal(cspErrors[0], resCsp.error);
    assert.equal(doc.head.children.length, 0);
    // Temporary listeners are cleaned up
    assert.equal(doc._listeners.get('securitypolicyviolation')?.size || 0, 0);
    assert.equal(win._listeners.get('error')?.size || 0, 0);

    // Simulate synchronous window error event during <script> execution
    doc.head._onAppendChild = () => {
        win.dispatchEvent({
            type: 'error',
            message: 'Uncaught ReferenceError: foo is not defined',
        });
    };

    const runtimeErrors = [];
    const resErr = Adapters.executeScriptInPage('javascript:foo()', {
        doc,
        win,
        onError: (msg) => runtimeErrors.push(msg),
    });

    assert.equal(resErr.ok, false);
    assert.match(resErr.error, /ReferenceError: foo is not defined/);
    assert.equal(runtimeErrors.length, 1);
    assert.equal(runtimeErrors[0], resErr.error);
    assert.equal(doc.head.children.length, 0);
});

test('executeScriptInPage captures asynchronous securitypolicyviolation queued by Blink after appendChild returns', async () => {
    const doc = createMockMBDocument({ includeHeader: false });
    const win = createMockWindow();

    doc.head._onAppendChild = () => {
        setTimeout(() => {
            doc.dispatchEvent({
                type: 'securitypolicyviolation',
                blockedURI: 'inline',
                violatedDirective: 'script-src-elem',
                effectiveDirective: 'script-src-elem',
            });
        }, 5);
    };

    const asyncCspErrors = [];
    Adapters.executeScriptInPage('javascript:window.__blocked=1', {
        doc,
        win,
        onError: (msg) => asyncCspErrors.push(msg),
    });

    await new Promise((r) => setTimeout(r, 25));

    assert.equal(asyncCspErrors.length, 1);
    assert.match(asyncCspErrors[0], /Blocked by page Content Security Policy \(script-src-elem\)/);
    assert.equal(doc._listeners.get('securitypolicyviolation')?.size || 0, 0);
});

test('executeScriptInPage catches Trusted Types TypeError on scriptEl.textContent assignment, cleans up listeners, and ignores non-script CSP violations', () => {
    const doc = createMockMBDocument({ includeHeader: false });
    const win = createMockWindow();

    // Unrelated img-src CSP violation with empty blockedURI is ignored
    doc.head._onAppendChild = () => {
        doc.dispatchEvent({
            type: 'securitypolicyviolation',
            blockedURI: '',
            violatedDirective: 'img-src',
            effectiveDirective: 'img-src',
        });
    };
    const imgErrors = [];
    const resImg = Adapters.executeScriptInPage('javascript:void 0', {
        doc,
        win,
        onError: (msg) => imgErrors.push(msg),
    });
    assert.deepEqual(resImg, { ok: true });
    assert.equal(imgErrors.length, 0);

    // Simulate Trusted Types TypeError thrown when assigning string to scriptEl.textContent
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
        const el = origCreateElement(tag);
        if (String(tag).toUpperCase() === 'SCRIPT') {
            Object.defineProperty(el, 'textContent', {
                get() {
                    return '';
                },
                set() {
                    throw new TypeError("Failed to set the 'textContent' property on 'Node': This document requires 'TrustedScript' assignment.");
                },
            });
        }
        return el;
    };

    const ttErrors = [];
    const resTt = Adapters.executeScriptInPage('javascript:alert(1)', {
        doc,
        win,
        onError: (msg) => ttErrors.push(msg),
    });

    assert.equal(resTt.ok, false);
    assert.match(resTt.error, /TrustedScript/);
    assert.equal(ttErrors.length, 1);
    assert.equal(ttErrors[0], resTt.error);
    assert.equal(doc.head.children.length, 0);
    assert.equal(doc._listeners.get('securitypolicyviolation')?.size || 0, 0);
    assert.equal(win._listeners.get('error')?.size || 0, 0);
});
