# Guess Case / Guess Feat Improver Specification

This document details the architecture, safety guidelines, and test cases for the `MusicBrainz: Guess Case Improver` userscript. It is designed to prevent regressions and document the safe title-artist deduction engine.

## 1. Core Architecture & Safety

To prevent data loss (e.g. deleting composer names or song titles due to layout assumptions), the script uses a **Verified Split & Match** design:

1. **No Blind Layout Assumptions**: The script does not assume standard layouts (like `Artist - Title`) when guest artists are present.
2. **Double-Sided Matching (Intercept)**:
   - When matching standalone layout regexes (Style A: `X - Y feat. Z` or Style D: `X - Y (with Z)`):
     - If `X` contains a known editor artist, we treat it as `Artist - Title`.
     - If `Y` contains a known editor artist, we treat it as `Title - Artist` (reversed) and swap them.
     - If **neither** matches a known artist, we **do not intercept**. The native script runs, extracting the guest while leaving the title safely as `X - Y`.
3. **CJK-Aware Separators**: Japanese, Chinese, and Korean characters (CJK) often omit spaces around separators. We split using a CJK-aware regex:
   `/\s+[-–—/]\s+|\s+[-–—/]\s*|\s*[-–—/]\s+(?=.)|(?<=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])[-–—/]|[-–—/](?=[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef])/g`
4. **Safe Fallbacks (No Partial Removals)**:
   - **Knockout Mode**: Merge new/guest artists directly into the Knockout model, then strip the artist part from the title.
   - **Fallback Mode (No Knockout)**: Do **not** strip the artist part if any artist is uncredited. Leave the title intact so the user can manually align it.

---

## 2. Regression Test Cases Matrix

### Scenario A: Knockout Observable is Available (Automatic Split & Merge)

