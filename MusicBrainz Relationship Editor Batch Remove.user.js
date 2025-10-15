// ==UserScript==
// @name         MusicBrainz: Relationship Editor Batch Remove
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.1
// @description  Adds a toggle to batch remove/restore relationships of the same type and entity by Ctrl-clicking the remove button.
// @tag          ai-created
// @author       chaban
// @license      MIT
// @match        *://*.musicbrainz.org/release/*/edit-relationships
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        none
// @run-at       document-idle
// ==/UserScript==

'use strict';

// --- CONFIGURATION ---
// Set this to true to enable detailed logging in the developer console (F12)
const DEBUG = false;
// ---------------------

const SCRIPT_NAME = 'MusicBrainz: Relationship Editor Batch Remove';

/**
 * Injects CSS for visual feedback when Ctrl is pressed.
 */
function addGlobalStyle() {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = `
        body.ctrl-is-down .rel-editor-table .remove-item {
            background-color: #ffc !important;
            outline: 2px solid #cc0;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Toggles a class on the body based on the Ctrl key's state.
 * @param {KeyboardEvent} event
 */
function toggleCtrlClass(event) {
    if (event.key === 'Control') {
        document.body.classList.toggle('ctrl-is-down', event.type === 'keydown');
    }
}

/**
 * Creates a readable summary of a MusicBrainz entity.
 * @param {object} entity The entity object from the editor state.
 * @returns {string} A formatted string summary.
 */
function formatEntity(entity) {
    if (!entity) return '[No Entity]';
    return `(${entity.entityType}) "${entity.name}" [ID: ${entity.id}]`;
}

/**
 * Main handler for the batch toggle logic.
 * @param {MouseEvent} event The click event.
 */
function handleBatchToggle(event) {
    if (!event.ctrlKey || !event.target.matches('.icon.remove-item')) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const { relationshipEditor, tree: wbt, linkedEntities } = MB;
    const relationshipId = parseInt(event.target.id.split('-').pop(), 10);

    if (DEBUG) console.group(`--- ${SCRIPT_NAME} ---`);

    if (isNaN(relationshipId)) {
        if (DEBUG) {
            console.error('Could not parse relationship ID from button:', event.target);
            console.groupEnd();
        }
        return;
    }

    if (DEBUG) {
        console.log('Clicked Element:', event.target);
        console.log(`Parsed Relationship ID: ${relationshipId}`);
    }

    const relationshipsByType = new Map();
    let masterRel = null;

    for (const [source, targetTypeGroups] of wbt.iterate(relationshipEditor.state.relationshipsBySource)) {
        for (const [, linkTypeGroups] of wbt.iterate(targetTypeGroups)) {
            for (const linkTypeGroup of wbt.iterate(linkTypeGroups)) {
                for (const phraseGroup of wbt.iterate(linkTypeGroup.phraseGroups)) {
                    for (const rel of wbt.iterate(phraseGroup.relationships)) {
                        if (rel.id === relationshipId) masterRel = rel;
                        if (!relationshipsByType.has(rel.linkTypeID)) {
                            relationshipsByType.set(rel.linkTypeID, []);
                        }
                        relationshipsByType.get(rel.linkTypeID).push({ rel, source });
                    }
                }
            }
        }
    }

    if (!masterRel) {
        if (DEBUG) {
            console.error('Could not find the clicked relationship in the editor state.');
            console.groupEnd();
        }
        return;
    }

    const masterLinkTypeId = masterRel.linkTypeID;
    const allRelsOfMasterType = relationshipsByType.get(masterLinkTypeId) || [];
    const masterItem = allRelsOfMasterType.find(({ rel }) => rel.id === relationshipId);

    // The grouping entity is the one that is NOT a recording or a work.
    let groupingEntity;
    if (masterItem.source.entityType !== 'recording' && masterItem.source.entityType !== 'work') {
        groupingEntity = masterItem.source;
    } else {
        groupingEntity = masterItem.rel.entity0.id === masterItem.source.id ? masterItem.rel.entity1 : masterItem.rel.entity0;
    }
    const groupingEntityId = groupingEntity.id;

    // Filter the group to only include relationships with the same external entity.
    const relsToToggle = allRelsOfMasterType.filter(({ rel }) => {
        return rel.entity0.id === groupingEntityId || rel.entity1.id === groupingEntityId;
    });

    if (DEBUG) {
        const linkTypeInfo = linkedEntities.link_type[masterLinkTypeId];
        console.group('Master Relationship Info');
        console.log(`Link Type: "${linkTypeInfo.name}" (ID: ${masterLinkTypeId})`);
        console.log('Grouping Entity:', formatEntity(groupingEntity));
        console.log('Full Relationship Object:');
        console.dir(masterRel);
        console.groupEnd();
        console.group(`Filtered Group: Found ${relsToToggle.length} relationships matching the target entity`);
        relsToToggle.forEach(({ rel, source }, index) => {
            const target = rel.entity0.id === source.id ? rel.entity1 : rel.entity0;
            console.log(`${index + 1}. Rel ID: ${rel.id}, Source: ${formatEntity(source)}, Target: ${formatEntity(target)}`);
        });
        console.groupEnd();
    }

    const areAllInGroupRemoved = relsToToggle.every(({ rel }) => rel._status === 3);

    if (areAllInGroupRemoved) {
        // Action: RESTORE the filtered group.
        for (const { rel } of relsToToggle) {
            if (rel._status === 3) {
                relationshipEditor.dispatch({ type: 'remove-relationship', relationship: rel });
            }
        }
    } else {
        // Action: REMOVE the filtered group.
        for (const { rel } of relsToToggle) {
            if (rel._status !== 3) {
                relationshipEditor.dispatch({ type: 'remove-relationship', relationship: rel });
            }
        }
    }

    if (DEBUG) console.groupEnd();
}

/**
 * Sets up the script's features once the MusicBrainz React app is ready.
 */
function setup() {
    addGlobalStyle();
    document.addEventListener('keydown', toggleCtrlClass);
    document.addEventListener('keyup', toggleCtrlClass);
    window.addEventListener('blur', () => document.body.classList.remove('ctrl-is-down'));
    document.getElementById('content').addEventListener('click', handleBatchToggle, true);
}

// Wait for the MB relationship editor to be fully initialized.
const initInterval = setInterval(() => {
    if (Object.keys((window.MB?.linkedEntities?.link_type_tree) ?? {}).length) {
        clearInterval(initInterval);
        setup();
    }
}, 250);