// ==UserScript==
// @name         Bookmarklet Toolbar Core
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Pure domain logic for Site Bookmarklet Toolbar.
// @author       chaban
// @license      MIT
// ==/UserScript==

const BookmarkletToolbarCore = (() => {
    'use strict';

    const STORAGE_KEYS = Object.freeze({
        localScripts: 'UserJS.BookmarkletToolbar.LocalScripts',
        layout: 'UserJS.BookmarkletToolbar.Layout',
        recents: 'UserJS.BookmarkletToolbar.Recents',
        settings: 'UserJS.BookmarkletToolbar.Settings',
        packKey(packId) {
            if (typeof packId !== 'string' || !packId.trim()) {
                throw new Error('packId must be a non-empty string');
            }
            return `UserJS.BookmarkletToolbar.Pack.${packId.trim()}`;
        },
    });

    const HOST_CHARS_RE = /^[a-z0-9.-]+(?::\d+)?$/i;
    const MATCH_PATTERN_RE = /^(\*|https?):\/\/([^/]+)(\/.*)$/i;
    const MODIFIER_ONLY_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS']);
    const DOCK_SNAP_ZONES = Object.freeze([
        'top-left',
        'top-center',
        'top-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
    ]);
    const DOCK_EXPAND_MODES = Object.freeze(['both', 'click', 'hover']);

    function isValidHostSegment(host) {
        if (!host || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
            return false;
        }
        return HOST_CHARS_RE.test(host);
    }

    function parseMatchPattern(pattern) {
        if (typeof pattern !== 'string') {
            return null;
        }
        const trimmed = pattern.trim();
        if (!trimmed) {
            return null;
        }
        if (trimmed === '<all_urls>') {
            return { allUrls: true };
        }
        const match = trimmed.match(MATCH_PATTERN_RE);
        if (!match) {
            return null;
        }
        const scheme = match[1].toLowerCase();
        const hostPattern = match[2].toLowerCase();
        const pathPattern = match[3];

        let hostMode = 'exact';
        let baseHost = hostPattern;
        if (hostPattern === '*') {
            hostMode = 'any';
            baseHost = '*';
        } else if (hostPattern.startsWith('*.')) {
            hostMode = 'subdomain';
            baseHost = hostPattern.slice(2);
            if (!isValidHostSegment(baseHost)) {
                return null;
            }
        } else {
            if (hostPattern.includes('*') || !isValidHostSegment(hostPattern)) {
                return null;
            }
        }

        const escapedPath = pathPattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');

        return {
            allUrls: false,
            scheme,
            hostMode,
            baseHost,
            hasPort: baseHost.includes(':'),
            includeHash: pathPattern.includes('#'),
            pathRegex: new RegExp(`^${escapedPath}$`),
        };
    }

    function isValidMatchPattern(pattern) {
        return parseMatchPattern(pattern) !== null;
    }

    function matchPattern(pattern, url) {
        const parsed = parseMatchPattern(pattern);
        if (!parsed || typeof url !== 'string' || !url) {
            return false;
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch {
            return false;
        }

        const protocol = parsedUrl.protocol.toLowerCase();
        if (protocol !== 'http:' && protocol !== 'https:') {
            return false;
        }

        if (parsed.allUrls) {
            return true;
        }

        if (parsed.scheme !== '*' && protocol !== `${parsed.scheme}:`) {
            return false;
        }

        const targetHost = (parsed.hasPort ? parsedUrl.host : parsedUrl.hostname).toLowerCase();
        if (!targetHost) {
            return false;
        }

        if (parsed.hostMode === 'exact') {
            if (targetHost !== parsed.baseHost) {
                return false;
            }
        } else if (parsed.hostMode === 'subdomain') {
            if (targetHost !== parsed.baseHost && !targetHost.endsWith(`.${parsed.baseHost}`)) {
                return false;
            }
        }

        const targetPath =
            (parsedUrl.pathname || '/') +
            (parsedUrl.search || '') +
            (parsed.includeHash ? parsedUrl.hash || '' : '');

        return parsed.pathRegex.test(targetPath);
    }

    function scriptMatchesUrl(script, url) {
        if (!script || !Array.isArray(script.match) || script.match.length === 0) {
            return false;
        }
        return script.match.some((pattern) => matchPattern(pattern, url));
    }

    function getNodeScriptId(node) {
        if (!node || typeof node !== 'object') {
            return '';
        }
        if (typeof node.scriptId === 'string' && node.scriptId.trim()) {
            return node.scriptId.trim();
        }
        if (typeof node.id === 'string' && node.id.trim()) {
            return node.id.trim();
        }
        return '';
    }

    function createScriptLayoutNode(scriptId, label) {
        const node = {
            type: 'script',
            scriptId,
        };
        if (typeof label === 'string' && label.trim() !== '') {
            node.label = label.trim();
        }
        Object.defineProperty(node, 'id', {
            get() {
                return this.scriptId;
            },
            enumerable: false,
            configurable: true,
        });
        return node;
    }

    function cloneScriptNode(node) {
        const scriptId = getNodeScriptId(node);
        return createScriptLayoutNode(scriptId, node?.label);
    }

    function cloneLayout(layout) {
        if (!Array.isArray(layout)) {
            return [];
        }
        return layout
            .filter((node) => node && typeof node === 'object')
            .map((node) => {
                if (node.type === 'folder') {
                    return {
                        type: 'folder',
                        id: String(node.id || ''),
                        name: String(node.name || ''),
                        items: Array.isArray(node.items)
                            ? node.items
                                  .filter((it) => it && typeof it === 'object')
                                  .map(cloneScriptNode)
                            : [],
                    };
                }
                return cloneScriptNode(node);
            });
    }

    function collectPlacedScriptIds(layout) {
        const placed = new Set();
        if (!Array.isArray(layout)) {
            return placed;
        }
        for (const node of layout) {
            if (!node || typeof node !== 'object') {
                continue;
            }
            if (node.type === 'script') {
                const sid = getNodeScriptId(node);
                if (sid) {
                    placed.add(sid);
                }
            } else if (node.type === 'folder' && Array.isArray(node.items)) {
                for (const item of node.items) {
                    const sid = getNodeScriptId(item);
                    if (sid) {
                        placed.add(sid);
                    }
                }
            }
        }
        return placed;
    }

    function hasScriptChanged(prev, next) {
        if (!prev) {
            return true;
        }
        if (Boolean(prev.removed) !== Boolean(next.removed)) {
            return true;
        }
        if (
            prev.name !== next.name ||
            (prev.label || '') !== (next.label || '') ||
            (prev.description || '') !== (next.description || '') ||
            (prev.folder || '') !== (next.folder || '') ||
            prev.code !== next.code
        ) {
            return true;
        }
        const prevMatch = Array.isArray(prev.match) ? prev.match : [];
        const nextMatch = Array.isArray(next.match) ? next.match : [];
        if (prevMatch.length !== nextMatch.length) {
            return true;
        }
        for (let i = 0; i < nextMatch.length; i += 1) {
            if (prevMatch[i] !== nextMatch[i]) {
                return true;
            }
        }
        return false;
    }

    function syncPackCache(cachedPack, bundledPack, layout = []) {
        if (!bundledPack || typeof bundledPack !== 'object' || !bundledPack.id) {
            throw new Error('bundledPack must be a valid pack object with id');
        }

        if (
            cachedPack &&
            typeof cachedPack === 'object' &&
            cachedPack.version === bundledPack.version &&
            cachedPack.scripts &&
            typeof cachedPack.scripts === 'object'
        ) {
            return {
                packCache: cachedPack,
                changed: false,
                stats: {
                    added: 0,
                    updated: 0,
                    removedFlagged: 0,
                    removedDropped: 0,
                },
            };
        }

        const prevScripts =
            cachedPack && cachedPack.scripts && typeof cachedPack.scripts === 'object'
                ? cachedPack.scripts
                : {};
        const placedIds = collectPlacedScriptIds(layout);
        const nextScripts = {};
        const stats = {
            added: 0,
            updated: 0,
            removedFlagged: 0,
            removedDropped: 0,
        };

        const packId = bundledPack.id;
        const prefix = `pack:${packId}/`;
        const bundledList = Array.isArray(bundledPack.scripts) ? bundledPack.scripts : [];

        for (const raw of bundledList) {
            if (!raw || typeof raw !== 'object' || !raw.id) {
                continue;
            }
            const fullId = String(raw.id).startsWith('pack:') ? String(raw.id) : `${prefix}${raw.id}`;
            const nextEntry = {
                id: fullId,
                packId,
                source: `pack:${packId}`,
                name: String(raw.name || raw.id),
                description: typeof raw.description === 'string' ? raw.description : '',
                match: Array.isArray(raw.match) ? [...raw.match] : [],
                code: String(raw.code || ''),
                removed: false,
            };
            if (typeof raw.label === 'string' && raw.label.trim()) {
                nextEntry.label = raw.label.trim();
            }
            if (typeof raw.folder === 'string' && raw.folder.trim()) {
                nextEntry.folder = raw.folder.trim();
            }

            const prevEntry = prevScripts[fullId];
            if (!prevEntry) {
                stats.added += 1;
            } else if (hasScriptChanged(prevEntry, nextEntry)) {
                stats.updated += 1;
            }

            nextScripts[fullId] = nextEntry;
        }

        for (const [oldId, oldEntry] of Object.entries(prevScripts)) {
            if (oldId in nextScripts) {
                continue;
            }
            if (placedIds.has(oldId)) {
                nextScripts[oldId] = {
                    ...oldEntry,
                    id: oldId,
                    packId: oldEntry.packId || packId,
                    source: oldEntry.source || `pack:${packId}`,
                    match: Array.isArray(oldEntry.match) ? [...oldEntry.match] : [],
                    removed: true,
                };
                stats.removedFlagged += 1;
            } else {
                stats.removedDropped += 1;
            }
        }

        const packCache = {
            id: packId,
            name: String(bundledPack.name || packId),
            version: String(bundledPack.version || ''),
            description: typeof bundledPack.description === 'string' ? bundledPack.description : '',
            homepage: typeof bundledPack.homepage === 'string' ? bundledPack.homepage : '',
            scripts: nextScripts,
        };

        return {
            packCache,
            changed: true,
            stats,
        };
    }

    function buildScriptsMap(packsById, localScripts) {
        const map = {};

        const packList = [];
        if (Array.isArray(packsById)) {
            packList.push(...packsById);
        } else if (packsById && typeof packsById === 'object') {
            if (packsById.scripts && typeof packsById.scripts === 'object' && typeof packsById.id === 'string') {
                packList.push(packsById);
            } else {
                packList.push(...Object.values(packsById));
            }
        }

        for (const pack of packList) {
            if (!pack || typeof pack !== 'object' || !pack.scripts) {
                continue;
            }
            const entries = Array.isArray(pack.scripts)
                ? pack.scripts.map((s) => [s?.id, s])
                : Object.entries(pack.scripts);
            for (const [key, script] of entries) {
                if (!script || typeof script !== 'object') {
                    continue;
                }
                const id = script.id || key;
                if (!id) {
                    continue;
                }
                map[id] = {
                    ...script,
                    id,
                    packId: script.packId || pack.id,
                    source: script.source || (pack.id ? `pack:${pack.id}` : 'pack'),
                    match: Array.isArray(script.match) ? [...script.match] : [],
                    removed: Boolean(script.removed),
                };
            }
        }

        if (localScripts && typeof localScripts === 'object') {
            const localEntries = Array.isArray(localScripts)
                ? localScripts.map((s) => [s?.id, s])
                : Object.entries(localScripts);
            for (const [key, script] of localEntries) {
                if (!script || typeof script !== 'object') {
                    continue;
                }
                const id = script.id || key;
                if (!id) {
                    continue;
                }
                const entry = {
                    ...script,
                    id,
                    source: 'local',
                    match: Array.isArray(script.match) ? [...script.match] : [],
                };
                delete entry.removed;
                map[id] = entry;
            }
        }

        return map;
    }

    function resolveDisplayLabel(node, script) {
        if (node && typeof node.label === 'string' && node.label.trim()) {
            return node.label.trim();
        }
        if (script && typeof script.label === 'string' && script.label.trim()) {
            return script.label.trim();
        }
        return script && typeof script.name === 'string' ? script.name : '';
    }

    function getVisibleLayoutForUrl(layout, scriptsMap, url) {
        if (!Array.isArray(layout) || !scriptsMap || typeof scriptsMap !== 'object' || !url) {
            return [];
        }
        const visible = [];

        for (const node of layout) {
            if (!node || typeof node !== 'object') {
                continue;
            }
            if (node.type === 'script') {
                const sid = getNodeScriptId(node);
                const script = scriptsMap[sid];
                if (!script || !scriptMatchesUrl(script, url)) {
                    continue;
                }
                const visibleNode = {
                    type: 'script',
                    scriptId: sid,
                    id: sid,
                    displayLabel: resolveDisplayLabel(node, script),
                    script,
                    removed: Boolean(script.removed),
                };
                if (typeof node.label === 'string' && node.label.trim()) {
                    visibleNode.label = node.label.trim();
                }
                visible.push(visibleNode);
            } else if (node.type === 'folder' && Array.isArray(node.items)) {
                const visibleItems = [];
                for (const item of node.items) {
                    const sid = getNodeScriptId(item);
                    const script = scriptsMap[sid];
                    if (!script || !scriptMatchesUrl(script, url)) {
                        continue;
                    }
                    const visibleItem = {
                        type: 'script',
                        scriptId: sid,
                        id: sid,
                        displayLabel: resolveDisplayLabel(item, script),
                        script,
                        removed: Boolean(script.removed),
                    };
                    if (typeof item.label === 'string' && item.label.trim()) {
                        visibleItem.label = item.label.trim();
                    }
                    visibleItems.push(visibleItem);
                }
                if (visibleItems.length > 0) {
                    visible.push({
                        type: 'folder',
                        id: node.id,
                        name: node.name,
                        items: visibleItems,
                        hasRemoved: visibleItems.some((it) => it.removed),
                    });
                }
            }
        }

        return visible;
    }

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function getSiteOrigin(url) {
        if (typeof url !== 'string' || !url.trim()) {
            return '';
        }
        try {
            const parsed = new URL(url.trim());
            if (
                (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
                !parsed.origin ||
                parsed.origin === 'null'
            ) {
                return '';
            }
            return parsed.origin;
        } catch {
            return '';
        }
    }

    function normalizeOriginMap(rawMap, isValidValue) {
        const normalized = {};
        if (!isPlainObject(rawMap)) {
            return normalized;
        }
        for (const [key, value] of Object.entries(rawMap)) {
            const origin = getSiteOrigin(key);
            if (origin && isValidValue(value)) {
                normalized[origin] = value;
            }
        }
        return normalized;
    }

    function normalizeSettings(raw) {
        const source = isPlainObject(raw) ? raw : {};
        const hotkey =
            typeof source.hotkey === 'string' && source.hotkey.trim()
                ? source.hotkey.trim()
                : 'Alt+B';
        const dockExpandMode = DOCK_EXPAND_MODES.includes(source.dockExpandMode)
            ? source.dockExpandMode
            : 'both';
        const isBoolean = (value) => typeof value === 'boolean';
        return {
            ...source,
            hotkey,
            dockExpandMode,
            dockSitePositions: normalizeOriginMap(source.dockSitePositions, (zone) =>
                DOCK_SNAP_ZONES.includes(zone)
            ),
            dockSiteExpanded: normalizeOriginMap(source.dockSiteExpanded, isBoolean),
            dockSiteHidden: normalizeOriginMap(source.dockSiteHidden, isBoolean),
        };
    }

    function shouldMountToolbar(layout, scriptsMap, url, settings = null) {
        const origin = getSiteOrigin(url);
        if (origin && settings?.dockSiteHidden?.[origin] === true) {
            return false;
        }
        return getVisibleLayoutForUrl(layout, scriptsMap, url).length > 0;
    }

    function hasRemovedPlacedScript(layout, scriptsMap) {
        if (!Array.isArray(layout) || !scriptsMap || typeof scriptsMap !== 'object') {
            return false;
        }
        for (const sid of collectPlacedScriptIds(layout)) {
            if (scriptsMap[sid]?.removed === true) {
                return true;
            }
        }
        return false;
    }

    function getPlacement(layout, scriptId) {
        if (!Array.isArray(layout) || typeof scriptId !== 'string' || !scriptId) {
            return null;
        }
        for (let i = 0; i < layout.length; i += 1) {
            const node = layout[i];
            if (!node || typeof node !== 'object') {
                continue;
            }
            if (node.type === 'script' && getNodeScriptId(node) === scriptId) {
                const placement = {
                    kind: 'toolbar',
                    index: i,
                    scriptId,
                };
                if (typeof node.label === 'string' && node.label.trim()) {
                    placement.label = node.label.trim();
                }
                return placement;
            }
            if (node.type === 'folder' && Array.isArray(node.items)) {
                for (let j = 0; j < node.items.length; j += 1) {
                    const item = node.items[j];
                    if (getNodeScriptId(item) === scriptId) {
                        const placement = {
                            kind: 'folder',
                            index: j,
                            folderId: node.id,
                            folderName: node.name,
                            scriptId,
                        };
                        if (typeof item.label === 'string' && item.label.trim()) {
                            placement.label = item.label.trim();
                        }
                        return placement;
                    }
                }
            }
        }
        return null;
    }

    function extractScriptFromMutableLayout(mutableLayout, scriptId) {
        let removedFromRootIdx = -1;
        let removedFromFolderId = null;
        let removedFromFolderIdx = -1;
        let preservedLabel;

        for (let i = mutableLayout.length - 1; i >= 0; i -= 1) {
            const node = mutableLayout[i];
            if (node.type === 'script' && getNodeScriptId(node) === scriptId) {
                if (preservedLabel === undefined && node.label) {
                    preservedLabel = node.label;
                }
                removedFromRootIdx = i;
                mutableLayout.splice(i, 1);
            } else if (node.type === 'folder' && Array.isArray(node.items)) {
                for (let j = node.items.length - 1; j >= 0; j -= 1) {
                    const item = node.items[j];
                    if (getNodeScriptId(item) === scriptId) {
                        if (preservedLabel === undefined && item.label) {
                            preservedLabel = item.label;
                        }
                        removedFromFolderId = node.id;
                        removedFromFolderIdx = j;
                        node.items.splice(j, 1);
                    }
                }
            }
        }

        return {
            removedFromRootIdx,
            removedFromFolderId,
            removedFromFolderIdx,
            preservedLabel,
        };
    }

    function toggleToolbarPin(layout, scriptId) {
        const next = cloneLayout(layout);
        if (typeof scriptId !== 'string' || !scriptId) {
            return next;
        }
        const rootIdx = next.findIndex(
            (node) => node.type === 'script' && getNodeScriptId(node) === scriptId
        );
        if (rootIdx !== -1) {
            next.splice(rootIdx, 1);
            return next;
        }

        const { preservedLabel } = extractScriptFromMutableLayout(next, scriptId);
        const newNode = createScriptLayoutNode(scriptId, preservedLabel);
        const firstFolderIdx = next.findIndex((node) => node.type === 'folder');
        if (firstFolderIdx === -1) {
            next.push(newNode);
        } else {
            next.splice(firstFolderIdx, 0, newNode);
        }
        return next;
    }

    function placeScriptOnToolbarAt(layout, scriptId, targetIdx) {
        const next = cloneLayout(layout);
        if (typeof scriptId !== 'string' || !scriptId) {
            return next;
        }
        const { removedFromRootIdx, preservedLabel } = extractScriptFromMutableLayout(next, scriptId);
        const newNode = createScriptLayoutNode(scriptId, preservedLabel);

        let insertIdx = typeof targetIdx === 'number' && !Number.isNaN(targetIdx) ? targetIdx : next.length;
        if (removedFromRootIdx !== -1 && removedFromRootIdx < insertIdx) {
            insertIdx -= 1;
        }
        const clampedIdx = Math.max(0, Math.min(next.length, insertIdx));
        next.splice(clampedIdx, 0, newNode);
        return next;
    }

    function moveToolbarNode(layout, fromIdx, toIdx) {
        const next = cloneLayout(layout);
        if (
            typeof fromIdx !== 'number' ||
            typeof toIdx !== 'number' ||
            fromIdx < 0 ||
            fromIdx >= next.length
        ) {
            return next;
        }
        const [moved] = next.splice(fromIdx, 1);
        let insertIdx = toIdx;
        if (fromIdx < toIdx) {
            insertIdx -= 1;
        }
        const clampedIdx = Math.max(0, Math.min(next.length, insertIdx));
        next.splice(clampedIdx, 0, moved);
        return next;
    }

    function moveScriptToFolder(layout, scriptId, folderId, targetIdx = null) {
        const next = cloneLayout(layout);
        if (typeof scriptId !== 'string' || !scriptId || typeof folderId !== 'string' || !folderId) {
            return next;
        }
        const targetFolderExists = next.some((n) => n.type === 'folder' && n.id === folderId);
        if (!targetFolderExists) {
            return next;
        }

        const { removedFromFolderId, removedFromFolderIdx, preservedLabel } =
            extractScriptFromMutableLayout(next, scriptId);

        const folder = next.find((n) => n.type === 'folder' && n.id === folderId);
        if (!folder) {
            return next;
        }

        const newNode = createScriptLayoutNode(scriptId, preservedLabel);
        if (typeof targetIdx !== 'number' || Number.isNaN(targetIdx)) {
            folder.items.push(newNode);
        } else {
            let insertIdx = targetIdx;
            if (
                removedFromFolderId === folderId &&
                removedFromFolderIdx !== -1 &&
                removedFromFolderIdx < insertIdx
            ) {
                insertIdx -= 1;
            }
            const clampedIdx = Math.max(0, Math.min(folder.items.length, insertIdx));
            folder.items.splice(clampedIdx, 0, newNode);
        }

        return next;
    }

    function setScriptLabel(layout, target, label) {
        const next = cloneLayout(layout);
        if (!target || typeof target !== 'object') {
            return next;
        }
        const trimmed = typeof label === 'string' ? label.trim() : '';

        const applyLabel = (node) => {
            if (!node || node.type !== 'script') {
                return;
            }
            if (trimmed) {
                node.label = trimmed;
            } else {
                delete node.label;
            }
        };

        if (target.kind === 'toolbar' && typeof target.index === 'number') {
            applyLabel(next[target.index]);
        } else if (target.kind === 'folder' && target.folderId && typeof target.index === 'number') {
            const folder = next.find((n) => n.type === 'folder' && n.id === target.folderId);
            if (folder && Array.isArray(folder.items)) {
                applyLabel(folder.items[target.index]);
            }
        } else if (typeof target.scriptId === 'string' && target.scriptId) {
            for (const node of next) {
                if (node.type === 'script' && getNodeScriptId(node) === target.scriptId) {
                    applyLabel(node);
                } else if (node.type === 'folder' && Array.isArray(node.items)) {
                    for (const item of node.items) {
                        if (getNodeScriptId(item) === target.scriptId) {
                            applyLabel(item);
                        }
                    }
                }
            }
        }

        return next;
    }

    function removeFolderItem(layout, folderId, itemIdx) {
        const next = cloneLayout(layout);
        const folder = next.find((n) => n.type === 'folder' && n.id === folderId);
        if (!folder || !Array.isArray(folder.items)) {
            return next;
        }
        if (typeof itemIdx === 'number') {
            if (itemIdx >= 0 && itemIdx < folder.items.length) {
                folder.items.splice(itemIdx, 1);
            }
        } else if (typeof itemIdx === 'string') {
            const idx = folder.items.findIndex((it) => getNodeScriptId(it) === itemIdx);
            if (idx !== -1) {
                folder.items.splice(idx, 1);
            }
        }
        return next;
    }

    function renameFolder(layout, folderId, newName) {
        const next = cloneLayout(layout);
        const trimmed = typeof newName === 'string' ? newName.trim() : '';
        if (!trimmed) {
            return next;
        }
        const folder = next.find((n) => n.type === 'folder' && n.id === folderId);
        if (folder) {
            folder.name = trimmed;
        }
        return next;
    }

    function createFolder(layout, name, id) {
        const next = cloneLayout(layout);
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (!trimmed) {
            return { layout: next, folder: null };
        }
        let folderId = typeof id === 'string' && id.trim() ? id.trim() : `folder:${Date.now()}`;
        if (!id && next.some((n) => n.type === 'folder' && n.id === folderId)) {
            let suffix = 1;
            while (next.some((n) => n.type === 'folder' && n.id === `${folderId}-${suffix}`)) {
                suffix += 1;
            }
            folderId = `${folderId}-${suffix}`;
        }
        const folder = {
            type: 'folder',
            id: folderId,
            name: trimmed,
            items: [],
        };
        next.push(folder);
        return {
            layout: next,
            folder: { ...folder, items: [] },
        };
    }

    function deleteFolder(layout, folderIdxOrId) {
        const next = cloneLayout(layout);
        if (typeof folderIdxOrId === 'number') {
            if (
                folderIdxOrId >= 0 &&
                folderIdxOrId < next.length &&
                next[folderIdxOrId].type === 'folder'
            ) {
                next.splice(folderIdxOrId, 1);
            }
        } else if (typeof folderIdxOrId === 'string' && folderIdxOrId) {
            const idx = next.findIndex((n) => n.type === 'folder' && n.id === folderIdxOrId);
            if (idx !== -1) {
                next.splice(idx, 1);
            }
        }
        return next;
    }

    function cloneLocalScriptsMap(localScripts) {
        const copy = {};
        if (!localScripts || typeof localScripts !== 'object') {
            return copy;
        }
        for (const [key, script] of Object.entries(localScripts)) {
            if (!script || typeof script !== 'object') {
                continue;
            }
            const id = script.id || key;
            const cloned = {
                ...script,
                id,
                source: 'local',
                match: Array.isArray(script.match) ? [...script.match] : [],
            };
            delete cloned.removed;
            copy[id] = cloned;
        }
        return copy;
    }

    function clonePackCache(packCache) {
        if (!packCache || typeof packCache !== 'object') {
            return { id: '', name: '', version: '', description: '', homepage: '', scripts: {} };
        }
        const scripts = {};
        if (packCache.scripts && typeof packCache.scripts === 'object') {
            for (const [id, script] of Object.entries(packCache.scripts)) {
                if (script && typeof script === 'object') {
                    scripts[id] = {
                        ...script,
                        match: Array.isArray(script.match) ? [...script.match] : [],
                    };
                }
            }
        }
        return {
            ...packCache,
            scripts,
        };
    }

    function convertRemovedPackScriptToLocal(
        packCache,
        localScripts,
        layout,
        scriptId,
        newLocalId
    ) {
        const nextPackCache = clonePackCache(packCache);
        const nextLocalScripts = cloneLocalScriptsMap(localScripts);
        const nextLayout = cloneLayout(layout);

        const packScript = nextPackCache.scripts[scriptId];
        if (!packScript) {
            return {
                packCache: nextPackCache,
                localScripts: nextLocalScripts,
                layout: nextLayout,
                newId: null,
            };
        }

        let newId = typeof newLocalId === 'string' && newLocalId.trim() ? newLocalId.trim() : '';
        if (!newId) {
            const slug = String(scriptId).replace(/^pack:[^/]+\//, '');
            newId = `local:${slug}`;
            if (newId in nextLocalScripts) {
                newId = `local:${slug}_${Date.now()}`;
            }
        }

        const localEntry = {
            id: newId,
            source: 'local',
            name: packScript.name,
            description: packScript.description || '',
            match: Array.isArray(packScript.match) ? [...packScript.match] : [],
            code: packScript.code,
        };
        if (packScript.label) {
            localEntry.label = packScript.label;
        }
        if (packScript.folder) {
            localEntry.folder = packScript.folder;
        }

        nextLocalScripts[newId] = localEntry;
        delete nextPackCache.scripts[scriptId];

        for (const node of nextLayout) {
            if (node.type === 'script' && getNodeScriptId(node) === scriptId) {
                node.scriptId = newId;
            } else if (node.type === 'folder' && Array.isArray(node.items)) {
                for (const item of node.items) {
                    if (getNodeScriptId(item) === scriptId) {
                        item.scriptId = newId;
                    }
                }
            }
        }

        return {
            packCache: nextPackCache,
            localScripts: nextLocalScripts,
            layout: nextLayout,
            newId,
        };
    }

    function removeOrphanedPackScriptFully(packCache, layout, scriptId) {
        const nextPackCache = clonePackCache(packCache);
        const nextLayout = cloneLayout(layout);

        delete nextPackCache.scripts[scriptId];
        extractScriptFromMutableLayout(nextLayout, scriptId);

        return {
            packCache: nextPackCache,
            layout: nextLayout,
        };
    }

    function deleteLocalScript(localScripts, layout, scriptId) {
        const nextLocalScripts = cloneLocalScriptsMap(localScripts);
        const nextLayout = cloneLayout(layout);

        delete nextLocalScripts[scriptId];
        extractScriptFromMutableLayout(nextLayout, scriptId);

        return {
            localScripts: nextLocalScripts,
            layout: nextLayout,
        };
    }

    function stripStringLiterals(src) {
        return src.replace(
            /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g,
            '""'
        );
    }

    function isValidJsSyntax(src) {
        try {
            new Function(src);
            return true;
        } catch (err) {
            if (err && err.name === 'SyntaxError') {
                return false;
            }
            return null;
        }
    }

    function normalizeBookmarkletCode(rawCode) {
        if (typeof rawCode !== 'string') {
            return '';
        }
        let code = rawCode.trim();
        if (/^javascript:/i.test(code)) {
            code = code.replace(/^javascript:\s*/i, '');
        }

        // Only URI-decode when percent-encoded JS syntax tokens appear outside raw string literals,
        // so raw JS with modulo operators (`x % 2 === 0` or `y % 20 === 0`) or URL-encoded query parameters
        // inside string literals (`"https://.../?query=%22" + q + "%22&limit=100%3B"`) is never corrupted.
        const codeOutsideStrings = stripStringLiterals(code);
        const hasEncodedStructure =
            /%(?:7[BbDd]|2[2789]|3[BbCcDdEe]|0[9AaDd]|5[BbDd])/i.test(codeOutsideStrings) ||
            /(?:^|[(){};,=<>!?:&|+\-*\/]|function|var|let|const|return|void|typeof|new|async|await)%20|%20[(){};,=<>!?:&|+\-*\/]/i.test(
                codeOutsideStrings
            );
        if (hasEncodedStructure) {
            try {
                const safePercent = code.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
                const decoded = decodeURIComponent(safePercent);
                if (isValidJsSyntax(decoded) !== false || isValidJsSyntax(code) === false) {
                    code = decoded;
                }
            } catch {
                // Keep raw code if decoding still fails
            }
        }

        return code.trim();
    }

    function buildExportEnvelope(localScripts, layout) {
        return {
            version: 1,
            exportedAt: new Date().toISOString(),
            scripts: cloneLocalScriptsMap(localScripts),
            layout: cloneLayout(layout),
        };
    }

    function parseAndValidateImport(rawJson) {
        let parsed;
        if (typeof rawJson === 'string') {
            try {
                parsed = JSON.parse(rawJson);
            } catch (err) {
                throw new Error(`Invalid JSON: ${err.message}`);
            }
        } else if (rawJson && typeof rawJson === 'object') {
            parsed = rawJson;
        } else {
            throw new Error('Import payload must be a JSON string or object');
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Import envelope must be a JSON object');
        }

        const version = parsed.version ?? parsed.schemaVersion;
        if (version !== 1) {
            throw new Error(`Unsupported import schema version: ${String(version)}`);
        }

        if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) {
            throw new Error('Import envelope must contain a "scripts" object');
        }

        if (!Array.isArray(parsed.layout)) {
            throw new Error('Import envelope must contain a "layout" array');
        }

        const validatedScripts = {};
        for (const [key, rawScript] of Object.entries(parsed.scripts)) {
            if (!rawScript || typeof rawScript !== 'object' || Array.isArray(rawScript)) {
                throw new Error(`Invalid script entry for "${key}"`);
            }
            const id =
                typeof rawScript.id === 'string' && rawScript.id.trim()
                    ? rawScript.id.trim()
                    : key.trim();
            if (!id) {
                throw new Error('Script entry is missing a valid id');
            }
            if (typeof rawScript.name !== 'string' || !rawScript.name.trim()) {
                throw new Error(`Script "${id}" must have a non-empty name`);
            }
            if (typeof rawScript.code !== 'string' || !rawScript.code.trim()) {
                throw new Error(`Script "${id}" must have non-empty code`);
            }
            if (!Array.isArray(rawScript.match) || rawScript.match.length === 0) {
                throw new Error(`Script "${id}" must have a non-empty match array`);
            }
            const cleanMatches = [];
            for (const pattern of rawScript.match) {
                if (typeof pattern !== 'string' || !isValidMatchPattern(pattern)) {
                    throw new Error(`Script "${id}" has an invalid match pattern: ${String(pattern)}`);
                }
                cleanMatches.push(pattern.trim());
            }

            const entry = {
                id,
                source: 'local',
                name: rawScript.name.trim(),
                description: typeof rawScript.description === 'string' ? rawScript.description : '',
                match: cleanMatches,
                code: rawScript.code,
            };
            if (typeof rawScript.label === 'string' && rawScript.label.trim()) {
                entry.label = rawScript.label.trim();
            }
            if (typeof rawScript.folder === 'string' && rawScript.folder.trim()) {
                entry.folder = rawScript.folder.trim();
            }
            validatedScripts[id] = entry;
        }

        const validatedLayout = [];
        const seenFolderIds = new Set();
        for (let i = 0; i < parsed.layout.length; i += 1) {
            const node = parsed.layout[i];
            if (!node || typeof node !== 'object' || Array.isArray(node)) {
                throw new Error(`Invalid layout node at index ${i}`);
            }
            if (node.type === 'script') {
                const sid = getNodeScriptId(node);
                if (!sid) {
                    throw new Error(`Script node at index ${i} is missing scriptId`);
                }
                if (node.label !== undefined && typeof node.label !== 'string') {
                    throw new Error(`Script node "${sid}" has a non-string label`);
                }
                validatedLayout.push(createScriptLayoutNode(sid, node.label));
            } else if (node.type === 'folder') {
                if (typeof node.id !== 'string' || !node.id.trim()) {
                    throw new Error(`Folder node at index ${i} is missing a valid id`);
                }
                const folderId = node.id.trim();
                if (seenFolderIds.has(folderId)) {
                    throw new Error(`Duplicate folder id "${folderId}" at index ${i}`);
                }
                seenFolderIds.add(folderId);
                if (typeof node.name !== 'string' || !node.name.trim()) {
                    throw new Error(`Folder "${folderId}" is missing a valid name`);
                }
                if (!Array.isArray(node.items)) {
                    throw new Error(`Folder "${folderId}" must have an items array`);
                }
                const validatedItems = [];
                for (let j = 0; j < node.items.length; j += 1) {
                    const item = node.items[j];
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        throw new Error(`Invalid folder item at index ${j} in folder "${folderId}"`);
                    }
                    if (item.type === 'folder' || item.type !== 'script') {
                        throw new Error(
                            `Nested folders or non-script items are not allowed inside folder "${folderId}"`
                        );
                    }
                    const sid = getNodeScriptId(item);
                    if (!sid) {
                        throw new Error(`Folder item at index ${j} in folder "${folderId}" is missing scriptId`);
                    }
                    if (item.label !== undefined && typeof item.label !== 'string') {
                        throw new Error(`Folder item "${sid}" has a non-string label`);
                    }
                    validatedItems.push(createScriptLayoutNode(sid, item.label));
                }
                validatedLayout.push({
                    type: 'folder',
                    id: folderId,
                    name: node.name.trim(),
                    items: validatedItems,
                });
            } else {
                throw new Error(`Unsupported layout node type at index ${i}: ${String(node.type)}`);
            }
        }

        return {
            scripts: validatedScripts,
            layout: validatedLayout,
        };
    }

    function normalizeKeyToken(event) {
        if (!event || typeof event.key !== 'string' || !event.key) {
            return null;
        }
        if (MODIFIER_ONLY_KEYS.has(event.key)) {
            return null;
        }
        if (event.key === ' ') {
            return 'Space';
        }
        if (event.key === '+') {
            return 'Plus';
        }
        if (event.key.length === 1) {
            if (/^[a-z0-9]$/i.test(event.key)) {
                return event.key.toUpperCase();
            }
            if (typeof event.code === 'string') {
                const keyMatch = event.code.match(/^Key([A-Z])$/);
                if (keyMatch) {
                    return keyMatch[1];
                }
                const digitMatch = event.code.match(/^Digit([0-9])$/);
                if (digitMatch) {
                    return digitMatch[1];
                }
            }
            return event.key.toUpperCase();
        }
        return event.key;
    }

    function formatHotkeyEvent(event) {
        if (!event || typeof event !== 'object') {
            return null;
        }
        const keyToken = normalizeKeyToken(event);
        if (!keyToken) {
            return null;
        }
        const ctrl = Boolean(event.ctrlKey || event.metaKey);
        const alt = Boolean(event.altKey);
        const shift = Boolean(event.shiftKey);
        if (!ctrl && !alt && !shift) {
            return null;
        }

        const parts = [];
        if (ctrl) {
            parts.push('Ctrl');
        }
        if (alt) {
            parts.push('Alt');
        }
        if (shift) {
            parts.push('Shift');
        }
        parts.push(keyToken);
        return parts.join('+');
    }

    function parseHotkeyCombo(combo) {
        if (typeof combo !== 'string' || !combo.trim()) {
            return null;
        }
        const normalizedCombo = combo.trim().replace(/\+\s*\+$/, '+Plus');
        const tokens = normalizedCombo
            .split('+')
            .map((t) => t.trim())
            .filter(Boolean);
        if (tokens.length < 2) {
            return null;
        }

        let ctrl = false;
        let alt = false;
        let shift = false;
        let key = null;

        for (const token of tokens) {
            const lower = token.toLowerCase();
            if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta') {
                ctrl = true;
            } else if (lower === 'alt' || lower === 'option') {
                alt = true;
            } else if (lower === 'shift') {
                shift = true;
            } else if (lower === 'plus' || token === '+') {
                key = 'Plus';
            } else {
                key = token.length === 1 ? token.toUpperCase() : token;
            }
        }

        if (!key || (!ctrl && !alt && !shift)) {
            return null;
        }

        return { ctrl, alt, shift, key: key.toLowerCase() };
    }

    function matchesHotkey(event, combo) {
        const formatted = formatHotkeyEvent(event);
        if (!formatted) {
            return false;
        }
        const eventParsed = parseHotkeyCombo(formatted);
        const targetParsed = parseHotkeyCombo(combo);
        if (!eventParsed || !targetParsed) {
            return false;
        }
        return (
            eventParsed.ctrl === targetParsed.ctrl &&
            eventParsed.alt === targetParsed.alt &&
            eventParsed.shift === targetParsed.shift &&
            eventParsed.key === targetParsed.key
        );
    }

    return Object.freeze({
        STORAGE_KEYS,
        DOCK_SNAP_ZONES,
        DOCK_EXPAND_MODES,
        getSiteOrigin,
        normalizeSettings,
        isValidMatchPattern,
        matchPattern,
        scriptMatchesUrl,
        syncPackCache,
        buildScriptsMap,
        shouldMountToolbar,
        getVisibleLayoutForUrl,
        hasRemovedPlacedScript,
        getPlacement,
        toggleToolbarPin,
        placeScriptOnToolbarAt,
        moveToolbarNode,
        moveScriptToFolder,
        setScriptLabel,
        removeFolderItem,
        renameFolder,
        createFolder,
        deleteFolder,
        convertRemovedPackScriptToLocal,
        removeOrphanedPackScriptFully,
        deleteLocalScript,
        normalizeBookmarkletCode,
        buildExportEnvelope,
        parseAndValidateImport,
        matchesHotkey,
        formatHotkeyEvent,
    });
})();

try {
    if (typeof module === 'object' && module && module.exports) {
        module.exports = BookmarkletToolbarCore;
    }
} catch {}
