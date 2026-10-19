const assert = require('assert');

// Mock DOM & window
function mockWindow() {
    return {
        MB: {
            relationshipEditor: {
                dispatch: () => {},
                state: {
                    relationshipsBySource: new Map()
                }
            },
            tree: {
                iterate: function* (iterable) {
                    if (iterable instanceof Map) {
                        yield* iterable.entries();
                    } else if (Array.isArray(iterable)) {
                        yield* iterable;
                    }
                }
            }
        }
    };
}

function resolveTarget(rel, source) {
    if (rel.target) return rel.target;
    if (!rel.entity0 || !rel.entity1) return null;
    if (rel.entity0.id !== source.id) return rel.entity0;
    if (rel.entity1.id !== source.id) return rel.entity1;
    return rel.entity1;
}

function isEditorReady(root, win) {
    if (!root) return false;
    if (typeof win.MB?.relationshipEditor?.dispatch === 'function') {
        return true;
    }
    return Object.keys(root).some((key) =>
        (key.startsWith('_reactListening') || key.startsWith('__reactFiber')) && root[key]
    );
}

function filterCandidates(candidates, { masterLinkTypeId, masterTargetGid, matchType, matchTarget, masterSource }) {
    return candidates.filter(({ rel, source }) => {
        const targetEntity = resolveTarget(rel, source);
        if (!targetEntity || !targetEntity.gid) return false;

        let isMatch = true;
        if (matchType && rel.linkTypeID !== masterLinkTypeId) isMatch = false;
        if (matchTarget && targetEntity.gid !== masterTargetGid) isMatch = false;
        return isMatch;
    });
}

function determineActions(relsToToggle) {
    const areAllRemoved = relsToToggle.every(({ rel }) => rel._status === 3);
    const actions = [];
    relsToToggle.forEach(({ rel }) => {
        const isRemoved = (rel._status === 3);
        const shouldAct = areAllRemoved ? isRemoved : !isRemoved;
        if (shouldAct) {
            actions.push({
                type: 'remove-relationship',
                relationshipId: rel.id,
                action: areAllRemoved ? 'restore' : 'remove'
            });
        }
    });
    return { areAllRemoved, actions };
}

// === RUN TESTS ===

console.log('Test 1: resolveTarget');
{
    const source = { id: 100, entityType: 'event' };
    const targetA = { id: 200, gid: 'artist-gid-1', name: 'Artist A' };
    const targetB = { id: 300, gid: 'artist-gid-2', name: 'Artist B' };

    // entity0 is source, entity1 is target
    assert.strictEqual(resolveTarget({ entity0: source, entity1: targetA }, source), targetA);
    // entity1 is source, entity0 is target
    assert.strictEqual(resolveTarget({ entity0: targetB, entity1: source }, source), targetB);
    // Explicit target property
    assert.strictEqual(resolveTarget({ target: targetA, entity0: source, entity1: targetB }, source), targetA);
    // Self-link
    assert.strictEqual(resolveTarget({ entity0: source, entity1: source }, source), source);
    // Malformed
    assert.strictEqual(resolveTarget({}, source), null);
    console.log('✓ resolveTarget passed');
}

console.log('Test 2: isEditorReady');
{
    const win = mockWindow();
    // Dispatch is present in window.MB
    assert.strictEqual(isEditorReady({}, win), true);

    // No MB.relationshipEditor.dispatch, but root has _reactListening
    const winNoDispatch = { MB: {} };
    assert.strictEqual(isEditorReady({ _reactListening123: true }, winNoDispatch), true);

    // No MB.relationshipEditor.dispatch, but root has __reactFiber
    assert.strictEqual(isEditorReady({ __reactFiber$abc: {} }, winNoDispatch), true);

    // Not ready
    assert.strictEqual(isEditorReady({}, winNoDispatch), false);
    assert.strictEqual(isEditorReady(null, winNoDispatch), false);
    console.log('✓ isEditorReady passed');
}

console.log('Test 3: filterCandidates & toggle actions');
{
    const source = { id: 4779, entityType: 'event' };
    const candidates = [
        // Main performers (linkTypeID: 798)
        { rel: { id: 1, linkTypeID: 798, entity0: { id: 813, gid: 'artist-e-street', name: 'E Street' }, entity1: source, _status: 0 }, source },
        { rel: { id: 2, linkTypeID: 798, entity0: { id: 1240195, gid: 'artist-springsteen', name: 'Springsteen' }, entity1: source, _status: 0 }, source },
        // Held at (linkTypeID: 794)
        { rel: { id: 3, linkTypeID: 794, entity0: { id: 4413, gid: 'place-roxy', name: 'The Roxy' }, entity1: source, _status: 0 }, source },
    ];

    // Case A: Shift+Click on E Street Band (Same Type)
    const shiftMatches = filterCandidates(candidates, {
        masterLinkTypeId: 798,
        masterTargetGid: 'artist-e-street',
        matchType: true,
        matchTarget: false,
        masterSource: source
    });
    assert.strictEqual(shiftMatches.length, 2);
    assert.deepStrictEqual(shiftMatches.map(m => m.rel.id), [1, 2]);

    const { areAllRemoved: allRemA, actions: actA } = determineActions(shiftMatches);
    assert.strictEqual(allRemA, false);
    assert.strictEqual(actA.length, 2);
    assert.strictEqual(actA[0].action, 'remove');
    assert.strictEqual(actA[1].action, 'remove');

    // Case B: Both removed -> Shift+Click restores both
    shiftMatches.forEach(m => m.rel._status = 3);
    const { areAllRemoved: allRemB, actions: actB } = determineActions(shiftMatches);
    assert.strictEqual(allRemB, true);
    assert.strictEqual(actB.length, 2);
    assert.strictEqual(actB[0].action, 'restore');
    assert.strictEqual(actB[1].action, 'restore');

    // Case C: Ctrl+Click (Same Target)
    const ctrlMatches = filterCandidates(candidates, {
        masterLinkTypeId: 798,
        masterTargetGid: 'artist-springsteen',
        matchType: false,
        matchTarget: true,
        masterSource: source
    });
    assert.strictEqual(ctrlMatches.length, 1);
    assert.strictEqual(ctrlMatches[0].rel.id, 2);

    console.log('✓ filterCandidates & toggle actions passed');
}

console.log('\nAll unit tests passed successfully!');
