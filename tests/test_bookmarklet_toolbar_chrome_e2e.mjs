import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function buildInlinedUserscript() {
    const pyCode = [
        'import sys',
        'sys.stdout.reconfigure(encoding="utf-8")',
        'sys.path.insert(0, "tools")',
        'import build_dist',
        'sys.stdout.write(build_dist.inline_userscript("src/Site Bookmarklet Toolbar.user.js"))',
    ].join('; ');
    return execFileSync('python', ['-c', pyCode], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
}

function createTestServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');

        if (url.pathname === '/unmatched') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Example Unmatched Site</title></head>
<body>
    <main id="content"><h1>Welcome to Example.com</h1></main>
</body>
</html>`);
            return;
        }

        if (url.pathname === '/mb-release') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Release Title - MusicBrainz</title>
<style>
    body { margin: 0; font-family: sans-serif; }
    div.header {
        display: flex;
        align-items: stretch;
        justify-content: space-between;
        padding: 8px 16px;
        background: #f5f5f5;
        border-bottom: 1px solid #ccc;
    }
    div.header .logo {
        font-weight: bold;
        padding-right: 16px;
        display: flex;
        align-items: center;
    }
    div.header .right {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    div.header .right .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    div.header .right .top .links-container {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
    }
    div.header .right .top .search-container {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
    }
    div.header .right .bottom {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-top: 4px;
        border-top: 1px solid #e0e0e0;
    }
</style>
<script>
    window.MB = {
        _releaseEditor: {
            _tab: '#information',
            _tabCalls: [],
            activeTabID() {
                return this._tab;
            },
            nextTab() {
                this._tab = '#tracklist';
                this._tabCalls.push('nextTab');
                return this._tab;
            },
        },
    };
</script>
</head>
<body>
    <div class="header">
        <div class="logo">MusicBrainz</div>
        <div class="right">
            <div class="top">
                <div class="links-container">
                    <a href="/user/chaban">chaban</a>
                    <a href="/logout">Log Out</a>
                </div>
                <div class="search-container">
                    <input type="text" id="header-search" placeholder="Search MusicBrainz">
                    <button type="button">Search</button>
                </div>
            </div>
            <div class="bottom">
                <a href="/search">Search</a>
                <a href="/edit/open">Editing</a>
                <a href="/doc/MusicBrainz_Documentation">Documentation</a>
            </div>
        </div>
    </div>
    <div id="page">
        <h1>Release Editor</h1>
        <a class="positive" href="/edit/1/approve">Approve 1</a>
    </div>
</body>
</html>`);
            return;
        }

        if (url.pathname === '/csp-strict') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Security-Policy': "script-src 'none'",
            });
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Strict CSP Page</title></head>
<body>
    <div class="header">
        <div class="right">
            <div class="top">
                <div class="links-container">User</div>
                <div class="search-container"><input type="text"></div>
            </div>
            <div class="bottom">Nav</div>
        </div>
    </div>
    <h1>Strict CSP Test Frame</h1>