| # | Input Title | Seeded Editor Data | Expected Title Output | Expected Final Artist Credits (Name & Join Phrase) | Note / Layout |
|---|---|---|---|---|---|
| 1 | `Autismus Anthem - Klang der Nudel & Kamimane (musikvideo)` | `name: "Klang der Nudel & Ultra Raphi"` | `Autismus Anthem (musikvideo)` | `1. Klang der Nudel (&)`<br>`2. Kamimane ()` | Title - Artist (Seeded match) |
| 2 | `Klang der Nudel feat. Kamimane - Autismus Anthem` | `name: "Klang der Nudel"` | `Autismus Anthem` | `1. Klang der Nudel (feat.)`<br>`2. Kamimane ()` | Artist - Title (Seeded match) |
| 3 | `Aiobahn feat. 9Lana - letter (Official Visualizer)` | `artist.name: "Aiobahn"` | `letter (Official Visualizer)` | `1. Aiobahn (feat.)`<br>`2. 9Lana ()` | Artist - Title (Seeded match) |
| 4 | `Electric Callboy feat. The Offspring - LET THE GOOD TIMES ROLL (OFFICIAL VIDEO)` | `artist.name: "Electric Callboy"` | `LET THE GOOD TIMES ROLL (OFFICIAL VIDEO)` | `1. Electric Callboy (feat.)`<br>`2. The Offspring ()` | Artist - Title (Seeded match) |
| 5 | `snooze / wotaku feat. SHIKI` | `artist.name: "wotaku"` | `snooze` | `1. wotaku (feat.)`<br>`2. SHIKI ()` | Title / Artist (Seeded match) |
| 6 | `Brutalismus 3000 - I Bring My Gun To The Function (with Boys Noize) (Official Video)` | `name: "Brutalismus 3000"` | `I Bring My Gun To The Function (Official Video)` | `1. Brutalismus 3000 (with)`<br>`2. Boys Noize ()` | Artist - Title (Seeded match) |
| 7 | `DryftiN - Playing with FIRE!!! (feat. Yi Xi)` | `artist.name: "DryftiN"` | `Playing with FIRE!!!` | `1. DryftiN (feat.)`<br>`2. Yi Xi ()` | Artist - Title (Seeded match) |
| 8 | `Chenomio -フィクションです。feat.重音テト` | `artist.name: "Chenomio"` | `フィクションです。` | `1. Chenomio (feat.)`<br>`2. 重音テト ()` | Artist - Title (Seeded match, no space) |
| 9 | `シャニムニ花火 - ピノキオピー feat. 初音ミク` | `name: "太鼓の達人 公式チャンネル (Taiko no Tatsujin)"` | `シャニムニ花火 - ピノキオピー` | `1. 太鼓の達人 公式チャンネル (Taiko no Tatsujin) (feat.)`<br>`2. 初音ミク ()` | [NOT PURSUED] Ambiguous layout; promoting unknown part conflicts with subtitles (Bug 8) |
| 10 | `シャニムニ花火 - ピノキオピー feat. 初音ミク` | `name: "ピノキオピー"` | `シャニムニ花火` | `1. ピノキオピー (feat.)`<br>`2. 初音ミク ()` | Title - Artist (Reversed, smart match) |
| 11 | `Giga & TeddyLoid - ヴィオレッタ feat. 超学生 (Official Video)` | `name: "TeddyLoid"` | `ヴィオレッタ (Official Video)` | `1. Giga (&)`<br>`2. TeddyLoid (feat.)`<br>`3. 超学生 ()` | Artist - Title (Multiple primary artists matching seeded single artist) |
| 12 | `WILD SIDE - HONK THE HORN 【Official Music Video】` | `artist.name: "HONKTHEHORN"` | `WILD SIDE 【Official Music Video】` | `1. HONK THE HORN ()` | Artist - Title (Space mismatch bypass) |
| 13 | `Dub 003 (feat. Cosmonection & Marc Bianco) (feat. Cosmonection & Marc Bianco)` | `name: "Cosmonection, Tour-Maubourg & Marc Bianco"` | `Dub 003` | `1. Tour-Maubourg (feat.)`<br>`2. Cosmonection (&)`<br>`3. Marc Bianco ()` | Pre-existing primary guest artist credit reordering |
| 14 | `Dub 003 (Official Video) (Official Lyric Video)` | N/A | `Dub 003 (Official Video) (Official Lyric Video)` | N/A | Recursive ETI extraction in applyAdvancedRules |
| 15 | `Song Name` | `name: "W/N feat. 267"` | `Song Name` | `1. W/N (feat.)`<br>`2. 267 ()` (Keeps GID) | Preserving GID in deduplicateACFromObservable when duplicate holds the GID |
| 16 | `Release Name` | `track.artist.gid: "b8ccd64..."` | N/A | `release.artist.gid: "b8ccd64..."` | Propagating GIDs from track artist credits to release artist credits |
| 17 | `Kinda Funny - AR/CO Remix` | `name: "Young Bombs & Audrey Mika"` | `Kinda Funny - AR/CO Remix` *(Unchanged)* | `1. Young Bombs ( & )`<br>`2. Audrey Mika ( )` | Processing an entire multi-track remix release tracklist and asserting titles |
| 18 | `Kinda Funny (CharlieWonder & TOBER Remix)` | N/A | `Kinda Funny (CharlieWonder & TOBER Remix)` | N/A | CamelCase word preservation in applyAdvancedRules |
| 19 | `sandbag (feat. KASANE TETO & Una Otomachi)` | `name: "Dada", "Kasane Teto", "Una Otomachi"` | `sandbag` | `1. Dada (,)`<br>`2. Kasane Teto (&)`<br>`3. Una Otomachi ()` | Preserving existing credit casing/spelling over parsed title casing |
| 28 | `Sweet Escape feat. ひかり - Jafunk Remix` | `name: "Tokimeki Records & Jafunk"` | `Sweet Escape - Jafunk Remix` | `1. Tokimeki Records (feat.)`<br>`2. ひかり ()` | Unbracketed feat. with hyphenated remixer ETI (removes remixer Jafunk from AC) |
| 29 | `Sweet Escape feat. ひかり - Jafunk Special` | `name: "Tokimeki Records"` | `Sweet Escape - Jafunk Special` | `1. Tokimeki Records (feat.)`<br>`2. ひかり ()` | Unbracketed feat. with custom non-keyword ETI (preserves custom ETI) |
| 30 | `Sweet Escape feat. ひかり - Jafunk Remix` | `names: ["Tokimeki Records", "Jafunk", "ひかり", "ひかり - Jafunk Remix"]` | `Sweet Escape - Jafunk Remix` | `1. Tokimeki Records (feat.)`<br>`2. ひかり ()` | Deduplicates native guessFeat mis-parsed title suffix artist credit node |
| 31 | `Substitution (feat. Julian Perretta)` | `names: ["Purple Disco Machine", "Kungs", "Julian Perretta"]` | Track 1: `Substitution`<br>Track 2: `Substitution - Extended` | `1. Purple Disco Machine (&)`<br>`2. Kungs (feat.)`<br>`3. Julian Perretta ()` | Processes single-part titles (no hyphens) with featured artist syntax uniformly |
| 32 | `Mr Sandman (HIGHSOCIETY remix)` | `names: ["The Lifted", "HIGHSOCIETY", "Ashliann"]` | `Mr Sandman (HIGHSOCIETY remix)` | Remixer ON:<br>`1. The Lifted (feat.)`<br>`2. Ashliann ()` | Evaluates release + track titles for remixer removal and repairs `feat.` boundary join phrase |
| 33 | `Mr Sandman (HIGHSOCIETY remix)` | `names: ["The Lifted", "HIGHSOCIETY", "Ashliann"]` | `Mr Sandman (HIGHSOCIETY remix)` | Remixer OFF:<br>`1. The Lifted (&)`<br>`2. HIGHSOCIETY (feat.)`<br>`3. Ashliann ()` | Retains remixer HIGHSOCIETY in release and track credits when remix removal is OFF |
| 34 | `Mirror Mirror / STAR! (feat. Hatsune Miku)` | `name: "YENA"` | `Mirror Mirror / STAR!` | `1. YENA (feat.)`<br>`2. Hatsune Miku ()` | Multi-title split release title with slash separator (`/`), preventing false artist extraction of `/ STAR!` |




