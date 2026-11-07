const { spawnSync } = require('child_process');

// 1. Attempt to auto-fix trivial formatting issues first
spawnSync('npx', ['markdownlint-cli', '--fix', '**/*.md'], {
  shell: true,
  encoding: 'utf8'
});

// 2. Check if any non-autofixable errors remain
const result = spawnSync('npx', ['markdownlint-cli', '**/*.md'], {
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

