# Userscripts

## Bandcamp: Show more dates

Displays all available date attributes for a Bandcamp release page, such as `publish_date`, `mod_date`, and `release_date`. These are extracted from the page's hidden JSON data and displayed below the main credits, sorted chronologically with source labels for easy reference.

Based on the [Bandcamp: Show publish date](https://greasyfork.org/scripts/420662) userscript by @w-biggs

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Bandcamp%20Show%20more%20dates.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Bandcamp%20Show%20more%20dates.user.js)

## Beatport: MusicBrainz Importer

Based on the original Beatport status and import scripts by [RustyNova](https://github.com/RustyNova016/MusicBrainz-UserScripts/)

This is combination of both script's features and has been refactored to be more readable and easier to maintain.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Beatport%20MusicBrainz%20Importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Beatport%20MusicBrainz%20Importer.user.js)

## CheckBoxMate Modernized

This is a modernized version of the original CheckBoxMate Greasemonkey script by scottmweaver.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/CheckBoxMate%20Modernized.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/CheckBoxMate%20Modernized.user.js)

## Click buttons across tabs

This script will make it easier to submit edits and ISRCs to MusicBrainz from supported sites (MagicISRC and ISRC Hunt) from multiple tabs at once.
Also it can automatically close the tab after submitting a merge edit (when it was opened in a new tab).

You can use it either from the script's context menu or via bookmarklets.

MusicBrainz: Submit Edit (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('mb_edit_channel').postMessage('submit-edit'); })();`

MagicISRC: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('magicisrc_submit_channel').postMessage('submit-isrcs'); })();`

ISRC Hunt: Submit ISRCs (All Tabs)<br>
`javascript:(function(){ new BroadcastChannel('isrc_hunt_submit_channel').postMessage('submit-isrcs'); })();`

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Click%20buttons%20across%20tabs.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Click%20buttons%20across%20tabs.user.js)

## Discourse: Disable Touch Detection

This script prevents Discourse from hiding editor toolbar functions on touch-capable devices.

It works by spoofing the browser APIs that Discourse uses for touch detection, ensuring the full desktop toolbar is always visible. The script is designed to be robust, supporting both recent and old versions of Discourse.

By default, this script only runs on the [MetaBrainz Community Discourse](https://community.metabrainz.org/). To use it on other forums, you can add more `@match` directives in the script's settings.

Before:
[📷 View Before](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTg2NzE1LCJwdXIiOiJibG9iX2lkIn19--1f30dc15e4d8a31ebde67eafa83390a30a855ea3/Screenshot%202025-08-25%2018.06.05.png)

After:
[📷 View After](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTg2NzE0LCJwdXIiOiJibG9iX2lkIn19--d769e44c4fa0dbc674c3390dd59e24d4f108e50e/Screenshot%202025-08-25%2018.06.09.png)


See also
"[Why so many options in the gear editor menu? - UX - Discourse Meta](https://meta.discourse.org/t/why-so-many-options-in-the-gear-editor-menu/239497)"

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Discourse%20Disable%20Touch%20Detection.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Discourse%20Disable%20Touch%20Detection.user.js)

## DOM Mutation Observer Debugger

Logs all DOM mutations (additions, removals, attribute changes) to the console for debugging purposes.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/DOM%20Mutation%20Observer%20Debugger.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/DOM%20Mutation%20Observer%20Debugger.user.js)

## Harmony: Enhancements

