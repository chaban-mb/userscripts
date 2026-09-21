#!/usr/bin/env node

/**
 * tools/dev_server.js
 *
 * Local HTTP development server for Violentmonkey's native "Track external edits" workflow.
 * Serves userscripts from src/ with on-the-fly development tagging:
 *   - Appends "[DEV]" to @name
 *   - Injects git branch and short commit hash into @version (e.g. 1.28.0-dev.branch.hash)
 *   - Routes @updateURL and @downloadURL to localhost to prevent clobbering by upstream releases
 *   - Serves dependencies from lib/ for @require resolution
 *
 * Usage:
 *   node tools/dev_server.js                  # Start server on default port 8080
 *   node tools/dev_server.js --port 3000      # Custom port
 *   node tools/dev_server.js --no-tag         # Serve scripts without injecting dev metadata
 *   node tools/dev_server.js --help           # Show CLI usage and tracking instructions
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARGS = process.argv.slice(2);

if (ARGS.includes('--help') || ARGS.includes('-h')) {
  console.log(`
Violentmonkey Local Development Server
======================================

Serves userscripts from src/ for Violentmonkey's native "Track external edits" workflow.
Allows instant live reloading on local file saves without manual copy-pasting.

By default, the server preserves @name identically (for in-place tracking)
and tags @version with the git branch and commit hash (e.g. 2.8.1-dev.branch.hash)
for exact build identification without duplicate script execution.

USAGE:
  node tools/dev_server.js [options]

OPTIONS:
  --port <number>     Server port (default: 8080, or process.env.PORT)
  --host <ip>         Server host (default: 127.0.0.1, or process.env.HOST)
  --separate          Install as a separate script by appending [DEV] to @name
  --name-tag <tag>    Custom suffix appended to @name (implies --separate)
  --no-tag            Serve raw script without injecting dev version or local update URLs
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

const PORT = parseInt(getArgValue('--port') || process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '127.0.0.1';
const NO_TAG = ARGS.includes('--no-tag');
const SEPARATE = ARGS.includes('--separate');
const NAME_TAG = getArgValue('--name-tag') || (SEPARATE ? '[DEV]' : '');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const LIB_DIR = path.join(REPO_ROOT, 'lib');

function getArgValue(flag) {
  const idx = ARGS.indexOf(flag);
  if (idx !== -1 && ARGS[idx + 1] && !ARGS[idx + 1].startsWith('--')) {
    return ARGS[idx + 1];
  }
  return null;
}

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' })
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '-');
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' })
      .trim();
    return { branch, hash };
  } catch {
    return { branch: 'local', hash: 'draft' };
  }
}

function transformUserscript(rawCode, scriptFileName, reqHost, isSeparate = false) {
  if (NO_TAG) return rawCode;

  const { branch, hash } = getGitInfo();
  let code = rawCode;
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
    const cleanVer = ver.split('-dev')[0].split('+dev')[0];
    const devTag = branch ? `${branch}.${hash}` : hash;
    return `${prefix}${cleanVer}-dev.${devTag}`;
  });

  // 3. Point @updateURL and @downloadURL to the local server
  const localScriptUrl = `http://${reqHost}/${encodeURIComponent(scriptFileName)}${isSeparate ? '?separate=1' : ''}`;
  if (/^(\/\/\s*@updateURL\s+)/m.test(code)) {
    code = code.replace(/^(\/\/\s*@updateURL\s+).+$/m, `$1${localScriptUrl}`);
  } else {
    code = code.replace(/^(\/\/\s*==\/UserScript==)/m, `// @updateURL   ${localScriptUrl}\n$1`);
  }

  if (/^(\/\/\s*@downloadURL\s+)/m.test(code)) {
    code = code.replace(/^(\/\/\s*@downloadURL\s+).+$/m, `$1${localScriptUrl}`);
  } else {
    code = code.replace(/^(\/\/\s*==\/UserScript==)/m, `// @downloadURL ${localScriptUrl}\n$1`);
  }

  return code;
}

function renderDashboard(reqHost) {
  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.user.js'));
  const { branch, hash } = getGitInfo();

  const fileItems = files.map(file => {
    const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    const nameMatch = raw.match(/\/\/\s*@name\s+(.+)/);
    const verMatch = raw.match(/\/\/\s*@version\s+(\S+)/);
    const scriptName = nameMatch ? nameMatch[1].trim() : file;
    const version = verMatch ? verMatch[1].trim() : '?';
    const scriptUrl = `http://${reqHost}/${encodeURIComponent(file)}`;
    const separateUrl = `${scriptUrl}?separate=1`;
    const restoreUrl = `https://raw.githubusercontent.com/chaban-mb/userscripts/main/src/${encodeURIComponent(file)}`;

    return `
      <div style="background: #ffffff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div>
          <div style="font-size: 16px; font-weight: 600; color: #0366d6;">
            ${scriptName} <span style="background: #ddf4ff; color: #0969da; font-size: 11px; font-weight: 500; padding: 2px 6px; border-radius: 4px; margin-left: 6px; border: 1px solid #b6e3ff;">IN-PLACE TRACKING</span>
          </div>
          <div style="font-size: 13px; color: #586069; margin-top: 4px;">
            v${version}-dev.${branch}.${hash} &bull; <code>${file}</code>
          </div>
          <div style="font-size: 12px; margin-top: 6px;">
            <a href="${separateUrl}" style="color: #6e7781; text-decoration: underline; margin-right: 12px;">Track as separate [DEV] script</a>
            <a href="${restoreUrl}" target="_blank" style="color: #6e7781; text-decoration: underline;">Restore release version &rarr;</a>
          </div>
        </div>
        <div>
          <a href="${scriptUrl}" style="background: #2ea44f; color: white; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; display: inline-block;">
            Track in Violentmonkey &rarr;
          </a>
        </div>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>Violentmonkey Dev Server</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f6f8fa; color: #24292e; margin: 0; padding: 40px 20px; }
        .container { max-width: 860px; margin: 0 auto; }
        .header { margin-bottom: 24px; }
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
          <h1 style="margin: 0 0 8px 0; font-size: 26px;">Violentmonkey Dev Server</h1>
          <p style="margin: 0; color: #586069; font-size: 14px;">Active Git Branch: <code>${branch}</code> &bull; Commit: <code>${hash}</code> &bull; Port: <code>${PORT}</code></p>
        </div>

        <div class="hint">
          <strong>How Native Violentmonkey Tracking Works:</strong>
          <ol>
            <li>Click <strong>Track in Violentmonkey &rarr;</strong> on the script you want to edit.</li>
            <li>In the Violentmonkey installer tab that opens, check <code>[x] Track external edits</code> and <code>[x] Reload tab</code>.</li>
            <li>Keep the installer/editor tab open. Violentmonkey polls this server using HTTP 304 ETags.</li>
            <li>Edit and save the userscript locally in your editor. Violentmonkey will automatically pull the changes and reload your test page!</li>
          </ol>
        </div>

        <h2 style="font-size: 18px; margin: 24px 0 12px 0;">Available Userscripts (${files.length})</h2>
        ${fileItems}
      </div>
    </body>
    </html>
  `;
}

const server = http.createServer((req, res) => {
  const hostHeader = req.headers.host || `${HOST}:${PORT}`;
  const parsedUrl = new URL(req.url, `http://${hostHeader}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 1. Dashboard
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(renderDashboard(hostHeader));
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
    const etag = `"${stat.mtimeMs.toString(36)}-${hash}-${NO_TAG ? 'notag' : isSeparate ? 'sep' : 'inplace'}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': 'no-cache, must-revalidate',
      });
      res.end();
      return;
    }

    const rawContent = fs.readFileSync(localFilePath, 'utf8');
    const transformedContent = transformUserscript(rawContent, requestedFilename, hostHeader, isSeparate);

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

server.listen(PORT, HOST, () => {
  const { branch, hash } = getGitInfo();
  console.log(`\x1b[34m====================================================\x1b[0m`);
  console.log(`  \x1b[1mViolentmonkey Dev Server\x1b[0m`);
  console.log(`  Listening at: \x1b[36mhttp://localhost:${PORT}/\x1b[0m`);
  console.log(`  Git branch:   \x1b[33m${branch}\x1b[0m (${hash})`);
  console.log(`  Dev tag:      \x1b[32m${NAME_TAG}\x1b[0m`);
  console.log(`\x1b[34m====================================================\x1b[0m`);
  console.log(`Open http://localhost:${PORT}/ to track any script in Violentmonkey.`);
  console.log(`Run with --help to view detailed usage information.`);
});
