'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Core = require('../lib/BookmarkletToolbarCore.js');

test('STORAGE_KEYS exposes expected isolated storage keys and packKey helper', () => {
    assert.equal(Core.STORAGE_KEYS.localScripts, 'UserJS.BookmarkletToolbar.LocalScripts');
    assert.equal(Core.STORAGE_KEYS.layout, 'UserJS.BookmarkletToolbar.Layout');
    assert.equal(Core.STORAGE_KEYS.recents, 'UserJS.BookmarkletToolbar.Recents');
    assert.equal(Core.STORAGE_KEYS.settings, 'UserJS.BookmarkletToolbar.Settings');
    assert.equal(
        Core.STORAGE_KEYS.packKey('chaban-bookmarklets'),
        'UserJS.BookmarkletToolbar.Pack.chaban-bookmarklets'
    );
});

test('isValidMatchPattern and matchPattern handle Violentmonkey @match syntax and edge cases', () => {
    assert.equal(Core.isValidMatchPattern('<all_urls>'), true);
    assert.equal(Core.isValidMatchPattern('*://*/*'), true);
    assert.equal(Core.isValidMatchPattern('*://*.musicbrainz.org/*'), true);
    assert.equal(Core.isValidMatchPattern('https://musicbrainz.org/release/*'), true);

    assert.equal(Core.isValidMatchPattern(''), false);
    assert.equal(Core.isValidMatchPattern('musicbrainz.org/*'), false);
    assert.equal(Core.isValidMatchPattern('chrome://settings/*'), false);
    assert.equal(Core.isValidMatchPattern('file:///a'), false);
    assert.equal(Core.isValidMatchPattern('*://*musicbrainz.org/*'), false);
    assert.equal(Core.isValidMatchPattern('*://sub.*.org/*'), false);

    // <all_urls> and *://*/* match http/https and reject non-web schemes
    assert.equal(Core.matchPattern('<all_urls>', 'https://example.com/path'), true);
    assert.equal(Core.matchPattern('<all_urls>', 'http://example.com/'), true);
    assert.equal(Core.matchPattern('<all_urls>', 'chrome://settings'), false);
    assert.equal(Core.matchPattern('<all_urls>', 'file:///a'), false);

    assert.equal(Core.matchPattern('*://*/*', 'https://example.com/a'), true);
    assert.equal(Core.matchPattern('*://*/*', 'chrome://settings'), false);
    assert.equal(Core.matchPattern('*://*/*', 'file:///a'), false);
    assert.equal(Core.matchPattern('*://*/*', 'about:blank'), false);

    // *.domain matches both apex and subdomains, rejects lookalike prefixes
    assert.equal(Core.matchPattern('*://*.musicbrainz.org/*', 'https://musicbrainz.org/release/1'), true);
    assert.equal(Core.matchPattern('*://*.musicbrainz.org/*', 'https://beta.musicbrainz.org/x'), true);
    assert.equal(Core.matchPattern('*://*.musicbrainz.org/*', 'https://notmusicbrainz.org/'), false);

    // Path wildcards and query parameters
    assert.equal(
        Core.matchPattern('*://*.musicbrainz.org/release/*', 'https://musicbrainz.org/release/123/edit'),
        true
    );
    assert.equal(
        Core.matchPattern('*://*.musicbrainz.org/release/*', 'https://musicbrainz.org/artist/123'),
        false
    );
    assert.equal(
        Core.matchPattern(
            '*://*.musicbrainz.org/search?query=*',
            'https://musicbrainz.org/search?query=test&type=release'
        ),
        true
    );

    // scriptMatchesUrl: empty match array never matches
    assert.equal(Core.scriptMatchesUrl({ match: [] }, 'https://musicbrainz.org/'), false);
    assert.equal(
        Core.scriptMatchesUrl({ match: ['*://*.musicbrainz.org/*'] }, 'https://musicbrainz.org/release/1'),
        true
    );
});

