# Userscripts

## Bandcamp: Show more dates

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Bandcamp%20Show%20more%20dates.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Bandcamp%20Show%20more%20dates.user.js)

Displays additional date attributes for Bandcamp releases, such as `publish_date`, `mod_date`, and `release_date`. These are extracted from the page's hidden JSON data.

For more info and discusson about these dates see the MusicBrainz forum thread:

https://community.metabrainz.org/t/question-about-bandcamp-publish-dates/667997

This script is based on the [Bandcamp: Show publish date](https://greasyfork.org/scripts/420662) userscript by @w-biggs

### Features
- **Detailed Dates:** Specific dates for when a release was published, modified, or created.
- **Source Transparency:** Shows where each date comes from (e.g., "release date" vs "publish date").
- **Smart Sorting:** Automatically sorts and displays the dates chronologically.

## Beatport: MusicBrainz Importer

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Beatport%20MusicBrainz%20Importer.user.js)

Enhances Beatport with MusicBrainz integration for easier importing of missing releases.

Based on the original Beatport status and import scripts by [RustyNova](https://github.com/RustyNova016/MusicBrainz-UserScripts/).

### Features
- **Status Icons:** Adds icons to releases indicating if they are already on MusicBrainz or need importing via Harmony.
- **Quick Links:** Provides "Open in MusicBrainz" or "Search in MusicBrainz" buttons on release pages.
- **Harmony Integration:** One-click import for missing releases using Harmony.

## CheckBoxMate Modernized

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/CheckBoxMate%20Modernized.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/CheckBoxMate%20Modernized.user.js)

Allows selecting multiple checkboxes by drawing a selection box around them.

### Features
- **Drag Selection:** Click and drag to draw a box and toggle all checkboxes inside it.
- **Visual Feedback:** Shows a semi-transparent selection rectangle.
- **Modernized Code:** Updated code of the original CheckBoxMate Greasemonkey script by scottmweaver.

## Click buttons across tabs

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Click%20buttons%20across%20tabs.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Click%20buttons%20across%20tabs.user.js)

Synchronizes button clicks and form submissions across multiple open tabs.

This will make it easier to submit edits and ISRCs to MusicBrainz from supported sites (MagicISRC and ISRC Hunt) from multiple tabs at once.
It can also automatically close the tab after submitting a merge edit (when it was opened in a new tab).

You can use it either from the script's context menu or via bookmarklets.

MusicBrainz: Submit Edit (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('mb_edit_channel').postMessage('submit-edit'); })();`

MagicISRC: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('magicisrc_submit_channel').postMessage('submit-isrcs'); })();`

