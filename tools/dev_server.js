#!/usr/bin/env node

/**
 * tools/dev_server.js
 *
 * Local HTTP development server for Violentmonkey's native "Track external edits" workflow.
 * Serves userscripts from src/ with on-the-fly development tagging:
 *   - Appends "[DEV]" to @name
 *   - Injects git branch and short commit hash into @version (e.g. 1.28.0-dev.branch.hash)
 *   - Routes @updateURL and @downloadURL to localhost to prevent clobbering by upstream releases
 *
 * Usage:
 *   node tools/dev_server.js                  # Start server on default port 8080
 *   node tools/dev_server.js --port 3000      # Custom port
 *   node tools/dev_server.js --no-tag         # Serve scripts without injecting dev metadata
 *   node tools/dev_server.js --open "Harmony" # Automatically open the track installer in Chromium
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARGS = process.argv.slice(2);
const PORT = parseInt(getArgValue('--port') || process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '127.0.0.1';
const NO_TAG = ARGS.includes('--no-tag');
const NAME_TAG = getArgValue('--name-tag') || '[DEV]';
const OPEN_QUERY = getArgValue('--open');

const SRC_DIR = path.resolve(__dirname, '../src');

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

function transformUserscript(rawCode, scriptFileName, reqHost) {
  if (NO_TAG) return rawCode;

  const { branch, hash } = getGitInfo();
  let code = rawCode;

  // 1. Tag @name with NAME_TAG
  code = code.replace(/^(\/\/\s*@name\s+)(.+)$/m, (match, prefix, name) => {
    const trimmed = name.trim();
    if (trimmed.includes(NAME_TAG)) return match;
    return `${prefix}${trimmed} ${NAME_TAG}`;
  });

  // 2. Tag @version with branch and commit hash
  code = code.replace(/^(\/\/\s*@version\s+)(\S+)$/m, (match, prefix, ver) => {
    const cleanVer = ver.split('-dev')[0].split('+dev')[0];
    const devTag = branch ? `${branch}.${hash}` : hash;
    return `${prefix}${cleanVer}-dev.${devTag}`;
  });

  // 3. Point @updateURL and @downloadURL to the local server
  const localScriptUrl = `http://${reqHost}/${encodeURIComponent(scriptFileName)}`;
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

    return `
      <div style="background: #ffffff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 16px; font-weight: 600; color: #0366d6;">
            ${scriptName} <span style="background: #fff5b1; color: #735c0f; font-size: 12px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">${NAME_TAG}</span>
          </div>
          <div style="font-size: 13px; color: #586069; margin-top: 4px;">
            v${version}-dev.${branch}.${hash} &bull; <code>${file}</code>
          </div>
        </div>
        <a href="${scriptUrl}" style="background: #2ea44f; color: white; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; display: inline-block;">
          Track in Violentmonkey &rarr;
        </a>
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
        .container { max-width: 800px; margin: 0 auto; }
        .header { margin-bottom: 24px; }
        .hint { background: #e1f0ff; border-left: 4px solid #0366d6; padding: 12px 16px; border-radius: 4px; font-size: 14px; color: #032f62; margin-bottom: 24px; line-height: 1.5; }
        code { background: #eef1f4; padding: 2px 6px; border-radius: 3px; font-family: SFMono-Regular, Consolas, monospace; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0 0 8px 0; font-size: 24px;">Violentmonkey Dev Server</h1>
          <p style="margin: 0; color: #586069; font-size: 14px;">Active Git Branch: <code>${branch}</code> &bull; Commit: <code>${hash}</code></p>
        </div>
        <div class="hint">
          <strong>How to track:</strong> Click a script below. In the Violentmonkey tab that opens, check <code>[x] Reload tab</code> and click <strong><code>✚ Track external edits</code></strong>. Keep that installer tab open. Any local file saves or git branch switches will automatically update Violentmonkey and reload your active website tabs!
        </div>
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

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(renderDashboard(hostHeader));
    return;
  }

  const requestedFilename = path.basename(pathname);
  const localFilePath = path.join(SRC_DIR, requestedFilename);

  if (!fs.existsSync(localFilePath) || !requestedFilename.endsWith('.user.js')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Userscript not found: ${requestedFilename}`);
    return;
  }

  try {
    const stat = fs.statSync(localFilePath);
    const { branch, hash } = getGitInfo();
    const etag = `"${stat.mtimeMs.toString(36)}-${hash}-${NO_TAG ? 'notag' : 'dev'}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': 'no-cache, must-revalidate',
      });
      res.end();
      return;
    }

    const rawContent = fs.readFileSync(localFilePath, 'utf8');
    const transformedContent = transformUserscript(rawContent, requestedFilename, hostHeader);

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
  console.log(`Open http://localhost:${PORT}/ in Chromium to track any script.`);

  if (OPEN_QUERY) {
    tryOpenInChromium(OPEN_QUERY);
  }
});

function tryOpenInChromium(query) {
  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.user.js'));
  const match = files.find(f => f.toLowerCase().includes(query.toLowerCase()));
  if (!match) {
    console.warn(`[DevServer] Could not find script matching "--open ${query}"`);
    return;
  }
  const scriptUrl = `http://localhost:${PORT}/${encodeURIComponent(match)}`;
  console.log(`[DevServer] Attempting to open ${scriptUrl} in Chromium via CDP...`);

  const req = http.request({
    hostname: '127.0.0.1',
    port: 9222,
    path: `/json/new?${encodeURIComponent(scriptUrl)}`,
    method: 'PUT',
  }, (res) => {
    if (res.statusCode === 200) {
      console.log(`[DevServer] Opened installer tab in Chromium!`);
    }
  });
  req.on('error', () => {
    console.log(`[DevServer] Chromium CDP not reachable on 9222; navigate to ${scriptUrl} manually.`);
  });
  req.end();
}
