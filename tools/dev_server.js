#!/usr/bin/env node

/**
 * tools/dev_server.js
 *
 * Local HTTP development server for Violentmonkey's native "Track external edits" workflow.
 * Serves userscripts from src/ with on-the-fly development tagging:
 *   - Appends "[DEV]" to @name (when requested via --separate)
 *   - Injects git branch and short commit hash into @version (e.g. 1.28.0-dev.branch.hash or 1.28.0-dev.hash on dev)
 *   - Preserves original @updateURL and @downloadURL so scripts can cleanly update to stable upstream releases
 *   - Inlines local ../lib/*.js @require dependencies on-the-fly so scripts work across Violentmonkey Sync and reload on lib edits
 *   - Serves raw libraries from /lib/ when --no-inline or ?raw=1 is used
 *
 * Usage:
 *   node tools/dev_server.js                  # Start server on default port 8080
 *   node tools/dev_server.js --port 3000      # Custom port
 *   node tools/dev_server.js --no-inline      # Keep relative ../lib/ @require directives instead of inlining
 *   node tools/dev_server.js --no-tag         # Serve scripts without injecting dev metadata
 *   node tools/dev_server.js --stop           # Stop any running dev server on the target port and exit
 *   node tools/dev_server.js --help           # Show CLI usage and tracking instructions
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARGS = process.argv.slice(2);

function getArgValue(flag) {
  const idx = ARGS.indexOf(flag);
  if (idx !== -1 && ARGS[idx + 1] && !ARGS[idx + 1].startsWith('--')) {
    return ARGS[idx + 1];
  }
  return null;
}

if (require.main === module && (ARGS.includes('--help') || ARGS.includes('-h'))) {
  console.log(`
Violentmonkey Local Development Server
======================================

Serves userscripts from src/ for Violentmonkey's native "Track external edits" workflow.
Allows instant live reloading on local file saves without manual copy-pasting.

By default, the server preserves @name identically (for in-place tracking)
and tags @version with the git branch and commit hash (e.g. 2.8.1-dev.branch.hash or 2.8.1-dev.hash on dev)
for exact build identification without duplicate script execution.

USAGE:
  node tools/dev_server.js [options]

OPTIONS:
  --port, -p <number> Server port (default: 8080, or process.env.PORT)
  --host <ip>         Server host (default: 127.0.0.1, or process.env.HOST)
  --separate          Install as a separate script by appending [DEV] to @name
  --name-tag <tag>    Custom suffix appended to @name (implies --separate)
  --no-inline         Keep relative ../lib/*.js @require directives instead of inlining them
  --no-tag            Serve raw script without injecting dev metadata
  --changed           Default dashboard to show only git-changed scripts
  --kill, --force     Terminate any existing process occupying the port before starting
  --stop              Terminate any existing process occupying the port and exit
  --find-port         Automatically select the next available port if requested port is in use
  --help, -h          Show this help screen and exit

HOW TO TRACK SCRIPTS IN VIOLENTMONKEY:
  1. Start the dev server:
       node tools/dev_server.js

  2. Open the dashboard in Chromium/Chrome/Brave:
       http://localhost:8080/

  3. Click "Track in Violentmonkey" for the script you are developing.

  4. In the Violentmonkey installation tab that opens:
       - Check the "[x] Track external edits" button.
       - Check "[x] Reload tab" so active target websites reload on save.
       - Keep the installer/editor tab open (Violentmonkey polls while active).
       - Note: This cleanly updates the existing installed script in-place!

  5. Edit and save the script in your editor (src/*.user.js):
       Violentmonkey polls local ETags and automatically updates the active page!
`);
  process.exit(0);
}

const PORT = parseInt(getArgValue('--port') || getArgValue('-p') || process.env.PORT || '8080', 10);
const HOST = getArgValue('--host') || process.env.HOST || '127.0.0.1';
const NO_TAG = ARGS.includes('--no-tag');
const NO_INLINE = ARGS.includes('--no-inline');
const CHANGED_ONLY = ARGS.includes('--changed');
const SEPARATE = ARGS.includes('--separate');
const NAME_TAG = getArgValue('--name-tag') || (SEPARATE ? '[DEV]' : '');
const KILL_OCCUPANT = ARGS.includes('--kill') || ARGS.includes('--force');
const STOP_SERVER = ARGS.includes('--stop');
const FIND_PORT = ARGS.includes('--find-port');

let currentPort = PORT;
const MAX_FALLBACK_PORT = PORT + 20;

function getPortOccupant(port) {
  try {
    if (process.platform === 'win32') {
      const cmd = `powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; \\"$($c.OwningProcess):$($p.ProcessName)\\" }"`;
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).trim();
      if (out && out.includes(':')) {
        const [pidStr, name] = out.split(':');
        const pid = parseInt(pidStr, 10);
        if (!isNaN(pid) && pid > 0) {
          return { pid, name: name ? `${name}.exe` : 'Unknown' };
        }
      }
      const netstatOut = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2500 });
      for (const line of netstatOut.split(/\r?\n/)) {
        if (line.includes(`:${port}`) && !line.includes('TIME_WAIT')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0) {
            return { pid, name: 'Unknown' };
          }
        }
      }
    } else {
      const pidStr = execSync(`lsof -i :${port} -sTCP:LISTEN -t`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2500 }).trim();
      const pid = parseInt(pidStr.split('\n')[0], 10);
      if (!isNaN(pid) && pid > 0) {
        let name = 'Unknown';
        try {
          name = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1000 }).trim();
        } catch {}
        return { pid, name };
      }
    }
  } catch {}
  return null;
}

function killProcess(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch {
    return false;
  }
}

function stopServerOnPort(port) {
  const occupant = getPortOccupant(port);
  if (occupant && occupant.pid !== process.pid) {
    console.log(`\x1b[33m[DevServer]\x1b[0m Stopping \x1b[36m${occupant.name}\x1b[0m (PID: \x1b[36m${occupant.pid}\x1b[0m) on port ${port}...`);
    killProcess(occupant.pid);
  } else {
    console.log(`\x1b[33m[DevServer]\x1b[0m No server running on port ${port}.`);
  }
  process.exit(0);
}

if (require.main === module && STOP_SERVER) {
  stopServerOnPort(PORT);
}

function preparePort(port) {
  if (KILL_OCCUPANT) {
    const occupant = getPortOccupant(port);
    if (occupant && occupant.pid !== process.pid) {
      console.log(`\x1b[33m[DevServer]\x1b[0m Terminating conflicting process \x1b[36m${occupant.name}\x1b[0m (PID: \x1b[36m${occupant.pid}\x1b[0m) on port ${port}...`);
      killProcess(occupant.pid);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
}

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const LIB_DIR = path.join(REPO_ROOT, 'lib');

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' })
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-');
    const hash = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' })
      .trim();
    return { branch, hash };
  } catch {
    return { branch: 'local', hash: 'draft' };
  }
}

function unquoteGitPath(p) {
  const trimmed = p.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function parsePorcelainPaths(porcelainOutput) {
  if (!porcelainOutput) return [];
  const paths = [];
  for (const line of porcelainOutput.split(/\r?\n/)) {
    if (!line || line.length < 4) continue;
    let rawPath = line.slice(3).trim();
    const arrowIdx = rawPath.indexOf(' -> ');
    if (arrowIdx !== -1) {
      rawPath = rawPath.slice(arrowIdx + 4);
    }
    const normalized = unquoteGitPath(rawPath).replace(/\\/g, '/');
    if (normalized) paths.push(normalized);
  }
  return paths;
}

function getGitChangedPaths(branch) {
  const changed = new Set();
  const baseRef = branch === 'dev' ? 'main' : 'dev';
  try {
    const porcelain = execSync('git status --porcelain', {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    for (const p of parsePorcelainPaths(porcelain)) {
      changed.add(p);
    }
  } catch {}
  try {
    const diffOut = execSync(`git diff --name-only ${baseRef}...HEAD`, {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    for (const line of diffOut.split(/\r?\n/)) {
      const p = unquoteGitPath(line).replace(/\\/g, '/');
      if (p) changed.add(p);
    }
  } catch {}
  return { baseRef, paths: [...changed] };
}

function resolveChangedScripts(changedPaths, files, readScript) {
  const changedSet = new Set(changedPaths.map((p) => p.replace(/\\/g, '/')));
  const changedLibs = [...changedSet]
    .filter((p) => p.startsWith('lib/') && p.endsWith('.js'))
    .map((p) => path.posix.basename(p));

  const result = new Map();
  const addReason = (file, reason) => {
    if (!result.has(file)) result.set(file, []);
    const reasons = result.get(file);
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  for (const file of files) {
    if (changedSet.has(`src/${file}`)) {
      addReason(file, 'modified');
    }
    if (changedLibs.length > 0) {
      const raw = readScript(file);
      const requireMatches = raw.matchAll(/^\/\/\s*@require\s+(.+)$/gm);
      for (const m of requireMatches) {
        const cleanReqUrl = m[1].trim().split(/[?#]/)[0];
        for (const libName of changedLibs) {
          if (cleanReqUrl.endsWith(`/lib/${libName}`) || cleanReqUrl === `lib/${libName}`) {
            addReason(file, `lib:${libName}`);
          }
        }
      }
    }
  }
  return result;
}

function buildScriptEntries(files, reqHost, branch, hash, changedMap, readScript = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8')) {
  return files.map((file) => {
    const raw = readScript(file);
    const nameMatch = raw.match(/\/\/\s*@name\s+(.+)/);
    const verMatch = raw.match(/\/\/\s*@version\s+(\S+)/);
    const scriptName = nameMatch ? nameMatch[1].trim() : file;
    const version = verMatch ? verMatch[1].trim() : '?';
    const devVersion = formatDevVersion(version, branch, hash);
    const url = `http://${reqHost}/${encodeURIComponent(file)}`;
    const separateUrl = `${url}?separate=1`;
    const restoreUrl = `https://raw.githubusercontent.com/chaban-mb/userscripts/main/src/${encodeURIComponent(file)}`;
    const reasons = changedMap.get(file) || [];
    return {
      file,
      name: scriptName,
      version,
      devVersion,
      changed: reasons.length > 0,
      reasons,
      url,
      separateUrl,
      restoreUrl,
    };
  });
}

const LOCAL_REQUIRE_RE = /^[ \t]*\/\/[ \t]*@require[ \t]+(?:\.\.\/)?lib\/([^\s?#]+)(?:[?#][^\s]*)?[ \t]*(?:\r?\n)?/gm;
const USERSCRIPT_HEADER_RE = /\/\/[ \t]*==UserScript==[\s\S]*?\/\/[ \t]*==\/UserScript==\s*/;
const CLOSURE_START_RE = /(\(\s*function\s*\([^)]*\)\s*\{|\(\s*\(\)\s*=>\s*\{)/;

function extractLocalLibNames(scriptText) {
  const libs = [];
  const seen = new Set();
  for (const match of String(scriptText).matchAll(new RegExp(LOCAL_REQUIRE_RE.source, 'gm'))) {
    const filename = match[1].trim();
    if (filename && !seen.has(filename)) {
      seen.add(filename);
      libs.push(filename);
    }
  }
  return libs;
}

function cleanLibContent(libText) {
  return String(libText).replace(USERSCRIPT_HEADER_RE, '').trim();
}

function inlineLocalLibs(scriptText, options = {}) {
  const libDir = options.libDir || LIB_DIR;
  const readLib = options.readLib || ((filename) => {
    const fullPath = path.join(libDir, filename);
    return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : null;
  });

  const inlinedLibs = [];
  const libBlocks = [];
  const rawLibs = extractLocalLibNames(scriptText);

  for (const libFilename of rawLibs) {
    const rawLibText = readLib(libFilename);
    if (rawLibText == null) {
      console.warn(`[DevServer] Warning: Library file not found: lib/${libFilename}`);
      continue;
    }
    const cleaned = cleanLibContent(rawLibText);
    libBlocks.push(`    // --- Inlined Library: lib/${libFilename} ---\n${cleaned}\n    // --- End Inlined Library ---`);
    inlinedLibs.push(libFilename);
  }

  let transformed = String(scriptText).replace(new RegExp(LOCAL_REQUIRE_RE.source, 'gm'), '');
  transformed = transformed.replace(/(\r?\n){3,}/g, '\n\n');

  if (libBlocks.length > 0) {
    const combinedLibCode = libBlocks.join('\n\n');
    const closureMatch = CLOSURE_START_RE.exec(transformed);
    if (closureMatch) {
      const idx = closureMatch.index + closureMatch[0].length;
      const strictMatch = transformed.slice(idx).match(/^\s*('use strict'|"use strict");?/);
      const insertPos = strictMatch ? idx + strictMatch[0].length : idx;
      transformed = `${transformed.slice(0, insertPos)}\n\n${combinedLibCode}\n${transformed.slice(insertPos)}`;
    } else {
      const headerEnd = transformed.indexOf('// ==/UserScript==');
      if (headerEnd !== -1) {
        const lineEnd = transformed.indexOf('\n', headerEnd);
        if (lineEnd !== -1) {
          transformed = `${transformed.slice(0, lineEnd + 1)}\n${combinedLibCode}\n\n${transformed.slice(lineEnd + 1)}`;
        } else {
          transformed = `${transformed}\n\n${combinedLibCode}`;
        }
      } else {
        transformed = `${combinedLibCode}\n\n${transformed}`;
      }
    }
  }

  return { code: transformed, inlinedLibs };
}

function computeScriptEtag(scriptMtimeMs, rawCode, options = {}) {
  const branch = options.branch || 'local';
  const hash = options.hash || 'draft';
  const noTag = options.noTag ?? NO_TAG;
  const isSeparate = Boolean(options.isSeparate);
  const inlineLibs = options.inlineLibs ?? !NO_INLINE;
  const libDir = options.libDir || LIB_DIR;
  const getLibMtimeMs = options.getLibMtimeMs || ((filename) => {
    const fullPath = path.join(libDir, filename);
    return fs.existsSync(fullPath) ? fs.statSync(fullPath).mtimeMs : 0;
  });

  const base = `${Number(scriptMtimeMs).toString(36)}-${hash}-${branch}-${noTag ? 'notag' : isSeparate ? 'sep' : 'inplace'}-${inlineLibs ? 'inline' : 'raw'}`;
  if (!inlineLibs) return `"${base}"`;

  const libNames = extractLocalLibNames(rawCode);
  if (libNames.length === 0) return `"${base}"`;

  const libStamps = libNames.map((name) => `${name}:${Number(getLibMtimeMs(name) || 0).toString(36)}`).join(',');
  return `"${base}-${libStamps}"`;
}

function formatDevVersion(version, branch, hash) {
  const cleanVer = version.split('-dev')[0].split('+dev')[0];
  const hasBranch = branch && branch !== 'dev' && branch !== 'HEAD';
  const devTag = hasBranch ? `${branch}.${hash}` : hash;
  return `${cleanVer}-dev.${devTag}`;
}

function transformUserscript(rawCode, isSeparate = false, options = {}) {
  const noTag = options.noTag ?? NO_TAG;
  const inlineLibs = options.inlineLibs ?? !NO_INLINE;
  let code = rawCode;

  if (!noTag) {
    const { branch, hash } = options.gitInfo || getGitInfo();
    const tagToUse = isSeparate ? (NAME_TAG || '[DEV]') : NAME_TAG;

    // 1. Tag @name only if separate mode is requested
    if (tagToUse) {
      code = code.replace(/^(\/\/\s*@name\s+)(.+)$/m, (match, prefix, name) => {
        const trimmed = name.trim();
        if (trimmed.includes(tagToUse)) return match;
        return `${prefix}${trimmed} ${tagToUse}`;
      });
    }

    // 2. Tag @version with branch and commit hash for exact identification
    code = code.replace(/^(\/\/\s*@version\s+)(\S+)$/m, (match, prefix, ver) => {
      return `${prefix}${formatDevVersion(ver, branch, hash)}`;
    });
  }

  if (inlineLibs) {
    code = inlineLocalLibs(code, options).code;
  }

  return code;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderScriptCard(entry) {
  const reasonBadges = entry.reasons
    .map((r) => `<span style="background: #fff8c5; color: #9a6700; font-size: 11px; font-weight: 500; padding: 2px 6px; border-radius: 4px; margin-left: 6px; border: 1px solid #d4a72c;">${escapeHtml(r)}</span>`)
    .join('');

  return `
      <div style="background: #ffffff; border: 1px solid ${entry.changed ? '#d4a72c' : '#e1e4e8'}; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div>
          <div style="font-size: 16px; font-weight: 600; color: #0366d6;">
            ${escapeHtml(entry.name)} <span style="background: #ddf4ff; color: #0969da; font-size: 11px; font-weight: 500; padding: 2px 6px; border-radius: 4px; margin-left: 6px; border: 1px solid #b6e3ff;">IN-PLACE TRACKING</span>${reasonBadges}
          </div>
          <div style="font-size: 13px; color: #586069; margin-top: 4px;">
            v${escapeHtml(entry.devVersion)} &bull; <code>${escapeHtml(entry.file)}</code>
          </div>
          <div style="font-size: 12px; margin-top: 6px;">
            <a href="${escapeHtml(entry.separateUrl)}" style="color: #6e7781; text-decoration: underline; margin-right: 12px;">Track as separate [DEV] script</a>
            <a href="${escapeHtml(entry.restoreUrl)}" target="_blank" style="color: #6e7781; text-decoration: underline;">Restore release version &rarr;</a>
          </div>
        </div>
        <div>
          <a href="${escapeHtml(entry.url)}" style="background: #2ea44f; color: white; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; display: inline-block;">
            Track in Violentmonkey &rarr;
          </a>
        </div>
      </div>
    `;
}

function renderDashboard(reqHost, port = currentPort, options = {}) {
  const files = options.files ?? fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.user.js'));
  const readScript = options.readScript ?? ((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
  const { branch, hash } = getGitInfo();
  const changedOnly = options.changedOnly ?? CHANGED_ONLY;
  const changedMap = options.changedMap ?? resolveChangedScripts(
    getGitChangedPaths(branch).paths,
    files,
    readScript
  );
  const entries = buildScriptEntries(files, reqHost, branch, hash, changedMap, readScript);
  const changedEntries = entries.filter((e) => e.changed);
  const otherEntries = entries.filter((e) => !e.changed);

  let listMarkup = '';
  if (changedOnly) {
    if (changedEntries.length === 0) {
      listMarkup = `
        <h2 style="font-size: 18px; margin: 24px 0 12px 0;">Changed Scripts (0)</h2>
        <div class="card" style="color: #586069;">
          No changed userscripts detected. <a href="/?changed=0" style="color: #0366d6;">Show all ${entries.length} scripts &rarr;</a>
        </div>
      `;
    } else {
      listMarkup = `
        <h2 style="font-size: 18px; margin: 24px 0 12px 0;">Changed Scripts (${changedEntries.length})</h2>
        ${changedEntries.map(renderScriptCard).join('')}
      `;
    }
  } else if (changedEntries.length > 0) {
    listMarkup = `
      <h2 style="font-size: 18px; margin: 24px 0 12px 0;">Changed Scripts (${changedEntries.length})</h2>
      ${changedEntries.map(renderScriptCard).join('')}
      <h2 style="font-size: 18px; margin: 28px 0 12px 0;">Other Scripts (${otherEntries.length})</h2>
      ${otherEntries.map(renderScriptCard).join('')}
    `;
  } else {
    listMarkup = `
      <h2 style="font-size: 18px; margin: 24px 0 12px 0;">Available Userscripts (${entries.length})</h2>
      ${entries.map(renderScriptCard).join('')}
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Violentmonkey Dev Server</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f6f8fa; color: #24292e; margin: 0; padding: 40px 20px; }
        .container { max-width: 860px; margin: 0 auto; }
        .header { margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .filter-links a { font-size: 13px; padding: 6px 12px; border-radius: 6px; text-decoration: none; border: 1px solid #d0d7de; color: #24292e; background: #ffffff; margin-left: 6px; }
        .filter-links a.active { background: #0969da; color: #ffffff; border-color: #0969da; }
        .hint { background: #e1f0ff; border-left: 4px solid #0366d6; padding: 16px; border-radius: 4px; font-size: 14px; color: #032f62; margin-bottom: 24px; line-height: 1.6; }
        .hint ol { margin: 8px 0 0 20px; padding: 0; }
        .hint li { margin-bottom: 4px; }
        code { background: #eef1f4; padding: 2px 6px; border-radius: 3px; font-family: SFMono-Regular, Consolas, monospace; font-size: 13px; color: #24292e; }
        .card { background: #ffffff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 20px; margin-bottom: 24px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div>
            <h1 style="margin: 0 0 8px 0; font-size: 26px;">Violentmonkey Dev Server</h1>
            <p style="margin: 0; color: #586069; font-size: 14px;">Active Git Branch: <code>${branch}</code> &bull; Commit: <code>${hash}</code> &bull; Port: <code>${port}</code></p>
          </div>
          <div class="filter-links">
            <a href="/?changed=1" class="${changedOnly ? 'active' : ''}">Changed only (${changedEntries.length})</a>
            <a href="/?changed=0" class="${!changedOnly ? 'active' : ''}">All scripts (${entries.length})</a>
          </div>
        </div>

        <div class="hint">
          <strong>How Native Violentmonkey Tracking Works:</strong>
          <ol>
            <li>Click <strong>Track in Violentmonkey &rarr;</strong> on the script you want to edit.</li>
            <li>In the Violentmonkey installer tab that opens, check <code>[x] Track external edits</code> and <code>[x] Reload tab</code>.</li>
            <li>Keep the installer/editor tab open. Violentmonkey polls this server using HTTP 304 ETags.</li>
            <li>Edit and save the userscript (or any required <code>lib/*.js</code>) locally. Local <code>../lib/</code> dependencies are inlined on the fly so scripts work across Violentmonkey Sync and live-reload automatically!</li>
          </ol>
        </div>

        ${listMarkup}
      </div>
    </body>
    </html>
  `;
}

const server = http.createServer((req, res) => {
  const hostHeader = req.headers.host || `${HOST}:${currentPort}`;
  const parsedUrl = new URL(req.url, `http://${hostHeader}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. Dashboard & JSON API
  if (pathname === '/' || pathname === '/index.html') {
    const changedParam = parsedUrl.searchParams.get('changed');
    const changedOnly = changedParam === '1' ? true : changedParam === '0' ? false : CHANGED_ONLY;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(renderDashboard(hostHeader, currentPort, { changedOnly }));
    return;
  }

  if (pathname === '/api/scripts') {
    const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.user.js'));
    const { branch, hash } = getGitInfo();
    const { baseRef, paths } = getGitChangedPaths(branch);
    const changedMap = resolveChangedScripts(
      paths,
      files,
      (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8')
    );
    const scripts = buildScriptEntries(files, hostHeader, branch, hash, changedMap);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(JSON.stringify({
      branch,
      hash,
      baseRef,
      changedCount: scripts.filter((s) => s.changed).length,
      totalCount: scripts.length,
      scripts,
    }, null, 2));
    return;
  }

  // 2. Shared Libraries (e.g. /lib/MusicBrainzAPI.js or relative @require)
  if (pathname.startsWith('/lib/')) {
    const libFileName = path.basename(pathname);
    const libFilePath = path.join(LIB_DIR, libFileName);

    if (fs.existsSync(libFilePath) && libFileName.endsWith('.js')) {
      const content = fs.readFileSync(libFilePath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache, must-revalidate',
      });
      res.end(content);
      return;
    }
  }

  // 3. Userscripts (from root or /src/)
  const requestedFilename = path.basename(pathname);
  const localFilePath = path.join(SRC_DIR, requestedFilename);

  if (!fs.existsSync(localFilePath) || !requestedFilename.endsWith('.user.js')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`File not found: ${pathname}`);
    return;
  }

  try {
    const stat = fs.statSync(localFilePath);
    const { branch, hash } = getGitInfo();
    const isSeparate = parsedUrl.searchParams.get('separate') === '1';
    const isRaw = parsedUrl.searchParams.get('raw') === '1';
    const inlineLibs = !NO_INLINE && !isRaw;
    const rawContent = fs.readFileSync(localFilePath, 'utf8');
    const etag = computeScriptEtag(stat.mtimeMs, rawContent, { branch, hash, isSeparate, inlineLibs });

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': 'no-cache, must-revalidate',
      });
      res.end();
      return;
    }

    const transformedContent = transformUserscript(rawContent, isSeparate, {
      inlineLibs,
      gitInfo: { branch, hash },
    });

    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, must-revalidate',
      'ETag': etag,
    });
    res.end(transformedContent);

    const now = new Date().toLocaleTimeString();
    console.log(`[DevServer ${now}] \x1b[32m✓\x1b[0m Served "${requestedFilename}" (branch: ${branch}, commit: ${hash})`);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Internal Server Error: ${err.message}`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    if (FIND_PORT && currentPort < MAX_FALLBACK_PORT) {
      console.warn(`\x1b[33m[DevServer]\x1b[0m Port ${currentPort} is busy. Trying port ${currentPort + 1} (--find-port enabled)...`);
      currentPort++;
      preparePort(currentPort);
      server.listen(currentPort, HOST);
      return;
    }

    const occupant = getPortOccupant(currentPort);
    console.error(`\n\x1b[31m====================================================\x1b[0m`);
    console.error(`  \x1b[1;31m[DevServer Error] Port ${currentPort} is already in use.\x1b[0m`);
    if (occupant) {
      console.error(`  Occupied by: \x1b[33m${occupant.name}\x1b[0m (PID: \x1b[36m${occupant.pid}\x1b[0m)`);
    } else {
      console.error(`  (Could not identify process; port may be lingering in TCP teardown)`);
    }
    console.error(`\x1b[31m====================================================\x1b[0m`);
    console.error(`\nResolution options:`);
    console.error(`  1. Terminate conflicting process and take over port:`);
    console.error(`       \x1b[36mnode tools/dev_server.js --kill\x1b[0m`);
    if (occupant && process.platform === 'win32') {
      console.error(`       \x1b[90m(or manually: taskkill /F /PID ${occupant.pid})\x1b[0m`);
    } else if (occupant) {
      console.error(`       \x1b[90m(or manually: kill -9 ${occupant.pid})\x1b[0m`);
    }
    console.error(`  2. Automatically select next available port:`);
    console.error(`       \x1b[36mnode tools/dev_server.js --find-port\x1b[0m`);
    console.error(`  3. Run on a specific alternative port:`);
    console.error(`       \x1b[36mnode tools/dev_server.js --port <number>\x1b[0m\n`);
    process.exit(1);
  } else {
    console.error(`\n\x1b[31m[DevServer Error]\x1b[0m ${err.message}\n`);
    process.exit(1);
  }
});

function handleGracefulShutdown(signal) {
  console.log(`\n\x1b[33m[DevServer]\x1b[0m Received ${signal}, closing server and active connections...`);
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(0);
  }, 1500).unref();
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

if (require.main === module) {
  preparePort(currentPort);

  server.listen(currentPort, HOST, () => {
    const { branch, hash } = getGitInfo();
    const displayHost = (HOST === '127.0.0.1' || HOST === '0.0.0.0') ? 'localhost' : HOST;
    console.log(`\x1b[34m====================================================\x1b[0m`);
    console.log(`  \x1b[1mViolentmonkey Dev Server\x1b[0m`);
    console.log(`  Listening at: \x1b[36mhttp://${displayHost}:${currentPort}/\x1b[0m`);
    console.log(`  Git branch:   \x1b[33m${branch}\x1b[0m (${hash})`);
    console.log(`  Dev tag:      \x1b[32m${NAME_TAG}\x1b[0m`);
    console.log(`\x1b[34m====================================================\x1b[0m`);
    console.log(`Open http://${displayHost}:${currentPort}/ to track any script in Violentmonkey.`);
    console.log(`Run with --help to view detailed usage information.`);
  });
}

module.exports = {
  parsePorcelainPaths,
  getGitChangedPaths,
  resolveChangedScripts,
  buildScriptEntries,
  renderDashboard,
  extractLocalLibNames,
  inlineLocalLibs,
  computeScriptEtag,
  transformUserscript,
};
