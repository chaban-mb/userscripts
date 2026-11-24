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
    let lastTrustedTypesApi = null;

    function getTrustedTypesPolicy(win) {
        const tt =
            (win && win.trustedTypes) ||
            (typeof trustedTypes !== 'undefined' ? trustedTypes : null);
        if (!tt || typeof tt.createPolicy !== 'function') {
            return null;
        }
        try {
            if (lastTrustedTypesApi !== tt || !trustedTypesPolicy) {
                lastTrustedTypesApi = tt;
                trustedTypesPolicy = tt.createPolicy('userjs-bt-toolbar', {
                    createScript: (s) => s,
                    createScriptURL: (u) => u,
                });
            }
            return trustedTypesPolicy;
        } catch {
            return null;
        }
    }

    function executeScriptInPage(rawCode, { doc, win, gmAddElement, onError } = {}) {
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

        let phase = 'inline'; // 'inline' | 'blob' | 'done'
        let runtimeFailed = false;
        let capturedError = null;
        let errorReported = false;
        let syncPhaseDone = false;
        let cspCleanupTimer = null;
        let activeBlobUrl = null;
        let activeBlobRevoker = null;
        let activeBlobScript = null;
        let onBlobLoad = null;
        let onBlobError = null;

        const reportErrorOnce = (msg) => {
            if (errorReported || !msg) {
                return;
            }
            errorReported = true;
            if (typeof onError === 'function') {
                onError(msg);
            }
        };

        const cleanupBlobState = () => {
            if (activeBlobScript) {
                if (typeof activeBlobScript.removeEventListener === 'function') {
                    if (onBlobLoad) {
                        activeBlobScript.removeEventListener('load', onBlobLoad);
                    }
                    if (onBlobError) {
                        activeBlobScript.removeEventListener('error', onBlobError);
                    }
                }
                detachElement(activeBlobScript);
                activeBlobScript = null;
            }
            onBlobLoad = null;
            onBlobError = null;
            if (activeBlobUrl && typeof activeBlobRevoker === 'function') {
                try {
                    activeBlobRevoker(activeBlobUrl);
                } catch {}
            }
            activeBlobUrl = null;
            activeBlobRevoker = null;
        };

        const removeCspListener = () => {
            if (cspCleanupTimer !== null) {
                clearTimeout(cspCleanupTimer);
                cspCleanupTimer = null;
            }
            cleanupBlobState();
            if (typeof resolvedDoc.removeEventListener === 'function') {
                resolvedDoc.removeEventListener('securitypolicyviolation', onCspViolation, true);
            }
            if (cleanupPendingCspListener === removeCspListener) {
                cleanupPendingCspListener = null;
            }
        };

        const finishWithError = (msg) => {
            phase = 'done';
            capturedError = msg;
            removeCspListener();
            if (syncPhaseDone) {
                reportErrorOnce(msg);
            }
        };

        const tryGmLastResort = (cspReason) => {
            phase = 'done';
            cleanupBlobState();
            if (typeof gmAddElement === 'function') {
                try {
                    gmAddElement(mountContainer, 'script', {
                        textContent: normalizedCode,
                    });
                    capturedError = null;
                    removeCspListener();
                    return;
                } catch (gmErr) {
                    const gmMsg =
                        gmErr && gmErr.message ? String(gmErr.message) : cspReason;
                    finishWithError(gmMsg);
                    return;
                }
            }
            finishWithError(cspReason);
        };

        const tryBlobFallback = (cspReason) => {
            phase = 'blob';
            const BlobCtor =
                (resolvedWin && resolvedWin.Blob) ||
                (typeof Blob === 'function' ? Blob : null);
            const urlApi =
                (resolvedWin && resolvedWin.URL) ||
                (typeof URL !== 'undefined' ? URL : null);

            if (
                typeof BlobCtor !== 'function' ||
                !urlApi ||
                typeof urlApi.createObjectURL !== 'function'
            ) {
                tryGmLastResort(cspReason);
                return;
            }

            let rawBlobUrl = '';
            try {
                const blob = new BlobCtor([normalizedCode], { type: 'text/javascript' });
                rawBlobUrl = urlApi.createObjectURL(blob);
            } catch {
                tryGmLastResort(cspReason);
                return;
            }

            let scriptUrlPayload = rawBlobUrl;
            const policy = getTrustedTypesPolicy(resolvedWin);
            if (policy && typeof policy.createScriptURL === 'function') {
                try {
                    scriptUrlPayload = policy.createScriptURL(rawBlobUrl);
                } catch {
                    // Fall through to raw URL inside outer try/catch
                }
            }

            activeBlobUrl = rawBlobUrl;
            activeBlobRevoker =
                typeof urlApi.revokeObjectURL === 'function'
                    ? urlApi.revokeObjectURL.bind(urlApi)
                    : null;

            const blobScript = resolvedDoc.createElement('script');
            activeBlobScript = blobScript;

            const settleBlobSuccess = () => {
                if (phase !== 'blob') {
                    return;
                }
                phase = 'done';
                capturedError = null;
                removeCspListener();
            };

            const settleBlobFailure = (reason) => {
                if (phase !== 'blob') {
                    return;
                }
                tryGmLastResort(reason || cspReason);
            };

            onBlobLoad = () => settleBlobSuccess();
            onBlobError = () => settleBlobFailure(cspReason);

            if (typeof blobScript.addEventListener === 'function') {
                blobScript.addEventListener('load', onBlobLoad, { once: true });
                blobScript.addEventListener('error', onBlobError, { once: true });
            }

            if (cspCleanupTimer !== null) {
                clearTimeout(cspCleanupTimer);
            }
            cspCleanupTimer = setTimeout(removeCspListener, 1500);
            cleanupPendingCspListener = removeCspListener;

            try {
                blobScript.src = scriptUrlPayload;
                mountContainer.appendChild(blobScript);
            } catch (err) {
                settleBlobFailure(
                    err && err.message ? String(err.message) : cspReason
                );
            }
        };

        function onCspViolation(event) {
            if (runtimeFailed || phase === 'done') {
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
                !(
                    isScriptDirective ||
                    (blocked === 'inline' && directive.includes('default-src'))
                )
            ) {
                return;
            }

            const cspMsg = `Blocked by page Content Security Policy (${directive}).`;
            if (phase === 'inline') {
                tryBlobFallback(cspMsg);
            } else if (phase === 'blob') {
                tryGmLastResort(cspMsg);
            }
        }

        const onWindowError = (event) => {
            if (capturedError || phase === 'done') {
                return;
            }
            runtimeFailed = true;
            const detail =
                (event && event.message) ||
                (event && event.error && event.error.message) ||
                'Runtime error during bookmarklet execution.';
            finishWithError(String(detail));
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
            const policy = getTrustedTypesPolicy(resolvedWin);
            if (policy && typeof policy.createScript === 'function') {
                try {
                    scriptPayload = policy.createScript(normalizedCode);
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
                phase = 'done';
            }
        } finally {
            syncPhaseDone = true;
            detachElement(scriptEl);
            if (resolvedWin && typeof resolvedWin.removeEventListener === 'function') {
                resolvedWin.removeEventListener('error', onWindowError, true);
            }
            if (capturedError) {
                removeCspListener();
            } else if (phase === 'inline') {
                cleanupPendingCspListener = removeCspListener;
                cspCleanupTimer = setTimeout(() => {
                    if (phase === 'inline') {
                        phase = 'done';
                    }
                    removeCspListener();
                }, 100);
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
