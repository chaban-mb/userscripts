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

        if (url.pathname === '/csp-style-strict') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Security-Policy': "style-src 'self'",
            });
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Strict Style CSP Page</title></head>
<body>
    <main id="page"><h1>Strict Style CSP Frame</h1></main>
</body>
</html>`);
            return;
        }

        if (url.pathname === '/csp-script-blob') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Security-Policy': "script-src 'self' 'unsafe-eval' blob:",
            });
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Blob Script CSP Page</title></head>
<body>
    <main id="page"><h1>Blob Script CSP Frame</h1></main>
</body>
</html>`);
            return;
        }

        if (url.pathname === '/csp-script-strict') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Security-Policy': "script-src 'self'",
            });
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Strict Script CSP Page</title></head>
<body>
    <main id="page"><h1>Strict Script CSP Frame</h1></main>
</body>
</html>`);
            return;
        }

        if (url.pathname === '/iframe-host') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Iframe Host Page</title></head>
<body>
    <main id="page">
        <h1>Top Frame</h1>
        <iframe id="same-origin-frame" src="/mb-release" style="width: 600px; height: 300px;"></iframe>
    </main>
</body>
</html>`);
            return;
        }

        if (url.pathname === '/mobile-no-viewport') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Mobile Release Without Viewport Meta - MusicBrainz</title>