test('syncPackCache handles first install, no-op on same version, and version bump diffing', () => {
    const bundledV1 = {
        id: 'chaban-bookmarklets',
        name: 'MusicBrainz Bookmarklets',
        version: '2026.11.15',
        description: 'Test pack',
        homepage: 'https://example.com',
        scripts: [
            {
                id: 'placed_removed_later',
                name: 'Placed Script',
                label: 'Placed',
                description: 'Will be removed in v2 but stays placed',
                match: ['*://*.musicbrainz.org/*'],
                code: 'console.log("placed");',
                folder: 'Edit',
            },
            {
                id: 'unplaced_removed_later',
                name: 'Unplaced Script',
                description: 'Will be dropped silently in v2',
                match: ['*://*.musicbrainz.org/*'],
                code: 'console.log("unplaced");',
            },
            {
                id: 'kept_updated',
                name: 'Kept Script',
                description: 'Code updates in v2',
                match: ['*://*.musicbrainz.org/*'],
                code: 'console.log("v1");',
            },
        ],
    };

    const initialLayout = [];
    const firstSync = Core.syncPackCache(null, bundledV1, initialLayout);
    assert.equal(firstSync.changed, true);
    assert.equal(firstSync.stats.added, 3);
    assert.deepEqual(initialLayout, []);
    assert.equal(
        firstSync.packCache.scripts['pack:chaban-bookmarklets/placed_removed_later'].removed,
        false
    );

    // Same version is a no-op
    const sameVersionSync = Core.syncPackCache(firstSync.packCache, bundledV1, initialLayout);
    assert.equal(sameVersionSync.changed, false);
    assert.equal(sameVersionSync.stats.added, 0);

    // Pin 'placed_removed_later' into layout before v2 update
    const layoutWithPlaced = [
        { type: 'script', scriptId: 'pack:chaban-bookmarklets/placed_removed_later' },
    ];

    const bundledV2 = {
        ...bundledV1,
        version: '2026.11.19',
        scripts: [
            {
                id: 'kept_updated',
                name: 'Kept Script',
                description: 'Code updates in v2',
                match: ['*://*.musicbrainz.org/*'],
                code: 'console.log("v2");',
            },
            {
                id: 'brand_new',
                name: 'Brand New Script',
                description: 'Added in v2',
                match: ['*://*/*'],
                code: 'console.log("new");',
            },
        ],
    };

    const v2Sync = Core.syncPackCache(firstSync.packCache, bundledV2, layoutWithPlaced);
    assert.equal(v2Sync.changed, true);
    assert.equal(v2Sync.stats.added, 1);
    assert.equal(v2Sync.stats.updated, 1);
    assert.equal(v2Sync.stats.removedFlagged, 1);
    assert.equal(v2Sync.stats.removedDropped, 1);

    // Unplaced removed script is dropped
    assert.equal(
        'pack:chaban-bookmarklets/unplaced_removed_later' in v2Sync.packCache.scripts,
        false
    );

    // Placed removed script is preserved with removed: true and runnable code intact
    const preserved = v2Sync.packCache.scripts['pack:chaban-bookmarklets/placed_removed_later'];
    assert.ok(preserved);
    assert.equal(preserved.removed, true);
    assert.equal(preserved.code, 'console.log("placed");');

    // Updated script has new code
    assert.equal(
        v2Sync.packCache.scripts['pack:chaban-bookmarklets/kept_updated'].code,
        'console.log("v2");'
    );

    // If a removed script returns in v3, removed flag is cleared
    const bundledV3 = {
        ...bundledV2,
        version: '2026.11.20',
        scripts: [...bundledV2.scripts, bundledV1.scripts[0]],
    };
    const v3Sync = Core.syncPackCache(v2Sync.packCache, bundledV3, layoutWithPlaced);
    assert.equal(
        v3Sync.packCache.scripts['pack:chaban-bookmarklets/placed_removed_later'].removed,
        false
    );
});

