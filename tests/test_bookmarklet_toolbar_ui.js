'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const UI = require('../lib/BookmarkletToolbarUI.js');

function createDomEnvironment(initialUrl = 'https://musicbrainz.org/release/123/edit') {
    class MockClassList {
        constructor(el) {
            this._el = el;
            this._set = new Set();
        }
        _syncFromAttr(str) {
            this._set.clear();
            for (const token of String(str || '').split(/\s+/).filter(Boolean)) {
                this._set.add(token);
            }
        }
        _syncToAttr() {
            this._el._className = [...this._set].join(' ');
        }
        add(...tokens) {
            for (const t of tokens) {
                if (t) {
                    this._set.add(t);
                }
            }
            this._syncToAttr();
        }
        remove(...tokens) {
            for (const t of tokens) {
                this._set.delete(t);
            }
            this._syncToAttr();
        }
        toggle(token, force) {
            const shouldHave = force !== undefined ? Boolean(force) : !this._set.has(token);
            if (shouldHave) {
                this._set.add(token);
            } else {
                this._set.delete(token);
            }
            this._syncToAttr();
            return shouldHave;
        }
        contains(token) {
            return this._set.has(token);
        }
    }

    function matchesSimpleSelector(el, sel) {
        if (!el || el.nodeType !== 1) {
            return false;
        }
        const trimmed = sel.trim();
        if (!trimmed) {
            return false;
        }
        if (trimmed.startsWith('#') && !trimmed.includes(' ') && !trimmed.includes('.') && !trimmed.includes('[')) {
            return el.id === trimmed.slice(1);
        }
        if (trimmed.startsWith('.') && !trimmed.includes(' ') && !trimmed.includes('[')) {
            return el.classList.contains(trimmed.slice(1));
        }
        const attrMatch = trimmed.match(/^([a-z0-9_-]+)?\[([a-z0-9_-]+)(?:="([^"]*)")?\]$/i);
        if (attrMatch) {
            const [, tagPart, attrName, attrVal] = attrMatch;
            if (tagPart && el.tagName !== tagPart.toUpperCase()) {
                return false;
            }
            const actualVal = el.getAttribute(attrName);
            if (attrVal === undefined) {
                return actualVal !== null;
            }
            return actualVal === attrVal;
        }
        if (/^[a-z0-9-]+$/i.test(trimmed)) {
            return el.tagName === trimmed.toUpperCase();
        }
        return false;
    }

    function queryAllInSubtree(root, selector) {
        const selectors = String(selector)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const results = [];
        function walk(node) {
            for (const child of node.children || []) {
                if (selectors.some((sel) => matchesSimpleSelector(child, sel))) {
                    results.push(child);
                }
                walk(child);
            }
        }
        walk(root);
        return results;
    }

    class MockNode {
        constructor() {
            this.parentNode = null;
            this.children = [];
            this._listeners = new Map();
        }
        get firstChild() {
            return this.children[0] || null;
        }
        replaceChildren(...nodes) {
            for (const child of [...this.children]) {
                child.parentNode = null;
            }
            this.children.length = 0;
            this.append(...nodes);
        }
        appendChild(child) {
            if (!child) {
                return child;
            }
            if (child.parentNode) {
                child.parentNode.removeChild(child);
            }
            this.children.push(child);
            child.parentNode = this;
            return child;
        }
        append(...nodes) {
            for (const node of nodes) {
                if (typeof node === 'string') {
                    const span = createMockElement('SPAN');
                    span.textContent = node;
                    this.appendChild(span);
                } else if (node) {
                    this.appendChild(node);
                }
            }
        }
        insertBefore(newNode, refNode) {
            if (!refNode) {
                return this.appendChild(newNode);
            }
            const idx = this.children.indexOf(refNode);
            if (idx === -1) {
                return this.appendChild(newNode);
            }
            if (newNode.parentNode) {
                newNode.parentNode.removeChild(newNode);
            }
            const targetIdx = this.children.indexOf(refNode);
            this.children.splice(targetIdx, 0, newNode);
            newNode.parentNode = this;
            return newNode;
        }
        removeChild(child) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) {
                this.children.splice(idx, 1);
                child.parentNode = null;
            }
            return child;
        }
        remove() {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        }
        contains(target) {
            if (!target) {
                return false;
            }
            if (target === this) {
                return true;
            }
            return this.children.some((c) => (typeof c.contains === 'function' ? c.contains(target) : c === target));
        }
        querySelector(selector) {
            return queryAllInSubtree(this, selector)[0] || null;
        }
        querySelectorAll(selector) {
            return queryAllInSubtree(this, selector);
        }
        addEventListener(type, fn) {
            if (!this._listeners.has(type)) {
                this._listeners.set(type, new Set());
            }
            this._listeners.get(type).add(fn);
        }
        removeEventListener(type, fn) {
            if (this._listeners.has(type)) {
                this._listeners.get(type).delete(fn);
            }
        }
        dispatchEvent(rawEvent) {
            const path = [];
            let curr = this;
            while (curr) {
                path.push(curr);
                if (curr.parentNode) {
                    curr = curr.parentNode;
                } else if (curr.host) {
                    curr = curr.host;
                } else {
                    break;
                }
            }
            if (doc && !path.includes(doc)) {
                path.push(doc);
            }
            if (win && !path.includes(win)) {
                path.push(win);
            }

            let propagationStopped = false;
            let defaultPrevented = false;
            const event = {
                ...rawEvent,
                target: rawEvent.target || this,
                currentTarget: this,
                 get defaultPrevented() {
                    return defaultPrevented;
                },
                preventDefault() {
                    defaultPrevented = true;
                    if (typeof rawEvent.preventDefault === 'function') {
                        rawEvent.preventDefault();
                    }
                },
                stopPropagation() {
                    propagationStopped = true;
                    if (typeof rawEvent.stopPropagation === 'function') {
                        rawEvent.stopPropagation();
                    }
                },
                composedPath() {
                    return path;
                },
            };

            const bubbles = rawEvent.bubbles !== undefined ? Boolean(rawEvent.bubbles) : true;
            const targets = bubbles ? path : [this];

            for (const node of targets) {
                if (propagationStopped) {
                    break;
                }
                event.currentTarget = node;
                const propHandler = node[`on${event.type}`];
                if (typeof propHandler === 'function') {
                    propHandler(event);
                }
                const set = node._listeners && node._listeners.get(event.type);
                if (set) {
                    for (const fn of [...set]) {
                        if (propagationStopped) {
                            break;
                        }
                        fn(event);
                    }
                }
            }
            return !defaultPrevented;
        }
    }

    class MockShadowRoot extends MockNode {
        constructor(host, mode) {
            super();
            this.nodeType = 11;
            this.host = host;
            this.mode = mode;
        }
        getElementById(id) {
            return this.querySelector(`#${id}`);
        }
        elementFromPoint() {
            return null;
        }
    }

    class MockElement extends MockNode {
        constructor(tagName) {
            super();
            this.nodeType = 1;
            this.tagName = String(tagName || 'DIV').toUpperCase();
            this.id = '';
            this._className = '';
            this.classList = new MockClassList(this);
            this.style = { cssText: '' };
            this.dataset = new Proxy(
                {},
                {
                    set: (obj, prop, val) => {
                        obj[prop] = String(val);
                        const attr =
                            'data-' +
                            String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
                        this._attrs.set(attr, String(val));
                        return true;
                    },
                    deleteProperty: (obj, prop) => {
                        delete obj[prop];
                        const attr =
                            'data-' +
                            String(prop).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
                        this._attrs.delete(attr);
                        return true;
                    },
                }
            );
            this._attrs = new Map();
            this._textContent = '';
            this._innerHTML = '';
            this.value = '';
            this.checked = false;
            this.type = '';
            this.placeholder = '';
            this.title = '';
            this.draggable = false;
            this.shadowRoot = null;
            this.ownerDocument = null;
            this._rect = { left: 0, top: 0, width: 100, height: 28 };
            this._capturedPointers = new Set();
        }
        setPointerCapture(pointerId) {
            this._capturedPointers.add(pointerId);
        }
        releasePointerCapture(pointerId) {
            this._capturedPointers.delete(pointerId);
        }
        hasPointerCapture(pointerId) {
            return this._capturedPointers.has(pointerId);
        }
        get className() {
            return this._className;
        }
        set className(val) {
            this._className = String(val || '');
            this.classList._syncFromAttr(this._className);
        }
        get textContent() {
            if (this.children.length > 0) {
                return (
                    (this._textContent || '') +
                    this.children.map((c) => c.textContent || '').join('')
                );
            }
            return this._textContent;
        }
        set textContent(val) {
            this.children = [];
            this._textContent = String(val ?? '');
        }
        get innerHTML() {
            return this._innerHTML;
        }
        set innerHTML(val) {
            this._innerHTML = String(val ?? '');
            if (val === '') {
                this.children = [];
                this._textContent = '';
            }
        }
        setAttribute(name, value) {
            const strVal = String(value);
            this._attrs.set(name, strVal);
            if (name === 'id') {
                this.id = strVal;
            } else if (name === 'class') {
                this.className = strVal;
            } else if (name.startsWith('data-')) {
                const camel = name
                    .slice(5)
                    .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                this.dataset[camel] = strVal;
            }
        }
        getAttribute(name) {
            if (name === 'id') {
                return this.id || null;
            }
            if (name === 'class') {
                return this._className || null;
            }
            return this._attrs.has(name) ? this._attrs.get(name) : null;
        }
        removeAttribute(name) {
            this._attrs.delete(name);
            if (name === 'id') {
                this.id = '';
            }
        }
        attachShadow({ mode = 'open' } = {}) {
            const sr = new MockShadowRoot(this, mode);
            if (mode === 'open') {
                this.shadowRoot = sr;
            }
            return sr;
        }
        getBoundingClientRect() {
            return this._rect;
        }
        focus() {
            if (this.ownerDocument) {
                this.ownerDocument.activeElement = this;
            }
        }
        select() {}
        scrollIntoView(options) {
            this._lastScrollIntoView = options || true;
        }
        click() {
            this.dispatchEvent({ type: 'click', bubbles: true });
        }
    }

    let doc;
    function createMockElement(tag) {
        const el = new MockElement(tag);
        el.ownerDocument = doc;
        return el;
    }

    const winListeners = new Map();
    const win = {
        location: { href: initialUrl },
        innerWidth: 1280,
        innerHeight: 720,
        _listeners: winListeners,
        addEventListener(type, fn) {
            if (!winListeners.has(type)) {
                winListeners.set(type, new Set());
            }
            winListeners.get(type).add(fn);
        },
        removeEventListener(type, fn) {
            if (winListeners.has(type)) {
                winListeners.get(type).delete(fn);
            }
        },
        dispatchEvent(event) {
            const set = winListeners.get(event.type);
            if (set) {
                for (const fn of [...set]) {
                    fn(event);
                }
            }
        },
    };

    doc = new MockNode();
    doc.defaultView = win;
    doc.activeElement = null;
    doc.createElement = createMockElement;
    doc.createElementNS = (ns, tag) => {
        const el = createMockElement(tag);
        el.namespaceURI = ns;
        return el;
    };
    doc.elementFromPoint = () => null;
    doc.head = createMockElement('HEAD');
    doc.body = createMockElement('BODY');
    doc.documentElement = createMockElement('HTML');
    doc.documentElement.appendChild(doc.head);
    doc.documentElement.appendChild(doc.body);
    doc.appendChild(doc.documentElement);

    return { doc, win, createMockElement };
}

function createSampleState(overrides = {}) {
    return {
        url: 'https://musicbrainz.org/release/123/edit',
        settings: { hotkey: 'Alt+B' },
        packs: {
            'chaban-bookmarklets': {
                id: 'chaban-bookmarklets',
                name: 'MusicBrainz Bookmarklets',
                version: '2026.11.19',
                description: 'MB bookmarklets pack',
                homepage: 'https://github.com/chaban-mb/bookmarklets',
                scripts: {
                    'pack:chaban-bookmarklets/approve_all': {
                        id: 'pack:chaban-bookmarklets/approve_all',
                        packId: 'chaban-bookmarklets',
                        source: 'pack:chaban-bookmarklets',
                        name: 'Approve all edits',
                        label: 'Approve All',
                        description: 'Approves all edits on page',
                        match: ['*://*.musicbrainz.org/*'],
                        code: 'void 0;',
                        removed: false,
                    },
                    'pack:chaban-bookmarklets/pseudo_release': {
                        id: 'pack:chaban-bookmarklets/pseudo_release',
                        packId: 'chaban-bookmarklets',
                        source: 'pack:chaban-bookmarklets',
                        name: 'Convert to pseudo-release',
                        label: 'Pseudo-release',
                        description: 'Pseudo-release helper',
                        match: ['*://*.musicbrainz.org/release/*'],
                        code: 'void 0;',
                        removed: false,
                    },
                    'pack:chaban-bookmarklets/old_removed': {
                        id: 'pack:chaban-bookmarklets/old_removed',
                        packId: 'chaban-bookmarklets',
                        source: 'pack:chaban-bookmarklets',
                        name: 'Legacy Helper',
                        label: 'Legacy',
                        description: 'Removed from pack',
                        match: ['*://*.musicbrainz.org/*'],
                        code: 'void 0;',
                        removed: true,
                    },
                },
            },
        },
        localScripts: {
            'local:tracklist': {
                id: 'local:tracklist',
                source: 'local',
                name: 'Move to Tracklist',
                description: 'Jump to tracklist tab',
                match: ['*://*.musicbrainz.org/release/*'],
                code: 'void 0;',
            },
        },
        layout: [
            { type: 'script', scriptId: 'pack:chaban-bookmarklets/approve_all' },
            { type: 'script', scriptId: 'pack:chaban-bookmarklets/old_removed' },
            {
                type: 'folder',
                id: 'folder:edit',
                name: 'Edit',
                items: [
                    { type: 'script', scriptId: 'pack:chaban-bookmarklets/pseudo_release' },
                    { type: 'script', scriptId: 'local:tracklist', label: 'mv t' },
                ],
            },
        ],
        recents: {
            'pack:chaban-bookmarklets/approve_all': { lastRunAt: 1700000000000, count: 3 },
        },
        ...overrides,
    };
}

test('Overlay Shadow DOM mounts independently when openPalette() or openManager() is called with toolbarMounted = false', () => {
    const { doc, win } = createDomEnvironment('https://example.com/unmatched');
    const state = createSampleState({
        url: 'https://example.com/unmatched',
    });

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: state,
        callbacks: {},
    });

    // Toolbar must NOT mount because 0 placed scripts match example.com
    assert.equal(ui.isToolbarMounted(), false);
    assert.equal(doc.querySelector('#userjs-bt-toolbar-host'), null);
    assert.equal(doc.querySelector('#userjs-bt-overlay-host'), null);

    // Calling openPalette() lazily mounts the overlay Shadow DOM host even while toolbar stays unmounted
    ui.openPalette();
    assert.equal(ui.isToolbarMounted(), false);
    assert.equal(doc.querySelector('#userjs-bt-toolbar-host'), null);

    const overlayHost = doc.querySelector('#userjs-bt-overlay-host');
    assert.ok(overlayHost, 'Expected overlay host to be mounted on document.body');
    assert.ok(overlayHost.shadowRoot, 'Expected overlay host to have an open shadowRoot');

    const paletteBackdrop = overlayHost.shadowRoot.getElementById('palette-backdrop');
    assert.ok(paletteBackdrop);
    assert.equal(paletteBackdrop.classList.contains('hidden'), false);

    // Calling openManager() switches to Manager modal inside the overlay Shadow DOM while toolbar stays unmounted
    ui.openManager();
    assert.equal(ui.isToolbarMounted(), false);
    const managerBackdrop = overlayHost.shadowRoot.getElementById('manager-backdrop');
    assert.ok(managerBackdrop);
    assert.equal(managerBackdrop.classList.contains('hidden'), false);
    assert.equal(paletteBackdrop.classList.contains('hidden'), true);

    ui.destroy();
});

test('Escape inside an active inline edit pill calls stopPropagation() and cancels only that inline pill without closing the Manager modal', () => {
    const { doc, win } = createDomEnvironment();
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState(),
        callbacks: {},
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const managerBackdrop = overlayRoot.getElementById('manager-backdrop');
    assert.equal(managerBackdrop.classList.contains('hidden'), false);

    // Click "+ Folder" button to activate inline edit pill inside the sticky toolbar strip
    const addFolderBtn = overlayRoot.querySelector('[data-action="add-folder"]');
    assert.ok(addFolderBtn, 'Expected + Folder button in sticky toolbar strip');
    addFolderBtn.click();

    const inlineInput = overlayRoot.querySelector('.bt-inline-edit-input');
    assert.ok(inlineInput, 'Expected inline edit input to appear after clicking + Folder');

    let stopPropagationCalled = false;
    inlineInput.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        bubbles: true,
        stopPropagation() {
            stopPropagationCalled = true;
        },
    });

    assert.equal(stopPropagationCalled, true, 'Escape inside inline edit pill must call stopPropagation()');
    // Inline edit pill is cancelled and replaced by "+ Folder" button again
    assert.equal(overlayRoot.querySelector('.bt-inline-edit-input'), null);
    assert.ok(overlayRoot.querySelector('[data-action="add-folder"]'));
    // Manager modal MUST still be open!
    assert.equal(managerBackdrop.classList.contains('hidden'), false);

    // Pressing Escape when no inline edit pill or sub-modal is open closes the Manager modal
    overlayRoot.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        bubbles: true,
    });
    assert.equal(managerBackdrop.classList.contains('hidden'), true);

    ui.destroy();
});

