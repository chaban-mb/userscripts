// ==UserScript==
// @name         MusicBrainz: Auto login MusicBrainz ISRC importers
// @namespace    https://musicbrainz.org/user/chaban
// @version      2.2.0
// @description  Attempts to login on MusicBrainz ISRC submission sites like ISRC Hunt or MagicISRC and automatically handle OAuth authorization
// @tag          ai-created
// @author       chaban
// @license      MIT
// @match        https://*.musicbrainz.org/oauth2/authorize*
// @match        https://metabrainz.org/oauth2/authorize*
// @match        https://magicisrc.kepstin.ca/*
// @match        https://magicisrc-beta.kepstin.ca/
// @match        https://isrchunt.com/*
// @exclude      https://magicisrc.kepstin.ca/?code=*
// @exclude      https://magicisrc.kepstin.ca/?state=*
// @exclude      https://magicisrc-beta.kepstin.ca/?code=*
// @exclude      https://magicisrc-beta.kepstin.ca/?state=*
// @icon         https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js
// @downloadURL  https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Helper function for logging messages to the console, useful for debugging.
    function log(message) {
        console.log(`[MusicBrainz Auto Login] ${message}`);
    }

    // --- Configuration for Trusted Clients ---
    // Defines trusted client IDs, their associated redirect URI base URLs, and expected OAuth scopes for validation.
    const trustedClients = {
        'oxqZoCJWy9BQXgS7UTikeA': { // MagicISRC main site
            redirectUriBase: 'https://magicisrc.kepstin.ca',
            expectedScopes: ['profile', 'submit_isrc'],
            name: 'MagicISRC (main)'
        },
        'flI-ayzX2u2pzMWosH27FQ': { // MagicISRC beta site
            redirectUriBase: 'https://magicisrc-beta.kepstin.ca',
            expectedScopes: ['profile', 'submit_isrc'],
            name: 'MagicISRC (beta)'
        },
        'BzRD1-z1sMBfKVnOaJiMLIFL6_7WSaL5': { // ISRC Hunt
            redirectUriBase: 'https://isrchunt.com',
            expectedScopes: ['profile', 'submit_isrc'],
            name: 'ISRCHunt'
        }
    };

    // --- Derived Configuration for Importer Pages ---
    // Extract the unique origins of the trusted ISRC importer sites.
    const trustedImporterOrigins = Object.values(trustedClients)
        .map(client => new URL(client.redirectUriBase).origin + '/')
        .filter((value, index, self) => self.indexOf(value) === index)

    /**
     * @summary Checks if the requested scopes exactly match the expected scopes, ignoring order.
     * @param {string} requestedScopeString - The space-separated string of requested scopes.
     * @param {string[]} expectedScopes - An array of expected scope strings.
     * @returns {boolean} True if the scopes match exactly, false otherwise.
     */
    function isValidScope(requestedScopeString, expectedScopes) {
        if (!requestedScopeString) {
            log("Scope validation FAILED: No 'scope' parameter found in URL.");
            return false;
        }

        const requestedScopes = requestedScopeString.split(/[\s+]/).filter(s => s).sort();
        const sortedExpectedScopes = [...expectedScopes].sort(); // Create a copy to avoid modifying original

        if (requestedScopes.length !== sortedExpectedScopes.length) {
            log(`Scope validation FAILED: Length mismatch. Requested: ${requestedScopes.length}, Expected: ${sortedExpectedScopes.length}`);
            return false;
        }

        const allMatch = requestedScopes.every((scope, index) => scope === sortedExpectedScopes[index]);
        if (!allMatch) {
            log(`Scope validation FAILED: Content mismatch. Requested: [${requestedScopes.join(', ')}], Expected: [${sortedExpectedScopes.join(', ')}]`);
        }
        return allMatch;
    }

    function isMetaBrainzSSORedirect(redirectUri) {
        if (!redirectUri) return false;
        try {
            const url = new URL(redirectUri);
            const isMusicBrainzHost = url.hostname === 'musicbrainz.org' || url.hostname.endsWith('.musicbrainz.org');
            const isCallbackPath = url.pathname === '/metabrainz/oauth2/callback';
            return isMusicBrainzHost && isCallbackPath;
        } catch {
            return false;
        }
    }

    function handleOAuthAuthorizationPage() {
        log('Detected OAuth authorization page.');

        const urlParams = new URLSearchParams(window.location.search);
        const redirectUri = urlParams.get('redirect_uri');
        const clientId = urlParams.get('client_id');
        const requestedScopeString = urlParams.get('scope');

        let isTrustedClient = false;
        let clientName = 'Unknown';
        let redirectUriOrigin = null;

        try {
            redirectUriOrigin = redirectUri ? new URL(redirectUri).origin : null;

            if (window.location.hostname === 'metabrainz.org' && isMetaBrainzSSORedirect(redirectUri)) {
                if (isValidScope(requestedScopeString, ['profile'])) {
                    isTrustedClient = true;
                    clientName = 'MetaBrainz SSO (MusicBrainz)';
                    log('MetaBrainz SSO redirect matched for MusicBrainz.');
                } else {
                    log('MetaBrainz SSO validation FAILED: Scope mismatch.');
                }
            } else {
                for (const id in trustedClients) {
                    const clientInfo = trustedClients[id];
                    const trustedOrigin = new URL(clientInfo.redirectUriBase).origin;

                    if (clientId === id && redirectUriOrigin && redirectUriOrigin === trustedOrigin) {
                        clientName = clientInfo.name;
                        log(`Client ID and Redirect URI Origin matched for: ${clientName}`);

                        if (isValidScope(requestedScopeString, clientInfo.expectedScopes)) {
                            isTrustedClient = true;
                            log(`Scope validation passed for ${clientName}.`);
                        } else {
                            log(`Final validation FAILED: Scopes did not match for ${clientName}.`);
                        }
                        break;
                    }
                }
            }
        } catch (e) {
            log(`Error during OAuth validation: ${e.message}. Script will not auto-confirm.`);
            return;
        }

        if (isTrustedClient) {
            log(`OAuth request is fully validated for trusted client: ${clientName}
                 (Redirect URI: ${redirectUri}, Client ID: ${clientId || 'N/A'})`);

            let confirmButton = null;

            // Target the exact submit button depending on domain
            if (window.location.hostname.endsWith('musicbrainz.org')) {
                confirmButton = document.querySelector('button[name="confirm.submit"]');
            } else if (window.location.hostname === 'metabrainz.org') {
                confirmButton = document.querySelector('form[action*="/oauth2/authorize"] button[type="submit"]')
                    || document.querySelector('button[name="confirm"]');
            }

            if (confirmButton) {
                log('OAuth confirmation button found. Clicking it...');
                confirmButton.click();
            } else {
                log('OAuth confirmation button not found.');
            }
        } else {
            log(`OAuth request is NOT fully validated for auto-confirmation.
                 Detected Redirect URI: ${redirectUri}, Detected Client ID: ${clientId}, Detected Scopes: ${requestedScopeString || 'N/A'}`);
        }
    }

    /**
     * @summary Automatically initiates the login process on supported ISRC importer sites.
     * Looks for specific login buttons or links and simulates a click.
     */
    function handleISRCImporterLoginPage() {
        log('Detected ISRC importer page.');

        // Attempt to click the login button specific to MagicISRC.
        const magicisrcLoginButton = document.querySelector('button[onclick^="doLogin();"]');
        if (magicisrcLoginButton) {
            log('Found MagicISRC login button with doLogin(). Clicking it...');
            magicisrcLoginButton.click();
        } else {
            log('MagicISRC login button not found.');
        }

        // Attempt to click the login link specific to ISRC Hunt.
        const isrchuntLoginLink = document.querySelector('a[href^="https://musicbrainz.org/oauth2/authorize"]');
        if (isrchuntLoginLink) {
            log('Found ISRC Hunt login link. Clicking it...');
            isrchuntLoginLink.click();
        } else {
            log('ISRC Hunt login link not found.');
        }
    }

    const currentUrl = window.location.href;

    if (currentUrl.includes('/oauth2/authorize')) {
        handleOAuthAuthorizationPage();
    } else if (trustedImporterOrigins.some(origin => currentUrl.startsWith(origin))) {
        handleISRCImporterLoginPage();
    } else {
        log('Current URL does not match any known handler.');
    }

})();