test('shouldMountToolbar, getVisibleLayoutForUrl, and label precedence', () => {
    const scriptsMap = Core.buildScriptsMap(
        {
            'chaban-bookmarklets': {
                id: 'chaban-bookmarklets',
                scripts: {
                    'pack:chaban-bookmarklets/mb_only': {
                        id: 'pack:chaban-bookmarklets/mb_only',
                        source: 'pack:chaban-bookmarklets',
                        name: 'Approve all edits on current page',
                        label: 'Approve All',
                        match: ['*://*.musicbrainz.org/*'],
                        code: 'void 0;',
                        removed: false,
                    },
                    'pack:chaban-bookmarklets/yt_only': {
                        id: 'pack:chaban-bookmarklets/yt_only',
                        source: 'pack:chaban-bookmarklets',
                        name: 'YouTube Video Finder',
                        match: ['*://*.youtube.com/*'],
                        code: 'void 0;',
                        removed: false,
                    },
                },
            },
        },
        {
            'local:custom': {
                id: 'local:custom',
                source: 'local',
                name: 'Custom MB Helper',
                match: ['*://*.musicbrainz.org/*'],
                code: 'void 0;',
            },
        }
    );

    // Unplaced matching scripts in Library never mount the toolbar
    assert.equal(Core.shouldMountToolbar([], scriptsMap, 'https://musicbrainz.org/release/1'), false);

    // Non-matching placed script does not mount toolbar
    const ytPinnedLayout = [{ type: 'script', scriptId: 'pack:chaban-bookmarklets/yt_only' }];
    assert.equal(
        Core.shouldMountToolbar(ytPinnedLayout, scriptsMap, 'https://musicbrainz.org/release/1'),
        false
    );

    // Matching script inside a folder mounts toolbar; empty folders and non-matching items are hidden
    const mixedLayout = [
        { type: 'script', scriptId: 'pack:chaban-bookmarklets/mb_only' },
        {
            type: 'folder',
            id: 'folder:1',
            name: 'Edit',
            items: [
                { type: 'script', scriptId: 'pack:chaban-bookmarklets/yt_only' },
                { type: 'script', scriptId: 'local:custom', label: 'My Custom Override' },
            ],
        },
        {
            type: 'folder',
            id: 'folder:2',
            name: 'YouTube Only Folder',
            items: [{ type: 'script', scriptId: 'pack:chaban-bookmarklets/yt_only' }],
        },
    ];

    assert.equal(
        Core.shouldMountToolbar(mixedLayout, scriptsMap, 'https://musicbrainz.org/release/1'),
        true
    );

    const visible = Core.getVisibleLayoutForUrl(
        mixedLayout,
        scriptsMap,
        'https://musicbrainz.org/release/1'
    );
    assert.equal(visible.length, 2);
    // Label precedence: script.label over script.name when node.label is omitted
    assert.equal(visible[0].type, 'script');
    assert.equal(visible[0].displayLabel, 'Approve All');

    // Folder hides non-matching yt_only item and applies node.label override on local:custom
    assert.equal(visible[1].type, 'folder');
    assert.equal(visible[1].items.length, 1);
    assert.equal(visible[1].items[0].displayLabel, 'My Custom Override');
});