test('bindDropTarget separates neutral self-hover from disallowed folder nesting, uses single property assignment, and checks relatedTarget safely across contains()', () => {
    const { doc } = createDomEnvironment();
    const root = doc.createElement('DIV');
    const hintEl = doc.createElement('SPAN');
    hintEl.id = 'drag-hint';
    hintEl.textContent = UI.DEFAULT_DRAG_HINT;
    root.appendChild(hintEl);

    const dropEl = doc.createElement('DIV');
    const childSpan = doc.createElement('SPAN');
    dropEl.appendChild(childSpan);
    root.appendChild(dropEl);

    const dragState = {
        dragPayload: null,
        activeDropKey: null,
        activeDropStyle: null,
    };

    let resolveCalls = 0;
    const resolver = (payload) => {
        resolveCalls += 1;
        if (payload.kind === 'folder-item' && payload.selfHover) {
            return null;
        }
        if (payload.kind === 'toolbar-folder') {
            return { blocked: true, hint: 'Folders cannot be nested inside folders' };
        }
        return {
            style: 'drop-active-folder',
            hint: 'Move to end of folder "Edit"',
            accept: () => {},
        };
    };

    // Call bindDropTarget multiple times to simulate repeated render() calls — must overwrite ondragover/ondragleave/ondrop, never stack listeners
    UI.bindDropTarget(dropEl, 'drawer-folder:edit', resolver, { root, dragState });
    UI.bindDropTarget(dropEl, 'drawer-folder:edit', resolver, { root, dragState });

    // 1. Neutral self-hover returns null -> dropEffect = 'none', default hint, no blocked class
    dragState.dragPayload = { kind: 'folder-item', selfHover: true };
    const dt1 = { dropEffect: 'move' };
    dropEl.ondragover({
        dataTransfer: dt1,
        preventDefault() {},
        stopPropagation() {},
    });
    assert.equal(resolveCalls, 1, 'Expected single ondragover handler invocation (no listener stacking)');
    assert.equal(dt1.dropEffect, 'none');
    assert.equal(hintEl.textContent, UI.DEFAULT_DRAG_HINT);
    assert.equal(hintEl.classList.contains('bt-hint-blocked'), false);
    assert.equal(dropEl.classList.contains('drop-active-folder'), false);

    // 2. Disallowed folder nesting returns { blocked: true } -> displays explicit blocked message, and ondragleave clears it when leaving the drawer
    dragState.dragPayload = { kind: 'toolbar-folder', folderId: 'folder:other', index: 2 };
    const dt2 = { dropEffect: 'move' };
    dropEl.ondragover({
        dataTransfer: dt2,
        preventDefault() {},
        stopPropagation() {},
    });
    assert.equal(dt2.dropEffect, 'none');
    assert.equal(hintEl.textContent, 'Folders cannot be nested inside folders');
    assert.equal(hintEl.classList.contains('bt-hint-blocked'), true);
    assert.equal(dropEl.classList.contains('drop-active-folder'), false);
    assert.equal(dragState.activeHintKey, 'drawer-folder:edit');

    const outsideBlockedEl = doc.createElement('DIV');
    root.appendChild(outsideBlockedEl);
    dropEl.ondragleave({
        relatedTarget: outsideBlockedEl,
        stopPropagation() {},
    });
    assert.equal(hintEl.textContent, UI.DEFAULT_DRAG_HINT);
    assert.equal(hintEl.classList.contains('bt-hint-blocked'), false);
    assert.equal(dragState.activeHintKey, null);

    // 3. Valid drop target sets drop-active-folder and active hint, and relatedTarget inside dropEl does NOT prematurely clear feedback
    dragState.dragPayload = { kind: 'library-script', scriptId: 'local:tracklist' };
    const dt3 = { dropEffect: 'none' };
    dropEl.ondragover({
        dataTransfer: dt3,
        preventDefault() {},
        stopPropagation() {},
    });
    assert.equal(dt3.dropEffect, 'move');
    assert.equal(dropEl.classList.contains('drop-active-folder'), true);
    assert.equal(hintEl.textContent, 'Move to end of folder "Edit"');

    // Dragleave into a child node (contains(relatedTarget) === true) or null relatedTarget must NOT clear active drop state
    dropEl.ondragleave({
        relatedTarget: childSpan,
        stopPropagation() {},
    });
    assert.equal(dropEl.classList.contains('drop-active-folder'), true);

    dropEl.ondragleave({
        relatedTarget: null,
        stopPropagation() {},
    });
    assert.equal(dropEl.classList.contains('drop-active-folder'), true);

    // Dragleave to an outside element clears feedback
    const outsideEl = doc.createElement('DIV');
    root.appendChild(outsideEl);
    dropEl.ondragleave({
        relatedTarget: outsideEl,
        stopPropagation() {},
    });
    assert.equal(dropEl.classList.contains('drop-active-folder'), false);
    assert.equal(hintEl.textContent, UI.DEFAULT_DRAG_HINT);
});

test('Library cards do NOT render any <select> folder chooser, and clicking a 📁 <Folder> status badge selects that folder in the sticky drawer', () => {
    const { doc, win } = createDomEnvironment();
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState(),
        callbacks: {},
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const libraryGrid = overlayRoot.getElementById('library-grid');
    assert.ok(libraryGrid);

    // Verify zero <select> elements exist anywhere in the Library cards
    const selectEls = libraryGrid.querySelectorAll('select');
    assert.equal(selectEls.length, 0, 'Library cards must not contain any <select> folder dropdown');

    // Initially close folder drawer if open by clicking the selected folder pill, or verify clicking 📁 Edit badge opens it
    const selectedPill = overlayRoot.querySelector('[data-folder-pill="folder:edit"]');
    assert.ok(selectedPill);
    // Click folder pill to close drawer first
    selectedPill.click();
    const drawer = overlayRoot.getElementById('folder-drawer');
    assert.equal(drawer.classList.contains('hidden'), true);

    // Now click the "📁 Edit" badge on a Library card placed inside folder:edit
    const folderBadgeBtn = libraryGrid.querySelector('[data-folder-badge="folder:edit"]');
    assert.ok(folderBadgeBtn, 'Expected clickable 📁 Edit badge on folder-placed Library card');
    assert.match(folderBadgeBtn.textContent, /📁\s*Edit/);
    folderBadgeBtn.click();

    // Clicking the badge must open the sticky folder drawer for folder:edit
    assert.equal(drawer.classList.contains('hidden'), false);
    assert.match(drawer.textContent, /📁\s*Edit/);

    ui.destroy();
});

test('Toolbar renders displayLabel, ⚠ indicator for removed scripts, folder dropdowns, and ⌘ amber badge', () => {
    const { doc, win } = createDomEnvironment();
    const ranScripts = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            settings: {
                hotkey: 'Alt+B',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
            },
        }),
        callbacks: {
            onRunScript(scriptId) {
                ranScripts.push(scriptId);
            },
        },
    });

    assert.equal(ui.isToolbarMounted(), true);
    const toolbarRoot = ui.getToolbarShadowRoot();
    assert.ok(toolbarRoot);

    const buttons = toolbarRoot.querySelectorAll('button');
    const labels = buttons.map((b) => b.textContent);
    assert.ok(labels.some((t) => t.includes('Approve All')));
    assert.ok(labels.some((t) => t.includes('Legacy ⚠')));
    assert.ok(labels.some((t) => t.includes('Edit ▾')));

    // ⌘ utility button shows amber dot because old_removed is placed in layout
    const removedDot = toolbarRoot.querySelector('[data-removed-badge="true"]');
    assert.ok(removedDot, 'Expected amber dot indicator on ⌘ button when removed script is placed');

    // Clicking folder button opens dropdown; clicking item executes script and closes dropdown
    const folderBtn = buttons.find((b) => b.textContent.includes('Edit ▾'));
    folderBtn.click();

    const dropdownItems = toolbarRoot.querySelectorAll('.bt-dropdown-item');
    assert.equal(dropdownItems.length, 2);
    assert.equal(dropdownItems[0].textContent, 'Pseudo-release');
    assert.equal(dropdownItems[1].textContent, 'mv t');

    dropdownItems[1].click();
    assert.deepEqual(ranScripts, ['local:tracklist']);
    assert.equal(toolbarRoot.querySelectorAll('.bt-dropdown-item').length, 0);

    ui.destroy();
});

test('Command Palette groups Recently Run, Matching Library, and searchable Open Settings action with ArrowDown/ArrowUp/Enter navigation', () => {
    const { doc, win } = createDomEnvironment();
    const ranScripts = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState(),
        callbacks: {
            onRunScript(scriptId) {
                ranScripts.push(scriptId);
            },
        },
    });

    ui.openPalette();
    const overlayRoot = ui.getOverlayShadowRoot();
    const paletteList = overlayRoot.getElementById('palette-list');
    const searchInput = overlayRoot.getElementById('palette-search');

    const groupHeaders = paletteList.querySelectorAll('.bt-palette-group').map((g) => g.textContent);
    assert.deepEqual(groupHeaders, ['Recently Run', 'Matching Library', 'Actions']);

    const items = paletteList.querySelectorAll('.bt-palette-item');
    assert.ok(items.length >= 6);
    assert.equal(items[0].classList.contains('bt-palette-item-active'), true);

    // ArrowDown moves selection to index 1, calls scrollIntoView on the active item, and Enter runs that script
    searchInput.dispatchEvent({ type: 'keydown', key: 'ArrowDown', bubbles: true });
    const updatedItems = paletteList.querySelectorAll('.bt-palette-item');
    assert.equal(updatedItems[1].classList.contains('bt-palette-item-active'), true);
    assert.deepEqual(updatedItems[1]._lastScrollIntoView, { block: 'nearest' });

    searchInput.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true });
    assert.equal(ranScripts.length, 1);
    assert.equal(overlayRoot.getElementById('palette-backdrop').classList.contains('hidden'), true);

    // Re-open palette, filter for "manager", press Enter to open Manager
    ui.openPalette();
    searchInput.value = 'open manager';
    searchInput.dispatchEvent({ type: 'input', bubbles: true });

    const filteredItems = paletteList.querySelectorAll('.bt-palette-item');
    assert.equal(filteredItems.length, 1);
    assert.match(filteredItems[0].textContent, /Open Manager/);

    searchInput.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true });
    assert.equal(overlayRoot.getElementById('manager-backdrop').classList.contains('hidden'), false);

    ui.destroy();
});

test('Manager supports Editor modal prefill/validation, In-UI Delete Confirmation, Convert orphaned script, Export/Import, and Hotkey recording', () => {
    const { doc, win } = createDomEnvironment();
    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState(),
        callbacks: {
            onStateChange(partial) {
                stateChanges.push(partial);
            },
        },
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();

    // 1. Single pack displays "Pack v2026.11.19"
    assert.equal(overlayRoot.getElementById('pack-badge-label').textContent, 'Pack v2026.11.19');

    // 2. Convert orphaned pack script to local script
    const oldCard = overlayRoot.querySelector('[data-library-card="pack:chaban-bookmarklets/old_removed"]');
    assert.ok(oldCard);
    const convertBtn = oldCard.querySelectorAll('button').find((b) => b.textContent === 'Convert');
    assert.ok(convertBtn);
    convertBtn.click();
    assert.ok(overlayRoot.querySelector('[data-library-card="local:old_removed"]'));

    // 2b. Editing a converted local script via saveEditorForm preserves its default label property
    const convertedForEdit = overlayRoot.querySelector('[data-library-card="local:old_removed"]');
    const editConvertedBtn = convertedForEdit.querySelectorAll('button').find((b) => b.textContent === '✎');
    assert.ok(editConvertedBtn);
    editConvertedBtn.click();
    assert.equal(overlayRoot.getElementById('editor-backdrop').classList.contains('hidden'), false);
    overlayRoot.getElementById('ed-desc').value = 'Updated converted description';
    overlayRoot.getElementById('editor-form').dispatchEvent({ type: 'submit', bubbles: true });
    assert.equal(overlayRoot.getElementById('editor-backdrop').classList.contains('hidden'), true);
    const latestLocalChange = stateChanges.filter((c) => c.localScripts).pop();
    assert.ok(latestLocalChange);
    assert.equal(latestLocalChange.localScripts['local:old_removed'].label, 'Legacy');
    assert.equal(latestLocalChange.localScripts['local:old_removed'].description, 'Updated converted description');

    // 3. Delete local script via In-UI Delete Confirmation Modal (never window.confirm), with Cancel button support
    const convertedCard = overlayRoot.querySelector('[data-library-card="local:old_removed"]');
    const deleteBtn = convertedCard.querySelectorAll('button').find((b) => b.textContent === '🗑');
    deleteBtn.click();

    const confirmBackdrop = overlayRoot.getElementById('confirm-backdrop');
    assert.equal(confirmBackdrop.classList.contains('hidden'), false);
    assert.match(overlayRoot.getElementById('confirm-title').textContent, /Delete Local Script/);
    // Clicking Cancel dismisses confirm modal without deleting
    overlayRoot.getElementById('confirm-cancel').click();
    assert.equal(confirmBackdrop.classList.contains('hidden'), true);
    assert.ok(overlayRoot.querySelector('[data-library-card="local:old_removed"]'));
    // Re-open confirm modal and click Delete
    overlayRoot
        .querySelector('[data-library-card="local:old_removed"]')
        .querySelectorAll('button')
        .find((b) => b.textContent === '🗑')
        .click();
    overlayRoot.getElementById('confirm-action').click();
    assert.equal(confirmBackdrop.classList.contains('hidden'), true);
    assert.equal(overlayRoot.querySelector('[data-library-card="local:old_removed"]'), null);

    // 4. Add Local Script Editor Modal with Prefill buttons and @match validation
    overlayRoot.getElementById('btn-new-local').click();
    const editorBackdrop = overlayRoot.getElementById('editor-backdrop');
    assert.equal(editorBackdrop.classList.contains('hidden'), false);
    assert.equal(overlayRoot.getElementById('ed-match').value, '*://musicbrainz.org/*');

    overlayRoot.getElementById('ed-fill-all').click();
    assert.equal(overlayRoot.getElementById('ed-match').value, '*://*/*');

    overlayRoot.getElementById('ed-fill-current').click();
    assert.equal(overlayRoot.getElementById('ed-match').value, '*://musicbrainz.org/*');

    // Invalid match pattern shows inline error and keeps modal open
    overlayRoot.getElementById('ed-name').value = 'New Helper';
    overlayRoot.getElementById('ed-match').value = 'invalid-pattern';
    overlayRoot.getElementById('ed-code').value = 'javascript:void 0;';
    overlayRoot.getElementById('editor-form').dispatchEvent({ type: 'submit', bubbles: true });
    assert.equal(overlayRoot.getElementById('editor-error').classList.contains('hidden'), false);
    assert.equal(editorBackdrop.classList.contains('hidden'), false);

    // Valid match pattern saves and closes editor modal
    overlayRoot.getElementById('ed-match').value = '*://*.musicbrainz.org/*';
    overlayRoot.getElementById('editor-form').dispatchEvent({ type: 'submit', bubbles: true });
    assert.equal(editorBackdrop.classList.contains('hidden'), true);

    // 5. Export & Import Modals
    overlayRoot.getElementById('btn-export-open').click();
    const exportPreview = overlayRoot.getElementById('export-preview');
    const exportedJson = exportPreview.value;
    assert.match(exportedJson, /"version": 1/);
    overlayRoot.getElementById('export-close').click();

    overlayRoot.getElementById('btn-import-open').click();
    const importText = overlayRoot.getElementById('import-text');
    importText.value = '{"version": 99}';
    overlayRoot.getElementById('import-apply').click();
    assert.equal(overlayRoot.getElementById('import-error').classList.contains('hidden'), false);

    importText.value = exportedJson;
    overlayRoot.getElementById('import-apply').click();
    assert.equal(overlayRoot.getElementById('import-backdrop').classList.contains('hidden'), true);

    // 6. Hotkey Recorder (inside Settings modal)
    overlayRoot.getElementById('btn-manager-settings').click();
    const hkBtn = overlayRoot.getElementById('btn-hotkey-record');
    assert.equal(ui.isRecordingHotkey(), false);
    hkBtn.click();
    assert.equal(ui.isRecordingHotkey(), true);
    assert.equal(hkBtn.textContent, 'Press shortcut…');

    overlayRoot.dispatchEvent({
        type: 'keydown',
        key: 'k',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        bubbles: true,
    });
    assert.equal(ui.isRecordingHotkey(), false);
    assert.equal(hkBtn.textContent, 'Shortcut: Ctrl+Shift+K');
    assert.ok(stateChanges.some((c) => c.settings && c.settings.hotkey === 'Ctrl+Shift+K'));

    // 7. openPalette() dismisses any open Editor or Import sub-modal
    overlayRoot.getElementById('btn-new-local').click();
    assert.equal(editorBackdrop.classList.contains('hidden'), false);
    ui.openPalette();
    assert.equal(editorBackdrop.classList.contains('hidden'), true);
    assert.equal(overlayRoot.getElementById('palette-backdrop').classList.contains('hidden'), false);

    ui.openManager();
    overlayRoot.getElementById('btn-import-open').click();
    assert.equal(overlayRoot.getElementById('import-backdrop').classList.contains('hidden'), false);
    ui.openPalette();
    assert.equal(overlayRoot.getElementById('import-backdrop').classList.contains('hidden'), true);
    assert.equal(overlayRoot.getElementById('palette-backdrop').classList.contains('hidden'), false);

    ui.destroy();
});

