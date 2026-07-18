const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// Helper to colorize console output
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;

// 1. Read and load the userscript
const scriptPath = path.join(__dirname, '..', 'src', 'MusicBrainz Guess Case Improver.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Insert exports hook at the end of the IIFE
const hookText = `
    globalThis.__TEST_EXPORTS__ = {
        applyAdvancedRules,
        cleanTrackModelAfterGuessFeat,
        cleanEntityModel,
        deduplicateACFromObservable,
        mergeArtistCredits,
        extractTrailingEtis,
        propagateGidsFromTracksToRelease,
        removeRemixersFromAC,
        isArtistRemixerInTitle,
        enhanceReleaseGuessFeat,
        enhanceReactGuessCase,
        cleanTokenBoundaries,
        parseTitleStructure,
        resolveArtistPartIndex
    };
`;
code = code.replace(/\n\s*\}\)\(\);\s*$/, `\n${hookText}\n})();`);

// Create VM context
const MutationObserverMock = class {
    observe() { }
    disconnect() { }
};

const domMock = {
    body: {
        appendChild: () => { },
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => { },
};

const windowMock = {
    location: { pathname: '/recording/create' },
    document: domMock,
    navigator: { userAgent: 'node' },
};

const EventMock = class {
    constructor(type, options) {
        this.type = type;
        this.bubbles = !!options?.bubbles;
    }
};

const context = {
    window: windowMock,
    document: {
        ...domMock,
        cookie: ''
    },
    navigator: windowMock.navigator,
    MutationObserver: MutationObserverMock,
    Event: EventMock,
    GM: {
        info: {
            script: {
                name: 'MusicBrainz: Guess Case Improver'
            }
        }
    },
    console: console,
    setTimeout: setTimeout,      // Fixed: Provide setTimeout context hooks
    clearTimeout: clearTimeout,  // Fixed: Provide clearTimeout context hooks
    globalThis: {}
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(code, context);

const lib = context.__TEST_EXPORTS__;

// Helper to make mock Knockout observable
function makeObservable(initialValue) {
    let value = initialValue;
    const obs = function (newValue) {
        if (arguments.length > 0) {
            value = newValue;
        } else {
            return value;
        }
    };
    obs.peek = () => value;
    return obs;
}

// Global tests status
let failedTestsCount = 0;
let passedTestsCount = 0;

function runTestCase(name, setup, assertFn) {
    try {
        setup();
        assertFn();
        console.log(`${green('PASS')} - ${name}`);
        passedTestsCount++;
    } catch (e) {
        console.log(`${red('FAIL')} - ${name}`);
        console.error(e);
        failedTestsCount++;
    }
}

console.log('Running Guess Case / Guess Feat Improver regression tests...\n');

// ====================================================================================
// --- Scenario A Tests ---
// ====================================================================================
console.log('--- Scenario A: Knockout Observable is Available ---');

// Case 1
runTestCase('1. Title - Artist (Seeded match)', () => {
    this.track = {
        name: makeObservable('Autismus Anthem (musikvideo)'),
        artistCredit: makeObservable({
            names: [
                { name: 'Klang der Nudel & Ultra Raphi', joinPhrase: ' feat. ', artist: { name: 'Klang der Nudel & Ultra Raphi' } },
                { name: 'Klang der Nudel', joinPhrase: ' & ', artist: null },
                { name: 'Kamimane', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'Autismus Anthem - Klang der Nudel & Kamimane (musikvideo)',
        ['Klang der Nudel & Ultra Raphi']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'Autismus Anthem (musikvideo)');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'Klang der Nudel');
    assert.strictEqual(ac.names[0].joinPhrase, ' & ');
    assert.strictEqual(ac.names[1].name, 'Kamimane');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 2
runTestCase('2. Artist - Title (Seeded match)', () => {
    this.track = {
        name: makeObservable('Autismus Anthem'),
        artistCredit: makeObservable({
            names: [
                { name: 'Klang der Nudel', joinPhrase: ' feat. ', artist: { name: 'Klang der Nudel' } },
                { name: 'Kamimane', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track, // Fixed: Re-aligned missing model argument mapping
        'Klang der Nudel feat. Kamimane - Autismus Anthem',
        ['Klang der Nudel']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'Autismus Anthem');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'Klang der Nudel');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[1].name, 'Kamimane');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 3
runTestCase('3. Artist - Title (Aiobahn match)', () => {
    this.track = {
        name: makeObservable('letter (Official Visualizer)'),
        artistCredit: makeObservable({
            names: [
                { name: 'Aiobahn', joinPhrase: ' feat. ', artist: { name: 'Aiobahn' } },
                { name: '9Lana', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'Aiobahn feat. 9Lana - letter (Official Visualizer)',
        ['Aiobahn']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'letter (Official Visualizer)');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'Aiobahn');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[1].name, '9Lana');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 4
runTestCase('4. Electric Callboy feat. The Offspring', () => {
    this.track = {
        name: makeObservable('LET THE GOOD TIMES ROLL (OFFICIAL VIDEO)'),
        artistCredit: makeObservable({
            names: [
                { name: 'Electric Callboy', joinPhrase: ' feat. ', artist: { name: 'Electric Callboy' } },
                { name: 'The Offspring', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'Electric Callboy feat. The Offspring - LET THE GOOD TIMES ROLL (OFFICIAL VIDEO)',
        ['Electric Callboy']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'LET THE GOOD TIMES ROLL (OFFICIAL VIDEO)');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'Electric Callboy');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[1].name, 'The Offspring');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 5
runTestCase('5. Title / Artist (wotaku match)', () => {
    this.track = {
        name: makeObservable('snooze'),
        artistCredit: makeObservable({
            names: [
                { name: 'wotaku', joinPhrase: ' feat. ', artist: { name: 'wotaku' } },
                { name: 'SHIKI', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'snooze / wotaku feat. SHIKI',
        ['wotaku']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'snooze');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'wotaku');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[1].name, 'SHIKI');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 6
runTestCase('6. Brutalismus 3000 (with Boys Noize)', () => {
    this.track = {
        name: makeObservable('I Bring My Gun To The Function (Official Video)'),
        artistCredit: makeObservable({
            names: [
                { name: 'Brutalismus 3000', joinPhrase: ' with ', artist: { name: 'Brutalismus 3000' } },
                { name: 'Boys Noize', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'Brutalismus 3000 - I Bring My Gun To The Function (with Boys Noize) (Official Video)',
        ['Brutalismus 3000']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'I Bring My Gun To The Function (Official Video)');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'Brutalismus 3000');
    assert.strictEqual(ac.names[0].joinPhrase, ' with ');
    assert.strictEqual(ac.names[1].name, 'Boys Noize');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 7
runTestCase('7. DryftiN - Playing with FIRE!!! (feat. Yi Xi)', () => {
    this.track = {
        name: makeObservable('Playing with FIRE!!!'),
        artistCredit: makeObservable({
            names: [
                { name: 'DryftiN', joinPhrase: ' feat. ', artist: { name: 'DryftiN' } },
                { name: 'Yi Xi', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'DryftiN - Playing with FIRE!!! (feat. Yi Xi)',
        ['DryftiN']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'Playing with FIRE!!!');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'DryftiN');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[1].name, 'Yi Xi');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 8
runTestCase('8. Chenomio (no space feat. 重音テト)', () => {
    this.track = {
        name: makeObservable('フィクションです。'),
        artistCredit: makeObservable({
            names: [
                { name: 'Chenomio', joinPhrase: ' feat. ', artist: { name: 'Chenomio' } },
                { name: '重音テト', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'Chenomio -フィクションです。feat.重音テト',
        ['Chenomio']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'フィクションです。');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'Chenomio');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[1].name, '重音テト');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 9
runTestCase('9. Smart Merge / Safe Fallback (Taiko no Tatsujin)', () => {
    this.track = {
        name: makeObservable('シャニムニ花火 - ピノキオピー'),
        artistCredit: makeObservable({
            names: [
                { name: '太鼓の達人 公式チャンネル (Taiko no Tatsujin)', joinPhrase: ' feat. ', artist: { name: 'Taiko' } },
                { name: '初音ミク', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'シャニムニ花火 - ピノキオピー feat. 初音ミク',
        ['太鼓の達人 公式チャンネル (Taiko no Tatsujin)']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'シャニムニ花火');
    assert.strictEqual(ac.names.length, 3);
    assert.strictEqual(ac.names[0].name, '太鼓の達人 公式チャンネル (Taiko no Tatsujin)');
    assert.strictEqual(ac.names[0].joinPhrase, ' & ');
    assert.strictEqual(ac.names[1].name, 'ピノキオピー');
    assert.strictEqual(ac.names[1].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[2].name, '初音ミク');
    assert.strictEqual(ac.names[2].joinPhrase, '');
});

// Case 10
runTestCase('10. Reversed Layout (PinocchioP match)', () => {
    this.track = {
        name: makeObservable('シャニムニ花火'),
        artistCredit: makeObservable({
            names: [
                { name: 'ピノキオピー', joinPhrase: ' feat. ', artist: { name: 'PinocchioP' } },
                { name: '初音ミク', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'シャニムニ花火 - ピノキオピー feat. 初音ミク',
        ['ピノキオピー']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'シャニムニ花火');
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'ピノキオピー');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[1].name, '初音ミク');
    assert.strictEqual(ac.names[1].joinPhrase, '');
});

// Case 11
runTestCase('11. Multiple primary artists matching seeded single artist', () => {
    this.track = {
        name: makeObservable('ヴィオレッタ (Official Video)'),
        artistCredit: makeObservable({
            names: [
                { name: 'Giga', joinPhrase: ' & ', artist: null },
                { name: 'TeddyLoid', joinPhrase: ' feat. ', artist: { name: 'TeddyLoid' } },
                { name: '超学生', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'Giga & TeddyLoid - ヴィオレッタ feat. 超学生 (Official Video)',
        ['TeddyLoid']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'ヴィオレッタ (Official Video)');
    assert.strictEqual(ac.names.length, 3);
    assert.strictEqual(ac.names[0].name, 'Giga');
    assert.strictEqual(ac.names[0].joinPhrase, ' & ');
    assert.strictEqual(ac.names[1].name, 'TeddyLoid');
    assert.strictEqual(ac.names[1].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[2].name, '超学生');
    assert.strictEqual(ac.names[2].joinPhrase, '');
});

// Case 12
runTestCase('12. Space mismatch bypass (HONK THE HORN)', () => {
    this.track = {
        name: makeObservable('WILD SIDE 【Official Music Video】'),
        artistCredit: makeObservable({
            names: [
                { name: 'HONK THE HORN', joinPhrase: '', artist: { name: 'HONKTHEHORN' } }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'WILD SIDE - HONK THE HORN 【Official Music Video】',
        ['HONKTHEHORN']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'WILD SIDE 【Official Music Video】');
    assert.strictEqual(ac.names.length, 1);
    assert.strictEqual(ac.names[0].name, 'HONK THE HORN');
    assert.strictEqual(ac.names[0].joinPhrase, '');
});

// Case 13
runTestCase('13. Pre-existing primary guest artist credit reordering (User Issue)', () => {
    this.track = {
        name: makeObservable('Dub 003'),
        artistCredit: makeObservable({
            names: [
                { name: 'Cosmonection', joinPhrase: ', ', artist: { gid: 'fcefeeef-674f-4c2e-b45a-d3932528f543' } },
                { name: 'Tour‐Maubourg', joinPhrase: ' & ', artist: { gid: '72b1a51c-a23e-4202-b8eb-fffd46f578fa' } },
                { name: 'Marc Bianco', joinPhrase: ' feat. ', artist: { gid: '46c0116f-10e8-4ab4-b4c7-8f0e6b246afb' } },
                { name: 'Cosmonection', joinPhrase: ' & ', artist: null },
                { name: 'Marc Bianco', joinPhrase: ' & ', artist: null },
                { name: 'Cosmonection', joinPhrase: ' & ', artist: null },
                { name: 'Marc Bianco', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.deduplicateACFromObservable(this.track.artistCredit);
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(ac.names.length, 3);

    assert.strictEqual(ac.names[0].name, 'Tour‐Maubourg');
    assert.strictEqual(ac.names[0].joinPhrase, ' feat. ');
    assert.strictEqual(ac.names[0].artist?.gid, '72b1a51c-a23e-4202-b8eb-fffd46f578fa');

    assert.strictEqual(ac.names[1].name, 'Cosmonection');
    assert.strictEqual(ac.names[1].joinPhrase, ' & ');
    assert.strictEqual(ac.names[1].artist?.gid, 'fcefeeef-674f-4c2e-b45a-d3932528f543');

    assert.strictEqual(ac.names[2].name, 'Marc Bianco');
    assert.strictEqual(ac.names[2].joinPhrase, '');
    assert.strictEqual(ac.names[2].artist?.gid, '46c0116f-10e8-4ab4-b4c7-8f0e6b246afb');
});

// Case 14
runTestCase('14. Recursive ETI extraction in applyAdvancedRules', () => {
    const result = lib.applyAdvancedRules('Dub 003 (Official Video) (Official Lyric Video)');
    assert.strictEqual(result, 'Dub 003 (official video) (official lyric video)');
}, () => { });

// Case 15
runTestCase('15. Preserving GID in deduplicateACFromObservable when duplicate holds the GID', () => {
    this.track = {
        name: makeObservable('id 2022'),
        artistCredit: makeObservable({
            names: [
                { name: 'W/N', joinPhrase: ' feat. ', artist: { gid: '00a1a122-c3e3-4d65-b28e-ca330fdd82b2' } },
                { name: '267', joinPhrase: ' feat. ', artist: null },
                { name: '267', joinPhrase: '', artist: { gid: 'b8ccd64f-e2d5-4097-b5cc-8fa3d468f17f' } }
            ]
        })
    };
    lib.deduplicateACFromObservable(this.track.artistCredit);
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'W/N');
    assert.strictEqual(ac.names[0].artist?.gid, '00a1a122-c3e3-4d65-b28e-ca330fdd82b2');
    assert.strictEqual(ac.names[1].name, '267');
    assert.strictEqual(ac.names[1].artist?.gid, 'b8ccd64f-e2d5-4097-b5cc-8fa3d468f17f');
});

// Case 16
runTestCase('16. Propagating GIDs from track artist credits to release artist credits', () => {
    this.release = {
        artistCredit: makeObservable({
            names: [
                { name: 'W/N', joinPhrase: ' feat. ', artist: { gid: '00a1a122-c3e3-4d65-b28e-ca330fdd82b2' } },
                { name: '267', joinPhrase: '', artist: null }
            ]
        }),
        mediums: makeObservable([
            {
                tracks: makeObservable([
                    {
                        artistCredit: makeObservable({
                            names: [
                                { name: 'W/N', joinPhrase: ' feat. ', artist: { gid: '00a1a122-c3e3-4d65-b28e-ca330fdd82b2' } },
                                { name: '267', joinPhrase: '', artist: { gid: 'b8ccd64f-e2d5-4097-b5cc-8fa3d468f17f' } }
                            ]
                        })
                    }
                ])
            }
        ])
    };
    lib.propagateGidsFromTracksToRelease(this.release);
}, () => {
    const ac = this.release.artistCredit();
    assert.strictEqual(ac.names.length, 2);
    assert.strictEqual(ac.names[0].name, 'W/N');
    assert.strictEqual(ac.names[0].artist?.gid, '00a1a122-c3e3-4d65-b28e-ca330fdd82b2');
    assert.strictEqual(ac.names[1].name, '267');
    assert.strictEqual(ac.names[1].artist?.gid, 'b8ccd64f-e2d5-4097-b5cc-8fa3d468f17f');
});

// Case 17
runTestCase('17. Processing an entire multi-track remix release tracklist and asserting titles', () => {
    const originalCookie = context.document.cookie;
    context.document.cookie = 'guesscase_remove_remixers=true';

    const rawTracklist = [
        {
            originalTitle: 'Kinda Funny - AR/CO Remix',
            names: [
                { name: 'Young Bombs', joinPhrase: ', ', artist: { gid: '5514b719-290b-46f8-a48b-9e9879a1e09b' } },
                { name: 'Audrey Mika', joinPhrase: ' & ', artist: { gid: '00998e69-c399-458e-bc6b-0d7924ac6837' } },
                { name: 'AR/CO', joinPhrase: '', artist: { gid: '1a56c465-f75c-46dc-8c5c-9486de1f53cd' } }
            ]
        },
        {
            originalTitle: 'Kinda Funny - Corvad Remix',
            names: [
                { name: 'Young Bombs', joinPhrase: ', ', artist: { gid: '5514b719-290b-46f8-a48b-9e9879a1e09b' } },
                { name: 'Audrey Mika', joinPhrase: ' & ', artist: { gid: '00998e69-c399-458e-bc6b-0d7924ac6837' } },
                { name: 'Corvad', joinPhrase: '', artist: { gid: '3af04cc2-787b-4a00-addd-5c266691d037' } }
            ]
        },
        {
            originalTitle: 'Kinda Funny - CharlieWonder & TOBER Remix',
            names: [
                { name: 'Young Bombs', joinPhrase: ', ', artist: { gid: '5514b719-290b-46f8-a48b-9e9879a1e09b' } },
                { name: 'Audrey Mika', joinPhrase: ', ', artist: { gid: '00998e69-c399-458e-bc6b-0d7924ac6837' } },
                { name: 'CharlieWonder', joinPhrase: ' & ', artist: { gid: '3ec07a30-5732-4d3f-bec5-cda1bc8d96b7' } },
                { name: 'TOBER', joinPhrase: '', artist: { gid: '0ccc578f-3342-40de-8b6c-1d0ea5930dd4' } }
            ]
        }
    ];

    this.processedTracks = rawTracklist.map((t, idx) => {
        const postNativeTitle = (idx === 2) ? 'Kinda Funny' : t.originalTitle;
        const postNativeNames = (idx === 2)
            ? [
                { name: 'Young Bombs', joinPhrase: ', ', artist: { gid: '5514b719-290b-46f8-a48b-9e9879a1e09b' } },
                { name: 'Audrey Mika', joinPhrase: ', ', artist: { gid: '00998e69-c399-458e-bc6b-0d7924ac6837' } },
                { name: 'CharlieWonder', joinPhrase: ' & ', artist: { gid: '3ec07a30-5732-4d3f-bec5-cda1bc8d96b7' } },
                { name: 'TOBER Remix', joinPhrase: '', artist: null }
            ]
            : t.names;
        return {
            name: makeObservable(postNativeTitle),
            artistCredit: makeObservable({ names: postNativeNames })
        };
    });

    this.processedTracks.forEach((trackModel, idx) => {
        lib.cleanTrackModelAfterGuessFeat(
            trackModel,
            rawTracklist[idx].originalTitle,
            ['Young Bombs', 'Audrey Mika'],
            rawTracklist[idx].names
        );
    });

    context.document.cookie = originalCookie;
}, () => {
    const expectedTitles = [
        'Kinda Funny - AR/CO Remix',
        'Kinda Funny - Corvad Remix',
        'Kinda Funny - CharlieWonder & TOBER Remix'
    ];

    this.processedTracks.forEach((track, idx) => {
        const ac = track.artistCredit();
        const tNum = idx + 1;

        assert.strictEqual(ac.names.length, 2, `Track ${tNum}: Should strip remixers down to exactly 2 artists.`);
        assert.strictEqual(ac.names[0].name, 'Young Bombs');
        assert.strictEqual(ac.names[0].joinPhrase, ' & ');
        assert.strictEqual(ac.names[1].name, 'Audrey Mika');
        assert.strictEqual(ac.names[1].joinPhrase, '', `Track ${tNum}: Final surviving artist join phrase must be empty.`);

        assert.strictEqual(
            track.name(),
            expectedTitles[idx],
            `Track ${tNum}: Title should preserve the remix suffix context unchanged during the artist text separation loop.`
        );
    });
});

// Case 18
runTestCase('18. CamelCase word preservation in applyAdvancedRules', () => {
    const originalCookie = context.document.cookie;
    context.document.cookie = 'guesscase_keepuppercase=true';

    const inputTitle = 'Kinda Funny (CharlieWonder & TOBER Remix)';
    const postNativeTitle = 'Kinda Funny (Charliewonder & TOBER Remix)';

    this.res = lib.applyAdvancedRules(postNativeTitle, null, inputTitle);

    context.document.cookie = originalCookie;
}, () => {
    assert.strictEqual(this.res, 'Kinda Funny (CharlieWonder & TOBER Remix)');
});

// Case 19
runTestCase('19. Preserving existing credit casing/spelling over parsed title casing (sandbag Case)', () => {
    this.track = {
        name: makeObservable('sandbag'),
        artistCredit: makeObservable({
            names: [
                { name: 'Dada', joinPhrase: ', ', artist: { gid: '1273ffd9-cf4a-4b57-90b0-4ba902322213' } },
                { name: 'Kasane Teto', joinPhrase: ' & ', artist: { gid: '98f7cec1-3be2-4ccf-97a9-3dbb001700b4' } },
                { name: 'Una Otomachi', joinPhrase: '', artist: { gid: '2517c541-8c87-473a-945b-cd9e2466ecee' } },
                { name: 'KASANE TETO', joinPhrase: ' & ', artist: null },
                { name: 'Una Otomachi', joinPhrase: '', artist: null }
            ]
        })
    };
    lib.cleanTrackModelAfterGuessFeat(
        this.track,
        'sandbag (feat. KASANE TETO & Una Otomachi)',
        ['Dada']
    );
}, () => {
    const ac = this.track.artistCredit();
    assert.strictEqual(this.track.name(), 'sandbag');
    assert.strictEqual(ac.names.length, 3);
    assert.strictEqual(ac.names[0].name, 'Dada');
    assert.strictEqual(ac.names[0].joinPhrase, ', ');
    assert.strictEqual(ac.names[1].name, 'Kasane Teto');
    assert.strictEqual(ac.names[1].joinPhrase, ' & ');
    assert.strictEqual(ac.names[2].name, 'Una Otomachi');
    assert.strictEqual(ac.names[2].joinPhrase, '');
});

// Case 20
runTestCase('20. Integration Smoke Test: enhanceReleaseGuessFeat executes without ReferenceErrors', () => {
    const originalSetTimeout = context.setTimeout;

    let setTimeoutCallback = null;
    context.setTimeout = (cb, ms) => {
        setTimeoutCallback = cb;
    };

    context.window.MB = {
        getSourceEntityInstance: () => ({
            artistCredit: makeObservable({
                names: [{ name: 'Klang der Nudel & Ultra Raphi', joinPhrase: '', artist: null }]
            }),
            name: makeObservable('Autismus Anthem - Klang der Nudel & Kamimane (musikvideo)')
        })
    };

    const mockInput = {
        value: 'Autismus Anthem - Klang der Nudel & Kamimane (musikvideo)',
        name: 'edit-recording.name',
        dispatchEvent: () => { }
    };

    const mockButton = {
        dataset: {},
        closest: (selector) => {
            if (selector === 'tr.track') return null;
            return {
                querySelector: () => mockInput
            };
        },
        addEventListener: function (event, callback) {
            this.clickCallback = callback;
        }
    };

    lib.enhanceReleaseGuessFeat(mockButton);
    assert.strictEqual(typeof mockButton.clickCallback, 'function');

    mockButton.clickCallback({
        stopImmediatePropagation: () => { }
    });

    assert.strictEqual(typeof setTimeoutCallback, 'function');
    setTimeoutCallback();

    context.setTimeout = originalSetTimeout;
    delete context.window.MB;
}, () => {
    // Passed if no exceptions thrown
});

// Case 21
runTestCase('21. Seeded unlinked URL artists with blank entity placeholders (Mayanari Case)', () => {
    this.recordingModel = {
        name: makeObservable('Mayanari - I Should Kill Myself'),
        artistCredit: makeObservable({
            names: [
                {
                    name: 'Mayanari',
                    joinPhrase: '',
                    artist: {
                        id: '',
                        gid: '',
                        name: '',
                        sort_name: '',
                        entityType: 'artist'
                    }
                }
            ]
        })
    };

    lib.cleanEntityModel({
        model: this.recordingModel,
        originalTitle: 'Mayanari - I Should Kill Myself',
        originalArtists: ['Mayanari']
    });
}, () => {
    const ac = this.recordingModel.artistCredit();
    assert.strictEqual(ac.names.length, 1, 'Should keep the single primary artist credit entry.');
    assert.strictEqual(ac.names[0].name, 'Mayanari', 'Should preserve the exact unlinked text name.');
    assert.strictEqual(this.recordingModel.name(), 'I Should Kill Myself', 'Should isolate track title text completely.');
});

console.log('\n--- Scenario B: Knockout Observable is Unavailable (DOM Fallback) ---');

console.log(`\nTest Suite Complete: ${green(passedTestsCount)} passed, ${red(failedTestsCount)} failed.`);
process.exit(failedTestsCount > 0 ? 1 : 0);