test('layout reducers preserve immutability, labels, forward indices, and folder items', () => {
    let layout = [];

    // Pin 3 scripts to toolbar
    layout = Core.toggleToolbarPin(layout, 's1');
    layout = Core.toggleToolbarPin(layout, 's2');
    layout = Core.toggleToolbarPin(layout, 's3');
    assert.deepEqual(
        layout.map((n) => n.scriptId),
        ['s1', 's2', 's3']
    );

    // Set custom label on s1 at index 0
    layout = Core.setScriptLabel(layout, { kind: 'toolbar', index: 0 }, 'Custom S1');
    assert.equal(layout[0].label, 'Custom S1');

    // Moving forward within Toolbar (0 -> 2: drop before index 2, placing s1 between s2 and s3)
    const movedForward = Core.moveToolbarNode(layout, 0, 2);
    assert.deepEqual(
        movedForward.map((n) => n.scriptId),
        ['s2', 's1', 's3']
    );
    assert.equal(movedForward[1].label, 'Custom S1');

    // Create two folders
    const f1Res = Core.createFolder(movedForward, 'Folder A', 'folder:a');
    const f2Res = Core.createFolder(f1Res.layout, 'Folder B', 'folder:b');
    layout = f2Res.layout;

    // Move s1 (which has label 'Custom S1') from Toolbar into Folder A
    layout = Core.moveScriptToFolder(layout, 's1', 'folder:a');
    const placementInA = Core.getPlacement(layout, 's1');
    assert.equal(placementInA.kind, 'folder');
    assert.equal(placementInA.folderId, 'folder:a');
    assert.equal(
        layout.find((n) => n.id === 'folder:a').items[0].label,
        'Custom S1'
    );

    // Move s2 and s3 into Folder A as well, then reorder inside same folder (0 -> 2) without stale folder reference bug
    layout = Core.moveScriptToFolder(layout, 's2', 'folder:a');
    layout = Core.moveScriptToFolder(layout, 's3', 'folder:a');
    layout = Core.moveScriptToFolder(layout, 's1', 'folder:a', 2);
    const folderAItems = layout.find((n) => n.id === 'folder:a').items;
    assert.deepEqual(
        folderAItems.map((i) => i.scriptId),
        ['s2', 's1', 's3']
    );
    assert.equal(folderAItems[1].label, 'Custom S1');

    // Move s1 across folders (Folder A -> Folder B) and then back to Toolbar at index 0, preserving label
    layout = Core.moveScriptToFolder(layout, 's1', 'folder:b');
    assert.equal(layout.find((n) => n.id === 'folder:a').items.length, 2);
    assert.equal(layout.find((n) => n.id === 'folder:b').items[0].label, 'Custom S1');

    layout = Core.placeScriptOnToolbarAt(layout, 's1', 0);
    assert.equal(layout[0].scriptId, 's1');
    assert.equal(layout[0].label, 'Custom S1');
    assert.equal(layout.find((n) => n.id === 'folder:b').items.length, 0);

    // placeScriptOnToolbarAt moving an already-root script forward (0 -> 2)
    layout = Core.placeScriptOnToolbarAt(layout, 's1', 2);
    assert.equal(layout[1].scriptId, 's1');
    assert.equal(layout[1].label, 'Custom S1');

    // Clear label when empty string passed
    layout = Core.setScriptLabel(layout, { kind: 'toolbar', index: 1 }, '   ');
    assert.equal('label' in layout[1], false);

    // Rename folder, remove folder item, and delete folder
    layout = Core.renameFolder(layout, 'folder:a', 'Renamed A');
    assert.equal(layout.find((n) => n.id === 'folder:a').name, 'Renamed A');
    layout = Core.removeFolderItem(layout, 'folder:a', 0);
    assert.equal(layout.find((n) => n.id === 'folder:a').items.length, 1);
    layout = Core.deleteFolder(layout, 'folder:b');
    assert.equal(layout.some((n) => n.id === 'folder:b'), false);
});

test('hasRemovedPlacedScript and deleteLocalScript clean up localScripts and layout', () => {
    const scriptsMap = {
        'pack:chaban-bookmarklets/rem': {
            id: 'pack:chaban-bookmarklets/rem',
            removed: true,
        },
        'local:one': {
            id: 'local:one',
            removed: false,
        },
    };
    assert.equal(
        Core.hasRemovedPlacedScript([{ type: 'script', scriptId: 'local:one' }], scriptsMap),
        false
    );
    assert.equal(
        Core.hasRemovedPlacedScript(
            [{ type: 'script', scriptId: 'pack:chaban-bookmarklets/rem' }],
            scriptsMap
        ),
        true
    );

    const localScripts = {
        'local:one': {
            id: 'local:one',
            source: 'local',
            name: 'Local One',
            match: ['*://*/*'],
            code: 'void 0;',
        },
    };
    const layout = [{ type: 'script', scriptId: 'local:one' }];
    const deleted = Core.deleteLocalScript(localScripts, layout, 'local:one');
    assert.equal('local:one' in deleted.localScripts, false);
    assert.equal(deleted.layout.length, 0);
});