test('UI avoids innerHTML so strict TrustedHTML sites (e.g. YouTube) work cleanly', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );
    assert.equal(/\.\s*innerHTML\s*=/.test(uiSource), false);

    const { doc, win } = createDomEnvironment('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const guardTrustedHtml = (el) => {
        Object.defineProperty(el, 'innerHTML', {
            configurable: true,
            get() {
                return '';
            },
            set() {
                throw new TypeError("This document requires 'TrustedHTML' assignment.");
            },
        });
        return el;
    };
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = (tag) => guardTrustedHtml(origCreateElement(tag));
    const origCreateElementNS = doc.createElementNS.bind(doc);
    doc.createElementNS = (ns, tag) => guardTrustedHtml(origCreateElementNS(ns, tag));

    const ytState = createSampleState({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        localScripts: {
            'local:yt': {
                id: 'local:yt',
                source: 'local',
                name: 'YT Helper',
                description: 'YouTube helper',
                match: ['*://*.youtube.com/*'],
                code: 'void 0;',
            },
        },
        layout: [{ type: 'script', scriptId: 'local:yt' }],
    });

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: ytState,
        callbacks: {},
    });

    ui.openPalette();
    ui.openManager();

    const overlayRoot = ui.getOverlayShadowRoot();
    const cardsBeforePopover = overlayRoot.querySelectorAll('.bt-library-card');
    assert.ok(cardsBeforePopover.length > 0);
    for (const card of cardsBeforePopover) {
        assert.equal(card.querySelector('.bt-subtitle'), null);
    }

    const infoBtn = cardsBeforePopover[0]
        .querySelectorAll('button')
        .find((b) => b.textContent === 'ⓘ');
    assert.ok(infoBtn);
    infoBtn.click();
    const popover = overlayRoot.querySelectorAll('.bt-library-card')[0].querySelector('.bt-popover');
    assert.ok(popover);
    assert.ok(popover.textContent.includes('*://*.musicbrainz.org/*'));

    ui.destroy();
});

test('Library search matches local/pack sources, cards use ellipsis/hover expansion, primary hover keeps purple bg, Import buttons sit in footer, and openManager closes toolbar dropdown', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );
    assert.match(uiSource, /\.bt-library-grid\s*\{[^}]*align-items:\s*start;/s);
    assert.doesNotMatch(
        uiSource,
        /\.bt-library-card:hover\s+\.bt-card-title[\s\S]*?white-space:\s*normal;/
    );
    assert.match(uiSource, /\.bt-card-tooltip\s*\{[^}]*z-index:\s*5;/s);
    assert.match(uiSource, /\.bt-library-card:hover\s*\{[^}]*z-index:\s*9;/s);
    assert.match(uiSource, /\.bt-library-card:focus-within\s*\{[^}]*z-index:\s*8;/s);
    assert.match(
        uiSource,
        /\.bt-action-btn-primary:hover\s*\{[^}]*background:\s*var\(--bt-primary-hover\);/s
    );
    assert.match(uiSource, /color-scheme:\s*light;/);
    assert.match(uiSource, /color-scheme:\s*dark;/);

    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            settings: {
                hotkey: 'Alt+B',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
            },
        }),
        callbacks: {},
    });

    // Open toolbar folder dropdown, then openManager should close it
    const toolbarRoot = ui.getToolbarShadowRoot();
    const folderTrigger = toolbarRoot
        .querySelectorAll('button')
        .find((b) => b.textContent.includes('Edit'));
    assert.ok(folderTrigger);
    folderTrigger.click();
    assert.ok(toolbarRoot.querySelector('.bt-dropdown'));

    ui.openManager();
    assert.equal(toolbarRoot.querySelector('.bt-dropdown'), null);

    const overlayRoot = ui.getOverlayShadowRoot();
    const cards = overlayRoot.querySelectorAll('.bt-library-card');
    assert.ok(cards.length >= 3);
    assert.ok(cards[0].querySelector('.bt-card-title-row'));
    assert.ok(cards[0].querySelector('.bt-card-title'));

    // Search "local" finds Local Script(s) and excludes Pack scripts
    const mgrSearch = overlayRoot.getElementById('mgr-search');
    mgrSearch.value = 'local';
    mgrSearch.dispatchEvent({ type: 'input', bubbles: true });
    const localCards = overlayRoot.querySelectorAll('.bt-library-card');
    assert.equal(localCards.length, 1);
    assert.equal(localCards[0].dataset.libraryCard, 'local:tracklist');

    // Search "pack" finds Pack scripts and excludes Local scripts
    mgrSearch.value = 'pack';
    mgrSearch.dispatchEvent({ type: 'input', bubbles: true });
    const packCards = overlayRoot.querySelectorAll('.bt-library-card');
    assert.equal(packCards.length, 3);
    assert.equal(
        packCards.some((c) => c.dataset.libraryCard === 'local:tracklist'),
        false
    );

    // Import modal footer holds Paste Clipboard, Choose File, and Import & Replace together
    const importApply = overlayRoot.getElementById('import-apply');
    const importPaste = overlayRoot.getElementById('import-paste-clipboard');
    const importChoose = overlayRoot.getElementById('import-choose-file');
    assert.equal(importPaste.parentNode.parentNode, importApply.parentNode);
    assert.equal(importChoose.parentNode.parentNode, importApply.parentNode);

    // Command Palette search also matches "local"
    ui.openPalette();
    const paletteSearch = overlayRoot.getElementById('palette-search');
    paletteSearch.value = 'local';
    paletteSearch.dispatchEvent({ type: 'input', bubbles: true });
    const paletteLocal = overlayRoot
        .querySelectorAll('.bt-palette-item')
        .filter((el) => el.dataset.scriptId);
    assert.equal(paletteLocal.length, 1);
    assert.equal(paletteLocal[0].dataset.scriptId, 'local:tracklist');

    ui.destroy();
});

test('Library cards keep single-line ellipsis and show instant tooltip only when truncated, flipping near sticky header and suppressing on drag/popover', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            settings: {
                hotkey: 'Alt+B',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
            },
        }),
        callbacks: {},
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const stickySection = overlayRoot.querySelector('.bt-sticky-section');
    const libraryGrid = overlayRoot.getElementById('library-grid');
    assert.ok(stickySection);
    assert.ok(libraryGrid);

    stickySection.getBoundingClientRect = () => ({ top: 0, bottom: 80, left: 0, right: 800, width: 800, height: 80 });

    const cards = overlayRoot.querySelectorAll('.bt-library-card');
    assert.ok(cards.length >= 2);

    const firstCard = cards[0];
    const firstTitle = firstCard.querySelector('.bt-card-title');
    const firstTooltip = firstCard.querySelector('.bt-card-tooltip');
    assert.ok(firstTooltip);
    assert.equal(firstTooltip.getAttribute('aria-hidden'), 'true');
    assert.equal(firstTooltip.textContent, firstTitle.textContent);

    // Truncated title near sticky header flips tooltip below
    firstTitle.scrollWidth = 320;
    firstTitle.clientWidth = 180;
    firstCard.getBoundingClientRect = () => ({ top: 100, bottom: 134, left: 0, right: 400, width: 400, height: 34 });
    firstCard.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(firstCard.dataset.truncated, 'true');
    assert.equal(firstCard.dataset.tooltipPos, 'bottom');
    assert.equal(firstCard.dataset.tooltipSuppressed, 'false');

    // Truncated title with clearance places tooltip above
    firstCard.getBoundingClientRect = () => ({ top: 200, bottom: 234, left: 0, right: 400, width: 400, height: 34 });
    firstCard.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(firstCard.dataset.tooltipPos, 'top');

    // Multi-line wrapped tooltip flips below when card clearance is < tooltipHeight + 10
    firstTooltip.getBoundingClientRect = () => ({ top: 68, bottom: 120, left: 40, right: 360, width: 320, height: 52 });
    firstCard.getBoundingClientRect = () => ({ top: 130, bottom: 164, left: 0, right: 400, width: 400, height: 34 });
    firstCard.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(firstCard.dataset.tooltipPos, 'bottom');

    // Non-truncated short title does not trigger tooltip
    const secondCard = cards[1];
    const secondTitle = secondCard.querySelector('.bt-card-title');
    secondTitle.scrollWidth = 120;
    secondTitle.clientWidth = 180;
    secondCard.getBoundingClientRect = () => ({ top: 242, bottom: 276, left: 0, right: 400, width: 400, height: 34 });
    secondCard.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(secondCard.dataset.truncated, 'false');

    // Active drag marks grid dragging and suppresses tooltip on hover
    firstCard.dispatchEvent({ type: 'dragstart', bubbles: true });
    assert.equal(libraryGrid.dataset.dragging, 'true');
    secondTitle.scrollWidth = 300;
    secondCard.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(secondCard.dataset.tooltipSuppressed, 'true');

    firstCard.dispatchEvent({ type: 'dragend', bubbles: true });
    assert.equal(libraryGrid.dataset.dragging, undefined);
    secondCard.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(secondCard.dataset.tooltipSuppressed, 'false');

    // Dropping a card clears grid.dataset.dragging even without a subsequent dragend
    const toolbarStrip = overlayRoot.getElementById('toolbar-strip');
    assert.ok(toolbarStrip);
    firstCard.dispatchEvent({ type: 'dragstart', bubbles: true });
    assert.equal(libraryGrid.dataset.dragging, 'true');
    toolbarStrip.dispatchEvent({ type: 'drop', bubbles: true });
    assert.equal(libraryGrid.dataset.dragging, undefined);

    // Opening info popover suppresses tooltip on that card
    const infoBtn = overlayRoot
        .querySelectorAll('.bt-library-card')[0]
        .querySelectorAll('button')
        .find((b) => b.textContent === 'ⓘ');
    assert.ok(infoBtn);
    infoBtn.click();
    const rerenderedFirst = overlayRoot.querySelectorAll('.bt-library-card')[0];
    assert.equal(rerenderedFirst.dataset.tooltipSuppressed, 'true');

    // Missing layout metrics on focusin do not throw
    const lastCard = overlayRoot.querySelectorAll('.bt-library-card')[1];
    const lastTitle = lastCard.querySelector('.bt-card-title');
    delete lastTitle.scrollWidth;
    delete lastTitle.clientWidth;
    lastCard.getBoundingClientRect = undefined;
    assert.doesNotThrow(() => {
        lastCard.dispatchEvent({ type: 'focusin', bubbles: true });
    });
    assert.equal(lastCard.dataset.truncated, 'false');

    ui.destroy();
});

test('Dock defaults to bottom-center and collapsed with Bookmark Bolt SVG until expanded', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {},
    });

    assert.equal(ui.isToolbarMounted(), true);
    const toolbarHost = ui.getToolbarHost();
    const toolbarRoot = ui.getToolbarShadowRoot();
    const dockContainer = toolbarRoot.getElementById('bt-toolbar-container');

    assert.equal(dockContainer.classList.contains('bt-toolbar-dock'), true);
    assert.equal(dockContainer.classList.contains('bt-toolbar-inline'), false);
    assert.equal(toolbarHost.dataset.snapZone, 'bottom-center');
    assert.equal(toolbarHost.style.bottom, '16px');
    assert.equal(toolbarHost.style.left, '50%');
    assert.equal(toolbarHost.style.transform, 'translateX(-50%)');

    const handle = toolbarRoot.querySelector('.bt-dock-handle');
    assert.ok(handle, 'Expected .bt-dock-handle button');
    assert.equal(handle.getAttribute('aria-expanded'), 'false');

    const svg = handle.querySelector('svg');
    assert.ok(svg, 'Expected Bookmark Bolt <svg> inside .bt-dock-handle');
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(svg.getAttribute('viewBox'), '0 0 16 16');
    assert.ok(handle.querySelector('[data-removed-badge="true"]'), 'Expected removed badge dot on collapsed handle');

    // Collapsed dock hides script/folder/palette buttons
    assert.equal(toolbarRoot.querySelectorAll('[data-script-id]').length, 0);
    assert.equal(toolbarRoot.querySelectorAll('[data-folder-id]').length, 0);
    assert.equal(toolbarRoot.querySelector('[data-action="open-palette"]'), null);

    // Expanding via dockSiteExpanded reveals buttons
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
        },
    });
    assert.equal(toolbarRoot.querySelector('.bt-dock-handle').getAttribute('aria-expanded'), 'true');
    assert.ok(toolbarRoot.querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all"]'));
    assert.ok(toolbarRoot.querySelector('[data-folder-id="folder:edit"]'));
    assert.ok(toolbarRoot.querySelector('[data-action="open-palette"]'));

    ui.destroy();
});

