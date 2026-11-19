// ==UserScript==
// @name         Bookmarklet Toolbar Adapters
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Site mount adapters and CSP-aware page execution for Site Bookmarklet Toolbar.
// @author       chaban
// @license      MIT
// ==/UserScript==

const BookmarkletToolbarAdapters = (() => {
    'use strict';

    const Core =
        typeof BookmarkletToolbarCore !== 'undefined'
            ? BookmarkletToolbarCore
            : typeof require === 'function'
              ? require('./BookmarkletToolbarCore.js')
              : null;

    const MB_URL_PATTERNS = Object.freeze([
        '*://*.musicbrainz.org/*',
        '*://*.musicbrainz.eu/*',
    ]);

    function applyInlineStyles(el, cssText, props) {
        if (!el) {
            return;
        }
        if (!el.style || typeof el.style !== 'object') {
            el.style = {};
        }
        el.style.cssText = cssText;
        for (const [key, value] of Object.entries(props)) {
            el.style[key] = value;
        }
    }

    function detachElement(hostEl) {
        if (!hostEl) {
            return;
        }
        if (hostEl.parentNode && typeof hostEl.parentNode.removeChild === 'function') {
            hostEl.parentNode.removeChild(hostEl);
        } else if (typeof hostEl.remove === 'function') {
            hostEl.remove();
        }
    }

    function findMusicBrainzMountTarget(doc) {
        if (!doc || typeof doc.querySelector !== 'function') {
            return null;
        }
        const topRow =
            doc.querySelector('div.header .right .top') ||
            doc.querySelector('.header .right .top');
        if (!topRow) {
            return null;
        }
        const searchContainer =
            (typeof topRow.querySelector === 'function' &&
                topRow.querySelector('.search-container')) ||
            doc.querySelector('div.header .right .top .search-container') ||
            doc.querySelector('.header .right .top .search-container');
        if (!searchContainer) {
            return null;
        }
        return { topRow, searchContainer };
    }

    const musicbrainzAdapter = Object.freeze({
        id: 'musicbrainz',
        matches(url, doc) {
            if (!Core || typeof Core.matchPattern !== 'function' || typeof url !== 'string') {
                return false;
            }
            const urlMatches = MB_URL_PATTERNS.some((pattern) => Core.matchPattern(pattern, url));
            if (!urlMatches) {
                return false;
            }
            const resolvedDoc = doc || (typeof document !== 'undefined' ? document : null);
            return findMusicBrainzMountTarget(resolvedDoc) !== null;
        },
        mount(doc, hostEl) {
            const resolvedDoc = doc || (typeof document !== 'undefined' ? document : null);
            if (!resolvedDoc || !hostEl) {
                return false;
            }
            const target = findMusicBrainzMountTarget(resolvedDoc);
            if (!target) {
                return false;
            }
            const { topRow, searchContainer } = target;

            applyInlineStyles(
                topRow,
                'display: flex; align-items: center; flex-wrap: wrap; gap: 6px;',
                {
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '6px',
                }
            );

            applyInlineStyles(
                hostEl,
                'display: inline-flex; align-items: center; flex: 1 1 auto; min-width: 0; margin: 0 8px; vertical-align: middle;',
                {
                    display: 'inline-flex',
                    alignItems: 'center',
                    flex: '1 1 auto',
                    minWidth: '0',
                    margin: '0 8px',
                    verticalAlign: 'middle',
                }
            );

            const alreadyBeforeSearch =
                hostEl.parentNode === topRow &&
                (hostEl.nextSibling === searchContainer ||
                    (Array.isArray(topRow.children) &&
                        topRow.children.indexOf(hostEl) !== -1 &&
                        topRow.children.indexOf(hostEl) ===
                            topRow.children.indexOf(searchContainer) - 1));

            if (!alreadyBeforeSearch && typeof topRow.insertBefore === 'function') {
                topRow.insertBefore(hostEl, searchContainer);
            }
            return true;
        },
        unmount(doc, hostEl) {
            detachElement(hostEl);
        },
    });

    const fallbackAdapter = Object.freeze({
        id: 'fallback',
        matches() {
            return true;
        },
        mount(doc, hostEl) {
            const resolvedDoc = doc || (typeof document !== 'undefined' ? document : null);
            if (!resolvedDoc || !hostEl) {
                return false;
            }
            const container = resolvedDoc.body || resolvedDoc.documentElement;
            if (!container || typeof container.appendChild !== 'function') {
                return false;
            }

            applyInlineStyles(
                hostEl,
                'position: fixed; right: 16px; bottom: 16px; z-index: 2147483640;',
                {
                    position: 'fixed',
                    right: '16px',
                    bottom: '16px',
                    zIndex: '2147483640',
                }
            );

            if (hostEl.parentNode !== container) {
                container.appendChild(hostEl);
            }
            return true;
        },
        unmount(doc, hostEl) {
            detachElement(hostEl);
        },
    });

    const SITE_ADAPTERS = [musicbrainzAdapter, fallbackAdapter];
    Object.defineProperties(SITE_ADAPTERS, {
        musicbrainz: { value: musicbrainzAdapter, enumerable: false },
        fallback: { value: fallbackAdapter, enumerable: false },
    });
    Object.freeze(SITE_ADAPTERS);

    function resolveMountAdapter(url, doc) {
        const resolvedDoc = doc || (typeof document !== 'undefined' ? document : null);
        for (const adapter of SITE_ADAPTERS) {
            if (adapter.matches(url, resolvedDoc)) {
                return adapter;
            }
        }
        return fallbackAdapter;
    }

    let cleanupPendingCspListener = null;

    function executeScriptInPage(rawCode, { doc, win, onError } = {}) {
        if (typeof cleanupPendingCspListener === 'function') {
            cleanupPendingCspListener();
            cleanupPendingCspListener = null;
        }

        const resolvedDoc = doc || (typeof document !== 'undefined' ? document : null);
        const resolvedWin =
            win ||
            (resolvedDoc && resolvedDoc.defaultView) ||
            (typeof window !== 'undefined' ? window : null);

        const normalizedCode =
            Core && typeof Core.normalizeBookmarkletCode === 'function'
                ? Core.normalizeBookmarkletCode(rawCode)
                : typeof rawCode === 'string'
                  ? rawCode.replace(/^javascript:\s*/i, '').trim()
                  : '';

        if (!normalizedCode) {
            const emptyMsg = 'Bookmarklet code is empty.';
            if (typeof onError === 'function') {
                onError(emptyMsg);
            }
            return { ok: false, error: emptyMsg };
        }

        if (!resolvedDoc || typeof resolvedDoc.createElement !== 'function') {
            const docMsg = 'Document context is unavailable for page script execution.';
            if (typeof onError === 'function') {
                onError(docMsg);
            }
            return { ok: false, error: docMsg };
        }

        const mountContainer =
            resolvedDoc.head || resolvedDoc.documentElement || resolvedDoc.body;
        if (!mountContainer || typeof mountContainer.appendChild !== 'function') {
            const containerMsg = 'Document lacks a mount container for inline script execution.';
            if (typeof onError === 'function') {
                onError(containerMsg);
            }
            return { ok: false, error: containerMsg };
        }

        let capturedError = null;
        let errorReported = false;
        let syncPhaseDone = false;
        let cspCleanupTimer = null;

        const reportErrorOnce = (msg) => {
            if (errorReported || !msg) {
                return;
            }
            errorReported = true;
            if (typeof onError === 'function') {
                onError(msg);
            }
        };

        const removeCspListener = () => {
            if (cspCleanupTimer !== null) {
                clearTimeout(cspCleanupTimer);
                cspCleanupTimer = null;
            }
            if (typeof resolvedDoc.removeEventListener === 'function') {
                resolvedDoc.removeEventListener('securitypolicyviolation', onCspViolation, true);
            }
            if (cleanupPendingCspListener === removeCspListener) {
                cleanupPendingCspListener = null;
            }
        };

        const onCspViolation = (event) => {
            if (capturedError) {
                return;
            }
            const directive =
                (event && (event.effectiveDirective || event.violatedDirective)) ||
                'script-src';
            const blocked = (event && event.blockedURI) || 'inline';
            if (
                blocked === 'inline' ||
                blocked === '' ||
                String(directive).includes('script-src')
            ) {
                capturedError = `Blocked by page Content Security Policy (${directive}).`;
                removeCspListener();
                if (syncPhaseDone) {
                    reportErrorOnce(capturedError);
                }
            }
        };

        const onWindowError = (event) => {
            if (capturedError) {
                return;
            }
            const detail =
                (event && event.message) ||
                (event && event.error && event.error.message) ||
                'Runtime error during bookmarklet execution.';
            capturedError = String(detail);
        };

        if (typeof resolvedDoc.addEventListener === 'function') {
            resolvedDoc.addEventListener('securitypolicyviolation', onCspViolation, true);
        }
        if (resolvedWin && typeof resolvedWin.addEventListener === 'function') {
            resolvedWin.addEventListener('error', onWindowError, true);
        }

        const scriptEl = resolvedDoc.createElement('script');
        scriptEl.textContent = normalizedCode;

        try {
            mountContainer.appendChild(scriptEl);
        } catch (err) {
            if (!capturedError) {
                capturedError =
                    err && err.message
                        ? String(err.message)
                        : 'Inline script execution failed.';
            }
        } finally {
            syncPhaseDone = true;
            detachElement(scriptEl);
            if (resolvedWin && typeof resolvedWin.removeEventListener === 'function') {
                resolvedWin.removeEventListener('error', onWindowError, true);
            }
            if (capturedError) {
                removeCspListener();
            } else {
                cleanupPendingCspListener = removeCspListener;
                cspCleanupTimer = setTimeout(removeCspListener, 100);
            }
        }

        if (capturedError) {
            reportErrorOnce(capturedError);
            return { ok: false, error: capturedError };
        }

        return { ok: true };
    }

    return Object.freeze({
        SITE_ADAPTERS,
        resolveMountAdapter,
        executeScriptInPage,
    });
})();

try {
    if (typeof module === 'object' && module && module.exports) {
        module.exports = BookmarkletToolbarAdapters;
    }
} catch {}