test('convertRemovedPackScriptToLocal and removeOrphanedPackScriptFully update packCache, localScripts, and layout', () => {
    const packCache = {
        id: 'chaban-bookmarklets',
        name: 'Pack',
        version: '2',
        scripts: {
            'pack:chaban-bookmarklets/old_one': {
                id: 'pack:chaban-bookmarklets/old_one',
                packId: 'chaban-bookmarklets',
                source: 'pack:chaban-bookmarklets',
                name: 'Old Script',
                label: 'Old',
                description: 'Removed from pack',
                match: ['*://*.musicbrainz.org/*'],
                code: 'alert(1);',
                removed: true,
            },
            'pack:chaban-bookmarklets/old_two': {
                id: 'pack:chaban-bookmarklets/old_two',
                packId: 'chaban-bookmarklets',
                source: 'pack:chaban-bookmarklets',
                name: 'Old Two',
                description: 'Also removed',
                match: ['*://*.musicbrainz.org/*'],
                code: 'alert(2);',
                removed: true,
            },
        },
    };
    const localScripts = {};
    const layout = [
        { type: 'script', scriptId: 'pack:chaban-bookmarklets/old_one', label: 'My Pin' },
        {
            type: 'folder',
            id: 'folder:1',
            name: 'Edit',
            items: [{ type: 'script', scriptId: 'pack:chaban-bookmarklets/old_two' }],
        },
    ];

    const converted = Core.convertRemovedPackScriptToLocal(
        packCache,
        localScripts,
        layout,
        'pack:chaban-bookmarklets/old_one',
        'local:converted_one'
    );
    assert.equal(converted.newId, 'local:converted_one');
    assert.equal('pack:chaban-bookmarklets/old_one' in converted.packCache.scripts, false);
    assert.equal(converted.localScripts['local:converted_one'].source, 'local');
    assert.equal('removed' in converted.localScripts['local:converted_one'], false);
    assert.equal(converted.layout[0].scriptId, 'local:converted_one');
    assert.equal(converted.layout[0].label, 'My Pin');

    const removedFully = Core.removeOrphanedPackScriptFully(
        converted.packCache,
        converted.layout,
        'pack:chaban-bookmarklets/old_two'
    );
    assert.equal('pack:chaban-bookmarklets/old_two' in removedFully.packCache.scripts, false);
    assert.equal(removedFully.layout[1].items.length, 0);
});

test('normalizeBookmarkletCode strips javascript:, decodes URI-encoded bookmarklets, and preserves raw modulo % operators and percent-encoded URLs inside JS string literals', () => {
    const encoded = 'javascript:(function()%7Bconst%20x%20%3D%201%3B%20alert(x)%3B%7D)()';
    assert.equal(
        Core.normalizeBookmarkletCode(encoded),
        '(function(){const x = 1; alert(x);})()'
    );

    const encodedSimple = 'javascript:(function()%7Balert(1)%3B%7D)()';
    assert.equal(
        Core.normalizeBookmarkletCode(encodedSimple),
        '(function(){alert(1);})()'
    );

    const encodedArrow = 'javascript:(()%20%3D%3E%20%7B%20console.log(1)%3B%20%7D)()';
    assert.equal(
        Core.normalizeBookmarkletCode(encodedArrow),
        '(() => { console.log(1); })()'
    );

    const encodedWithoutScheme = '(function()%7Breturn%2042%3B%7D)()';
    assert.equal(
        Core.normalizeBookmarkletCode(encodedWithoutScheme),
        '(function(){return 42;})()'
    );

    const rawWithModulo = 'javascript:(function() {\n    if (x % 2 === 0 && y % 20 === 0) {\n        console.log("100% ok");\n    }\n})();';
    assert.equal(
        Core.normalizeBookmarkletCode(rawWithModulo),
        '(function() {\n    if (x % 2 === 0 && y % 20 === 0) {\n        console.log("100% ok");\n    }\n})();'
    );

    const rawUrlWithEncodedQuotesAndSemicolon =
        'window.open("https://musicbrainz.org/search?query=%22" + q + "%22&limit=100%3B")';
    assert.equal(
        Core.normalizeBookmarkletCode(rawUrlWithEncodedQuotesAndSemicolon),
        rawUrlWithEncodedQuotesAndSemicolon
    );

    const rawModuloReturningEncodedToken = 'if (x % 2 === 0 && y % 20 === 0) return "%3D";';
    assert.equal(
        Core.normalizeBookmarkletCode(rawModuloReturningEncodedToken),
        rawModuloReturningEncodedToken
    );
});

