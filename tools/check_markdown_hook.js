const { spawnSync } = require('child_process');

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
    reason: `Markdown lint errors detected:\n${errorOutput}\nRun 'npx markdownlint-cli --fix "**/*.md"' to resolve them.`
  }));
}
process.exit(0);