</head>
<body>
    <header><strong>MusicBrainz Non-Viewport Page</strong></header>
    <main id="page">
        <h1>Release Editor</h1>
        <p style="width: 980px;">Wide legacy layout content</p>
    </main>
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
            'Open Settings',
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
                handleRect: handleBtn?.getBoundingClientRect().toJSON() || null,
                hasAnchorPill: Boolean(dockContainer?.querySelector('.bt-dock-anchor-pill')),
                hasItemsBar: Boolean(dockContainer?.querySelector('.bt-dock-items-bar')),
                actionBtns: getActionBtns(),
            };

            // Expand on click
            handleBtn.click();
            await new Promise((r) => setTimeout(r, 240));
            const expandedHandleBtn = toolbarHost.shadowRoot.querySelector('.bt-dock-handle');
            const clickExpandedState = {
                hasCollapsedClass: dockContainer?.classList.contains('bt-toolbar-dock-collapsed') || false,
                ariaExpanded: expandedHandleBtn?.getAttribute('aria-expanded') || null,
                handleRect: expandedHandleBtn?.getBoundingClientRect().toJSON() || null,
                hasAnchorPill: Boolean(dockContainer?.querySelector('.bt-dock-anchor-pill')),
                hasItemsBar: Boolean(dockContainer?.querySelector('.bt-dock-items-bar')),
                itemsBarRect: dockContainer?.querySelector('.bt-dock-items-bar')?.getBoundingClientRect().toJSON() || null,
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
        assert.equal(afterPinMetrics.collapsedState.hasAnchorPill, true, 'bottom-center must render .bt-dock-anchor-pill');
        assert.equal(afterPinMetrics.collapsedState.hasItemsBar, false);
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

        // Verify click-to-expand and hover-to-expand (two-tier center: [⌘, ...scripts] in .bt-dock-items-bar)
        assert.equal(afterPinMetrics.clickExpandedState.hasCollapsedClass, false);
        assert.equal(afterPinMetrics.clickExpandedState.ariaExpanded, 'true');
        assert.equal(afterPinMetrics.clickExpandedState.hasAnchorPill, true);
        assert.equal(afterPinMetrics.clickExpandedState.hasItemsBar, true);
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns.length, 2);
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns[0].action, 'open-palette');
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns[1].scriptId, 'pack:chaban-bookmarklets/approve_all_edits');
        assert.equal(afterPinMetrics.clickExpandedState.actionBtns[1].text, 'Approve All');
        assert.equal(
            Math.abs(afterPinMetrics.clickExpandedState.handleRect.left - afterPinMetrics.collapsedState.handleRect.left) < 0.01,
            true,
            `Handle left must shift 0px at bottom-center (${afterPinMetrics.collapsedState.handleRect.left} -> ${afterPinMetrics.clickExpandedState.handleRect.left})`
        );
        assert.equal(
            Math.abs(afterPinMetrics.clickExpandedState.handleRect.top - afterPinMetrics.collapsedState.handleRect.top) < 0.01,
            true,
            `Handle top must shift 0px at bottom-center (${afterPinMetrics.collapsedState.handleRect.top} -> ${afterPinMetrics.clickExpandedState.handleRect.top})`
        );

        assert.equal(afterPinMetrics.hoverExpandedState.hasCollapsedClass, false);
        assert.equal(afterPinMetrics.hoverExpandedState.ariaExpanded, 'true');
        assert.equal(afterPinMetrics.hoverExpandedState.actionBtns.length, 2);

        // Verify real pointer hover bridge across the 6px gap at bottom-center in hover mode
        const hoverBridgeStart = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.getElementById('btn-manager-settings').click();
            sr.querySelector('[data-dock-expand-mode="hover"]').click();
            sr.getElementById('settings-close').click();
            sr.getElementById('manager-close').click();
            await new Promise((r) => setTimeout(r, 30));
            const th = document.getElementById('userjs-bt-toolbar-host');
            const handleRect = th.shadowRoot.querySelector('.bt-dock-handle').getBoundingClientRect().toJSON();
            const pillRect = th.shadowRoot.querySelector('.bt-dock-anchor-pill').getBoundingClientRect().toJSON();
            return {
                x: handleRect.left + handleRect.width / 2,
                y: handleRect.top + handleRect.height / 2,
                gapY: pillRect.top - 3,
                barY: pillRect.top - 16,
            };
        })()`);

        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: hoverBridgeStart.x,
            y: hoverBridgeStart.y,
        });
        await new Promise((r) => setTimeout(r, 30));
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: hoverBridgeStart.x,
            y: hoverBridgeStart.gapY,
        });
        await new Promise((r) => setTimeout(r, 30));
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: hoverBridgeStart.x,
            y: hoverBridgeStart.barY,
        });
        await new Promise((r) => setTimeout(r, 30));

        const hoverBridgeResult = await evaluate(`(async () => {
            const th = document.getElementById('userjs-bt-toolbar-host');
            const bar = th.shadowRoot.querySelector('.bt-dock-items-bar');
            const expanded = th.shadowRoot.querySelector('.bt-dock-handle')?.getAttribute('aria-expanded') === 'true';
            // Restore 'both' mode and reopen Manager for Scenario 3 (dock stays pinned expanded from Scenario 2)
            window.__invokeGmMenu('Open Bookmarklet Manager');
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.getElementById('btn-manager-settings').click();
            sr.querySelector('[data-dock-expand-mode="both"]').click();
            sr.getElementById('settings-close').click();
            await new Promise((r) => setTimeout(r, 20));
            return { expanded, hasBar: Boolean(bar) };
        })()`);
        assert.equal(hoverBridgeResult.expanded, true, 'Hover bridge must keep dock open across 6px gap');
        assert.equal(hoverBridgeResult.hasBar, true);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });

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

        // Scenario 4b: Folder dropdown 6px hover bridge in 'hover' mode stays open across gap
        const folderBridgeCoords = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.getElementById('btn-manager-settings').click();
            sr.querySelector('[data-dock-expand-mode="hover"]').click();
            sr.getElementById('settings-close').click();
            sr.getElementById('manager-close').click();
            await new Promise((r) => setTimeout(r, 30));
            const th = document.getElementById('userjs-bt-toolbar-host');
            const handleRect = th.shadowRoot.querySelector('.bt-dock-handle').getBoundingClientRect().toJSON();
            return {
                hx: handleRect.left + handleRect.width / 2,
                hy: handleRect.top + handleRect.height / 2,
            };
        })()`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: folderBridgeCoords.hx, y: folderBridgeCoords.hy });
        await new Promise((r) => setTimeout(r, 30));
        const folderDropdownCoords = await evaluate(`(async () => {
            const th = document.getElementById('userjs-bt-toolbar-host');
            const folderBtn = th.shadowRoot.querySelector('[data-folder-id]');
            folderBtn.click();
            await new Promise((r) => setTimeout(r, 30));
            const fr = th.shadowRoot.querySelector('[data-folder-id]').getBoundingClientRect().toJSON();
            const dr = th.shadowRoot.querySelector('.bt-dropdown').getBoundingClientRect().toJSON();
            return {
                fx: fr.left + fr.width / 2,
                fy: fr.top + fr.height / 2,
                gapY: fr.top - 3,
                dy: dr.top + dr.height / 2,
            };
        })()`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: folderDropdownCoords.fx, y: folderDropdownCoords.fy });
        await new Promise((r) => setTimeout(r, 20));
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: folderDropdownCoords.fx, y: folderDropdownCoords.gapY });
        await new Promise((r) => setTimeout(r, 20));
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: folderDropdownCoords.fx, y: folderDropdownCoords.dy });
        await new Promise((r) => setTimeout(r, 20));
        const folderBridgeResult = await evaluate(`(async () => {
            const th = document.getElementById('userjs-bt-toolbar-host');
            const hasDropdown = Boolean(th.shadowRoot.querySelector('.bt-dropdown'));
            const expanded = th.shadowRoot.querySelector('.bt-dock-handle')?.getAttribute('aria-expanded') === 'true';
            window.__invokeGmMenu('Open Bookmarklet Manager');
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.getElementById('btn-manager-settings').click();
            sr.querySelector('[data-dock-expand-mode="both"]').click();
            sr.getElementById('settings-close').click();
            await new Promise((r) => setTimeout(r, 20));
            return { hasDropdown, expanded };
        })()`);
        assert.equal(folderBridgeResult.expanded, true, 'Hover bridge between folder button and .bt-dropdown must keep dock open');
        assert.equal(folderBridgeResult.hasDropdown, true, 'Hover bridge between folder button and .bt-dropdown must keep dropdown open');
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });

        // =====================================================================
        // Scenario 5: Export JSON -> Import JSON (Replace semantics) -> verify Local Scripts
        // and Layout replace cleanly and persist across reload.
        // =====================================================================
        const exportedJsonStr = await evaluate(`(() => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.getElementById('btn-manager-settings').click();
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

            // Scroll .bt-manager-body, open ⓘ on a visible lower card, verify viewport bounds + zero overlap with ⓘ, then scroll to close
            const managerBody = sr?.querySelector('.bt-manager-body');
            if (managerBody) {
                managerBody.scrollTop = 0;
            }
            const scrollBefore = managerBody ? managerBody.scrollTop : 0;
            if (managerBody) {
                managerBody.scrollTop = Math.min(220, Math.max(80, managerBody.scrollHeight - managerBody.clientHeight));
            }
            await new Promise((r) => setTimeout(r, 40));

            const stickyBottom = sr?.querySelector('.bt-sticky-section')?.getBoundingClientRect()?.bottom || 180;
            const visibleTargetCard = [...(sr?.querySelectorAll('#library-grid [data-library-card]') || [])]
                .find((card) => {
                    const r = card.getBoundingClientRect();
                    return r.top >= stickyBottom + 8 && r.bottom <= window.innerHeight - 40;
                });
            const targetCardId = visibleTargetCard?.dataset?.libraryCard || null;
            const targetInfoBtn = visibleTargetCard
                ? [...visibleTargetCard.querySelectorAll('button')].find((b) => b.textContent === 'ⓘ')
                : null;
            targetInfoBtn?.click();

            const rerenderedCard = targetCardId
                ? sr.querySelector('#library-grid [data-library-card="' + targetCardId + '"]')
                : null;
            const rerenderedInfoBtn = rerenderedCard
                ? [...rerenderedCard.querySelectorAll('button')].find((b) => b.textContent === 'ⓘ')
                : null;
            const scrolledPop = rerenderedCard?.querySelector('.bt-popover') || null;
            const scrolledPopRect = scrolledPop ? scrolledPop.getBoundingClientRect().toJSON() : null;
            const scrolledBtnRect = rerenderedInfoBtn ? rerenderedInfoBtn.getBoundingClientRect().toJSON() : null;

            if (managerBody) {
                managerBody.scrollTop += 40;
            }
            await new Promise((r) => setTimeout(r, 50));
            const popoverRemovedAfterScroll = sr?.querySelector('#library-grid .bt-popover') === null;

            sr?.querySelector('#manager-backdrop .bt-close')?.click();
            const probeBtn = toolbarHost?.shadowRoot?.querySelector('[data-script-id="local:mb_release_editor_probe"]');
            probeBtn?.click();
            await new Promise((r) => setTimeout(r, 40));

            return {
                paletteVisible,
                paletteItemsCount,
                managerVisible,
                hasPopoverMatches: popoverText.includes('*://'),
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                scrollBefore,
                scrolledPopRect,
                scrolledBtnRect,
                popoverRemovedAfterScroll,
                probeResult: window.__mbProbeResult || null,
            };
        })()`);

        assert.equal(trustedTypesResult.paletteVisible, true);
        assert.ok(trustedTypesResult.paletteItemsCount > 0);
        assert.equal(trustedTypesResult.managerVisible, true);
        assert.equal(trustedTypesResult.hasPopoverMatches, true);
        assert.ok(trustedTypesResult.scrolledPopRect && trustedTypesResult.scrolledBtnRect, 'Expected visible scrolled card popover and info button rects');
        assert.ok(
            trustedTypesResult.scrolledPopRect.left >= 8 &&
                trustedTypesResult.scrolledPopRect.right <= trustedTypesResult.viewportWidth - 8,
            `Scrolled popover must clamp horizontally within [8, vw - 8], got left=${trustedTypesResult.scrolledPopRect.left}, right=${trustedTypesResult.scrolledPopRect.right}`
        );
        assert.ok(
            trustedTypesResult.scrolledPopRect.top >= 8 &&
                trustedTypesResult.scrolledPopRect.bottom <= trustedTypesResult.viewportHeight - 8,
            `Scrolled popover must clamp vertically within [8, vh - 8], got top=${trustedTypesResult.scrolledPopRect.top}, bottom=${trustedTypesResult.scrolledPopRect.bottom}`
        );
        assert.equal(
            trustedTypesResult.scrolledPopRect.bottom <= trustedTypesResult.scrolledBtnRect.top ||
                trustedTypesResult.scrolledPopRect.top >= trustedTypesResult.scrolledBtnRect.bottom,
            true,
            `Scrolled popover must not vertically overlap its ⓘ button (pop=[${trustedTypesResult.scrolledPopRect.top}, ${trustedTypesResult.scrolledPopRect.bottom}], btn=[${trustedTypesResult.scrolledBtnRect.top}, ${trustedTypesResult.scrolledBtnRect.bottom}])`
        );
        const popGapPx =
            trustedTypesResult.scrolledPopRect.top >= trustedTypesResult.scrolledBtnRect.bottom
                ? trustedTypesResult.scrolledPopRect.top - trustedTypesResult.scrolledBtnRect.bottom
                : trustedTypesResult.scrolledBtnRect.top - trustedTypesResult.scrolledPopRect.bottom;
        assert.ok(
            popGapPx <= 16,
            `Scrolled popover must anchor adjacent to its ⓘ button (gap=${popGapPx}px, pop=[${trustedTypesResult.scrolledPopRect.top}, ${trustedTypesResult.scrolledPopRect.bottom}], btn=[${trustedTypesResult.scrolledBtnRect.top}, ${trustedTypesResult.scrolledBtnRect.bottom}])`
        );
        assert.equal(
            trustedTypesResult.popoverRemovedAfterScroll,
            true,
            'Scrolling .bt-manager-body must close open script info popover'
        );
        assert.deepEqual(trustedTypesResult.probeResult, {
            before: '#information',
            after: '#tracklist',
            calls: ['nextTab'],
        });

        // =====================================================================
        // Scenario 8: Unmocked Strict Style CSP (`style-src 'self'`), Blob Script
        // CSP (`script-src 'self' 'unsafe-eval' blob:`), Strict Script CSP
        // (`script-src 'self'`, NO GM.addElement mock), and Top-Frame Only
        // (`/iframe-host` same-origin iframe).
        // =====================================================================
        const cspMonitor = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
            source: `(() => {
                window.__btCspViolations = [];
                document.addEventListener('securitypolicyviolation', (e) => {
                    window.__btCspViolations.push({
                        effectiveDirective: e.effectiveDirective || '',
                        violatedDirective: e.violatedDirective || '',
                        blockedURI: e.blockedURI || '',
                    });
                });
            })();`,
        });

        try {
            await navigateAndInject(`http://musicbrainz.org:${port}/csp-style-strict`);

            const styleCspCheck = await evaluate(`(async () => {
                window.__invokeGmMenu('Open Settings');
                await new Promise((r) => setTimeout(r, 40));
                const th = document.getElementById('userjs-bt-toolbar-host');
                const oh = document.getElementById('userjs-bt-overlay-host');
                const container = th?.shadowRoot?.getElementById('bt-toolbar-container');
                const settingsModal = oh?.shadowRoot?.querySelector('#settings-backdrop .bt-modal');
                const styleViolations = (window.__btCspViolations || []).filter((v) =>
                    String(v.effectiveDirective || v.violatedDirective).includes('style-src')
                );
                const result = {
                    styleViolationCount: styleViolations.length,
                    toolbarInlineStyleTags: th?.shadowRoot?.querySelectorAll('style').length ?? -1,
                    overlayInlineStyleTags: oh?.shadowRoot?.querySelectorAll('style').length ?? -1,
                    toolbarAdoptedCount: th?.shadowRoot?.adoptedStyleSheets?.length || 0,
                    overlayAdoptedCount: oh?.shadowRoot?.adoptedStyleSheets?.length || 0,
                    containerDisplay: container ? getComputedStyle(container).display : null,
                    modalBg: settingsModal ? getComputedStyle(settingsModal).backgroundColor : null,
                };
                oh?.shadowRoot?.getElementById('settings-close')?.click();
                return result;
            })()`);

            assert.equal(styleCspCheck.styleViolationCount, 0, 'style-src strict page must trigger 0 style-src CSP violations');
            assert.equal(styleCspCheck.toolbarInlineStyleTags, 0);
            assert.equal(styleCspCheck.overlayInlineStyleTags, 0);
            assert.ok(styleCspCheck.toolbarAdoptedCount > 0);
            assert.ok(styleCspCheck.overlayAdoptedCount > 0);
            assert.equal(styleCspCheck.containerDisplay, 'inline-flex');
            assert.notEqual(styleCspCheck.modalBg, 'rgba(0, 0, 0, 0)');
        } finally {
            await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
                identifier: cspMonitor.identifier,
            });
        }

        // Blob CSP: inline script blocked -> blob: URL fallback executes without GM.addElement
        await navigateAndInject(`http://musicbrainz.org:${port}/csp-script-blob`);
        const blobCspCheck = await evaluate(`(async () => {
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
            const th = document.getElementById('userjs-bt-toolbar-host');
            const probeBtn = th?.shadowRoot?.querySelector('[data-script-id="local:mb_release_editor_probe"]');
            probeBtn?.click();
            await new Promise((r) => setTimeout(r, 120));
            const toast = document.getElementById('userjs-bt-overlay-host')?.shadowRoot?.getElementById('toast');
            return {
                hasGmAddElement: typeof window.GM?.addElement === 'function',
                probeResult: window.__mbProbeResult || null,
                toastVisible: Boolean(toast && !toast.classList.contains('hidden')),
            };
        })()`);

        assert.equal(blobCspCheck.hasGmAddElement, false, 'E2E harness must not mock GM.addElement');
        assert.deepEqual(blobCspCheck.probeResult, {
            before: '#information',
            after: '#tracklist',
            calls: ['nextTab'],
        });
        assert.equal(blobCspCheck.toastVisible, false);

        // Strict Script CSP (`script-src 'self'`, no blob:, no mocked GM.addElement): surfaces real CSP error toast
        await navigateAndInject(`http://musicbrainz.org:${port}/csp-script-strict`);
        const strictScriptCspCheck = await evaluate(`(async () => {
            const th = document.getElementById('userjs-bt-toolbar-host');
            const probeBtn = th?.shadowRoot?.querySelector('[data-script-id="local:mb_release_editor_probe"]');
            probeBtn?.click();
            await new Promise((r) => setTimeout(r, 140));
            const toast = document.getElementById('userjs-bt-overlay-host')?.shadowRoot?.getElementById('toast');
            return {
                hasGmAddElement: typeof window.GM?.addElement === 'function',
                probeResult: window.__mbProbeResult || null,
                toastVisible: Boolean(toast && !toast.classList.contains('hidden')),
                toastText: toast?.textContent?.trim() || '',
            };
        })()`);

        assert.equal(strictScriptCspCheck.hasGmAddElement, false, 'Strict CSP test must NOT mock GM.addElement');
        assert.equal(strictScriptCspCheck.probeResult, null);
        assert.equal(strictScriptCspCheck.toastVisible, true);
        assert.match(
            strictScriptCspCheck.toastText,
            /Bookmarklet error: Blocked by page Content Security Policy/i
        );

        // Same-origin iframe guard: top frame mounts 1 dock, iframe mounts 0
        await navigateAndInject(`http://musicbrainz.org:${port}/iframe-host`);
        const iframeResult = await evaluate(`(async () => {
            const iframe = document.getElementById('same-origin-frame');
            if (!iframe || !iframe.contentWindow || !iframe.contentDocument) {
                throw new Error('Missing same-origin iframe or contentWindow');
            }
            const iw = iframe.contentWindow;
            const idoc = iframe.contentDocument;
            iw.__gmMenuCommands = [];
            iw.GM = {
                info: { script: { name: 'Site Bookmarklet Toolbar', version: '1.0.0' } },
                async getValue(k, fallback) {
                    return Object.prototype.hasOwnProperty.call(window.__gmStore, k)
                        ? structuredClone(window.__gmStore[k])
                        : fallback;
                },
                async setValue() {},
                async deleteValue() {},
                registerMenuCommand(caption, onClick) {
                    iw.__gmMenuCommands.push({ caption, onClick });
                },
            };
            iw.eval(${JSON.stringify(inlinedUserscript)});
            await new Promise((r) => setTimeout(r, 60));
            return {
                topDockCount: document.querySelectorAll('#userjs-bt-toolbar-host').length,
                isSubframe: iw.self !== iw.top,
                iframeMenuCount: iw.__gmMenuCommands.length,
                iframeHasToolbarHost: idoc.getElementById('userjs-bt-toolbar-host') !== null,
                iframeHasOverlayHost: idoc.getElementById('userjs-bt-overlay-host') !== null,
            };
        })()`);
        assert.match(inlinedUserscript, /\/\/\s*@noframes\b/);
        assert.equal(iframeResult.topDockCount, 1);
        assert.equal(iframeResult.isSubframe, true);
        assert.equal(iframeResult.iframeMenuCount, 0);
        assert.equal(iframeResult.iframeHasToolbarHost, false);
        assert.equal(iframeResult.iframeHasOverlayHost, false);
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
                handleRect,
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

        // 1. Tap .bt-dock-handle to expand dock at bottom-center with 0px handle delta
        await touchTap(cdp, initialDock.handleCenter.x, initialDock.handleCenter.y);
        await evaluate('new Promise((r) => setTimeout(r, 240))');

        const expandedDock = await evaluate(`(() => {
            const toolbarHost = document.getElementById('userjs-bt-toolbar-host');
            const handleBtn = toolbarHost?.shadowRoot?.querySelector('.bt-dock-handle');
            const handleRect = handleBtn.getBoundingClientRect().toJSON();
            const barRect = toolbarHost?.shadowRoot?.querySelector('.bt-dock-items-bar')?.getBoundingClientRect().toJSON() || null;
            const btns = [...toolbarHost.shadowRoot.querySelectorAll('button')]
                .filter((b) => !b.classList.contains('bt-dock-handle'))
                .map((b) => b.textContent.trim());
            return {
                ariaExpanded: handleBtn.getAttribute('aria-expanded'),
                rect: toolbarHost.getBoundingClientRect().toJSON(),
                handleRect,
                barRect,
                handleCenter: {
                    x: handleRect.left + handleRect.width / 2,
                    y: handleRect.top + handleRect.height / 2,
                },
                btns,
            };
        })()`);

        assert.equal(expandedDock.ariaExpanded, 'true', 'Tap on .bt-dock-handle must expand dock');
        assert.ok(expandedDock.rect.left >= 0 && expandedDock.rect.right <= 412, 'Expanded dock must fit within [0, 412]');
        assert.ok(expandedDock.barRect && expandedDock.barRect.left >= 0 && expandedDock.barRect.right <= 412, 'Expanded items bar must fit within [0, 412]');
        assert.equal(
            Math.abs(expandedDock.handleRect.left - initialDock.handleRect.left) < 0.01,
            true,
            `Pixel 10 bottom-center handle left must shift 0px (${initialDock.handleRect.left} -> ${expandedDock.handleRect.left})`
        );
        assert.equal(
            Math.abs(expandedDock.handleRect.top - initialDock.handleRect.top) < 0.01,
            true,
            `Pixel 10 bottom-center handle top must shift 0px (${initialDock.handleRect.top} -> ${expandedDock.handleRect.top})`
        );
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

        // 2b. Verify bottom-right 0px handle delta across collapsed/expanded (vertical & horizontal)
        const brDeltaCheck = await evaluate(`(async () => {
            const th = document.getElementById('userjs-bt-toolbar-host');
            const handleBtn = th.shadowRoot.querySelector('.bt-dock-handle');
            const hc = handleBtn.getBoundingClientRect().toJSON();
            // Drag handle to bottom-right (380, 890) via pointer events or test Settings Orientation + collapse/expand
            window.__invokeGmMenu('Open Settings');
            await new Promise((r) => setTimeout(r, 25));
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            sr.querySelector('[data-dock-orientation="horizontal"]').click();
            sr.getElementById('settings-close').click();
            await new Promise((r) => setTimeout(r, 25));

            // Move dock to bottom-right by dragging handle from current position
            const startRect = th.shadowRoot.querySelector('.bt-dock-handle').getBoundingClientRect();
            const sx = startRect.left + startRect.width / 2;
            const sy = startRect.top + startRect.height / 2;
            const hEl = th.shadowRoot.querySelector('.bt-dock-handle');
            hEl.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, button: 0, pointerType: 'touch', clientX: sx, clientY: sy, bubbles: true }));
            hEl.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, pointerType: 'touch', clientX: 380, clientY: 890, bubbles: true }));
            hEl.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', clientX: 380, clientY: 890, bubbles: true }));
            await new Promise((r) => setTimeout(r, 420));

            // Now at bottom-right expanded (from earlier tap) -> measure expanded horizontal, collapse, measure collapsed, expand vertical, measure
            const brExpHoriz = th.shadowRoot.querySelector('.bt-dock-handle').getBoundingClientRect().toJSON();
            th.shadowRoot.querySelector('.bt-dock-handle').click();
            await new Promise((r) => setTimeout(r, 25));
            const brCollapsedBtn = th.shadowRoot.querySelector('.bt-dock-handle');
            const brCollapsedExpanded = brCollapsedBtn.getAttribute('aria-expanded');
            const brCollapsed = brCollapsedBtn.getBoundingClientRect().toJSON();

            window.__invokeGmMenu('Open Settings');
            sr.querySelector('[data-dock-orientation="auto"]').click();
            sr.getElementById('settings-close').click();
            await new Promise((r) => setTimeout(r, 25));
            th.shadowRoot.querySelector('.bt-dock-handle').click();
            await new Promise((r) => setTimeout(r, 240));
            const brExpVertBtn = th.shadowRoot.querySelector('.bt-dock-handle');
            const brExpVertExpanded = brExpVertBtn.getAttribute('aria-expanded');
            const brExpVert = brExpVertBtn.getBoundingClientRect().toJSON();
            const isVertical = th.shadowRoot.getElementById('bt-toolbar-container').classList.contains('bt-dock-vertical');
            return { brCollapsed, brCollapsedExpanded, brExpHoriz, brExpVert, brExpVertExpanded, isVertical };
        })()`);
        assert.equal(brDeltaCheck.brCollapsedExpanded, 'false', 'Clicking expanded handle after drag grace must collapse dock');
        assert.equal(brDeltaCheck.brExpVertExpanded, 'true', 'Clicking collapsed handle must expand dock in vertical orientation');
        assert.equal(brDeltaCheck.isVertical, true, '412x924 corner in Auto orientation must resolve to vertical');
        assert.ok(Math.abs(brDeltaCheck.brExpHoriz.left - brDeltaCheck.brCollapsed.left) < 0.01);
        assert.ok(Math.abs(brDeltaCheck.brExpHoriz.top - brDeltaCheck.brCollapsed.top) < 0.01);
        assert.ok(Math.abs(brDeltaCheck.brExpVert.left - brDeltaCheck.brCollapsed.left) < 0.01);
        assert.ok(Math.abs(brDeltaCheck.brExpVert.top - brDeltaCheck.brCollapsed.top) < 0.01);

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
            const stickySection = sr.querySelector('.bt-sticky-section');
            const stickyPosition = stickySection ? getComputedStyle(stickySection).position : null;

            // Filter search so both #toolbar-strip and multi_tool card fit together in portrait view (non-sticky)
            const mgrSearch = sr.getElementById('mgr-search');
            mgrSearch.value = 'Multi';
            mgrSearch.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 20));

            const multiCard = sr.querySelector('[data-library-card="pack:chaban-bookmarklets/multi_tool"]');
            const grip = multiCard.querySelector('.bt-grip');
            const gripRect = grip.getBoundingClientRect().toJSON();
            const stripRect = sr.getElementById('toolbar-strip').getBoundingClientRect().toJSON();

            return {
                rect,
                scrollW,
                clientW,
                docOverflow,
                stickyPosition,
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
        assert.equal(managerLayout.stickyPosition, 'static', 'Portrait Manager must disable sticky section (#14)');

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
            const pill = sr.querySelector('#toolbar-strip [data-toolbar-script="pack:chaban-bookmarklets/multi_tool"]');
            const pillRect = (pill.querySelector('span') || pill).getBoundingClientRect().toJSON();
            const stickyRect = sr.querySelector('.bt-sticky-section').getBoundingClientRect().toJSON();
            const libRect = sr.querySelector('.bt-library-section').getBoundingClientRect().toJSON();
            return {
                stripIds,
                storedIds,
                pillCenter: { x: pillRect.left + pillRect.width / 2, y: pillRect.top + pillRect.height / 2 },
                libTarget: {
                    x: libRect.left + libRect.width / 2,
                    y: Math.min(libRect.bottom - 20, Math.max(stickyRect.bottom + 36, libRect.top + 80)),
                },
            };
        })()`);

        assert.ok(
            afterTouchDrop.stripIds.includes('pack:chaban-bookmarklets/multi_tool'),
            'Touch pointer-drag from .bt-grip onto #toolbar-strip must place multi_tool'
        );
        assert.ok(afterTouchDrop.storedIds.includes('pack:chaban-bookmarklets/multi_tool'));

        // 4b. Touch pointer-drag Toolbar pill back to .bt-library-section unpins it
        await touchDrag(
            cdp,
            afterTouchDrop.pillCenter.x,
            afterTouchDrop.pillCenter.y,
            afterTouchDrop.libTarget.x,
            afterTouchDrop.libTarget.y,
            10
        );
        await evaluate('new Promise((r) => setTimeout(r, 40))');

        const afterDropBackUnpin = await evaluate(`(() => {
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            const stripIds = [...sr.querySelectorAll('#toolbar-strip [data-toolbar-script]')].map(
                (el) => el.dataset.toolbarScript
            );
            const storedIds = (window.__gmStore['UserJS.BookmarkletToolbar.Layout'] || []).map(
                (n) => n.scriptId
            );
            return { stripIds, storedIds };
        })()`);
        assert.equal(afterDropBackUnpin.stripIds.includes('pack:chaban-bookmarklets/multi_tool'), false);
        assert.equal(afterDropBackUnpin.storedIds.includes('pack:chaban-bookmarklets/multi_tool'), false);

        // 4c. Pin many scripts + folder on 412px mobile -> More » overflow menu appears & works
        const mobileOverflowCheck = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host').shadowRoot;
            const mgrSearch = sr.getElementById('mgr-search');
            mgrSearch.value = '';
            mgrSearch.dispatchEvent(new Event('input', { bubbles: true }));
            sr.getElementById('mgr-only-site').checked = true;
            sr.getElementById('mgr-only-site').dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 20));

            // Pin 8 matching scripts (leaving add_to_merge_queue for folder inline test)
            const cards = [...sr.querySelectorAll('#library-grid [data-library-card]')];
            let pinnedCount = 0;
            for (const card of cards) {
                const sid = card.dataset.libraryCard;
                if (
                    sid !== 'pack:chaban-bookmarklets/approve_all_edits' &&
                    sid !== 'pack:chaban-bookmarklets/add_to_merge_queue'
                ) {
                    card.querySelector('.bt-star-btn').click();
                    pinnedCount += 1;
                    if (pinnedCount >= 8) {
                        break;
                    }
                }
            }
            // Add a folder and move add_to_merge_queue (safe no-alert script) into it
            sr.querySelector('[data-action="add-folder"]').click();
            await new Promise((r) => setTimeout(r, 15));
            const folderInput = sr.querySelector('#toolbar-strip .bt-inline-edit-input');
            folderInput.value = 'MB Tools';
            folderInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
            await new Promise((r) => setTimeout(r, 20));

            const folderPill = sr.querySelector('#toolbar-strip [data-folder-pill]');
            const safeFolderCard = sr.querySelector('[data-library-card="pack:chaban-bookmarklets/add_to_merge_queue"]');
            const makeDrag = (type) => new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: new DataTransfer() });
            safeFolderCard.dispatchEvent(makeDrag('dragstart'));
            folderPill.dispatchEvent(makeDrag('dragover'));
            folderPill.dispatchEvent(makeDrag('drop'));
            safeFolderCard.dispatchEvent(makeDrag('dragend'));
            await new Promise((r) => setTimeout(r, 20));

            // Snap to bottom-center via Horiz + drag handle so 412px width triggers More » overflow
            sr.getElementById('btn-manager-settings').click();
            sr.querySelector('[data-dock-orientation="horizontal"]').click();
            sr.getElementById('settings-close').click();
            sr.getElementById('manager-close').click();
            await new Promise((r) => setTimeout(r, 25));

            const th = document.getElementById('userjs-bt-toolbar-host');
            const hEl = th.shadowRoot.querySelector('.bt-dock-handle');
            const hRect = hEl.getBoundingClientRect();
            const hx = hRect.left + hRect.width / 2;
            const hy = hRect.top + hRect.height / 2;
            hEl.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 15, button: 0, pointerType: 'touch', clientX: hx, clientY: hy, bubbles: true }));
            hEl.dispatchEvent(new PointerEvent('pointermove', { pointerId: 15, pointerType: 'touch', clientX: 206, clientY: 890, bubbles: true }));
            hEl.dispatchEvent(new PointerEvent('pointerup', { pointerId: 15, pointerType: 'touch', clientX: 206, clientY: 890, bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));

            const bar = th.shadowRoot.querySelector('.bt-dock-items-bar');
            const barRect = bar.getBoundingClientRect().toJSON();
            const moreBtn = bar.querySelector('[data-action="open-overflow"]');
            const moreText = moreBtn ? moreBtn.textContent.trim() : null;
            moreBtn?.click();
            await new Promise((r) => setTimeout(r, 20));

            const overflowDropdown = th.shadowRoot.querySelector('.bt-dropdown');
            const dropdownRect = overflowDropdown ? overflowDropdown.getBoundingClientRect().toJSON() : null;
            const folderToggle = overflowDropdown?.querySelector('[data-overflow-folder-id]');
            folderToggle?.click();
            await new Promise((r) => setTimeout(r, 20));
            const inlineSubitems = th.shadowRoot.querySelectorAll('.bt-dropdown .bt-overflow-subitem');
            const inlineSubitemCount = inlineSubitems.length;
            const clickedSubitemId = inlineSubitems[0]?.dataset?.scriptId || null;
            inlineSubitems[0]?.click();
            await new Promise((r) => setTimeout(r, 20));
            const dropdownClosedAfterRun = th.shadowRoot.querySelector('.bt-dropdown') === null;
            const ranRecorded = Boolean(
                clickedSubitemId &&
                    window.__gmStore?.['UserJS.BookmarkletToolbar.Recents']?.[clickedSubitemId]?.count >= 1
            );

            // Reopen Manager for step 5
            window.__invokeGmMenu('Open Bookmarklet Manager');
            await new Promise((r) => setTimeout(r, 20));

            return {
                barRect,
                moreText,
                hasDropdown: Boolean(overflowDropdown),
                dropdownRect,
                hasFolderToggle: Boolean(folderToggle),
                inlineSubitemCount,
                dropdownClosedAfterRun,
                ranRecorded,
            };
        })()`);
        assert.equal(mobileOverflowCheck.moreText, 'More »', '412px mobile dock with 8+ items must render More » overflow');
        assert.ok(mobileOverflowCheck.barRect.left >= 0 && mobileOverflowCheck.barRect.right <= 412);
        assert.equal(mobileOverflowCheck.hasDropdown, true);
        assert.ok(mobileOverflowCheck.dropdownRect.left >= 8 && mobileOverflowCheck.dropdownRect.right <= 404, 'More » dropdown must clamp within 8px of 412px viewport');
        assert.equal(mobileOverflowCheck.hasFolderToggle, true);
        assert.ok(mobileOverflowCheck.inlineSubitemCount >= 1, 'Overflowed folder must expand items inline inside More » dropdown');
        assert.equal(mobileOverflowCheck.dropdownClosedAfterRun, true, 'Running an inline item in More » must close the overflow dropdown');
        assert.equal(mobileOverflowCheck.ranRecorded, true, 'Running an inline item in More » must execute and record Recents');

        // 5. Toggle "Hide dock on this site" -> dock unmounts while Command Palette remains openable
        const afterHideDock = await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            sr.getElementById('btn-manager-settings').click();
            sr.getElementById('btn-toggle-dock-site').click();
            await new Promise((r) => setTimeout(r, 30));

            const toolbarHostAfterHide = document.getElementById('userjs-bt-toolbar-host');
            sr.getElementById('settings-close').click();
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

        // 6. Non-viewport-meta mobile page (/mobile-no-viewport, 412x924 hasTouch: true):
        // top-center More » fits within 412px, sub-modals top-aligned + scrollable,
        // single taps toggle [⚡] reliably, and portrait Manager scrolls cleanly.
        await evaluate(`(async () => {
            const sr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            sr?.getElementById('palette-backdrop')?.click();
            window.__invokeGmMenu('Toggle Dock on This Site');
            await new Promise((r) => setTimeout(r, 30));
        })()`);

        await navigateAndInject(`http://musicbrainz.org:${port}/mobile-no-viewport`);

        // Single-tap touch toggle (#9): normalize collapsed state, then 1 touch tap expands and 1 touch tap collapses
        const touchToggleCheck = await evaluate(`(async () => {
            const getHandle = () => document.getElementById('userjs-bt-toolbar-host')?.shadowRoot?.querySelector('.bt-dock-handle');
            if (getHandle()?.getAttribute('aria-expanded') === 'true') {
                getHandle().click();
                await new Promise((r) => setTimeout(r, 40));
            }
            const collapsedInitial = getHandle()?.getAttribute('aria-expanded');

            const simulateTouchTap = async () => {
                const h = getHandle();
                const r = h.getBoundingClientRect();
                const x = r.left + r.width / 2;
                const y = r.top + r.height / 2;
                h.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 31, button: 0, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
                h.dispatchEvent(new PointerEvent('pointerup', { pointerId: 31, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
                await new Promise((r) => setTimeout(r, 30));
                h.click();
            };

            await simulateTouchTap();
            await new Promise((r) => setTimeout(r, 240));
            const expandedAfterFirstTap = getHandle()?.getAttribute('aria-expanded');

            await simulateTouchTap();
            await new Promise((r) => setTimeout(r, 80));
            const collapsedAfterSecondTap = getHandle()?.getAttribute('aria-expanded');

            return { collapsedInitial, expandedAfterFirstTap, collapsedAfterSecondTap };
        })()`);

        assert.equal(touchToggleCheck.collapsedInitial, 'false');
        assert.equal(touchToggleCheck.expandedAfterFirstTap, 'true', 'Single touch tap on [⚡] must expand dock');
        assert.equal(touchToggleCheck.collapsedAfterSecondTap, 'false', 'Single touch tap on expanded [⚡] must collapse dock without double-toggle');

        // Re-expand and drag fresh handle to top-center; verify More » bar fits cleanly without horizontal overflow
        const topCenterNoVp = await evaluate(`(async () => {
            const th = document.getElementById('userjs-bt-toolbar-host');
            const sr = th.shadowRoot;
            sr.querySelector('.bt-dock-handle').click();
            await new Promise((r) => setTimeout(r, 240));

            const hEl = sr.querySelector('.bt-dock-handle');
            const r0 = hEl.getBoundingClientRect();
            const sx = r0.left + r0.width / 2;
            const sy = r0.top + r0.height / 2;
            const effVw = Math.min(window.innerWidth || 9999, document.documentElement.clientWidth || 9999, window.visualViewport?.width || 9999);
            const targetX = effVw / 2;
            hEl.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, button: 0, pointerType: 'touch', clientX: sx, clientY: sy, bubbles: true }));
            hEl.dispatchEvent(new PointerEvent('pointermove', { pointerId: 21, pointerType: 'touch', clientX: targetX, clientY: 20, bubbles: true }));
            hEl.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, pointerType: 'touch', clientX: targetX, clientY: 20, bubbles: true }));
            await new Promise((r) => setTimeout(r, 40));

            const bar = sr.querySelector('.bt-dock-items-bar');
            const barRect = bar?.getBoundingClientRect().toJSON() || null;
            const barScrollW = bar ? bar.scrollWidth : 0;
            const barClientW = bar ? bar.clientWidth : 0;
            const moreBtn = bar?.querySelector('[data-action="open-overflow"]');

            // Check Manager + sub-modal top-aligned & scrollable
            window.__invokeGmMenu('Open Bookmarklet Manager');
            await new Promise((r) => setTimeout(r, 30));
            const osr = document.getElementById('userjs-bt-overlay-host')?.shadowRoot;
            const managerBody = osr.querySelector('.bt-manager-body');
            const libraryRect = osr.querySelector('.bt-library-section')?.getBoundingClientRect().toJSON() || null;

            osr.getElementById('btn-new-local').click();
            await new Promise((r) => setTimeout(r, 25));
            const editorBackdrop = osr.getElementById('editor-backdrop');
            const editorModal = editorBackdrop?.querySelector('.bt-modal');
            const formBody = editorBackdrop?.querySelector('.bt-form-body');
            const editorBackdropAlign = editorBackdrop ? getComputedStyle(editorBackdrop).alignItems : null;
            const editorRect = editorModal ? editorModal.getBoundingClientRect().toJSON() : null;
            const formOverflowY = formBody ? getComputedStyle(formBody).overflowY : null;
            osr.getElementById('editor-close').click();
            osr.getElementById('manager-close').click();

            return {
                effVw,
                innerWidth: window.innerWidth,
                clientWidth: document.documentElement.clientWidth,
                vvWidth: window.visualViewport?.width || null,
                barRect,
                barScrollW,
                barClientW,
                hasMore: Boolean(moreBtn),
                managerBodyOverflowY: managerBody ? getComputedStyle(managerBody).overflowY : null,
                libraryHeight: libraryRect ? libraryRect.height : 0,
                editorBackdropAlign,
                editorRect,
                formOverflowY,
            };
        })()`);

        assert.equal(topCenterNoVp.hasMore, true, 'top-center non-viewport-meta dock must show More »');
        assert.ok(topCenterNoVp.barRect && topCenterNoVp.barRect.left >= 0 && topCenterNoVp.barRect.right <= topCenterNoVp.effVw + 1, `top-center bar right (${topCenterNoVp.barRect?.right}) must fit within effVw=${topCenterNoVp.effVw}`);
        assert.ok(topCenterNoVp.barScrollW <= topCenterNoVp.barClientW + 1, 'top-center items bar must not overflow horizontally');
        assert.ok(
            ['flex-start', 'start', 'flow-start'].includes(topCenterNoVp.editorBackdropAlign),
            `Sub-modals must top-align on mobile (got alignItems=${topCenterNoVp.editorBackdropAlign})`
        );
        assert.ok(topCenterNoVp.editorRect && topCenterNoVp.editorRect.top >= 8 && topCenterNoVp.editorRect.top <= 40);
        assert.equal(topCenterNoVp.formOverflowY, 'auto', 'Sub-modal .bt-form-body must be scrollable');
        assert.ok(topCenterNoVp.libraryHeight > 80, 'Portrait Manager Library must not be squished');
    } finally {
        await cdp.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