</body>
</html>`);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve({ server, port: addr.port });
        });
    });
}

async function launchHeadlessChrome() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-chrome-e2e-'));
    const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        '--host-resolver-rules=MAP musicbrainz.org 127.0.0.1,MAP *.musicbrainz.org 127.0.0.1,MAP example.com 127.0.0.1',
        'about:blank',
    ];

    const proc = spawn(CHROME_PATH, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const browserWsUrl = await new Promise((resolve, reject) => {
        let stderrText = '';
        const timer = setTimeout(() => {
            reject(new Error(`Timed out waiting for Chrome DevTools listening URL. stderr: ${stderrText}`));
        }, 15000);

        proc.stderr.on('data', (chunk) => {
            stderrText += chunk.toString('utf8');
            const match = stderrText.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]);
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        proc.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`Chrome exited prematurely with code ${code}. stderr: ${stderrText}`));
        });
    });

    const parsedWs = new URL(browserWsUrl);
    const debugPort = parsedWs.port;

    let pageWsUrl = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const targets = await res.json();
        const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTarget) {
            pageWsUrl = pageTarget.webSocketDebuggerUrl;
            break;
        }
        await new Promise((r) => setTimeout(r, 100));
    }

    if (!pageWsUrl) {
        proc.kill();
        throw new Error('Could not find debuggable page target in headless Chrome');
    }

    const ws = new WebSocket(pageWsUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const eventListeners = new Map();

    ws.addEventListener('message', (event) => {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString('utf8');
        const msg = JSON.parse(raw);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) {
                reject(new Error(`CDP error (${msg.error.code}): ${msg.error.message}`));
            } else {
                resolve(msg.result);
            }
        } else if (msg.method) {
            const handlers = eventListeners.get(msg.method);
            if (handlers) {
                for (const fn of [...handlers]) {
                    fn(msg.params || {});
                }
            }
        }
    });

    function send(method, params = {}) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    function onEvent(method, handler) {
        if (!eventListeners.has(method)) {
            eventListeners.set(method, new Set());
        }
        eventListeners.get(method).add(handler);
        return () => eventListeners.get(method)?.delete(handler);
    }

    await send('Page.enable');
    await send('Runtime.enable');

    async function close() {
        try {
            ws.close();
        } catch {}
        try {
            proc.kill();
        } catch {}
        await new Promise((resolve) => {
            proc.once('exit', resolve);
            setTimeout(resolve, 2000);
        });
        try {
            fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch {}
    }

    return { send, onEvent, close };
}

test('Real Headless Chrome E2E Verification for Site Bookmarklet Toolbar', async () => {
    const inlinedUserscript = buildInlinedUserscript();
    const { server, port } = await createTestServer();
    const cdp = await launchHeadlessChrome();

    // Cross-origin GM storage backed by Node + CDP binding + page localStorage fallback
    let gmBackingStore = {};
    await cdp.send('Runtime.addBinding', { name: '__btSyncGmStore' });
    cdp.onEvent('Runtime.bindingCalled', (params) => {
        if (params.name === '__btSyncGmStore' && typeof params.payload === 'string') {
            try {
                gmBackingStore = JSON.parse(params.payload);
            } catch {}
        }
    });

    async function evaluate(expression) {
        const res = await cdp.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true,
        });
        if (res.exceptionDetails) {
            const desc =
                res.exceptionDetails.exception?.description ||
                res.exceptionDetails.text ||
                'Runtime.evaluate exception';
            throw new Error(`Browser evaluation failed: ${desc}`);
        }
        return res.result?.value;
    }

    function buildGmBootstrapScript() {
        const serializedStore = JSON.stringify(gmBackingStore);
        return `
