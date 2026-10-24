#!/usr/bin/env node

/**
 * tools/dev_server.js
 *
 * Local HTTP & WebSocket development server for Violentmonkey userscripts.
 * Supports two complementary live-reload workflows:
 *
 *   1. Native Violentmonkey MCP Bridge (Preferred, Violentmonkey >= 2.49.5):
 *      - Speaks the `@violentmonkey/mcp` WebSocket protocol (`/ws`, protocol v1)
 *      - Uses a deterministic local token by default so restarting `dev_server.js`
 *        automatically reconnects without re-approval in Violentmonkey
 *      - Automatically watches `src/*.user.js` and `lib/*.js` and pushes updates directly
 *        to Violentmonkey via `scripts_write` with automatic tab reload (`reloadTab: true`)
 *      - Inlines relative `../lib/*.js` dependencies during MCP push so scripts without an
 *        HTTP `lastInstallURL` resolve shared libraries seamlessly
 *      - Provides `/connect-mcp` shortcut, `--open-mcp` flag, one-click "Push via MCP", and
 *        live connection polling on the web dashboard
 *      - Reference: https://violentmonkey.github.io/guide/ai-agent-access/
 *
 *   2. Native HTTP "Track external edits" (Fallback / Standalone):
 *      - Serves userscripts from `src/` with HTTP 304 ETag polling
 *      - Serves shared libraries from `lib/` for relative `@require` resolution
 *
 * On-the-fly development safeguards (both modes):
 *   - Preserves `@name` identically by default for conflict-free in-place updates
 *   - Appends `[DEV]` to `@name` when requested via `--separate`
 *   - Injects git branch and short commit hash into `@version` (e.g. `1.28.0-dev.branch.hash`)
 *   - Preserves original `@updateURL` and `@downloadURL` so scripts cleanly update to stable releases
 *
 * Usage:
 *   node tools/dev_server.js                  # Start HTTP + MCP bridge server on port 8080
 *   node tools/dev_server.js --open-mcp       # Start and trigger Violentmonkey MCP approval prompt
 *   node tools/dev_server.js --port 3000      # Custom port
 *   node tools/dev_server.js --no-tag         # Serve/push scripts without injecting dev metadata
 *   node tools/dev_server.js --help           # Show CLI usage and instructions
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const ARGS = process.argv.slice(2);

function getArgValue(flag) {
  const idx = ARGS.indexOf(flag);
  if (idx !== -1 && ARGS[idx + 1] && !ARGS[idx + 1].startsWith('--')) {
    return ARGS[idx + 1];
  }
  return null;
}

if (ARGS.includes('--help') || ARGS.includes('-h')) {
  console.log(`
Violentmonkey Local Development & MCP Sync Server
=================================================

Supports both Violentmonkey's native MCP WebSocket protocol (Violentmonkey >= 2.49.5)
and HTTP ETag file tracking ("Track external edits").

By default, the server preserves @name identically (for in-place updates)
and tags @version with the git branch and commit hash (e.g. 2.8.1-dev.branch.hash or 2.8.1-dev.hash on dev)
for exact build identification without duplicate script execution.

USAGE:
  node tools/dev_server.js [options]

OPTIONS:
  --port, -p <number> Server port (default: 8080, or process.env.PORT)
  --host <ip>         Server host (default: 127.0.0.1, or process.env.HOST)
  --token <string>    Fixed MCP auth token (default: deterministic local token, or VM_MCP_TOKEN)
  --random-token      Generate a random 32-byte token on every start (requires re-approving on restart)
  --open-mcp, --open  Automatically open the MCP Connect URL in the default browser on startup
  --no-watch          Disable automatic fs.watch push to connected Violentmonkey MCP client
  --separate          Install as a separate script by appending [DEV] to @name
  --name-tag <tag>    Custom suffix appended to @name (implies --separate)
  --no-tag            Serve/push raw script without injecting dev metadata
  --kill, --force     Terminate any existing process occupying the port before starting
  --find-port         Automatically select the next available port if requested port is in use
  --help, -h          Show this help screen and exit

METHOD 1: NATIVE MCP PUSH SYNC (PREFERRED - Violentmonkey >= 2.49.5):
  Guide: https://violentmonkey.github.io/guide/ai-agent-access/
  1. Start the dev server (use --open-mcp on first run or after a browser restart):
       node tools/dev_server.js --open-mcp
     (Or open http://localhost:8080/connect-mcp in your browser).
  2. Violentmonkey intercepts the connect URL and replaces "No pending requests." with:
       "An MCP server on port 8080 wants to read and modify your scripts." -> Click [Approve].
  3. Verify the status changes to "Connected to MCP server on port 8080." in Violentmonkey Settings
     (and "⚡ MCP Connected" on http://localhost:8080/).
  4. Edit and save any script in src/*.user.js (or shared library in lib/*.js):
       - Updated scripts are automatically pushed over WebSocket via \`scripts_write\`
       - Relative \`../lib/*.js\` dependencies are automatically inlined for MCP pushes
       - Active matching tabs reload automatically — no installer tab needs to stay open!
     Note: Because dev_server.js uses a deterministic local token by default, restarting
     dev_server.js will automatically reconnect without needing to re-approve in Violentmonkey!

METHOD 2: HTTP FILE TRACKING (FALLBACK / STANDALONE):
  1. Open http://localhost:8080/ and click "Track via HTTP".
  2. In the Violentmonkey installation tab that opens:
       - Check "[x] Track external edits" and "[x] Reload tab".
       - Keep the installer/editor tab open (Violentmonkey polls local ETags while active).
`);
  process.exit(0);
}

const PORT = parseInt(getArgValue('--port') || getArgValue('-p') || process.env.PORT || '8080', 10);
const HOST = getArgValue('--host') || process.env.HOST || '127.0.0.1';
const NO_TAG = ARGS.includes('--no-tag');
const NO_WATCH = ARGS.includes('--no-watch');
const OPEN_MCP = ARGS.includes('--open-mcp') || ARGS.includes('--open');
const RANDOM_TOKEN = ARGS.includes('--random-token');
const SEPARATE = ARGS.includes('--separate');
const NAME_TAG = getArgValue('--name-tag') || (SEPARATE ? '[DEV]' : '');
const KILL_OCCUPANT = ARGS.includes('--kill') || ARGS.includes('--force');
const FIND_PORT = ARGS.includes('--find-port');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const LIB_DIR = path.join(REPO_ROOT, 'lib');

// Use a deterministic local token by default so restarting dev_server.js allows Violentmonkey's
// exponential-backoff WebSocket client to automatically reconnect without re-approval.
const DEFAULT_LOCAL_TOKEN = crypto.createHash('sha256').update(`userscripts-vm-mcp:${REPO_ROOT}`).digest('base64url');
const MCP_TOKEN = getArgValue('--token') || process.env.VM_MCP_TOKEN || (RANDOM_TOKEN ? crypto.randomBytes(32).toString('base64url') : DEFAULT_LOCAL_TOKEN);

let currentPort = PORT;
const MAX_FALLBACK_PORT = PORT + 20;

function openUrlInBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url.replace(/&/g, '^&')], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch (err) {
    console.warn(`[DevServer] Could not auto-open browser: ${err.message}`);
  }
}

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

function formatDevVersion(version, branch, hash) {
  const cleanVer = version.split('-dev')[0].split('+dev')[0];
  const hasBranch = branch && branch !== 'dev' && branch !== 'HEAD';
  const devTag = hasBranch ? `${branch}.${hash}` : hash;
  return `${cleanVer}-dev.${devTag}`;
}

const REQUIRE_LIB_RE = /^[ \t]*\/\/[ \t]*@require[ \t]+(?:\.\.\/)?lib\/([^\s]+)[ \t]*$/gm;
const USERSCRIPT_HEADER_RE = /\/\/[ \t]*==UserScript==[\s\S]*?\/\/[ \t]*==\/UserScript==\s*/;
const CLOSURE_START_RE = /(\(\s*(?:async\s+)?function\s*\([^)]*\)\s*\{|\(\s*(?:async\s+)?\(\)\s*=>\s*\{)/;

/**
 * Inlines relative `../lib/*.js` dependencies into the script body when pushing via MCP `scripts_write`,
 * because `scripts_write` does not have an HTTP `lastInstallURL` base to resolve relative `@require` paths.
 */
function inlineLocalLibraries(scriptText) {
  const matches = [...scriptText.matchAll(REQUIRE_LIB_RE)];
  if (matches.length === 0) return scriptText;

  const libCodes = [];
  for (const match of matches) {
    const libFilename = match[1];
    const libPath = path.join(LIB_DIR, libFilename);
    if (fs.existsSync(libPath)) {
      const rawLib = fs.readFileSync(libPath, 'utf8');
      const cleanedLib = rawLib.replace(USERSCRIPT_HEADER_RE, '').trim();
      libCodes.push(`    // --- Inlined Library: lib/${libFilename} ---\n${cleanedLib}\n    // --- End Inlined Library ---`);
    }
  }

  if (libCodes.length === 0) return scriptText;

  let transformed = scriptText.replace(REQUIRE_LIB_RE, '');
  transformed = transformed.replace(/(\r?\n){3,}/g, '\n\n');
  const combinedLibCode = libCodes.join('\n\n');

  const closureMatch = CLOSURE_START_RE.exec(transformed);
  if (closureMatch) {
    const idx = closureMatch.index + closureMatch[0].length;
    const afterClosure = transformed.slice(idx);
    const useStrictMatch = /^\s*('use strict'|"use strict");?/.exec(afterClosure);
    const insertPos = useStrictMatch ? idx + useStrictMatch[0].length : idx;
    return `${transformed.slice(0, insertPos)}\n\n${combinedLibCode}\n${transformed.slice(insertPos)}`;
  }

  const headerEnd = transformed.indexOf('// ==/UserScript==');
  if (headerEnd !== -1) {
    const lineEnd = transformed.indexOf('\n', headerEnd);
    if (lineEnd !== -1) {
      return `${transformed.slice(0, lineEnd + 1)}\n${combinedLibCode}\n\n${transformed.slice(lineEnd + 1)}`;
    }
  }
  return `${combinedLibCode}\n\n${transformed}`;
}

function transformUserscript(rawCode, isSeparate = false, { inlineLibs = false } = {}) {
  let code = inlineLibs ? inlineLocalLibraries(rawCode) : rawCode;
  if (NO_TAG) return code;

  const { branch, hash } = getGitInfo();
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

  return code;
}

// ============================================================================
// Violentmonkey MCP WebSocket Bridge (Protocol v1, Violentmonkey >= 2.49.5)
// Reference: https://github.com/violentmonkey/mcp
// ============================================================================

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const EXTENSION_ORIGIN_RE = /^(chrome-extension|moz-extension|extension|safari-web-extension):\/\//;
const MCP_PROTOCOL_VERSION = 1;

let activeMcpSession = null;
let nextCallId = 0;

function safeTokenEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function encodeWsFrame(opcode, payloadBuffer) {
  const len = payloadBuffer.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuffer]);
}

function sendWsText(socket, text) {
  if (socket.destroyed || !socket.writable) return;
  socket.write(encodeWsFrame(0x01, Buffer.from(text, 'utf8')));
}

function sendWsClose(socket, code = 1000, reason = '') {
  if (socket.destroyed || !socket.writable) return;
  const reasonBuf = Buffer.from(reason, 'utf8');
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  socket.write(encodeWsFrame(0x08, payload));
  socket.end();
}

function attachMcpWebSocket(req, socket, head) {
  const origin = req.headers['origin'] || '';
  if (origin && !EXTENSION_ORIGIN_RE.test(origin) && process.env.VM_MCP_ALLOW_NO_ORIGIN !== '1') {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const acceptKey = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  let buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
  let handshakeDone = false;
  let sessionObj = null;

  const helloTimer = setTimeout(() => {
    if (!handshakeDone) {
      sendWsClose(socket, 4000, 'hello timeout');
    }
  }, 5000);

  function resetIdleTimer() {
    if (!sessionObj) return;
    clearTimeout(sessionObj.idleTimer);
    sessionObj.idleTimer = setTimeout(() => {
      sendWsClose(socket, 4002, 'idle timeout');
    }, 60000);
  }

  function handleJsonMessage(rawText) {
    let msg;
    try {
      msg = JSON.parse(rawText);
    } catch {
      sendWsClose(socket, 4000, 'invalid json');
      return;
    }

    if (!handshakeDone) {
      if (!msg || msg.type !== 'hello') {
        sendWsClose(socket, 4000, 'expected hello');
        return;
      }
      clearTimeout(helloTimer);
      if (!safeTokenEqual(msg.token || '', MCP_TOKEN)) {
        sendWsClose(socket, 4003, 'unauthorized');
        return;
      }
      if (msg.protocol !== MCP_PROTOCOL_VERSION) {
        sendWsClose(socket, 4004, 'unsupported protocol');
        return;
      }

      handshakeDone = true;
      const acceptedTools = Array.isArray(msg.tools) ? msg.tools : [];
      sessionObj = {
        socket,
        client: msg.client || { name: 'Violentmonkey', version: 'unknown' },
        tools: acceptedTools,
        pendingCalls: new Map(),
        idleTimer: null,
        connectedAt: new Date(),
      };

      if (activeMcpSession && activeMcpSession !== sessionObj) {
        for (const [, p] of activeMcpSession.pendingCalls) {
          clearTimeout(p.timer);
          p.reject(new Error('Violentmonkey connection was replaced'));
        }
        clearTimeout(activeMcpSession.idleTimer);
        sendWsClose(activeMcpSession.socket, 4001, 'replaced');
      }

      activeMcpSession = sessionObj;
      sendWsText(socket, JSON.stringify({
        type: 'ready',
        protocol: MCP_PROTOCOL_VERSION,
        server: { name: '@violentmonkey/mcp', version: '0.1.2' },
        tools: acceptedTools,
      }));
      resetIdleTimer();

      const now = new Date().toLocaleTimeString();
      console.log(
        `[DevServer ${now}] \x1b[32m⚡ Violentmonkey MCP connected\x1b[0m ` +
        `(${sessionObj.client.name} v${sessionObj.client.version}, tools: ${acceptedTools.length})`
      );
      return;
    }

    resetIdleTimer();
    if (msg.type === 'ping') {
      sendWsText(socket, JSON.stringify({ type: 'pong' }));
    } else if (msg.type === 'result' && sessionObj) {
      const pending = sessionObj.pendingCalls.get(msg.id);
      if (pending) {
        sessionObj.pendingCalls.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          const errMsg = msg.error ? `[${msg.error.code}] ${msg.error.message}` : 'MCP tool call failed';
          pending.reject(new Error(errMsg));
        }
      }
    }
  }

  function processBuffer() {
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLen = secondByte & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) return;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) return;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = isMasked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) return;

      const mask = isMasked ? buffer.subarray(offset, offset + 4) : null;
      offset += maskLen;
      const payload = Buffer.from(buffer.subarray(offset, offset + payloadLen));
      buffer = buffer.subarray(offset + payloadLen);

      if (mask) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i & 3];
        }
      }

      if (opcode === 0x01) {
        handleJsonMessage(payload.toString('utf8'));
      } else if (opcode === 0x08) {
        socket.end();
        return;
      } else if (opcode === 0x09) {
        if (!socket.destroyed && socket.writable) {
          socket.write(encodeWsFrame(0x0a, payload));
        }
      }
    }
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    processBuffer();
  });

  function cleanup() {
    clearTimeout(helloTimer);
    if (sessionObj) {
      clearTimeout(sessionObj.idleTimer);
      for (const [, p] of sessionObj.pendingCalls) {
        clearTimeout(p.timer);
        p.reject(new Error('Violentmonkey disconnected'));
      }
      sessionObj.pendingCalls.clear();
      if (activeMcpSession === sessionObj) {
        activeMcpSession = null;
        const now = new Date().toLocaleTimeString();
        console.log(`[DevServer ${now}] \x1b[33mViolentmonkey MCP disconnected\x1b[0m`);
      }
    }
  }

  socket.on('close', cleanup);
  socket.on('error', cleanup);
}

