// ==UserScript==
// @name         Bookmarklet Toolbar Bundled Packs
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @description  Bundled bookmarklet pack definitions for Site Bookmarklet Toolbar.
// @author       chaban
// @license      MIT
// ==/UserScript==

const BUNDLED_BOOKMARKLET_PACKS = [
    {
        "schemaVersion": 1,
        "id": "chaban-bookmarklets",
        "name": "MusicBrainz Bookmarklets",
        "version": "2026.11.19",
        "description": "A collection of bookmarklets for MusicBrainz, Harmony, SAMBL, and streaming platforms.",
        "homepage": "https://github.com/chaban-mb/bookmarklets",
        "scripts": [
            {
                "id": "add_to_merge_queue",
                "name": "Add currently viewed entity to merge queue",
                "label": "Merge Queue",
                "description": "Clicks the sidebar link to add the currently viewed MusicBrainz entity to the merge queue.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Edit",
                "code": "(function addToMergeQueue() {\n    document.querySelector('#sidebar [href*=\"merge_queue\"]')?.click();\n})();"
            },
            {
                "id": "approve_all_edits",
                "name": "Approve all edits on current page",
                "label": "Approve All",
                "description": "Clicks all approve vote links on the current MusicBrainz edit page (requires power vote userscript).",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Edit",
                "code": "(function approveAllEdits() {\n    document.querySelectorAll('a.positive[href*=approve]').forEach((el) => {\n        el.click();\n    });\n})();"
            },
            {
                "id": "batch_delete_entities",
                "name": "Batch delete entities",
                "label": "Batch Delete",
                "description": "Dispatches a batch delete event for selected entities to the MusicBrainz Batch Delete Entities userscript.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Edit",
                "code": "(function batchDeleteEntities() {\n    const items = Array.from(\n        document.querySelectorAll('input[name=\"add-to-merge\"]:checked, input[name=\"remove\"]:checked'),\n        (checkbox) => (checkbox.closest('tr,li') || checkbox.parentElement)?.querySelector('a[href]')?.href\n    ).filter(Boolean);\n\n    const wasHandled = !document.dispatchEvent(\n        new CustomEvent('UserJS:MusicBrainz', {\n            detail: { action: 'delete', items },\n            bubbles: true,\n            cancelable: true\n        })\n    );\n\n    if (!wasHandled) {\n        alert('MusicBrainz: Batch Delete Entities userscript is not active on this page.');\n    }\n})();"
            },
            {
                "id": "convert_to_harmony_links",
                "name": "Convert URLs with \"album/\" or \"release/\" to Harmony links",
                "label": "Links → Harmony",
                "description": "Rewrites anchor links containing \"album/\" or \"release/\" on the current page to open in Harmony.",
                "match": [
                    "*://*/*"
                ],
                "folder": "Harmony",
                "code": "(function convertToHarmonyLinks() {\n    document.querySelectorAll('a[href*=\"album/\"], a[href*=\"release/\"]').forEach((anchor) => {\n        anchor.href = `https://harmony.pulsewidth.org.uk/release?url=${encodeURIComponent(anchor.href)}&category=preferred`;\n    });\n})();"
            },
            {
                "id": "convert_to_pseudo_release",
                "name": "Convert to pseudo-release",
                "label": "Pseudo-Release",
                "description": "Removes links, events, and labels; sets status to pseudo-release; clears barcode, packaging, format, and track lengths; and populates the edit note.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Release Editor",
                "code": "(function convertToPseudoRelease() {\n    document.querySelectorAll('[title=\"Remove link\"], .remove-release-event, .remove-release-label').forEach((el) => el.click());\n\n    const statusSelect = document.getElementById('status');\n    if (statusSelect) {\n        statusSelect.value = '4';\n        statusSelect.dispatchEvent(new Event('change'));\n    }\n\n    const barcodeInput = document.getElementById('barcode');\n    if (barcodeInput) {\n        barcodeInput.value = '';\n        barcodeInput.dispatchEvent(new Event('change'));\n    }\n\n    const noBarcodeCheckbox = document.getElementById('no-barcode');\n    if (noBarcodeCheckbox && noBarcodeCheckbox.checked) {\n        noBarcodeCheckbox.click();\n    }\n\n    document.querySelectorAll('select[id|=\"packaging\"], select[id|=\"medium-format\"]').forEach((el) => {\n        el.value = '';\n        el.dispatchEvent(new Event('change'));\n    });\n\n    document.querySelectorAll('.format input[type=\"checkbox\"]').forEach((el) => {\n        el.checked = false;\n        el.click();\n    });\n\n    document.querySelectorAll('.track-length').forEach((el) => {\n        el.value = '';\n        el.dispatchEvent(new Event('change'));\n    });\n\n    const editNoteTab = document.querySelector('[href^=\"#edit-note\"]');\n    if (editNoteTab) editNoteTab.click();\n\n    const noteTextarea = document.getElementById('edit-note-text');\n    if (noteTextarea) {\n        noteTextarea.focus();\n        noteTextarea.select();\n        document.execCommand('insertText', false, 'pseudo-release');\n    }\n})();"
            },
            {
                "id": "convert_to_sambl_links",
                "name": "Convert supported artist URLs to SAMBL links",
                "label": "Links → SAMBL",
                "description": "Rewrites supported streaming artist URLs on the current page to SAMBL artist links.",
                "match": [
                    "*://*.spotify.com/*",
                    "*://*.deezer.com/*",
                    "*://*.tidal.com/*",
                    "*://*.bandcamp.com/*",
                    "*://soundcloud.com/*",
                    "*://*.soundcloud.com/*",
                    "*://*.volumo.com/*",
                    "*://*.discogs.com/*",
                    "*://music.apple.com/*",
                    "*://*.music.apple.com/*",
                    "*://*.qobuz.com/*",
                    "*://vibe.naver.com/*",
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "SAMBL",
                "code": "(function convertToSamblLinks(newTab = false) {\n    const isSoundCloud = location.hostname.includes('soundcloud.com');\n    let selector = 'a[href*=\"/artist/\"],a[href*=\"/interpreter/\"],a[href*=\".bandcamp.com\"],a[href*=\"music.apple.com/\"],a[href*=\"vibe.naver.com\"]';\n\n    if (!isSoundCloud) {\n        selector += ',a[href*=\"soundcloud.com/\"]';\n    } else {\n        selector += ',a[class*=\"username\"]:not([aria-haspopup=\"true\"]),a[class*=\"Badge\"]:not([aria-haspopup=\"true\"]),a[class*=\"avatar\"]:not([aria-haspopup=\"true\"])';\n    }\n\n    const providers = {\n        spotify: /spotify\\.com\\/(?:intl-[a-z]+\\/)?artist\\/(\\w+)/,\n        deezer: /deezer\\.com\\/.*artist\\/(\\d+)/,\n        tidal: /tidal\\.com\\/.*artist\\/(\\d+)/,\n        bandcamp: /:\\/\\/([^.]+)\\.bandcamp\\.com/,\n        soundcloud: /soundcloud\\.com\\/([^/?#]+)(?:$|[?#])/,\n        volumo: /volumo\\.com\\/(?:\\w+\\/)?artist\\/(\\d+)/,\n        discogs: /discogs\\.com\\/artist\\/(\\d+)/,\n        applemusic: /music\\.apple\\.com\\/.+?\\/artist\\/(?:.+?\\/)?(\\d+)/,\n        qobuz: /qobuz\\.com\\/(?:\\w{2}-\\w{2}\\/)?(?:interpreter|artist)\\/(?:[^/]+\\/)*?([A-Za-z0-9]+)\\/?(?:[?#]|$)/,\n        naver: /vibe\\.naver\\.com\\/artist\\/(\\d+)/\n    };\n\n    document.querySelectorAll(selector).forEach((anchor) => {\n        const url = anchor.href;\n        let providerKey = null;\n        let providerId = null;\n\n        Object.entries(providers).some(([prov, regex]) => {\n            const match = url.match(regex);\n            if (match) {\n                providerKey = prov;\n                providerId = prov === 'soundcloud' ? `https://soundcloud.com/${match[1]}` : match[1];\n                return true;\n            }\n            return false;\n        });\n\n        if (providerKey) {\n            anchor.href = `https://sambl.lioncat6.com/newartist?provider=${providerKey}&provider_id=${encodeURIComponent(providerId)}`;\n            if (newTab) {\n                anchor.target = '_blank';\n            }\n        }\n    });\n})(false);"
            },
            {
                "id": "convert_to_sambl_links_new_tab",
                "name": "Convert supported artist URLs to SAMBL links (new tab)",
                "label": "Links → SAMBL ↗",
                "description": "Rewrites supported streaming artist URLs on the current page to SAMBL artist links (opens in a new tab).",
                "match": [
                    "*://*.spotify.com/*",
                    "*://*.deezer.com/*",
                    "*://*.tidal.com/*",
                    "*://*.bandcamp.com/*",
                    "*://soundcloud.com/*",
                    "*://*.soundcloud.com/*",
                    "*://*.volumo.com/*",
                    "*://*.discogs.com/*",
                    "*://music.apple.com/*",
                    "*://*.music.apple.com/*",
                    "*://*.qobuz.com/*",
                    "*://vibe.naver.com/*",
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "SAMBL",
                "code": "(function convertToSamblLinks(newTab = false) {\n    const isSoundCloud = location.hostname.includes('soundcloud.com');\n    let selector = 'a[href*=\"/artist/\"],a[href*=\"/interpreter/\"],a[href*=\".bandcamp.com\"],a[href*=\"music.apple.com/\"],a[href*=\"vibe.naver.com\"]';\n\n    if (!isSoundCloud) {\n        selector += ',a[href*=\"soundcloud.com/\"]';\n    } else {\n        selector += ',a[class*=\"username\"]:not([aria-haspopup=\"true\"]),a[class*=\"Badge\"]:not([aria-haspopup=\"true\"]),a[class*=\"avatar\"]:not([aria-haspopup=\"true\"])';\n    }\n\n    const providers = {\n        spotify: /spotify\\.com\\/(?:intl-[a-z]+\\/)?artist\\/(\\w+)/,\n        deezer: /deezer\\.com\\/.*artist\\/(\\d+)/,\n        tidal: /tidal\\.com\\/.*artist\\/(\\d+)/,\n        bandcamp: /:\\/\\/([^.]+)\\.bandcamp\\.com/,\n        soundcloud: /soundcloud\\.com\\/([^/?#]+)(?:$|[?#])/,\n        volumo: /volumo\\.com\\/(?:\\w+\\/)?artist\\/(\\d+)/,\n        discogs: /discogs\\.com\\/artist\\/(\\d+)/,\n        applemusic: /music\\.apple\\.com\\/.+?\\/artist\\/(?:.+?\\/)?(\\d+)/,\n        qobuz: /qobuz\\.com\\/(?:\\w{2}-\\w{2}\\/)?(?:interpreter|artist)\\/(?:[^/]+\\/)*?([A-Za-z0-9]+)\\/?(?:[?#]|$)/,\n        naver: /vibe\\.naver\\.com\\/artist\\/(\\d+)/\n    };\n\n    document.querySelectorAll(selector).forEach((anchor) => {\n        const url = anchor.href;\n        let providerKey = null;\n        let providerId = null;\n\n        Object.entries(providers).some(([prov, regex]) => {\n            const match = url.match(regex);\n            if (match) {\n                providerKey = prov;\n                providerId = prov === 'soundcloud' ? `https://soundcloud.com/${match[1]}` : match[1];\n                return true;\n            }\n            return false;\n        });\n\n        if (providerKey) {\n            anchor.href = `https://sambl.lioncat6.com/newartist?provider=${providerKey}&provider_id=${encodeURIComponent(providerId)}`;\n            if (newTab) {\n                anchor.target = '_blank';\n            }\n        }\n    });\n})(true);"
            },
            {
                "id": "deezer_api",
                "name": "Show API data for Deezer album",
                "label": "Deezer API",
                "description": "Opens the Deezer JSON API endpoint for the currently viewed Deezer album.",
                "match": [
                    "*://*.deezer.com/*"
                ],
                "folder": "Streaming",
                "code": "(function showDeezerApiData() {\n    const match = window.location.href.match(/deezer\\.com\\/\\w{2}\\/(album\\/[0-9]+)$/)?.slice(1);\n    if (match) {\n        window.open(`https://api.deezer.com/${match[0]}`);\n    }\n})();"
            },
            {
                "id": "universal_switcher",
                "name": "Universal entity subpage switcher",
                "label": "Subpage Switcher",
                "description": "Interactive prompt to convert or toggle root MusicBrainz entity links on the page to any supported subpage (edit, tags, aliases, history, artwork, etc.).",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Navigation",
                "code": "(function universalSwitcher() {\n    const actionConfigMap = {\n        e: { p: 'edit' },\n        t: { p: 'tags', x: ['url', 'genre', 'collection'] },\n        a: { p: 'aliases', x: ['release', 'url', 'collection'] },\n        o: { p: 'open_edits', x: ['genre'] },\n        h: { p: 'edits', x: ['genre'] },\n        d: { p: 'delete' },\n        c: {\n            fn: (ent) => (ent === 'event' ? 'event-art' : 'cover-art'),\n            o: ['release', 'event']\n        },\n        s: {\n            fn: (ent) => (ent === 'release-group' ? 'set-cover-art' : ent === 'event' ? 'add-event-art' : 'add-cover-art'),\n            o: ['release-group', 'release', 'event']\n        },\n        n: { p: 'edit_annotation', x: ['genre', 'url', 'collection'] },\n        l: { p: 'details', x: ['url', 'collection'] },\n        r: { p: 'ratings', o: ['artist', 'release', 'release-group', 'recording', 'work', 'event', 'label', 'place'] },\n        rel: { p: 'edit-relationships', o: ['release'] },\n        b: { p: '' } // Revert to base URL\n    };\n\n    const userInput = prompt(\n        'Convert/Toggle base entity links to:\\n' +\n        '[e]dit | [t]ags | [a]liases | [o]pen_edits | [h]istory | [d]elete\\n' +\n        '[c] artwork (release/event) | [s] set/add art (rg / release / event)\\n' +\n        '[n]otation (edit_annotation) | detai[l]s | [r]atings | [rel]ationships\\n' +\n        '[b]ase (revert to original)\\n' +\n        '(or enter custom subpage):',\n        'e'\n    );\n    if (!userInput) return;\n\n    const key = userInput.trim().toLowerCase();\n    const config = actionConfigMap[key] || { p: key };\n\n    // Matches strictly root entity paths for all 14 core MB schema entities\n    const rootEntityRegex = /^\\/(artist|collection|release(?:-group)?|recording|work|label|place|event|series|instrument|area|genre|url)\\/([0-9a-f-]{36})\\/?$/i;\n\n    let count = 0;\n    document.querySelectorAll('a[href]').forEach((anchor) => {\n        let base = anchor.dataset.mbBase;\n        let match = null;\n\n        if (base) {\n            // Already tracked: use saved root base path\n            match = base.match(rootEntityRegex);\n        } else {\n            // Untracked: check if current link is a root entity link\n            match = anchor.pathname.match(rootEntityRegex);\n            if (match) {\n                // Save original root base path so pre-existing subpages are never touched\n                anchor.dataset.mbBase = anchor.pathname.replace(/\\/+$/, '');\n                base = anchor.dataset.mbBase;\n            }\n        }\n\n        if (match) {\n            const entityType = match[1].toLowerCase();\n            const isAllowed = !config.o || config.o.includes(entityType);\n            const isNotExcluded = !config.x || !config.x.includes(entityType);\n\n            if (isAllowed && isNotExcluded) {\n                const subpage = config.fn ? config.fn(entityType) : config.p;\n                anchor.pathname = subpage ? `${base}/${subpage}` : base;\n                anchor.target = subpage ? '_blank' : '';\n                count++;\n            }\n        }\n    });\n\n    console.log(`[MB Transformer] Transformed ${count} entity links to '${config.p || key}'`);\n})();"
            },
            {
                "id": "export_storage_cookies",
                "name": "Export localStorage and Cookies",
                "label": "Export Storage",
                "description": "Generates an executable restore script for localStorage and accessible cookies and copies it to the clipboard.",
                "match": [
                    "*://*/*"
                ],
                "folder": "Utilities",
                "code": "(function exportStorageAndCookies() {\n    try {\n        const storageData = {};\n        for (let i = 0; i < localStorage.length; i++) {\n            const key = localStorage.key(i);\n            storageData[key] = localStorage.getItem(key);\n        }\n\n        const serializedStorage = JSON.stringify(storageData);\n        const cookies = document.cookie;\n\n        const storageSnippet = `const localStorageRestoreData=${serializedStorage};for(const k in localStorageRestoreData){if(Object.hasOwnProperty.call(localStorageRestoreData,k)){localStorage.setItem(k,localStorageRestoreData[k]);}}console.log('✅ localStorage restored: '+Object.keys(localStorageRestoreData).length+' items.');`.trim();\n        const cookieSnippet = `const cookieString=\\`${cookies.replace(/`/g, '\\\\`')}\\`;if(cookieString){cookieString.split('; ').forEach(cp=>{document.cookie=cp;});console.log('✅ Attempted to restore accessible cookies.');}else{console.log('ℹ️ No accessible cookies found to restore.');}`.trim();\n\n        const restoreScript = `/**\\n * Restore localStorage and accessible cookies\\n * Generated: ${new Date().toISOString()}\\n */\\n(function(){'use strict';${storageSnippet}${cookieSnippet}})();`.trim();\n\n        const textarea = document.createElement('textarea');\n        textarea.value = restoreScript;\n        textarea.style.position = 'absolute';\n        textarea.style.left = '-9999px';\n        textarea.style.top = '0';\n        document.body.appendChild(textarea);\n        textarea.select();\n        document.execCommand('copy');\n        document.body.removeChild(textarea);\n\n        alert('LocalStorage and accessible cookie restore script copied to clipboard!');\n    } catch (error) {\n        alert('Failed to copy data. See console for details.');\n        console.error('Bookmarklet Error:', error);\n    }\n})();"
            },
            {
                "id": "find_youtube_video",
                "name": "Search for YouTube video in archives with YouTube Video Finder",
                "label": "YT Video Finder",
                "description": "Searches for the current YouTube video in archives via YouTube Video Finder.",
                "match": [
                    "*://*.youtube.com/*"
                ],
                "folder": "YouTube",
                "code": "(function findYouTubeVideo() {\n    if (location.hostname.includes('youtube.com')) {\n        window.open(`https://findyoutubevideo.thetechrobo.ca/noscript_load.html?d=${encodeURIComponent(location.href)}`);\n    }\n})();"
            },
            {
                "id": "lookup_url",
                "name": "Lookup current page URL in MusicBrainz",
                "label": "MB URL Lookup",
                "description": "Looks up the current page URL in MusicBrainz via otherlookup/url.",
                "match": [
                    "*://*/*"
                ],
                "folder": "Navigation",
                "code": "(function lookupUrlInMusicBrainz() {\n    window.open(`https://musicbrainz.org/otherlookup/url?other-lookup.url=${encodeURIComponent(location.href)}`);\n})();"
            },
            {
                "id": "met_seeder",
                "name": "Open current page in MET - MusicBrainz Metadata Seeder",
                "label": "Open in MET",
                "description": "Opens the current page URL in MET (MusicBrainz Metadata Seeder).",
                "match": [
                    "*://*/*"
                ],
                "folder": "Seeding",
                "code": "(function openInMetSeeder() {\n    window.open(`https://seed.musichoarders.xyz?identifier=${encodeURIComponent(location.href)}`);\n})();"
            },
            {
                "id": "multi_tool",
                "name": "Multi-tool",
                "label": "Multi-Tool",
                "description": "Advances release editor tabs, triggers Guess Case, submits edits, handles Mass Merge Recordings, confirms seeding forms, imports/updates releases in Harmony, runs Falcon on MusicBrainz, and reloads MagicISRC or Harmony on rate limit or server busy errors.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*",
                    "*://harmony.pulsewidth.org.uk/*",
                    "*://harmony.mybrainz.dev/*",
                    "*://magicisrc.kepstin.ca/*"
                ],
                "folder": "Edit",
                "code": "(function multiTool() {\n    const errorMessages = [\n        'rate limit',\n        'Failed to fetch resource at',\n        'Too many requests queued',\n        'currently busy'\n    ];\n\n    const hasRateLimitError = (location.hostname.includes('magicisrc') && document.querySelector('#container h1')?.innerText.includes('error')) ||\n        ((location.hostname.includes('harmony.pulsewidth.org.uk') || location.hostname.includes('harmony.mybrainz.dev')) &&\n            Array.from(document.querySelectorAll('.message p')).some((p) => errorMessages.some((err) => p.textContent?.includes(err))));\n\n    if (hasRateLimitError) {\n        location.reload();\n        return;\n    }\n\n    if (location.hostname.includes('musicbrainz.org') && location.search.includes('falcon=') && document.querySelector('#falcon-run')) {\n        document.querySelector('#falcon-run').click();\n        return;\n    }\n\n    if (location.href.includes('musicbrainz.org/release') && typeof MB !== 'undefined' && MB?._releaseEditor) {\n        const releaseEditor = MB._releaseEditor;\n\n        switch (releaseEditor.activeTabID()) {\n            case '#tracklist': {\n                if (document.querySelectorAll('.capitalized-eti, .miscapitalized-titles').length !== 0) {\n                    document.querySelector('#guess-case-button')?.click();\n                } else {\n                    const isReuseRecordingsDialogOpen = document.querySelector('[data-click=\"reuseUnsetPreviousRecordings\"]');\n                    if (isReuseRecordingsDialogOpen) {\n                        releaseEditor.nextTab();\n                    } else {\n                        const allEdits = releaseEditor.allEdits();\n                        const hasTrackEdits = allEdits.some((e) => [51, 52, 53].includes(e.edit_type));\n                        if (hasTrackEdits) {\n                            releaseEditor.nextTab();\n                        } else {\n                            releaseEditor.lastTab();\n                        }\n                    }\n                }\n                break;\n            }\n            case '#edit-note':\n                releaseEditor.submitEdits();\n                break;\n            default:\n                releaseEditor.nextTab();\n                break;\n        }\n        return;\n    }\n\n    if (document.getElementsByClassName('MMR2099userjs120382').length !== 0) {\n        document.querySelector('[ref=\"Merge all found recordings\"]')?.click();\n        return;\n    }\n\n    if (location.hostname.includes('harmony.pulsewidth.org.uk') || location.hostname.includes('harmony.mybrainz.dev')) {\n        (document.querySelector('[value=\"Update external links in MusicBrainz\"]') ||\n            document.querySelector('[value=\"Import into MusicBrainz\"]') ||\n            document.querySelector('#falcon-harmony-btn'))?.click();\n        return;\n    }\n\n    if (!document.querySelector('h1 .mp [href^=\"/url/\"]')) {\n        document.querySelectorAll(\n            '#enter-edit, #edit-submit, button.submit, #submit-button, #submitAliases, ' +\n            '#batch_video, #check-isrcs button[type=button], #index-mbid-submit, ' +\n            '.confirm-seed button[type=\"submit\"]'\n        )[0]?.click();\n    }\n})();"
            },
            {
                "id": "open_in_harmony",
                "name": "Open current page in Harmony",
                "label": "Harmony",
                "description": "Detects the release URL on the current page and opens it in Harmony.",
                "match": [
                    "*://*.spotify.com/*",
                    "*://*.deezer.com/*",
                    "*://*.tidal.com/*",
                    "*://*.bandcamp.com/*",
                    "*://soundcloud.com/*",
                    "*://*.soundcloud.com/*",
                    "*://*.volumo.com/*",
                    "*://*.discogs.com/*",
                    "*://music.apple.com/*",
                    "*://*.music.apple.com/*",
                    "*://*.qobuz.com/*",
                    "*://vibe.naver.com/*",
                    "*://*.beatport.com/*",
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Harmony",
                "code": "(function openInHarmony(newTab = false) {\n    const selectors = [\n        { s: 'meta[property=\"music:album\"]', p: 'content' },\n        { s: 'meta[property=\"music:album:url\"]', p: 'content' },\n        { s: 'meta[name=\"music:album\"]', p: 'content' },\n        { s: 'meta[property=\"og:url\"]', t: 'meta[property=\"og:type\"][content=\"music.album\"]', p: 'content' },\n        { s: '[data-testid=\"entityTitle\"]~div a[href^=\"/album/\"]', p: 'href' },\n        { s: '[data-testid=\"track-page\"]>div:first-child a[href^=\"/album/\"]', p: 'href' }\n    ];\n\n    const targetUrl = selectors.reduce((acc, item) => {\n        if (acc) return acc;\n        const el = document.querySelector(item.s);\n        return (el && (!item.t || document.querySelector(item.t))) ? el[item.p] : null;\n    }, null) || location.href;\n\n    const harmonyUrl = new URL('https://harmony.pulsewidth.org.uk/release');\n    harmonyUrl.searchParams.set('url', targetUrl);\n    harmonyUrl.searchParams.set('category', 'preferred');\n\n    if (newTab) {\n        window.open(harmonyUrl.toString(), '_blank');\n    } else {\n        location.href = harmonyUrl.toString();\n    }\n})(false);"
            },
            {
                "id": "open_in_harmony_new_tab",
                "name": "Open current page in Harmony (new tab)",
                "label": "Harmony ↗",
                "description": "Detects the release URL on the current page and opens it in Harmony (opens in a new tab).",
                "match": [
                    "*://*.spotify.com/*",
                    "*://*.deezer.com/*",
                    "*://*.tidal.com/*",
                    "*://*.bandcamp.com/*",
                    "*://soundcloud.com/*",
                    "*://*.soundcloud.com/*",
                    "*://*.volumo.com/*",
                    "*://*.discogs.com/*",
                    "*://music.apple.com/*",
                    "*://*.music.apple.com/*",
                    "*://*.qobuz.com/*",
                    "*://vibe.naver.com/*",
                    "*://*.beatport.com/*",
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Harmony",
                "code": "(function openInHarmony(newTab = false) {\n    const selectors = [\n        { s: 'meta[property=\"music:album\"]', p: 'content' },\n        { s: 'meta[property=\"music:album:url\"]', p: 'content' },\n        { s: 'meta[name=\"music:album\"]', p: 'content' },\n        { s: 'meta[property=\"og:url\"]', t: 'meta[property=\"og:type\"][content=\"music.album\"]', p: 'content' },\n        { s: '[data-testid=\"entityTitle\"]~div a[href^=\"/album/\"]', p: 'href' },\n        { s: '[data-testid=\"track-page\"]>div:first-child a[href^=\"/album/\"]', p: 'href' }\n    ];\n\n    const targetUrl = selectors.reduce((acc, item) => {\n        if (acc) return acc;\n        const el = document.querySelector(item.s);\n        return (el && (!item.t || document.querySelector(item.t))) ? el[item.p] : null;\n    }, null) || location.href;\n\n    const harmonyUrl = new URL('https://harmony.pulsewidth.org.uk/release');\n    harmonyUrl.searchParams.set('url', targetUrl);\n    harmonyUrl.searchParams.set('category', 'preferred');\n\n    if (newTab) {\n        window.open(harmonyUrl.toString(), '_blank');\n    } else {\n        location.href = harmonyUrl.toString();\n    }\n})(true);"
            },
            {
                "id": "qobuz_api",
                "name": "Show API data for Qobuz album",
                "label": "Qobuz API",
                "description": "Opens the Qobuz JSON API endpoint for the currently viewed Qobuz album.",
                "match": [
                    "*://*.qobuz.com/*"
                ],
                "folder": "Streaming",
                "code": "(function showQobuzApiData() {\n    const match = window.location.href.match(/\\/([0-9a-z]+)$/)?.slice(1);\n    if (match) {\n        window.open(`https://www.qobuz.com/api.json/0.2/album/get?album_id=${match[0]}&app_id=712109809`);\n    }\n})();"
            },
            {
                "id": "sambl_artist",
                "name": "Open current artist page in SAMBL",
                "label": "SAMBL Artist",
                "description": "Opens the currently viewed streaming artist page in SAMBL.",
                "match": [
                    "*://*.spotify.com/*",
                    "*://*.deezer.com/*",
                    "*://*.tidal.com/*",
                    "*://*.bandcamp.com/*",
                    "*://soundcloud.com/*",
                    "*://*.soundcloud.com/*",
                    "*://*.volumo.com/*",
                    "*://*.discogs.com/*",
                    "*://music.apple.com/*",
                    "*://*.music.apple.com/*",
                    "*://*.qobuz.com/*",
                    "*://vibe.naver.com/*"
                ],
                "folder": "SAMBL",
                "code": "(function openInSambl(newTab = false) {\n    const providers = {\n        spotify: /spotify\\.com\\/artist\\/(?:intl-[a-z]+\\/)?(?<id>\\w+)/,\n        deezer: /deezer\\.com\\/.*artist\\/(?<id>\\d+)/,\n        tidal: /tidal\\.com\\/.*artist\\/(?<id>\\d+)/,\n        bandcamp: /:\\/\\/(?<id>[^.]+)\\.bandcamp\\.com/,\n        soundcloud: /(?<id>^https?:\\/\\/soundcloud\\.com\\/[^/?#]+)/,\n        volumo: /volumo\\.com\\/(?:\\w+\\/)?artist\\/(?<id>\\d+)/,\n        discogs: /discogs\\.com\\/artist\\/(?<id>\\d+)/,\n        applemusic: /music\\.apple\\.com\\/.+?\\/artist\\/(?:.+?\\/)?(?<id>\\d+)/,\n        qobuz: /qobuz\\.com\\/(?:\\w{2}-\\w{2}\\/)?(?:interpreter|artist)\\/(?:[^/]+\\/)*?(?<id>[A-Za-z0-9]+)\\/?(?:[?#]|$)/,\n        naver: /vibe\\.naver\\.com\\/artist\\/(?<id>\\d+)/\n    };\n\n    for (const [provider, regex] of Object.entries(providers)) {\n        const match = location.href.match(regex);\n        if (match) {\n            const targetUrl = `https://sambl.lioncat6.com/newartist?provider=${provider}&provider_id=${encodeURIComponent(match.groups.id)}`;\n            if (newTab) {\n                window.open(targetUrl);\n            } else {\n                location.href = targetUrl;\n            }\n            break;\n        }\n    }\n})(false);"
            },
            {
                "id": "sambl_artist_new_tab",
                "name": "Open current artist page in SAMBL (new tab)",
                "label": "SAMBL Artist ↗",
                "description": "Opens the currently viewed streaming artist page in SAMBL (opens in a new tab).",
                "match": [
                    "*://*.spotify.com/*",
                    "*://*.deezer.com/*",
                    "*://*.tidal.com/*",
                    "*://*.bandcamp.com/*",
                    "*://soundcloud.com/*",
                    "*://*.soundcloud.com/*",
                    "*://*.volumo.com/*",
                    "*://*.discogs.com/*",
                    "*://music.apple.com/*",
                    "*://*.music.apple.com/*",
                    "*://*.qobuz.com/*",
                    "*://vibe.naver.com/*"
                ],
                "folder": "SAMBL",
                "code": "(function openInSambl(newTab = false) {\n    const providers = {\n        spotify: /spotify\\.com\\/artist\\/(?:intl-[a-z]+\\/)?(?<id>\\w+)/,\n        deezer: /deezer\\.com\\/.*artist\\/(?<id>\\d+)/,\n        tidal: /tidal\\.com\\/.*artist\\/(?<id>\\d+)/,\n        bandcamp: /:\\/\\/(?<id>[^.]+)\\.bandcamp\\.com/,\n        soundcloud: /(?<id>^https?:\\/\\/soundcloud\\.com\\/[^/?#]+)/,\n        volumo: /volumo\\.com\\/(?:\\w+\\/)?artist\\/(?<id>\\d+)/,\n        discogs: /discogs\\.com\\/artist\\/(?<id>\\d+)/,\n        applemusic: /music\\.apple\\.com\\/.+?\\/artist\\/(?:.+?\\/)?(?<id>\\d+)/,\n        qobuz: /qobuz\\.com\\/(?:\\w{2}-\\w{2}\\/)?(?:interpreter|artist)\\/(?:[^/]+\\/)*?(?<id>[A-Za-z0-9]+)\\/?(?:[?#]|$)/,\n        naver: /vibe\\.naver\\.com\\/artist\\/(?<id>\\d+)/\n    };\n\n    for (const [provider, regex] of Object.entries(providers)) {\n        const match = location.href.match(regex);\n        if (match) {\n            const targetUrl = `https://sambl.lioncat6.com/newartist?provider=${provider}&provider_id=${encodeURIComponent(match.groups.id)}`;\n            if (newTab) {\n                window.open(targetUrl);\n            } else {\n                location.href = targetUrl;\n            }\n            break;\n        }\n    }\n})(true);"
            },
            {
                "id": "search_recordings",
                "name": "Search for recordings of current release, release group, or artist",
                "label": "Search Recordings",
                "description": "Opens an advanced MusicBrainz recording search for the current release, release group, or artist.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Navigation",
                "code": "(function searchRecordings() {\n    const match = location.pathname.match(/\\/(release|release-group|artist)\\/([a-f0-9-]{36})/);\n    if (match) {\n        const paramMap = {\n            'release': 'reid',\n            'release-group': 'rgid',\n            'artist': 'arid'\n        };\n        window.open(`${location.origin}/search?query=${paramMap[match[1]]}:${match[2]}&type=recording&limit=100&method=advanced`);\n    }\n})();"
            },
            {
                "id": "search_releases",
                "name": "Search for releases of current artist or label",
                "label": "Search Releases",
                "description": "Opens an advanced MusicBrainz release search for the current artist or label.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Navigation",
                "code": "(function searchReleases() {\n    const match = location.pathname.match(/\\/(artist|label)\\/([a-f0-9-]{36})/);\n    if (match) {\n        const queryParam = match[1] === 'artist' ? 'arid' : 'laid';\n        window.open(`${location.origin}/search?query=${queryParam}:${match[2]}&type=release&limit=100&method=advanced`);\n    }\n})();"
            },
            {
                "id": "submit_edit_votable",
                "name": "Submit edit votable",
                "label": "Submit Votable",
                "description": "Marks the current edit as votable and submits the MusicBrainz edit form.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Edit",
                "code": "(function submitEditVotable() {\n    document.querySelector('.make-votable, [name*=\"make_votable\"]')?.click();\n    document.querySelector('#enter-edit, button.submit, #submitAliases')?.click();\n})();"
            },
            {
                "id": "toggle_links_for_removal",
                "name": "Toggle links for removal",
                "label": "Remove Links",
                "description": "Clicks all external link removal buttons on the current MusicBrainz edit form.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Edit",
                "code": "(function toggleLinksForRemoval() {\n    document.querySelectorAll('[title=\"Remove link\"]').forEach((el) => {\n        el.click();\n    });\n})();"
            },
            {
                "id": "toggle_relationships_for_removal",
                "name": "Toggle relationships for removal",
                "label": "Remove Rels",
                "description": "Clicks all relationship removal buttons on the current MusicBrainz edit form.",
                "match": [
                    "*://*.musicbrainz.org/*",
                    "*://*.musicbrainz.eu/*"
                ],
                "folder": "Edit",
                "code": "(function toggleRelationshipsForRemoval() {\n    document.querySelectorAll('.relationship-list .remove-item').forEach((el) => {\n        el.click();\n    });\n})();"
            },
            {
                "id": "youtube_metadata",
                "name": "Open YouTube page in MW Metadata",
                "label": "YT Metadata",
                "description": "Opens the current YouTube page in MW YouTube Metadata.",
                "match": [
                    "*://*.youtube.com/*"
                ],
                "folder": "YouTube",
                "code": "(function openYouTubeMetadata() {\n    if (location.hostname.includes('youtube.com')) {\n        window.open(`https://mattw.io/youtube-metadata/?url=${encodeURIComponent(location.href)}&submit=true`);\n    }\n})();"
            }
        ]
    }
];

try {
    if (typeof module === 'object' && module && module.exports) {
        module.exports = BUNDLED_BOOKMARKLET_PACKS;
    }
} catch {}