test('Clicking .bt-dock-handle toggles dockSiteExpanded[origin] and Manager controls switch between both, click, and hover modes', async () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {
            onStateChange(partial) {
                stateChanges.push(partial);
            },
        },
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    const dockContainer = toolbarRoot.getElementById('bt-toolbar-container');

    // 1. Default 'both' mode: hover expands temporarily without state change, leave collapses after grace delay
    dockContainer.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.ok(toolbarRoot.querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all"]'));
    assert.equal(stateChanges.length, 0);

    dockContainer.dispatchEvent({ type: 'mouseleave', bubbles: false });
    await new Promise((r) => setTimeout(r, 430));
    assert.equal(toolbarRoot.querySelectorAll('[data-script-id]').length, 0);

    // Clicking handle toggles pinned expanded state and persists via onStateChange
    toolbarRoot.querySelector('.bt-dock-handle').click();
    assert.equal(stateChanges.at(-1).settings.dockSiteExpanded['https://musicbrainz.org'], true);
    assert.ok(toolbarRoot.querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all"]'));

    // Clicking again unpins and collapses immediately
    toolbarRoot.querySelector('.bt-dock-handle').click();
    assert.equal(stateChanges.at(-1).settings.dockSiteExpanded['https://musicbrainz.org'], false);
    assert.equal(toolbarRoot.querySelectorAll('[data-script-id]').length, 0);

    // 2. Switch to 'click' mode via Manager header selector: hover does NOT expand
    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const clickModeBtn = overlayRoot.querySelector('[data-dock-expand-mode="click"]');
    assert.ok(clickModeBtn, 'Expected click expand mode button in Manager header');
    clickModeBtn.click();
    assert.equal(stateChanges.at(-1).settings.dockExpandMode, 'click');

    dockContainer.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(toolbarRoot.querySelectorAll('[data-script-id]').length, 0);
    toolbarRoot.querySelector('.bt-dock-handle').click();
    assert.ok(toolbarRoot.querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all"]'));

    // 3. Switch to 'hover' mode via Manager header selector: hover expands, click does not emit dockSiteExpanded
    const hoverModeBtn = overlayRoot.querySelector('[data-dock-expand-mode="hover"]');
    assert.ok(hoverModeBtn, 'Expected hover expand mode button in Manager header');
    hoverModeBtn.click();
    assert.equal(stateChanges.at(-1).settings.dockExpandMode, 'hover');
    assert.equal(toolbarRoot.querySelectorAll('[data-script-id]').length, 0);

    const beforeHoverClicks = stateChanges.length;
    dockContainer.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.ok(toolbarRoot.querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all"]'));
    toolbarRoot.querySelector('.bt-dock-handle').click();
    assert.equal(stateChanges.length, beforeHoverClicks);
    dockContainer.dispatchEvent({ type: 'mouseleave', bubbles: false });
    await new Promise((r) => setTimeout(r, 430));
    assert.equal(toolbarRoot.querySelectorAll('[data-script-id]').length, 0);

    ui.destroy();
});

test('Pointer-dragging .bt-dock-handle snaps to nearest of 6 zones beyond 6px, toggles on <= 6px jitter, and cleans up snap guides on pointercancel', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 412;
    win.innerHeight = 924;

    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {
            onStateChange(partial) {
                stateChanges.push(partial);
            },
        },
    });

    const toolbarHost = ui.getToolbarHost();
    const toolbarRoot = ui.getToolbarShadowRoot();
    const handle = toolbarRoot.querySelector('.bt-dock-handle');

    // 1. Drag > 6px toward top-right shows 6 snap zones, highlights top-right, and snaps on pointerup without toggling expand
    handle.dispatchEvent({
        type: 'pointerdown',
        pointerId: 1,
        button: 0,
        pointerType: 'touch',
        clientX: 206,
        clientY: 890,
        bubbles: true,
    });
    handle.dispatchEvent({
        type: 'pointermove',
        pointerId: 1,
        pointerType: 'touch',
        clientX: 380,
        clientY: 36,
        bubbles: true,
    });

    const overlayRoot = ui.getOverlayShadowRoot();
    assert.ok(overlayRoot, 'Expected overlayShadow mounted for snap guides');
    const snapOverlay = overlayRoot.querySelector('.bt-dock-snap-overlay');
    assert.ok(snapOverlay, 'Expected .bt-dock-snap-overlay during dock drag');
    const zones = snapOverlay.querySelectorAll('.bt-dock-snap-zone');
    assert.equal(zones.length, 6);
    const topRightZone = snapOverlay.querySelector('[data-snap-zone="top-right"]');
    assert.ok(topRightZone);
    assert.equal(topRightZone.classList.contains('bt-dock-snap-zone-active'), true);

    handle.dispatchEvent({
        type: 'pointerup',
        pointerId: 1,
        pointerType: 'touch',
        clientX: 380,
        clientY: 36,
        bubbles: true,
    });

    assert.equal(overlayRoot.querySelector('.bt-dock-snap-overlay'), null);
    assert.equal(stateChanges.at(-1).settings.dockSitePositions['https://musicbrainz.org'], 'top-right');
    assert.notEqual(stateChanges.at(-1).settings.dockSiteExpanded['https://musicbrainz.org'], true);
    assert.equal(toolbarHost.dataset.snapZone, 'top-right');
    assert.equal(toolbarHost.style.top, '16px');
    assert.equal(toolbarHost.style.right, '16px');

    // 2. Movement <= 6px triggers click toggle only (does not open snap guides or change position)
    const activeHandle = toolbarRoot.querySelector('.bt-dock-handle');
    activeHandle.dispatchEvent({
        type: 'pointerdown',
        pointerId: 2,
        button: 0,
        pointerType: 'touch',
        clientX: 380,
        clientY: 36,
        bubbles: true,
    });
    activeHandle.dispatchEvent({
        type: 'pointermove',
        pointerId: 2,
        pointerType: 'touch',
        clientX: 383,
        clientY: 40,
        bubbles: true,
    });
    assert.equal(overlayRoot.querySelector('.bt-dock-snap-overlay'), null);

    activeHandle.dispatchEvent({
        type: 'pointerup',
        pointerId: 2,
        pointerType: 'touch',
        clientX: 383,
        clientY: 40,
        bubbles: true,
    });
    activeHandle.click();
    assert.equal(stateChanges.at(-1).settings.dockSiteExpanded['https://musicbrainz.org'], true);
    assert.equal(stateChanges.at(-1).settings.dockSitePositions['https://musicbrainz.org'], 'top-right');

    // 3. pointercancel cleans up snap guides and keeps previous snap position
    const changesBeforeCancel = stateChanges.length;
    const cancelHandle = toolbarRoot.querySelector('.bt-dock-handle');
    cancelHandle.dispatchEvent({
        type: 'pointerdown',
        pointerId: 3,
        button: 0,
        pointerType: 'touch',
        clientX: 380,
        clientY: 36,
        bubbles: true,
    });
    cancelHandle.dispatchEvent({
        type: 'pointermove',
        pointerId: 3,
        pointerType: 'touch',
        clientX: 30,
        clientY: 880,
        bubbles: true,
    });
    assert.ok(overlayRoot.querySelector('.bt-dock-snap-overlay'));

    cancelHandle.dispatchEvent({
        type: 'pointercancel',
        pointerId: 3,
        pointerType: 'touch',
        clientX: 30,
        clientY: 880,
        bubbles: true,
    });
    assert.equal(overlayRoot.querySelector('.bt-dock-snap-overlay'), null);
    assert.equal(stateChanges.length, changesBeforeCancel);
    assert.equal(toolbarHost.dataset.snapZone, 'top-right');

    ui.destroy();
});

test('Folder dropdown opens upward (bt-dropdown-up) on bottom-* snap zones and downward on top-* snap zones with horizontal alignment', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            settings: {
                hotkey: 'Alt+B',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
                dockSitePositions: { 'https://musicbrainz.org': 'bottom-center' },
            },
        }),
        callbacks: {},
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    toolbarRoot.querySelector('[data-folder-id="folder:edit"]').click();
    let dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(dropdown);
    assert.equal(dropdown.classList.contains('bt-dropdown-up'), true);
    assert.equal(dropdown.classList.contains('bt-dropdown-center'), true);

    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'top-left' },
        },
    });
    dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(dropdown);
    assert.equal(dropdown.classList.contains('bt-dropdown-up'), false);
    assert.equal(dropdown.classList.contains('bt-dropdown-left'), true);

    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'top-right' },
        },
    });
    dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(dropdown);
    assert.equal(dropdown.classList.contains('bt-dropdown-up'), false);
    assert.equal(dropdown.classList.contains('bt-dropdown-right'), true);

    ui.destroy();
});

test('clampDropdownToViewport clamps overflow via marginLeft on center/left anchors and marginRight on right-anchored dropdowns', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 412;
    win.innerHeight = 924;

    let activeDropdownRect = null;
    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
        const el = origCreateElement(tag);
        if (String(tag).toLowerCase() === 'div') {
            const origRect = el.getBoundingClientRect.bind(el);
            el.getBoundingClientRect = () =>
                el.classList.contains('bt-dropdown') && activeDropdownRect
                    ? activeDropdownRect
                    : origRect();
        }
        return el;
    };

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            settings: {
                hotkey: 'Alt+B',
                dockOrientation: 'horizontal',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
                dockSitePositions: { 'https://musicbrainz.org': 'bottom-center' },
            },
        }),
        callbacks: {},
    });

    const toolbarRoot = ui.getToolbarShadowRoot();

    // 1. bottom-center overflowing right edge (420 > 412 - 8) shifts inward via marginLeft
    activeDropdownRect = { left: 230, right: 420, width: 190, top: 700, bottom: 840, height: 140 };
    toolbarRoot.querySelector('[data-folder-id="folder:edit"]').click();
    let dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(dropdown);
    assert.equal(dropdown.classList.contains('bt-dropdown-center'), true);
    assert.equal(dropdown.style.marginLeft, '-16px');
    assert.ok(!dropdown.style.marginRight);

    // 2. top-left overflowing left (< 8) and overflowing right (> 404) shifts via marginLeft
    activeDropdownRect = { left: -10, right: 180, width: 190, top: 50, bottom: 190, height: 140 };
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'horizontal',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'top-left' },
        },
    });
    dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(dropdown);
    assert.equal(dropdown.classList.contains('bt-dropdown-left'), true);
    assert.equal(dropdown.style.marginLeft, '18px');
    assert.ok(!dropdown.style.marginRight);

    activeDropdownRect = { left: 230, right: 428, width: 198, top: 50, bottom: 190, height: 140 };
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'horizontal',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'top-left' },
        },
    });
    dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.equal(dropdown.style.marginLeft, '-24px');
    assert.ok(!dropdown.style.marginRight);

    // 3. bottom-right overflowing left edge (rect.left = -20 < 8) must shift right via marginRight (-28px), NOT marginLeft
    activeDropdownRect = { left: -20, right: 170, width: 190, top: 700, bottom: 840, height: 140 };
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'horizontal',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-right' },
        },
    });
    dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(dropdown);
    assert.equal(dropdown.classList.contains('bt-dropdown-right'), true);
    assert.equal(dropdown.style.marginRight, '-28px');
    assert.ok(!dropdown.style.marginLeft);

    // 4. top-right overflowing right edge (420 > 412 - 8) shifts inward via positive marginRight (16px)
    activeDropdownRect = { left: 230, right: 420, width: 190, top: 50, bottom: 190, height: 140 };
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'horizontal',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'top-right' },
        },
    });
    dropdown = toolbarRoot.querySelector('.bt-dropdown');
    assert.equal(dropdown.classList.contains('bt-dropdown-right'), true);
    assert.equal(dropdown.style.marginRight, '16px');
    assert.ok(!dropdown.style.marginLeft);

    ui.destroy();
});

test('Hiding dock on current origin unmounts toolbarHost while Manager and Command Palette keep toggle reachable', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {
            onStateChange(partial) {
                stateChanges.push(partial);
            },
        },
    });

    assert.equal(ui.isToolbarMounted(), true);

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    overlayRoot.getElementById('btn-manager-settings').click();
    const toggleBtn = overlayRoot.getElementById('btn-toggle-dock-site');
    assert.ok(toggleBtn, 'Expected #btn-toggle-dock-site in Settings modal');
    assert.match(toggleBtn.textContent, /Hide dock on this site/i);

    toggleBtn.click();
    assert.equal(stateChanges.at(-1).settings.dockSiteVisibility['https://musicbrainz.org'], 'hidden');
    assert.equal(ui.isToolbarMounted(), false);
    assert.equal(doc.querySelector('#userjs-bt-toolbar-host'), null);
    assert.match(toggleBtn.textContent, /Show dock on this site/i);

    // Re-enable via Command Palette action
    ui.openPalette();
    const paletteSearch = overlayRoot.getElementById('palette-search');
    paletteSearch.value = 'dock';
    paletteSearch.dispatchEvent({ type: 'input', bubbles: true });

    const paletteList = overlayRoot.getElementById('palette-list');
    const dockAction = paletteList
        .querySelectorAll('.bt-palette-item')
        .find((el) => el.dataset.commandId === 'toggle-dock-site');
    assert.ok(dockAction, 'Expected toggle-dock-site action in Command Palette');
    assert.match(dockAction.textContent, /Show Dock on Current Site/i);

    dockAction.click();
    assert.equal('https://musicbrainz.org' in stateChanges.at(-1).settings.dockSiteVisibility, false);
    assert.equal(ui.isToolbarMounted(), true);
    assert.ok(doc.querySelector('#userjs-bt-toolbar-host'));

    ui.destroy();
});

test('Responsive CSS rules cover 412px modals, palette items, popovers, wrapping headers, fluid search, and touch-action handles', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );

    assert.match(uiSource, /\.bt-manager-body\s*\{[^}]*overflow-x:\s*hidden;[^}]*min-width:\s*0;/s);
    assert.match(uiSource, /\.bt-modal\s*\{[^}]*min-width:\s*0;/s);
    assert.match(uiSource, /calc\(100vw\s*-\s*24px\)/);
    assert.match(uiSource, /100dvh/);
    assert.match(uiSource, /\.bt-palette-item\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
    assert.match(uiSource, /\.bt-popover\s*\{[^}]*max-width:\s*calc\(100vw\s*-\s*(?:16|48)px\);/s);
    assert.match(uiSource, /\.bt-grip\s*\{[^}]*touch-action:\s*none;/s);
    assert.match(uiSource, /\.bt-dock-handle\s*\{[^}]*touch-action:\s*none;/s);
    assert.doesNotMatch(uiSource, /mgrSearch\.style\.width\s*=\s*'236px'/);

    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {},
    });
    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const mgrSearch = overlayRoot.getElementById('mgr-search');
    assert.equal(mgrSearch.classList.contains('bt-mgr-search'), true);
    const header = overlayRoot.querySelector('.bt-modal-header');
    assert.ok(header.querySelectorAll('.bt-row-wrap').length >= 1);
    ui.openSettings();
    assert.ok(overlayRoot.getElementById('settings-backdrop').querySelectorAll('.bt-row-wrap').length >= 2);
    ui.destroy();
});

test('Pointer-event touch drag on Library card .bt-grip pins script to Toolbar and cleans up ghost pill and feedback on pointercancel', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {
            onStateChange(partial) {
                stateChanges.push(partial);
            },
        },
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const libraryGrid = overlayRoot.getElementById('library-grid');
    const toolbarStrip = overlayRoot.getElementById('toolbar-strip');
    const dragHint = overlayRoot.getElementById('drag-hint');

    const unpinnedCard = overlayRoot.querySelector('[data-library-card="pack:chaban-bookmarklets/pseudo_release"]');
    assert.ok(unpinnedCard);
    const grip = unpinnedCard.querySelector('.bt-grip');
    assert.ok(grip);

    overlayRoot.elementFromPoint = (x, y) => (y <= 150 ? toolbarStrip : unpinnedCard);

    // 1. Touch drag > 6px over #toolbar-strip shows ghost pill and drop feedback, and pins on pointerup
    grip.dispatchEvent({
        type: 'pointerdown',
        pointerId: 10,
        button: 0,
        pointerType: 'touch',
        clientX: 40,
        clientY: 420,
        bubbles: true,
    });
    grip.dispatchEvent({
        type: 'pointermove',
        pointerId: 10,
        pointerType: 'touch',
        clientX: 160,
        clientY: 110,
        bubbles: true,
    });

    const ghost = overlayRoot.querySelector('.bt-touch-ghost');
    assert.ok(ghost, 'Expected floating .bt-touch-ghost pill during touch drag');
    assert.match(ghost.textContent, /Convert to pseudo-release/);
    assert.equal(libraryGrid.dataset.dragging, 'true');
    assert.equal(toolbarStrip.classList.contains('drop-active-zone'), true);

    grip.dispatchEvent({
        type: 'pointerup',
        pointerId: 10,
        pointerType: 'touch',
        clientX: 160,
        clientY: 110,
        bubbles: true,
    });

    assert.equal(overlayRoot.querySelector('.bt-touch-ghost'), null);
    assert.equal(libraryGrid.dataset.dragging, undefined);
    assert.equal(toolbarStrip.classList.contains('drop-active-zone'), false);
    const latestLayoutChange = stateChanges.filter((c) => c.layout).pop();
    assert.ok(latestLayoutChange, 'Expected layout state change after dropping script onto Toolbar');
    assert.ok(
        latestLayoutChange.layout.some(
            (node) => node.type === 'script' && node.scriptId === 'pack:chaban-bookmarklets/pseudo_release'
        )
    );

    // 2. pointercancel mid-drag cleans up ghost pill, drop feedback, and leaves layout unchanged
    const changesBeforeCancel = stateChanges.length;
    const secondCard = overlayRoot.querySelector('[data-library-card="local:tracklist"]');
    const secondGrip = secondCard.querySelector('.bt-grip');
    overlayRoot.elementFromPoint = (x, y) => (y <= 150 ? toolbarStrip : secondCard);

    secondGrip.dispatchEvent({
        type: 'pointerdown',
        pointerId: 11,
        button: 0,
        pointerType: 'touch',
        clientX: 40,
        clientY: 460,
        bubbles: true,
    });
    secondGrip.dispatchEvent({
        type: 'pointermove',
        pointerId: 11,
        pointerType: 'touch',
        clientX: 160,
        clientY: 110,
        bubbles: true,
    });
    assert.ok(overlayRoot.querySelector('.bt-touch-ghost'));
    assert.equal(toolbarStrip.classList.contains('drop-active-zone'), true);

    secondGrip.dispatchEvent({
        type: 'pointercancel',
        pointerId: 11,
        pointerType: 'touch',
        clientX: 160,
        clientY: 110,
        bubbles: true,
    });

    assert.equal(overlayRoot.querySelector('.bt-touch-ghost'), null);
    assert.equal(libraryGrid.dataset.dragging, undefined);
    assert.equal(toolbarStrip.classList.contains('drop-active-zone'), false);
    assert.equal(dragHint.textContent, UI.DEFAULT_DRAG_HINT);
    assert.equal(stateChanges.length, changesBeforeCancel);

    // 3. Touch drag on a Toolbar script pill onto a Folder pill moves script into folder, while tapping ★ unpin button still clicks normally
    const toolbarScriptPill = overlayRoot.querySelector('[data-toolbar-script="pack:chaban-bookmarklets/approve_all"]');
    const folderPill = overlayRoot.querySelector('[data-folder-pill="folder:edit"]');
    assert.ok(toolbarScriptPill && folderPill);

    overlayRoot.elementFromPoint = () => folderPill.firstChild || folderPill;
    toolbarScriptPill.dispatchEvent({
        type: 'pointerdown',
        pointerId: 12,
        button: 0,
        pointerType: 'touch',
        clientX: 80,
        clientY: 110,
        bubbles: true,
    });
    toolbarScriptPill.dispatchEvent({
        type: 'pointermove',
        pointerId: 12,
        pointerType: 'touch',
        clientX: 220,
        clientY: 110,
        bubbles: true,
    });
    assert.equal(folderPill.classList.contains('drop-active-folder'), true);
    toolbarScriptPill.dispatchEvent({
        type: 'pointerup',
        pointerId: 12,
        pointerType: 'touch',
        clientX: 220,
        clientY: 110,
        bubbles: true,
    });

    const movedLayout = stateChanges.filter((c) => c.layout).pop().layout;
    const editFolder = movedLayout.find((n) => n.type === 'folder' && n.id === 'folder:edit');
    assert.ok(editFolder.items.some((it) => it.scriptId === 'pack:chaban-bookmarklets/approve_all'));

    ui.destroy();
});