function callMcpTool(tool, params = {}, timeoutMs = 15000) {
  if (!activeMcpSession) {
    return Promise.reject(new Error('Violentmonkey MCP is not connected'));
  }
  if (!activeMcpSession.tools.includes(tool)) {
    return Promise.reject(new Error(`Connected Violentmonkey does not support tool "${tool}"`));
  }
  const id = `c_${++nextCallId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (activeMcpSession) activeMcpSession.pendingCalls.delete(id);
      reject(new Error(`MCP tool "${tool}" timed out`));
    }, timeoutMs);
    activeMcpSession.pendingCalls.set(id, { resolve, reject, timer });
    sendWsText(activeMcpSession.socket, JSON.stringify({ type: 'call', id, tool, params }));
  });
}

async function pushUserscriptViaMcp(fileName, isSeparate = SEPARATE) {
  const localFilePath = path.join(SRC_DIR, fileName);
  if (!fs.existsSync(localFilePath) || !fileName.endsWith('.user.js')) {
    throw new Error(`Userscript not found: ${fileName}`);
  }
  const rawContent = fs.readFileSync(localFilePath, 'utf8');
  const code = transformUserscript(rawContent, isSeparate, { inlineLibs: true });
  const result = await callMcpTool('scripts_write', { code });
  const { branch, hash } = getGitInfo();
  const now = new Date().toLocaleTimeString();
  const action = result && result.created ? 'Installed' : 'Updated';
  const ver = result && result.script && result.script.version ? result.script.version : formatDevVersion('?', branch, hash);
  console.log(`[DevServer ${now}] \x1b[35m⚡ MCP ${action}\x1b[0m "${fileName}" -> v${ver} (tabs reloaded)`);
  return result;
}

// Automatic file watcher for instant MCP push on save
const watchDebounceTimers = new Map();

function setupMcpFileWatchers() {
  if (NO_WATCH) return;

  if (fs.existsSync(SRC_DIR)) {
    fs.watch(SRC_DIR, (eventType, filename) => {
      if (!filename || !filename.endsWith('.user.js') || !activeMcpSession) return;
      clearTimeout(watchDebounceTimers.get(filename));
      watchDebounceTimers.set(filename, setTimeout(() => {
        watchDebounceTimers.delete(filename);
        if (!activeMcpSession) return;
        pushUserscriptViaMcp(filename).catch((err) => {
          console.error(`[DevServer] \x1b[31mMCP auto-push failed for "${filename}":\x1b[0m ${err.message}`);
        });
      }, 120));
    });
  }

  if (fs.existsSync(LIB_DIR)) {
    fs.watch(LIB_DIR, (eventType, libFilename) => {
      if (!libFilename || !libFilename.endsWith('.js') || !activeMcpSession) return;
      const key = `lib:${libFilename}`;
      clearTimeout(watchDebounceTimers.get(key));
      watchDebounceTimers.set(key, setTimeout(async () => {
        watchDebounceTimers.delete(key);
        if (!activeMcpSession) return;
        try {
          const { scripts: installed = [] } = await callMcpTool('scripts_list', {});
          const installedNames = new Set(installed.map(s => s.name));
          const srcFiles = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.user.js'));
          for (const file of srcFiles) {
            const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
            if (!raw.includes(`lib/${libFilename}`)) continue;
            const nameMatch = raw.match(/\/\/\s*@name\s+(.+)/);
            const scriptName = nameMatch ? nameMatch[1].trim() : '';
            if (installedNames.has(scriptName) || installedNames.has(`${scriptName} ${NAME_TAG || '[DEV]'}`)) {
              await pushUserscriptViaMcp(file);
            }
          }
        } catch (err) {
          console.error(`[DevServer] \x1b[31mMCP lib cascade push failed for "${libFilename}":\x1b[0m ${err.message}`);
        }
      }, 150));
    });
  }
}

function getMcpConnectUrl(port = currentPort) {
  return `https://violentmonkey.github.io/mcp_connect.html?port=${port}&token=${MCP_TOKEN}`;
}

function renderDashboard(reqHost, port = currentPort) {
  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.user.js'));
  const { branch, hash } = getGitInfo();
  const mcpConnectUrl = getMcpConnectUrl(port);
  const isMcpConnected = !!activeMcpSession;
  const mcpClientInfo = activeMcpSession
    ? `${activeMcpSession.client.name} v${activeMcpSession.client.version} (${activeMcpSession.tools.length} tools)`
    : 'Not connected (Click "Connect Violentmonkey MCP" below)';

  const fileItems = files.map(file => {
    const raw = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    const nameMatch = raw.match(/\/\/\s*@name\s+(.+)/);
    const verMatch = raw.match(/\/\/\s*@version\s+(\S+)/);
    const scriptName = nameMatch ? nameMatch[1].trim() : file;
    const version = verMatch ? verMatch[1].trim() : '?';
    const scriptUrl = `http://${reqHost}/${encodeURIComponent(file)}`;
    const separateUrl = `${scriptUrl}?separate=1`;
    const restoreUrl = `https://raw.githubusercontent.com/chaban-mb/userscripts/main/src/${encodeURIComponent(file)}`;
    const encodedFile = encodeURIComponent(file);

    return `
      <div style="background: #ffffff; border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
        <div>
          <div style="font-size: 16px; font-weight: 600; color: #0366d6;">
            ${scriptName} <span style="background: #ddf4ff; color: #0969da; font-size: 11px; font-weight: 500; padding: 2px 6px; border-radius: 4px; margin-left: 6px; border: 1px solid #b6e3ff;">IN-PLACE SYNC</span>
          </div>
          <div style="font-size: 13px; color: #586069; margin-top: 4px;">
            v${formatDevVersion(version, branch, hash)} &bull; <code>${file}</code>
          </div>
          <div style="font-size: 12px; margin-top: 6px;">
            <a href="${separateUrl}" style="color: #6e7781; text-decoration: underline; margin-right: 12px;">Track as separate [DEV] script</a>
            <a href="${restoreUrl}" target="_blank" style="color: #6e7781; text-decoration: underline;">Restore release version &rarr;</a>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button onclick="pushViaMcp('${encodedFile}', this)" style="background: #8250df; color: white; border: none; cursor: pointer; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500;">
            &#9889; Push via MCP
          </button>
          <a href="${scriptUrl}" style="background: #2ea44f; color: white; text-decoration: none; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; display: inline-block;">
            Track via HTTP &rarr;
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
      <title>Violentmonkey Dev & MCP Server</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f6f8fa; color: #24292e; margin: 0; padding: 40px 20px; }
        .container { max-width: 880px; margin: 0 auto; }
        .header { margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; }
        .hint { background: #e1f0ff; border-left: 4px solid #0366d6; padding: 16px; border-radius: 4px; font-size: 14px; color: #032f62; margin-bottom: 16px; line-height: 1.6; }
        .hint-mcp { background: #fbefff; border-left: 4px solid #8250df; padding: 16px; border-radius: 4px; font-size: 14px; color: #3b1d70; margin-bottom: 16px; line-height: 1.6; }
        .hint ol, .hint-mcp ol { margin: 8px 0 0 20px; padding: 0; }
        .hint li, .hint-mcp li { margin-bottom: 4px; }
        code { background: rgba(27,31,35,0.07); padding: 2px 6px; border-radius: 3px; font-family: SFMono-Regular, Consolas, monospace; font-size: 13px; color: #24292e; }
        .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
        .badge-connected { background: #dafbe1; color: #1a7f37; border: 1px solid #aceebb; }
        .badge-disconnected { background: #fff8c5; color: #9a6700; border: 1px solid #fae17d; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div>
            <h1 style="margin: 0 0 8px 0; font-size: 26px;">Violentmonkey Dev &amp; MCP Server</h1>
            <p style="margin: 0; color: #586069; font-size: 14px;">Active Git Branch: <code>${branch}</code> &bull; Commit: <code>${hash}</code> &bull; Port: <code>${port}</code></p>
          </div>
          <div id="mcp-status-badge" class="badge ${isMcpConnected ? 'badge-connected' : 'badge-disconnected'}">
            <span id="mcp-status-icon">${isMcpConnected ? '&#9889; MCP Connected:' : '&#9888; MCP Disconnected:'}</span>
            <span id="mcp-client-label">${mcpClientInfo}</span>
          </div>
        </div>

        <div class="hint-mcp">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <strong>&#9889; Method 1 (Preferred): Native Violentmonkey MCP Push Sync (Violentmonkey &ge; 2.49.5)</strong>
            <a href="${mcpConnectUrl}" target="_blank" style="background: #8250df; color: white; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 13px; font-weight: 600;">
              Connect Violentmonkey MCP &rarr;
            </a>
          </div>
          <ol>
            <li>If Violentmonkey Settings says <em>"No pending requests."</em>, click <strong>Connect Violentmonkey MCP &rarr;</strong> above (or open <code>http://localhost:${port}/connect-mcp</code>).</li>
            <li>Violentmonkey intercepts the URL and opens <strong>Settings &rarr; AI agent access (MCP)</strong> with an approval prompt: <em>"An MCP server on port ${port} wants to read and modify your scripts."</em> &mdash; click <strong>Approve</strong>.</li>
            <li>Once approved, Violentmonkey displays <strong>"Connected to MCP server on port ${port}."</strong> and the badge at the top-right of this page turns green.</li>
            <li>Edit and save any script in <code>src/*.user.js</code> or library in <code>lib/*.js</code> &mdash; this server automatically pushes the update over WebSocket (with <code>../lib/</code> inlined) and reloads matching tabs!</li>
          </ol>
        </div>

        <div class="hint">
          <strong>Method 2 (Fallback): Native HTTP File Tracking ("Track external edits")</strong>
          <ol>
            <li>Click <strong>Track via HTTP &rarr;</strong> on the script you want to edit.</li>
            <li>In the Violentmonkey installer tab that opens, check <code>[x] Track external edits</code> and <code>[x] Reload tab</code>, and keep the installer tab open.</li>
          </ol>
        </div>

        <h2 style="font-size: 18px; margin: 24px 0 12px 0;">Available Userscripts (${files.length})</h2>
        ${fileItems}
      </div>
      <script>
        async function pollMcpStatus() {
          try {
            const res = await fetch('/api/mcp/status');
            if (!res.ok) return;
            const data = await res.json();
            const badge = document.getElementById('mcp-status-badge');
            const icon = document.getElementById('mcp-status-icon');
            const label = document.getElementById('mcp-client-label');
            if (data.connected && data.client) {
              badge.className = 'badge badge-connected';
              icon.innerHTML = '&#9889; MCP Connected:';
              label.textContent = data.client.name + ' v' + data.client.version + ' (' + data.tools.length + ' tools)';
            } else {
              badge.className = 'badge badge-disconnected';
              icon.innerHTML = '&#9888; MCP Disconnected:';
              label.textContent = 'Not connected (Click "Connect Violentmonkey MCP" below)';
            }
          } catch {}
        }
        setInterval(pollMcpStatus, 2000);

        async function pushViaMcp(encodedFile, btn) {
          const originalText = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = 'Pushing...';
          try {
            const res = await fetch('/api/mcp/push?file=' + encodedFile, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Push failed');
            btn.style.background = '#1a7f37';
            btn.innerHTML = '&#10003; ' + (data.result.created ? 'Installed!' : 'Updated!');
          } catch (err) {
            btn.style.background = '#cf222e';
            btn.innerHTML = '&#10007; Not Connected';
            alert('MCP Push Error: ' + err.message + '\\n\\nClick "Connect Violentmonkey MCP" at the top of the page and click "Approve" in Violentmonkey Settings first.');
          } finally {
            setTimeout(() => {
              btn.disabled = false;
              btn.style.background = '#8250df';
              btn.innerHTML = originalText;
            }, 2200);
          }
        }
      </script>
    </body>
    </html>
  `;
}

const server = http.createServer(async (req, res) => {
  const hostHeader = req.headers.host || `${HOST}:${currentPort}`;
  const parsedUrl = new URL(req.url, `http://${hostHeader}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // 0. Health, Redirect & MCP API endpoints
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/connect-mcp' || pathname === '/mcp-connect') {
    res.writeHead(302, { 'Location': getMcpConnectUrl(currentPort) });
    res.end();
    return;
  }

  if (pathname === '/api/mcp/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      connected: !!activeMcpSession,
      client: activeMcpSession ? activeMcpSession.client : null,
      tools: activeMcpSession ? activeMcpSession.tools : [],
      connectUrl: getMcpConnectUrl(currentPort),
    }));
    return;
  }

  if (pathname === '/api/mcp/push' && req.method === 'POST') {
    const fileParam = parsedUrl.searchParams.get('file');
    if (!fileParam) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Missing file parameter' }));
      return;
    }
    try {
      const isSeparate = parsedUrl.searchParams.get('separate') === '1' || SEPARATE;
      const result = await pushUserscriptViaMcp(path.basename(fileParam), isSeparate);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // 1. Dashboard
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(renderDashboard(hostHeader, currentPort));
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
    const transformedContent = transformUserscript(rawContent, isSeparate);

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

// Handle WebSocket Upgrade for Violentmonkey MCP Client (`ws://127.0.0.1:<port>/ws`)
server.on('upgrade', (req, socket, head) => {
  const hostHeader = req.headers.host || `${HOST}:${currentPort}`;
  const parsedUrl = new URL(req.url, `http://${hostHeader}`);
  if (parsedUrl.pathname === '/ws') {
    attachMcpWebSocket(req, socket, head);
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
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
  if (activeMcpSession) {
    sendWsClose(activeMcpSession.socket, 4002, 'server shutting down');
    activeMcpSession = null;
  }
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

preparePort(currentPort);
setupMcpFileWatchers();

server.listen(currentPort, HOST, () => {
  const { branch, hash } = getGitInfo();
  const displayHost = (HOST === '127.0.0.1' || HOST === '0.0.0.0') ? 'localhost' : HOST;
  const connectUrl = getMcpConnectUrl(currentPort);
  console.log(`\x1b[34m====================================================\x1b[0m`);
  console.log(`  \x1b[1mViolentmonkey Dev & MCP Server\x1b[0m`);
  console.log(`  Dashboard:    \x1b[36mhttp://${displayHost}:${currentPort}/\x1b[0m`);
  console.log(`  MCP Connect:  \x1b[35mhttp://${displayHost}:${currentPort}/connect-mcp\x1b[0m`);
  console.log(`  MCP Bridge:   \x1b[35mws://${HOST}:${currentPort}/ws\x1b[0m`);
  console.log(`  Git branch:   \x1b[33m${branch}\x1b[0m (${hash})`);
  console.log(`  Dev tag:      \x1b[32m${NAME_TAG || '(in-place)'}\x1b[0m`);
  console.log(`\x1b[34m====================================================\x1b[0m`);
  console.log(`\x1b[35m⚡ Activate Violentmonkey MCP (>= 2.49.5):\x1b[0m`);
  console.log(`  ${connectUrl}\n`);
  if (OPEN_MCP) {
    console.log(`\x1b[36m[DevServer]\x1b[0m Opening MCP Connect URL in browser (--open-mcp)...`);
    openUrlInBrowser(connectUrl);
  }
  console.log(`Or open http://${displayHost}:${currentPort}/ for dashboard & HTTP tracking.`);
  console.log(`Run with --help to view detailed usage information.`);
});
