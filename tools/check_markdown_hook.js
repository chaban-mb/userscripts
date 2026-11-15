const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let payload = {};
try {
  const input = fs.readFileSync(0, 'utf8');
  if (input && input.trim()) {
    payload = JSON.parse(input);
  }
} catch {
  payload = {};
}

if (
  payload.continuationActive === true ||
  (payload.terminationReason !== undefined && payload.terminationReason !== 'NO_TOOL_CALL')
) {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const targetCwd = payload.cwd || path.resolve(__dirname, '..');

// 1. Attempt to auto-fix trivial formatting issues first
spawnSync('npx', ['markdownlint-cli', '--ignore', 'node_modules', '--fix', '**/*.md'], {
  cwd: targetCwd,
  shell: true,
  encoding: 'utf8'
});

// 2. Check if any non-autofixable errors remain
const result = spawnSync('npx', ['markdownlint-cli', '--ignore', 'node_modules', '**/*.md'], {
  cwd: targetCwd,
  shell: true,
  encoding: 'utf8'
});

if (result.status === 0) {
  process.stdout.write(JSON.stringify({}));
} else {
  const errorOutput = (result.stdout || result.stderr || '').trim();
  process.stdout.write(JSON.stringify({
    decision: 'continue',
    reason: `Markdown lint errors remain that could not be auto-fixed:\n${errorOutput}\nPlease resolve them.`
  }));
}
process.exit(0);