test('Non-HTTP(S) URLs (about:blank / file://) handle Manager and Command Palette dock controls safely without throwing', () => {
    const { doc, win } = createDomEnvironment('about:blank');
    const state = createSampleState({
        url: 'about:blank',
        localScripts: {
            'local:all': {
                id: 'local:all',
                source: 'local',
                name: 'All Sites',
                description: 'Runs everywhere',
                match: ['<all_urls>'],
                code: 'void 0;',
            },
        },
        layout: [{ type: 'script', scriptId: 'local:all' }],
    });

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: state,
        callbacks: {},
    });

    assert.equal(ui.isToolbarMounted(), false);

    // Settings disables per-site hide button cleanly when origin is unavailable
    ui.openSettings();
    const overlayRoot = ui.getOverlayShadowRoot();
    const toggleBtn = overlayRoot.getElementById('btn-toggle-dock-site');
    assert.equal(toggleBtn.disabled, true);
    assert.doesNotThrow(() => toggleBtn.click());

    // Command Palette also opens without throwing on originless URL
    assert.doesNotThrow(() => ui.openPalette());

    ui.destroy();
});

test('Manager modal is top-anchored with fixed height and info popovers use position:fixed with viewport flip/clamp and close on scroll', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );

    assert.match(
        uiSource,
        /\.bt-modal-lg\s*\{[^}]*height:\s*calc\(100vh\s*-\s*32px\);[^}]*height:\s*calc\(100dvh\s*-\s*32px\);/s
    );
    assert.match(
        uiSource,
        /\.bt-popover\s*\{[^}]*position:\s*fixed;[^}]*overflow-y:\s*auto;/s
    );

    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 800;
    win.innerHeight = 600;

    const origCreateElement = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
        const el = origCreateElement(tag);
        if (String(tag).toLowerCase() === 'div') {
            const origRect = el.getBoundingClientRect.bind(el);
            el.getBoundingClientRect = () =>
                el.classList.contains('bt-popover') && !el.classList.contains('bt-pack-popover')
                    ? { width: 288, height: 220 }
                    : origRect();
        }
        return el;
    };

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {},
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const managerBackdrop = overlayRoot.getElementById('manager-backdrop');
    assert.ok(managerBackdrop);
    assert.equal(
        managerBackdrop.classList.contains('bt-backdrop-top') ||
            /#manager-backdrop\s*\{[^}]*align-items:\s*flex-start;/s.test(uiSource),
        true,
        'Expected #manager-backdrop to use top alignment'
    );

    // Click ⓘ on a card near the bottom-right of an 800x600 viewport
    const firstCard = overlayRoot.querySelectorAll('.bt-library-card')[0];
    const infoBtn = firstCard.querySelectorAll('button').find((b) => b.textContent === 'ⓘ');
    assert.ok(infoBtn);
    infoBtn.getBoundingClientRect = () => ({
        top: 540,
        bottom: 560,
        left: 600,
        right: 620,
        width: 20,
        height: 20,
    });
    infoBtn.click();

    const libraryGrid = overlayRoot.getElementById('library-grid');
    const pop = libraryGrid.querySelector('.bt-popover');
    assert.ok(pop, 'Expected .bt-popover to open when ⓘ is clicked');
    const topPx = Number.parseFloat(pop.style.top);
    const leftPx = Number.parseFloat(pop.style.left);
    assert.ok(Number.isFinite(topPx) && topPx <= 316, `Expected pop.style.top <= 316px (flipped above 540px), got ${pop.style.top}`);
    assert.equal(leftPx, 504, `Expected pop.style.left clamped to 504px (800 - 288 - 8), got ${pop.style.left}`);

    // Scrolling .bt-manager-body closes state.openInfoId and removes the open .bt-popover
    const managerBody = overlayRoot.querySelector('.bt-manager-body');
    assert.ok(managerBody);
    managerBody.dispatchEvent({ type: 'scroll', bubbles: false });
    assert.equal(
        libraryGrid.querySelector('.bt-popover'),
        null,
        'Scrolling .bt-manager-body must close any open script info popover'
    );

    ui.destroy();
});

test('Library section acts as drop-back target to unpin toolbar-script and remove folder-item (HTML5 DnD and Touch Pointer DnD), ignoring library-script and toolbar-folder', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {
            onStateChange(partial) {
                stateChanges.push(partial);
            },
        },
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const librarySection = overlayRoot.querySelector('.bt-library-section');
    const dragHint = overlayRoot.getElementById('drag-hint');
    assert.ok(librarySection);
    assert.equal(librarySection.dataset.dropKey, 'library-unpin');

    // 1. HTML5 DnD: toolbar-script pill hovered over a .bt-library-card inside .bt-library-section -> unpins on drop
    const toolbarPill = overlayRoot.querySelector('[data-toolbar-script="pack:chaban-bookmarklets/approve_all"]');
    const anyLibraryCard = overlayRoot.querySelector('.bt-library-card');
    assert.ok(toolbarPill && anyLibraryCard);

    toolbarPill.ondragstart({ dataTransfer: { effectAllowed: '', setData() {} } });
    const dt1 = { dropEffect: 'none' };
    anyLibraryCard.dispatchEvent({ type: 'dragover', dataTransfer: dt1, bubbles: true });
    assert.equal(dt1.dropEffect, 'move');
    assert.equal(librarySection.classList.contains('drop-active-zone'), true);
    assert.equal(dragHint.textContent, 'Unpin "Approve All" from Toolbar');

    anyLibraryCard.dispatchEvent({ type: 'drop', dataTransfer: dt1, bubbles: true });
    assert.equal(librarySection.classList.contains('drop-active-zone'), false);
    assert.equal(
        overlayRoot.querySelector('[data-toolbar-script="pack:chaban-bookmarklets/approve_all"]'),
        null,
        'toolbar-script should be unpinned after dropping on library section'
    );
    const afterUnpinLayout = stateChanges.filter((c) => c.layout).pop().layout;
    assert.equal(
        afterUnpinLayout.some((n) => n.type === 'script' && n.scriptId === 'pack:chaban-bookmarklets/approve_all'),
        false
    );

    // 2. HTML5 DnD: library-script and toolbar-folder over .bt-library-section are ignored (no-op)
    const changesBeforeIgnored = stateChanges.length;
    const libCard = overlayRoot.querySelector('[data-library-card="pack:chaban-bookmarklets/pseudo_release"]');
    assert.ok(libCard);
    libCard.ondragstart({ dataTransfer: { effectAllowed: '', setData() {} } });
    const dtLib = { dropEffect: 'move' };
    librarySection.dispatchEvent({ type: 'dragover', dataTransfer: dtLib, bubbles: true });
    assert.equal(dtLib.dropEffect, 'none');
    assert.equal(librarySection.classList.contains('drop-active-zone'), false);
    assert.equal(dragHint.textContent, UI.DEFAULT_DRAG_HINT);
    librarySection.dispatchEvent({ type: 'drop', dataTransfer: dtLib, bubbles: true });
    libCard.ondragend();
    assert.equal(stateChanges.length, changesBeforeIgnored);

    const folderPill = overlayRoot.querySelector('[data-folder-pill="folder:edit"]');
    assert.ok(folderPill);
    folderPill.ondragstart({ dataTransfer: { effectAllowed: '', setData() {} } });
    const dtFolder = { dropEffect: 'move' };
    librarySection.dispatchEvent({ type: 'dragover', dataTransfer: dtFolder, bubbles: true });
    assert.equal(dtFolder.dropEffect, 'none');
    assert.equal(librarySection.classList.contains('drop-active-zone'), false);
    assert.equal(dragHint.textContent, UI.DEFAULT_DRAG_HINT);
    librarySection.dispatchEvent({ type: 'drop', dataTransfer: dtFolder, bubbles: true });
    folderPill.ondragend();
    assert.equal(stateChanges.length, changesBeforeIgnored);

    // 3. HTML5 DnD: folder-item chip dragged onto .bt-library-section removes it from folder
    const folderItemChip = overlayRoot.querySelector('[data-folder-item="local:tracklist"]');
    assert.ok(folderItemChip);
    folderItemChip.ondragstart({ dataTransfer: { effectAllowed: '', setData() {} } });
    const dtChip = { dropEffect: 'none' };
    librarySection.dispatchEvent({ type: 'dragover', dataTransfer: dtChip, bubbles: true });
    assert.equal(dtChip.dropEffect, 'move');
    assert.equal(librarySection.classList.contains('drop-active-zone'), true);
    assert.equal(dragHint.textContent, 'Remove "mv t" from "Edit"');

    librarySection.dispatchEvent({ type: 'drop', dataTransfer: dtChip, bubbles: true });
    assert.equal(librarySection.classList.contains('drop-active-zone'), false);
    assert.equal(overlayRoot.querySelector('[data-folder-item="local:tracklist"]'), null);
    const afterRemoveChipLayout = stateChanges.filter((c) => c.layout).pop().layout;
    const editFolderAfterHtml5 = afterRemoveChipLayout.find((n) => n.type === 'folder' && n.id === 'folder:edit');
    assert.equal(
        editFolderAfterHtml5.items.some((it) => it.scriptId === 'local:tracklist'),
        false
    );

    // 4. Touch Pointer DnD: folder-item chip and toolbar-script pill work over .bt-library-card inside .bt-library-section
    const remainingFolderChip = overlayRoot.querySelector('[data-folder-item="pack:chaban-bookmarklets/pseudo_release"]');
    const hoverCard = overlayRoot.querySelector('.bt-library-card');
    assert.ok(remainingFolderChip && hoverCard);
    overlayRoot.elementFromPoint = () => hoverCard;

    remainingFolderChip.dispatchEvent({
        type: 'pointerdown',
        pointerId: 31,
        button: 0,
        pointerType: 'touch',
        clientX: 100,
        clientY: 200,
        bubbles: true,
    });
    remainingFolderChip.dispatchEvent({
        type: 'pointermove',
        pointerId: 31,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    assert.equal(librarySection.classList.contains('drop-active-zone'), true);
    assert.equal(dragHint.textContent, 'Remove "Pseudo-release" from "Edit"');
    remainingFolderChip.dispatchEvent({
        type: 'pointerup',
        pointerId: 31,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    assert.equal(librarySection.classList.contains('drop-active-zone'), false);
    const afterTouchChipLayout = stateChanges.filter((c) => c.layout).pop().layout;
    const editFolderAfterTouch = afterTouchChipLayout.find((n) => n.type === 'folder' && n.id === 'folder:edit');
    assert.equal(editFolderAfterTouch.items.length, 0);

    // Touch drag toolbar-script pill over .bt-library-card -> unpins
    const freshHoverCard = overlayRoot.querySelector('.bt-library-card');
    assert.ok(freshHoverCard);
    overlayRoot.elementFromPoint = () => freshHoverCard;
    const removedToolbarPill = overlayRoot.querySelector('[data-toolbar-script="pack:chaban-bookmarklets/old_removed"]');
    assert.ok(removedToolbarPill);
    removedToolbarPill.dispatchEvent({
        type: 'pointerdown',
        pointerId: 32,
        button: 0,
        pointerType: 'touch',
        clientX: 120,
        clientY: 110,
        bubbles: true,
    });
    removedToolbarPill.dispatchEvent({
        type: 'pointermove',
        pointerId: 32,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    assert.equal(librarySection.classList.contains('drop-active-zone'), true);
    assert.equal(dragHint.textContent, 'Unpin "Legacy" from Toolbar');
    removedToolbarPill.dispatchEvent({
        type: 'pointerup',
        pointerId: 32,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    const afterTouchUnpinLayout = stateChanges.filter((c) => c.layout).pop().layout;
    assert.equal(
        afterTouchUnpinLayout.some((n) => n.type === 'script' && n.scriptId === 'pack:chaban-bookmarklets/old_removed'),
        false
    );

    // Touch drag library-script and toolbar-folder over .bt-library-section are no-ops
    const changesBeforeTouchIgnored = stateChanges.length;
    const touchLibGrip = overlayRoot
        .querySelector('[data-library-card="pack:chaban-bookmarklets/approve_all"]')
        .querySelector('.bt-grip');
    overlayRoot.elementFromPoint = () => librarySection;
    touchLibGrip.dispatchEvent({
        type: 'pointerdown',
        pointerId: 33,
        button: 0,
        pointerType: 'touch',
        clientX: 40,
        clientY: 420,
        bubbles: true,
    });
    touchLibGrip.dispatchEvent({
        type: 'pointermove',
        pointerId: 33,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    assert.equal(librarySection.classList.contains('drop-active-zone'), false);
    touchLibGrip.dispatchEvent({
        type: 'pointerup',
        pointerId: 33,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    assert.equal(stateChanges.length, changesBeforeTouchIgnored);

    const touchFolderPill = overlayRoot.querySelector('[data-folder-pill="folder:edit"]');
    touchFolderPill.dispatchEvent({
        type: 'pointerdown',
        pointerId: 34,
        button: 0,
        pointerType: 'touch',
        clientX: 180,
        clientY: 110,
        bubbles: true,
    });
    touchFolderPill.dispatchEvent({
        type: 'pointermove',
        pointerId: 34,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    assert.equal(librarySection.classList.contains('drop-active-zone'), false);
    touchFolderPill.dispatchEvent({
        type: 'pointerup',
        pointerId: 34,
        pointerType: 'touch',
        clientX: 160,
        clientY: 420,
        bubbles: true,
    });
    assert.equal(stateChanges.length, changesBeforeTouchIgnored);

    ui.destroy();
});

test('Dock renders two-tier center, left/right horizontal ordering, vertical corner header/list ordering, and zero-shift/animation CSS', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );

    // Zero-shift & animation CSS invariants
    assert.match(uiSource, /\.bt-toolbar-dock\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*padding:\s*4px;/s);
    assert.doesNotMatch(uiSource, /\.bt-toolbar-dock-collapsed\s*\{[^}]*padding:\s*4px\s+6px;/s);
    assert.match(uiSource, /\.bt-dock-anchor-pill\s*\{[^}]*padding:\s*4px;/s);
    assert.match(uiSource, /\.bt-dock-items-bar\s*\{[^}]*position:\s*fixed;/s);
    assert.match(uiSource, /200ms\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
    assert.match(uiSource, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.doesNotMatch(uiSource, /\.bt-dock-vertical-list\s*,\s*[\s\S]*?\.bt-dock-anim-item/);
    assert.match(uiSource, /\.bt-dock-animate-expand\.bt-dock-vertical\.bt-dock-edge-top\s+\.bt-dock-anim-item\s*\{/);
    assert.match(uiSource, /\.bt-dock-animate-expand\.bt-dock-vertical\.bt-dock-edge-bottom\s+\.bt-dock-anim-item\s*\{/);

    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 1280;
    win.innerHeight = 800;

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            settings: {
                hotkey: 'Alt+B',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
                dockSitePositions: { 'https://musicbrainz.org': 'bottom-center' },
            },
        }),
        callbacks: {},
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    const dockContainer = toolbarRoot.getElementById('bt-toolbar-container');

    const getBtnSummary = (rootEl) =>
        rootEl.querySelectorAll('button').map((b) =>
            b.classList.contains('bt-dock-handle')
                ? 'HANDLE'
                : b.dataset.action === 'open-palette'
                  ? 'PALETTE'
                  : b.dataset.action === 'open-overflow'
                    ? 'MORE'
                    : b.dataset.scriptId || b.dataset.folderId
        );

    // 1. bottom-center: two-tier (.bt-dock-anchor-pill with HANDLE + .bt-dock-items-bar with [⌘, ...scripts])
    const anchorPill = dockContainer.querySelector('.bt-dock-anchor-pill');
    const itemsBar = dockContainer.querySelector('.bt-dock-items-bar');
    assert.ok(anchorPill, 'Expected .bt-dock-anchor-pill on bottom-center');
    assert.ok(itemsBar, 'Expected .bt-dock-items-bar on expanded bottom-center');
    assert.ok(anchorPill.querySelector('.bt-dock-handle'));
    assert.equal(itemsBar.querySelector('.bt-dock-handle'), null);
    assert.deepEqual(getBtnSummary(itemsBar), [
        'PALETTE',
        'pack:chaban-bookmarklets/approve_all',
        'pack:chaban-bookmarklets/old_removed',
        'folder:edit',
    ]);

    // Collapsed bottom-center keeps anchor pill and removes items bar
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockSiteExpanded: { 'https://musicbrainz.org': false },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-center' },
        },
    });
    assert.ok(dockContainer.querySelector('.bt-dock-anchor-pill'));
    assert.equal(dockContainer.querySelector('.bt-dock-items-bar'), null);

    // 2. bottom-left horizontal: [⚡, ⌘, ...scripts]
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'horizontal',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-left' },
        },
    });
    assert.equal(dockContainer.querySelector('.bt-dock-items-bar'), null);
    assert.deepEqual(getBtnSummary(dockContainer), [
        'HANDLE',
        'PALETTE',
        'pack:chaban-bookmarklets/approve_all',
        'pack:chaban-bookmarklets/old_removed',
        'folder:edit',
    ]);

    // 3. bottom-right horizontal: [...scripts, ⌘, ⚡]
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'horizontal',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-right' },
        },
    });
    assert.deepEqual(getBtnSummary(dockContainer), [
        'pack:chaban-bookmarklets/approve_all',
        'pack:chaban-bookmarklets/old_removed',
        'folder:edit',
        'PALETTE',
        'HANDLE',
    ]);

    // 4. top-right vertical: header [⌘, ⚡] FIRST (flex-end) + vertical script list SECOND
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'vertical',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'top-right' },
        },
    });
    assert.equal(dockContainer.classList.contains('bt-dock-vertical'), true);
    assert.equal(dockContainer.children.length, 2);
    assert.equal(dockContainer.children[0].classList.contains('bt-dock-header'), true);
    assert.equal(dockContainer.children[0].classList.contains('bt-dock-header-end'), true);
    assert.equal(dockContainer.children[1].classList.contains('bt-dock-vertical-list'), true);
    assert.deepEqual(getBtnSummary(dockContainer.children[0]), ['PALETTE', 'HANDLE']);
    assert.deepEqual(getBtnSummary(dockContainer.children[1]), [
        'pack:chaban-bookmarklets/approve_all',
        'pack:chaban-bookmarklets/old_removed',
        'folder:edit',
    ]);

    // 5. bottom-right vertical: vertical script list FIRST + header [⌘, ⚡] LAST (pinned to bottom-right)
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'vertical',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-right' },
        },
    });
    assert.equal(dockContainer.children[0].classList.contains('bt-dock-vertical-list'), true);
    assert.equal(dockContainer.children[1].classList.contains('bt-dock-header'), true);
    assert.equal(dockContainer.children[1].classList.contains('bt-dock-header-end'), true);
    assert.deepEqual(getBtnSummary(dockContainer.children[1]), ['PALETTE', 'HANDLE']);

    // 6. bottom-left vertical: vertical script list FIRST + header [⚡, ⌘] LAST (flex-start)
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'vertical',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-left' },
        },
    });
    assert.equal(dockContainer.children[0].classList.contains('bt-dock-vertical-list'), true);
    assert.equal(dockContainer.children[1].classList.contains('bt-dock-header'), true);
    assert.equal(dockContainer.children[1].classList.contains('bt-dock-header-start'), true);
    assert.deepEqual(getBtnSummary(dockContainer.children[1]), ['HANDLE', 'PALETTE']);

    ui.destroy();
});