test('buildExportEnvelope and parseAndValidateImport validate schema v1 and reject nested folders or invalid scripts', () => {
    const localScripts = {
        'local:test': {
            id: 'local:test',
            source: 'local',
            name: 'Test Script',
            description: 'Desc',
            match: ['*://*.musicbrainz.org/*'],
            code: 'console.log(1);',
        },
    };
    const layout = [
        { type: 'script', scriptId: 'local:test', label: 'Test' },
        {
            type: 'folder',
            id: 'folder:1',
            name: 'Edit',
            items: [{ type: 'script', scriptId: 'pack:chaban-bookmarklets/approve_all_edits' }],
        },
    ];

    const envelope = Core.buildExportEnvelope(localScripts, layout);
    assert.equal(envelope.version, 1);
    assert.ok(typeof envelope.exportedAt === 'string');

    const parsed = Core.parseAndValidateImport(JSON.stringify(envelope));
    assert.equal(parsed.scripts['local:test'].name, 'Test Script');
    assert.equal(parsed.layout.length, 2);

    // Reject nested folders
    const nestedFolderEnvelope = {
        ...envelope,
        layout: [
            {
                type: 'folder',
                id: 'folder:1',
                name: 'Outer',
                items: [{ type: 'folder', id: 'folder:2', name: 'Inner', items: [] }],
            },
        ],
    };
    assert.throws(() => Core.parseAndValidateImport(JSON.stringify(nestedFolderEnvelope)), /folder/i);

    // Reject invalid script shapes or non-array / empty match
    const badScriptEnvelope = {
        ...envelope,
        scripts: {
            'local:bad': {
                id: 'local:bad',
                name: 'Bad',
                match: '*://*.musicbrainz.org/*',
                code: 'alert(1)',
            },
        },
    };
    assert.throws(() => Core.parseAndValidateImport(JSON.stringify(badScriptEnvelope)), /match/i);

    // Reject duplicate folder IDs across layout nodes
    const duplicateFolderIdEnvelope = {
        ...envelope,
        layout: [
            { type: 'folder', id: 'folder:dup', name: 'One', items: [] },
            { type: 'folder', id: 'folder:dup', name: 'Two', items: [] },
        ],
    };
    assert.throws(
        () => Core.parseAndValidateImport(JSON.stringify(duplicateFolderIdEnvelope)),
        /Duplicate folder id "folder:dup"/i
    );
});

