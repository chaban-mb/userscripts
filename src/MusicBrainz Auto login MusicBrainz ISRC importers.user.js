// ==UserScript==
// @name        MusicBrainz: Auto login MusicBrainz ISRC importers
// @namespace   https://musicbrainz.org/user/chaban
// @version     2.3.2
// @description Attempts to login on MusicBrainz ISRC submission sites like ISRC Hunt or MagicISRC and automatically handle OAuth authorization
// @tag         ai-created
// @author      chaban
// @license     MIT
// @match       https://*.musicbrainz.org/oauth2/authorize*
// @match       https://metabrainz.org/oauth2/authorize*
// @match       https://magicisrc.kepstin.ca/*
// @match       https://magicisrc-beta.kepstin.ca/
// @match       https://isrchunt.com/*
// @exclude     https://magicisrc.kepstin.ca/?code=*
// @exclude     https://magicisrc.kepstin.ca/?state=*
// @exclude     https://magicisrc-beta.kepstin.ca/?code=*
// @exclude     https://magicisrc-beta.kepstin.ca/?state=*
// @icon        https://musicbrainz.org/static/images/favicons/android-chrome-512x512.png
// @grant       none
// @run-at      document-idle
// @updateURL   https://github.com/chaban-mb/userscripts/raw/dist/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js
// @downloadURL https://github.com/chaban-mb/userscripts/raw/dist/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js
// ==/UserScript==

