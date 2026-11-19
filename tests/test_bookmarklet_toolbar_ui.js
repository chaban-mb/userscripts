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
        initialState: createSampleState(),
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
    assert.equal(items.length, 5);
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