A comprehensive userscript for **[Harmony](http://harmony.pulsewidth.org.uk/)** that adds quality-of-life features, data correction tools, and advanced language detection to streamline your import workflow.

### Release Data Correction & Automation
- **Improved Release Type Detection:** Automatically corrects the release type to **"Single"** or **"EP"** based on track title analysis, useful for releases that contain multiple versions of a single song.
- **Artist Credit Sync:** For single-track releases, automatically syncs the more detailed **track artist credit** up to the main **release artist**.
- **Normalize ETI:** Converts hyphenated Extra Title Information (ETI) on titles (e.g., `Title - Remix` to `Title (Remix)`) to match MusicBrainz style guidelines.
- **Self-Release Labeling:** Automatically sets the label to the special purpose label `[no label]` for self-releases where the artist name matches the label name.
- **Label MBID Mapping:** Automatically sets a known Label MBID based on a user-defined list if Harmony cannot resolve it.

### Language Detection
- **Enhanced Language/Script Guessing:** Implements a secondary **browser-based language detection** system which can be more accurate than Harmony's default.
- **Customizable Settings:** Offers a dedicated settings panel to control detection mode (browser, Harmony, or none) and fine-tune **confidence thresholds** for applying changes.

### Seeder Behavior
- **Skip MusicBrainz Confirmation:** Adds an option to skip the MusicBrainz confirmation page when submitting new releases.
- **Include GTIN and Packaging on Update**: Adds an option to include GTIN (barcode) and set packaging when updating existing releases.
- **Drop Artist Names as credited from Seed:** When an MBID is available, this option removes the artist's name from the seed data.

### UI & Workflow
- **Clipboard Re-Lookup:** Adds a **"Re-Lookup from Clipboard"** button to the lookup form for quickly starting a new lookup or extending an existing one using a supported source URL found in your clipboard.
- **Release Actions Page Re-Lookup:** Adds a **"Re-Lookup with Harmony" link** to the Release Actions page for **easily** re-running a lookup.
- **External Search Links:** Adds quick search links for yet unsupported providers (Qobuz, YouTube Music, Beatsource, etc.).
- **Minor Tweaks:** Enables **copying the permalink URL** on click and provides options to **hide verbose/redundant info sections** for a cleaner UI.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Harmony%20Enhancements.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Harmony%20Enhancements.user.js)

## ISBN Barcode Generator

Erkennt ISBNs und bettet einen scanbaren Barcode direkt ein. Mit An/Aus-Schalter im Menü.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISBN%20Barcode%20Generator.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISBN%20Barcode%20Generator.user.js)

## ISRC Hunt: Hide a-tisket links, normalize link style

Hides a-tisket links on ISRC Hunt and normalizes link style

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Hide%20a-tisket%20links,%20normalize%20link%20style.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISRC%20Hunt%20Hide%20a-tisket%20links,%20normalize%20link%20style.user.js)

## ISRC Hunt: Highlight ISRC matches and differences

Highlights matching ISRCs in green and non-matches red.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Highlight%20ISRC%20matches%20and%20differences.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISRC%20Hunt%20Highlight%20ISRC%20matches%20and%20differences.user.js)

## ISRC Hunt: Rewrite Harmony URLs

Rewrites links to Harmony to use "category=preferred"

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ISRC%20Hunt%20Rewrite%20Harmony%20URLs.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ISRC%20Hunt%20Rewrite%20Harmony%20URLs.user.js)

## ListenBrainz: Extended Controls

Allows customizing which actions are shown in listen controls cards, moving "Open in Music Service" links to the main controls area, displaying source info, and auto-copying text in the "Link Listen" modal.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/ListenBrainz%20Extended%20Controls.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/ListenBrainz%20Extended%20Controls.user.js)

## MusicBrainz: Add search link for barcode

Searches for existing releases in "Add release" edits by barcode, highlights and adds a search link on match

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Add%20search%20link%20for%20barcode.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Add%20search%20link%20for%20barcode.user.js)

## MusicBrainz: Add Spotify & SoundExchange search buttons on ISRC page

Adds buttons to search for the ISRC on Spotify and SoundExchange

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Add%20Spotify%20&%20SoundExchange%20search%20buttons%20on%20ISRC%20page.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Add%20Spotify%20&%20SoundExchange%20search%20buttons%20on%20ISRC%20page.user.js)

## MusicBrainz: Add Spotify and Deezer ISRC link to release pages

Adds an "import ISRCs" link to MusicBrainz release pages with a Spotify or Deezer URL

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Add%20Spotify%20and%20Deezer%20ISRC%20link%20to%20release%20pages.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Add%20Spotify%20and%20Deezer%20ISRC%20link%20to%20release%20pages.user.js)

## MusicBrainz: Ajax Collection Links

Enhances entity sidebar collection links (Add/Remove from Collection) to use AJAX, preventing page reloads and toggling the link text on success.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Ajax%20Collection%20Links.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Ajax%20Collection%20Links.user.js)

## MusicBrainz: Align Columns in Merge Edits