(() => {
    const STORAGE_LS_KEY = '__UserJS_BM_GM_Store__';
    const initialFromNode = ${serializedStore};
    let merged = { ...initialFromNode };
    try {
        const rawLs = window.localStorage.getItem(STORAGE_LS_KEY);
        if (rawLs) {
            const parsedLs = JSON.parse(rawLs);
            if (parsedLs && typeof parsedLs === 'object') {
                merged = { ...parsedLs, ...initialFromNode };
            }
        }
    } catch {}

    window.__gmStore = merged;
    window.__gmMenuCommands = [];

    function persistStore() {
        const json = JSON.stringify(window.__gmStore);
        try {
            window.localStorage.setItem(STORAGE_LS_KEY, json);
        } catch {}
        if (typeof window.__btSyncGmStore === 'function') {
            try {
                window.__btSyncGmStore(json);
            } catch {}
        }
    }
    persistStore();

    window.GM = {
        info: {
            script: {
                name: 'Site Bookmarklet Toolbar',
                version: '1.0.0',
            },
        },
        async getValue(key, fallback) {
            if (Object.prototype.hasOwnProperty.call(window.__gmStore, key)) {
                return structuredClone(window.__gmStore[key]);
            }
            return fallback;
        },
        async setValue(key, value) {
            window.__gmStore[key] = structuredClone(value);
            persistStore();
        },
        async deleteValue(key) {
            delete window.__gmStore[key];
            persistStore();
        },
        registerMenuCommand(caption, onClick) {
            window.__gmMenuCommands.push({ caption, onClick });
            return caption;
        },
    };

    window.__invokeGmMenu = (caption) => {
        const cmd = window.__gmMenuCommands.find((c) => c.caption === caption);
        if (!cmd) {
            throw new Error('Menu command not found: ' + caption);
        }
        cmd.onClick();
        return true;
    };
})();
`;
    }

    async function navigateAndInject(url) {
        const loadPromise = new Promise((resolve) => {
            const off = cdp.onEvent('Page.loadEventFired', () => {
                off();
                resolve();
            });
        });
        await cdp.send('Page.navigate', { url });
        await loadPromise;
        await evaluate(buildGmBootstrapScript());
        await evaluate(inlinedUserscript);
        await evaluate('new Promise((r) => setTimeout(r, 60))');
    }

    async function reloadAndInject() {
        const loadPromise = new Promise((resolve) => {
            const off = cdp.onEvent('Page.loadEventFired', () => {
                off();
                resolve();
            });
        });
        await cdp.send('Page.reload', {});
        await loadPromise;
        await evaluate(buildGmBootstrapScript());
        await evaluate(inlinedUserscript);
        await evaluate('new Promise((r) => setTimeout(r, 60))');
    }

    try {
        // =====================================================================
        // Scenario 1: Unmatched page first run -> zero Shadow DOM toolbar host created
        // =====================================================================
        await navigateAndInject(`http://example.com:${port}/unmatched`);

        const scenario1 = await evaluate(`(() => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const overlayHost = document.getElementById('userjs-bt-overlay-host');
            const packCache = window.__gmStore['UserJS.BookmarkletToolbar.Pack.chaban-bookmarklets'];
            const layout = window.__gmStore['UserJS.BookmarkletToolbar.Layout'] || [];
            const menuCaptions = window.__gmMenuCommands.map((m) => m.caption);
            return {
                hasToolbarHost: toolbarHost !== null,
                hasOverlayHost: overlayHost !== null,
                packScriptCount: packCache && packCache.scripts ? Object.keys(packCache.scripts).length : 0,
                layoutLength: layout.length,
                menuCaptions,
            };
        })()`);

        assert.equal(scenario1.hasToolbarHost, false, 'Unmatched page must not create toolbar host');
        assert.equal(scenario1.hasOverlayHost, false, 'Unmatched page must not create overlay host on startup');
        assert.equal(scenario1.packScriptCount, 25, 'Bundled pack should sync 25 scripts on first run');
        assert.equal(scenario1.layoutLength, 0, 'Initial layout must be empty');
        assert.deepEqual(scenario1.menuCaptions, [
            'Open Command Palette',
            'Open Bookmarklet Manager',
        ]);

        // =====================================================================
        // Scenario 2: Open Manager via mocked menu command -> search Library for "Approve",
        // pin via ☆ -> Toolbar mounts cleanly inside MusicBrainz div.header .right .top
        // between .links-container and .search-container without shifting or breaking
        // .search-container or .header .bottom nav bounding boxes.
        // =====================================================================
        await navigateAndInject(`http://musicbrainz.org:${port}/mb-release`);

        const beforePinMetrics = await evaluate(`(() => {
            const topRow = document.querySelector('div.header .right .top');
            const links = topRow.querySelector('.links-container');
            const search = topRow.querySelector('.search-container');
            const bottom = document.querySelector('div.header .right .bottom');
            return {
                hasToolbarBeforePin: document.getElementById('userjs-bt-toolbar-host') !== null,
                linksRect: links.getBoundingClientRect().toJSON(),
                searchRect: search.getBoundingClientRect().toJSON(),
                bottomRect: bottom.getBoundingClientRect().toJSON(),
            };
        })()`);

        assert.equal(beforePinMetrics.hasToolbarBeforePin, false, 'Toolbar should not mount before any script is placed');

        const afterPinMetrics = await evaluate(`(async () => {
            window.__invokeGmMenu('Open Bookmarklet Manager');
            const overlayHost = document.getElementById('userjs-bt-overlay-host');
            const sr = overlayHost?.shadowRoot;
            const managerBackdrop = sr?.getElementById('manager-backdrop');
            const managerVisible = Boolean(managerBackdrop && !managerBackdrop.classList.contains('hidden'));

            const searchInput = sr.getElementById('mgr-search');
            searchInput.value = 'Approve';
            searchInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

            const cards = [...sr.querySelectorAll('#library-grid [data-library-card]')];
            const approveCard = sr.querySelector('[data-library-card="pack:chaban-bookmarklets/approve_all_edits"]');
            const starBtn = approveCard?.querySelector('.bt-star-btn');
            starBtn.click();

            await new Promise((r) => setTimeout(r, 30));

            const topRow = document.querySelector('div.header .right .top');
            const links = topRow.querySelector('.links-container');
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const search = topRow.querySelector('.search-container');
            const bottom = document.querySelector('div.header .right .bottom');

            const childOrder = [...topRow.children].map((el) => el.id || el.className);
            const toolbarBtns = [...(toolbarHost?.shadowRoot?.querySelectorAll('button') || [])].map((b) => ({
                scriptId: b.dataset.scriptId || null,
                action: b.dataset.action || null,
                text: b.textContent.trim(),
            }));

            return {
                managerVisible,
                filteredCardIds: cards.map((c) => c.dataset.libraryCard),
                childOrder,
                toolbarBtns,
                topRowRect: topRow.getBoundingClientRect().toJSON(),
                linksRect: links.getBoundingClientRect().toJSON(),
                toolbarRect: toolbarHost.getBoundingClientRect().toJSON(),
                searchRect: search.getBoundingClientRect().toJSON(),
                bottomRect: bottom.getBoundingClientRect().toJSON(),
            };
        })()`);

        assert.equal(afterPinMetrics.managerVisible, true, 'Manager modal must open via menu command');
        assert.deepEqual(afterPinMetrics.filteredCardIds, ['pack:chaban-bookmarklets/approve_all_edits']);
        assert.deepEqual(afterPinMetrics.childOrder, [
            'links-container',
            'userjs-bt-toolbar-host',
            'search-container',
        ]);
        assert.equal(afterPinMetrics.toolbarBtns.length, 2);
        assert.equal(afterPinMetrics.toolbarBtns[0].scriptId, 'pack:chaban-bookmarklets/approve_all_edits');
        assert.equal(afterPinMetrics.toolbarBtns[0].text, 'Approve All');
        assert.equal(afterPinMetrics.toolbarBtns[1].action, 'open-palette');

        // Verify bounding boxes in real Chrome layout:
        // 1. Search container stays on the same horizontal row and retains identical dimensions
        assert.equal(afterPinMetrics.searchRect.width, beforePinMetrics.searchRect.width);
        assert.equal(afterPinMetrics.searchRect.height, beforePinMetrics.searchRect.height);
        assert.ok(
            Math.abs(afterPinMetrics.searchRect.top - beforePinMetrics.searchRect.top) <= 2,
            `Search container top shifted unexpectedly: before=${beforePinMetrics.searchRect.top}, after=${afterPinMetrics.searchRect.top}`
        );
        // 2. Toolbar sits strictly between links-container and search-container horizontally
        assert.ok(afterPinMetrics.toolbarRect.left >= afterPinMetrics.linksRect.right - 1);
        assert.ok(afterPinMetrics.searchRect.left >= afterPinMetrics.toolbarRect.right - 1);
        // 3. Bottom nav bounding box is unbroken and remains below the top row
        assert.equal(afterPinMetrics.bottomRect.width, beforePinMetrics.bottomRect.width);
        assert.equal(afterPinMetrics.bottomRect.height, beforePinMetrics.bottomRect.height);
        assert.ok(afterPinMetrics.bottomRect.top >= afterPinMetrics.topRowRect.bottom - 1);

        // =====================================================================
        // Scenario 3: Click + Folder inline pill -> press Escape -> inline pill closes
        // cleanly while Manager modal remains open! Create folder "QC", double-click
        // "QC" title in Folder drawer to rename inline to "Review" -> persists.
        // =====================================================================
        const scenario3 = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            const managerBackdrop = sr.getElementById('manager-backdrop');

            // 1. Click + Folder pill
            const addFolderBtn = sr.querySelector('[data-action="add-folder"]');
            addFolderBtn.click();
            await new Promise((r) => setTimeout(r, 25));

            const inlineInput1 = sr.querySelector('#toolbar-strip .bt-inline-edit-input');
            const hasInlineInputAfterClick = Boolean(inlineInput1);

            // Press Escape inside the inline input
            inlineInput1.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })
            );
            await new Promise((r) => setTimeout(r, 25));

            const hasInlineInputAfterEsc = Boolean(sr.querySelector('#toolbar-strip .bt-inline-edit-input'));
            const managerStillOpenAfterEsc = !managerBackdrop.classList.contains('hidden');

            // 2. Click + Folder again and create "QC"
            sr.querySelector('[data-action="add-folder"]').click();
            await new Promise((r) => setTimeout(r, 25));
            const inlineInput2 = sr.querySelector('#toolbar-strip .bt-inline-edit-input');
            inlineInput2.value = 'QC';
            inlineInput2.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })
            );
            await new Promise((r) => setTimeout(r, 25));

            const folderPillAfterCreate = sr.querySelector('#toolbar-strip [data-folder-pill]');
            const folderPillTextAfterCreate = folderPillAfterCreate?.textContent?.trim() || '';
            const drawer = sr.getElementById('folder-drawer');
            const drawerOpenAfterCreate = !drawer.classList.contains('hidden');

            // 3. Double-click "📁 QC" title in Folder drawer to rename inline to "Review"
            const drawerTitleSpan = [...drawer.querySelectorAll('span')].find((s) =>
                s.textContent.includes('📁 QC')
            );
            drawerTitleSpan.dispatchEvent(
                new MouseEvent('dblclick', { bubbles: true, composed: true })
            );
            await new Promise((r) => setTimeout(r, 25));

            const renameInput = drawer.querySelector('.bt-inline-edit-input');
            const renameInitialValue = renameInput?.value || '';
            renameInput.value = 'Review';
            renameInput.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })
            );
            await new Promise((r) => setTimeout(r, 30));

            const folderPillTextAfterRename =
                sr.querySelector('#toolbar-strip [data-folder-pill]')?.textContent?.trim() || '';
            const storedLayout = window.__gmStore['UserJS.BookmarkletToolbar.Layout'] || [];
            const storedFolder = storedLayout.find((n) => n.type === 'folder');

            return {
                hasInlineInputAfterClick,
                hasInlineInputAfterEsc,
                managerStillOpenAfterEsc,
                folderPillTextAfterCreate,
                drawerOpenAfterCreate,
                renameInitialValue,
                folderPillTextAfterRename,
                storedFolderName: storedFolder?.name || null,
            };
        })()`);

        assert.equal(scenario3.hasInlineInputAfterClick, true, 'Clicking + Folder must open inline input pill');
        assert.equal(scenario3.hasInlineInputAfterEsc, false, 'Pressing Escape must close inline input pill');
        assert.equal(scenario3.managerStillOpenAfterEsc, true, 'Manager modal must remain open when Escape closes inline pill');
        assert.equal(scenario3.folderPillTextAfterCreate, '📁 QC(0)');
        assert.equal(scenario3.drawerOpenAfterCreate, true);
        assert.equal(scenario3.renameInitialValue, 'QC');
        assert.equal(scenario3.folderPillTextAfterRename, '📁 Review(0)');
        assert.equal(scenario3.storedFolderName, 'Review');

        // =====================================================================
        // Scenario 4: Dispatch HTML5 Drag & Drop inside Shadow DOM:
        // - dragging script card onto folder pill moves it cleanly
        // - dragging a folder onto the open Folder drawer displays
        //   "Folders cannot be nested inside folders" with no highlight
        // - dragging a chip over itself produces NO blocked hint
        // =====================================================================
        const scenario4 = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;

            // Clear search so all library scripts are visible
            const searchInput = sr.getElementById('mgr-search');
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

            function makeDragEvent(type) {
                const dt = new DataTransfer();
                return new DragEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    dataTransfer: dt,
                });
            }

            // 1. Drag script card (multi_tool) onto folder pill ("Review")
            const multiToolCard = sr.querySelector('[data-library-card="pack:chaban-bookmarklets/multi_tool"]');
            const folderPill = sr.querySelector('#toolbar-strip [data-folder-pill]');
            const dragHint = sr.getElementById('drag-hint');

            multiToolCard.dispatchEvent(makeDragEvent('dragstart'));
            folderPill.dispatchEvent(makeDragEvent('dragover'));
            const cardOverFolderHint = dragHint.textContent;
            const cardOverFolderHighlight = folderPill.classList.contains('drop-active-folder');
            folderPill.dispatchEvent(makeDragEvent('drop'));
            multiToolCard.dispatchEvent(makeDragEvent('dragend'));

            await new Promise((r) => setTimeout(r, 25));

            const drawer = sr.getElementById('folder-drawer');
            const folderChip = drawer.querySelector('[data-folder-item="pack:chaban-bookmarklets/multi_tool"]');
            const hasChipAfterDrop = Boolean(folderChip);

            // 2. Drag folder pill onto open Folder drawer -> blocked hint, zero highlight
            const folderPillNow = sr.querySelector('#toolbar-strip [data-folder-pill]');
            folderPillNow.dispatchEvent(makeDragEvent('dragstart'));
            drawer.dispatchEvent(makeDragEvent('dragover'));
            const folderOverDrawerHint = dragHint.textContent;
            const folderOverDrawerBlockedClass = dragHint.classList.contains('bt-hint-blocked');
            const drawerHasAnyHighlight =
                drawer.classList.contains('drop-active-folder') ||
                drawer.classList.contains('drop-active-zone') ||
                drawer.classList.contains('drop-active-before') ||
                drawer.classList.contains('drop-active-after');
            folderPillNow.dispatchEvent(makeDragEvent('dragend'));

            // 3. Drag chip over itself -> NO blocked hint, no highlight
            const chipNow = drawer.querySelector('[data-folder-item="pack:chaban-bookmarklets/multi_tool"]');
            chipNow.dispatchEvent(makeDragEvent('dragstart'));
            chipNow.dispatchEvent(makeDragEvent('dragover'));
            const chipOverSelfHint = dragHint.textContent;
            const chipOverSelfBlockedClass = dragHint.classList.contains('bt-hint-blocked');
            const chipHasAnyHighlight =
                chipNow.classList.contains('drop-active-before') ||
                chipNow.classList.contains('drop-active-after') ||
                chipNow.classList.contains('drop-active-folder');
            chipNow.dispatchEvent(makeDragEvent('dragend'));

            return {
                cardOverFolderHint,
                cardOverFolderHighlight,
                hasChipAfterDrop,
                folderOverDrawerHint,
                folderOverDrawerBlockedClass,
                drawerHasAnyHighlight,
                chipOverSelfHint,
                chipOverSelfBlockedClass,
                chipHasAnyHighlight,
            };
        })()`);

        assert.equal(scenario4.cardOverFolderHighlight, true);
        assert.equal(scenario4.cardOverFolderHint, 'Drop script into folder "Review"');
        assert.equal(scenario4.hasChipAfterDrop, true, 'Script card dropped onto folder pill must move into folder');
        assert.equal(scenario4.folderOverDrawerHint, 'Folders cannot be nested inside folders');
        assert.equal(scenario4.folderOverDrawerBlockedClass, true);
        assert.equal(scenario4.drawerHasAnyHighlight, false, 'Blocked folder drop must show zero highlight');
        assert.equal(scenario4.chipOverSelfBlockedClass, false, 'Dragging chip over itself must not show blocked hint');
        assert.notEqual(scenario4.chipOverSelfHint, 'Folders cannot be nested inside folders');
        assert.equal(scenario4.chipHasAnyHighlight, false);

        // =====================================================================
        // Scenario 5: Export JSON -> Import JSON (Replace semantics) -> verify Local Scripts
        // and Layout replace cleanly and persist across reload.
        // =====================================================================
        const exportedJsonStr = await evaluate(`(() => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.getElementById('btn-export-open').click();
            const val = sr.getElementById('export-preview').value;
            sr.getElementById('export-close').click();
            return val;
        })()`);

        const exportedEnvelope = JSON.parse(exportedJsonStr);
        assert.equal(exportedEnvelope.version, 1);
        assert.equal(exportedEnvelope.layout.length, 2);
        assert.equal(exportedEnvelope.layout[0].scriptId, 'pack:chaban-bookmarklets/approve_all_edits');
        assert.equal(exportedEnvelope.layout[1].type, 'folder');
        assert.equal(exportedEnvelope.layout[1].name, 'Review');
        assert.equal(exportedEnvelope.layout[1].items.length, 1);
        assert.equal(exportedEnvelope.layout[1].items[0].scriptId, 'pack:chaban-bookmarklets/multi_tool');

        const replacementPayload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            scripts: {
                'local:mb_release_editor_probe': {
                    id: 'local:mb_release_editor_probe',
                    source: 'local',
                    name: 'MB Release Editor Probe',
                    label: 'MB Probe',
                    description: 'Reads and advances window.MB._releaseEditor in page context',
                    match: ['*://*.musicbrainz.org/*'],
                    code: 'javascript:(()=>{if(window.MB&&window.MB._releaseEditor){const before=window.MB._releaseEditor.activeTabID();const after=window.MB._releaseEditor.nextTab();window.__mbProbeResult={before,after,calls:[...window.MB._releaseEditor._tabCalls]};}})();',
                },
            },
            layout: [
                {
                    type: 'script',
                    scriptId: 'local:mb_release_editor_probe',
                    label: 'MB Probe',
                },
            ],
        };

        const importCheck = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.getElementById('btn-import-open').click();
            const importText = sr.getElementById('import-text');
            importText.value = ${JSON.stringify(JSON.stringify(replacementPayload))};
            sr.getElementById('import-apply').click();
            await new Promise((r) => setTimeout(r, 40));

            const importClosed = sr.getElementById('import-backdrop').classList.contains('hidden');
            const toastText = sr.getElementById('toast').textContent.trim();
            const stripPills = [...sr.querySelectorAll('#toolbar-strip [data-toolbar-script]')].map(
                (el) => el.dataset.toolbarScript
            );
            const stripFolders = [...sr.querySelectorAll('#toolbar-strip [data-folder-pill]')].map(
                (el) => el.dataset.folderPill
            );
            return {
                importClosed,
                toastText,
                stripPills,
                stripFolders,
            };
        })()`);

        assert.equal(importCheck.importClosed, true);
        assert.equal(importCheck.toastText, 'Imported & replaced Local Scripts and Layout');
        assert.deepEqual(importCheck.stripPills, ['local:mb_release_editor_probe']);
        assert.deepEqual(importCheck.stripFolders, [], 'Replace import must remove previous folders');

        // Reload page and verify LocalScripts and Layout persisted across reload
        await reloadAndInject();

        const afterReloadCheck = await evaluate(`(() => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const sr = toolbarHost?.shadowRoot;
            const probeBtn = sr?.querySelector('[data-script-id="local:mb_release_editor_probe"]');
            const storedLocal = window.__gmStore['UserJS.BookmarkletToolbar.LocalScripts'] || {};
            const storedLayout = window.__gmStore['UserJS.BookmarkletToolbar.Layout'] || [];
            return {
                hasToolbar: Boolean(toolbarHost),
                probeBtnText: probeBtn?.textContent?.trim() || null,
                localScriptIds: Object.keys(storedLocal),
                layoutScriptIds: storedLayout.map((n) => n.scriptId),
            };
        })()`);

        assert.equal(afterReloadCheck.hasToolbar, true);
        assert.equal(afterReloadCheck.probeBtnText, 'MB Probe');
        assert.deepEqual(afterReloadCheck.localScriptIds, ['local:mb_release_editor_probe']);
        assert.deepEqual(afterReloadCheck.layoutScriptIds, ['local:mb_release_editor_probe']);

        // =====================================================================
        // Scenario 6: Test executing a script accessing window.MB._releaseEditor runs
        // in real page context, and verify CSP violation event toast displays cleanly
        // on a CSP-restricted test frame.
        // =====================================================================
        const pageExecResult = await evaluate(`(() => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const probeBtn = toolbarHost.shadowRoot.querySelector('[data-script-id="local:mb_release_editor_probe"]');
            probeBtn.click();
            return window.__mbProbeResult || null;
        })()`);

        assert.deepEqual(pageExecResult, {
            before: '#information',
            after: '#tracklist',
            calls: ['nextTab'],
        });

        // Navigate to strict CSP page (`Content-Security-Policy: script-src 'none'`)
        await navigateAndInject(`http://musicbrainz.org:${port}/csp-strict`);

        const cspExecResult = await evaluate(`(async () => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const probeBtn = toolbarHost?.shadowRoot?.querySelector('[data-script-id="local:mb_release_editor_probe"]');
            probeBtn.click();
            await new Promise((r) => setTimeout(r, 80));

            const overlayHost = document.getElementById('userjs-bt-overlay-host');
            const toast = overlayHost?.shadowRoot?.getElementById('toast');
            return {
                toastVisible: Boolean(toast && !toast.classList.contains('hidden')),
                toastText: toast?.textContent?.trim() || '',
                probeRanOnCspPage: Boolean(window.__mbProbeResult),
            };
        })()`);

        assert.equal(cspExecResult.probeRanOnCspPage, false, 'Inline script must be blocked by strict CSP');
        assert.equal(cspExecResult.toastVisible, true, 'CSP violation must display error toast inside Shadow DOM');
        assert.match(
            cspExecResult.toastText,
            /Bookmarklet error: Blocked by page Content Security Policy/i
        );
    } finally {
        await cdp.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