ISRC Hunt: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('isrc_hunt_submit_channel').postMessage('submit-isrcs'); })();`

### Features
- **Cross-Tab Sync:** Will click the same button in all open tabs to trigger the same action in other tabs.
- **Rate Limiting:** Has a configurable rate limit to prevent errors during bulk submissions.
- **Auto-Close:** Can automatically close tabs after a successful submission.

## Deezer: MusicBrainz importer

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Deezer%20MusicBrainz%20importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Deezer%20MusicBrainz%20importer.user.js)

Helper userscript for MusicBrainz editors to simplify data import from Deezer. It provides quick access to external tools for data import and editing.

### Features
- **Release Seeding**: Allows importing releases with [Harmony](http://harmony.pulsewidth.org.uk/) and search for existing artists, releases, or recordings on MusicBrainz.
- **SAMBL**: Provides quick access to [SAMBL](https://github.com/Lioncat6/SAMBL-React), which can fetch an artist's entire Deezer discography and compare it against MusicBrainz. This allows editors to quickly identify missing release or incomplete entries.
- **ISRC Hunt**: Provides quick access to [ISRC Hunt](https://isrchunt.com/) to find and import track-level ISRCs.
- **ListenBrainz**: Provides quick access to [ListenBrainz](https://listenbrainz.org/), an open-source alternative to Last.fm built entirely on top of MusicBrainz data.

## Discourse: Disable Touch Detection

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Discourse%20Disable%20Touch%20Detection.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Discourse%20Disable%20Touch%20Detection.user.js)

Prevents Discourse from hiding editor toolbar functions on touch-capable devices.
It works by spoofing the browser APIs that Discourse uses for touch detection, ensuring the full desktop toolbar is always visible. The script is designed to be robust, supporting both recent and old versions of Discourse.

By default, this script only runs on the [MetaBrainz Community Discourse](https://community.metabrainz.org/). To use it on other forums, you can add more `@match` directives in the script's settings.

### Features
- **Spoofing:** Spoofs browser APIs to report a mouse-based interface.
- **Toolbar:** Ensures the desktop version of the editor toolbar is shown.

**Before:**

[📷 View Before](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTg2NzE1LCJwdXIiOiJibG9iX2lkIn19--1f30dc15e4d8a31ebde67eafa83390a30a855ea3/Screenshot%202025-08-25%2018.06.05.png)

**After:**

[📷 View After](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTg2NzE0LCJwdXIiOiJibG9iX2lkIn19--d769e44c4fa0dbc674c3390dd59e24d4f108e50e/Screenshot%202025-08-25%2018.06.09.png)


See also:
- [Why so many options in the gear editor menu? - UX - Discourse Meta](https://meta.discourse.org/t/why-so-many-options-in-the-gear-editor-menu/239497).

## DOM Mutation Observer Debugger

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/DOM%20Mutation%20Observer%20Debugger.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/DOM%20Mutation%20Observer%20Debugger.user.js)

A developer tool that logs all DOM changes to the console.

### Features
- **Live Logging:** Real-time console logs for element additions, removals, and attribute changes.
- **Detailed Info:** Shows exactly what changed, including old and new values.

## Harmony: Domain Redirector

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Harmony%20Domain%20Redirector.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Harmony%20Domain%20Redirector.user.js)

Redirects the user from the official Harmony instance (`harmony.pulsewidth.org.uk`) to the alternative mybrainz instance (`harmony.mybrainz.dev`) while preserving the URL path and query parameters.

## Harmony: Enhancements

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Harmony%20Enhancements.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Harmony%20Enhancements.user.js)

A comprehensive userscript for **[Harmony](http://harmony.pulsewidth.org.uk/)** that adds quality-of-life features, data correction tools, and advanced language detection to streamline your import workflow.

### Features

#### Release Data Correction & Automation
- **Improved Release Type Detection:** Automatically corrects the release type to **"Single"** or **"EP"** based on track title analysis, useful for releases that contain multiple versions of a single song.
- **Artist Credit Sync:** For single-track releases, automatically syncs the more detailed **track artist credit** up to the main **release artist**.
- **Normalize ETI:** Converts hyphenated Extra Title Information (ETI) on titles (e.g., `Title - Remix` to `Title (Remix)`) to match MusicBrainz style guidelines.
- **Self-Release Labeling:** Automatically sets the label to the special purpose label `[no label]` for self-releases where the artist name matches the label name.
- **Label MBID Mapping:** Automatically sets a known Label MBID based on a user-defined list if Harmony cannot resolve it.
- **Remixer Removal:** Detects remix information in track titles (e.g., `(Artist Remix)`) and automatically removes the credited remixer from the track artist field.
- **Catalog Number Cleanup:** Automatically removes catalog numbers that are identical to the release barcode (GTIN).

#### Language Detection
- **Enhanced Language/Script Guessing:** Implements a secondary **browser-based language detection** system which can be more accurate than Harmony's default.
- **Customizable Settings:** Offers a dedicated settings panel to control detection mode (browser, Harmony, or none) and fine-tune **confidence thresholds** for applying changes.

#### Seeder Behavior
- **Include GTIN and Packaging on Update**: Adds an option to include GTIN (barcode) and set packaging when updating existing releases.
- **Drop Artist Names as credited from Seed:** When an MBID is available, this option removes the artist's name from the seed data.
- **MusicBrainz Server Selection:** Allows choosing between the main server (**musicbrainz.org**), the beta server, or the mirror (**musicbrainz.eu**) for all links and seeding actions.

#### UI & Workflow
- **Clipboard Re-Lookup:** Adds a **"Re-Lookup from Clipboard"** button to the lookup form for quickly starting a new lookup or extending an existing one using a supported source URL found in your clipboard.
- **Provider Re-Lookup Buttons:** Adds a small **⟳** button next to each secondary provider URL in the "Providers" section, allowing you to quickly redo the lookup using that provider as the primary source.
- **External Search Links:** Adds quick search links for yet unsupported providers (Qobuz, YouTube Music, Beatsource, etc.).
- **Minor Tweaks:** Enables **copying the permalink URL** on click and provides options to **hide verbose/redundant info sections** for a cleaner UI.

## ISBN Barcode Generator

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISBN%20Barcode%20Generator.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISBN%20Barcode%20Generator.user.js)

Generates and embeds scanable barcodes for ISBNs found on various German book retailer sites.

### Features
- **Auto-Detection:** Automatically spots ISBN-10 and ISBN-13 codes within the page text.
- **Live Generation:** Creates scannable barcode images on the fly.
- **Toggleable:** Includes a menu command to enable/disable the barcode embedding.

## ISRC Hunt: Hide a-tisket links, normalize link style

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Hide%20a-tisket%20links,%20normalize%20link%20style.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISRC%20Hunt%20Hide%20a-tisket%20links,%20normalize%20link%20style.user.js)

Cleans up the ISRC Hunt interface by hiding a-tisket links and normalizing styles.

### Features
- **Filter:** Hides "a-tisket" links to reduce clutter.
- **Style Reset:** Resets link styles to default for better consistency.

## ISRC Hunt: Highlight ISRC matches and differences

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Highlight%20ISRC%20matches%20and%20differences.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISRC%20Hunt%20Highlight%20ISRC%20matches%20and%20differences.user.js)

Visually compares ISRC codes between sources (e.g., Spotify vs. MusicBrainz) in the ISRC Hunt interface.

### Features
- **Visual Diff:** Highlights matching ISRCs in green and non-matching ones in red.
- **Multi-ISRC Support:** Handles and compares cells containing multiple comma-separated ISRCs.

## ISRC Hunt: Rewrite Harmony URLs

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Rewrite%20Harmony%20URLs.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISRC%20Hunt%20Rewrite%20Harmony%20URLs.user.js)

Optimizes Harmony links on ISRC Hunt to default to the "preferred" category.

### Features
- **Link Rewriting:** Automatically updates Harmony URLs to prioritize the preferred category.

## ListenBrainz: Extended Controls

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ListenBrainz%20Extended%20Controls.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ListenBrainz%20Extended%20Controls.user.js)

Adds customization options and extra features to ListenBrainz listen cards.

### Features
- **Custom Actions:** Choose which buttons (Love, Hate, Open in Service) appear on the card.
- **Quick Access:** Moves "Open in Service" (e.g. Spotify) links directly to the main controls.
- **Source Info:** Displays which player or service submitted the listen.
- **Modal Dialog:** Automatically copies the text in the link listen dialog into the search field.

## MusicBrainz: Add search link for barcode

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Add%20search%20link%20for%20barcode.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Add%20search%20link%20for%20barcode.user.js)

Checks for duplicate releases based on barcode when viewing "Add Release" edits.

### Features
- **Automatic Check:** Scans edits for barcodes and checks for existing releases.
- **Duplicate Warning:** Highlights barcodes in **yellow** if they already exist on other releases.
- **Quick Search:** Adds a direct link to search MusicBrainz for the barcode.

## MusicBrainz: Add Spotify & SoundExchange search buttons on ISRC page

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Add%20Spotify%20&%20SoundExchange%20search%20buttons%20on%20ISRC%20page.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Add%20Spotify%20&%20SoundExchange%20search%20buttons%20on%20ISRC%20page.user.js)

Adds search buttons for Spotify and SoundExchange to the ISRC view page header.

### Features
- **Direct Integration:** Injects "Search on Spotify" and "Search on SoundExchange" buttons directly next to the ISRC header.
- **Context-Aware:** Uses the current ISRC code to construct precise search URLs.

## MusicBrainz: Add Spotify and Deezer ISRC link to release pages

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Add%20Spotify%20and%20Deezer%20ISRC%20link%20to%20release%20pages.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Add%20Spotify%20and%20Deezer%20ISRC%20link%20to%20release%20pages.user.js)

Adds direct "import ISRCs" links to Spotify and Deezer relationships on release pages.

### Features
- **Smart Integration:** Finds existing Spotify and Deezer links in the sidebar.
- **One-Click Import:** Adds a [...] link that takes you directly to the ISRC Hunt import page for that release.

## MusicBrainz: Ajax Collection Links

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Ajax%20Collection%20Links.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Ajax%20Collection%20Links.user.js)

Makes "Add to Collection" and "Remove from Collection" actions in the sidebar instant without reloading the page.

**Note:** Works with English UI only.

### Features
- **Instant Toggle:** Adds or removes entities from your collection immediately.
- **Visual Feedback:** Updates the link text and the sidebar collection counter dynamically.

## MusicBrainz: Align Columns in Merge Edits

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Align%20Columns%20in%20Merge%20Edits.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Align%20Columns%20in%20Merge%20Edits.user.js)

Aligns columns in 'Merge' edit tables for easier side-by-side comparison.

### Features
- **Smart Alignment:** Dynamically calculates and applies column widths based on content.
- **Clean Interface:** Options to Collapse Empty Columns to hide irrelevant data.
- **Layout Control:** Option to Widen Table Container for better use of screen space.
- **Reactive:** Automatically adjusts when table content changes (e.g., via other scripts).

## MusicBrainz: Artwork Uploader Turbo

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Artwork%20Uploader%20Turbo.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Artwork%20Uploader%20Turbo.user.js)

Supercharges the MusicBrainz artwork uploader with batch processing and reliability features.

### Features
- **Multi-Upload:** Upload multiple images simultaneously. (Fixes[MBS-12374](https://tickets.metabrainz.org/browse/MBS-12374))
- **Directory Support:** Drag and drop entire folders to upload all images within. (Fixes [MBS-12452](https://tickets.metabrainz.org/browse/MBS-12452))
- **Resiliency:** Automatically retries failed uploads and handles rate limits.
- **Status Dashboard:** Shows a detailed list of all file statuses and errors.

## MusicBrainz: Auto click confirm form submission

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Auto%20click%20confirm%20form%20submission.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Auto%20click%20confirm%20form%20submission.user.js)

Automatically clicks the button to confirm submitting (seeding) data from other sites

### Features
- **Auto-Confirm:** Clicks the submit button on the confirmation page automatically.
- **Time Saver:** Skips a manual step when adding releases or recordings via external tools or scripts from other sites.

## MusicBrainz: Auto login MusicBrainz ISRC importers

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js)

Simplifies the login process for ISRC submission sites like MagicISRC and ISRC Hunt.

### Features
- **Auto-Confirm:** Automatically clicks "Allow Access" on MusicBrainz OAuth pages for trusted importers.
- **Auto-Login:** Detects login forms on supported sites and initiates the sign-in process automatically.
- **Security:** Validates client IDs and scopes before taking action to ensure safety.

## MusicBrainz: Automatically show AcoustIDs

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Automatically%20show%20AcoustIDs.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Automatically%20show%20AcoustIDs.user.js)

Automatically reveals AcoustIDs on Artist Recording pages.

Requires the [Display acoustIDs and merge recordings with common acoustID userscript](https://github.com/loujine/musicbrainz-scripts/?tab=readme-ov-file#musicbrainz-edit-display-acoustids-and-merge-recordings-with-common-acoustid) to be installed.

### Features
- **Auto-Click:** Triggers the "Show acoustIDs" button immediately upon page load.

## MusicBrainz: Batch Remove Cover Art

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Batch%20Remove%20Cover%20Art.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Batch%20Remove%20Cover%20Art.user.js)

Enables removing multiple cover art images from a release at once.

### Features
- **Bulk Selection:** Adds checkboxes to each cover art image and a "Select All" option.
- **Elephant Editor:** Features an edit note memory (based on and compatible with [Elephant Editor](https://github.com/jesus2099/konami-command/blob/master/mb_ELEPHANT-EDITOR.user.js)) that remembers previous edit notes and offers quick-insert buttons.
- **Progress Tracking:** Shows a real-time progress bar and specific status messages for each image removal.

## MusicBrainz: Compare AcoustIDs easier!

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Compare%20AcoustIDs%20easier!.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Compare%20AcoustIDs%20easier!.user.js)

Enhances AcoustID visibility and comparison across MusicBrainz.

Modernized and refactored version of the original script which can be found at https://github.com/otringal/MB-userscripts/blob/master/Musicbrainz_acoustid.user.js

### Features
- **Expanded Comparison:** Adds AcoustID columns to recording merge edits.
- **Visual Comparison:** Color-codes identical AcoustIDs to make duplicates easily recognizable.
- **Quick Links:** Add direct links to AcoustID.org for analysis.

## MusicBrainz: Editor Subscription Manager

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Editor%20Subscription%20Manager.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Editor%20Subscription%20Manager.user.js)

A dashboard for managing your editor subscriptions.

### Features
- **Comprehensive List:** View all your subscriptions in a sortable, filterable table.
- **Editor Stats:** See key metrics like edit count, rejection rate, and last active date for each subscribed editor.
- **Bulk Actions:** Unsubscribe from multiple inactive or unwanted editors with a single click.

## MusicBrainz: Guess Case Improver

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Guess%20Case%20Improver.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Guess%20Case%20Improver.user.js)

Improves the native "Guess Case" functionality with smarter rules.

### Features
- **Artist Deduplication:** Automatically removes duplicate artists when using "Guess feat. artists".
- **Smart ETI Handling:** correctly cases Extra Title Information words like "Official Video", "Lyric Video", "Sped Up", etc.
- **Preserves Intent:** Respects existing uppercase acronyms when configured.

## MusicBrainz: Guess release language and script

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Guess%20release%20language%20and%20script.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Guess%20release%20language%20and%20script.user.js)

Automatically detects and sets the Release Language and Script based on track titles.

This is a modified version of the original script by ROpdebee at https://github.com/ROpdebee/mb-userscripts/pull/502

Instead of LibreTranslate it uses the the [language detector API](https://developer.mozilla.org/en-US/docs/Web/API/Translator_and_Language_Detector_APIs)

### Features
- **One-Click Guessing:** Adds a button to the Release Editor to analyze the tracklist.
- **Language Detection:** Uses an AI model internal to the browser to detect the language of the tracklist.
- **Auto-Fill:** Automatically selects the correct values in the Language and Script dropdown menus.

## MusicBrainz: Highlight identical barcodes and toggle merge checkboxes

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Highlight%20identical%20barcodes%20and%20toggle%20merge%20checkboxes.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Highlight%20identical%20barcodes%20and%20toggle%20merge%20checkboxes.user.js)

Simplifies merging duplicate releases by visually grouping them based on barcode.

### Features
- **Visual Grouping:** Highlights identical barcodes with matching colors for easy spotting.
- **Click-to-Select:** Click any highlighted barcode to instantly check/uncheck all releases with that barcode for merging.

## MusicBrainz: Hotkeys for selected entities

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Hotkeys%20for%20selected%20entities.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Hotkeys%20for%20selected%20entities.user.js)

Adds keyboard shortcuts for common actions on list pages (Release groups, Releases, Recordings, etc.).

### Features
- **Quick Actions:** Press keys to perform actions on selected items:
    - <kbd>A</kbd>: Artwork
    - <kbd>D</kbd>: Delete
    - <kbd>E</kbd>: Edit
    - <kbd>W</kbd>: Merge
    - <kbd>Q</kbd>: Aliases
    - <kbd>R</kbd>: Relationship Editor
- **Batch Compatible:** Opens actions for multiple selected entities in new tabs (staggered to prevent rate limits).

## MusicBrainz: Import from Discogs CSV

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Import%20from%20Discogs%20CSV.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Import%20from%20Discogs%20CSV.user.js)

Import your Discogs collection directly into a MusicBrainz collection.

### Features
- **CSV Support:** Reads standard Discogs export files.
- **Smart Matching:** Looks up releases by Discogs ID to ensure accurate linking.
- **Bulk Import:** Adds found releases to your MusicBrainz collection automatically.

### How to use:

1. Make a new release collection
1. Upload your CSV

[📷 View Screenshot](https://community.metabrainz.org/uploads/default/original/3X/d/3/d32d6965a2c57564bac560c8550a8089d14491f5.png)

## MusicBrainz: Mass Merge Recordings from Edit

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Mass%20Merge%20Recordings%20from%20Edit.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Mass%20Merge%20Recordings%20from%20Edit.user.js)

Allows merging recordings directly from **"Edit medium"** edits.

Based on the original [Mass Merge Recordings](https://github.com/jesus2099/konami-command/blob/master/mb_MASS-MERGE-RECORDINGS.user.js) script by @jesus2099

### Features
- **In-place Merging:** Adds "Merge" buttons next to changed recordings on edit medium edits.
- **Batch Processing:** Merge recording pairs sequentially with a single click.
- **Progress Tracking:** Shows a status bar with real-time feedback and retry logic for failed operations.

## MusicBrainz: Relationship Editor Batch Remove

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Relationship%20Editor%20Batch%20Remove.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Relationship%20Editor%20Batch%20Remove.user.js)

Power-up for the MusicBrainz Relationship Editor that enables batch removal of relationships using keyboard shortcuts.

### Features
- **Batch Selection:** Hold modifier keys while clicking the "Remove" button to affect multiple relationships at once:
    - <kbd>Shift</kbd>: Affects all relationships of the **same type**.
    - <kbd>Ctrl</kbd>: Affects all relationships to the **same target entity**.
    - <kbd>Ctrl</kbd>+<kbd>Shift</kbd>: Affects all relationships of the **same type AND target**.
- **Toggle Mode:** Easily switch between removal and restore.

## MusicBrainz: Release day of the week

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Release%20day%20of%20the%20week.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Release%20day%20of%20the%20week.user.js)

Displays the day of the week for release events across MusicBrainz and color-codes them based on regional standard release days.

Based on the [original script](https://userscripts-mirror.org/scripts/show/130233) by Jugdish and SultS.

### Features

* **Visual Validation:** Automatically color-codes release days (Green = Standard, Orange = Non-Standard, Grey = Unknown) to easily spot potential errors at a glance.
* **Historical Accuracy:** Understands complex historical release rules, such as Germany's shift to Fridays in September 2005 and the introduction of the Global Release Day on July 10, 2015.
* **Informative Tooltips:** Hover over any injected weekday to see exactly why it was flagged (e.g., "Expected Tuesday for United States, but is Friday").

## MusicBrainz: Remember Search Type

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Remember%20Search%20Type.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Remember%20Search%20Type.user.js)

Remembers your last selected entity type in the MusicBrainz search bar.

### Features
- **Persistence:** Keeps your last used search category (e.g., Artist, Release, Recording) active across page loads.
- **Automatic Expiry:** Resets after 48 hours

## MusicBrainz: Reports Statistics

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Reports%20Statistics.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Reports%20Statistics.user.js)

Enhances the MusicBrainz reports page by showing change indicators for each report.

### Features
- **Change Tracking:** Shows how many items have been added or removed from a report since your last visit.
- **Visual Indicators:** Uses arrows (▲/▼) and color-coding to highlight trends in report volume.
- **Auto-Hider:** Automatically hides reports with zero items to reduce clutter.
- **Subscriptions Mode:** Can toggle between all entities and only subscribed ones.


[📷 View Screenshot](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTgxNTY2LCJwdXIiOiJibG9iX2lkIn19--b22789d3ad621ab1fdad517fdbfdedb9ccf3e6d3/7d8290c2d59333abec9b47774dd45aac8aa2e20e%5B1%5D.png?locale=en)

**Note:** Currently it will only work when using ISO 8601 date/time format in user preferences and UI language set to English:

[📷 View Screenshot](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTgxMzgzLCJwdXIiOiJibG9iX2lkIn19--3225284c1f3f5207973a381c75c38fa7050618b6/image.png?locale=en)

## MusicBrainz: Resizable Secondary Types Forms

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Resizable%20Secondary%20Types%20Forms.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Resizable%20Secondary%20Types%20Forms.user.js)

Fixes [MBS-10509](https://tickets.metabrainz.org/browse/MBS-10509) by making the release group secondary type dropdown resizable and expandable.

## MusicBrainz: Search by ISRC in release editor

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Search%20by%20ISRC%20in%20release%20editor.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Search%20by%20ISRC%20in%20release%20editor.user.js)

Enhances the MusicBrainz Release Editor by adding ISRC search capabilities to the recording lookup.

### Features
- **ISRC Search:** Allows you to find recordings by pasting an ISRC directly into the recording search field.
- **Seamless Integration:** Works within the existing inline search interface of the Release Editor.

## MusicBrainz: Subscriber Spam Filter

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Subscriber%20Spam%20Filter.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Subscriber%20Spam%20Filter.user.js)

*No description provided.*

## MusicBrainz: Uncheck checkboxes with Esc

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Uncheck%20checkboxes%20with%20Esc.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Uncheck%20checkboxes%20with%20Esc.user.js)

Quickly deselect all checkboxes on the page by pressing the <kbd>Esc</kbd> key.

### Features
- **Keyboard Shortcut:** Clears selection without manual clicking.
- **Targeted Selection:** Primarily focused on checkboxes used for merging and within the release relationship editor.

## MusicBrainz: Warn on significant length differences during recording merge (MBS-10966)

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Warn%20on%20significant%20length%20differences%20during%20recording%20merge.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Warn%20on%20significant%20length%20differences%20during%20recording%20merge.user.js)

Implementation of [MBS-10966](https://tickets.metabrainz.org/browse/MBS-10966). Provides a warning when merging recordings with significantly different lengths.

### Features
- **Visual Warning:** Highlights recording pairs in the merge queue that differ by 15 seconds or more.
- **Mistake Prevention:** Helps avoid accidental merges of different versions or edits of the same song.

## SecondHandSongs to MusicBrainz Linker

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/SecondHandSongs%20to%20MusicBrainz%20Linker.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/SecondHandSongs%20to%20MusicBrainz%20Linker.user.js)

Injects MusicBrainz links into SecondHandSongs pages for artists, releases, and works.

### Features
- **Context-Aware:** Detects the type of entity (Artist, Work, Release) and adds the appropriate MusicBrainz icon link.

## SoundCloud Metadata Inspector

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/SoundCloud%20Metadata%20Inspector.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/SoundCloud%20Metadata%20Inspector.user.js)

Metadata inspector dashboard for SoundCloud that extracts and displays hidden data such as ISRCs, UPCs, publisher copyright lines, exact release/upload timestamps, streaming presets, and technical entity identifiers.

### Features
- **Release Metadata:** View detailed release information including barcode (UPC/EAN), record label, ℗/© publisher lines, writer/composer, rights license, buy links, and full tag lists.
- **Track-Level Metadata & ISRCs:** Inspect individual track ISRCs, track-level UPCs, BPM, key signature, monetization model, policy controls, and streaming/download availability.
- **Unified Timeline:** View all timestamps (created, published, released, display, and last modified dates) side-by-side.
- **Creator Metrics:** Displays creator pro status badges, real name, location base, follower/following counts, and activity metrics.
- **Technical & Stream Presets:** Inspect available audio stream presets (protocols and quality tiers), secret tokens, URNs, and API URIs.
- **Export Options:** Easily copy raw JSON metadata, formatted tab data, or MusicBrainz-formatted tracklists.
- **Flexible UI:** Automatic track card field hoisting, collapse/minimize to a floating button, and seamless dark mode support matching browser preferences.

## Spotify Release List: MusicBrainz Checker

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Spotify%20Release%20List%20MusicBrainz%20Checker.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Spotify%20Release%20List%20MusicBrainz%20Checker.user.js)

Checks releases listed on [Spotify Release List](https://spotifyreleaselist.netlify.app/) against MusicBrainz using Spotify URL lookups.

### Features
- **Auto-Filtering**: Automatically hides releases that are already found in MusicBrainz to help you focus on missing releases.
- **Header Toggle**: Adds a "Show Found" / "Hide Found" button in the page header to toggle the visibility of cataloged releases.
- **Direct Links**: Adds a direct "MB ↗" link badge to matching release pages on MusicBrainz.

## Spotify: MusicBrainz importer

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Spotify%20MusicBrainz%20importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Spotify%20MusicBrainz%20importer.user.js)

Based on the original script by RustyNova which can be found at https://github.com/RustyNova016/MusicBrainz-UserScripts/blob/main/spotify-musicbrainz-import.user.js

This version was reworked and notably adds buttons for [ISRC Hunt](https://isrchunt.com/), [ListenBrainz](https://listenbrainz.org/) and [SAMBL](https://github.com/Lioncat6/SAMBL-React). a-tisket was removed

## Volumo: MusicBrainz Importer

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Volumo%20MusicBrainz%20Importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Volumo%20MusicBrainz%20Importer.user.js)

Allows importing releases from Volumo into MusicBrainz.

### Features
- **Direct Import**: Extracts release metadata (title, artists, tracks with durations, barcode, record label, and catalog number) from the page structure or API and seeds the MusicBrainz release editor.
- **Harmony Integration**: Provides a link to import/seed the release via the Harmony platform.
- **Quick Access**: If the release URL is already registered in MusicBrainz, displays a direct link to open the release on MusicBrainz.
- **Background Lookups**: Looks up record labels and release/track artists in MusicBrainz via the API using their Volumo profile URLs and automatically seeds their MBIDs to streamline matching.

## YouTube Music: Spotify Search

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20Music%20Spotify%20Search.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/YouTube%20Music%20Spotify%20Search.user.js)

Adds a "Search on Spotify" option to the context menu in YouTube Music.

### Features
- **Context-Aware:** Detects if you clicked on a Song, Album, Artist, or Playlist.
- **Smart Query:** Constructs a targeted Spotify search based on the artist and title.
- **Native Look:** Adds a menu item that seamlessly blends with the YouTube Music interface.

## YouTube: MusicBrainz Importer

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20MusicBrainz%20Importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/YouTube%20MusicBrainz%20Importer.user.js)

Adds a button to YouTube video pages to easily import them as MusicBrainz recordings.

### Features
- **Data Import:** Pre-fills the MusicBrainz "Add Recording" form with title, length and  artist.
- **ListenBrainz Sync:** Also supports creating ListenBrainz playlists for mix videos with tracklists.
