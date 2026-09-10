#!/usr/bin/env node

/**
 * tools/vm_sync.js
 *
 * Automatically synchronizes userscripts from the local repository
 * into Violentmonkey running in Chromium (via CDP on port 9222).
 *
 * Usage:
 *   node tools/vm_sync.js list                # List all scripts in Violentmonkey with IDs
 *   node tools/vm_sync.js sync <file_or_name> # Push a script from disk to Violentmonkey
 *   node tools/vm_sync.js watch [file_or_dir] # Live watch files on disk and push updates on save
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = globalThis.WebSocket || require('ws');

const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = process.env.CDP_PORT || 9222;
const EXTENSION_ID = 'jinjaccalgkegednnccohejagnlnfdag';

function cdpRequest(endpoint, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: CDP_HOST,
      port: CDP_PORT,
      path: endpoint,
      method: method,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function evalInTab(wsUrl, expression, awaitPromise = false) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP evaluation timed out'));
    }, 8000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise,
          returnByValue: true,
        }
      }));
    };

    ws.onmessage = (msg) => {
      clearTimeout(timeout);
      const data = JSON.parse(msg.data);
      ws.close();
      if (data.error) {
        reject(new Error(data.error.message || JSON.stringify(data.error)));
      } else {
        resolve(data.result?.result?.value);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });
}

function extractMetadata(code) {
  const nameMatch = code.match(/\/\/\s*@name\s+(.+)/);
  const versionMatch = code.match(/\/\/\s*@version\s+(\S+)/);
  return {
    name: nameMatch ? nameMatch[1].trim() : null,
    version: versionMatch ? versionMatch[1].trim() : null,
  };
}

async function getInstalledScriptsMap() {
  const newTab = await cdpRequest(`/json/new?chrome-extension://${EXTENSION_ID}/options/index.html`, 'PUT');
  if (!newTab || !newTab.webSocketDebuggerUrl) {
    throw new Error('Failed to open Violentmonkey options tab');
  }

  try {
    await new Promise(r => setTimeout(r, 600));

    const scriptMap = await evalInTab(newTab.webSocketDebuggerUrl, `
      (() => {
        const map = {};
        document.querySelectorAll("a.script-name").forEach(a => {
          const href = a.getAttribute("href") || "";
          const match = href.match(/#scripts\\/(\\d+)/);
          if (match) {
            map[a.textContent.trim()] = match[1];
          }
        });
        return map;
      })()
    `);

    return scriptMap || {};
  } finally {
    await cdpRequest(`/json/close/${newTab.id}`);
  }
}

async function syncScriptToVM(filePath, options = {}) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${absPath}`);
  }

  const code = fs.readFileSync(absPath, 'utf8');
  const meta = extractMetadata(code);
  const scriptName = meta.name || path.basename(absPath).replace(/\.user\.js$/, '');

  const scriptMap = options.scriptMap || await getInstalledScriptsMap();
  let scriptId = scriptMap[scriptName];

  if (!scriptId) {
    const found = Object.entries(scriptMap).find(([k]) =>
      k.toLowerCase() === scriptName.toLowerCase() ||
      k.toLowerCase().includes(scriptName.toLowerCase()) ||
      scriptName.toLowerCase().includes(k.toLowerCase())
    );
    if (found) {
      scriptId = found[1];
    }
  }

  if (!scriptId) {
    throw new Error(`Could not find installed script matching "${scriptName}" in Violentmonkey.`);
  }

  const editorUrl = `chrome-extension://${EXTENSION_ID}/options/index.html#scripts/${scriptId}`;
  const editorTab = await cdpRequest(`/json/new?${encodeURIComponent(editorUrl)}`, 'PUT');

  if (!editorTab || !editorTab.webSocketDebuggerUrl) {
    throw new Error(`Failed to open Violentmonkey editor for script ${scriptId}`);
  }

  try {
    let cmReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 300));
      const status = await evalInTab(editorTab.webSocketDebuggerUrl, `
        (() => {
          const cm = document.querySelector(".CodeMirror")?.CodeMirror;
          const saveBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Save");
          return { ready: !!cm && !!saveBtn };
        })()
      `).catch(() => ({ ready: false }));

      if (status?.ready) {
        cmReady = true;
        break;
      }
    }

    if (!cmReady) {
      throw new Error('CodeMirror editor did not load in time');
    }

    const saveResult = await evalInTab(editorTab.webSocketDebuggerUrl, `
      (async (newCode) => {
        const cm = document.querySelector(".CodeMirror")?.CodeMirror;
        if (!cm) return { success: false, reason: "No CodeMirror instance" };
        cm.replaceRange(newCode, { line: 0, ch: 0 }, { line: 1e99, ch: 0 }, 'paste');
        const saveBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Save");
        if (!saveBtn) return { success: false, reason: "No Save button" };
        for (let i = 0; i < 10 && saveBtn.disabled; i++) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (saveBtn.disabled) return { success: false, reason: "Save button remained disabled" };
        saveBtn.click();
        await new Promise(r => setTimeout(r, 300));
        return { success: true, lineCount: cm.lineCount() };
      })(${JSON.stringify(code)})
    `, true);

    if (!saveResult?.success) {
      throw new Error(`Failed to save in Violentmonkey: ${saveResult?.reason || 'Unknown error'}`);
    }

    await new Promise(r => setTimeout(r, 200));

    console.log(`[VM-Sync] \x1b[32m✓\x1b[0m Synced "${scriptName}" to Violentmonkey (ID: ${scriptId}, ${saveResult.lineCount} lines, v${meta.version || '?'})`);
    return { success: true, scriptId, scriptName, lines: saveResult.lineCount };
  } finally {
    await cdpRequest(`/json/close/${editorTab.id}`).catch(() => {});
  }
}

async function watchAndSync(targetPath) {
  const absPath = path.resolve(targetPath);
  const isDir = fs.statSync(absPath).isDirectory();

  console.log(`[VM-Sync] Caching installed Violentmonkey scripts...`);
  const scriptMap = await getInstalledScriptsMap();
  console.log(`[VM-Sync] Found ${Object.keys(scriptMap).length} scripts in Violentmonkey.`);
  console.log(`[VM-Sync] Watching ${absPath} for changes... (Press Ctrl+C to stop)`);

  const debounceTimers = new Map();

  const onChange = (filename) => {
    if (!filename || !filename.endsWith('.user.js')) return;
    const fullPath = isDir ? path.join(absPath, filename) : absPath;

    clearTimeout(debounceTimers.get(fullPath));
    debounceTimers.set(fullPath, setTimeout(async () => {
      try {
        console.log(`[VM-Sync] Change detected in ${path.basename(fullPath)}. Syncing...`);
        await syncScriptToVM(fullPath, { scriptMap });
      } catch (err) {
        console.error(`[VM-Sync] \x1b[31m✗\x1b[0m Sync failed:`, err.message);
      }
    }, 150));
  };

  fs.watch(absPath, { recursive: isDir }, (eventType, filename) => {
    if (eventType === 'change' || eventType === 'rename') {
      onChange(filename);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  try {
    if (command === 'list') {
      const map = await getInstalledScriptsMap();
      console.log('Installed scripts in Violentmonkey:');
      for (const [name, id] of Object.entries(map).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`  [ID: ${id.padStart(3, ' ')}] ${name}`);
      }
    } else if (command === 'sync') {
      const file = args[1] || 'src/Harmony Enhancements.user.js';
      await syncScriptToVM(file);
    } else if (command === 'watch') {
      const target = args[1] || 'src/Harmony Enhancements.user.js';
      await watchAndSync(target);
    } else {
      console.log('Violentmonkey CDP Sync Tool');
      console.log('Commands:');
      console.log('  node tools/vm_sync.js sync [filePath]    Sync a script to Violentmonkey');
      console.log('  node tools/vm_sync.js watch [filePath]   Watch file(s) and auto-sync on save');
      console.log('  node tools/vm_sync.js list               List installed scripts and their IDs');
    }
  } catch (err) {
    console.error('\x1b[31mError:\x1b[0m', err.message);
    process.exit(1);
  }
}

main();