Aligns columns in merge edit tables for easier comparison.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Align%20Columns%20in%20Merge%20Edits.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Align%20Columns%20in%20Merge%20Edits.user.js)

## MusicBrainz: Artwork Uploader Turbo

Fixes [MBS-12374](https://tickets.metabrainz.org/browse/MBS-12374) and [MBS-12452](https://tickets.metabrainz.org/browse/MBS-12452)

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Artwork%20Uploader%20Turbo.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Artwork%20Uploader%20Turbo.user.js)

## MusicBrainz: Auto click confirm form submission

Automatically clicks the button to confirm submitting (seeding) data from other sites

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Auto%20click%20confirm%20form%20submission.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Auto%20click%20confirm%20form%20submission.user.js)

## MusicBrainz: Auto login MusicBrainz ISRC importers

Attempts to login on MusicBrainz ISRC submission sites like ISRC Hunt or MagicISRC and automatically handle OAuth authorization

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Auto%20login%20MusicBrainz%20ISRC%20importers.user.js)

## MusicBrainz: Automatically show AcoustIDs

Requires the [Display acoustIDs and merge recordings with common acoustID userscript](https://github.com/loujine/musicbrainz-scripts/?tab=readme-ov-file#musicbrainz-edit-display-acoustids-and-merge-recordings-with-common-acoustid) to be installed.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Automatically%20show%20AcoustIDs.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Automatically%20show%20AcoustIDs.user.js)

## MusicBrainz: Batch Remove Cover Art

Allows batch removing cover art from MusicBrainz releases.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Batch%20Remove%20Cover%20Art.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Batch%20Remove%20Cover%20Art.user.js)

## MusicBrainz: Compare AcoustIDs easier!

Modernized and refactored version of the original script which can be found at https://github.com/otringal/MB-userscripts/blob/master/Musicbrainz_acoustid.user.js

Also highlights shared AcoustIDs in recording merge edits.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Compare%20AcoustIDs%20easier!.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Compare%20AcoustIDs%20easier!.user.js)

## MusicBrainz: Editor Subscription Manager

Manages subscriptions, tracks name changes and detects deleted users.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Editor%20Subscription%20Manager.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Editor%20Subscription%20Manager.user.js)

## MusicBrainz: Guess Case Improver

Improves the native "Guess Case" for release, recording and track titles with advanced artist and ETI parsing. Also removes duplicate artists after using "Guess feat. artists" on tracklists.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Guess%20Case%20Improver.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Guess%20Case%20Improver.user.js)

## MusicBrainz: Guess release language and script

Modified version of the original script by ROpdebee at https://github.com/ROpdebee/mb-userscripts/pull/502

Instead of LibreTranslate it uses the the [language detector API](https://developer.mozilla.org/en-US/docs/Web/API/Translator_and_Language_Detector_APIs)

[Compatibility](https://developer.mozilla.org/en-US/docs/Web/API/LanguageDetector#browser_compatibility) as of August 2025 is currently limited to Chrome ≥138

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Guess%20release%20language%20and%20script.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Guess%20release%20language%20and%20script.user.js)

## MusicBrainz: Highlight identical barcodes and toggle merge checkboxes

Highlights sets of identical barcodes and toggles checkboxes for merging on click

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Highlight%20identical%20barcodes%20and%20toggle%20merge%20checkboxes.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Highlight%20identical%20barcodes%20and%20toggle%20merge%20checkboxes.user.js)

## MusicBrainz: Hotkeys for selected entities

Adds hotkeys to perform actions on selected entities:
- <kbd>A</kbd>: Artwork
- <kbd>D</kbd>: Delete
- <kbd>E</kbd>: Edit
- <kbd>W</kbd>: Merge
- <kbd>Q</kbd>: Aliases
- <kbd>R</kbd>: Relationship Editor

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Hotkeys%20for%20selected%20entities.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Hotkeys%20for%20selected%20entities.user.js)

## MusicBrainz: Import from Discogs CSV

**How to use:**

1. Make a new release collection
1. Upload your CSV

[📷 View Screenshot](https://community.metabrainz.org/uploads/default/original/3X/d/3/d32d6965a2c57564bac560c8550a8089d14491f5.png)

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Import%20from%20Discogs%20CSV.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Import%20from%20Discogs%20CSV.user.js)