test('Hybrid scope updates global defaults with per-site overrides, Auto rotates on resize/orientationchange, and destroy cleans listeners', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 1280;
    win.innerHeight = 800;

    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            localScripts: {
                'local:all': {
                    id: 'local:all',
                    source: 'local',
                    name: 'All Sites Helper',
                    match: ['*://*/*'],
                    code: 'void 0;',
                },
            },
            layout: [
                { type: 'script', scriptId: 'local:all' },
                { type: 'script', scriptId: 'pack:chaban-bookmarklets/approve_all' },
            ],
        }),
        callbacks: {
            onStateChange(partial) {
                stateChanges.push(partial);
            },
        },
    });

    const toolbarHost = ui.getToolbarHost();
    const toolbarRoot = ui.getToolbarShadowRoot();
    const dockContainer = toolbarRoot.getElementById('bt-toolbar-container');

    // 1. Dragging handle to top-right saves BOTH dockSitePositions[origin] AND dockDefaultPosition
    const handle = toolbarRoot.querySelector('.bt-dock-handle');
    handle.dispatchEvent({
        type: 'pointerdown',
        pointerId: 1,
        button: 0,
        pointerType: 'mouse',
        clientX: 640,
        clientY: 770,
        bubbles: true,
    });
    handle.dispatchEvent({
        type: 'pointermove',
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 1240,
        clientY: 32,
        bubbles: true,
    });
    handle.dispatchEvent({
        type: 'pointerup',
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 1240,
        clientY: 32,
        bubbles: true,
    });

    const afterSnapSettings = stateChanges.at(-1).settings;
    assert.equal(afterSnapSettings.dockSitePositions['https://musicbrainz.org'], 'top-right');
    assert.equal(afterSnapSettings.dockDefaultPosition, 'top-right');

    // New uncustomized origin inherits dockDefaultPosition ('top-right')
    ui.update({ url: 'https://example.org/test' });
    assert.equal(toolbarHost.dataset.snapZone, 'top-right');

    // 2. Settings Orientation buttons update both dockSiteOrientations[origin] and dockOrientation
    ui.openSettings();
    const overlayRoot = ui.getOverlayShadowRoot();
    const autoBtn = overlayRoot.querySelector('[data-dock-orientation="auto"]');
    const horizBtn = overlayRoot.querySelector('[data-dock-orientation="horizontal"]');
    const vertBtn = overlayRoot.querySelector('[data-dock-orientation="vertical"]');
    assert.ok(autoBtn && horizBtn && vertBtn, 'Expected Auto | Horiz | Vert orientation buttons');
    assert.equal(autoBtn.getAttribute('aria-pressed'), 'true');

    vertBtn.click();
    const afterVertSettings = stateChanges.at(-1).settings;
    assert.equal(afterVertSettings.dockSiteOrientations['https://example.org'], 'vertical');
    assert.equal(afterVertSettings.dockOrientation, 'vertical');
    assert.equal(dockContainer.dataset.orientation, 'vertical');
    assert.equal(vertBtn.getAttribute('aria-pressed'), 'true');

    // Switch back to Auto: landscape (1280x800) -> horizontal, portrait (412x924) -> vertical on resize
    autoBtn.click();
    assert.equal(stateChanges.at(-1).settings.dockSiteOrientations['https://example.org'], 'auto');
    assert.equal(stateChanges.at(-1).settings.dockOrientation, 'auto');
    assert.equal(dockContainer.dataset.orientation, 'horizontal');

    win.innerWidth = 412;
    win.innerHeight = 924;
    win.dispatchEvent({ type: 'resize' });
    assert.equal(dockContainer.dataset.orientation, 'vertical');
    assert.equal(dockContainer.classList.contains('bt-dock-vertical'), true);

    // Rotating back to landscape via orientationchange updates back to horizontal
    win.innerWidth = 924;
    win.innerHeight = 412;
    win.dispatchEvent({ type: 'orientationchange' });
    assert.equal(dockContainer.dataset.orientation, 'horizontal');
    assert.equal(dockContainer.classList.contains('bt-dock-horizontal'), true);

    // At *-center, effective orientation stays horizontal even on portrait 412x924 with Vert selected
    vertBtn.click();
    win.innerWidth = 412;
    win.innerHeight = 924;
    ui.update({
        settings: {
            ...stateChanges.at(-1).settings,
            dockSitePositions: { 'https://example.org': 'bottom-center' },
        },
    });
    assert.equal(dockContainer.dataset.orientation, 'horizontal');
    assert.equal(dockContainer.classList.contains('bt-dock-center'), true);

    ui.destroy();
    assert.equal(win._listeners.get('resize')?.size || 0, 0);
    assert.equal(win._listeners.get('orientationchange')?.size || 0, 0);
});

test('Pixel-budget More » overflow menu runs overflowed scripts, expands folders inline, places More » last in vertical, and opens sideways dropdowns', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 412;
    win.innerHeight = 924;

    const ranScripts = [];
    const manyLocalScripts = {};
    const layout = [];
    for (let i = 1; i <= 7; i += 1) {
        const sid = `local:s${i}`;
        manyLocalScripts[sid] = {
            id: sid,
            source: 'local',
            name: `Action Script Number ${i}`,
            match: ['*://*.musicbrainz.org/*'],
            code: 'void 0;',
        };
        layout.push({ type: 'script', scriptId: sid });
    }
    manyLocalScripts['local:folder_child_a'] = {
        id: 'local:folder_child_a',
        source: 'local',
        name: 'Folder Child Alpha',
        match: ['*://*.musicbrainz.org/*'],
        code: 'void 0;',
    };
    manyLocalScripts['local:folder_child_b'] = {
        id: 'local:folder_child_b',
        source: 'local',
        name: 'Folder Child Beta',
        match: ['*://*.musicbrainz.org/*'],
        code: 'void 0;',
    };
    layout.push({
        type: 'folder',
        id: 'folder:tools',
        name: 'Tools',
        items: [
            { type: 'script', scriptId: 'local:folder_child_a' },
            { type: 'script', scriptId: 'local:folder_child_b' },
        ],
    });

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            localScripts: manyLocalScripts,
            layout,
            settings: {
                hotkey: 'Alt+B',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
                dockSitePositions: { 'https://musicbrainz.org': 'bottom-center' },
            },
        }),
        callbacks: {
            onRunScript(scriptId) {
                ranScripts.push(scriptId);
            },
        },
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    const dockContainer = toolbarRoot.getElementById('bt-toolbar-container');

    // 1. Horizontal overflow at 412px bottom-center produces More » button
    const itemsBar = dockContainer.querySelector('.bt-dock-items-bar');
    assert.ok(itemsBar);
    const moreBtn = itemsBar.querySelector('[data-action="open-overflow"]');
    assert.ok(moreBtn, 'Expected More » overflow button when items exceed 412px width');
    assert.equal(moreBtn.textContent, 'More »');
    assert.match(moreBtn.title, /^\d+ more items$/);
    // ⌘ remains first in .bt-dock-items-bar
    assert.equal(itemsBar.querySelectorAll('button')[0].dataset.action, 'open-palette');

    // Clicking More » opens .bt-dropdown with overflowed scripts & folder toggle
    moreBtn.click();
    const overflowMenu = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(overflowMenu, 'Expected .bt-dropdown when More » is clicked');
    assert.equal(toolbarRoot.querySelectorAll('.bt-dropdown').length, 1);

    // Click overflowed 📁 Tools folder to expand its items inline inside the SAME More » dropdown
    const overflowFolderBtn = overflowMenu.querySelector('[data-overflow-folder-id="folder:tools"]');
    assert.ok(overflowFolderBtn, 'Expected overflowed Tools folder toggle inside More » menu');
    assert.equal(overflowFolderBtn.getAttribute('aria-expanded'), 'false');
    assert.equal(overflowMenu.querySelector('[data-script-id="local:folder_child_a"]'), null);

    overflowFolderBtn.click();
    const expandedMenu = toolbarRoot.querySelector('.bt-dropdown');
    assert.equal(toolbarRoot.querySelectorAll('.bt-dropdown').length, 1, 'Folder must expand inline in same dropdown');
    assert.equal(
        expandedMenu.querySelector('[data-overflow-folder-id="folder:tools"]').getAttribute('aria-expanded'),
        'true'
    );
    const inlineChildA = expandedMenu.querySelector('[data-script-id="local:folder_child_a"]');
    assert.ok(inlineChildA, 'Expected Folder Child Alpha revealed inline inside More »');

    // Toggle folder back closed, then re-open and click inline child to execute
    expandedMenu.querySelector('[data-overflow-folder-id="folder:tools"]').click();
    assert.equal(toolbarRoot.querySelector('[data-script-id="local:folder_child_a"]'), null);
    toolbarRoot.querySelector('[data-overflow-folder-id="folder:tools"]').click();
    toolbarRoot.querySelector('[data-script-id="local:folder_child_a"]').click();
    assert.deepEqual(ranScripts, ['local:folder_child_a']);
    assert.equal(toolbarRoot.querySelector('.bt-dropdown'), null);

    // Re-open More » and click an overflowed top-level script
    toolbarRoot.querySelector('[data-action="open-overflow"]').click();
    const reopenedOverflowMenu = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(reopenedOverflowMenu);
    const overflowScriptBtn = reopenedOverflowMenu.querySelector('[data-script-id="local:s7"]');
    assert.ok(overflowScriptBtn);
    overflowScriptBtn.click();
    assert.deepEqual(ranScripts, ['local:folder_child_a', 'local:s7']);

    // 2. Vertical mode overflow on constrained height (260px) puts More » LAST in vertical list
    win.innerHeight = 260;
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'vertical',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-right' },
        },
    });
    const vertList = dockContainer.querySelector('.bt-dock-vertical-list');
    assert.ok(vertList);
    const vertButtons = vertList.querySelectorAll('button');
    assert.equal(
        vertButtons[vertButtons.length - 1].dataset.action,
        'open-overflow',
        'More » must be placed last at bottom of vertical script list'
    );

    // 3. Vertical sideways folder dropdowns open beside the vertical column
    win.innerHeight = 924;
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'vertical',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-right' },
        },
    });
    toolbarRoot.querySelector('[data-folder-id="folder:tools"]').click();
    let sideMenu = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(sideMenu);
    assert.equal(sideMenu.classList.contains('bt-dropdown-vertical'), true);
    assert.equal(sideMenu.classList.contains('bt-dropdown-side-left'), true);
    assert.equal(sideMenu.classList.contains('bt-dropdown-side-bottom'), true);

    // Clamp vertical sideways dropdowns within 8px of top/bottom/left/right viewport edges
    let mockSideRect = { left: 250, right: 440, width: 190, top: 820, bottom: 960, height: 140 };
    const origCreateDiv = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
        const el = origCreateDiv(tag);
        if (String(tag).toLowerCase() === 'div') {
            const origRect = el.getBoundingClientRect.bind(el);
            el.getBoundingClientRect = () =>
                el.classList.contains('bt-dropdown-vertical') ? mockSideRect : origRect();
        }
        return el;
    };

    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'vertical',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'top-left' },
        },
    });
    sideMenu = toolbarRoot.querySelector('.bt-dropdown');
    assert.ok(sideMenu);
    assert.equal(sideMenu.classList.contains('bt-dropdown-vertical'), true);
    assert.equal(sideMenu.classList.contains('bt-dropdown-side-right'), true);
    assert.equal(sideMenu.classList.contains('bt-dropdown-side-top'), true);
    assert.equal(sideMenu.style.marginLeft, '-36px');
    assert.equal(sideMenu.style.marginTop, '-44px');

    mockSideRect = { left: -12, right: 178, width: 190, top: -6, bottom: 134, height: 140 };
    ui.update({
        settings: {
            hotkey: 'Alt+B',
            dockOrientation: 'vertical',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            dockSitePositions: { 'https://musicbrainz.org': 'bottom-right' },
        },
    });
    sideMenu = toolbarRoot.querySelector('.bt-dropdown');
    assert.equal(sideMenu.classList.contains('bt-dropdown-side-left'), true);
    assert.equal(sideMenu.classList.contains('bt-dropdown-side-bottom'), true);
    assert.equal(sideMenu.style.marginRight, '-20px');
    assert.equal(sideMenu.style.marginBottom, '-14px');

    ui.destroy();
});

test('bt-dock-animate-expand is applied only after overflow measurement and viewport clamping', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 412;
    win.innerHeight = 924;

    const observedAnimateFlagDuringMeasure = [];
    let dockContainerRef = null;
    const origCreateEl = doc.createElement.bind(doc);
    doc.createElement = (tag) => {
        const el = origCreateEl(tag);
        if (String(tag).toLowerCase() === 'button') {
            el.offsetWidth = 90;
            el.offsetHeight = 26;
            el.getBoundingClientRect = () => {
                if (dockContainerRef && el.dataset.scriptId) {
                    observedAnimateFlagDuringMeasure.push(
                        dockContainerRef.classList.contains('bt-dock-animate-expand')
                    );
                }
                return { left: 0, top: 0, width: 90, height: 26, right: 90, bottom: 26 };
            };
        }
        return el;
    };

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            settings: {
                hotkey: 'Alt+B',
                dockSiteExpanded: { 'https://musicbrainz.org': false },
                dockSitePositions: { 'https://musicbrainz.org': 'bottom-center' },
            },
        }),
        callbacks: {},
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    dockContainerRef = toolbarRoot.getElementById('bt-toolbar-container');
    assert.equal(dockContainerRef.classList.contains('bt-dock-animate-expand'), false);

    // Transition collapsed -> expanded: measurement must see unscaled dock (no bt-dock-animate-expand),
    // while final rendered container receives bt-dock-animate-expand afterwards.
    toolbarRoot.querySelector('.bt-dock-handle').click();

    assert.ok(observedAnimateFlagDuringMeasure.length >= 2, 'Expected script buttons to be measured');
    assert.deepEqual(
        observedAnimateFlagDuringMeasure,
        observedAnimateFlagDuringMeasure.map(() => false),
        'bt-dock-animate-expand must not be present during partitionDockOverflow measurement'
    );
    assert.equal(
        dockContainerRef.classList.contains('bt-dock-animate-expand'),
        true,
        'bt-dock-animate-expand must be applied after measurement on collapsed -> expanded transition'
    );

    // Clicking folder while already expanded must not re-apply bt-dock-animate-expand
    toolbarRoot.querySelector('[data-folder-id="folder:edit"]').click();
    assert.equal(dockContainerRef.classList.contains('bt-dock-animate-expand'), false);

    ui.destroy();
});

