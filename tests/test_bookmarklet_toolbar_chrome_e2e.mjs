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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Example Unmatched Site</title></head>
<body>
    <main id="content"><h1>Welcome to Example.com</h1></main>
</body>
</html>`);
            return;
        }

        if (url.pathname === '/mobile') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mobile Release - MusicBrainz</title>
<style>
    body { margin: 0; font-family: sans-serif; padding: 12px; box-sizing: border-box; }
</style>
</head>
<body>
    <header><strong>MusicBrainz Mobile</strong></header>
    <main id="page"><h1>Release Editor</h1></main>
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
<meta name="viewport" content="width=device-width, initial-scale=1">
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

        if (url.pathname === '/trusted-types') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Security-Policy': "require-trusted-types-for 'script'",
            });
            res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Trusted Types Page</title>
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
        <div class="right">
            <div class="top">
                <div class="links-container">User</div>
                <div class="search-container"><input type="text"></div>
            </div>
            <div class="bottom">Nav</div>
        </div>
    </div>
    <h1>Trusted Types Test Frame</h1>
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

async function createSessionHelpers(cdp, inlinedUserscript) {
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

    return { evaluate, navigateAndInject, reloadAndInject };
}

async function touchTap(cdp, x, y) {
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, id: 1 }],
    });
    await new Promise((r) => setTimeout(r, 20));
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
    });
}

async function touchDrag(cdp, fromX, fromY, toX, toY, steps = 8) {
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: fromX, y: fromY, id: 1 }],
    });
    for (let i = 1; i <= steps; i += 1) {
        const x = fromX + ((toX - fromX) * i) / steps;
        const y = fromY + ((toY - fromY) * i) / steps;
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x, y, id: 1 }],
        });
        await new Promise((r) => setTimeout(r, 12));
    }
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
    });
}

test('Real Headless Chrome E2E Verification for Site Bookmarklet Toolbar', async () => {
    const inlinedUserscript = buildInlinedUserscript();
    const { server, port } = await createTestServer();
    const cdp = await launchHeadlessChrome();
    const { evaluate, navigateAndInject, reloadAndInject } = await createSessionHelpers(
        cdp,
        inlinedUserscript
    );

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
            'Toggle Dock on This Site',
        ]);

        // =====================================================================
        // Scenario 2: Open Manager via mocked menu command -> search Library for "Approve",
        // pin via ☆ -> MusicBrainz div.header .right .top and .search-container remain
        // completely untouched while generic dock mounts collapsed at bottom-center,
        // expands on click & hover, and shows placed buttons + Command Palette trigger.
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
            const dockContainer = toolbarHost?.shadowRoot?.getElementById('bt-toolbar-container');
            const handleBtn = toolbarHost?.shadowRoot?.querySelector('.bt-dock-handle');

            const getActionBtns = () =>
                [...(toolbarHost?.shadowRoot?.querySelectorAll('button') || [])]
                    .filter((b) => !b.classList.contains('bt-dock-handle'))
                    .map((b) => ({
                        scriptId: b.dataset.scriptId || null,
                        action: b.dataset.action || null,
                        text: b.textContent.trim(),
                    }));

            const collapsedState = {
                parentTag: toolbarHost?.parentElement?.tagName || null,
                isBodyChild: toolbarHost?.parentElement === document.body,
                hasCollapsedClass: dockContainer?.classList.contains('bt-toolbar-dock-collapsed') || false,
                ariaExpanded: handleBtn?.getAttribute('aria-expanded') || null,
                dockRect: toolbarHost?.getBoundingClientRect().toJSON() || null,
                actionBtns: getActionBtns(),
            };

            // Expand on click
            handleBtn.click();
            await new Promise((r) => setTimeout(r, 25));
            const clickExpandedState = {
                hasCollapsedClass: dockContainer?.classList.contains('bt-toolbar-dock-collapsed') || false,
                ariaExpanded: toolbarHost.shadowRoot.querySelector('.bt-dock-handle')?.getAttribute('aria-expanded') || null,
                actionBtns: getActionBtns(),
            };

            // Collapse via click, then expand via hover (mouseenter)
            toolbarHost.shadowRoot.querySelector('.bt-dock-handle').click();
            await new Promise((r) => setTimeout(r, 25));
            dockContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
            await new Promise((r) => setTimeout(r, 25));
            const hoverExpandedState = {
                hasCollapsedClass: dockContainer?.classList.contains('bt-toolbar-dock-collapsed') || false,
                ariaExpanded: toolbarHost.shadowRoot.querySelector('.bt-dock-handle')?.getAttribute('aria-expanded') || null,
                actionBtns: getActionBtns(),
            };

            // Leave hover and pin open via click for subsequent scenarios
            dockContainer.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
            await new Promise((r) => setTimeout(r, 25));
            toolbarHost.shadowRoot.querySelector('.bt-dock-handle').click();
            await new Promise((r) => setTimeout(r, 25));

            return {
                managerVisible,
                filteredCardIds: cards.map((c) => c.dataset.libraryCard),
                childOrder,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                collapsedState,
                clickExpandedState,
                hoverExpandedState,
                topRowRect: topRow.getBoundingClientRect().toJSON(),
                linksRect: links.getBoundingClientRect().toJSON(),
                searchRect: search.getBoundingClientRect().toJSON(),
                bottomRect: bottom.getBoundingClientRect().toJSON(),
            };
        })()`);

        assert.equal(afterPinMetrics.managerVisible, true, 'Manager modal must open via menu command');
        assert.deepEqual(afterPinMetrics.filteredCardIds, ['pack:chaban-bookmarklets/approve_all_edits']);
        assert.deepEqual(afterPinMetrics.childOrder, [
            'links-container',
            'search-container',
        ], 'MusicBrainz header .top children must remain untouched');
        assert.equal(afterPinMetrics.collapsedState.isBodyChild, true, 'Generic dock must mount on document.body');
        assert.equal(afterPinMetrics.collapsedState.hasCollapsedClass, true, 'Dock must start collapsed');
        assert.equal(afterPinMetrics.collapsedState.ariaExpanded, 'false');
        assert.deepEqual(afterPinMetrics.collapsedState.actionBtns, []);

        // Verify collapsed dock sits at bottom-center
        const dockCenter =
            (afterPinMetrics.collapsedState.dockRect.left +
                afterPinMetrics.collapsedState.dockRect.right) /
            2;
        assert.ok(
            Math.abs(dockCenter - afterPinMetrics.viewportWidth / 2) <= 30,
            `Dock should be horizontally centered at bottom-center (center=${dockCenter}, viewport=${afterPinMetrics.viewportWidth})`
        );
        assert.ok(
            afterPinMetrics.collapsedState.dockRect.bottom >= afterPinMetrics.viewportHeight - 30,
            `Dock should sit near bottom edge (bottom=${afterPinMetrics.collapsedState.dockRect.bottom}, viewport=${afterPinMetrics.viewportHeight})`
        );

        // Verify click-to-expand and hover-to-expand
        assert.equal(afterPinMetrics.clickExpandedState.hasCollapsedClass, false);
        assert.equal(afterPinMetrics.clickExpandedState.ariaExpanded, 'true');
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns.length, 2);
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns[0].scriptId, 'pack:chaban-bookmarklets/approve_all_edits');
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns[0].text, 'Approve All');
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns[1].action, 'open-palette');

        assert.equal(afterPinMetrics.hoverExpandedState.hasCollapsedClass, false);
        assert.equal(afterPinMetrics.hoverExpandedState.ariaExpanded, 'true');
        assert.equal(afterPinMetrics.hoverExpandedState.actionBtns.length, 2);

        // Verify MusicBrainz header bounding boxes are completely untouched
        assert.equal(afterPinMetrics.searchRect.width, beforePinMetrics.searchRect.width);
        assert.equal(afterPinMetrics.searchRect.height, beforePinMetrics.searchRect.height);
        assert.equal(afterPinMetrics.searchRect.left, beforePinMetrics.searchRect.left);
        assert.equal(afterPinMetrics.searchRect.top, beforePinMetrics.searchRect.top);
        assert.equal(afterPinMetrics.linksRect.width, beforePinMetrics.linksRect.width);
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

        // =====================================================================
        // Scenario 7: Strict Trusted Types page (`require-trusted-types-for 'script'`)
        // verifies UI rendering (Toolbar, Command Palette, Manager, Library ⓘ popover)
        // and script execution work cleanly without TrustedHTML / TrustedScript TypeErrors.
        // =====================================================================
        await navigateAndInject(`http://musicbrainz.org:${port}/trusted-types`);

        const trustedTypesResult = await evaluate(`(async () => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const paletteBtn = toolbarHost?.shadowRoot?.querySelector('[data-action="open-palette"]');
            paletteBtn?.click();

            const overlayHost = document.getElementById('userjs-bt-overlay-host');
            const sr = overlayHost?.shadowRoot;
            const paletteVisible = Boolean(
                sr?.getElementById('palette-backdrop') &&
                !sr.getElementById('palette-backdrop').classList.contains('hidden')
            );
            const paletteItemsCount = sr?.querySelectorAll('#palette-list .bt-palette-item').length || 0;

            window.__invokeGmMenu('Open Bookmarklet Manager');
            const managerVisible = Boolean(
                sr?.getElementById('manager-backdrop') &&
                !sr.getElementById('manager-backdrop').classList.contains('hidden')
            );
            const firstCard = sr?.querySelector('#library-grid [data-library-card]');
            const infoBtn = firstCard
                ? [...firstCard.querySelectorAll('button')].find((b) => b.textContent === 'ⓘ')
                : null;
            infoBtn?.click();
            const popoverText = sr?.querySelector('#library-grid [data-library-card] .bt-popover')?.textContent || '';

            sr?.querySelector('#manager-backdrop .bt-close')?.click();
            const probeBtn = toolbarHost?.shadowRoot?.querySelector('[data-script-id="local:mb_release_editor_probe"]');
            probeBtn?.click();
            await new Promise((r) => setTimeout(r, 40));

            return {
                paletteVisible,
                paletteItemsCount,
                managerVisible,
                hasPopoverMatches: popoverText.includes('*://'),
                probeResult: window.__mbProbeResult || null,
            };
        })()`);

        assert.equal(trustedTypesResult.paletteVisible, true);
        assert.ok(trustedTypesResult.paletteItemsCount > 0);
        assert.equal(trustedTypesResult.managerVisible, true);
        assert.equal(trustedTypesResult.hasPopoverMatches, true);
        assert.deepEqual(trustedTypesResult.probeResult, {
            before: '#information',
            after: '#tracklist',
            calls: ['nextTab'],
        });
    } finally {
        await cdp.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('Pixel 10 (412x924, hasTouch: true) Mobile Chrome E2E Verification for Site Bookmarklet Toolbar', async () => {
    const inlinedUserscript = buildInlinedUserscript();
    const { server, port } = await createTestServer();
    const cdp = await launchHeadlessChrome();

    try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 412,
            height: 924,
            deviceScaleFactor: 2.625,
            mobile: true,
        });
        await cdp.send('Emulation.setTouchEmulationEnabled', {
            enabled: true,
            maxTouchPoints: 5,
        });

        const { evaluate, navigateAndInject, reloadAndInject } = await createSessionHelpers(
            cdp,
            inlinedUserscript
        );

        await navigateAndInject(`http://musicbrainz.org:${port}/mobile`);

        // Pin one script via Manager so the dock mounts collapsed at bottom-center
        const initialDock = await evaluate(`(async () => {
            window.__invokeGmMenu('Open Bookmarklet Manager');
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            const approveCard = sr.querySelector('[data-library-card="pack:chaban-bookmarklets/approve_all_edits"]');
            approveCard.querySelector('.bt-star-btn').click();
            sr.getElementById('manager-close').click();
            await new Promise((r) => setTimeout(r, 30));

            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const handleBtn = toolbarHost?.shadowRoot?.querySelector('.bt-dock-handle');
            const rect = toolbarHost.getBoundingClientRect().toJSON();
            const handleRect = handleBtn.getBoundingClientRect().toJSON();
            return {
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                ariaExpanded: handleBtn.getAttribute('aria-expanded'),
                rect,
                handleCenter: {
                    x: handleRect.left + handleRect.width / 2,
                    y: handleRect.top + handleRect.height / 2,
                },
            };
        })()`);

        assert.equal(initialDock.viewportWidth, 412);
        assert.equal(initialDock.viewportHeight, 924);
        assert.equal(initialDock.ariaExpanded, 'false', 'Pixel 10 dock must start collapsed');
        assert.ok(initialDock.rect.left >= 0 && initialDock.rect.right <= 412, 'Collapsed dock must fit within [0, 412]');
        assert.ok(
            Math.abs((initialDock.rect.left + initialDock.rect.right) / 2 - 206) <= 40,
            'Collapsed dock must be centered near bottom-center'
        );
        assert.ok(initialDock.rect.bottom >= 880 && initialDock.rect.bottom <= 924);

        // 1. Tap .bt-dock-handle to expand dock
        await touchTap(cdp, initialDock.handleCenter.x, initialDock.handleCenter.y);
        await evaluate('new Promise((r) => setTimeout(r, 40))');

        const expandedDock = await evaluate(`(() => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const handleBtn = toolbarHost?.shadowRoot?.querySelector('.bt-dock-handle');
            const handleRect = handleBtn.getBoundingClientRect().toJSON();
            const btns = [...toolbarHost.shadowRoot.querySelectorAll('button')]
                .filter((b) => !b.classList.contains('bt-dock-handle'))
                .map((b) => b.textContent.trim());
            return {
                ariaExpanded: handleBtn.getAttribute('aria-expanded'),
                rect: toolbarHost.getBoundingClientRect().toJSON(),
                handleCenter: {
                    x: handleRect.left + handleRect.width / 2,
                    y: handleRect.top + handleRect.height / 2,
                },
                btns,
            };
        })()`);

        assert.equal(expandedDock.ariaExpanded, 'true', 'Tap on .bt-dock-handle must expand dock');
        assert.ok(expandedDock.rect.left >= 0 && expandedDock.rect.right <= 412, 'Expanded dock must fit within [0, 412]');
        assert.ok(expandedDock.btns.includes('Approve All'));

        // 2. Pointer-drag .bt-dock-handle to top-right and verify snap + persistence across reload
        await touchDrag(cdp, expandedDock.handleCenter.x, expandedDock.handleCenter.y, 380, 30, 10);
        await evaluate('new Promise((r) => setTimeout(r, 40))');

        const snappedRect = await evaluate(`(() => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            return toolbarHost.getBoundingClientRect().toJSON();
        })()`);

        assert.ok(snappedRect.top < 60, `Expected dock snapped to top-right (top < 60), got top=${snappedRect.top}`);
        assert.ok(snappedRect.right > 300 && snappedRect.right <= 412, `Expected dock snapped to top-right (300 < right <= 412), got right=${snappedRect.right}`);

        await reloadAndInject();

        const persistedRect = await evaluate(`(() => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            return toolbarHost.getBoundingClientRect().toJSON();
        })()`);
        assert.ok(persistedRect.top < 60 && persistedRect.right > 300, 'top-right dock snap must persist across reload');

        // 3. Command Palette & Manager modal fit within 412px with zero horizontal overflow
        const paletteLayout = await evaluate(`(async () => {
            window.__invokeGmMenu('Open Command Palette');
            await new Promise((r) => setTimeout(r, 30));
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            const modal = sr.querySelector('#palette-backdrop .bt-modal');
            const rect = modal.getBoundingClientRect().toJSON();
            const scrollW = modal.scrollWidth;
            const clientW = modal.clientWidth;
            const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
            sr.getElementById('palette-backdrop').click();
            await new Promise((r) => setTimeout(r, 20));
            return { rect, scrollW, clientW, docOverflow };
        })()`);

        assert.ok(paletteLayout.rect.left >= 0 && paletteLayout.rect.right <= 412, 'Command Palette modal must fit within 412px');
        assert.ok(paletteLayout.scrollW <= paletteLayout.clientW + 1, 'Command Palette modal must not overflow horizontally');
        assert.equal(paletteLayout.docOverflow, false);

        const managerLayout = await evaluate(`(async () => {
            window.__invokeGmMenu('Open Bookmarklet Manager');
            await new Promise((r) => setTimeout(r, 30));
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            const modal = sr.querySelector('#manager-backdrop .bt-modal');
            const rect = modal.getBoundingClientRect().toJSON();
            const scrollW = modal.scrollWidth;
            const clientW = modal.clientWidth;
            const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;

            const multiCard = sr.querySelector('[data-library-card="pack:chaban-bookmarklets/multi_tool"]');
            const grip = multiCard.querySelector('.bt-grip');
            grip.scrollIntoView({ block: 'center' });
            const gripRect = grip.getBoundingClientRect().toJSON();
            const stripRect = sr.getElementById('toolbar-strip').getBoundingClientRect().toJSON();

            return {
                rect,
                scrollW,
                clientW,
                docOverflow,
                gripCenter: {
                    x: gripRect.left + gripRect.width / 2,
                    y: gripRect.top + gripRect.height / 2,
                },
                stripTarget: {
                    x: Math.min(stripRect.right - 16, stripRect.left + stripRect.width * 0.75),
                    y: stripRect.top + stripRect.height / 2,
                },
            };
        })()`);

        assert.ok(managerLayout.rect.left >= 0 && managerLayout.rect.right <= 412, 'Manager modal must fit within 412px');
        assert.ok(managerLayout.scrollW <= managerLayout.clientW + 1, 'Manager modal must not overflow horizontally');
        assert.equal(managerLayout.docOverflow, false);

        // 4. Touch pointer-drag on Library card .bt-grip drops onto #toolbar-strip
        await touchDrag(
            cdp,
            managerLayout.gripCenter.x,
            managerLayout.gripCenter.y,
            managerLayout.stripTarget.x,
            managerLayout.stripTarget.y,
            10
        );
        await evaluate('new Promise((r) => setTimeout(r, 40))');

        const afterTouchDrop = await evaluate(`(() => {
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            const stripIds = [...sr.querySelectorAll('#toolbar-strip [data-toolbar-script]')].map(
                (el) => el.dataset.toolbarScript
            );
            const storedIds = (window.__gmStore['UserJS.BookmarkletToolbar.Layout'] || []).map(
                (n) => n.scriptId
            );
            return { stripIds, storedIds };
        })()`);

        assert.ok(
            afterTouchDrop.stripIds.includes('pack:chaban-bookmarklets/multi_tool'),
            'Touch pointer-drag from .bt-grip onto #toolbar-strip must place multi_tool'
        );
        assert.ok(afterTouchDrop.storedIds.includes('pack:chaban-bookmarklets/multi_tool'));

        // 5. Toggle "Hide dock on this site" -> dock unmounts while Command Palette remains openable
        const afterHideDock = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            sr.getElementById('btn-toggle-dock-site').click();
            await new Promise((r) => setTimeout(r, 30));

            const toolbarHostAfterHide = document.getElementById('userjs-bt-toolbar-host');
            sr.getElementById('manager-close').click();
            await new Promise((r) => setTimeout(r, 20));

            window.__invokeGmMenu('Open Command Palette');
            await new Promise((r) => setTimeout(r, 30));
            const paletteOpen = !sr.getElementById('palette-backdrop').classList.contains('hidden');
            const paletteItems = [...sr.querySelectorAll('#palette-list .bt-palette-item')].map((el) =>
                el.textContent.trim()
            );

            return {
                hasToolbarHostAfterHide: toolbarHostAfterHide !== null,
                paletteOpen,
                hasShowDockAction: paletteItems.some((t) => t.includes('Show Dock on Current Site')),
            };
        })()`);

        assert.equal(afterHideDock.hasToolbarHostAfterHide, false, 'Hiding dock on current site must unmount toolbar host');
        assert.equal(afterHideDock.paletteOpen, true, 'Command Palette must remain openable when dock is hidden');
        assert.equal(afterHideDock.hasShowDockAction, true);
    } finally {
        await cdp.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
