'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENTRY_REL_PATH = 'src/Site Bookmarklet Toolbar.user.js';
const ENTRY_ABS_PATH = path.join(REPO_ROOT, ENTRY_REL_PATH);

function buildInlinedUserscript() {
    const pyCode = [
        'import sys',
        'sys.stdout.reconfigure(encoding="utf-8")',
        'sys.path.insert(0, "tools")',
        'import build_dist',
        `sys.stdout.write(build_dist.inline_userscript(${JSON.stringify(ENTRY_REL_PATH)}))`,
    ].join('; ');
    return execFileSync('python', ['-c', pyCode], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
}

function createDomEnvironment(initialUrl = 'https://example.com/', { includeMbHeader = false } = {}) {
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
        if (
            trimmed.startsWith('#') &&
            !trimmed.includes(' ') &&
            !trimmed.includes('.') &&
            !trimmed.includes('[')
        ) {
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
        const rawSelector = String(selector).trim();
        if (
            rawSelector === 'div.header .right .top' ||
            rawSelector === '.header .right .top'
        ) {
            const tops = [];
            function findTop(node) {
                for (const child of node.children || []) {
                    if (
                        child.classList &&
                        child.classList.contains('top') &&
                        child.parentNode?.classList?.contains('right') &&
                        child.parentNode?.parentNode?.classList?.contains('header')
                    ) {
                        tops.push(child);
                    }
                    findTop(child);
                }
            }
            findTop(root);
            return tops;
        }
        if (
            rawSelector === 'div.header .right .top .search-container' ||
            rawSelector === '.header .right .top .search-container'
        ) {
            const top = queryAllInSubtree(root, '.header .right .top')[0];
            return top ? queryAllInSubtree(top, '.search-container') : [];
        }

        const selectors = rawSelector
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

    let doc;
    let win;
    const mutationObservers = [];

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
            if (typeof this._onAppendChild === 'function') {
                this._onAppendChild(child);
            }
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
            return this.children.some((c) =>
                typeof c.contains === 'function' ? c.contains(target) : c === target
            );
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
        click() {
            this.dispatchEvent({ type: 'click', bubbles: true });
        }
    }

    function createMockElement(tag) {
        const el = new MockElement(tag);
        el.ownerDocument = doc;
        return el;
    }

    class MockMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.target = null;
            this.options = null;
            mutationObservers.push(this);
        }
        observe(target, options) {
            this.target = target;
            this.options = options;
        }
        disconnect() {
            this.target = null;
        }
        trigger(records = [{}]) {
            if (this.target) {
                this.callback(records, this);
            }
        }
    }

    const winListeners = new Map();
    win = {
        location: { href: initialUrl },
        history: {
            pushState(_state, _title, nextUrl) {
                if (nextUrl) {
                    win.location.href = new URL(nextUrl, win.location.href).href;
                }
            },
            replaceState(_state, _title, nextUrl) {
                if (nextUrl) {
                    win.location.href = new URL(nextUrl, win.location.href).href;
                }
            },
        },
        MutationObserver: MockMutationObserver,
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
    doc.head = createMockElement('HEAD');
    doc.body = createMockElement('BODY');
    doc.documentElement = createMockElement('HTML');
    doc.documentElement.appendChild(doc.head);
    doc.documentElement.appendChild(doc.body);
    doc.appendChild(doc.documentElement);

    if (includeMbHeader) {
        const header = createMockElement('DIV');
        header.className = 'header';
        const right = createMockElement('DIV');
        right.className = 'right';
        const topRow = createMockElement('DIV');
        topRow.className = 'top';
        const linksContainer = createMockElement('DIV');
        linksContainer.className = 'links-container';
        const searchContainer = createMockElement('DIV');
        searchContainer.className = 'search-container';

        topRow.append(linksContainer, searchContainer);
        right.appendChild(topRow);
        header.appendChild(right);
        doc.body.appendChild(header);
    }

    return { doc, win, createMockElement, mutationObservers, MockMutationObserver };
}

function createMockGM(initialStore = {}) {
    const store = new Map(Object.entries(initialStore));
    const menuCommands = [];
    const GM = {
        async getValue(key, defaultValue) {
            if (!store.has(key)) {
                return defaultValue;
            }
            const val = store.get(key);
            return val !== undefined ? structuredClone(val) : defaultValue;
        },
        async setValue(key, value) {
            store.set(key, structuredClone(value));
        },
        async deleteValue(key) {
            store.delete(key);
        },
        registerMenuCommand(caption, onClick) {
            menuCommands.push({ caption, onClick });
            return caption;
        },
    };
    return { GM, store, menuCommands };
}

async function flushAsync() {
    for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
}

