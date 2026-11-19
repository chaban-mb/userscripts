const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePorcelainPaths,
  resolveChangedScripts,
  buildScriptEntries,
  renderDashboard,
  extractLocalLibNames,
  inlineLocalLibs,
  computeScriptEtag,
  transformUserscript,
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
    'C.user.js': '// ==UserScript==\n// @name C\n// @require https://raw.githubusercontent.com/chaban-mb/userscripts/main/lib/Helper.js?v=1\n// ==/UserScript==',
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

test('renderDashboard escapes HTML special characters in script metadata', () => {
  const html = renderDashboard('localhost:8080', 8080, {
    changedOnly: false,
    changedMap: new Map([['A.user.js', ['modified']]]),
    files: ['A.user.js'],
    readScript: () => '// ==UserScript==\n// @name Foo & <Bar>\n// @version 1.0.0\n// ==/UserScript==',
  });
  assert.match(html, /Foo &amp; &lt;Bar&gt;/);
  assert.doesNotMatch(html, /<Bar>/);
});

test('inlineLocalLibs and transformUserscript inline relative ../lib/ requires inside closure while preserving remote @requires', () => {
  const raw = [
    '// ==UserScript==',
    '// @name        Demo Script',
    '// @version     1.2.3',
    '// @require     ../lib/Alpha.js',
    '// @require     https://cdn.example.com/vendor.js',
    '// @updateURL   https://github.com/chaban-mb/userscripts/raw/main/src/Demo%20Script.user.js',
    '// @downloadURL https://github.com/chaban-mb/userscripts/raw/main/src/Demo%20Script.user.js',
    '// ==/UserScript==',
    '',
    '(function () {',
    "    'use strict';",
    '    console.info(Alpha);',
    '})();',
  ].join('\n');

  const libs = {
    'Alpha.js': '// ==UserScript==\n// @name Alpha\n// ==/UserScript==\nconst Alpha = 42;\n',
  };

  assert.deepEqual(extractLocalLibNames(raw), ['Alpha.js']);

  const transformed = transformUserscript(raw, false, {
    inlineLibs: true,
    gitInfo: { branch: 'feat', hash: 'abc1234' },
    readLib: (name) => libs[name] ?? null,
  });

  assert.match(transformed, /@version\s+1\.2\.3-dev\.feat\.abc1234/);
  assert.doesNotMatch(transformed, /\.\.\/lib\/Alpha\.js/);
  assert.match(transformed, /@require\s+https:\/\/cdn\.example\.com\/vendor\.js/);
  assert.match(transformed, /@updateURL\s+https:\/\/github\.com\/chaban-mb\/userscripts\/raw\/main\/src\/Demo%20Script\.user\.js/);
  assert.match(transformed, /const Alpha = 42;/);
  assert.doesNotMatch(transformed, /@name Alpha/);

  const strictPos = transformed.indexOf("'use strict';");
  const libPos = transformed.indexOf('const Alpha = 42;');
  const endClosurePos = transformed.lastIndexOf('})();');
  assert.ok(strictPos < libPos && libPos < endClosurePos);

  const rawMode = transformUserscript(raw, false, {
    inlineLibs: false,
    gitInfo: { branch: 'feat', hash: 'abc1234' },
  });
  assert.match(rawMode, /@require\s+\.\.\/lib\/Alpha\.js/);
  assert.doesNotMatch(rawMode, /const Alpha = 42;/);
});

test('computeScriptEtag changes when a required lib file mtime changes', () => {
  const raw = '// ==UserScript==\n// @name A\n// @require ../lib/Alpha.js\n// ==/UserScript==';
  const etag1 = computeScriptEtag(1000, raw, {
    branch: 'dev',
    hash: 'abc1234',
    inlineLibs: true,
    getLibMtimeMs: () => 2000,
  });
  const etag2 = computeScriptEtag(1000, raw, {
    branch: 'dev',
    hash: 'abc1234',
    inlineLibs: true,
    getLibMtimeMs: () => 3000,
  });
  assert.notEqual(etag1, etag2);
});
