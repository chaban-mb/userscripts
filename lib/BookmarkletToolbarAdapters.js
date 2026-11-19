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

            if (!hostEl.style || !hostEl.style.position) {
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
            }

            if (hostEl.parentNode !== container) {
                container.appendChild(hostEl);
            }
            return true;
        },
        unmount(doc, hostEl) {
            detachElement(hostEl);
        },
    });

    const SITE_ADAPTERS = [fallbackAdapter];
    Object.defineProperties(SITE_ADAPTERS, {
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
    let trustedTypesPolicy = null;

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
            const directive = String(
                (event && (event.effectiveDirective || event.violatedDirective)) ||
                    'script-src'
            );
            const isScriptDirective = directive.includes('script-src');
            const rawBlocked =
                event && typeof event.blockedURI === 'string' ? event.blockedURI : '';
            const blocked = rawBlocked || (isScriptDirective ? 'inline' : '');
            if (
                isScriptDirective ||
                (blocked === 'inline' && directive.includes('default-src'))
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

        try {
            let scriptPayload = normalizedCode;
            const tt =
                (resolvedWin && resolvedWin.trustedTypes) ||
                (typeof trustedTypes !== 'undefined' ? trustedTypes : null);
            if (tt && typeof tt.createPolicy === 'function') {
                try {
                    if (!trustedTypesPolicy) {
                        trustedTypesPolicy = tt.createPolicy('userjs-bt-toolbar', {
                            createScript: (s) => s,
                        });
                    }
                    if (
                        trustedTypesPolicy &&
                        typeof trustedTypesPolicy.createScript === 'function'
                    ) {
                        scriptPayload = trustedTypesPolicy.createScript(normalizedCode);
                    }
                } catch {
                    // Fall through to direct assignment inside outer try/catch
                }
            }
            scriptEl.textContent = scriptPayload;
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
