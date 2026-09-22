const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT_PATH = path.resolve(__dirname, '../../tools/dev_server.js');

function waitForOutput(child, pattern, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for pattern ${pattern}. Buffer:\n${buffer}`));
    }, timeoutMs);

    function onData(chunk) {
      buffer += chunk.toString();
      if (pattern.test(buffer)) {
        cleanup();
        resolve(buffer);
      }
    }

    function onClose(code) {
      cleanup();
      reject(new Error(`Process closed unexpectedly with code ${code}. Buffer:\n${buffer}`));
    }

    function cleanup() {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('close', onClose);
    }

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('close', onClose);
  });
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for process ${child.pid} to exit`));
    }, timeoutMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test('DevServer - Graceful shutdown and immediate socket release', async () => {
  const TEST_PORT = 8181;
  const child = spawn(process.execPath, [SCRIPT_PATH, '--port', String(TEST_PORT)], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    await waitForOutput(child, new RegExp(`Listening at:.*${TEST_PORT}`));

    // Connect with HTTP Keep-Alive socket
    const agent = new http.Agent({ keepAlive: true });
    await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${TEST_PORT}/`, { agent }, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
    });

    // Send SIGINT / graceful shutdown signal
    child.kill('SIGINT');

    const { code } = await waitForExit(child, 4000);
    assert.ok(code === 0 || code === null, `Expected clean exit, got code: ${code}`);

    // Verify port is immediately available for binding without FIN_WAIT_2 linger
    await new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(TEST_PORT, '127.0.0.1', () => {
        s.close(resolve);
      });
    });
  } finally {
    if (!child.killed) {
      try { child.kill('SIGKILL'); } catch {}
    }
  }
});

test('DevServer - EADDRINUSE formatted error and resolution options', async () => {
  const TEST_PORT = 8182;
  const dummyServer = net.createServer();
  await new Promise((resolve) => dummyServer.listen(TEST_PORT, '127.0.0.1', resolve));

  try {
    const child = spawn(process.execPath, [SCRIPT_PATH, '--port', String(TEST_PORT)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let combinedOutput = '';
    child.stdout.on('data', (d) => { combinedOutput += d.toString(); });
    child.stderr.on('data', (d) => { combinedOutput += d.toString(); });

    const { code } = await waitForExit(child, 5000);

    assert.equal(code, 1, 'Process should exit with code 1 on EADDRINUSE');
    assert.match(combinedOutput, /\[DevServer Error\] Port 8182 is already in use/);
    assert.match(combinedOutput, /--kill/);
    assert.match(combinedOutput, /--find-port/);
    assert.match(combinedOutput, /--port <number>/);
  } finally {
    await new Promise((resolve) => dummyServer.close(resolve));
  }
});

test('DevServer - --kill automatically terminates occupying process and takes over port', async () => {
  const TEST_PORT = 8183;

  // Spawn dummy process that occupies port
  const dummy = spawn(process.execPath, ['-e', `
    const http = require('http');
    http.createServer((req, res) => res.end('dummy')).listen(${TEST_PORT}, '127.0.0.1');
  `], { stdio: 'ignore' });

  // Wait briefly for dummy to bind
  await new Promise((r) => setTimeout(r, 400));

  const child = spawn(process.execPath, [SCRIPT_PATH, '--port', String(TEST_PORT), '--kill'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    await waitForOutput(child, new RegExp(`Listening at:.*${TEST_PORT}`));

    // Test that the dev server is now responding on the port
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT}/`, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    assert.match(body, /Violentmonkey Dev Server/);
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    try { dummy.kill('SIGKILL'); } catch {}
  }
});

test('DevServer - --find-port selects next available port when busy', async () => {
  const TEST_PORT = 8184;
  const dummyServer = net.createServer();
  await new Promise((resolve) => dummyServer.listen(TEST_PORT, '127.0.0.1', resolve));

  const child = spawn(process.execPath, [SCRIPT_PATH, '--port', String(TEST_PORT), '--find-port'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    await waitForOutput(child, new RegExp(`Listening at:.*${TEST_PORT + 1}`));

    // Test that dev server responds on the incremented port
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${TEST_PORT + 1}/`, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    assert.match(body, /Violentmonkey Dev Server/);
  } finally {
    try { child.kill('SIGKILL'); } catch {}
    await new Promise((resolve) => dummyServer.close(resolve));
  }
});
