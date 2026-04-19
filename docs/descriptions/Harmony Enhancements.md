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