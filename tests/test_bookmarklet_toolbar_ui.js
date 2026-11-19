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
    assert.equal(items.length, 6);
    assert.equal(items[0].classList.contains('bt-palette-item-active'), true);

    // ArrowDown moves selection to index 1, calls scrollIntoView on the active item, and Enter runs that script
    searchInput.dispatchEvent({ type: 'keydown', key: 'ArrowDown', bubbles: true });
    const updatedItems = paletteList.querySelectorAll('.bt-palette-item');
    assert.equal(updatedItems[1].classList.contains('bt-palette-item-active'), true);
    assert.deepEqual(updatedItems[1]._lastScrollIntoView, { block: 'nearest' });

    searchInput.dispatchEvent({ type: 'keydown', key: 'Enter', bubbles: true });
    assert.equal(ranScripts.length, 1);
    assert.equal(overlayRoot.getElementById('palette-backdrop').classList.contains('hidden'), true);

    // Re-open palette, filter for "settings", press Enter to open Manager
    ui.openPalette();
    searchInput.value = 'settings';
    searchInput.dispatchEvent({ type: 'input', bubbles: true });

    const filteredItems = paletteList.querySelectorAll('.bt-palette-item');
    assert.equal(filteredItems.length, 1);
    assert.match(filteredItems[0].textContent, /Open Settings \/ Manager/);

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

    // 6. Hotkey Recorder
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

test('Clicking .bt-dock-handle toggles dockSiteExpanded[origin] and Manager controls switch between both, click, and hover modes', () => {
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

    // 1. Default 'both' mode: hover expands temporarily without state change, leave collapses
    dockContainer.dispatchEvent({ type: 'mouseenter', bubbles: false });
    assert.ok(toolbarRoot.querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all"]'));
    assert.equal(stateChanges.length, 0);

    dockContainer.dispatchEvent({ type: 'mouseleave', bubbles: false });
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
    const toggleBtn = overlayRoot.getElementById('btn-toggle-dock-site');
    assert.ok(toggleBtn, 'Expected #btn-toggle-dock-site in Manager header');
    assert.match(toggleBtn.textContent, /Hide dock on this site/i);

    toggleBtn.click();
    assert.equal(stateChanges.at(-1).settings.dockSiteHidden['https://musicbrainz.org'], true);
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
    assert.equal(stateChanges.at(-1).settings.dockSiteHidden['https://musicbrainz.org'], false);
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
    assert.match(uiSource, /\.bt-popover\s*\{[^}]*max-width:\s*calc\(100vw\s*-\s*48px\);/s);
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
    assert.ok(header.querySelectorAll('.bt-row-wrap').length >= 2);
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

    // Manager disables per-site hide button cleanly when origin is unavailable
    ui.openManager();
    const overlayRoot = ui.getOverlayShadowRoot();
    const toggleBtn = overlayRoot.getElementById('btn-toggle-dock-site');
    assert.equal(toggleBtn.disabled, true);
    assert.doesNotThrow(() => toggleBtn.click());

    // Command Palette also opens without throwing on originless URL
    assert.doesNotThrow(() => ui.openPalette());

    ui.destroy();
});