test('tools/build_dist.py inline_userscript inlines all 4 libs inside outer IIFE closure, strips @require, rewrites dist URLs, and compiles cleanly in Node VM', () => {
    assert.ok(fs.existsSync(ENTRY_ABS_PATH), `Expected ${ENTRY_REL_PATH} to exist`);
    const rawEntry = fs.readFileSync(ENTRY_ABS_PATH, 'utf8');

    // Zero console.log in entrypoint source
    assert.equal(/\bconsole\.log\s*\(/.test(rawEntry), false, 'Entrypoint must not use console.log');

    const inlinedCode = buildInlinedUserscript();

    // 1. No relative @require lines remain
    assert.equal(
        /^[ \t]*\/\/[ \t]*@require[ \t]+(?:\.\.\/)?lib\//m.test(inlinedCode),
        false,
        'Expected all relative lib/ @require lines to be stripped'
    );

    // 2. @updateURL and @downloadURL rewritten to dist/
    assert.match(
        inlinedCode,
        /\/\/[ \t]*@updateURL[ \t]+https:\/\/github\.com\/chaban-mb\/userscripts\/raw\/dist\/src\/Site%20Bookmarklet%20Toolbar\.user\.js/
    );
    assert.match(
        inlinedCode,
        /\/\/[ \t]*@downloadURL[ \t]+https:\/\/github\.com\/chaban-mb\/userscripts\/raw\/dist\/src\/Site%20Bookmarklet%20Toolbar\.user\.js/
    );

    // 3. All 4 library markers are strictly inside the outer (function () { 'use strict'; ... })(); closure
    const closureStartMatch = inlinedCode.match(/\(\s*function\s*\(\s*\)\s*\{\s*'use strict';/);
    assert.ok(closureStartMatch, 'Expected outer (function () { \'use strict\'; closure start');
    const closureStartIdx = closureStartMatch.index + closureStartMatch[0].length;
    const closureEndIdx = inlinedCode.lastIndexOf('})();');
    assert.ok(closureEndIdx > closureStartIdx, 'Expected outer IIFE closing })();');

    for (const libName of [
        'BookmarkletToolbarCore.js',
        'BookmarkletToolbarPacks.js',
        'BookmarkletToolbarAdapters.js',
        'BookmarkletToolbarUI.js',
    ]) {
        const marker = `// --- Inlined Library: lib/${libName} ---`;
        const markerIdx = inlinedCode.indexOf(marker);
        assert.ok(markerIdx !== -1, `Expected inlined marker for ${libName}`);
        assert.ok(
            markerIdx > closureStartIdx && markerIdx < closureEndIdx,
            `Expected ${libName} to be inlined strictly inside the outer IIFE closure`
        );
    }

    // 4. Compiles cleanly as a vm.Script
    assert.doesNotThrow(() => {
        new vm.Script(inlinedCode, { filename: 'Site Bookmarklet Toolbar.dist.user.js' });
    });
});

test('Running on unmatched URL (https://example.com/) syncs bundled pack (25 scripts), keeps Layout [], appends zero DOM hosts, and registers menu commands', async () => {
    const inlinedCode = buildInlinedUserscript();
    const { doc, win, MockMutationObserver } = createDomEnvironment('https://example.com/');
    const { GM, store, menuCommands } = createMockGM();

    const logs = { debug: [], info: [], warn: [], error: [] };
    const context = vm.createContext({
        window: win,
        document: doc,
        location: win.location,
        history: win.history,
        MutationObserver: MockMutationObserver,
        GM,
        URL,
        Blob,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        Event: class Event {
            constructor(type) {
                this.type = type;
            }
        },
        console: {
            debug: (...args) => logs.debug.push(args),
            info: (...args) => logs.info.push(args),
            warn: (...args) => logs.warn.push(args),
            error: (...args) => logs.error.push(args),
        },
        setTimeout,
        clearTimeout,
        structuredClone,
    });

    const script = new vm.Script(inlinedCode);
    script.runInContext(context);
    await flushAsync();

    // 1. Pack cache synced with all 25 scripts
    const syncedPack = store.get('UserJS.BookmarkletToolbar.Pack.chaban-bookmarklets');
    assert.ok(syncedPack, 'Expected chaban-bookmarklets pack cache to be persisted');
    assert.equal(syncedPack.id, 'chaban-bookmarklets');
    assert.equal(Object.keys(syncedPack.scripts).length, 25);

    // 2. Layout remains [] (no auto-pinning)
    const layoutVal = store.get('UserJS.BookmarkletToolbar.Layout') ?? [];
    assert.deepEqual(layoutVal, []);

    // 3. Fast-path exit: ZERO toolbar or overlay DOM host elements appended to page
    assert.equal(doc.querySelector('#userjs-bt-toolbar-host'), null);
    assert.equal(doc.querySelector('#userjs-bt-overlay-host'), null);
    assert.equal(doc.body.children.length, 0);

    // 4. GM.registerMenuCommand registered all three menu items
    const captions = menuCommands.map((m) => m.caption);
    assert.deepEqual(captions, [
        'Open Command Palette',
        'Open Bookmarklet Manager',
        'Toggle Dock on This Site',
    ]);

    // 5. Invoking 'Open Command Palette' lazily mounts overlay Shadow DOM while toolbar stays unmounted
    menuCommands[0].onClick();
    assert.equal(doc.querySelector('#userjs-bt-toolbar-host'), null);
    const overlayHost = doc.querySelector('#userjs-bt-overlay-host');
    assert.ok(overlayHost, 'Expected overlay host to mount when menu command is clicked');
    assert.equal(
        overlayHost.shadowRoot.getElementById('palette-backdrop').classList.contains('hidden'),
        false
    );

    // 6. Invoking 'Open Bookmarklet Manager' opens the Manager modal
    menuCommands[1].onClick();
    assert.equal(
        overlayHost.shadowRoot.getElementById('manager-backdrop').classList.contains('hidden'),
        false
    );
});

test('Entrypoint mounts toolbar on matched URL, handles global hotkeys safely, persists state mutations, and updates on SPA URL navigation', async () => {
    const inlinedCode = buildInlinedUserscript();
    const { doc, win, createMockElement, mutationObservers, MockMutationObserver } =
        createDomEnvironment('https://musicbrainz.org/release/123/edit', { includeMbHeader: true });

    const { GM, store } = createMockGM({
        'UserJS.BookmarkletToolbar.Layout': [
            { type: 'script', scriptId: 'pack:chaban-bookmarklets/approve_all_edits' },
        ],
    });

    const context = vm.createContext({
        window: win,
        document: doc,
        location: win.location,
        history: win.history,
        MutationObserver: MockMutationObserver,
        GM,
        URL,
        Blob,
        console: {
            debug() {},
            info() {},
            warn() {},
            error() {},
        },
        setTimeout,
        clearTimeout,
        structuredClone,
    });

    new vm.Script(inlinedCode).runInContext(context);
    await flushAsync();

    // 1. Toolbar mounted as generic fixed dock on doc.body (leaving MusicBrainz header untouched)
    const toolbarHost = doc.querySelector('#userjs-bt-toolbar-host');
    assert.ok(toolbarHost, 'Expected toolbar host to mount on matched MusicBrainz URL');
    assert.equal(toolbarHost.parentNode, doc.body);
    const mbTopRow = doc.querySelector('.header .right .top');
    assert.equal(mbTopRow.children.length, 2);

    //Overlay not mounted until opened
    assert.equal(doc.querySelector('#userjs-bt-overlay-host'), null);

    // 2. Editable input skips Shift-only hotkey, while Alt+B opens Command Palette
    await GM.setValue('UserJS.BookmarkletToolbar.Settings', { hotkey: 'Shift+B' });
    const pageInput = createMockElement('INPUT');
    pageInput.type = 'text';
    doc.body.appendChild(pageInput);

    // Update hotkey via Manager recording flow to Shift+B and test recording suppression
    win.dispatchEvent({
        type: 'keydown',
        key: 'b',
        code: 'KeyB',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
        bubbles: true,
    });
    const overlayHost = doc.querySelector('#userjs-bt-overlay-host');
    assert.ok(overlayHost, 'Expected Alt+B to lazily mount overlay and open Command Palette');
    assert.equal(
        overlayHost.shadowRoot.getElementById('palette-backdrop').classList.contains('hidden'),
        false
    );

    // Open Manager from Palette and test recording hotkey + persistence
    overlayHost.shadowRoot.getElementById('palette-open-settings').click();
    assert.equal(
        overlayHost.shadowRoot.getElementById('manager-backdrop').classList.contains('hidden'),
        false
    );

    const recordBtn = overlayHost.shadowRoot.getElementById('btn-hotkey-record');
    recordBtn.click();
    // While recordingHotkey is true, pressing Shift+B records the hotkey and does NOT switch to Palette
    overlayHost.shadowRoot.dispatchEvent({
        type: 'keydown',
        key: 'B',
        code: 'KeyB',
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        bubbles: true,
    });
    await flushAsync();
    assert.deepEqual(store.get('UserJS.BookmarkletToolbar.Settings'), {
        hotkey: 'Shift+B',
        dockExpandMode: 'both',
        dockSitePositions: {},
        dockSiteExpanded: {},
        dockSiteHidden: {},
    });
    assert.equal(
        overlayHost.shadowRoot.getElementById('palette-backdrop').classList.contains('hidden'),
        true
    );

    // Close Manager
    overlayHost.shadowRoot.getElementById('manager-close').click();

    // Dispatching Shift+B inside an editable <input> (no non-Shift modifier) MUST be skipped
    pageInput.dispatchEvent({
        type: 'keydown',
        key: 'B',
        code: 'KeyB',
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        bubbles: true,
    });
    assert.equal(
        overlayHost.shadowRoot.getElementById('palette-backdrop').classList.contains('hidden'),
        true,
        'Expected Shift+B inside an editable input to be ignored'
    );

    // 3. Expanding the collapsed dock and running a script records execution in Recents and injects <script> into doc.head
    const dockHandle = toolbarHost.shadowRoot.querySelector('.bt-dock-handle');
    assert.ok(dockHandle, 'Expected .bt-dock-handle in collapsed dock');
    assert.ok(dockHandle.querySelector('svg'), 'Expected Bookmark Bolt SVG in .bt-dock-handle');
    assert.equal(
        toolbarHost.shadowRoot.querySelector('[data-script-id="pack:chaban-bookmarklets/approve_all_edits"]'),
        null
    );
    dockHandle.click();
    await flushAsync();

    const appendedScripts = [];
    doc.head._onAppendChild = (el) => {
        appendedScripts.push(el.textContent);
    };
    const approveBtn = toolbarHost.shadowRoot.querySelector(
        '[data-script-id="pack:chaban-bookmarklets/approve_all_edits"]'
    );
    assert.ok(approveBtn);
    approveBtn.click();
    await flushAsync();

    assert.equal(appendedScripts.length, 1);
    const recents = store.get('UserJS.BookmarkletToolbar.Recents');
    assert.ok(recents && recents['pack:chaban-bookmarklets/approve_all_edits']);
    assert.equal(recents['pack:chaban-bookmarklets/approve_all_edits'].count, 1);

    // 4. SPA URL change to unmatched URL unmounts toolbar; navigating back remounts it
    win.history.pushState({}, '', 'https://example.com/other');
    if (mutationObservers.length > 0) {
        mutationObservers[0].trigger();
    }
    await flushAsync();
    assert.equal(doc.querySelector('#userjs-bt-toolbar-host'), null);

    win.history.pushState({}, '', 'https://musicbrainz.org/artist/456');
    win.dispatchEvent({ type: 'popstate' });
    await flushAsync();
    assert.ok(doc.querySelector('#userjs-bt-toolbar-host'));
});

test('Toggle Dock on This Site menu command flips dockSiteHidden[origin], persists settings, and unmounts/remounts dock', async () => {
    const inlinedCode = buildInlinedUserscript();
    const { doc, win, MockMutationObserver } = createDomEnvironment(
        'https://musicbrainz.org/release/123',
        { includeMbHeader: true }
    );

    const { GM, store, menuCommands } = createMockGM({
        'UserJS.BookmarkletToolbar.Layout': [
            { type: 'script', scriptId: 'pack:chaban-bookmarklets/approve_all_edits' },
        ],
    });

    const context = vm.createContext({
        window: win,
        document: doc,
        location: win.location,
        history: win.history,
        MutationObserver: MockMutationObserver,
        GM,
        URL,
        Blob,
        console: {
            debug() {},
            info() {},
            warn() {},
            error() {},
        },
        setTimeout,
        clearTimeout,
        structuredClone,
    });

    new vm.Script(inlinedCode).runInContext(context);
    await flushAsync();

    // Initially mounted on doc.body
    assert.ok(doc.querySelector('#userjs-bt-toolbar-host'));
    assert.equal(doc.querySelector('#userjs-bt-toolbar-host').parentNode, doc.body);

    const toggleCmd = menuCommands.find((m) => m.caption === 'Toggle Dock on This Site');
    assert.ok(toggleCmd, 'Expected Toggle Dock on This Site menu command');

    // First toggle hides dock for https://musicbrainz.org
    toggleCmd.onClick();
    await flushAsync();

    assert.equal(doc.querySelector('#userjs-bt-toolbar-host'), null);
    const savedAfterHide = store.get('UserJS.BookmarkletToolbar.Settings');
    assert.equal(savedAfterHide.dockSiteHidden['https://musicbrainz.org'], true);

    // Second toggle shows dock again for https://musicbrainz.org
    toggleCmd.onClick();
    await flushAsync();

    const remountedHost = doc.querySelector('#userjs-bt-toolbar-host');
    assert.ok(remountedHost, 'Expected dock to remount after second toggle');
    assert.equal(remountedHost.parentNode, doc.body);
    const savedAfterShow = store.get('UserJS.BookmarkletToolbar.Settings');
    assert.equal(savedAfterShow.dockSiteHidden['https://musicbrainz.org'], false);
});