## MusicBrainz: Mass Merge Recordings from Edit

Batch merge recordings from an "Edit medium" page.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Mass%20Merge%20Recordings%20from%20Edit.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Mass%20Merge%20Recordings%20from%20Edit.user.js)

## MusicBrainz: Relationship Editor Batch Remove

Allows batch removing relationships of the same type and/or entity when holding
- <kbd>Ctrl</kbd>: Entity
- <kbd>Shift</kbd>: Type
- <kbd>Ctrl</kbd>+<kbd>Shift</kbd>: Entity+Target

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Relationship%20Editor%20Batch%20Remove.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Relationship%20Editor%20Batch%20Remove.user.js)

## MusicBrainz: Remember Search Type

Remembers the last selected entity type in the header search bar (expires after 48h).

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Remember%20Search%20Type.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Remember%20Search%20Type.user.js)

## MusicBrainz: Reports Statistics

Script is work in progress. Might need more testing, maybe some more features

Currently it will only work when using ISO 8601 date/time format in user preferences and UI language set to English:

[📷 View Screenshot](https://greasyfork.org/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6MTgxMzgzLCJwdXIiOiJibG9iX2lkIn19--3225284c1f3f5207973a381c75c38fa7050618b6/image.png?locale=en)

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Reports%20Statistics.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Reports%20Statistics.user.js)

## MusicBrainz: Resizable Secondary Types Forms

Fixes [MBS-10509](https://tickets.metabrainz.org/browse/MBS-10509)

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Resizable%20Secondary%20Types%20Forms.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Resizable%20Secondary%20Types%20Forms.user.js)

## MusicBrainz: Search by ISRC in release editor

Hooks into the inline recording search of the release editor to allow searching by ISRC.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Search%20by%20ISRC%20in%20release%20editor.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Search%20by%20ISRC%20in%20release%20editor.user.js)

## MusicBrainz: Uncheck checkboxes with Esc

By default this script will only deselect checkboxes used for merging and in the release relationship editor.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Uncheck%20checkboxes%20with%20Esc.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Uncheck%20checkboxes%20with%20Esc.user.js)

## MusicBrainz: Warn on significant length differences during recording merge (MBS-10966)

Implementation of [MBS-10966](https://tickets.metabrainz.org/browse/MBS-10966).
This script will highlight recordings that differ by at least 15 seconds in the merge queue like on edit pages.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/MusicBrainz%20Warn%20on%20significant%20length%20differences%20during%20recording%20merge.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/MusicBrainz%20Warn%20on%20significant%20length%20differences%20during%20recording%20merge.user.js)

## SecondHandSongs to MusicBrainz Linker

Adds links from secondhandsongs.com to MusicBrainz entities.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/SecondHandSongs%20to%20MusicBrainz%20Linker.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/SecondHandSongs%20to%20MusicBrainz%20Linker.user.js)

## Spotify: MusicBrainz importer

Based on the original script by RustyNova which can be found at https://github.com/RustyNova016/MusicBrainz-UserScripts/blob/main/spotify-musicbrainz-import.user.js

This version was reworked and notably adds buttons for [ISRC Hunt](https://isrchunt.com/), [ListenBrainz](https://listenbrainz.org/) and [SAMBL](https://github.com/Lioncat6/SAMBL-React). a-tisket was removed

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/Spotify%20MusicBrainz%20importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/Spotify%20MusicBrainz%20importer.user.js)

## YouTube Music: Spotify Search

Adds a context-aware "Search on Spotify" item to the menu for songs and albums.

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20Music%20Spotify%20Search.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/YouTube%20Music%20Spotify%20Search.user.js)

## YouTube: MusicBrainz Importer

Imports YouTube videos to MusicBrainz as a new standalone recording

[![Install](https://img.shields.io/badge/Install-success.svg?style=for-the-badge&logo=tampermonkey)](https://github.com/chaban-mb/userscripts/raw/main/src/YouTube%20MusicBrainz%20Importer.user.js)
[![Source](https://img.shields.io/badge/Source-grey.svg?style=for-the-badge&logo=github)](https://github.com/chaban-mb/userscripts/blob/main/src/YouTube%20MusicBrainz%20Importer.user.js)

