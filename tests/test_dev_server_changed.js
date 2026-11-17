const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePorcelainPaths,
  resolveChangedScripts,
  buildScriptEntries,
  renderDashboard,
} = require('../tools/dev_server.js');

test('parsePorcelainPaths unquotes paths and handles renames', () => {
  const out = [
    ' M "src/MusicBrainz Guess Case Improver.user.js"',
    '?? lib/MusicBrainzAPI.js',
    'R  src/Old.user.js -> "src/New Name.user.js"',
  ].join('\n');
  assert.deepEqual(parsePorcelainPaths(out), [
    'src/MusicBrainz Guess Case Improver.user.js',
    'lib/MusicBrainzAPI.js',
    'src/New Name.user.js',
  ]);
});

test('resolveChangedScripts marks direct src edits and lib @require dependents', () => {
  const files = ['A.user.js', 'B.user.js', 'C.user.js', 'D.user.js'];
  const contents = {
    'A.user.js': '// ==UserScript==\n// @name A\n// ==/UserScript==',
    'B.user.js': '// ==UserScript==\n// @name B\n// @require ../lib/Helper.js\n// ==/UserScript==',
    'C.user.js': '// ==UserScript==\n// @name C\n// @require https://raw.githubusercontent.com/chaban-mb/userscripts/main/lib/Helper.js\n// ==/UserScript==',
    'D.user.js': '// ==UserScript==\n// @name D\n// ==/UserScript==',
  };
  const map = resolveChangedScripts(
    ['src/A.user.js', 'lib/Helper.js'],
    files,
    (f) => contents[f]
  );
  assert.deepEqual(map.get('A.user.js'), ['modified']);
  assert.deepEqual(map.get('B.user.js'), ['lib:Helper.js']);
  assert.deepEqual(map.get('C.user.js'), ['lib:Helper.js']);
  assert.equal(map.has('D.user.js'), false);
});

test('buildScriptEntries attaches changed flags and URLs', () => {
  const changedMap = new Map([['A.user.js', ['modified']]]);
  const entries = buildScriptEntries(
    ['A.user.js'],
    'localhost:8080',
    'dev',
    'abc1234',
    changedMap,
    () => '// ==UserScript==\n// @name Script A\n// @version 1.2.3\n// ==/UserScript=='
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].changed, true);
  assert.deepEqual(entries[0].reasons, ['modified']);
  assert.equal(entries[0].url, 'http://localhost:8080/A.user.js');
  assert.equal(entries[0].separateUrl, 'http://localhost:8080/A.user.js?separate=1');
});

test('renderDashboard with changedOnly and zero changed scripts shows empty state and show-all link', () => {
  const html = renderDashboard('localhost:8080', 8080, {
    changedOnly: true,
    changedMap: new Map(),
  });
  assert.match(html, /No changed userscripts/i);
  assert.match(html, /href="\/\?changed=0"/);
});