### Scenario B: Knockout Observable is Unavailable (DOM Fallback - No Partial Removals)

| # | Input Title | Seeded Editor Data | Expected Title Output | Expected Final Artist Credits | Note |
|---|---|---|---|---|---|
| 1 | `Autismus Anthem - Klang der Nudel & Kamimane (musikvideo)` | `name: "Klang der Nudel & Ultra Raphi"` | `Autismus Anthem - Klang der Nudel & Kamimane (musikvideo)` *(No change)* | `1. Klang der Nudel (&)`<br>`2. Ultra Raphi ()` *(No change)* | Avoids partial removal |
| 2 | `Autismus Anthem - Klang der Nudel & Kamimane (musikvideo)` | `name: "Klang der Nudel & Ultra Raphi"`<br>(Manual add: `Kamimane`) | `Autismus Anthem (musikvideo)` | `1. Klang der Nudel (&)`<br>`2. Ultra Raphi (&)`<br>`3. Kamimane ()` *(No change)* | Strips fully when all match |
| 3 | `Aiobahn feat. 9Lana - letter (Official Visualizer)` | `artist.name: "Aiobahn"` | `Aiobahn feat. 9Lana - letter (Official Visualizer)` *(No change)* | `1. Aiobahn ()` *(No change)* | Avoids partial removal |
| 4 | `Title - Unknown Artist` | `name: "Klang der Nudel"` | `Title - Unknown Artist` *(No change)* | `1. Klang der Nudel ()` *(No change)* | Avoids partial removal |
| 5 | `シャニムニ花火 - ピノキオピー feat. 初音ミク` | `name: "太鼓の達人 公式チャンネル (Taiko no Tatsujin)"` | `シャニムニ花火 - ピノキオピー` | `1. 太鼓の達人 公式チャンネル (Taiko no Tatsujin) (feat.)`<br>`2. 初音ミク ()` | Strips guest only (safe fallback) |

---

## 3. Native MusicBrainz guessFeat Quirks & Mis-Parses

Native MusicBrainz `guessFeat` logic in `musicbrainz-server` has several known parsing quirks that this userscript interceptor normalizes:

1. **Greedy Feature Extraction & Trailing Title Suffixes**:
   - Native MB `guessFeat` uses a simple regex matching `feat. <everything to end of line>`.
   - When a track title uses unbracketed feature syntax with a hyphenated ETI suffix (e.g. `Sweet Escape feat. ひかり - Jafunk Remix`), native `guessFeat` extracts `"ひかり - Jafunk Remix"` as the guest name.
2. **Unlinked Duplicate Artist Node Generation**:
   - If the true artist (`ひかり`, linked with MB GID) is already present in the artist credit, native `guessFeat` appends an unlinked duplicate artist credit entry (`name: "ひかり - Jafunk Remix"`, `gid: null`).
