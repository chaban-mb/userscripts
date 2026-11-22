// ==UserScript==
// @name         Bookmarklet Toolbar UI
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Shadow DOM UI components for Site Bookmarklet Toolbar.
// @author       chaban
// @license      MIT
// ==/UserScript==

const BookmarkletToolbarUI = (() => {
    'use strict';

    const Core =
        typeof BookmarkletToolbarCore !== 'undefined'
            ? BookmarkletToolbarCore
            : typeof require === 'function'
              ? require('./BookmarkletToolbarCore.js')
              : null;

    const Adapters =
        typeof BookmarkletToolbarAdapters !== 'undefined'
            ? BookmarkletToolbarAdapters
            : typeof require === 'function'
              ? (() => {
                    try {
                        return require('./BookmarkletToolbarAdapters.js');
                    } catch {
                        return null;
                    }
                })()
              : null;

    const DEFAULT_DRAG_HINT =
        'Drag items to reorder or drop into folders • Double-click button to relabel • Click folder to open';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const DRAG_THRESHOLD_PX = 6;
    const DOCK_SNAP_LABELS = Object.freeze({
        'top-left': 'Top Left',
        'top-center': 'Top Center',
        'top-right': 'Top Right',
        'bottom-left': 'Bottom Left',
        'bottom-center': 'Bottom Center',
        'bottom-right': 'Bottom Right',
    });
    const DOCK_POSITION_STYLES = Object.freeze({
        'top-left': { top: '16px', right: '', bottom: '', left: '16px', transform: '', width: '' },
        'top-center': {
            top: '16px',
            right: '',
            bottom: '',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'max-content',
        },
        'top-right': { top: '16px', right: '16px', bottom: '', left: '', transform: '', width: '' },
        'bottom-left': { top: '', right: '', bottom: '16px', left: '16px', transform: '', width: '' },
        'bottom-center': {
            top: '',
            right: '',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'max-content',
        },
        'bottom-right': { top: '', right: '16px', bottom: '16px', left: '', transform: '', width: '' },
    });

    function createSvgElement(doc, tag) {
        if (typeof doc.createElementNS === 'function') {
            return doc.createElementNS(SVG_NS, tag);
        }
        return doc.createElement(tag);
    }

    function createBookmarkBoltSvg(doc) {
        const svg = createSvgElement(doc, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'bt-dock-bolt-icon');

        const ribbon = createSvgElement(doc, 'path');
        ribbon.setAttribute(
            'd',
            'M3.5 1.75A1.25 1.25 0 0 1 4.75.5h6.5a1.25 1.25 0 0 1 1.25 1.25v12.6a.4.4 0 0 1-.66.31L8 11.4l-3.84 3.26a.4.4 0 0 1-.66-.31V1.75Z'
        );
        ribbon.setAttribute('fill', 'rgba(168, 85, 247, 0.22)');
        ribbon.setAttribute('stroke', '#d8b4fe');
        ribbon.setAttribute('stroke-width', '1.35');
        ribbon.setAttribute('stroke-linejoin', 'round');

        const bolt = createSvgElement(doc, 'path');
        bolt.setAttribute('d', 'M8.6 3.1 6.1 7.2h2.1l-.8 3.2 2.9-4.3H8.2l.4-3Z');
        bolt.setAttribute('fill', '#fde047');

        svg.append(ribbon, bolt);
        return svg;
    }

    function applyDockPosition(hostEl, snapZone, dragOffset = null) {
        if (!hostEl) {
            return;
        }
        const zone = DOCK_POSITION_STYLES[snapZone] ? snapZone : 'bottom-center';
        const anchor = DOCK_POSITION_STYLES[zone];
        if (!hostEl.style || typeof hostEl.style !== 'object') {
            hostEl.style = {};
        }
        if (hostEl.dataset) {
            hostEl.dataset.snapZone = zone;
        }

        let transform = anchor.transform;
        if (dragOffset) {
            const dx = Math.round(dragOffset.dx || 0);
            const dy = Math.round(dragOffset.dy || 0);
            transform = zone.endsWith('-center')
                ? `translate(calc(-50% + ${dx}px), ${dy}px)`
                : `translate(${dx}px, ${dy}px)`;
        }

        const props = {
            position: 'fixed',
            zIndex: '2147483640',
            maxWidth: 'calc(100vw - 32px)',
            top: anchor.top,
            right: anchor.right,
            bottom: anchor.bottom,
            left: anchor.left,
            width: anchor.width,
            transform,
        };
        const cssParts = [
            'position: fixed',
            'z-index: 2147483640',
            'max-width: calc(100vw - 32px)',
        ];
        if (props.top) cssParts.push(`top: ${props.top}`);
        if (props.right) cssParts.push(`right: ${props.right}`);
        if (props.bottom) cssParts.push(`bottom: ${props.bottom}`);
        if (props.left) cssParts.push(`left: ${props.left}`);
        if (props.width) cssParts.push(`width: ${props.width}`);
        if (props.transform) cssParts.push(`transform: ${props.transform}`);

        hostEl.style.cssText = `${cssParts.join('; ')};`;
        for (const [k, v] of Object.entries(props)) {
            hostEl.style[k] = v;
        }
    }

    function resolveNearestSnapZone(win, doc, clientX, clientY) {
        const vw = Number(win?.innerWidth) || Number(doc?.documentElement?.clientWidth) || 1280;
        const vh = Number(win?.innerHeight) || Number(doc?.documentElement?.clientHeight) || 720;
        const row = clientY < vh / 2 ? 'top' : 'bottom';
        const col = clientX < vw / 3 ? 'left' : clientX > (vw * 2) / 3 ? 'right' : 'center';
        return `${row}-${col}`;
    }

    function getDropdownClasses(snapZone) {
        const zone = DOCK_POSITION_STYLES[snapZone] ? snapZone : 'bottom-center';
        const horiz = zone.endsWith('-right')
            ? 'bt-dropdown-right'
            : zone.endsWith('-center')
              ? 'bt-dropdown-center'
              : 'bt-dropdown-left';
        return zone.startsWith('top-')
            ? `bt-dropdown ${horiz}`
            : `bt-dropdown bt-dropdown-up ${horiz}`;
    }

    function clampDropdownToViewport(menu, win, doc) {
        if (!menu || typeof menu.getBoundingClientRect !== 'function') {
            return;
        }
        const rect = menu.getBoundingClientRect();
        const vw = Number(win?.innerWidth) || Number(doc?.documentElement?.clientWidth) || 0;
        if (!rect || typeof rect.right !== 'number' || rect.width <= 0 || vw <= 0) {
            return;
        }
        let delta = 0;
        if (rect.right > vw - 8) {
            delta = vw - 8 - rect.right;
        }
        if (rect.left + delta < 8) {
            delta = 8 - rect.left;
        }
        if (delta !== 0) {
            if (menu.classList?.contains('bt-dropdown-right')) {
                menu.style.marginLeft = '';
                menu.style.marginRight = `${Math.round(-delta)}px`;
            } else {
                menu.style.marginRight = '';
                menu.style.marginLeft = `${Math.round(delta)}px`;
            }
        }
    }

    function positionPopoverInViewport(popEl, triggerEl, win = null, doc = null) {
        if (!popEl || !triggerEl || !popEl.style) {
            return;
        }
        const resolvedDoc =
            doc ||
            popEl.ownerDocument ||
            triggerEl.ownerDocument ||
            (typeof document !== 'undefined' ? document : null);
        const resolvedWin =
            win ||
            (resolvedDoc && resolvedDoc.defaultView) ||
            (typeof window !== 'undefined' ? window : null);

        const vw =
            Number(resolvedDoc?.documentElement?.clientWidth) ||
            Number(resolvedWin?.innerWidth) ||
            800;
        const vh =
            Number(resolvedDoc?.documentElement?.clientHeight) ||
            Number(resolvedWin?.innerHeight) ||
            600;

        const triggerRect =
            typeof triggerEl.getBoundingClientRect === 'function'
                ? triggerEl.getBoundingClientRect()
                : null;
        const popRect =
            typeof popEl.getBoundingClientRect === 'function'
                ? popEl.getBoundingClientRect()
                : null;

        const defaultWidth = popEl.classList?.contains('bt-pack-popover') ? 320 : 288;
        const popWidth = Number(popRect?.width) > 0 ? Number(popRect.width) : defaultWidth;
        const popHeight = Number(popRect?.height) > 0 ? Number(popRect.height) : 180;

        const triggerTop = Number(triggerRect?.top) || 0;
        const triggerLeft = Number(triggerRect?.left) || 0;
        const triggerHeight = Number(triggerRect?.height) || 0;
        const triggerBottom =
            typeof triggerRect?.bottom === 'number'
                ? triggerRect.bottom
                : triggerTop + triggerHeight;

        const placeBelow =
            triggerBottom + 6 + popHeight <= vh - 8 ||
            triggerTop < vh - triggerBottom;

        const top = placeBelow
            ? Math.max(8, triggerBottom + 6)
            : Math.max(8, triggerTop - popHeight - 6);
        const availHeight = placeBelow
            ? Math.max(120, vh - top - 8)
            : Math.max(120, triggerTop - 14);
        const maxHeight = Math.min(320, availHeight);
        const left = Math.min(
            Math.max(8, triggerLeft),
            Math.max(8, vw - popWidth - 8)
        );

        popEl.style.left = `${Math.round(left)}px`;
        popEl.style.top = `${Math.round(top)}px`;
        popEl.style.maxHeight = `${Math.round(maxHeight)}px`;
    }

    function clearNode(el) {
        if (!el) {
            return;
        }
        if (typeof el.replaceChildren === 'function') {
            el.replaceChildren();
            return;
        }
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    function getCurrentOriginPattern(url) {
        if (typeof url === 'string' && url) {
            try {
                const parsed = new URL(url);
                if (
                    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
                    parsed.host
                ) {
                    const candidate = `*://${parsed.host}/*`;
                    if (!Core || Core.isValidMatchPattern(candidate)) {
                        return candidate;
                    }
                }
            } catch {
                // Fall back to all sites
            }
        }
        return '*://*/*';
    }

    function getSiteBrand(url) {
        if (typeof url === 'string' && url) {
            try {
                return new URL(url).hostname || url;
            } catch {
                return url;
            }
        }
        return 'current site';
    }

    function buildStyles() {
        return `
:host {
    all: initial;
    color-scheme: light;
    --bt-bg: #ffffff;
    --bt-card: #ffffff;
    --bt-content: #f8fafc;
    --bt-fg: #0f172a;
    --bt-muted: #64748b;
    --bt-border: #e2e8f0;
    --bt-primary: #7c3aed;
    --bt-primary-hover: #6d28d9;
    --bt-primary-fg: #ffffff;
    --bt-hover-bg: #f1f5f9;
    --bt-link: #6d28d9;
    --bt-amber: #d97706;
    --bt-amber-bg: #fffbeb;
    --bt-amber-fg: #92400e;
    --bt-danger: #dc2626;
    --bt-danger-hover: #b91c1c;
    --bt-danger-fg: #ffffff;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    color: var(--bt-fg);
    box-sizing: border-box;
}

@media (prefers-color-scheme: dark) {
    :host {
        color-scheme: dark;
        --bt-bg: #0f172a;
        --bt-card: #1e293b;
        --bt-content: #111827;
        --bt-fg: #f8fafc;
        --bt-muted: #94a3b8;
        --bt-border: #334155;
        --bt-primary: #8b5cf6;
        --bt-primary-hover: #7c3aed;
        --bt-primary-fg: #ffffff;
        --bt-hover-bg: #334155;
        --bt-link: #a78bfa;
        --bt-amber: #f59e0b;
        --bt-amber-bg: rgba(245, 158, 11, 0.15);
        --bt-amber-fg: #fcd34d;
    }
}

*, *::before, *::after {
    box-sizing: border-box;
}

.hidden {
    display: none !important;
}

button, input, textarea {
    font-family: inherit;
    font-size: 12px;
    color: inherit;
}

/* Floating Collapsible Dock */
.bt-toolbar-dock {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    max-width: calc(100vw - 32px);
    gap: 6px;
    background: #111827;
    color: #f3f4f6;
    border: 1px solid #374151;
    border-radius: 9999px;
    padding: 5px 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
}

.bt-toolbar-dock-collapsed {
    padding: 4px 6px;
}

.bt-dock-handle {
    touch-action: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 24px;
    min-height: 24px;
    padding: 3px 6px;
    border-radius: 9999px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.06);
    color: #e9d5ff;
    cursor: grab;
    -webkit-user-select: none;
    user-select: none;
}

.bt-dock-handle:hover {
    background: rgba(168, 85, 247, 0.2);
    border-color: rgba(192, 132, 252, 0.4);
}

.bt-dock-handle-dragging {
    cursor: grabbing;
}

.bt-dock-bolt-icon {
    display: block;
    flex-shrink: 0;
    pointer-events: none;
}

.bt-dock-snap-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483644;
    background: rgba(15, 23, 42, 0.14);
}

.bt-dock-snap-zone {
    position: fixed;
    width: 112px;
    height: 40px;
    border-radius: 9999px;
    border: 2px dashed rgba(139, 92, 246, 0.65);
    background: rgba(17, 24, 39, 0.45);
    color: #e9d5ff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    transition: transform 100ms ease, background 100ms ease, border-color 100ms ease;
}

.bt-dock-snap-zone[data-snap-zone="top-left"] {
    top: 16px;
    left: 16px;
}

.bt-dock-snap-zone[data-snap-zone="top-center"] {
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
}

.bt-dock-snap-zone[data-snap-zone="top-right"] {
    top: 16px;
    right: 16px;
}

.bt-dock-snap-zone[data-snap-zone="bottom-left"] {
    bottom: 16px;
    left: 16px;
}

.bt-dock-snap-zone[data-snap-zone="bottom-center"] {
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
}

.bt-dock-snap-zone[data-snap-zone="bottom-right"] {
    bottom: 16px;
    right: 16px;
}

.bt-dock-snap-zone-active {
    border-style: solid;
    border-color: #a855f7;
    background: rgba(126, 34, 206, 0.8);
    color: #ffffff;
    box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.3);
}

.bt-btn-dark {
    padding: 2px 8px;
    font-size: 12px;
    line-height: 1.35;
    border-radius: 4px;
    background: #1f2937;
    border: 1px solid #4b5563;
    color: #f3f4f6;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

.bt-btn-dark:hover {
    background: #374151;
}

.bt-btn-dark-removed {
    border-style: dashed;
    border-color: #f59e0b;
    color: #fcd34d;
}

.bt-btn-util-dark {
    padding: 2px 8px;
    font-size: 12px;
    line-height: 1.35;
    border-radius: 4px;
    background: #7e22ce;
    border: 1px solid #9333ea;
    color: #ffffff;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.bt-btn-util-dark:hover {
    background: #9333ea;
}

.bt-folder-wrap {
    position: relative;
    display: inline-flex;
}

.bt-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 190px;
    max-width: calc(100vw - 16px);
    max-height: 60vh;
    max-height: 60dvh;
    overflow-y: auto;
    background: #ffffff;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
    padding: 4px;
    z-index: 2147483640;
}

.bt-dropdown-up {
    top: auto;
    bottom: calc(100% + 6px);
}

.bt-dropdown-left {
    left: 0;
    right: auto;
}

.bt-dropdown-right {
    left: auto;
    right: 0;
}

.bt-dropdown-center {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
}

.bt-dropdown-item {
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border: none;
    background: transparent;
    border-radius: 4px;
    font-size: 12px;
    color: #1f2937;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
}

.bt-dropdown-item:hover {
    background: #f3e8ff;
    color: #581c87;
}

.bt-amber-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 9999px;
    background: #f59e0b;
    margin-left: 3px;
}

/* Pills & Drag-and-Drop Feedback */
.pill-base {
    position: relative;
    height: 28px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1;
    background: var(--bt-content);
    border: 1px solid var(--bt-border);
    color: var(--bt-fg);
}

.bt-pill-removed {
    border-color: var(--bt-amber);
}

.bt-pill-selected {
    border-color: var(--bt-primary);
    background: var(--bt-primary);
    color: var(--bt-primary-fg);
}

.bt-add-folder-pill {
    border-style: dashed;
    color: var(--bt-muted);
    background: transparent;
    cursor: pointer;
}

.bt-add-folder-pill:hover {
    color: var(--bt-fg);
    border-color: var(--bt-primary);
}

.bt-inline-edit-pill {
    border-color: var(--bt-primary);
    background: var(--bt-bg);
    padding: 0 8px;
}

.bt-inline-edit-input {
    font-size: 12px;
    background: transparent;
    border: none;
    outline: none;
    width: 112px;
    line-height: 1;
    color: var(--bt-fg);
}

.bt-inline-edit-ok {
    font-size: 12px;
    color: var(--bt-primary);
    font-weight: 700;
    background: transparent;
    border: none;
    cursor: pointer;
    line-height: 1;
    padding: 0 2px;
}

.drop-active-zone {
    outline: 2px dashed var(--bt-primary);
    outline-offset: 2px;
    background: color-mix(in srgb, var(--bt-primary) 10%, transparent) !important;
}

.drop-active-before::before,
.drop-active-after::after {
    content: '';
    position: absolute;
    top: -6px;
    bottom: -6px;
    width: 4px;
    border-radius: 9999px;
    background: var(--bt-primary);
    box-shadow: 0 0 0 2px var(--bt-bg), 0 0 10px var(--bt-primary);
    pointer-events: none;
    z-index: 25;
}

.drop-active-before::before {
    left: -6px;
}

.drop-active-after::after {
    right: -6px;
}

.drop-active-folder {
    outline: 2px solid var(--bt-primary);
    outline-offset: 1px;
    background: color-mix(in srgb, var(--bt-primary) 16%, transparent) !important;
}

.bt-hint-muted {
    color: var(--bt-muted);
    min-width: 0;
    overflow-wrap: break-word;
}

.bt-hint-active {
    color: var(--bt-primary);
    font-weight: 500;
    min-width: 0;
    overflow-wrap: break-word;
}

.bt-hint-blocked {
    color: var(--bt-danger);
    font-weight: 500;
    min-width: 0;
    overflow-wrap: break-word;
}

/* Overlays & Modals */
.bt-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 2147483645;
    pointer-events: none;
}

.bt-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 2147483645;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    pointer-events: auto;
}

.bt-backdrop-top {
    align-items: flex-start;
    padding-top: 56px;
}

.bt-backdrop-sub {
    background: rgba(0, 0, 0, 0.58);
    z-index: 2147483646;
}

.bt-modal {
    background: var(--bt-card);
    color: var(--bt-fg);
    border: 1px solid var(--bt-border);
    border-radius: 12px;
    width: 100%;
    min-width: 0;
    max-width: min(520px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
    max-height: calc(100dvh - 24px);
    box-shadow: 0 22px 48px rgba(0, 0, 0, 0.32);
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

#manager-backdrop {
    align-items: flex-start;
    padding-top: 16px;
}

.bt-modal-lg {
    max-width: min(896px, calc(100vw - 24px));
    height: calc(100vh - 32px);
    height: calc(100dvh - 32px);
    max-height: calc(100vh - 32px);
    max-height: calc(100dvh - 32px);
}

.bt-modal-sm {
    max-width: min(384px, calc(100vw - 24px));
}

.bt-segmented {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--bt-border);
    border-radius: 6px;
    background: var(--bt-bg);
    overflow: hidden;
    flex-wrap: nowrap;
}

.bt-segmented-btn {
    padding: 4px 8px;
    font-size: 11px;
    border: none;
    border-right: 1px solid var(--bt-border);
    background: transparent;
    color: var(--bt-muted);
    cursor: pointer;
    white-space: nowrap;
}

.bt-segmented-btn:last-child {
    border-right: none;
}

.bt-segmented-btn:hover {
    background: var(--bt-hover-bg);
    color: var(--bt-fg);
}

.bt-segmented-btn-active,
.bt-segmented-btn-active:hover {
    background: var(--bt-primary);
    color: var(--bt-primary-fg);
    font-weight: 500;
}

.bt-pill-draggable {
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
}

.bt-touch-ghost {
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    transform: translate(-50%, -50%) scale(1.03);
    opacity: 0.92;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
    border-color: var(--bt-primary);
    background: var(--bt-card);
}

.bt-modal-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--bt-border);
    background: var(--bt-content);
}

.bt-row-between {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}

.bt-row-start-between {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.bt-row-wrap {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.bt-row-nowrap {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 8px;
}

.bt-title {
    font-size: 14px;
    font-weight: 600;
}

.bt-subtitle {
    font-size: 12px;
    color: var(--bt-muted);
    margin-top: 2px;
}

.bt-close-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    border-radius: 6px;
    border: 1px solid var(--bt-border);
    background: var(--bt-bg);
    color: var(--bt-fg);
    cursor: pointer;
    flex-shrink: 0;
}

.bt-close-btn:hover {
    background: var(--bt-hover-bg);
}

.bt-action-btn {
    padding: 5px 10px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid var(--bt-border);
    background: var(--bt-bg);
    color: var(--bt-fg);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
}

.bt-action-btn:hover {
    background: var(--bt-hover-bg);
}

.bt-action-btn-primary {
    background: var(--bt-primary);
    color: var(--bt-primary-fg);
    border-color: var(--bt-primary);
    font-weight: 500;
}

.bt-action-btn-primary:hover {
    background: var(--bt-primary-hover);
    border-color: var(--bt-primary-hover);
    color: var(--bt-primary-fg);
}

.bt-action-btn-danger {
    background: var(--bt-danger);
    color: var(--bt-danger-fg);
    border-color: var(--bt-danger);
    font-weight: 500;
}

.bt-action-btn-danger:hover {
    background: var(--bt-danger-hover);
}

.bt-action-btn-recording {
    border-color: var(--bt-primary);
    color: var(--bt-primary);
    font-weight: 600;
}

/* Manager Body */
.bt-manager-body {
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    scrollbar-width: thin;
    scrollbar-color: var(--bt-border) transparent;
}

.bt-sticky-section {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 14px 16px;
    border-bottom: 1px solid var(--bt-border);
    background: var(--bt-bg);
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
}

.bt-section-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--bt-muted);
}

.bt-toolbar-strip {
    min-height: 48px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-radius: 8px;
    border: 1px dashed var(--bt-border);
    background: var(--bt-card);
}

.bt-folder-drawer {
    border-radius: 8px;
    border: 1px solid var(--bt-border);
    background: var(--bt-content);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.bt-folder-items-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-top: 4px;
}

.bt-library-section {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
}

.bt-mgr-search {
    flex: 1 1 180px;
    min-width: 0;
    max-width: 100%;
    width: auto;
}

.bt-library-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(360px, 100%), 1fr));
    align-items: start;
    gap: 8px;
}

.bt-library-card {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--bt-border);
    background: var(--bt-content);
    cursor: grab;
    transition: border-color 120ms ease;
}

.bt-library-card:hover {
    border-color: var(--bt-primary);
    z-index: 9;
}

.bt-library-card:focus-within {
    border-color: var(--bt-primary);
    z-index: 8;
}

.bt-card-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
}

.bt-card-title-row {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 6px;
    min-width: 0;
}

.bt-card-title {
    font-weight: 500;
    min-width: 0;
    flex: 0 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.bt-card-tooltip {
    position: absolute;
    left: 40px;
    bottom: calc(100% + 5px);
    max-width: calc(100% - 48px);
    padding: 5px 9px;
    border-radius: 6px;
    background: var(--bt-fg);
    color: var(--bt-bg);
    font-size: 12px;
    font-weight: 500;
    line-height: 1.35;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
    pointer-events: none;
    opacity: 0;
    transform: translateY(2px);
    transition: opacity 90ms ease, transform 90ms ease;
    z-index: 5;
    white-space: normal;
    overflow-wrap: anywhere;
}

.bt-library-card[data-tooltip-pos="bottom"] .bt-card-tooltip {
    bottom: auto;
    top: calc(100% + 5px);
    transform: translateY(-2px);
}

.bt-library-card[data-truncated="true"]:not([data-tooltip-suppressed="true"]):hover .bt-card-tooltip,
.bt-library-card[data-truncated="true"]:not([data-tooltip-suppressed="true"]):focus-within .bt-card-tooltip {
    opacity: 1;
    transform: translateY(0);
}

.bt-library-grid[data-dragging="true"] .bt-card-tooltip {
    opacity: 0 !important;
}

.bt-grip {
    font-size: 12px;
    color: var(--bt-muted);
    -webkit-user-select: none;
    user-select: none;
    touch-action: none;
    cursor: grab;
    padding: 2px 3px;
    flex-shrink: 0;
}

.bt-status-slot {
    width: 20px;
    text-align: center;
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
    background: transparent;
    border: none;
    padding: 2px 0;
}

.bt-star-btn {
    cursor: pointer;
    color: var(--bt-muted);
}

.bt-star-btn:hover,
.bt-star-active {
    color: #fbbf24;
}

.bt-badge {
    font-size: 12px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bt-bg);
    border: 1px solid var(--bt-border);
    color: var(--bt-muted);
    flex-shrink: 0;
    white-space: nowrap;
}

.bt-badge-removed {
    background: var(--bt-amber-bg);
    border-color: var(--bt-amber);
    color: var(--bt-amber);
    font-weight: 500;
}

.bt-badge-folder {
    cursor: pointer;
    color: var(--bt-fg);
}

.bt-badge-folder:hover {
    border-color: var(--bt-primary);
}

.bt-mini-btn {
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 4px;
    border: 1px solid var(--bt-border);
    background: var(--bt-bg);
    color: var(--bt-fg);
    cursor: pointer;
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
}

.bt-mini-btn:hover {
    background: var(--bt-hover-bg);
    border-color: var(--bt-primary);
}

.bt-mini-btn-square {
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.bt-mini-btn-primary {
    background: var(--bt-primary);
    color: var(--bt-primary-fg);
    border-color: var(--bt-primary);
    padding: 4px 8px;
}

.bt-mini-btn-primary:hover {
    background: var(--bt-primary-hover);
    border-color: var(--bt-primary-hover);
    color: var(--bt-primary-fg);
}

.bt-popover {
    position: fixed;
    left: 16px;
    top: 16px;
    width: 288px;
    max-width: calc(100vw - 16px);
    max-height: min(320px, calc(100vh - 32px));
    max-height: min(320px, calc(100dvh - 32px));
    overflow-y: auto;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid var(--bt-border);
    background: var(--bt-card);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.24);
    z-index: 2147483646;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: default;
}

.bt-pack-popover {
    width: 320px;
    max-width: calc(100vw - 16px);
}

/* Command Palette */
.bt-palette-search-row {
    padding: 12px;
    border-bottom: 1px solid var(--bt-border);
    display: flex;
    align-items: center;
    gap: 8px;
}

.bt-palette-input {
    width: 100%;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    font-size: 13px;
    color: var(--bt-fg);
}

.bt-palette-list {
    max-height: 288px;
    overflow-y: auto;
    min-width: 0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--bt-border) transparent;
}

.bt-palette-group {
    padding: 6px 8px 2px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--bt-muted);
    flex-shrink: 0;
}

.bt-palette-item {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    padding: 8px 10px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--bt-fg);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
}

.bt-palette-item .bt-subtitle {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
}

.bt-palette-item:hover {
    background: var(--bt-content);
}

.bt-palette-item-active,
.bt-palette-item-active:hover {
    background: var(--bt-primary);
    color: var(--bt-primary-fg);
}

.bt-palette-item-active .bt-badge {
    background: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.3);
    color: var(--bt-primary-fg);
}

.bt-palette-footer {
    padding: 8px 12px;
    border-top: 1px solid var(--bt-border);
    background: var(--bt-content);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 12px;
    color: var(--bt-muted);
}

/* Forms & Inputs */
.bt-input,
.bt-textarea {
    width: 100%;
    min-width: 0;
    font-size: 12px;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--bt-border);
    background: var(--bt-bg);
    color: var(--bt-fg);
}

.bt-textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.bt-form-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    min-width: 0;
}

.bt-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.bt-label {
    font-size: 12px;
    font-weight: 500;
}

@media (max-width: 600px) {
    .bt-backdrop {
        padding: 12px;
    }

    .bt-backdrop-top {
        padding-top: 24px;
    }

    #manager-backdrop {
        padding-top: 12px;
    }

    .bt-modal,
    .bt-modal-lg,
    .bt-modal-sm {
        max-width: calc(100vw - 24px);
    }

    .bt-modal-lg {
        height: calc(100vh - 24px);
        height: calc(100dvh - 24px);
        max-height: calc(100vh - 24px);
        max-height: calc(100dvh - 24px);
    }

    .bt-modal-header {
        padding: 10px 12px;
    }

    .bt-sticky-section,
    .bt-library-section,
    .bt-form-body {
        padding: 12px;
    }

    .bt-popover {
        max-width: calc(100vw - 16px);
    }

    .bt-pack-popover {
        width: min(320px, calc(100vw - 16px));
    }
}

@media (pointer: coarse) {
    .bt-grip {
        padding: 4px 6px;
    }
}

/* Toast */
.bt-toast {
    position: fixed;
    bottom: 16px;
    left: 16px;
    z-index: 2147483647;
    background: #111827;
    color: #ffffff;
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #374151;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25);
    pointer-events: auto;
}
`;
    }

    function createInlineEditPill({
        doc,
        initialValue = '',
        placeholder = '',
        onCommit,
        onCancel,
    }) {
        const resolvedDoc = doc || (typeof document !== 'undefined' ? document : null);
        const wrap = resolvedDoc.createElement('div');
        wrap.className = 'pill-base bt-inline-edit-pill';

        const inp = resolvedDoc.createElement('input');
        inp.type = 'text';
        inp.value = initialValue || '';
        inp.placeholder = placeholder || '';
        inp.className = 'bt-inline-edit-input';

        let done = false;
        const commit = () => {
            if (!done) {
                done = true;
                if (typeof onCommit === 'function') {
                    onCommit(String(inp.value || '').trim());
                }
            }
        };
        const cancel = () => {
            if (!done) {
                done = true;
                if (typeof onCancel === 'function') {
                    onCancel();
                }
            }
        };

        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
            }
        });
        inp.addEventListener('blur', commit);

        const ok = resolvedDoc.createElement('button');
        ok.type = 'button';
        ok.className = 'bt-inline-edit-ok';
        ok.textContent = '✓';
        ok.title = 'Save (Enter)';
        ok.addEventListener('mousedown', (e) => {
            e.preventDefault();
            commit();
        });

        wrap.append(inp, ok);
        setTimeout(() => {
            if (typeof inp.focus === 'function') {
                inp.focus();
            }
            if (initialValue && typeof inp.select === 'function') {
                inp.select();
            }
        }, 10);
        return wrap;
    }

    function setDropFeedback(root, dragState, key, styleClass, hintText, blocked = false) {
        if (root) {
            const hintEl =
                typeof root.getElementById === 'function'
                    ? root.getElementById('drag-hint')
                    : root.querySelector('#drag-hint');
            if (hintEl) {
                hintEl.textContent = hintText || DEFAULT_DRAG_HINT;
                hintEl.classList.remove('bt-hint-blocked', 'bt-hint-active', 'bt-hint-muted');
                if (blocked) {
                    hintEl.classList.add('bt-hint-blocked');
                } else if (hintText) {
                    hintEl.classList.add('bt-hint-active');
                } else {
                    hintEl.classList.add('bt-hint-muted');
                }
            }
        }

        if (dragState && key) {
            dragState.activeHintKey = key;
        }
        if (
            dragState &&
            dragState.activeDropKey === key &&
            dragState.activeDropStyle === styleClass
        ) {
            return;
        }
        if (dragState) {
            dragState.activeDropKey = key;
            dragState.activeDropStyle = styleClass;
        }
        if (root && typeof root.querySelectorAll === 'function') {
            root.querySelectorAll('[data-drop-key]').forEach((el) => {
                el.classList.remove(
                    'drop-active-zone',
                    'drop-active-before',
                    'drop-active-after',
                    'drop-active-folder'
                );
                if (key && el.dataset && el.dataset.dropKey === key && styleClass) {
                    el.classList.add(styleClass);
                }
            });
        }
    }

    function syncLibraryGridDragging(root, dragState) {
        const grid =
            root &&
            (typeof root.getElementById === 'function'
                ? root.getElementById('library-grid')
                : typeof root.querySelector === 'function'
                  ? root.querySelector('#library-grid')
                  : null);
        if (!grid || !grid.dataset) {
            return;
        }
        if (dragState && dragState.dragPayload) {
            grid.dataset.dragging = 'true';
        } else {
            delete grid.dataset.dragging;
        }
    }

    function clearDropFeedback(root, dragState) {
        if (dragState) {
            dragState.activeHintKey = null;
        }
        syncLibraryGridDragging(root, dragState);
        setDropFeedback(root, dragState, null, null, null, false);
    }

    const dropTargetRegistry = new WeakMap();

    function applyDropPlanFeedback(root, dragState, key, plan) {
        if (!plan) {
            clearDropFeedback(root, dragState);
            return { accepted: false, blocked: false, plan: null };
        }
        if (plan.blocked) {
            setDropFeedback(root, dragState, null, null, plan.hint, true);
            if (dragState) {
                dragState.activeHintKey = key;
            }
            return { accepted: false, blocked: true, plan };
        }
        setDropFeedback(root, dragState, key, plan.style, plan.hint, false);
        return { accepted: true, blocked: false, plan };
    }

    function clearDropTarget(el) {
        if (!el) {
            return;
        }
        dropTargetRegistry.delete(el);
        if (el.dataset) {
            delete el.dataset.dropKey;
        }
        el.ondragover = null;
        el.ondragleave = null;
        el.ondrop = null;
        if (el.classList) {
            el.classList.remove(
                'drop-active-zone',
                'drop-active-before',
                'drop-active-after',
                'drop-active-folder'
            );
        }
    }

    function bindDropTarget(el, key, resolve, context = {}) {
        if (!el) {
            return;
        }
        const root = context.root || null;
        const dragState = context.dragState || {
            dragPayload: null,
            activeDropKey: null,
            activeDropStyle: null,
            activeHintKey: null,
        };

        el.dataset.dropKey = key;
        dropTargetRegistry.set(el, { el, key, resolve, root, dragState });

        el.ondragover = (e) => {
            if (!dragState.dragPayload) {
                return;
            }
            const plan = resolve(dragState.dragPayload, e);
            if (typeof e.stopPropagation === 'function') {
                e.stopPropagation();
            }
            const outcome = applyDropPlanFeedback(root, dragState, key, plan);
            if (!outcome.accepted) {
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'none';
                }
                return;
            }
            if (typeof e.preventDefault === 'function') {
                e.preventDefault();
            }
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
        };

        el.ondragleave = (e) => {
            if (typeof e.stopPropagation === 'function') {
                e.stopPropagation();
            }
            if (
                e.relatedTarget &&
                (typeof el.contains !== 'function' || !el.contains(e.relatedTarget)) &&
                (dragState.activeDropKey === key || dragState.activeHintKey === key)
            ) {
                clearDropFeedback(root, dragState);
            }
        };

        el.ondrop = (e) => {
            if (!dragState.dragPayload) {
                return;
            }
            const plan = resolve(dragState.dragPayload, e);
            if (typeof e.stopPropagation === 'function') {
                e.stopPropagation();
            }
            if (!plan || plan.blocked) {
                clearDropFeedback(root, dragState);
                return;
            }
            if (typeof e.preventDefault === 'function') {
                e.preventDefault();
            }
            dragState.dragPayload = null;
            clearDropFeedback(root, dragState);
            if (typeof plan.accept === 'function') {
                plan.accept();
            }
        };
    }

    function resolveDropTargetAtPoint(root, doc, clientX, clientY) {
        if (typeof clientX !== 'number' || typeof clientY !== 'number') {
            return null;
        }
        let hitEl = null;
        if (root && typeof root.elementFromPoint === 'function') {
            hitEl = root.elementFromPoint(clientX, clientY);
        } else if (doc && typeof doc.elementFromPoint === 'function') {
            hitEl = doc.elementFromPoint(clientX, clientY);
        }
        let curr = hitEl;
        while (curr && curr !== root) {
            if (dropTargetRegistry.has(curr)) {
                return dropTargetRegistry.get(curr);
            }
            curr = curr.parentNode || null;
        }
        return null;
    }

    function isInsideInteractiveButton(target, boundary) {
        let curr = target;
        while (curr && curr !== boundary) {
            if (curr.tagName === 'BUTTON') {
                return true;
            }
            curr = curr.parentNode || null;
        }
        return false;
    }

    function attachTouchPointerDrag({
        triggerEl,
        sourceEl,
        payload,
        label,
        root,
        doc,
        dragState,
        onSuppressClick = null,
    }) {
        if (!triggerEl || !sourceEl) {
            return;
        }
        triggerEl.onpointerdown = (e) => {
            if (e.pointerType === 'mouse') {
                return;
            }
            if (typeof e.button === 'number' && e.button !== 0) {
                return;
            }
            if (triggerEl === sourceEl && isInsideInteractiveButton(e.target, sourceEl)) {
                return;
            }
            if (dragState.cancelTouchDrag) {
                dragState.cancelTouchDrag();
            }

            const pointerId = e.pointerId ?? null;
            const startX = typeof e.clientX === 'number' ? e.clientX : 0;
            const startY = typeof e.clientY === 'number' ? e.clientY : 0;
            const handledEvents = new WeakSet();
            let started = false;
            let ghostEl = null;
            const prevOpacity = sourceEl.style ? sourceEl.style.opacity : '';

            if (typeof triggerEl.setPointerCapture === 'function' && pointerId !== null) {
                try {
                    triggerEl.setPointerCapture(pointerId);
                } catch {}
            }

            const cleanup = () => {
                if (doc && typeof doc.removeEventListener === 'function') {
                    doc.removeEventListener('pointermove', onPointerMove);
                    doc.removeEventListener('pointerup', onPointerUp);
                    doc.removeEventListener('pointercancel', onPointerCancel);
                }
                triggerEl.removeEventListener('pointermove', onPointerMove);
                triggerEl.removeEventListener('pointerup', onPointerUp);
                triggerEl.removeEventListener('pointercancel', onPointerCancel);
                if (
                    typeof triggerEl.releasePointerCapture === 'function' &&
                    pointerId !== null &&
                    typeof triggerEl.hasPointerCapture === 'function' &&
                    triggerEl.hasPointerCapture(pointerId)
                ) {
                    try {
                        triggerEl.releasePointerCapture(pointerId);
                    } catch {}
                }
                if (ghostEl && ghostEl.parentNode) {
                    ghostEl.parentNode.removeChild(ghostEl);
                }
                ghostEl = null;
                if (sourceEl.style && started) {
                    sourceEl.style.opacity = prevOpacity || '1';
                }
                if (dragState.cancelTouchDrag === cancelSession) {
                    dragState.cancelTouchDrag = null;
                }
            };

            const cancelSession = () => {
                cleanup();
                if (started) {
                    dragState.dragPayload = null;
                    clearDropFeedback(root, dragState);
                }
                started = false;
            };

            dragState.cancelTouchDrag = cancelSession;

            const isMatchingPointer = (ev) =>
                !ev ||
                handledEvents.has(ev) ||
                (pointerId !== null && ev.pointerId !== undefined && ev.pointerId !== pointerId);

            const onPointerMove = (ev) => {
                if (isMatchingPointer(ev)) {
                    return;
                }
                handledEvents.add(ev);
                const clientX = typeof ev.clientX === 'number' ? ev.clientX : startX;
                const clientY = typeof ev.clientY === 'number' ? ev.clientY : startY;
                const dx = clientX - startX;
                const dy = clientY - startY;

                if (!started) {
                    if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) {
                        return;
                    }
                    started = true;
                    dragState.dragPayload = payload;
                    syncLibraryGridDragging(root, dragState);
                    if (sourceEl.style) {
                        sourceEl.style.opacity = '0.5';
                    }
                    if (doc && root) {
                        ghostEl = doc.createElement('div');
                        ghostEl.className = 'pill-base bt-touch-ghost';
                        ghostEl.textContent = label || payload.scriptId || 'Item';
                        root.appendChild(ghostEl);
                    }
                }

                if (typeof ev.preventDefault === 'function') {
                    ev.preventDefault();
                }
                if (ghostEl && ghostEl.style) {
                    ghostEl.style.left = `${Math.round(clientX)}px`;
                    ghostEl.style.top = `${Math.round(clientY)}px`;
                }

                const hit = resolveDropTargetAtPoint(root, doc, clientX, clientY);
                if (!hit) {
                    clearDropFeedback(root, dragState);
                    return;
                }
                const plan = hit.resolve(dragState.dragPayload, { clientX, clientY });
                applyDropPlanFeedback(root, dragState, hit.key, plan);
            };

            const onPointerUp = (ev) => {
                if (isMatchingPointer(ev)) {
                    return;
                }
                handledEvents.add(ev);
                const clientX = typeof ev.clientX === 'number' ? ev.clientX : startX;
                const clientY = typeof ev.clientY === 'number' ? ev.clientY : startY;
                const wasStarted = started;
                cleanup();
                if (!wasStarted) {
                    return;
                }
                if (typeof onSuppressClick === 'function') {
                    onSuppressClick();
                }
                const activePayload = dragState.dragPayload;
                const hit = activePayload
                    ? resolveDropTargetAtPoint(root, doc, clientX, clientY)
                    : null;
                const plan = hit ? hit.resolve(activePayload, { clientX, clientY }) : null;
                dragState.dragPayload = null;
                clearDropFeedback(root, dragState);
                if (plan && !plan.blocked && typeof plan.accept === 'function') {
                    plan.accept();
                }
            };

            const onPointerCancel = (ev) => {
                if (isMatchingPointer(ev)) {
                    return;
                }
                handledEvents.add(ev);
                cancelSession();
            };

            if (doc && typeof doc.addEventListener === 'function') {
                doc.addEventListener('pointermove', onPointerMove);
                doc.addEventListener('pointerup', onPointerUp);
                doc.addEventListener('pointercancel', onPointerCancel);
            }
            triggerEl.addEventListener('pointermove', onPointerMove);
            triggerEl.addEventListener('pointerup', onPointerUp);
            triggerEl.addEventListener('pointercancel', onPointerCancel);
        };
    }

    function attachDraggable(el, payload, root, dragState) {
        el.draggable = true;
        el.ondragstart = (e) => {
            dragState.dragPayload = payload;
            syncLibraryGridDragging(root, dragState);
            if (e && e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                if (typeof e.dataTransfer.setData === 'function') {
                    e.dataTransfer.setData(
                        'text/plain',
                        payload.scriptId || String(payload.index ?? '')
                    );
                }
            }
            if (el.style) {
                el.style.opacity = '0.5';
            }
        };
        el.ondragend = () => {
            if (el.style) {
                el.style.opacity = '1';
            }
            dragState.dragPayload = null;
            clearDropFeedback(root, dragState);
        };
    }

    function getHalfSide(el, e) {
        if (!el || typeof el.getBoundingClientRect !== 'function') {
            return 'after';
        }
        const rect = el.getBoundingClientRect();
        const clientX = typeof e?.clientX === 'number' ? e.clientX : rect.left + rect.width;
        return clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    }

    function makeMiniBtn(doc, text, onClick, primary = false, title = '', square = false) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = primary
            ? 'bt-mini-btn bt-mini-btn-primary'
            : `bt-mini-btn ${square ? 'bt-mini-btn-square' : ''}`.trim();
        b.textContent = text;
        if (title) {
            b.title = title;
        }
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return b;
    }

    function createToolbarUI(options = {}) {
        const mountRoot = options.mountRoot || null;
        const doc =
            options.doc ||
            (mountRoot && mountRoot.ownerDocument) ||
            (typeof document !== 'undefined' ? document : null);
        const win =
            options.win ||
            (doc && doc.defaultView) ||
            (typeof window !== 'undefined' ? window : null);
        const customAdapter = options.adapter || null;
        const callbacks = options.callbacks || {};

        const init = options.initialState || {};
        const initialLayout = Array.isArray(init.layout) ? init.layout : [];
        const firstFolder = initialLayout.find((n) => n && n.type === 'folder');

        const state = {
            url:
                init.url ||
                (win && win.location && win.location.href) ||
                'https://example.com/',
            packs: init.packs && typeof init.packs === 'object' ? { ...init.packs } : {},
            localScripts:
                init.localScripts && typeof init.localScripts === 'object'
                    ? { ...init.localScripts }
                    : {},
            layout: initialLayout,
            recents:
                init.recents && typeof init.recents === 'object' ? { ...init.recents } : {},
            settings: Core.normalizeSettings(init.settings),

            // Ephemeral UI state
            dockHoverExpanded: false,
            ephemeralDockExpanded: false,
            ephemeralDockSnapZone: 'bottom-center',
            openDropdownId: null,
            paletteOpen: false,
            paletteQuery: '',
            paletteIndex: 0,
            paletteItems: [],
            managerOpen: false,
            selectedFolderId:
                init.selectedFolderId !== undefined
                    ? init.selectedFolderId
                    : firstFolder
                      ? firstFolder.id
                      : null,
            addingFolderInline: false,
            renamingFolderId: null,
            editingLabelIndex: null,
            editingFolderItem: null,
            editingScriptId: null,
            editorOpen: false,
            exportOpen: false,
            importOpen: false,
            openInfoId: null,
            recordingHotkey: false,
            pendingConfirm: null,
            mgrSearch: '',
            mgrOnlySite: false,
            dragState: {
                dragPayload: null,
                activeDropKey: null,
                activeDropStyle: null,
                activeHintKey: null,
                cancelTouchDrag: null,
            },
        };

        let toolbarHost = null;
        let toolbarShadow = null;
        let toolbarContainer = null;
        let toolbarMounted = false;
        let activeAdapter = null;
        let activeDockDrag = null;
        let dockSnapOverlay = null;
        let suppressNextHandleClick = false;
        let suppressNextFolderPillClick = false;
        let lastTouchPointerAt = 0;
        let isRenderingToolbar = false;

        let overlayHost = null;
        let overlayShadow = null;
        let overlayEls = null;
        let toastTimer = null;

        function getScriptsMap() {
            return Core.buildScriptsMap(state.packs, state.localScripts);
        }

        function getCurrentOrigin() {
            return Core.getSiteOrigin(state.url);
        }

        function getDockSnapZone() {
            const origin = getCurrentOrigin();
            const zone = origin
                ? state.settings?.dockSitePositions?.[origin]
                : state.ephemeralDockSnapZone;
            return Core.DOCK_SNAP_ZONES.includes(zone) ? zone : 'bottom-center';
        }

        function getDockExpandMode() {
            const mode = state.settings?.dockExpandMode;
            return Core.DOCK_EXPAND_MODES.includes(mode) ? mode : 'both';
        }

        function isDockPinnedExpanded() {
            const origin = getCurrentOrigin();
            return origin
                ? state.settings?.dockSiteExpanded?.[origin] === true
                : state.ephemeralDockExpanded;
        }

        function isDockExpanded() {
            const mode = getDockExpandMode();
            if (mode === 'click') {
                return isDockPinnedExpanded();
            }
            if (mode === 'hover') {
                return Boolean(state.dockHoverExpanded);
            }
            return isDockPinnedExpanded() || Boolean(state.dockHoverExpanded);
        }

        function toggleDockPinnedExpanded() {
            if (getDockExpandMode() === 'hover') {
                return;
            }
            const origin = getCurrentOrigin();
            const nextExpanded = !isDockPinnedExpanded();
            if (!nextExpanded) {
                state.dockHoverExpanded = false;
                state.openDropdownId = null;
            }
            if (!origin) {
                state.ephemeralDockExpanded = nextExpanded;
                renderToolbarView();
                return;
            }
            const nextSettings = Core.normalizeSettings({
                ...state.settings,
                dockSiteExpanded: {
                    ...(state.settings?.dockSiteExpanded || {}),
                    [origin]: nextExpanded,
                },
            });
            emitStateChange({ settings: nextSettings });
            renderToolbarView();
        }

        function setDockSnapZone(zone) {
            if (!Core.DOCK_SNAP_ZONES.includes(zone)) {
                return;
            }
            const origin = getCurrentOrigin();
            if (!origin) {
                state.ephemeralDockSnapZone = zone;
                renderToolbarView();
                return;
            }
            const nextSettings = Core.normalizeSettings({
                ...state.settings,
                dockSitePositions: {
                    ...(state.settings?.dockSitePositions || {}),
                    [origin]: zone,
                },
            });
            emitStateChange({ settings: nextSettings });
            renderToolbarView();
        }

        function setDockExpandMode(mode) {
            if (!Core.DOCK_EXPAND_MODES.includes(mode)) {
                return;
            }
            if (mode === 'click') {
                state.dockHoverExpanded = false;
            }
            const nextSettings = Core.normalizeSettings({
                ...state.settings,
                dockExpandMode: mode,
            });
            emitStateChange({ settings: nextSettings });
            renderAll();
        }

        function toggleDockOnCurrentSite() {
            const origin = getCurrentOrigin();
            if (!origin) {
                showToast('Dock visibility per site requires an HTTP(S) origin.');
                return;
            }
            const nextHidden = !(state.settings?.dockSiteHidden?.[origin] === true);
            const nextSettings = Core.normalizeSettings({
                ...state.settings,
                dockSiteHidden: {
                    ...(state.settings?.dockSiteHidden || {}),
                    [origin]: nextHidden,
                },
            });
            emitStateChange({ settings: nextSettings });
            renderAll();
            showToast(
                nextHidden
                    ? `Dock hidden on ${getSiteBrand(state.url)}`
                    : `Dock shown on ${getSiteBrand(state.url)}`
            );
        }

        function clearDockSnapOverlay() {
            if (dockSnapOverlay && dockSnapOverlay.parentNode) {
                dockSnapOverlay.parentNode.removeChild(dockSnapOverlay);
            }
            dockSnapOverlay = null;
        }

        function showDockSnapOverlay(activeZone) {
            ensureOverlayMounted();
            if (!overlayShadow) {
                return;
            }
            if (!dockSnapOverlay) {
                dockSnapOverlay = doc.createElement('div');
                dockSnapOverlay.className = 'bt-dock-snap-overlay';
                for (const zone of Core.DOCK_SNAP_ZONES) {
                    const zoneEl = doc.createElement('div');
                    zoneEl.className = 'bt-dock-snap-zone';
                    zoneEl.dataset.snapZone = zone;
                    zoneEl.textContent = DOCK_SNAP_LABELS[zone] || zone;
                    dockSnapOverlay.appendChild(zoneEl);
                }
                overlayShadow.appendChild(dockSnapOverlay);
            }
            dockSnapOverlay.querySelectorAll('.bt-dock-snap-zone').forEach((zoneEl) => {
                const isMatch = zoneEl.dataset?.snapZone === activeZone;
                zoneEl.classList.toggle('bt-dock-snap-zone-active', isMatch);
            });
        }

        function attachDockHandleDrag(handleBtn) {
            handleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (suppressNextHandleClick) {
                    suppressNextHandleClick = false;
                    return;
                }
                toggleDockPinnedExpanded();
            });

            handleBtn.addEventListener('pointerdown', (e) => {
                if (activeDockDrag) {
                    return;
                }
                if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) {
                    return;
                }
                if (e.pointerType === 'touch') {
                    lastTouchPointerAt = Date.now();
                }
                suppressNextHandleClick = false;

                const pointerId = e.pointerId ?? null;
                const startX = typeof e.clientX === 'number' ? e.clientX : 0;
                const startY = typeof e.clientY === 'number' ? e.clientY : 0;
                const handledEvents = new WeakSet();

                if (typeof handleBtn.setPointerCapture === 'function' && pointerId !== null) {
                    try {
                        handleBtn.setPointerCapture(pointerId);
                    } catch {}
                }

                const cleanup = () => {
                    if (doc && typeof doc.removeEventListener === 'function') {
                        doc.removeEventListener('pointermove', onPointerMove);
                        doc.removeEventListener('pointerup', onPointerUp);
                        doc.removeEventListener('pointercancel', onPointerCancel);
                    }
                    handleBtn.removeEventListener('pointermove', onPointerMove);
                    handleBtn.removeEventListener('pointerup', onPointerUp);
                    handleBtn.removeEventListener('pointercancel', onPointerCancel);
                    if (
                        typeof handleBtn.releasePointerCapture === 'function' &&
                        pointerId !== null &&
                        typeof handleBtn.hasPointerCapture === 'function' &&
                        handleBtn.hasPointerCapture(pointerId)
                    ) {
                        try {
                            handleBtn.releasePointerCapture(pointerId);
                        } catch {}
                    }
                    handleBtn.classList.remove('bt-dock-handle-dragging');
                    clearDockSnapOverlay();
                    activeDockDrag = null;
                };

                const session = {
                    pointerId,
                    startX,
                    startY,
                    dragging: false,
                    targetZone: getDockSnapZone(),
                    cleanup,
                };
                activeDockDrag = session;

                const isMatchingPointer = (ev) =>
                    !ev ||
                    activeDockDrag !== session ||
                    handledEvents.has(ev) ||
                    (pointerId !== null &&
                        ev.pointerId !== undefined &&
                        ev.pointerId !== pointerId);

                const onPointerMove = (ev) => {
                    if (isMatchingPointer(ev)) {
                        return;
                    }
                    handledEvents.add(ev);
                    if (ev.pointerType === 'touch') {
                        lastTouchPointerAt = Date.now();
                    }
                    const clientX = typeof ev.clientX === 'number' ? ev.clientX : session.startX;
                    const clientY = typeof ev.clientY === 'number' ? ev.clientY : session.startY;
                    const dx = clientX - session.startX;
                    const dy = clientY - session.startY;

                    if (!session.dragging) {
                        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) {
                            return;
                        }
                        session.dragging = true;
                        handleBtn.classList.add('bt-dock-handle-dragging');
                    }

                    if (typeof ev.preventDefault === 'function') {
                        ev.preventDefault();
                    }
                    const nextZone = resolveNearestSnapZone(win, doc, clientX, clientY);
                    session.targetZone = nextZone;
                    showDockSnapOverlay(nextZone);
                    if (!mountRoot && toolbarHost) {
                        applyDockPosition(toolbarHost, getDockSnapZone(), { dx, dy });
                    }
                };

                const onPointerUp = (ev) => {
                    if (isMatchingPointer(ev)) {
                        return;
                    }
                    handledEvents.add(ev);
                    if (ev.pointerType === 'touch') {
                        lastTouchPointerAt = Date.now();
                    }
                    const wasDragging = session.dragging;
                    const targetZone = session.targetZone;
                    cleanup();
                    suppressNextHandleClick = true;
                    setTimeout(() => {
                        suppressNextHandleClick = false;
                    }, 0);
                    if (wasDragging) {
                        if (!mountRoot && toolbarHost) {
                            applyDockPosition(toolbarHost, targetZone);
                        }
                        setDockSnapZone(targetZone);
                    } else {
                        toggleDockPinnedExpanded();
                    }
                };

                const onPointerCancel = (ev) => {
                    if (isMatchingPointer(ev)) {
                        return;
                    }
                    handledEvents.add(ev);
                    cleanup();
                    if (!mountRoot && toolbarHost) {
                        applyDockPosition(toolbarHost, getDockSnapZone());
                    }
                };

                if (doc && typeof doc.addEventListener === 'function') {
                    doc.addEventListener('pointermove', onPointerMove);
                    doc.addEventListener('pointerup', onPointerUp);
                    doc.addEventListener('pointercancel', onPointerCancel);
                }
                handleBtn.addEventListener('pointermove', onPointerMove);
                handleBtn.addEventListener('pointerup', onPointerUp);
                handleBtn.addEventListener('pointercancel', onPointerCancel);
            });
        }

        function emitStateChange(partial) {
            Object.assign(state, partial);
            if (typeof callbacks.onStateChange === 'function') {
                callbacks.onStateChange(partial, {
                    url: state.url,
                    packs: state.packs,
                    localScripts: state.localScripts,
                    layout: state.layout,
                    recents: state.recents,
                    settings: state.settings,
                });
            }
        }

        function triggerRunScript(scriptId) {
            const scriptsMap = getScriptsMap();
            const script = scriptsMap[scriptId];
            if (!script) {
                return;
            }
            const nextRecents = {
                ...state.recents,
                [scriptId]: {
                    lastRunAt: Date.now(),
                    count: (state.recents[scriptId]?.count || 0) + 1,
                },
            };
            state.openDropdownId = null;
            state.paletteOpen = false;
            emitStateChange({ recents: nextRecents });
            renderAll();
            if (typeof callbacks.onRunScript === 'function') {
                callbacks.onRunScript(scriptId, script);
            }
        }

        function ensureToolbarHostCreated() {
            if (toolbarHost) {
                return;
            }
            toolbarHost = doc.createElement('div');
            toolbarHost.id = 'userjs-bt-toolbar-host';
            toolbarShadow = toolbarHost.attachShadow({ mode: 'open' });

            const styleEl = doc.createElement('style');
            styleEl.textContent = buildStyles();
            toolbarShadow.appendChild(styleEl);

            toolbarContainer = doc.createElement('div');
            toolbarContainer.id = 'bt-toolbar-container';
            toolbarContainer.addEventListener('mouseenter', () => {
                if (activeDockDrag || getDockExpandMode() === 'click') {
                    return;
                }
                if (Date.now() - lastTouchPointerAt < 400) {
                    return;
                }
                if (!state.dockHoverExpanded) {
                    state.dockHoverExpanded = true;
                    renderToolbarView();
                }
            });
            toolbarContainer.addEventListener('mouseleave', () => {
                if (activeDockDrag || getDockExpandMode() === 'click') {
                    return;
                }
                if (state.dockHoverExpanded) {
                    state.dockHoverExpanded = false;
                    if (!isDockExpanded()) {
                        state.openDropdownId = null;
                    }
                    renderToolbarView();
                }
            });
            toolbarContainer.addEventListener('focusin', () => {
                if (isRenderingToolbar || activeDockDrag || getDockExpandMode() !== 'hover') {
                    return;
                }
                if (!state.dockHoverExpanded) {
                    state.dockHoverExpanded = true;
                    renderToolbarView();
                }
            });
            toolbarContainer.addEventListener('focusout', (e) => {
                if (isRenderingToolbar || activeDockDrag || getDockExpandMode() !== 'hover') {
                    return;
                }
                const nextTarget = e?.relatedTarget || null;
                if (nextTarget && toolbarContainer.contains(nextTarget)) {
                    return;
                }
                if (state.dockHoverExpanded) {
                    state.dockHoverExpanded = false;
                    state.openDropdownId = null;
                    renderToolbarView();
                }
            });
            toolbarShadow.appendChild(toolbarContainer);
        }

        function unmountToolbarHost() {
            if (activeDockDrag && typeof activeDockDrag.cleanup === 'function') {
                activeDockDrag.cleanup();
            }
            if (!toolbarHost) {
                toolbarMounted = false;
                return;
            }
            if (activeAdapter && typeof activeAdapter.unmount === 'function') {
                activeAdapter.unmount(doc, toolbarHost);
            } else if (typeof toolbarHost.remove === 'function') {
                toolbarHost.remove();
            } else if (toolbarHost.parentNode) {
                toolbarHost.parentNode.removeChild(toolbarHost);
            }
            toolbarMounted = false;
        }

        function renderToolbarView() {
            if (!doc) {
                return;
            }
            const scriptsMap = getScriptsMap();
            const shouldMount = Core.shouldMountToolbar(
                state.layout,
                scriptsMap,
                state.url,
                state.settings
            );
            if (!shouldMount) {
                state.openDropdownId = null;
                state.dockHoverExpanded = false;
                unmountToolbarHost();
                return;
            }

            ensureToolbarHostCreated();

            const nextAdapter =
                customAdapter ||
                (Adapters && typeof Adapters.resolveMountAdapter === 'function'
                    ? Adapters.resolveMountAdapter(state.url, doc)
                    : null);
            activeAdapter = nextAdapter;

            if (mountRoot && !customAdapter) {
                if (toolbarHost.parentNode !== mountRoot) {
                    mountRoot.appendChild(toolbarHost);
                }
                toolbarMounted = true;
            } else if (activeAdapter && typeof activeAdapter.mount === 'function') {
                toolbarMounted = Boolean(activeAdapter.mount(doc, toolbarHost));
            } else {
                const fallbackParent = doc.body || doc.documentElement;
                if (fallbackParent && toolbarHost.parentNode !== fallbackParent) {
                    fallbackParent.appendChild(toolbarHost);
                }
                toolbarMounted = Boolean(toolbarHost.parentNode);
            }

            if (toolbarMounted && typeof callbacks.onAdapterMount === 'function') {
                callbacks.onAdapterMount(toolbarHost, activeAdapter);
            }

            const snapZone = getDockSnapZone();
            if (!mountRoot) {
                applyDockPosition(toolbarHost, snapZone);
            }

            const expanded = isDockExpanded();
            const expandMode = getDockExpandMode();
            const hasRemoved = Core.hasRemovedPlacedScript(state.layout, scriptsMap);

            isRenderingToolbar = true;
            try {
                clearNode(toolbarContainer);
                toolbarContainer.className = expanded
                    ? 'bt-toolbar-dock'
                    : 'bt-toolbar-dock bt-toolbar-dock-collapsed';

                const handleBtn = doc.createElement('button');
                handleBtn.type = 'button';
                handleBtn.className = 'bt-dock-handle';
                handleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                handleBtn.setAttribute(
                    'aria-label',
                    `Bookmarklet Toolbar (${expanded ? 'expanded' : 'collapsed'}). Click to toggle, drag to move.`
                );
                handleBtn.title =
                    expandMode === 'hover'
                        ? 'Bookmarklet Toolbar (drag to snap to any corner or edge)'
                        : 'Bookmarklet Toolbar (click to expand/collapse, drag to snap)';
                handleBtn.appendChild(createBookmarkBoltSvg(doc));
                if (hasRemoved) {
                    const handleDot = doc.createElement('span');
                    handleDot.className = 'bt-amber-dot';
                    if (!expanded) {
                        handleDot.dataset.removedBadge = 'true';
                    }
                    handleBtn.appendChild(handleDot);
                }
                attachDockHandleDrag(handleBtn);
                toolbarContainer.appendChild(handleBtn);

                if (!expanded) {
                    state.openDropdownId = null;
                    return;
                }

                const visibleNodes = Core.getVisibleLayoutForUrl(
                    state.layout,
                    scriptsMap,
                    state.url
                );

                visibleNodes.forEach((node) => {
                    if (node.type === 'script') {
                        const btn = doc.createElement('button');
                        btn.type = 'button';
                        btn.className = `bt-btn-dark ${node.removed ? 'bt-btn-dark-removed' : ''}`.trim();
                        btn.dataset.scriptId = node.scriptId;
                        btn.title = node.removed
                            ? `${node.script.name} (Removed from pack)`
                            : node.script.description || node.script.name;
                        btn.textContent = node.displayLabel + (node.removed ? ' ⚠' : '');
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            triggerRunScript(node.scriptId);
                        });
                        toolbarContainer.appendChild(btn);
                    } else if (node.type === 'folder') {
                        const wrap = doc.createElement('div');
                        wrap.className = 'bt-folder-wrap';

                        const btn = doc.createElement('button');
                        btn.type = 'button';
                        btn.className = 'bt-btn-dark';
                        btn.dataset.folderId = node.id;
                        btn.textContent = `${node.name} ▾`;
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            state.openDropdownId =
                                state.openDropdownId === node.id ? null : node.id;
                            renderToolbarView();
                        });
                        wrap.appendChild(btn);

                        let openMenu = null;
                        if (state.openDropdownId === node.id) {
                            const menu = doc.createElement('div');
                            menu.className = getDropdownClasses(snapZone);
                            node.items.forEach((item) => {
                                const row = doc.createElement('button');
                                row.type = 'button';
                                row.className = 'bt-dropdown-item';
                                row.dataset.scriptId = item.scriptId;
                                row.textContent =
                                    item.displayLabel + (item.removed ? ' ⚠' : '');
                                row.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    triggerRunScript(item.scriptId);
                                });
                                menu.appendChild(row);
                            });
                            wrap.appendChild(menu);
                            openMenu = menu;
                        }
                        toolbarContainer.appendChild(wrap);
                        if (openMenu) {
                            clampDropdownToViewport(openMenu, win, doc);
                        }
                    }
                });

                const utilBtn = doc.createElement('button');
                utilBtn.type = 'button';
                utilBtn.className = 'bt-btn-util-dark';
                utilBtn.dataset.action = 'open-palette';
                utilBtn.title = `Open Command Palette (${state.settings.hotkey})`;
                utilBtn.textContent = '⌘';
                if (hasRemoved) {
                    const dot = doc.createElement('span');
                    dot.className = 'bt-amber-dot';
                    dot.dataset.removedBadge = 'true';
                    utilBtn.appendChild(dot);
                }
                utilBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPalette();
                });
                toolbarContainer.appendChild(utilBtn);
            } finally {
                isRenderingToolbar = false;
            }
        }

        function ensureOverlayMounted() {
            if (!doc) {
                return;
            }
            if (!overlayHost) {
                overlayHost = doc.createElement('div');
                overlayHost.id = 'userjs-bt-overlay-host';
                overlayHost.style.cssText =
                    'position: fixed; inset: 0; z-index: 2147483645; pointer-events: none;';
                overlayShadow = overlayHost.attachShadow({ mode: 'open' });

                const styleEl = doc.createElement('style');
                styleEl.textContent = buildStyles();
                overlayShadow.appendChild(styleEl);

                overlayEls = buildOverlaySkeleton(overlayShadow);
            }

            const parent = mountRoot || doc.body || doc.documentElement;
            if (parent && overlayHost.parentNode !== parent) {
                parent.appendChild(overlayHost);
            }
        }

        function buildOverlaySkeleton(root) {
            const toast = doc.createElement('div');
            toast.id = 'toast';
            toast.className = 'bt-toast hidden';
            root.appendChild(toast);

            // 1. Command Palette Backdrop
            const paletteBackdrop = doc.createElement('div');
            paletteBackdrop.id = 'palette-backdrop';
            paletteBackdrop.className = 'bt-backdrop bt-backdrop-top hidden';
            paletteBackdrop.addEventListener('click', (e) => {
                if (e.target === paletteBackdrop) {
                    state.paletteOpen = false;
                    renderPaletteView();
                }
            });

            const paletteModal = doc.createElement('div');
            paletteModal.className = 'bt-modal';

            const paletteSearchRow = doc.createElement('div');
            paletteSearchRow.className = 'bt-palette-search-row';
            const cmdIcon = doc.createElement('span');
            cmdIcon.className = 'bt-badge';
            cmdIcon.textContent = '⌘';
            const paletteSearch = doc.createElement('input');
            paletteSearch.id = 'palette-search';
            paletteSearch.type = 'text';
            paletteSearch.placeholder = "Search matching scripts or type 'settings'…";
            paletteSearch.className = 'bt-palette-input';
            const paletteClose = doc.createElement('button');
            paletteClose.id = 'palette-close';
            paletteClose.type = 'button';
            paletteClose.className = 'bt-close-btn';
            paletteClose.title = 'Close (Esc)';
            paletteClose.textContent = '×';
            paletteClose.addEventListener('click', () => {
                state.paletteOpen = false;
                renderPaletteView();
            });
            paletteSearchRow.append(cmdIcon, paletteSearch, paletteClose);

            const paletteList = doc.createElement('div');
            paletteList.id = 'palette-list';
            paletteList.className = 'bt-palette-list';

            const paletteFooter = doc.createElement('div');
            paletteFooter.className = 'bt-palette-footer';
            const paletteHint = doc.createElement('span');
            paletteHint.textContent = '↑/↓ navigate • Enter run';
            const paletteOpenSettings = doc.createElement('button');
            paletteOpenSettings.id = 'palette-open-settings';
            paletteOpenSettings.type = 'button';
            paletteOpenSettings.className = 'bt-action-btn';
            const paletteSettingsText = doc.createElement('span');
            paletteSettingsText.textContent = '⚙ Settings / Manager';
            const paletteRemovedDot = doc.createElement('span');
            paletteRemovedDot.id = 'palette-removed-dot';
            paletteRemovedDot.className = 'bt-amber-dot hidden';
            paletteOpenSettings.append(paletteSettingsText, paletteRemovedDot);
            paletteOpenSettings.addEventListener('click', () => {
                openManager();
            });
            paletteFooter.append(paletteHint, paletteOpenSettings);

            paletteModal.append(paletteSearchRow, paletteList, paletteFooter);
            paletteBackdrop.appendChild(paletteModal);
            root.appendChild(paletteBackdrop);

            paletteSearch.addEventListener('input', (e) => {
                state.paletteQuery = e.target.value || '';
                state.paletteIndex = 0;
                renderPaletteView();
            });
            paletteSearch.addEventListener('keydown', (e) => {
                const list = state.paletteItems || [];
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    state.paletteOpen = false;
                    renderPaletteView();
                    return;
                }
                if (!list.length) {
                    return;
                }
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    state.paletteIndex = (state.paletteIndex + 1) % list.length;
                    renderPaletteView();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    state.paletteIndex =
                        (state.paletteIndex - 1 + list.length) % list.length;
                    renderPaletteView();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const target = list[state.paletteIndex];
                    if (!target) {
                        return;
                    }
                    if (target.kind === 'script') {
                        triggerRunScript(target.script.id);
                    } else if (target.id === 'open-settings') {
                        openManager();
                    } else if (target.id === 'toggle-dock-site') {
                        state.paletteOpen = false;
                        toggleDockOnCurrentSite();
                    }
                }
            });

            // 2. Manager Backdrop
            const managerBackdrop = doc.createElement('div');
            managerBackdrop.id = 'manager-backdrop';
            managerBackdrop.className = 'bt-backdrop bt-backdrop-top hidden';
            managerBackdrop.addEventListener('click', (e) => {
                if (e.target === managerBackdrop) {
                    state.managerOpen = false;
                    state.openInfoId = null;
                    state.openInfoTriggerEl = null;
                    state.recordingHotkey = false;
                    renderManagerView();
                } else if (state.openInfoId) {
                    state.openInfoId = null;
                    state.openInfoTriggerEl = null;
                    renderManagerView();
                }
            });

            const managerModal = doc.createElement('div');
            managerModal.className = 'bt-modal bt-modal-lg';

            const managerHeader = doc.createElement('div');
            managerHeader.className = 'bt-modal-header';

            const hdrTop = doc.createElement('div');
            hdrTop.className = 'bt-row-start-between';
            const hdrTitleBlock = doc.createElement('div');
            const hdrTitle = doc.createElement('div');
            hdrTitle.className = 'bt-title';
            hdrTitle.textContent = 'Bookmarklet Toolbar — Settings & Manager';
            const hdrSub = doc.createElement('div');
            hdrSub.className = 'bt-subtitle';
            hdrSub.textContent =
                'Drag Library cards into the sticky Toolbar or any 📁 Folder above. ★ toggles Toolbar pin; × removes from Folder.';
            hdrTitleBlock.append(hdrTitle, hdrSub);

            const managerClose = doc.createElement('button');
            managerClose.id = 'manager-close';
            managerClose.type = 'button';
            managerClose.className = 'bt-close-btn';
            managerClose.title = 'Close (Esc)';
            managerClose.textContent = '×';
            managerClose.addEventListener('click', () => {
                state.managerOpen = false;
                state.openInfoId = null;
                state.openInfoTriggerEl = null;
                state.recordingHotkey = false;
                renderManagerView();
            });
            hdrTop.append(hdrTitleBlock, managerClose);

            const hdrSubBar = doc.createElement('div');
            hdrSubBar.className = 'bt-row-between bt-row-wrap';
            hdrSubBar.style.marginTop = '10px';

            const hdrLeftActions = doc.createElement('div');
            hdrLeftActions.className = 'bt-row-wrap';

            const btnNewLocal = doc.createElement('button');
            btnNewLocal.id = 'btn-new-local';
            btnNewLocal.type = 'button';
            btnNewLocal.className = 'bt-action-btn bt-action-btn-primary';
            btnNewLocal.textContent = '+ New Local Script';
            btnNewLocal.addEventListener('click', () => openEditorModal(null));

            const btnExportOpen = doc.createElement('button');
            btnExportOpen.id = 'btn-export-open';
            btnExportOpen.type = 'button';
            btnExportOpen.className = 'bt-action-btn';
            btnExportOpen.textContent = 'Export';
            btnExportOpen.addEventListener('click', () => openExportModal());

            const btnImportOpen = doc.createElement('button');
            btnImportOpen.id = 'btn-import-open';
            btnImportOpen.type = 'button';
            btnImportOpen.className = 'bt-action-btn';
            btnImportOpen.textContent = 'Import';
            btnImportOpen.addEventListener('click', () => openImportModal());

            hdrLeftActions.append(btnNewLocal, btnExportOpen, btnImportOpen);

            const btnHotkeyRecord = doc.createElement('button');
            btnHotkeyRecord.id = 'btn-hotkey-record';
            btnHotkeyRecord.type = 'button';
            btnHotkeyRecord.className = 'bt-action-btn';
            btnHotkeyRecord.title =
                'Click and press a key combination to change Command Palette shortcut';
            btnHotkeyRecord.addEventListener('click', (e) => {
                e.stopPropagation();
                state.recordingHotkey = !state.recordingHotkey;
                renderManagerView();
            });

            hdrSubBar.append(hdrLeftActions, btnHotkeyRecord);

            const hdrDockBar = doc.createElement('div');
            hdrDockBar.className = 'bt-row-between bt-row-wrap';
            hdrDockBar.style.marginTop = '8px';

            const dockModeWrap = doc.createElement('div');
            dockModeWrap.className = 'bt-row-wrap';
            const dockModeLabel = doc.createElement('span');
            dockModeLabel.className = 'bt-subtitle';
            dockModeLabel.style.marginTop = '0';
            dockModeLabel.textContent = 'Dock expand:';
            const dockModeGroup = doc.createElement('div');
            dockModeGroup.id = 'dock-expand-mode-group';
            dockModeGroup.className = 'bt-segmented';
            dockModeGroup.setAttribute('role', 'group');
            dockModeGroup.setAttribute('aria-label', 'Dock expand mode');

            const dockModeButtons = {};
            [
                { id: 'both', label: 'Hover + Click' },
                { id: 'click', label: 'Click' },
                { id: 'hover', label: 'Hover' },
            ].forEach(({ id, label }) => {
                const modeBtn = doc.createElement('button');
                modeBtn.type = 'button';
                modeBtn.className = 'bt-segmented-btn';
                modeBtn.dataset.dockExpandMode = id;
                modeBtn.textContent = label;
                modeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setDockExpandMode(id);
                });
                dockModeButtons[id] = modeBtn;
                dockModeGroup.appendChild(modeBtn);
            });
            dockModeWrap.append(dockModeLabel, dockModeGroup);

            const btnToggleDockSite = doc.createElement('button');
            btnToggleDockSite.id = 'btn-toggle-dock-site';
            btnToggleDockSite.type = 'button';
            btnToggleDockSite.className = 'bt-action-btn';
            btnToggleDockSite.dataset.action = 'toggle-dock-site';
            btnToggleDockSite.textContent = 'Hide dock on this site';
            btnToggleDockSite.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDockOnCurrentSite();
            });

            hdrDockBar.append(dockModeWrap, btnToggleDockSite);
            managerHeader.append(hdrTop, hdrSubBar, hdrDockBar);

            const managerBody = doc.createElement('div');
            managerBody.className = 'bt-manager-body';
            managerBody.addEventListener('scroll', () => {
                if (state.openInfoId !== null) {
                    state.openInfoId = null;
                    state.openInfoTriggerEl = null;
                    renderManagerView();
                }
            });

            const stickySection = doc.createElement('div');
            stickySection.className = 'bt-sticky-section';
            const stickyTopRow = doc.createElement('div');
            stickyTopRow.className = 'bt-row-between bt-row-wrap';
            const stickyLabel = doc.createElement('span');
            stickyLabel.className = 'bt-section-label';
            stickyLabel.textContent = 'Toolbar Layout';
            const dragHint = doc.createElement('span');
            dragHint.id = 'drag-hint';
            dragHint.className = 'bt-hint-muted';
            dragHint.textContent = DEFAULT_DRAG_HINT;
            stickyTopRow.append(stickyLabel, dragHint);

            const toolbarStrip = doc.createElement('div');
            toolbarStrip.id = 'toolbar-strip';
            toolbarStrip.className = 'bt-toolbar-strip';

            const folderDrawer = doc.createElement('div');
            folderDrawer.id = 'folder-drawer';
            folderDrawer.className = 'bt-folder-drawer hidden';

            stickySection.append(stickyTopRow, toolbarStrip, folderDrawer);

            const librarySection = doc.createElement('div');
            librarySection.className = 'bt-library-section';

            const libHeader = doc.createElement('div');
            libHeader.className = 'bt-row-between bt-row-wrap';

            const libLeft = doc.createElement('div');
            libLeft.className = 'bt-row-wrap';
            libLeft.style.position = 'relative';

            const libTitle = doc.createElement('span');
            libTitle.className = 'bt-section-label';
            libTitle.textContent = 'Library';

            const packInfoBtn = doc.createElement('button');
            packInfoBtn.id = 'pack-info-btn';
            packInfoBtn.type = 'button';
            packInfoBtn.className = 'bt-badge';
            packInfoBtn.style.cursor = 'pointer';
            const packBadgeLabel = doc.createElement('span');
            packBadgeLabel.id = 'pack-badge-label';
            const packInfoIcon = doc.createElement('span');
            packInfoIcon.textContent = ' ⓘ';
            packInfoBtn.append(packBadgeLabel, packInfoIcon);
            packInfoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.openInfoId = state.openInfoId === 'pack' ? null : 'pack';
                state.openInfoTriggerEl = null;
                renderManagerView();
            });

            const packInfoPopover = doc.createElement('div');
            packInfoPopover.id = 'pack-info-popover';
            packInfoPopover.className = 'bt-popover bt-pack-popover hidden';
            packInfoPopover.addEventListener('click', (e) => e.stopPropagation());

            libLeft.append(libTitle, packInfoBtn, packInfoPopover);

            const libRight = doc.createElement('div');
            libRight.className = 'bt-row-wrap';
            libRight.style.flex = '1 1 240px';
            libRight.style.minWidth = '0';

            const mgrSearch = doc.createElement('input');
            mgrSearch.id = 'mgr-search';
            mgrSearch.type = 'text';
            mgrSearch.placeholder = 'Search scripts, pack/local, @match…';
            mgrSearch.className = 'bt-input bt-mgr-search';
            mgrSearch.addEventListener('input', (e) => {
                state.mgrSearch = e.target.value || '';
                renderManagerView();
            });

            const mgrOnlySiteLabel = doc.createElement('label');
            mgrOnlySiteLabel.className = 'bt-row-wrap';
            mgrOnlySiteLabel.style.cursor = 'pointer';
            const mgrOnlySite = doc.createElement('input');
            mgrOnlySite.id = 'mgr-only-site';
            mgrOnlySite.type = 'checkbox';
            mgrOnlySite.addEventListener('change', (e) => {
                state.mgrOnlySite = Boolean(e.target.checked);
                renderManagerView();
            });
            const mgrOnlySiteText = doc.createElement('span');
            mgrOnlySiteText.textContent = 'Matching current site';
            mgrOnlySiteLabel.append(mgrOnlySite, mgrOnlySiteText);

            libRight.append(mgrSearch, mgrOnlySiteLabel);
            libHeader.append(libLeft, libRight);

            const libraryGrid = doc.createElement('div');
            libraryGrid.id = 'library-grid';
            libraryGrid.className = 'bt-library-grid';

            librarySection.append(libHeader, libraryGrid);
            managerBody.append(stickySection, librarySection);
            managerModal.append(managerHeader, managerBody);
            managerBackdrop.appendChild(managerModal);
            root.appendChild(managerBackdrop);

            // 3. Local Script Editor Modal
            const editorBackdrop = doc.createElement('div');
            editorBackdrop.id = 'editor-backdrop';
            editorBackdrop.className = 'bt-backdrop bt-backdrop-sub hidden';
            const editorModal = doc.createElement('div');
            editorModal.className = 'bt-modal';
            const editorHeader = doc.createElement('div');
            editorHeader.className = 'bt-modal-header bt-row-between';
            const editorTitle = doc.createElement('div');
            editorTitle.id = 'editor-title';
            editorTitle.className = 'bt-title';
            editorTitle.textContent = 'Add Local Script';
            const editorClose = doc.createElement('button');
            editorClose.id = 'editor-close';
            editorClose.type = 'button';
            editorClose.className = 'bt-close-btn';
            editorClose.title = 'Close (Esc)';
            editorClose.textContent = '×';
            editorClose.addEventListener('click', () => closeEditorModal());
            editorHeader.append(editorTitle, editorClose);

            const editorForm = doc.createElement('form');
            editorForm.id = 'editor-form';
            editorForm.className = 'bt-form-body';

            const nameField = doc.createElement('div');
            nameField.className = 'bt-field';
            const nameLabel = doc.createElement('label');
            nameLabel.className = 'bt-label';
            nameLabel.textContent = 'Name';
            const edName = doc.createElement('input');
            edName.id = 'ed-name';
            edName.type = 'text';
            edName.placeholder = 'e.g. Copy Release MBID';
            edName.className = 'bt-input';
            nameField.append(nameLabel, edName);

            const descField = doc.createElement('div');
            descField.className = 'bt-field';
            const descLabel = doc.createElement('label');
            descLabel.className = 'bt-label';
            descLabel.textContent = 'Description (optional)';
            const edDesc = doc.createElement('input');
            edDesc.id = 'ed-desc';
            edDesc.type = 'text';
            edDesc.placeholder = 'Short summary shown in Command Palette and ⓘ popover';
            edDesc.className = 'bt-input';
            descField.append(descLabel, edDesc);

            const matchField = doc.createElement('div');
            matchField.className = 'bt-field';
            const matchHeader = doc.createElement('div');
            matchHeader.className = 'bt-row-between bt-row-wrap';
            const matchLabel = doc.createElement('label');
            matchLabel.className = 'bt-label';
            matchLabel.style.whiteSpace = 'nowrap';
            matchLabel.textContent = 'Match patterns (1 per line)';
            const matchBtns = doc.createElement('div');
            matchBtns.className = 'bt-row-wrap';

            const edFillCurrent = doc.createElement('button');
            edFillCurrent.id = 'ed-fill-current';
            edFillCurrent.type = 'button';
            edFillCurrent.className = 'bt-mini-btn';
            edFillCurrent.textContent = 'Prefill current site';
            edFillCurrent.addEventListener('click', () => {
                edMatch.value = getCurrentOriginPattern(state.url);
            });

            const edFillAll = doc.createElement('button');
            edFillAll.id = 'ed-fill-all';
            edFillAll.type = 'button';
            edFillAll.className = 'bt-mini-btn';
            edFillAll.textContent = 'Prefill all sites';
            edFillAll.addEventListener('click', () => {
                edMatch.value = '*://*/*';
            });

            const edDocsLink = doc.createElement('a');
            edDocsLink.href = 'https://violentmonkey.github.io/api/matching/';
            edDocsLink.target = '_blank';
            edDocsLink.rel = 'noreferrer';
            edDocsLink.textContent = '@match docs ↗';
            edDocsLink.style.color = 'var(--bt-link)';

            matchBtns.append(edFillCurrent, edFillAll, edDocsLink);
            matchHeader.append(matchLabel, matchBtns);

            const edMatch = doc.createElement('textarea');
            edMatch.id = 'ed-match';
            edMatch.rows = 2;
            edMatch.className = 'bt-textarea';
            matchField.append(matchHeader, edMatch);

            const codeField = doc.createElement('div');
            codeField.className = 'bt-field';
            const codeLabel = doc.createElement('label');
            codeLabel.className = 'bt-label';
            codeLabel.textContent = 'Code (raw JS or javascript:... bookmarklet URL)';
            const edCode = doc.createElement('textarea');
            edCode.id = 'ed-code';
            edCode.rows = 4;
            edCode.placeholder = 'javascript:(()=>{ ... })();';
            edCode.className = 'bt-textarea';
            codeField.append(codeLabel, edCode);

            const editorError = doc.createElement('div');
            editorError.id = 'editor-error';
            editorError.className = 'bt-hint-blocked hidden';

            const editorFooter = doc.createElement('div');
            editorFooter.style.display = 'flex';
            editorFooter.style.justifyContent = 'flex-end';
            const edSubmit = doc.createElement('button');
            edSubmit.id = 'ed-save';
            edSubmit.type = 'submit';
            edSubmit.className = 'bt-action-btn bt-action-btn-primary';
            edSubmit.textContent = 'Save';
            editorFooter.appendChild(edSubmit);

            editorForm.append(nameField, descField, matchField, codeField, editorError, editorFooter);
            editorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                saveEditorForm();
            });
            editorModal.append(editorHeader, editorForm);
            editorBackdrop.appendChild(editorModal);
            root.appendChild(editorBackdrop);

            // 4. In-UI Delete Confirmation Modal
            const confirmBackdrop = doc.createElement('div');
            confirmBackdrop.id = 'confirm-backdrop';
            confirmBackdrop.className = 'bt-backdrop bt-backdrop-sub hidden';
            const confirmModal = doc.createElement('div');
            confirmModal.className = 'bt-modal bt-modal-sm';
            const confirmHeader = doc.createElement('div');
            confirmHeader.className = 'bt-modal-header bt-row-between';
            const confirmTitle = doc.createElement('div');
            confirmTitle.id = 'confirm-title';
            confirmTitle.className = 'bt-title';
            confirmTitle.textContent = 'Confirm Delete';
            const confirmClose = doc.createElement('button');
            confirmClose.id = 'confirm-close';
            confirmClose.type = 'button';
            confirmClose.className = 'bt-close-btn';
            confirmClose.title = 'Cancel (Esc)';
            confirmClose.textContent = '×';
            confirmClose.addEventListener('click', () => closeConfirmModal());
            confirmHeader.append(confirmTitle, confirmClose);

            const confirmBody = doc.createElement('div');
            confirmBody.className = 'bt-form-body';
            const confirmMessage = doc.createElement('p');
            confirmMessage.id = 'confirm-message';
            confirmMessage.className = 'bt-subtitle';
            confirmMessage.style.margin = '0';
            const confirmFooter = doc.createElement('div');
            confirmFooter.style.display = 'flex';
            confirmFooter.style.justifyContent = 'flex-end';
            confirmFooter.style.gap = '8px';
            const confirmCancel = doc.createElement('button');
            confirmCancel.id = 'confirm-cancel';
            confirmCancel.type = 'button';
            confirmCancel.className = 'bt-action-btn';
            confirmCancel.textContent = 'Cancel';
            confirmCancel.addEventListener('click', () => closeConfirmModal());
            const confirmAction = doc.createElement('button');
            confirmAction.id = 'confirm-action';
            confirmAction.type = 'button';
            confirmAction.className = 'bt-action-btn bt-action-btn-danger';
            confirmAction.textContent = 'Delete';
            confirmAction.addEventListener('click', () => {
                const fn = state.pendingConfirm;
                closeConfirmModal();
                if (typeof fn === 'function') {
                    fn();
                }
            });
            confirmFooter.append(confirmCancel, confirmAction);
            confirmBody.append(confirmMessage, confirmFooter);
            confirmModal.append(confirmHeader, confirmBody);
            confirmBackdrop.appendChild(confirmModal);
            root.appendChild(confirmBackdrop);

            // 5. Export Modal
            const exportBackdrop = doc.createElement('div');
            exportBackdrop.id = 'export-backdrop';
            exportBackdrop.className = 'bt-backdrop bt-backdrop-sub hidden';
            const exportModal = doc.createElement('div');
            exportModal.className = 'bt-modal';
            const exportHeader = doc.createElement('div');
            exportHeader.className = 'bt-modal-header bt-row-between';
            const exportTitle = doc.createElement('div');
            exportTitle.className = 'bt-title';
            exportTitle.textContent = 'Export Backup (.json)';
            const exportClose = doc.createElement('button');
            exportClose.id = 'export-close';
            exportClose.type = 'button';
            exportClose.className = 'bt-close-btn';
            exportClose.title = 'Close (Esc)';
            exportClose.textContent = '×';
            exportClose.addEventListener('click', () => closeExportModal());
            exportHeader.append(exportTitle, exportClose);

            const exportBody = doc.createElement('div');
            exportBody.className = 'bt-form-body';
            const exportDesc = doc.createElement('div');
            exportDesc.className = 'bt-subtitle';
            exportDesc.textContent =
                'Exports your Local Scripts and Toolbar Layout (pack code is excluded so backups stay clean).';
            const exportPreview = doc.createElement('textarea');
            exportPreview.id = 'export-preview';
            exportPreview.readOnly = true;
            exportPreview.rows = 7;
            exportPreview.className = 'bt-textarea';

            const exportFooter = doc.createElement('div');
            exportFooter.className = 'bt-row-between bt-row-wrap';
            const exportFeedback = doc.createElement('span');
            exportFeedback.id = 'export-feedback';
            exportFeedback.className = 'bt-subtitle';
            const exportBtns = doc.createElement('div');
            exportBtns.className = 'bt-row-wrap';
            const exportCopy = doc.createElement('button');
            exportCopy.id = 'export-copy';
            exportCopy.type = 'button';
            exportCopy.className = 'bt-action-btn';
            exportCopy.textContent = 'Copy JSON';
            exportCopy.addEventListener('click', () => copyExportJson());
            const exportDownload = doc.createElement('button');
            exportDownload.id = 'export-download';
            exportDownload.type = 'button';
            exportDownload.className = 'bt-action-btn bt-action-btn-primary';
            exportDownload.textContent = 'Download .json';
            exportDownload.addEventListener('click', () => downloadExportJson());
            exportBtns.append(exportCopy, exportDownload);
            exportFooter.append(exportFeedback, exportBtns);
            exportBody.append(exportDesc, exportPreview, exportFooter);
            exportModal.append(exportHeader, exportBody);
            exportBackdrop.appendChild(exportModal);
            root.appendChild(exportBackdrop);

            // 6. Import Modal
            const importBackdrop = doc.createElement('div');
            importBackdrop.id = 'import-backdrop';
            importBackdrop.className = 'bt-backdrop bt-backdrop-sub hidden';
            const importModal = doc.createElement('div');
            importModal.className = 'bt-modal';
            const importHeader = doc.createElement('div');
            importHeader.className = 'bt-modal-header bt-row-between';
            const importTitle = doc.createElement('div');
            importTitle.className = 'bt-title';
            importTitle.textContent = 'Import Backup (.json)';
            const importClose = doc.createElement('button');
            importClose.id = 'import-close';
            importClose.type = 'button';
            importClose.className = 'bt-close-btn';
            importClose.title = 'Close (Esc)';
            importClose.textContent = '×';
            importClose.addEventListener('click', () => closeImportModal());
            importHeader.append(importTitle, importClose);

            const importBody = doc.createElement('div');
            importBody.className = 'bt-form-body';
            const importDesc = doc.createElement('div');
            importDesc.className = 'bt-subtitle';
            importDesc.textContent =
                'Replaces your current Local Scripts and Toolbar Layout.';

            const importText = doc.createElement('textarea');
            importText.id = 'import-text';
            importText.rows = 7;
            importText.placeholder = '{"version": 1, "scripts": {...}, "layout": [...]}';
            importText.className = 'bt-textarea';

            const importError = doc.createElement('div');
            importError.id = 'import-error';
            importError.className = 'bt-hint-blocked hidden';

            const importFooter = doc.createElement('div');
            importFooter.className = 'bt-row-between bt-row-wrap';
            const importInputBtns = doc.createElement('div');
            importInputBtns.className = 'bt-row-wrap';
            const importPasteClipboard = doc.createElement('button');
            importPasteClipboard.id = 'import-paste-clipboard';
            importPasteClipboard.type = 'button';
            importPasteClipboard.className = 'bt-action-btn';
            importPasteClipboard.textContent = 'Paste Clipboard';
            importPasteClipboard.addEventListener('click', async () => {
                importError.classList.add('hidden');
                try {
                    const text = await navigator.clipboard.readText();
                    importText.value = text;
                } catch {
                    importError.textContent =
                        'Clipboard read blocked — click inside the box below and press Ctrl+V.';
                    importError.classList.remove('hidden');
                    if (typeof importText.focus === 'function') {
                        importText.focus();
                    }
                }
            });
            const importChooseFile = doc.createElement('button');
            importChooseFile.id = 'import-choose-file';
            importChooseFile.type = 'button';
            importChooseFile.className = 'bt-action-btn';
            importChooseFile.textContent = 'Choose File…';
            const importFileInput = doc.createElement('input');
            importFileInput.id = 'import-file-input';
            importFileInput.type = 'file';
            importFileInput.accept = '.json,application/json';
            importFileInput.className = 'hidden';
            importChooseFile.addEventListener('click', () => {
                if (typeof importFileInput.click === 'function') {
                    importFileInput.click();
                }
            });
            importFileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file && typeof file.text === 'function') {
                    file.text().then((txt) => {
                        importText.value = txt;
                    });
                }
            });
            importInputBtns.append(importPasteClipboard, importChooseFile, importFileInput);

            const importApply = doc.createElement('button');
            importApply.id = 'import-apply';
            importApply.type = 'button';
            importApply.className = 'bt-action-btn bt-action-btn-primary';
            importApply.textContent = 'Import & Replace';
            importApply.addEventListener('click', () => applyImportedJson(importText.value));
            importFooter.append(importInputBtns, importApply);

            importBody.append(importDesc, importText, importError, importFooter);
            importModal.append(importHeader, importBody);
            importBackdrop.appendChild(importModal);
            root.appendChild(importBackdrop);

            // Shadow Root keydown handler (supports Escape hierarchy and Hotkey Recorder)
            root.addEventListener('keydown', handleKeydown);

            return {
                toast,
                paletteBackdrop,
                paletteSearch,
                paletteList,
                paletteRemovedDot,
                managerBackdrop,
                managerBody,
                stickySection,
                btnHotkeyRecord,
                dockModeButtons,
                btnToggleDockSite,
                toolbarStrip,
                folderDrawer,
                packInfoBtn,
                packBadgeLabel,
                packInfoPopover,
                mgrSearch,
                mgrOnlySite,
                librarySection,
                libraryGrid,
                editorBackdrop,
                editorTitle,
                edName,
                edDesc,
                edMatch,
                edCode,
                editorError,
                confirmBackdrop,
                confirmTitle,
                confirmMessage,
                confirmAction,
                exportBackdrop,
                exportPreview,
                exportFeedback,
                importBackdrop,
                importText,
                importError,
            };
        }

        function handleKeydown(e) {
            if (state.recordingHotkey) {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Escape') {
                    state.recordingHotkey = false;
                    renderManagerView();
                    return;
                }
                const combo = Core.formatHotkeyEvent(e);
                if (combo) {
                    state.recordingHotkey = false;
                    emitStateChange({
                        settings: { ...state.settings, hotkey: combo },
                    });
                    renderAll();
                    showToast(`Command Palette shortcut set to ${combo}`);
                }
                return;
            }

            if (e.key === 'Escape') {
                if (state.pendingConfirm) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeConfirmModal();
                    return;
                }
                if (state.editorOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeEditorModal();
                    return;
                }
                if (state.exportOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeExportModal();
                    return;
                }
                if (state.importOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeImportModal();
                    return;
                }
                if (
                    state.addingFolderInline ||
                    state.renamingFolderId !== null ||
                    state.editingLabelIndex !== null ||
                    state.editingFolderItem !== null
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    state.addingFolderInline = false;
                    state.renamingFolderId = null;
                    state.editingLabelIndex = null;
                    state.editingFolderItem = null;
                    renderManagerView();
                    return;
                }
                if (
                    state.paletteOpen ||
                    state.managerOpen ||
                    state.openDropdownId ||
                    state.openInfoId
                ) {
                    state.paletteOpen = false;
                    state.managerOpen = false;
                    state.openDropdownId = null;
                    state.openInfoId = null;
                    state.openInfoTriggerEl = null;
                    renderAll();
                }
            }
        }

        function handleDocumentClick(e) {
            const path = typeof e?.composedPath === 'function' ? e.composedPath() : [];
            const inToolbar = toolbarHost && path.includes(toolbarHost);
            const inOverlay = overlayHost && path.includes(overlayHost);

            if (!inToolbar && state.openDropdownId) {
                state.openDropdownId = null;
                renderToolbarView();
            }
            if (!inOverlay && (state.openInfoId || state.recordingHotkey)) {
                state.openInfoId = null;
                state.openInfoTriggerEl = null;
                state.recordingHotkey = false;
                if (overlayHost) {
                    renderManagerView();
                }
            }
        }

        function handleDocumentKeydown(e) {
            const path = typeof e?.composedPath === 'function' ? e.composedPath() : [];
            if (overlayHost && path.includes(overlayHost)) {
                return;
            }
            handleKeydown(e);
        }

        if (doc && typeof doc.addEventListener === 'function') {
            doc.addEventListener('click', handleDocumentClick);
            doc.addEventListener('keydown', handleDocumentKeydown);
        }

        function openConfirmModal({ title, message, actionLabel = 'Delete', onConfirm }) {
            ensureOverlayMounted();
            state.pendingConfirm = onConfirm;
            overlayEls.confirmTitle.textContent = title;
            overlayEls.confirmMessage.textContent = message;
            overlayEls.confirmAction.textContent = actionLabel;
            overlayEls.confirmBackdrop.classList.remove('hidden');
        }

        function closeConfirmModal() {
            state.pendingConfirm = null;
            if (overlayEls) {
                overlayEls.confirmBackdrop.classList.add('hidden');
            }
        }

        function openEditorModal(scriptId = null) {
            ensureOverlayMounted();
            state.editingScriptId = scriptId;
            state.editorOpen = true;
            const existing = scriptId ? state.localScripts[scriptId] : null;
            overlayEls.editorTitle.textContent = existing
                ? 'Edit Local Script'
                : 'Add Local Script';
            overlayEls.edName.value = existing?.name || '';
            overlayEls.edDesc.value = existing?.description || '';
            overlayEls.edMatch.value = existing
                ? existing.match.join('\n')
                : getCurrentOriginPattern(state.url);
            overlayEls.edCode.value = existing?.code || '';
            overlayEls.editorError.classList.add('hidden');
            overlayEls.editorBackdrop.classList.remove('hidden');
        }

        function closeEditorModal() {
            state.editorOpen = false;
            state.editingScriptId = null;
            if (overlayEls) {
                overlayEls.editorBackdrop.classList.add('hidden');
            }
        }

        function saveEditorForm() {
            const name = String(overlayEls.edName.value || '').trim();
            const description = String(overlayEls.edDesc.value || '').trim();
            const match = String(overlayEls.edMatch.value || '')
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean);
            const rawCode = String(overlayEls.edCode.value || '').trim();

            if (!name || !match.length || !rawCode) {
                overlayEls.editorError.textContent =
                    'Name, at least one @match pattern, and code are required.';
                overlayEls.editorError.classList.remove('hidden');
                return;
            }

            const invalidPattern = match.find((p) => !Core.isValidMatchPattern(p));
            if (invalidPattern) {
                overlayEls.editorError.textContent = `Invalid @match pattern: ${invalidPattern}`;
                overlayEls.editorError.classList.remove('hidden');
                return;
            }

            let id = state.editingScriptId;
            if (!id) {
                const baseId = `local:${Date.now()}`;
                id = baseId;
                let suffix = 1;
                while (id in state.localScripts) {
                    id = `${baseId}-${suffix}`;
                    suffix += 1;
                }
            }
            const existing = state.editingScriptId
                ? state.localScripts[state.editingScriptId]
                : null;
            const nextLocalScripts = {
                ...state.localScripts,
                [id]: {
                    ...(existing || {}),
                    id,
                    source: 'local',
                    name,
                    description,
                    match,
                    code: rawCode,
                },
            };

            closeEditorModal();
            emitStateChange({ localScripts: nextLocalScripts });
            renderAll();
            showToast(`Saved "${name}"`);
        }

        function openExportModal() {
            ensureOverlayMounted();
            state.exportOpen = true;
            const envelope = Core.buildExportEnvelope(state.localScripts, state.layout);
            overlayEls.exportPreview.value = JSON.stringify(envelope, null, 2);
            overlayEls.exportFeedback.textContent = '';
            overlayEls.exportBackdrop.classList.remove('hidden');
        }

        function closeExportModal() {
            state.exportOpen = false;
            if (overlayEls) {
                overlayEls.exportBackdrop.classList.add('hidden');
            }
        }

        async function copyExportJson() {
            if (!overlayEls) {
                return;
            }
            const box = overlayEls.exportPreview;
            const fb = overlayEls.exportFeedback;
            try {
                await navigator.clipboard.writeText(box.value);
                fb.textContent = 'Copied JSON to clipboard!';
            } catch {
                if (typeof box.focus === 'function') {
                    box.focus();
                }
                if (typeof box.select === 'function') {
                    box.select();
                }
                const ok =
                    doc &&
                    typeof doc.execCommand === 'function' &&
                    doc.execCommand('copy');
                fb.textContent = ok
                    ? 'Copied JSON to clipboard!'
                    : 'Clipboard unavailable — JSON selected, press Ctrl+C.';
            }
        }

        function downloadExportJson() {
            if (!overlayEls) {
                return;
            }
            const fb = overlayEls.exportFeedback;
            try {
                const blob = new Blob([overlayEls.exportPreview.value], {
                    type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const a = doc.createElement('a');
                a.href = url;
                a.download = 'bookmarklet-toolbar-backup.json';
                (doc.body || doc.documentElement).appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                fb.textContent = 'Triggered download.';
            } catch {
                fb.textContent = 'Download unavailable in this environment — use Copy JSON.';
            }
        }

        function openImportModal() {
            ensureOverlayMounted();
            state.importOpen = true;
            overlayEls.importText.value = '';
            overlayEls.importError.classList.add('hidden');
            overlayEls.importBackdrop.classList.remove('hidden');
        }

        function closeImportModal() {
            state.importOpen = false;
            if (overlayEls) {
                overlayEls.importBackdrop.classList.add('hidden');
            }
        }

        function applyImportedJson(raw) {
            if (!overlayEls) {
                return;
            }
            try {
                const validated = Core.parseAndValidateImport(raw);
                closeImportModal();
                emitStateChange({
                    localScripts: validated.scripts,
                    layout: validated.layout,
                });
                renderAll();
                showToast('Imported & replaced Local Scripts and Layout');
            } catch (err) {
                overlayEls.importError.textContent = `Import error: ${err.message}`;
                overlayEls.importError.classList.remove('hidden');
            }
        }

        function renderPaletteView() {
            if (!overlayEls) {
                return;
            }
            overlayEls.paletteBackdrop.classList.toggle('hidden', !state.paletteOpen);
            const scriptsMap = getScriptsMap();
            const hasRemoved = Core.hasRemovedPlacedScript(state.layout, scriptsMap);
            overlayEls.paletteRemovedDot.classList.toggle('hidden', !hasRemoved);

            if (!state.paletteOpen) {
                return;
            }

            const packCount = Object.keys(state.packs || {}).length;
            const q = state.paletteQuery.trim().toLowerCase();
            const matching = Object.values(scriptsMap).filter(
                (s) =>
                    Core.scriptMatchesUrl(s, state.url) &&
                    (!q ||
                        s.name.toLowerCase().includes(q) ||
                        (s.description || '').toLowerCase().includes(q) ||
                        (s.source === 'local'
                            ? 'local'
                            : `${s.packId || ''} pack`.trim()
                        )
                            .toLowerCase()
                            .includes(q))
            );

            const recentIds = Object.entries(state.recents || {})
                .sort((a, b) => (b[1]?.lastRunAt || 0) - (a[1]?.lastRunAt || 0))
                .map(([id]) => id);
            const recentScripts = recentIds
                .map((id) => matching.find((s) => s.id === id))
                .filter(Boolean);
            const otherScripts = matching.filter((s) => !recentIds.includes(s.id));

            const items = [
                ...recentScripts.map((s) => ({
                    kind: 'script',
                    group: 'Recently Run',
                    script: s,
                })),
                ...otherScripts.map((s) => ({
                    kind: 'script',
                    group: 'Matching Library',
                    script: s,
                })),
            ];

            if (
                !q ||
                'settings manager preferences configure'.includes(q) ||
                'open settings'.includes(q) ||
                'open manager'.includes(q)
            ) {
                items.push({
                    kind: 'command',
                    group: 'Actions',
                    id: 'open-settings',
                    name: 'Open Settings / Manager',
                    description:
                        'Configure Toolbar buttons, Folders, Local Scripts, Hotkey, and Import/Export',
                });
            }

            const currentOrigin = getCurrentOrigin();
            if (currentOrigin) {
                const dockHidden = state.settings?.dockSiteHidden?.[currentOrigin] === true;
                const dockActionName = dockHidden
                    ? 'Show Dock on Current Site'
                    : 'Hide Dock on Current Site';
                const dockActionDesc = `${dockHidden ? 'Show' : 'Hide'} the floating Bookmarklet Toolbar dock on ${currentOrigin}`;
                if (
                    !q ||
                    dockActionName.toLowerCase().includes(q) ||
                    dockActionDesc.toLowerCase().includes(q) ||
                    'hide show dock current site toggle visibility'.includes(q)
                ) {
                    items.push({
                        kind: 'command',
                        group: 'Actions',
                        id: 'toggle-dock-site',
                        name: dockActionName,
                        description: dockActionDesc,
                    });
                }
            }

            state.paletteItems = items;
            if (state.paletteIndex >= items.length) {
                state.paletteIndex = Math.max(0, items.length - 1);
            }

            const list = overlayEls.paletteList;
            const prevPaletteScroll = list.scrollTop || 0;
            clearNode(list);
            if (!items.length) {
                const empty = doc.createElement('div');
                empty.className = 'bt-subtitle';
                empty.style.padding = '16px';
                empty.style.textAlign = 'center';
                empty.textContent = `No matching scripts for ${getSiteBrand(state.url)}.`;
                list.appendChild(empty);
                return;
            }

            let currentGroup = '';
            let activeRowEl = null;
            items.forEach((entry, i) => {
                if (entry.group !== currentGroup) {
                    currentGroup = entry.group;
                    const h = doc.createElement('div');
                    h.className = 'bt-palette-group';
                    h.textContent = currentGroup;
                    list.appendChild(h);
                }

                const active = i === state.paletteIndex;
                const row = doc.createElement('button');
                row.type = 'button';
                row.className = `bt-palette-item ${active ? 'bt-palette-item-active' : ''}`.trim();
                if (active) {
                    activeRowEl = row;
                }

                const topLine = doc.createElement('div');
                topLine.className = 'bt-row-wrap';

                const titleSpan = doc.createElement('span');
                titleSpan.style.fontWeight = '500';

                const badgeSpan = doc.createElement('span');
                badgeSpan.className = 'bt-badge';

                const descLine = doc.createElement('div');
                descLine.className = 'bt-subtitle';
                if (active) {
                    descLine.style.color = 'inherit';
                    descLine.style.opacity = '0.88';
                }

                if (entry.kind === 'script') {
                    const s = entry.script;
                    const badgeText =
                        s.source === 'local'
                            ? 'Local'
                            : packCount > 1
                              ? s.packId
                              : 'Pack';
                    titleSpan.textContent = s.name;
                    badgeSpan.textContent = badgeText;
                    descLine.textContent = s.description || s.match.join(', ');
                    row.dataset.scriptId = s.id;
                    row.addEventListener('click', () => triggerRunScript(s.id));
                } else {
                    titleSpan.textContent = `⚙ ${entry.name}`;
                    badgeSpan.textContent = 'Command';
                    descLine.textContent = entry.description;
                    row.dataset.commandId = entry.id;
                    row.addEventListener('click', () => {
                        if (entry.id === 'toggle-dock-site') {
                            state.paletteOpen = false;
                            toggleDockOnCurrentSite();
                        } else {
                            openManager();
                        }
                    });
                }

                topLine.append(titleSpan, badgeSpan);
                row.append(topLine, descLine);
                list.appendChild(row);
            });

            list.scrollTop = state.paletteIndex === 0 ? 0 : prevPaletteScroll;
            if (activeRowEl && typeof activeRowEl.scrollIntoView === 'function') {
                activeRowEl.scrollIntoView({ block: 'nearest' });
            }
        }

        function renderManagerView() {
            if (!overlayEls) {
                return;
            }
            overlayEls.managerBackdrop.classList.toggle('hidden', !state.managerOpen);
            if (!state.managerOpen) {
                return;
            }
            const prevScrollTop = overlayEls.managerBody
                ? overlayEls.managerBody.scrollTop || 0
                : 0;

            overlayEls.btnHotkeyRecord.textContent = state.recordingHotkey
                ? 'Press shortcut…'
                : `Shortcut: ${state.settings.hotkey}`;
            overlayEls.btnHotkeyRecord.classList.toggle(
                'bt-action-btn-recording',
                state.recordingHotkey
            );

            const expandMode = getDockExpandMode();
            Object.entries(overlayEls.dockModeButtons || {}).forEach(([modeId, modeBtn]) => {
                const isActive = modeId === expandMode;
                modeBtn.classList.toggle('bt-segmented-btn-active', isActive);
                modeBtn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });

            const mgrOrigin = getCurrentOrigin();
            const isDockHiddenHere = mgrOrigin
                ? state.settings?.dockSiteHidden?.[mgrOrigin] === true
                : false;
            if (overlayEls.btnToggleDockSite) {
                overlayEls.btnToggleDockSite.disabled = !mgrOrigin;
                overlayEls.btnToggleDockSite.textContent = isDockHiddenHere
                    ? 'Show dock on this site'
                    : 'Hide dock on this site';
                overlayEls.btnToggleDockSite.setAttribute(
                    'aria-pressed',
                    isDockHiddenHere ? 'true' : 'false'
                );
            }

            const packList = Object.values(state.packs || {});
            overlayEls.packBadgeLabel.textContent =
                packList.length === 1
                    ? `Pack v${packList[0].version}`
                    : `Packs (${packList.length})`;

            const packPop = overlayEls.packInfoPopover;
            packPop.classList.toggle('hidden', state.openInfoId !== 'pack');
            clearNode(packPop);
            packList.forEach((p, idx) => {
                const block = doc.createElement('div');
                if (idx > 0) {
                    block.style.paddingTop = '8px';
                    block.style.borderTop = '1px solid var(--bt-border)';
                }
                const topRow = doc.createElement('div');
                topRow.className = 'bt-row-between';
                const pName = doc.createElement('span');
                pName.style.fontWeight = '600';
                pName.textContent = p.name;
                const pVer = doc.createElement('span');
                pVer.className = 'bt-subtitle';
                pVer.textContent = `v${p.version}`;
                topRow.append(pName, pVer);

                const pDesc = doc.createElement('div');
                pDesc.className = 'bt-subtitle';
                const scriptCount = p.scripts ? Object.keys(p.scripts).length : 0;
                pDesc.textContent = `${p.description || ''} • ${scriptCount} scripts`;

                block.append(topRow, pDesc);
                if (p.homepage) {
                    const pLink = doc.createElement('a');
                    pLink.href = p.homepage;
                    pLink.target = '_blank';
                    pLink.rel = 'noreferrer';
                    pLink.style.color = 'var(--bt-link)';
                    pLink.textContent = `${p.homepage} ↗`;
                    block.appendChild(pLink);
                }
                packPop.appendChild(block);
            });
            if (state.openInfoId === 'pack' && overlayEls.packInfoBtn) {
                positionPopoverInViewport(packPop, overlayEls.packInfoBtn, win, doc);
            }

            const scriptsMap = getScriptsMap();
            const strip = overlayEls.toolbarStrip;
            clearNode(strip);
            const dndCtx = { root: overlayShadow, dragState: state.dragState };

            bindDropTarget(
                strip,
                'toolbar-end',
                (payload) => {
                    if (payload.kind === 'toolbar-folder') {
                        return {
                            style: 'drop-active-zone',
                            hint: 'Move folder to end of Toolbar',
                            accept: () => {
                                const nextLayout = Core.moveToolbarNode(
                                    state.layout,
                                    payload.index,
                                    state.layout.length
                                );
                                emitStateChange({ layout: nextLayout });
                                renderAll();
                            },
                        };
                    }
                    if (payload.scriptId) {
                        return {
                            style: 'drop-active-zone',
                            hint: 'Place script on Toolbar',
                            accept: () => {
                                const nextLayout = Core.placeScriptOnToolbarAt(
                                    state.layout,
                                    payload.scriptId,
                                    state.layout.length
                                );
                                emitStateChange({ layout: nextLayout });
                                renderAll();
                            },
                        };
                    }
                    return null;
                },
                dndCtx
            );

            state.layout.forEach((node, idx) => {
                if (node.type === 'script') {
                    const s = scriptsMap[node.scriptId];
                    if (state.editingLabelIndex === idx) {
                        strip.appendChild(
                            createInlineEditPill({
                                doc,
                                initialValue: node.label || s?.label || s?.name || '',
                                placeholder: 'Button label…',
                                onCommit: (val) => {
                                    const defaultLabel = s?.label || s?.name || '';
                                    const customLabel =
                                        val && val !== defaultLabel ? val : '';
                                    const nextLayout = Core.setScriptLabel(
                                        state.layout,
                                        { kind: 'toolbar', index: idx },
                                        customLabel
                                    );
                                    state.editingLabelIndex = null;
                                    emitStateChange({ layout: nextLayout });
                                    renderAll();
                                },
                                onCancel: () => {
                                    state.editingLabelIndex = null;
                                    renderManagerView();
                                },
                            })
                        );
                    } else {
                        const btnLabel = node.label || s?.label || s?.name || node.scriptId;
                        const pill = doc.createElement('div');
                        pill.className = `pill-base bt-pill-draggable ${s?.removed ? 'bt-pill-removed' : ''}`.trim();
                        pill.style.cursor = 'grab';
                        pill.dataset.toolbarScript = node.scriptId;
                        const pillPayload = {
                            kind: 'toolbar-script',
                            index: idx,
                            scriptId: node.scriptId,
                        };
                        attachDraggable(pill, pillPayload, overlayShadow, state.dragState);
                        attachTouchPointerDrag({
                            triggerEl: pill,
                            sourceEl: pill,
                            payload: pillPayload,
                            label: btnLabel,
                            root: overlayShadow,
                            doc,
                            dragState: state.dragState,
                        });

                        bindDropTarget(
                            pill,
                            `toolbar:${idx}`,
                            (payload, e) => {
                                if (
                                    payload.kind === 'toolbar-script' &&
                                    payload.index === idx
                                ) {
                                    return null;
                                }
                                const side = getHalfSide(pill, e);
                                const targetIdx = side === 'before' ? idx : idx + 1;
                                const verb = side === 'before' ? 'before' : 'after';
                                if (payload.kind === 'toolbar-folder') {
                                    return {
                                        style:
                                            side === 'before'
                                                ? 'drop-active-before'
                                                : 'drop-active-after',
                                        hint: `Move folder ${verb} "${btnLabel}"`,
                                        accept: () => {
                                            const nextLayout = Core.moveToolbarNode(
                                                state.layout,
                                                payload.index,
                                                targetIdx
                                            );
                                            emitStateChange({ layout: nextLayout });
                                            renderAll();
                                        },
                                    };
                                }
                                if (payload.scriptId) {
                                    return {
                                        style:
                                            side === 'before'
                                                ? 'drop-active-before'
                                                : 'drop-active-after',
                                        hint: `Place ${verb} "${btnLabel}" on Toolbar`,
                                        accept: () => {
                                            const nextLayout = Core.placeScriptOnToolbarAt(
                                                state.layout,
                                                payload.scriptId,
                                                targetIdx
                                            );
                                            emitStateChange({ layout: nextLayout });
                                            renderAll();
                                        },
                                    };
                                }
                                return null;
                            },
                            dndCtx
                        );

                        const label = doc.createElement('span');
                        label.style.fontWeight = '500';
                        label.textContent = btnLabel + (s?.removed ? ' ⚠' : '');
                        label.title = 'Double-click to customize toolbar label';
                        label.addEventListener('dblclick', (e) => {
                            e.stopPropagation();
                            state.editingLabelIndex = idx;
                            renderManagerView();
                        });
                        pill.appendChild(label);

                        const unpinBtn = doc.createElement('button');
                        unpinBtn.type = 'button';
                        unpinBtn.className = 'bt-status-slot bt-star-btn bt-star-active';
                        unpinBtn.title = 'Pinned to Toolbar (click to unpin)';
                        unpinBtn.textContent = '★';
                        unpinBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const nextLayout = Core.toggleToolbarPin(
                                state.layout,
                                node.scriptId
                            );
                            emitStateChange({ layout: nextLayout });
                            renderAll();
                        });
                        pill.appendChild(unpinBtn);

                        strip.appendChild(pill);
                    }
                } else if (node.type === 'folder') {
                    const selected = state.selectedFolderId === node.id;
                    const fPill = doc.createElement('div');
                    fPill.className = `pill-base bt-pill-draggable ${selected ? 'bt-pill-selected' : ''}`.trim();
                    fPill.style.cursor = 'pointer';
                    fPill.dataset.folderPill = node.id;
                    const folderPayload = {
                        kind: 'toolbar-folder',
                        index: idx,
                        folderId: node.id,
                    };
                    attachDraggable(fPill, folderPayload, overlayShadow, state.dragState);
                    attachTouchPointerDrag({
                        triggerEl: fPill,
                        sourceEl: fPill,
                        payload: folderPayload,
                        label: `📁 ${node.name}`,
                        root: overlayShadow,
                        doc,
                        dragState: state.dragState,
                        onSuppressClick: () => {
                            suppressNextFolderPillClick = true;
                            setTimeout(() => {
                                suppressNextFolderPillClick = false;
                            }, 0);
                        },
                    });

                    bindDropTarget(
                        fPill,
                        `pill-folder:${node.id}`,
                        (payload, e) => {
                            if (payload.kind === 'toolbar-folder') {
                                if (payload.index === idx) {
                                    return null;
                                }
                                const side = getHalfSide(fPill, e);
                                const targetIdx = side === 'before' ? idx : idx + 1;
                                return {
                                    style:
                                        side === 'before'
                                            ? 'drop-active-before'
                                            : 'drop-active-after',
                                    hint: `Move folder ${side === 'before' ? 'before' : 'after'} "${node.name}"`,
                                    accept: () => {
                                        const nextLayout = Core.moveToolbarNode(
                                            state.layout,
                                            payload.index,
                                            targetIdx
                                        );
                                        emitStateChange({ layout: nextLayout });
                                        renderAll();
                                    },
                                };
                            }
                            if (
                                payload.kind === 'folder-item' &&
                                payload.folderId === node.id
                            ) {
                                return null;
                            }
                            if (payload.scriptId) {
                                return {
                                    style: 'drop-active-folder',
                                    hint: `Drop script into folder "${node.name}"`,
                                    accept: () => {
                                        const nextLayout = Core.moveScriptToFolder(
                                            state.layout,
                                            payload.scriptId,
                                            node.id
                                        );
                                        state.selectedFolderId = node.id;
                                        emitStateChange({ layout: nextLayout });
                                        renderAll();
                                    },
                                };
                            }
                            return null;
                        },
                        dndCtx
                    );

                    const fNameSpan = doc.createElement('span');
                    fNameSpan.style.fontWeight = '500';
                    fNameSpan.style.pointerEvents = 'none';
                    fNameSpan.textContent = `📁 ${node.name}`;
                    const fCountSpan = doc.createElement('span');
                    fCountSpan.style.opacity = '0.75';
                    fCountSpan.style.pointerEvents = 'none';
                    fCountSpan.textContent = `(${node.items.length})`;
                    fPill.append(fNameSpan, fCountSpan);

                    fPill.addEventListener('click', () => {
                        if (suppressNextFolderPillClick) {
                            suppressNextFolderPillClick = false;
                            return;
                        }
                        state.selectedFolderId = selected ? null : node.id;
                        renderManagerView();
                    });
                    strip.appendChild(fPill);
                }
            });

            if (state.addingFolderInline) {
                strip.appendChild(
                    createInlineEditPill({
                        doc,
                        initialValue: '',
                        placeholder: 'Folder name…',
                        onCommit: (name) => {
                            state.addingFolderInline = false;
                            if (name) {
                                const created = Core.createFolder(state.layout, name);
                                if (created.folder) {
                                    state.selectedFolderId = created.folder.id;
                                }
                                emitStateChange({ layout: created.layout });
                                renderAll();
                            } else {
                                renderManagerView();
                            }
                        },
                        onCancel: () => {
                            state.addingFolderInline = false;
                            renderManagerView();
                        },
                    })
                );
            } else {
                const addPill = doc.createElement('button');
                addPill.type = 'button';
                addPill.className = 'pill-base bt-add-folder-pill';
                addPill.dataset.action = 'add-folder';
                addPill.textContent = '+ Folder';
                addPill.addEventListener('click', (e) => {
                    e.stopPropagation();
                    state.addingFolderInline = true;
                    renderManagerView();
                });
                strip.appendChild(addPill);
            }

            // Selected Folder Drawer
            const drawer = overlayEls.folderDrawer;
            const folderIdx = state.layout.findIndex(
                (n) => n.type === 'folder' && n.id === state.selectedFolderId
            );
            if (folderIdx === -1) {
                drawer.classList.add('hidden');
                clearNode(drawer);
                clearDropTarget(drawer);
            } else {
                const folder = state.layout[folderIdx];
                drawer.classList.remove('hidden');
                clearNode(drawer);

                bindDropTarget(
                    drawer,
                    `drawer-folder:${folder.id}`,
                    (payload) => {
                        if (payload.kind === 'toolbar-folder') {
                            return {
                                blocked: true,
                                hint: 'Folders cannot be nested inside folders',
                            };
                        }
                        if (payload.scriptId) {
                            return {
                                style: 'drop-active-folder',
                                hint: `Move to end of folder "${folder.name}"`,
                                accept: () => {
                                    const nextLayout = Core.moveScriptToFolder(
                                        state.layout,
                                        payload.scriptId,
                                        folder.id
                                    );
                                    emitStateChange({ layout: nextLayout });
                                    renderAll();
                                },
                            };
                        }
                        return null;
                    },
                    dndCtx
                );

                const hdr = doc.createElement('div');
                hdr.className = 'bt-row-between bt-row-wrap';
                const hdrLeft = doc.createElement('div');
                hdrLeft.className = 'bt-row-wrap';

                if (state.renamingFolderId === folder.id) {
                    hdrLeft.appendChild(
                        createInlineEditPill({
                            doc,
                            initialValue: folder.name,
                            placeholder: 'Folder name…',
                            onCommit: (val) => {
                                state.renamingFolderId = null;
                                if (val) {
                                    const nextLayout = Core.renameFolder(
                                        state.layout,
                                        folder.id,
                                        val
                                    );
                                    emitStateChange({ layout: nextLayout });
                                    renderAll();
                                } else {
                                    renderManagerView();
                                }
                            },
                            onCancel: () => {
                                state.renamingFolderId = null;
                                renderManagerView();
                            },
                        })
                    );
                } else {
                    const title = doc.createElement('span');
                    title.style.fontWeight = '600';
                    title.style.cursor = 'text';
                    title.textContent = `📁 ${folder.name}`;
                    title.title = 'Double-click to rename folder';
                    title.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        state.renamingFolderId = folder.id;
                        renderManagerView();
                    });

                    const count = doc.createElement('span');
                    count.className = 'bt-subtitle';
                    count.textContent = `(${folder.items.length})`;
                    hdrLeft.append(title, count);

                    hdrLeft.appendChild(
                        makeMiniBtn(
                            doc,
                            '🗑',
                            () => {
                                openConfirmModal({
                                    title: 'Delete Folder',
                                    message:
                                        folder.items.length > 0
                                            ? `Delete folder "${folder.name}" and unplace its ${folder.items.length} script(s)? (The scripts remain in your Library.)`
                                            : `Delete empty folder "${folder.name}"?`,
                                    actionLabel: 'Delete',
                                    onConfirm: () => {
                                        const nextLayout = Core.deleteFolder(
                                            state.layout,
                                            folder.id
                                        );
                                        state.selectedFolderId = null;
                                        emitStateChange({ layout: nextLayout });
                                        renderAll();
                                        showToast(`Deleted folder "${folder.name}"`);
                                    },
                                });
                            },
                            false,
                            'Delete folder',
                            true
                        )
                    );
                }

                const hdrHint = doc.createElement('span');
                hdrHint.className = 'bt-subtitle';
                hdrHint.textContent =
                    'Double-click title or chip to rename • Drag chips left/right to reorder';
                hdr.append(hdrLeft, hdrHint);
                drawer.appendChild(hdr);

                const itemsRow = doc.createElement('div');
                itemsRow.className = 'bt-folder-items-row';
                if (folder.items.length === 0) {
                    const emptyMsg = doc.createElement('span');
                    emptyMsg.className = 'bt-subtitle';
                    emptyMsg.textContent =
                        'Empty folder — drag any Library or Toolbar script here (or onto the folder pill above).';
                    itemsRow.appendChild(emptyMsg);
                } else {
                    folder.items.forEach((item, iIdx) => {
                        const s = scriptsMap[item.scriptId];
                        const isEditingChip =
                            state.editingFolderItem?.folderId === folder.id &&
                            state.editingFolderItem?.index === iIdx;
                        if (isEditingChip) {
                            itemsRow.appendChild(
                                createInlineEditPill({
                                    doc,
                                    initialValue: item.label || s?.label || s?.name || '',
                                    placeholder: 'Item label…',
                                    onCommit: (val) => {
                                        const defaultLabel = s?.label || s?.name || '';
                                        const customLabel =
                                            val && val !== defaultLabel ? val : '';
                                        const nextLayout = Core.setScriptLabel(
                                            state.layout,
                                            {
                                                kind: 'folder',
                                                folderId: folder.id,
                                                index: iIdx,
                                            },
                                            customLabel
                                        );
                                        state.editingFolderItem = null;
                                        emitStateChange({ layout: nextLayout });
                                        renderAll();
                                    },
                                    onCancel: () => {
                                        state.editingFolderItem = null;
                                        renderManagerView();
                                    },
                                })
                            );
                        } else {
                            const chipLabel =
                                item.label || s?.label || s?.name || item.scriptId;
                            const chip = doc.createElement('div');
                            chip.className = `pill-base bt-pill-draggable ${s?.removed ? 'bt-pill-removed' : ''}`.trim();
                            chip.style.background = 'var(--bt-bg)';
                            chip.style.cursor = 'grab';
                            chip.dataset.folderItem = item.scriptId;
                            const chipPayload = {
                                kind: 'folder-item',
                                scriptId: item.scriptId,
                                folderId: folder.id,
                                index: iIdx,
                            };
                            attachDraggable(chip, chipPayload, overlayShadow, state.dragState);
                            attachTouchPointerDrag({
                                triggerEl: chip,
                                sourceEl: chip,
                                payload: chipPayload,
                                label: chipLabel,
                                root: overlayShadow,
                                doc,
                                dragState: state.dragState,
                            });

                            bindDropTarget(
                                chip,
                                `fitem:${folder.id}:${iIdx}`,
                                (payload, e) => {
                                    if (payload.kind === 'toolbar-folder') {
                                        return {
                                            blocked: true,
                                            hint: 'Folders cannot be nested inside folders',
                                        };
                                    }
                                    if (
                                        payload.kind === 'folder-item' &&
                                        payload.folderId === folder.id &&
                                        payload.index === iIdx
                                    ) {
                                        return null;
                                    }
                                    if (payload.scriptId) {
                                        const side = getHalfSide(chip, e);
                                        const targetIdx =
                                            side === 'before' ? iIdx : iIdx + 1;
                                        return {
                                            style:
                                                side === 'before'
                                                    ? 'drop-active-before'
                                                    : 'drop-active-after',
                                            hint: `Place ${side === 'before' ? 'before' : 'after'} "${chipLabel}" in "${folder.name}"`,
                                            accept: () => {
                                                const nextLayout = Core.moveScriptToFolder(
                                                    state.layout,
                                                    payload.scriptId,
                                                    folder.id,
                                                    targetIdx
                                                );
                                                emitStateChange({ layout: nextLayout });
                                                renderAll();
                                            },
                                        };
                                    }
                                    return null;
                                },
                                dndCtx
                            );

                            const lbl = doc.createElement('span');
                            lbl.textContent = chipLabel + (s?.removed ? ' ⚠' : '');
                            lbl.title = 'Double-click to customize item label';
                            lbl.addEventListener('dblclick', (e) => {
                                e.stopPropagation();
                                state.editingFolderItem = {
                                    folderId: folder.id,
                                    index: iIdx,
                                };
                                renderManagerView();
                            });
                            chip.appendChild(lbl);

                            const starBtn = doc.createElement('button');
                            starBtn.type = 'button';
                            starBtn.className = 'bt-status-slot bt-star-btn';
                            starBtn.title = 'Pin directly to Toolbar';
                            starBtn.textContent = '☆';
                            starBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const nextLayout = Core.toggleToolbarPin(
                                    state.layout,
                                    item.scriptId
                                );
                                emitStateChange({ layout: nextLayout });
                                renderAll();
                            });
                            chip.appendChild(starBtn);

                            const rmBtn = doc.createElement('button');
                            rmBtn.type = 'button';
                            rmBtn.className = 'bt-status-slot';
                            rmBtn.style.cursor = 'pointer';
                            rmBtn.title = 'Remove from folder';
                            rmBtn.textContent = '×';
                            rmBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                const nextLayout = Core.removeFolderItem(
                                    state.layout,
                                    folder.id,
                                    iIdx
                                );
                                emitStateChange({ layout: nextLayout });
                                renderAll();
                            });
                            chip.appendChild(rmBtn);

                            itemsRow.appendChild(chip);
                        }
                    });
                }
                drawer.appendChild(itemsRow);
            }

            // Library Grid (also acts as drop-back target to unpin or remove from folder)
            bindDropTarget(
                overlayEls.librarySection,
                'library-unpin',
                (payload) => {
                    if (payload.kind === 'toolbar-script') {
                        const node = state.layout[payload.index];
                        const s = scriptsMap[payload.scriptId];
                        const label =
                            (node && node.type === 'script' && node.label) ||
                            s?.label ||
                            s?.name ||
                            payload.scriptId;
                        return {
                            style: 'drop-active-zone',
                            hint: `Unpin "${label}" from Toolbar`,
                            accept: () => {
                                const nextLayout = Core.toggleToolbarPin(
                                    state.layout,
                                    payload.scriptId
                                );
                                emitStateChange({ layout: nextLayout });
                                renderAll();
                            },
                        };
                    }
                    if (payload.kind === 'folder-item') {
                        const folder = state.layout.find(
                            (n) => n.type === 'folder' && n.id === payload.folderId
                        );
                        const item = folder?.items?.[payload.index];
                        const s = scriptsMap[payload.scriptId];
                        const label =
                            item?.label || s?.label || s?.name || payload.scriptId;
                        const folderName = folder?.name || 'folder';
                        return {
                            style: 'drop-active-zone',
                            hint: `Remove "${label}" from "${folderName}"`,
                            accept: () => {
                                const nextLayout = Core.removeFolderItem(
                                    state.layout,
                                    payload.folderId,
                                    payload.index
                                );
                                emitStateChange({ layout: nextLayout });
                                renderAll();
                            },
                        };
                    }
                    return null;
                },
                dndCtx
            );
            const grid = overlayEls.libraryGrid;
            syncLibraryGridDragging(overlayShadow, state.dragState);
            clearNode(grid);
            const q = state.mgrSearch.trim().toLowerCase();
            const filtered = Object.values(scriptsMap).filter((s) => {
                if (state.mgrOnlySite && !Core.scriptMatchesUrl(s, state.url)) {
                    return false;
                }
                if (!q) {
                    return true;
                }
                const packMeta = s.packId ? state.packs[s.packId] : null;
                const sourceText =
                    s.source === 'local'
                        ? 'local'
                        : `${s.packId || ''} ${packMeta?.name || ''} pack`.trim().toLowerCase();
                return (
                    s.name.toLowerCase().includes(q) ||
                    (s.description || '').toLowerCase().includes(q) ||
                    sourceText.includes(q) ||
                    s.match.some((m) => m.toLowerCase().includes(q))
                );
            });

            filtered.forEach((s) => {
                const placed = Core.getPlacement(state.layout, s.id);
                const packMeta = s.packId ? state.packs[s.packId] : null;
                const sourceBadge =
                    s.source === 'local'
                        ? 'Local'
                        : packList.length > 1
                          ? s.packId
                          : 'Pack';

                const card = doc.createElement('div');
                card.className = 'bt-library-card';
                card.dataset.libraryCard = s.id;
                card.dataset.tooltipSuppressed =
                    state.openInfoId === s.id || Boolean(state.dragState.dragPayload)
                        ? 'true'
                        : 'false';
                if (state.openInfoId === s.id) {
                    card.style.zIndex = '35';
                }
                attachDraggable(
                    card,
                    { kind: 'library-script', scriptId: s.id },
                    overlayShadow,
                    state.dragState
                );

                const info = doc.createElement('div');
                info.className = 'bt-card-left';
                const grip = doc.createElement('span');
                grip.className = 'bt-grip';
                grip.textContent = '⠿';
                attachTouchPointerDrag({
                    triggerEl: grip,
                    sourceEl: card,
                    payload: { kind: 'library-script', scriptId: s.id },
                    label: s.name,
                    root: overlayShadow,
                    doc,
                    dragState: state.dragState,
                });
                info.appendChild(grip);

                if (s.removed) {
                    const warnSlot = doc.createElement('span');
                    warnSlot.className = 'bt-status-slot';
                    warnSlot.style.color = 'var(--bt-amber)';
                    warnSlot.title = 'Removed from pack update';
                    warnSlot.textContent = '⚠';
                    info.appendChild(warnSlot);
                } else {
                    const isOnToolbar = placed?.kind === 'toolbar';
                    const starBtn = doc.createElement('button');
                    starBtn.type = 'button';
                    starBtn.className = `bt-status-slot bt-star-btn ${isOnToolbar ? 'bt-star-active' : ''}`.trim();
                    starBtn.title = isOnToolbar
                        ? 'Pinned to Toolbar (click to unpin)'
                        : 'Pin directly to Toolbar';
                    starBtn.textContent = isOnToolbar ? '★' : '☆';
                    starBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const nextLayout = Core.toggleToolbarPin(state.layout, s.id);
                        emitStateChange({ layout: nextLayout });
                        renderAll();
                    });
                    info.appendChild(starBtn);
                }

                const textWrap = doc.createElement('div');
                textWrap.style.minWidth = '0';
                textWrap.style.flex = '1 1 auto';

                const titleRow = doc.createElement('div');
                titleRow.className = 'bt-card-title-row';
                const titleSpan = doc.createElement('span');
                titleSpan.className = 'bt-card-title';
                titleSpan.textContent = s.name;
                titleRow.appendChild(titleSpan);

                const cardTooltip = doc.createElement('div');
                cardTooltip.className = 'bt-card-tooltip';
                cardTooltip.setAttribute('aria-hidden', 'true');
                cardTooltip.textContent = s.name;

                const syncCardTooltip = () => {
                    const suppressed =
                        state.openInfoId === s.id || Boolean(state.dragState.dragPayload);
                    card.dataset.tooltipSuppressed = suppressed ? 'true' : 'false';
                    const titleWidth = Number(titleSpan.clientWidth) || 0;
                    const titleScroll = Number(titleSpan.scrollWidth) || 0;
                    card.dataset.truncated =
                        titleWidth > 0 && titleScroll > titleWidth + 1 ? 'true' : 'false';
                    let tooltipPos = 'top';
                    if (typeof card.getBoundingClientRect === 'function') {
                        const cardRect = card.getBoundingClientRect();
                        const stickyEl = overlayEls?.stickySection;
                        const bodyEl = overlayEls?.managerBody;
                        const boundaryEl = stickyEl || bodyEl;
                        if (
                            cardRect &&
                            typeof cardRect.top === 'number' &&
                            boundaryEl &&
                            typeof boundaryEl.getBoundingClientRect === 'function'
                        ) {
                            const boundaryRect = boundaryEl.getBoundingClientRect();
                            const topBoundary = stickyEl
                                ? boundaryRect?.bottom
                                : boundaryRect?.top;
                            const tooltipHeight =
                                typeof cardTooltip.getBoundingClientRect === 'function'
                                    ? Number(cardTooltip.getBoundingClientRect()?.height) || 0
                                    : 0;
                            const minClearance = Math.max(44, tooltipHeight + 10);
                            if (
                                typeof topBoundary === 'number' &&
                                cardRect.top - topBoundary < minClearance
                            ) {
                                tooltipPos = 'bottom';
                            }
                        }
                    }
                    card.dataset.tooltipPos = tooltipPos;
                };
                card.addEventListener('mouseenter', syncCardTooltip);
                card.addEventListener('focusin', syncCardTooltip);

                const infoBtn = doc.createElement('button');
                infoBtn.type = 'button';
                infoBtn.className = 'bt-status-slot';
                infoBtn.style.width = 'auto';
                infoBtn.style.cursor = 'pointer';
                infoBtn.textContent = 'ⓘ';
                infoBtn.title = s.description || s.match.join(', ');
                if (
                    state.openInfoId === s.id &&
                    state.openInfoTriggerEl &&
                    Object.prototype.hasOwnProperty.call(
                        state.openInfoTriggerEl,
                        'getBoundingClientRect'
                    )
                ) {
                    infoBtn.getBoundingClientRect =
                        state.openInfoTriggerEl.getBoundingClientRect;
                }
                infoBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const opening = state.openInfoId !== s.id;
                    state.openInfoId = opening ? s.id : null;
                    state.openInfoTriggerEl = opening ? infoBtn : null;
                    renderManagerView();
                });
                titleRow.appendChild(infoBtn);

                const srcSpan = doc.createElement('span');
                srcSpan.className = 'bt-badge';
                srcSpan.textContent = sourceBadge;
                titleRow.appendChild(srcSpan);

                if (s.removed) {
                    const remSpan = doc.createElement('span');
                    remSpan.className = 'bt-badge bt-badge-removed';
                    remSpan.textContent = 'removed from pack';
                    titleRow.appendChild(remSpan);
                } else if (placed?.kind === 'folder') {
                    const fldBtn = doc.createElement('button');
                    fldBtn.type = 'button';
                    fldBtn.className = 'bt-badge bt-badge-folder';
                    fldBtn.dataset.folderBadge = placed.folderId;
                    fldBtn.title = `Open folder "${placed.folderName}" above (drag to another folder or Toolbar to move)`;
                    fldBtn.textContent = `📁 ${placed.folderName}`;
                    fldBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        state.selectedFolderId = placed.folderId;
                        renderManagerView();
                    });
                    titleRow.appendChild(fldBtn);
                }

                textWrap.appendChild(titleRow);
                info.appendChild(textWrap);
                card.appendChild(info);
                card.appendChild(cardTooltip);

                if (s.removed || s.source === 'local') {
                    const actions = doc.createElement('div');
                    actions.className = 'bt-row-nowrap';
                    actions.style.flexShrink = '0';
                    if (s.removed) {
                        actions.appendChild(
                            makeMiniBtn(
                                doc,
                                'Convert',
                                () => {
                                    const packId = s.packId;
                                    const packCache = state.packs[packId];
                                    const converted =
                                        Core.convertRemovedPackScriptToLocal(
                                            packCache,
                                            state.localScripts,
                                            state.layout,
                                            s.id
                                        );
                                    const nextPacks = { ...state.packs };
                                    if (packId && converted.packCache) {
                                        nextPacks[packId] = converted.packCache;
                                    }
                                    emitStateChange({
                                        packs: nextPacks,
                                        localScripts: converted.localScripts,
                                        layout: converted.layout,
                                    });
                                    renderAll();
                                    showToast(`Converted "${s.name}" to Local Script`);
                                },
                                true
                            )
                        );
                        actions.appendChild(
                            makeMiniBtn(
                                doc,
                                '🗑',
                                () => {
                                    openConfirmModal({
                                        title: 'Delete Orphaned Pack Script',
                                        message: `Permanently delete "${s.name}" from your Toolbar and PackCache? Its cached code will no longer be recoverable.`,
                                        actionLabel: 'Delete',
                                        onConfirm: () => {
                                            const packId = s.packId;
                                            const packCache = state.packs[packId];
                                            const removed =
                                                Core.removeOrphanedPackScriptFully(
                                                    packCache,
                                                    state.layout,
                                                    s.id
                                                );
                                            const nextPacks = { ...state.packs };
                                            if (packId && removed.packCache) {
                                                nextPacks[packId] = removed.packCache;
                                            }
                                            emitStateChange({
                                                packs: nextPacks,
                                                layout: removed.layout,
                                            });
                                            renderAll();
                                            showToast(
                                                'Deleted from Toolbar and PackCache'
                                            );
                                        },
                                    });
                                },
                                false,
                                'Delete orphaned script',
                                true
                            )
                        );
                    } else {
                        actions.appendChild(
                            makeMiniBtn(
                                doc,
                                '✎',
                                () => openEditorModal(s.id),
                                false,
                                'Edit local script',
                                true
                            )
                        );
                        actions.appendChild(
                            makeMiniBtn(
                                doc,
                                '🗑',
                                () => {
                                    openConfirmModal({
                                        title: 'Delete Local Script',
                                        message: `Permanently delete "${s.name}"? This will also remove it from your Toolbar or Folders.`,
                                        actionLabel: 'Delete',
                                        onConfirm: () => {
                                            const deleted = Core.deleteLocalScript(
                                                state.localScripts,
                                                state.layout,
                                                s.id
                                            );
                                            emitStateChange({
                                                localScripts: deleted.localScripts,
                                                layout: deleted.layout,
                                            });
                                            renderAll();
                                            showToast(`Deleted local script "${s.name}"`);
                                        },
                                    });
                                },
                                false,
                                'Delete local script',
                                true
                            )
                        );
                    }
                    card.appendChild(actions);
                }

                let openPop = null;
                if (state.openInfoId === s.id) {
                    const pop = doc.createElement('div');
                    pop.className = 'bt-popover';

                    const popTitle = doc.createElement('div');
                    popTitle.style.fontWeight = '600';
                    popTitle.textContent = s.name;

                    const popDesc = doc.createElement('div');
                    popDesc.className = 'bt-subtitle';
                    popDesc.textContent = s.description || 'No description provided.';

                    const popSrc = doc.createElement('div');
                    popSrc.className = 'bt-subtitle';
                    popSrc.append('Source: ');
                    const popSrcStrong = doc.createElement('strong');
                    popSrcStrong.textContent = packMeta
                        ? packMeta.name
                        : 'Local Script';
                    popSrc.appendChild(popSrcStrong);
                    if (packMeta) {
                        popSrc.append(` v${packMeta.version}`);
                    }

                    const popMatches = doc.createElement('div');
                    popMatches.className = 'bt-subtitle';
                    popMatches.style.fontFamily = 'monospace';
                    popMatches.style.wordBreak = 'break-all';
                    popMatches.style.paddingTop = '4px';
                    popMatches.style.borderTop = '1px solid var(--bt-border)';
                    s.match.forEach((pattern, mIdx) => {
                        if (mIdx > 0) {
                            popMatches.appendChild(doc.createElement('br'));
                        }
                        popMatches.append(pattern);
                    });

                    pop.append(popTitle, popDesc, popSrc, popMatches);
                    pop.addEventListener('click', (e) => e.stopPropagation());
                    card.appendChild(pop);
                    openPop = pop;
                }

                grid.appendChild(card);
                if (openPop) {
                    positionPopoverInViewport(openPop, infoBtn, win, doc);
                }
            });

            if (overlayEls.managerBody) {
                overlayEls.managerBody.scrollTop = prevScrollTop;
            }
        }

        function renderAll() {
            renderToolbarView();
            if (overlayHost) {
                renderPaletteView();
                renderManagerView();
            }
        }

        function resetSubModalsAndInlineEdits() {
            if (state.dragState.cancelTouchDrag) {
                state.dragState.cancelTouchDrag();
            }
            closeEditorModal();
            closeExportModal();
            closeImportModal();
            closeConfirmModal();
            state.openDropdownId = null;
            state.openInfoId = null;
            state.openInfoTriggerEl = null;
            state.recordingHotkey = false;
            state.addingFolderInline = false;
            state.renamingFolderId = null;
            state.editingLabelIndex = null;
            state.editingFolderItem = null;
        }

        function openPalette() {
            ensureOverlayMounted();
            resetSubModalsAndInlineEdits();
            state.paletteOpen = true;
            state.managerOpen = false;
            state.paletteQuery = '';
            state.paletteIndex = 0;
            if (overlayEls && overlayEls.paletteSearch) {
                overlayEls.paletteSearch.value = '';
            }
            renderAll();
            setTimeout(() => {
                if (
                    overlayEls &&
                    overlayEls.paletteSearch &&
                    typeof overlayEls.paletteSearch.focus === 'function'
                ) {
                    overlayEls.paletteSearch.focus();
                }
            }, 20);
        }

        function openManager() {
            ensureOverlayMounted();
            resetSubModalsAndInlineEdits();
            state.managerOpen = true;
            state.paletteOpen = false;
            renderAll();
        }

        function showToast(message) {
            ensureOverlayMounted();
            if (!overlayEls || !overlayEls.toast) {
                return;
            }
            overlayEls.toast.textContent = String(message || '');
            overlayEls.toast.classList.remove('hidden');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                if (overlayEls && overlayEls.toast) {
                    overlayEls.toast.classList.add('hidden');
                }
            }, 2600);
        }

        function update(nextState = {}) {
            if (nextState && typeof nextState === 'object') {
                if (typeof nextState.url === 'string') {
                    state.url = nextState.url;
                }
                if (nextState.packs && typeof nextState.packs === 'object') {
                    state.packs = { ...nextState.packs };
                }
                if (nextState.localScripts && typeof nextState.localScripts === 'object') {
                    state.localScripts = { ...nextState.localScripts };
                }
                if (Array.isArray(nextState.layout)) {
                    state.layout = nextState.layout;
                }
                if (nextState.recents && typeof nextState.recents === 'object') {
                    state.recents = { ...nextState.recents };
                }
                if (nextState.settings && typeof nextState.settings === 'object') {
                    state.settings = Core.normalizeSettings({
                        ...state.settings,
                        ...nextState.settings,
                    });
                }
            }
            renderAll();
        }

        function isRecordingHotkey() {
            return Boolean(state.recordingHotkey);
        }

        function destroy() {
            clearTimeout(toastTimer);
            if (activeDockDrag && typeof activeDockDrag.cleanup === 'function') {
                activeDockDrag.cleanup();
            }
            if (state.dragState.cancelTouchDrag) {
                state.dragState.cancelTouchDrag();
            }
            unmountToolbarHost();
            if (overlayHost) {
                if (typeof overlayHost.remove === 'function') {
                    overlayHost.remove();
                } else if (overlayHost.parentNode) {
                    overlayHost.parentNode.removeChild(overlayHost);
                }
            }
            if (doc && typeof doc.removeEventListener === 'function') {
                doc.removeEventListener('click', handleDocumentClick);
                doc.removeEventListener('keydown', handleDocumentKeydown);
            }
        }

        // Initial render of Toolbar (does NOT create overlayHost until openPalette/openManager/showToast is called)
        renderToolbarView();

        return Object.freeze({
            update,
            openPalette,
            openManager,
            showToast,
            isRecordingHotkey,
            destroy,
            isToolbarMounted: () => toolbarMounted,
            getToolbarHost: () => toolbarHost,
            getOverlayHost: () => overlayHost,
            getToolbarShadowRoot: () => toolbarShadow,
            getOverlayShadowRoot: () => overlayShadow,
        });
    }

    return Object.freeze({
        DEFAULT_DRAG_HINT,
        buildStyles,
        createInlineEditPill,
        bindDropTarget,
        clearDropTarget,
        positionPopoverInViewport,
        createToolbarUI,
    });
})();

const createToolbarUI = BookmarkletToolbarUI.createToolbarUI;

try {
    if (typeof module === 'object' && module && module.exports) {
        module.exports = BookmarkletToolbarUI;
    }
} catch {}