test('positionPopoverInViewport resets maxHeight and runs after all library cards mount and managerBody.scrollTop restores', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 800;
    win.innerHeight = 600;

    let observedMaxHeightBeforeMeasure = null;
    const directPop = doc.createElement('div');
    directPop.className = 'bt-popover';
    directPop.style.maxHeight = '120px';
    directPop.getBoundingClientRect = () => {
        observedMaxHeightBeforeMeasure = directPop.style.maxHeight;
        return { width: 288, height: 220, top: 0, left: 0, right: 288, bottom: 220 };
    };
    const directBtn = doc.createElement('button');
    directBtn.getBoundingClientRect = () => ({
        top: 500,
        bottom: 520,
        left: 100,
        right: 120,
        width: 20,
        height: 20,
    });
    UI.positionPopoverInViewport(directPop, directBtn, win, doc);
    assert.equal(
        observedMaxHeightBeforeMeasure,
        '',
        'positionPopoverInViewport must clear maxHeight before measuring popover rect'
    );

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
        }),
        callbacks: {},
    });

    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const managerBody = overlayRoot.querySelector('.bt-manager-body');
    const libraryGrid = overlayRoot.getElementById('library-grid');
    const expectedCards = libraryGrid.children.length;
    assert.equal(expectedCards, 4);

    // Model real browser behavior where emptying #library-grid clamps scrollTop back to 0
    const origReplaceChildren = libraryGrid.replaceChildren.bind(libraryGrid);
    libraryGrid.replaceChildren = (...nodes) => {
        origReplaceChildren(...nodes);
        if (nodes.length === 0) {
            managerBody.scrollTop = 0;
        }
    };

    let gridLenAtMeasure = null;
    let scrollTopAtMeasure = null;
    const firstInfoBtn = libraryGrid
        .querySelectorAll('.bt-library-card')[0]
        .querySelectorAll('button')
        .find((b) => b.textContent === 'ⓘ');
    assert.ok(firstInfoBtn);
    firstInfoBtn.getBoundingClientRect = () => {
        gridLenAtMeasure = libraryGrid.children.length;
        scrollTopAtMeasure = managerBody.scrollTop;
        return { top: 460, bottom: 480, left: 200, right: 220, width: 20, height: 20 };
    };

    managerBody.scrollTop = 180;
    firstInfoBtn.click();

    assert.equal(
        gridLenAtMeasure,
        expectedCards,
        'positionPopoverInViewport must run after all library cards are appended'
    );
    assert.equal(
        scrollTopAtMeasure,
        180,
        'positionPopoverInViewport must run after managerBody.scrollTop is restored'
    );

    ui.destroy();
});

test('Dropdown hover bridge CSS covers 6px gap and hover-mode mouseleave stays open while dropdown is open', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );

    assert.match(uiSource, /\.bt-dropdown::before\s*\{/);
    assert.match(uiSource, /\.bt-dropdown-up::before\s*\{/);
    assert.match(uiSource, /\.bt-dropdown-vertical\.bt-dropdown-side-right::before\s*\{/);
    assert.match(uiSource, /\.bt-dropdown-vertical\.bt-dropdown-side-left::before\s*\{/);
    assert.match(uiSource, /\.bt-dropdown-scroll\s*\{[^}]*overflow-y:\s*auto;/s);

    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            settings: {
                hotkey: 'Alt+B',
                dockExpandMode: 'hover',
            },
        }),
        callbacks: {},
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    const dockContainer = toolbarRoot.getElementById('bt-toolbar-container');

    dockContainer.dispatchEvent({ type: 'mouseenter', bubbles: false });
    const folderBtn = toolbarRoot.querySelector('[data-folder-id="folder:edit"]');
    assert.ok(folderBtn);
    folderBtn.click();
    assert.ok(toolbarRoot.querySelector('.bt-dropdown'));

    // Leaving toolbarContainer while a dropdown is open must not collapse hover-expanded dock
    dockContainer.dispatchEvent({ type: 'mouseleave', bubbles: false });
    assert.ok(
        toolbarRoot.querySelector('.bt-dropdown'),
        'Dropdown and hover-expanded dock must remain open on mouseleave while state.openDropdownId is set'
    );

    // Clicking outside the toolbar dismisses the dropdown and resets hover-expanded state
    doc.body.click();
    assert.equal(toolbarRoot.querySelector('.bt-dropdown'), null);
    assert.equal(toolbarRoot.querySelectorAll('[data-script-id]').length, 0);

    ui.destroy();
});

test('CSP-safe styling uses adoptedStyleSheets and :host snap rules without cssText or <style> tags (#10)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );
    assert.match(uiSource, /:host\(\[data-snap-zone="bottom-center"\]\)/);
    assert.equal(/\.style\.cssText\s*=/.test(uiSource), false, 'UI must never assign .style.cssText');

    // 1. Primary path: CSSStyleSheet + adoptedStyleSheets (0 <style> elements appended)
    {
        const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
        class MockCSSStyleSheet {
            constructor() { this.text = ''; }
            replaceSync(t) { this.text = t; }
        }
        win.CSSStyleSheet = MockCSSStyleSheet;

        const createdShadows = [];
        const origCreateEl = doc.createElement.bind(doc);
        doc.createElement = (tag) => {
            const el = origCreateEl(tag);
            const origAttach = el.attachShadow.bind(el);
            el.attachShadow = (opts) => {
                const sr = origAttach(opts);
                sr.adoptedStyleSheets = [];
                createdShadows.push(sr);
                return sr;
            };
            return el;
        };

        const ui = UI.createToolbarUI({
            doc,
            win,
            initialState: createSampleState({ url: 'https://musicbrainz.org/release/123' }),
            callbacks: {},
        });
        ui.openPalette();

        assert.equal(createdShadows.length, 2);
        for (const sr of createdShadows) {
            assert.equal(sr.adoptedStyleSheets.length, 1);
            assert.ok(sr.adoptedStyleSheets[0] instanceof MockCSSStyleSheet);
            assert.equal(sr.querySelectorAll('style').length, 0);
        }
        const host = ui.getToolbarHost();
        assert.equal(host.getAttribute('data-snap-zone'), 'bottom-center');
        assert.equal(host.style.cssText, '');

        // Clear live drag transform on drop without touching cssText
        UI.createToolbarUI; // keep lint happy
        ui.destroy();
    }

    // 2. Last-resort fallback: gmAddElement when adoptedStyleSheets unavailable and <style> append throws
    {
        const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
        const gmStyleCalls = [];
        const origCreateEl = doc.createElement.bind(doc);
        doc.createElement = (tag) => {
            const el = origCreateEl(tag);
            if (String(tag).toUpperCase() === 'DIV') {
                const origAttach = el.attachShadow.bind(el);
                el.attachShadow = (opts) => {
                    const sr = origAttach(opts);
                    const origAppend = sr.appendChild.bind(sr);
                    sr.appendChild = (child) => {
                        if (child.tagName === 'STYLE') {
                            throw new Error('Refused to apply inline style due to CSP');
                        }
                        return origAppend(child);
                    };
                    return sr;
                };
            }
            return el;
        };

        const ui = UI.createToolbarUI({
            doc,
            win,
            gmAddElement: (parent, tag, attrs) => gmStyleCalls.push({ parent, tag, attrs }),
            initialState: createSampleState({ url: 'https://musicbrainz.org/release/123' }),
            callbacks: {},
        });
        assert.equal(gmStyleCalls.length, 1);
        assert.equal(gmStyleCalls[0].tag, 'style');
        assert.match(gmStyleCalls[0].attrs.textContent, /\.bt-toolbar-dock/);
        ui.destroy();
    }
});

test('Mobile fixes: visualViewport center overflow budget, dock pill polish, sub-modal top-align scroll, and click-only touch toggle (#2, #7, #8, #9)', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );
    assert.match(uiSource, /\.bt-backdrop-sub\s*\{[^}]*align-items:\s*flex-start;[^}]*overflow-y:\s*auto;/s);
    assert.match(uiSource, /\.bt-form-body\s*\{[^}]*overflow-y:\s*auto;[^}]*min-height:\s*0;/s);
    assert.match(uiSource, /\.bt-dock-items-bar\s+\.bt-btn-dark[^{]*\{[^}]*border-radius:\s*9999px;/s);

    // Non-viewport-meta site simulation: doc.documentElement.clientWidth is 980, visualViewport.width is 412
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 980;
    win.innerHeight = 1800;
    doc.documentElement.clientWidth = 980;
    doc.documentElement.clientHeight = 1800;
    win.visualViewport = { width: 412, height: 780 };

    const layout = Array.from({ length: 8 }, (_, i) => ({
        type: 'script',
        scriptId: `local:s${i}`,
    }));
    const localScripts = {};
    layout.forEach((n, i) => {
        localScripts[n.scriptId] = {
            id: n.scriptId,
            source: 'local',
            name: `Action Script ${i}`,
            label: `Action ${i}`,
            match: ['*://*.musicbrainz.org/*'],
            code: 'void 0;',
        };
    });

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            packs: {},
            localScripts,
            layout,
            settings: {
                hotkey: 'Alt+B',
                dockDefaultPosition: 'top-center',
                dockSiteExpanded: { 'https://musicbrainz.org': true },
            },
        }),
        callbacks: {},
    });

    // Overflow triggers based on visualViewport 412px budget rather than 980px layout viewport
    const toolbarRoot = ui.getToolbarShadowRoot();
    assert.ok(toolbarRoot.querySelector('[data-action="open-overflow"]'), 'Expected More » under 412px visualViewport budget');

    // #9 Touch tap toggle: pointerdown + pointerup does NOT toggle on pointerup; synthesized delayed click toggles ONCE
    const h1 = toolbarRoot.querySelector('.bt-dock-handle');
    h1.dispatchEvent({ type: 'pointerdown', pointerId: 1, button: 0, pointerType: 'touch', clientX: 200, clientY: 20, bubbles: true });
    h1.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 20, bubbles: true });
    // Still expanded until click fires!
    assert.ok(toolbarRoot.querySelector('[data-action="open-overflow"]'), 'pointerup alone must not double-toggle before synthesized click');
    await new Promise((r) => setTimeout(r, 15));
    h1.click();
    assert.equal(toolbarRoot.querySelector('[data-action="open-overflow"]'), null, 'Single delayed click after tap closes dock once');

    // Reopen on tap 2
    const h2 = toolbarRoot.querySelector('.bt-dock-handle');
    h2.dispatchEvent({ type: 'pointerdown', pointerId: 2, button: 0, pointerType: 'touch', clientX: 200, clientY: 20, bubbles: true });
    h2.dispatchEvent({ type: 'pointerup', pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 20, bubbles: true });
    await new Promise((r) => setTimeout(r, 15));
    h2.click();
    assert.ok(toolbarRoot.querySelector('[data-action="open-overflow"]'), 'Second tap opens dock cleanly');

    // Drag > 6px suppresses synthesized click within 400ms
    const h3 = toolbarRoot.querySelector('.bt-dock-handle');
    h3.dispatchEvent({ type: 'pointerdown', pointerId: 3, button: 0, pointerType: 'touch', clientX: 200, clientY: 20, bubbles: true });
    h3.dispatchEvent({ type: 'pointermove', pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 750, bubbles: true });
    h3.dispatchEvent({ type: 'pointerup', pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 750, bubbles: true });
    await new Promise((r) => setTimeout(r, 15));
    (toolbarRoot.querySelector('.bt-dock-handle') || h3).click();
    assert.ok(toolbarRoot.querySelector('[data-action="open-overflow"]'), 'Post-drag compatibility click must be suppressed');

    ui.destroy();
});

test('Input keystroke isolation stops printable keys from bubbling to host while keeping Shadow DOM Escape & hotkeys (#1)', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const hostKeyEvents = [];
    for (const type of ['keydown', 'keyup', 'keypress']) {
        doc.addEventListener(type, (ev) => hostKeyEvents.push({ type, key: ev.key }));
    }

    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({ url: 'https://musicbrainz.org/release/123' }),
        callbacks: {},
    });

    ui.openPalette();
    const overlayRoot = ui.getOverlayShadowRoot();
    const paletteSearch = overlayRoot.getElementById('palette-search');
    for (const type of ['keydown', 'keyup', 'keypress']) {
        paletteSearch.dispatchEvent({ type, key: 'j', bubbles: true });
    }
    assert.equal(hostKeyEvents.length, 0, 'Expected Palette input keys not to leak to host doc');

    // Escape still closes Palette
    paletteSearch.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(overlayRoot.getElementById('palette-backdrop').classList.contains('hidden'), true);

    ui.openManager();
    const mgrSearch = overlayRoot.getElementById('mgr-search');
    for (const type of ['keydown', 'keyup', 'keypress']) {
        mgrSearch.dispatchEvent({ type, key: '/', bubbles: true });
    }
    overlayRoot.getElementById('btn-new-local').click();
    const edCode = overlayRoot.getElementById('ed-code');
    for (const type of ['keydown', 'keyup', 'keypress']) {
        edCode.dispatchEvent({ type, key: ' ', bubbles: true });
    }
    assert.equal(hostKeyEvents.length, 0, 'Expected Manager & Editor input keys not to leak to host doc');

    // Escape inside editor still closes Editor sub-modal
    edCode.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(overlayRoot.getElementById('editor-backdrop').classList.contains('hidden'), true);

    ui.destroy();
});

test('keepFolderOpenAfterRun keeps folder and More » dropdowns open after running a script (#15)', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 340; // Force More » overflow alongside folder
    win.innerHeight = 800;

    const layout = [
        { type: 'folder', id: 'folder:edit', name: 'Edit', items: [{ scriptId: 'pack:chaban-bookmarklets/approve_all' }] },
        { type: 'script', scriptId: 'local:extra1' },
        { type: 'script', scriptId: 'local:extra2' },
        { type: 'script', scriptId: 'local:extra3' },
    ];
    const baseState = createSampleState({
        url: 'https://musicbrainz.org/release/123',
        layout,
        localScripts: {
            'local:extra1': { id: 'local:extra1', source: 'local', name: 'Extra 1', match: ['*://*.musicbrainz.org/*'], code: 'void 0;' },
            'local:extra2': { id: 'local:extra2', source: 'local', name: 'Extra 2', match: ['*://*.musicbrainz.org/*'], code: 'void 0;' },
            'local:extra3': { id: 'local:extra3', source: 'local', name: 'Extra 3', match: ['*://*.musicbrainz.org/*'], code: 'void 0;' },
        },
        settings: {
            hotkey: 'Alt+B',
            dockDefaultPosition: 'top-left',
            dockOrientation: 'horizontal',
            dockSiteExpanded: { 'https://musicbrainz.org': true },
            keepFolderOpenAfterRun: true,
        },
    });

    const ran = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: baseState,
        callbacks: { onRunScript: (id) => ran.push(id) },
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    toolbarRoot.querySelector('[data-folder-id="folder:edit"]').click();
    assert.ok(toolbarRoot.querySelector('.bt-dropdown'));
    toolbarRoot.querySelector('.bt-dropdown').querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all"]').click();
    assert.equal(ran.length, 1);
    assert.ok(toolbarRoot.querySelector('.bt-dropdown'), 'Folder dropdown stays open when keepFolderOpenAfterRun is true');

    // Also applies to More » overflow menu
    toolbarRoot.querySelector('[data-action="open-overflow"]').click();
    const overflowBtn = toolbarRoot.querySelector('.bt-dropdown').querySelector('[data-script-id]');
    assert.ok(overflowBtn);
    overflowBtn.click();
    assert.equal(ran.length, 2);
    assert.ok(toolbarRoot.querySelector('.bt-dropdown'), 'More » dropdown stays open when keepFolderOpenAfterRun is true');

    // Turning setting off restores auto-close on script run
    ui.update({ settings: { keepFolderOpenAfterRun: false } });
    toolbarRoot.querySelector('.bt-dropdown').querySelector('[data-script-id]').click();
    assert.equal(toolbarRoot.querySelector('.bt-dropdown'), null);

    ui.destroy();
});