3. **Userscript Normalization & Safeguards**:
   - **`isPrefixWithSeparator` Detection**: Checks if an unlinked artist entry name (`"ひかり - Jafunk Remix"`) starts with a clean/linked artist name (`"ひかり"`) followed by delimiters (` - `).
   - **Deduplication Safeguard**: `deduplicateACFromObservable` detects and removes the mis-parsed unlinked node while explicitly preserving the clean linked artist name and GID (`!isMisparsedSuffix`).
   - **Positional Title Core Recovery**: Relative positional hyphen analysis (`parts[0]` vs `parts[1]`) recovers the true title core + ETI (`Sweet Escape - Jafunk Remix`).
4. **Release-Level `guessReleaseFeatArtists` Track Propagation**:
   - Native MB `guessReleaseFeatArtists` parses featured artists from the Release Title and updates all tracks across all mediums whose artist credits match the release artist credit.
   - The userscript intercepts `guessReleaseFeatArtists` to propagate GIDs from tracks to the release (`propagateGidsFromTracksToRelease`), deduplicate release-level credits, and strip featured artist clauses uniformly from all tracks (regardless of whether track titles contain hyphens).
5. **Release-Wide `relatedArtists` & `isProbablyClassical` Pool Leakage (MBS-10477)**:
   - In native MB (`root/static/scripts/release-editor/fields.js`), whenever any recording is loaded, `value.relatedArtists` and `value.isProbablyClassical` are appended directly to the release-wide `this.medium.release.relatedArtists` pool rather than scoped per-track.
   - **Semicolon Join Artifact**: If any track on the release has classical relationships, `isProbablyClassical` flips to `true` release-wide, forcing native `guessFeat` to replace `feat.` with `; ` on subsequent non-classical tracks.
   - **Fuzzy-Match False Positives**: `expandCredit` tests similarity against the global pool with `MIN_NAME_SIMILARITY = 0.6`. An unrelated artist sharing a last name (e.g. `Sandy Williams` on Track 2) will be falsely attached to a newly parsed guest (`Joe Williams` on Track 1).
   - **Userscript Safeguard**: The userscript reconstructs the true `structure.joinPhrase` from `originalTitle` (recovering `feat.` over `; `) and preserves only verified artist GIDs.
6. **Subtitle vs. Artist Part Ambiguity (Bug 8 Guardrail)**:
   - For track titles formatted as `Part 1 - Part 2 (feat. Guest)` where neither `Part 1` nor `Part 2` matches a known artist in `pristineArtists`:
   - `anyFeaturedArtistIsKnown` must **never** check `editorLower` because native `guessFeat` unconditionally appends `Guest` to `editorLower` before the userscript runs.
   - Heuristically promoting `Part 2` to an artist role causes destructive false positives on subtitles/translations (e.g. `BUNKA開放区 - Culture open area (feat. Kagamine Rin & Len)`) and version descriptors (`Title - Acoustic Version (feat. Guest)`).
   - The userscript safely returns `-1` to leave the title intact without promoting unknown parts to artist credits.

---

## 4. Automated Test Suite

A standalone regression test script is preserved in the repository at:
[tests/test_guesscase_split_logic.js](file:///c:/Users/User/Documents/git/userscripts/tests/test_guesscase_split_logic.js)

To run the suite and verify logic against all test cases, execute:
```bash
node tests/test_guesscase_split_logic.js
```

## 7. Track-to-Release Credit Synchronization (`syncTrackCreditsToRelease`)

To mirror the single-track credit synchronization behavior (as seen in Harmony Enhancements' `syncTrackArtist`), `syncTrackCreditsToRelease(release)` automatically syncs track artist credits to the release artist credit under strict conditions:
1. **Single-Track or Uniform Release**: Either the release has exactly 1 track, or all tracks across all mediums share the identical artist credit signature (`gid` or normalized name).
2. **More Detailed Track Credit**: `trackAC.names.length > releaseAC.names.length`.
3. **Primary Artist Match**: The primary artist of the track credit must match the primary artist of the release credit (by GID or normalized credit/canonical name).
4. **Safety Against Remixer Overwrite**: If the release artist is solely the remixer (e.g. `Remixer Guy`) and the track is `Original Artist feat. Guest`, the primary artist mismatch guardrail ensures the release credit is not overwritten.
5. **Deduplication & Formatting**: The synced release credit is always normalized via pure deduplication (`deduplicateACNamesList`), join boundary repair (`repairFeatBoundary`), and optional remixer removal.