(() => {
    'use strict';

    /**
     * Enum for supported logging severity levels.
     * @readonly
     * @enum {number}
     */
    const LOG_LEVELS = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        NONE: 4
    };

    /**
     * Adjust active log level here (e.g., LOG_LEVELS.DEBUG for full verbose logs).
     * @type {number}
     */
    const CURRENT_LOG_LEVEL = LOG_LEVELS.INFO;

    /** @type {string} */
    const scriptName = GM.info.script.name;

    /**
     * Logs a message to the browser console if the level meets or exceeds CURRENT_LOG_LEVEL.
     *
     * @param {number} level - Log level from LOG_LEVELS enum.
     * @param {string} msg - The log message text.
     * @returns {void}
     */
    const log = (level, msg) => {
        if (level < CURRENT_LOG_LEVEL) return;
        const prefix = `[${scriptName}]`;

        switch (level) {
            case LOG_LEVELS.DEBUG:
                console.debug(`${prefix} ${msg}`);
                break;
            case LOG_LEVELS.INFO:
                console.info(`${prefix} ${msg}`);
                break;
            case LOG_LEVELS.WARN:
                console.warn(`${prefix} ${msg}`);
                break;
            case LOG_LEVELS.ERROR:
                console.error(`${prefix} ${msg}`);
                break;
        }
    };

    /**
     * Configuration map of trusted OAuth client IDs and their authorization expectations.
     * @type {Object.<string, {name: string, expectedScopes: string[], redirectBase: string, allowSubdomains?: boolean, isImporter?: boolean}>}
     */
    const trustedClients = {
        // MusicBrainz OAuth
        'oxqZoCJWy9BQXgS7UTikeA': {
            name: 'MagicISRC (main)',
            expectedScopes: ['profile', 'submit_isrc'],
            redirectBase: 'https://magicisrc.kepstin.ca',
            isImporter: true
        },
        'flI-ayzX2u2pzMWosH27FQ': {
            name: 'MagicISRC (beta)',
            expectedScopes: ['profile', 'submit_isrc'],
            redirectBase: 'https://magicisrc-beta.kepstin.ca',
            isImporter: true
        },
        'BzRD1-z1sMBfKVnOaJiMLIFL6_7WSaL5': {
            name: 'ISRCHunt',
            expectedScopes: ['profile', 'submit_isrc'],
            redirectBase: 'https://isrchunt.com',
            isImporter: true
        },
        // MetaBrainz OAuth
        'Xe88DZesznjEzGaxAjBZYfqI': {
            name: 'MusicBrainz',
            expectedScopes: ['profile'],
            redirectBase: 'https://musicbrainz.org/metabrainz/oauth2/callback',
            allowSubdomains: true
        }
    };

    /**
     * Set of unique origins corresponding to trusted importer sites.
     * @type {string[]}
     */
    const trustedImporterOrigins = [
        ...new Set(
            Object.values(trustedClients)
                .filter(c => c.isImporter)
                .map(c => `${new URL(c.redirectBase).origin}/`)
        )
    ];

    /**
     * Validates whether requested OAuth scopes match expected scopes exactly (order-insensitive).
     *
     * @param {?string} requestedScopeString - Raw space/plus-separated scope string from URL query params.
     * @param {string[]} expectedScopes - Array of required scope strings.
     * @returns {boolean} True if the requested scopes match the expected set.
     */
    const isValidScope = (requestedScopeString, expectedScopes) => {
        if (!requestedScopeString) {
            log(LOG_LEVELS.WARN, "Scope validation FAILED: No 'scope' parameter found in URL.");
            return false;
        }

        const requestedScopes = requestedScopeString.split(/[\s+]/).filter(Boolean).sort();
        const sortedExpectedScopes = [...expectedScopes].sort();

        if (requestedScopes.length !== sortedExpectedScopes.length) {
            log(LOG_LEVELS.WARN, `Scope validation FAILED: Length mismatch. Requested: ${requestedScopes.length}, Expected: ${sortedExpectedScopes.length}`);
            return false;
        }

        const allMatch = requestedScopes.every((scope, i) => scope === sortedExpectedScopes[i]);
        if (!allMatch) {
            log(LOG_LEVELS.WARN, `Scope validation FAILED: Content mismatch. Requested: [${requestedScopes.join(', ')}], Expected: [${sortedExpectedScopes.join(', ')}]`);
        }
        return allMatch;
    };

    /**
     * Validates whether a redirect URL matches the trusted client's configured redirect base and host rules.
     *
     * @param {?URL} redirectUrl - Parsed URL instance of the redirect_uri parameter.
     * @param {{redirectBase: string, allowSubdomains?: boolean}} clientInfo - Client configuration.
     * @returns {boolean} True if the redirect URL is valid.
     */
    const isValidRedirect = (redirectUrl, clientInfo) => {
        if (!redirectUrl) return false;
        const expectedUrl = new URL(clientInfo.redirectBase);

        if (redirectUrl.protocol !== expectedUrl.protocol) return false;

        const isHostValid = clientInfo.allowSubdomains
            ? redirectUrl.hostname === expectedUrl.hostname || redirectUrl.hostname.endsWith(`.${expectedUrl.hostname}`)
            : redirectUrl.hostname === expectedUrl.hostname;

        if (!isHostValid) return false;

        if (expectedUrl.pathname !== '/' && redirectUrl.pathname !== expectedUrl.pathname) {
            return false;
        }

        return true;
    };

    /**
     * Evaluates OAuth authorization requests on MusicBrainz or MetaBrainz and clicks submit if trusted.
     * @returns {void}
     */
    const handleOAuthAuthorizationPage = () => {
        log(LOG_LEVELS.DEBUG, 'Detected OAuth authorization page.');

        const urlParams = new URLSearchParams(window.location.search);
        const redirectUri = urlParams.get('redirect_uri');
        const clientId = urlParams.get('client_id');
        const requestedScopeString = urlParams.get('scope');

        let isTrustedClient = false;
        let clientName = 'Unknown';

        try {
            const redirectUrl = redirectUri ? new URL(redirectUri) : null;
            const clientInfo = trustedClients[clientId];

            if (!clientInfo) {
                log(LOG_LEVELS.WARN, `OAuth validation FAILED: Untrusted client_id '${clientId}'.`);
            } else if (!isValidRedirect(redirectUrl, clientInfo)) {
                log(LOG_LEVELS.WARN, `OAuth validation FAILED: Invalid redirect URI '${redirectUri}' for ${clientInfo.name}.`);
            } else if (!isValidScope(requestedScopeString, clientInfo.expectedScopes)) {
                log(LOG_LEVELS.WARN, `OAuth validation FAILED: Scope mismatch for ${clientInfo.name}.`);
            } else {
                isTrustedClient = true;
                clientName = clientInfo.name;
                log(LOG_LEVELS.DEBUG, `OAuth request validated for: ${clientName}`);
            }
        } catch (e) {
            log(LOG_LEVELS.ERROR, `Error during OAuth validation: ${e.message}. Script will not auto-confirm.`);
            return;
        }

        if (isTrustedClient) {
            log(LOG_LEVELS.INFO, `OAuth request validated for: ${clientName}. Attempting auto-confirmation...`);

            const isMB = window.location.hostname.endsWith('musicbrainz.org');
            const confirmButton = isMB
                ? document.querySelector('button[name="confirm.submit"]')
                : document.querySelector('form[action*="/oauth2/authorize"] button[type="submit"]')
                  ?? document.querySelector('button[name="confirm"]');

            if (confirmButton) {
                log(LOG_LEVELS.INFO, 'OAuth confirmation button found. Clicking...');
                confirmButton.click();
            } else {
                log(LOG_LEVELS.WARN, 'OAuth confirmation button not found on page.');
            }
        } else {
            log(LOG_LEVELS.WARN, `OAuth request NOT validated for auto-confirmation. Redirect URI: ${redirectUri}, Client ID: ${clientId}`);
        }
    };

    /**
     * Evaluates login controls on target ISRC importer sites and clicks login actions.
     * @returns {void}
     */
    const handleISRCImporterLoginPage = () => {
        log(LOG_LEVELS.DEBUG, 'Detected ISRC importer page.');
        const host = window.location.hostname;

        if (host.includes('magicisrc')) {
            const btn = document.querySelector('button[onclick^="doLogin();"]');
            if (btn) {
                log(LOG_LEVELS.INFO, 'MagicISRC login button found. Clicking...');
                btn.click();
            } else {
                log(LOG_LEVELS.WARN, 'MagicISRC login button not found.');
            }
        } else if (host.includes('isrchunt')) {
            const link = document.querySelector('a[href^="https://musicbrainz.org/oauth2/authorize"]');
            if (link) {
                log(LOG_LEVELS.INFO, 'ISRC Hunt login link found. Clicking...');
                link.click();
            } else {
                log(LOG_LEVELS.WARN, 'ISRC Hunt login link not found.');
            }
        }
    };

    const currentUrl = window.location.href;

    if (currentUrl.includes('/oauth2/authorize')) {
        handleOAuthAuthorizationPage();
    } else if (trustedImporterOrigins.some(origin => currentUrl.startsWith(origin))) {
        handleISRCImporterLoginPage();
    } else {
        log(LOG_LEVELS.DEBUG, 'Current URL does not match any known handler.');
    }

})();