test('folderHoverOpen opens folders & More » after hover intent and hover grace delay prevents premature collapse (#16, #17)', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );
    assert.match(uiSource, /\.bt-toolbar-dock:not\(\.bt-toolbar-dock-collapsed\)::before/);
    assert.doesNotMatch(uiSource, /\.bt-toolbar-dock-collapsed::before/);

    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    win.innerWidth = 340;
    win.innerHeight = 800;

    const layout = [
        { type: 'folder', id: 'folder:edit', name: 'Edit', items: [{ scriptId: 'pack:chaban-bookmarklets/approve_all' }] },
        { type: 'script', scriptId: 'local:extra1' },
        { type: 'script', scriptId: 'local:extra2' },
        { type: 'script', scriptId: 'local:extra3' },
    ];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            layout,
            localScripts: {
                'local:extra1': { id: 'local:extra1', source: 'local', name: 'Extra 1', match: ['*://*.musicbrainz.org/*'], code: 'void 0;' },
                'local:extra2': { id: 'local:extra2', source: 'local', name: 'Extra 2', match: ['*://*.musicbrainz.org/*'], code: 'void 0;' },
                'local:extra3': { id: 'local:extra3', source: 'local', name: 'Extra 3', match: ['*://*.musicbrainz.org/*'], code: 'void 0;' },
            },
            settings: {
                hotkey: 'Alt+B',
                dockDefaultPosition: 'top-left',
                dockOrientation: 'horizontal',
                dockExpandMode: 'hover',
                folderHoverOpen: true,
            },
        }),
        callbacks: {},
    });

    const toolbarRoot = ui.getToolbarShadowRoot();
    const dockContainer = toolbarRoot.getElementById('bt-toolbar-container');

    // Expand dock on hover, then verify 400ms grace delay cancels collapse on quick re-entry
    dockContainer.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.ok(toolbarRoot.querySelector('[data-folder-id="folder:edit"]'));
    dockContainer.dispatchEvent({ type: 'mouseleave', bubbles: false });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(toolbarRoot.querySelector('[data-folder-id="folder:edit"]'), 'Dock must stay expanded during 400ms grace period');
    dockContainer.dispatchEvent({ type: 'mouseenter', bubbles: false });
    await new Promise((r) => setTimeout(r, 350));
    assert.ok(toolbarRoot.querySelector('[data-folder-id="folder:edit"]'), 'Re-entering must cancel collapse timer');

    // Folder hover intent (~120ms): leaving early cancels, holding >= 120ms opens dropdown
    const folderBtn = toolbarRoot.querySelector('[data-folder-id="folder:edit"]');
    folderBtn.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.equal(toolbarRoot.querySelector('.bt-dropdown'), null);
    folderBtn.dispatchEvent({ type: 'mouseleave', bubbles: false });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(toolbarRoot.querySelector('.bt-dropdown'), null, 'Early mouseleave cancels folder hover intent');

    folderBtn.dispatchEvent({ type: 'mouseenter', bubbles: false });
    await new Promise((r) => setTimeout(r, 160));
    assert.ok(toolbarRoot.querySelector('.bt-dropdown'), 'Holding hover opens folder dropdown');

    // Click toggle still closes folder even when folderHoverOpen is true
    toolbarRoot.querySelector('[data-folder-id="folder:edit"]').click();
    assert.equal(toolbarRoot.querySelector('.bt-dropdown'), null);

    // More » also supports hover-open
    const moreBtn = toolbarRoot.querySelector('[data-action="open-overflow"]');
    moreBtn.dispatchEvent({ type: 'mouseenter', bubbles: false });
    await new Promise((r) => setTimeout(r, 160));
    assert.ok(toolbarRoot.querySelector('.bt-dropdown'), 'Hovering More » opens overflow dropdown');

    // Leaving past 400ms collapses dock when no dropdown stays active
    toolbarRoot.querySelector('[data-action="open-overflow"]').click();
    dockContainer.dispatchEvent({ type: 'mouseleave', bubbles: false });
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(toolbarRoot.querySelectorAll('[data-folder-id]').length, 0);

    ui.destroy();
});

test('Standalone Settings modal, streamlined Manager header, portrait sticky disable, dimming (#13), and truncated pack badges (#5, #12, #14, #18)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const uiSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'BookmarkletToolbarUI.js'),
        'utf8'
    );
    assert.match(uiSource, /@media\s*\(max-width:\s*600px\),\s*\(max-height:\s*760px\)\s*\{[^}]*\.bt-sticky-section\s*\{[^}]*position:\s*static;/s);
    assert.match(uiSource, /\.bt-badge\s*\{[^}]*max-width:[^;]+;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    assert.match(uiSource, /\.bt-pill-dimmed\s*\{/);

    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            packs: {
                'chaban-bookmarklets': {
                    id: 'chaban-bookmarklets',
                    name: 'Chaban Extraordinarily Long Pack Name',
                    version: '2026.11.24',
                    scripts: {
                        'pack:chaban-bookmarklets/mb_match': {
                            id: 'pack:chaban-bookmarklets/mb_match',
                            source: 'pack:chaban-bookmarklets',
                            name: 'MB Match',
                            match: ['*://*.musicbrainz.org/*'],
                            code: 'void 0;',
                        },
                        'pack:chaban-bookmarklets/yt_nomatch': {
                            id: 'pack:chaban-bookmarklets/yt_nomatch',
                            source: 'pack:chaban-bookmarklets',
                            name: 'YT Only',
                            match: ['*://*.youtube.com/*'],
                            code: 'void 0;',
                        },
                    },
                },
            },
            localScripts: {
                'local:all': {
                    id: 'local:all',
                    source: 'local',
                    name: 'All Sites',
                    match: ['*://*/*'],
                    code: 'void 0;',
                },
            },
            layout: [
                { type: 'script', scriptId: 'pack:chaban-bookmarklets/mb_match' },
                { type: 'script', scriptId: 'pack:chaban-bookmarklets/yt_nomatch' },
                { type: 'folder', id: 'f:mixed', name: 'Mixed', items: [{ scriptId: 'pack:chaban-bookmarklets/mb_match' }, { scriptId: 'pack:chaban-bookmarklets/yt_nomatch' }] },
                { type: 'folder', id: 'f:yt', name: 'YT Folder', items: [{ scriptId: 'pack:chaban-bookmarklets/yt_nomatch' }] },
                { type: 'folder', id: 'f:empty', name: 'Empty Folder', items: [] },
            ],
            selectedFolderId: null,
        }),
        callbacks: {
            onStateChange(partial) { stateChanges.push(partial); },
        },
    });

    // 1. ui.openSettings() opens #settings-backdrop independently without opening #manager-backdrop (Review Focus #4)
    ui.openSettings();
    const overlayRoot = ui.getOverlayShadowRoot();
    const settingsBackdrop = overlayRoot.getElementById('settings-backdrop');
    const managerBackdrop = overlayRoot.getElementById('manager-backdrop');
    assert.ok(settingsBackdrop);
    assert.equal(settingsBackdrop.classList.contains('hidden'), false);
    assert.equal(managerBackdrop.classList.contains('hidden'), true);

    // Controls inside Settings work: default visibility, folderHoverOpen, keepFolderOpenAfterRun
    const defaultHiddenBtn = overlayRoot.querySelector('[data-dock-default-visible="false"]');
    assert.ok(defaultHiddenBtn);
    defaultHiddenBtn.click();
    assert.equal(stateChanges.at(-1).settings.dockDefaultVisible, false);

    const chkFolderHover = overlayRoot.getElementById('chk-folder-hover-open');
    const chkKeepOpen = overlayRoot.getElementById('chk-keep-folder-open');
    assert.ok(chkFolderHover && chkKeepOpen);
    chkFolderHover.checked = true;
    chkFolderHover.dispatchEvent({ type: 'change', bubbles: true });
    assert.equal(stateChanges.at(-1).settings.folderHoverOpen, true);
    chkKeepOpen.checked = true;
    chkKeepOpen.dispatchEvent({ type: 'change', bubbles: true });
    assert.equal(stateChanges.at(-1).settings.keepFolderOpenAfterRun, true);

    // Escape closes standalone Settings cleanly with no Manager behind it
    overlayRoot.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(settingsBackdrop.classList.contains('hidden'), true);
    assert.equal(managerBackdrop.classList.contains('hidden'), true);

    // 2. Manager header is streamlined (+ New Local Script, ⚙ Settings, ×; no inline Export/Import/Shortcut)
    ui.openManager();
    assert.ok(overlayRoot.getElementById('btn-manager-settings'));
    assert.equal(settingsBackdrop.contains(overlayRoot.getElementById('btn-export-open')), true);
    assert.equal(settingsBackdrop.contains(overlayRoot.getElementById('btn-import-open')), true);
    assert.equal(settingsBackdrop.contains(overlayRoot.getElementById('btn-hotkey-record')), true);

    // Clicking #btn-manager-settings opens Settings over Manager; Escape closes only Settings
    overlayRoot.getElementById('btn-manager-settings').click();
    assert.equal(settingsBackdrop.classList.contains('hidden'), false);
    assert.equal(managerBackdrop.classList.contains('hidden'), false);
    overlayRoot.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(settingsBackdrop.classList.contains('hidden'), true);
    assert.equal(managerBackdrop.classList.contains('hidden'), false);

    // 3. Manager dimming (#13): non-matching scripts, all-non-matching folders, empty folders, and non-matching drawer chips get bt-pill-dimmed; Library cards do not
    assert.equal(overlayRoot.querySelector('[data-toolbar-script="pack:chaban-bookmarklets/mb_match"]').classList.contains('bt-pill-dimmed'), false);
    assert.equal(overlayRoot.querySelector('[data-toolbar-script="pack:chaban-bookmarklets/yt_nomatch"]').classList.contains('bt-pill-dimmed'), true);
    assert.equal(overlayRoot.querySelector('[data-folder-pill="f:mixed"]').classList.contains('bt-pill-dimmed'), false);
    assert.equal(overlayRoot.querySelector('[data-folder-pill="f:yt"]').classList.contains('bt-pill-dimmed'), true);
    assert.equal(overlayRoot.querySelector('[data-folder-pill="f:empty"]').classList.contains('bt-pill-dimmed'), true);

    // Open Mixed folder drawer -> matching chip NOT dimmed, non-matching chip dimmed
    overlayRoot.querySelector('[data-folder-pill="f:mixed"]').click();
    assert.equal(overlayRoot.querySelector('[data-folder-item="pack:chaban-bookmarklets/mb_match"]').classList.contains('bt-pill-dimmed'), false);
    assert.equal(overlayRoot.querySelector('[data-folder-item="pack:chaban-bookmarklets/yt_nomatch"]').classList.contains('bt-pill-dimmed'), true);

    // Library cards NOT dimmed and show full pack name + title tooltip even with 1 pack installed (#5)
    const libCardYt = overlayRoot.querySelector('[data-library-card="pack:chaban-bookmarklets/yt_nomatch"]');
    assert.equal(libCardYt.classList.contains('bt-pill-dimmed'), false);
    const libBadge = libCardYt.querySelector('.bt-badge');
    assert.equal(libBadge.textContent, 'Chaban Extraordinarily Long Pack Name');
    assert.equal(libBadge.title, 'Chaban Extraordinarily Long Pack Name');

    // Non-HTTP(S) disables per-site dock button cleanly in Settings (Review Focus #3)
    ui.update({ url: 'about:blank' });
    ui.openSettings();
    assert.equal(overlayRoot.getElementById('btn-toggle-dock-site').disabled, true);

    ui.destroy();
});

test('Command Palette supports command/action queries (#3), omits @match desc fallback (#4), shows pack name (#5), dual footer buttons, drill-down sub-views, and direct-search shortcuts (#18)', () => {
    const { doc, win } = createDomEnvironment('https://musicbrainz.org/release/123');
    const stateChanges = [];
    const ui = UI.createToolbarUI({
        doc,
        win,
        initialState: createSampleState({
            url: 'https://musicbrainz.org/release/123',
            packs: {
                'chaban-bookmarklets': {
                    id: 'chaban-bookmarklets',
                    name: 'Chaban Bookmarklets Long Name',
                    version: '2026.11.24',
                    scripts: {
                        'pack:chaban-bookmarklets/nodesc': {
                            id: 'pack:chaban-bookmarklets/nodesc',
                            source: 'pack:chaban-bookmarklets',
                            name: 'No Description Script',
                            description: '',
                            match: ['*://*.musicbrainz.org/*'],
                            code: 'void 0;',
                        },
                        'pack:chaban-bookmarklets/withdesc': {
                            id: 'pack:chaban-bookmarklets/withdesc',
                            source: 'pack:chaban-bookmarklets',
                            name: 'Described Script',
                            description: 'Useful helper description',
                            match: ['*://*.musicbrainz.org/*'],
                            code: 'void 0;',
                        },
                    },
                },
            },
            localScripts: {},
            layout: [{ type: 'script', scriptId: 'pack:chaban-bookmarklets/nodesc' }],
        }),
        callbacks: {
            onStateChange(partial) { stateChanges.push(partial); },
        },
    });

    ui.openPalette();
    const overlayRoot = ui.getOverlayShadowRoot();
    const paletteSearch = overlayRoot.getElementById('palette-search');
    const paletteList = overlayRoot.getElementById('palette-list');

    // 1. Dual footer buttons (#18)
    const mgrBtn = overlayRoot.getElementById('palette-open-manager');
    const setBtn = overlayRoot.getElementById('palette-open-settings');
    assert.ok(mgrBtn && setBtn, 'Expected both #palette-open-manager and #palette-open-settings footer buttons');
    assert.ok(overlayRoot.getElementById('palette-removed-dot'));

    setBtn.click();
    assert.equal(overlayRoot.getElementById('settings-backdrop').classList.contains('hidden'), false);
    assert.equal(overlayRoot.getElementById('manager-backdrop').classList.contains('hidden'), true);
    overlayRoot.getElementById('settings-close').click();

    ui.openPalette();

    // 2. #4 Description omitted when empty; #5 Pack name shown even with 1 pack installed
    const noDescRow = paletteList.querySelector('[data-script-id="pack:chaban-bookmarklets/nodesc"]');
    assert.ok(noDescRow);
    assert.equal(noDescRow.querySelectorAll('.bt-subtitle').length, 0, 'Empty description must omit descLine instead of showing @match patterns');
    const rowBadge = noDescRow.querySelector('.bt-badge');
    assert.equal(rowBadge.textContent, 'Chaban Bookmarklets Long Name');
    assert.equal(rowBadge.title, 'Chaban Bookmarklets Long Name');

    const withDescRow = paletteList.querySelector('[data-script-id="pack:chaban-bookmarklets/withdesc"]');
    assert.equal(withDescRow.querySelector('.bt-subtitle').textContent, 'Useful helper description');

    // 3. #3 Querying "command" or "action" returns Actions command rows
    for (const kw of ['command', 'action']) {
        paletteSearch.value = kw;
        paletteSearch.dispatchEvent({ type: 'input', bubbles: true });
        const cmdRows = paletteList.querySelectorAll('.bt-palette-item').filter((el) => el.dataset.commandId);
        assert.ok(cmdRows.length >= 5, `Query "${kw}" should surface Actions command rows`);
    }

    // 4. Drill-down sub-view + Esc step-back (Review Focus #4) + selection closes palette
    paletteSearch.value = '';
    paletteSearch.dispatchEvent({ type: 'input', bubbles: true });
    const orientRow = paletteList.querySelector('[data-command-id="sub-dock-orientation"]');
    assert.ok(orientRow, 'Expected compact Dock Orientation drill-down row in root view');
    orientRow.click();

    assert.equal(paletteSearch.placeholder, 'Select Dock Orientation…');
    assert.ok(paletteList.querySelector('[data-command-id="sub-back"]'));
    assert.ok(paletteList.querySelector('[data-command-id="set-orientation:vertical"]'));

    // Esc steps back to root palette instead of closing overlay
    paletteSearch.dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
    assert.equal(overlayRoot.getElementById('palette-backdrop').classList.contains('hidden'), false);
    assert.ok(paletteList.querySelector('[data-command-id="sub-dock-orientation"]'));

    // Drill back in and pick Vertical -> updates dockOrientation and closes palette
    paletteList.querySelector('[data-command-id="sub-dock-orientation"]').click();
    paletteList.querySelector('[data-command-id="set-orientation:vertical"]').click();
    assert.equal(stateChanges.at(-1).settings.dockOrientation, 'vertical');
    assert.equal(overlayRoot.getElementById('palette-backdrop').classList.contains('hidden'), true);

    // 5. Direct-search shortcut when query is non-empty ("bottom-right" surfaces Dock Position: Bottom Right)
    ui.openPalette();
    paletteSearch.value = 'bottom-right';
    paletteSearch.dispatchEvent({ type: 'input', bubbles: true });
    const posShortcut = paletteList.querySelector('[data-command-id="set-position:bottom-right"]');
    assert.ok(posShortcut, 'Expected direct-search shortcut for bottom-right dock position');
    posShortcut.click();
    assert.equal(stateChanges.at(-1).settings.dockDefaultPosition, 'bottom-right');

    // 6. Non-HTTP(S) origin omits toggle-dock-site cleanly (Review Focus #3)
    ui.update({ url: 'file:///tmp/test.html' });
    ui.openPalette();
    assert.equal(paletteList.querySelector('[data-command-id="toggle-dock-site"]'), null);

    ui.destroy();
});