test('matchesHotkey and formatHotkeyEvent enforce modifiers, ignore modifier-only presses, and support Plus (+) key', () => {
    assert.equal(Core.formatHotkeyEvent({ key: 'Alt', altKey: true }), null);
    assert.equal(Core.formatHotkeyEvent({ key: 'Control', ctrlKey: true }), null);
    assert.equal(Core.formatHotkeyEvent({ key: 'b', altKey: false, ctrlKey: false, shiftKey: false }), null);

    assert.equal(
        Core.formatHotkeyEvent({ key: 'b', altKey: true, ctrlKey: false, shiftKey: false }),
        'Alt+B'
    );
    assert.equal(
        Core.formatHotkeyEvent({ key: 'k', altKey: false, ctrlKey: true, shiftKey: true }),
        'Ctrl+Shift+K'
    );
    assert.equal(
        Core.formatHotkeyEvent({ key: '+', altKey: false, ctrlKey: true, shiftKey: true }),
        'Ctrl+Shift+Plus'
    );

    assert.equal(
        Core.matchesHotkey({ key: 'Alt', altKey: true }, 'Alt+B'),
        false
    );
    assert.equal(
        Core.matchesHotkey({ key: 'b', altKey: true, ctrlKey: false, shiftKey: false }, 'Alt+B'),
        true
    );
    assert.equal(
        Core.matchesHotkey({ key: 'b', altKey: false, ctrlKey: false, shiftKey: false }, 'Alt+B'),
        false
    );
    assert.equal(
        Core.matchesHotkey({ key: '+', altKey: false, ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+Plus'),
        true
    );
    assert.equal(
        Core.matchesHotkey({ key: '+', altKey: false, ctrlKey: true, shiftKey: true }, 'Ctrl+Shift++'),
        true
    );
});

test('DOCK_SNAP_ZONES, DOCK_EXPAND_MODES, getSiteOrigin, normalizeSettings, and per-site shouldMountToolbar hide check', () => {
    assert.deepEqual(Core.DOCK_SNAP_ZONES, [
        'top-left',
        'top-center',
        'top-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
    ]);
    assert.equal(Object.isFrozen(Core.DOCK_SNAP_ZONES), true);

    assert.deepEqual(Core.DOCK_EXPAND_MODES, ['both', 'click', 'hover']);
    assert.equal(Object.isFrozen(Core.DOCK_EXPAND_MODES), true);

    assert.deepEqual(Core.DOCK_ORIENTATIONS, ['auto', 'horizontal', 'vertical']);
    assert.equal(Object.isFrozen(Core.DOCK_ORIENTATIONS), true);

    assert.equal(
        Core.getSiteOrigin('https://musicbrainz.org/release/123?foo=1'),
        'https://musicbrainz.org'
    );
    assert.equal(Core.getSiteOrigin('http://localhost:3000/app'), 'http://localhost:3000');
    assert.equal(Core.getSiteOrigin(''), '');
    assert.equal(Core.getSiteOrigin(null), '');
    assert.equal(Core.getSiteOrigin('not-a-url'), '');
    assert.equal(Core.getSiteOrigin('about:blank'), '');

    assert.deepEqual(Core.normalizeSettings(null), {
        hotkey: 'Alt+B',
        dockExpandMode: 'both',
        dockDefaultPosition: 'bottom-center',
        dockOrientation: 'auto',
        dockDefaultVisible: true,
        dockSitePositions: {},
        dockSiteOrientations: {},
        dockSiteExpanded: {},
        dockSiteVisibility: {},
        folderHoverOpen: false,
        keepFolderOpenAfterRun: false,
    });

    assert.deepEqual(
        Core.normalizeSettings({
            hotkey: 'Ctrl+K',
            dockExpandMode: 'invalid',
            dockDefaultPosition: 'invalid-zone',
            dockOrientation: 'diagonal',
            dockDefaultVisible: false,
            dockSitePositions: {
                'https://a.test': 'top-left',
                'https://b.test': 'bad-zone',
            },
            dockSiteOrientations: {
                'https://musicbrainz.org/release/123': 'horizontal',
                'https://bad.test': 'invalid',
                'not-a-url': 'vertical',
            },
            dockSiteExpanded: { 'https://a.test': true },
            dockSiteHidden: { 'https://c.test': true, 'https://d.test': false, 'https://e.test': true },
            dockSiteVisibility: { 'https://e.test': 'shown', 'https://bad.test': 'maybe' },
            folderHoverOpen: true,
            keepFolderOpenAfterRun: 'yes',
        }),
        {
            hotkey: 'Ctrl+K',
            dockExpandMode: 'both',
            dockDefaultPosition: 'bottom-center',
            dockOrientation: 'auto',
            dockDefaultVisible: false,
            dockSitePositions: { 'https://a.test': 'top-left' },
            dockSiteOrientations: { 'https://musicbrainz.org': 'horizontal' },
            dockSiteExpanded: { 'https://a.test': true },
            dockSiteVisibility: { 'https://e.test': 'shown', 'https://c.test': 'hidden' },
            folderHoverOpen: true,
            keepFolderOpenAfterRun: false,
        }
    );

    assert.deepEqual(
        Core.normalizeSettings({
            dockDefaultPosition: 'top-right',
            dockOrientation: 'vertical',
            dockSiteOrientations: {
                'https://musicbrainz.org': 'horizontal',
                'https://bad.test': 'invalid',
            },
        }),
        {
            hotkey: 'Alt+B',
            dockExpandMode: 'both',
            dockDefaultPosition: 'top-right',
            dockOrientation: 'vertical',
            dockDefaultVisible: true,
            dockSitePositions: {},
            dockSiteOrientations: { 'https://musicbrainz.org': 'horizontal' },
            dockSiteExpanded: {},
            dockSiteVisibility: {},
            folderHoverOpen: false,
            keepFolderOpenAfterRun: false,
        }
    );

    const scriptsMap = Core.buildScriptsMap(
        {},
        {
            'local:mb': {
                id: 'local:mb',
                source: 'local',
                name: 'MB Helper',
                match: ['*://*.musicbrainz.org/*'],
                code: 'void 0;',
            },
            'local:yt': {
                id: 'local:yt',
                source: 'local',
                name: 'YT Helper',
                match: ['*://*.youtube.com/*'],
                code: 'void 0;',
            },
        }
    );
    const layout = [
        { type: 'script', scriptId: 'local:mb' },
        { type: 'script', scriptId: 'local:yt' },
        {
            type: 'folder',
            id: 'f:mix',
            name: 'Mix',
            items: [{ scriptId: 'local:yt' }, { scriptId: 'local:mb' }],
        },
        {
            type: 'folder',
            id: 'f:yt',
            name: 'YT Only',
            items: [{ scriptId: 'local:yt' }],
        },
        {
            type: 'folder',
            id: 'f:empty',
            name: 'Empty',
            items: [],
        },
    ];

    // isDockVisibleOnOrigin + shouldMountToolbar across global default and per-origin overrides
    assert.equal(
        Core.isDockVisibleOnOrigin({ dockSiteHidden: { 'https://musicbrainz.org': true } }, 'https://musicbrainz.org/release/123'),
        false
    );
    assert.equal(
        Core.shouldMountToolbar(layout, scriptsMap, 'https://musicbrainz.org/release/123', {
            dockSiteHidden: { 'https://musicbrainz.org': true },
        }),
        false
    );
    assert.equal(
        Core.shouldMountToolbar(layout, scriptsMap, 'https://beta.musicbrainz.org/release/123', {
            dockSiteHidden: { 'https://musicbrainz.org': true },
        }),
        true
    );
    assert.equal(
        Core.shouldMountToolbar(layout, scriptsMap, 'https://musicbrainz.org/release/123', {
            dockDefaultVisible: false,
            dockSiteVisibility: {},
        }),
        false
    );
    assert.equal(
        Core.shouldMountToolbar(layout, scriptsMap, 'https://musicbrainz.org/release/123', {
            dockDefaultVisible: false,
            dockSiteVisibility: { 'https://musicbrainz.org': 'shown' },
        }),
        true
    );

    // toggleDockSiteVisibility normalization & non-HTTP(S) safety (Review Focus #2, #3)
    const toggledHidden = Core.toggleDockSiteVisibility(
        { dockDefaultVisible: true, dockSiteHidden: { 'https://a.test': true } },
        'https://musicbrainz.org/release/1'
    );
    assert.equal(toggledHidden.dockSiteVisibility['https://a.test'], 'hidden');
    assert.equal(toggledHidden.dockSiteVisibility['https://musicbrainz.org'], 'hidden');

    const toggledBackToDefault = Core.toggleDockSiteVisibility(
        toggledHidden,
        'https://musicbrainz.org'
    );
    assert.equal('https://musicbrainz.org' in toggledBackToDefault.dockSiteVisibility, false);
    const afterGlobalFlip = Core.normalizeSettings({
        ...toggledBackToDefault,
        dockDefaultVisible: false,
    });
    assert.equal(Core.isDockVisibleOnOrigin(afterGlobalFlip, 'https://musicbrainz.org/release/1'), false);

    const fileToggle = Core.toggleDockSiteVisibility(afterGlobalFlip, 'file:///tmp/test.html');
    assert.deepEqual(fileToggle, afterGlobalFlip);
    assert.equal(Core.isDockVisibleOnOrigin(afterGlobalFlip, 'about:blank'), false);

    // doesLayoutNodeMatchUrl
    const mbUrl = 'https://musicbrainz.org/release/123';
    assert.equal(Core.doesLayoutNodeMatchUrl(layout[0], scriptsMap, mbUrl), true);
    assert.equal(Core.doesLayoutNodeMatchUrl(layout[1], scriptsMap, mbUrl), false);
    assert.equal(Core.doesLayoutNodeMatchUrl({ type: 'script', scriptId: 'local:missing' }, scriptsMap, mbUrl), false);
    assert.equal(Core.doesLayoutNodeMatchUrl(layout[2], scriptsMap, mbUrl), true);
    assert.equal(Core.doesLayoutNodeMatchUrl(layout[3], scriptsMap, mbUrl), false);
    assert.equal(Core.doesLayoutNodeMatchUrl(layout[4], scriptsMap, mbUrl), false);
});
