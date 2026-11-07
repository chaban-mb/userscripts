# MusicBrainz Release Seeder Specification & Harmony Compatibility

This document provides the definitive, source-verified reference for seeding data into MusicBrainz via the Release Editor (`/release/add` and `/release/<mbid>/edit`), along with compatibility rules for Harmony and companion userscripts.

---

## 1. Sources of Truth

* **MusicBrainz Server CGI & Controller Parsing**: [`lib/MusicBrainz/Server/Controller/ReleaseEditor.pm`](https://github.com/metabrainz/musicbrainz-server/blob/master/lib/MusicBrainz/Server/Controller/ReleaseEditor.pm) (`_process_seeded_data`, `_seeded_track`, `_seeded_label`, etc.)
* **MusicBrainz Server Knockout Initializer**: [`root/static/scripts/release-editor/seeding.js`](https://github.com/metabrainz/musicbrainz-server/blob/master/root/static/scripts/release-editor/seeding.js) (`releaseEditor.seedRelease`)
* **MusicBrainz Official Documentation**: [Release Editor Seeding Documentation](https://musicbrainz.org/doc/Development/Release_Editor_Seeding)
* **Harmony Seeder Implementation**: [`kellnerd/harmony` `musicbrainz/seeding.ts`](https://github.com/kellnerd/harmony/blob/main/musicbrainz/seeding.ts)

---

## 2. Server-Side Validation & Whitelist Enforcement

MusicBrainz uses the Perl `CGI::Expand` library (`expand_hash`) to turn dot-notated/indexed POST and GET parameters (e.g. `mediums.0.track.0.name`) into nested hash structures.

Crucially, **every entity level enforces a strict known-field whitelist** via `_report_unknown_fields`. Any parameter not explicitly recognized in the whitelist triggers a validation error or causes seeding failures.

```perl
# Example from lib/MusicBrainz/Server/Controller/ReleaseEditor.pm
my @known_fields = qw( name number recording length artist_credit pregap );
_report_unknown_fields($field_name, $params, $errors, @known_fields);
```

---

## 3. Parameter Whitelist Matrix

### A. Top-Level Release Entity

| Parameter Name | Supported by MB Server | Description / Valid Types |
| :--- | :---: | :--- |
| `name` | ✅ | Release title string (do **not** use `title`). |
| `artist_credit.names.X.name` | ✅ | Credited artist name string. |
| `artist_credit.names.X.mbid` | ✅ | Artist MBID (UUID). |
| `artist_credit.names.X.artist.name` | ✅ | Fallback artist name when MBID is unknown. |
| `artist_credit.names.X.join_phrase` | ✅ | Join phrase string (e.g. ` & `, `,`). |
| `barcode` | ✅ | GTIN/UPC/EAN string, or literal `'none'` (do **not** use `gtin`). |
| `release_group` | ✅ | Existing Release Group MBID (UUID). |
| `type.X` | ✅ | Primary/secondary release group type strings (`Album`, `Single`, `EP`, etc.). |
| `status` | ✅ | Status name string (`Official`, `Promotion`, `Bootleg`, `Pseudo-Release`). |
| `packaging` | ✅ | Packaging name string (`Jewel Case`, `Digipak`, `Cardboard/Paper Sleeve`, `None`, etc.). |
| `language` | ✅ | ISO 639-3 (3-letter) or ISO 639-1 (2-letter) language code. |
| `script` | ✅ | ISO 15924 (4-letter) script code (e.g. `Latn`, `Cyrl`, `Jpan`). |
| `comment` | ✅ | Disambiguation comment string. |
| `annotation` | ✅ | Wiki-formatted release annotation text. |
| `edit_note` | ✅ | Edit explanation note and source links. |
| `redirect_uri` | ✅ | URI to redirect after submitting release. |
| `make_votable` | ✅ | `0` or `1` boolean for auto-editor vote status. |
| `events.X.*` | ✅ | Array of release events (see section B). |
| `labels.X.*` | ✅ | Array of label entries (see section C). |
| `mediums.X.*` | ✅ | Array of mediums (see section D). |
| `urls.X.*` | ✅ | Array of URL relationships (see section E). |

### B. Release Events (`events.X`)

| Parameter Name | Supported by MB Server | Description / Valid Types |
| :--- | :---: | :--- |
| `events.X.date.year` | ✅ | 4-digit integer year (e.g. `2026`). |
| `events.X.date.month` | ✅ | Integer month (`1`–`12`). |
| `events.X.date.day` | ✅ | Integer day (`1`–`31`). |
| `events.X.country` | ✅ | 2-letter ISO 3166-1 country code (`XW`, `US`, `GB`, `DE`, `JP`, etc.). |

### C. Labels (`labels.X`)

| Parameter Name | Supported by MB Server | Description / Valid Types |
| :--- | :---: | :--- |
| `labels.X.name` | ✅ | Label name string. |
| `labels.X.mbid` | ✅ | Label MBID (UUID). |
| `labels.X.catalog_number` | ✅ | Catalog number string. |

### D. Mediums & Tracks (`mediums.X`, `mediums.X.track.Y`)

| Parameter Name | Supported by MB Server | Description / Valid Types |
| :--- | :---: | :--- |
| `mediums.X.format` | ✅ | Format name (`Digital Media`, `CD`, `12" Vinyl`, etc.). |
| `mediums.X.name` | ✅ | Medium title / subtitle string. |
| `mediums.X.toc` | ✅ | CD TOC string. |
| `mediums.X.track.Y.name` | ✅ | Track title string. |
| `mediums.X.track.Y.number` | ✅ | Track number / position string (`1`, `2`, `A1`, `01`). |
| `mediums.X.track.Y.length` | ✅ | Duration in milliseconds (integer) or formatted (`mm:ss`). |
| `mediums.X.track.Y.recording` | ✅ | Existing Recording MBID (UUID) to link. |
| `mediums.X.track.Y.artist_credit.names.Z.*` | ✅ | Track artist credit (same structure as release artist credit). |
| `mediums.X.track.Y.pregap` | ✅ | Boolean (sets position to `0` for pregap track). |
| `mediums.X.track.Y.video` | ⏳ *(Pending MBS-7017 / PR #3842 release)* | Boolean (`1`/`0` or `true`/`false`). Supported in PR #3842; available for seeding once merged and deployed to production. Until then, rejected by server whitelist. |
| **`mediums.X.track.Y.isrc`** | ❌ **REJECTED** | **Not supported in release seeder.** MusicBrainz does not allow seeding ISRCs via `/release/add`. |

### E. External URLs (`urls.X`)

| Parameter Name | Supported by MB Server | Description / Valid Types |
| :--- | :---: | :--- |
| `urls.X.url` | ✅ | Target URL string. |
| `urls.X.link_type` | ✅ | Numeric MusicBrainz link type ID (e.g. `85` streaming, `74` download purchase, `980` download/stream). |

---

## 4. Nuances & Gotchas for Userscripts

1. **Do Not Seed Track ISRCs**:
   * Harmony's internal object tree (`HarmonyTrack`) preserves `isrc` for display and lookup, but Harmony's `musicbrainz/seeding.ts` strictly omits `isrc` from the seeder form.
   * Any userscript serializing form inputs must omit `isrc` to avoid `_report_unknown_fields` errors.

2. **Single vs. Update Seeder**:
   * **New Release** (`form[name="release-seeder"]` $\rightarrow$ `/release/add`): Uses all full release/track parameters.
   * **Update Release** (`form[name="release-update-seeder"]` $\rightarrow$ `/release/<mbid>/edit`): Only seeds `urls.X.*`, `edit_note`, and `redirect_uri` due to MusicBrainz ticket MBS-13688 (tracklist updates via seeder on existing releases are restricted).

3. **Field Naming Nuances**:
   * `barcode` (MB form) vs `gtin` (Harmony internal).
   * `name` (MB form) vs `title` (Harmony internal).
   * `events.X.country` (MB form) vs `country` (legacy schema 16).

---

## 5. MBS-7017 (PR #3842) - Recording Video Attribute Seeding & Release Editor Support

* **Pull Request**: [`metabrainz/musicbrainz-server#3842`](https://github.com/metabrainz/musicbrainz-server/pull/3842) (`dvirtz:MBS-7017`)
* **Goal**: MBS-7017 - Allow setting recording video attribute from the Release Editor.
* **Scope & Seeding Update**:
  * **Release Editor UI & Actions**: Added `.video-checkbox` in `root/release/edit/recordings.tt` and `markAllRecordingsAsVideo` action in `actions.js`.
  * **Edit Endpoint**: Added `video` boolean handling in `WS/js/Edit.pm` and `Edit/Medium/Create.pm`.
  * **Release Seeder**: PR #3842 updates the release seeder validation (`ReleaseEditor.pm` `@known_fields` in `_seeded_track`) and client-side hydration (`seeding.js`) to support `mediums.X.track.Y.video`.
* **Deployment & Userscript Readiness**:
  * **Production Status**: Pending merge and release to MusicBrainz production.
  * **Once Merged & Released**: Userscripts and seeder tools (e.g. Harmony, Importers) can directly pass `mediums.X.track.Y.video=1` in `/release/add` GET/POST forms to mark tracks as video recordings upon initial release creation.
  * **Safety Guard until Release**: Do not emit `mediums.X.track.Y.video` against production instances until the MBS release containing PR #3842 is deployed, as existing production server whitelists will reject unknown fields.
