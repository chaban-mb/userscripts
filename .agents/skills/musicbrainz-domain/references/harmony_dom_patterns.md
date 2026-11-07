# Harmony DOM Architecture & Label Resolution Patterns

This document details the DOM structural mechanics for resolving active/seeded release labels versus unselected alternative provider values on Harmony (`/release` view).

## 1. DOM Hierarchy on `/release` View

The `Labels` table row (`tr` containing `th: "Labels"`) contains:

- `ul.release-labels:not(.inline)`: Primary active release labels selected/rendered by Harmony.
- `ul.alt-values`: Alternative provider values (e.g. Tidal, Spotify, Deezer, Qobuz suggestions).
  - Native unselected suggestions are always wrapped in `<span class="alt-value">` or `<li class="alt-value">`.
  - Companion-injected active labels (e.g. Beatport from HBR) are appended as `<li>` elements without the `.alt-value` container, and are seeded into the form via `labels.N.*` hidden inputs.

### Multi-Stage Companion Injections & Dedicated MutationObserver

- **Multi-Stage Asynchronous Lifecycle**: Companion scripts (e.g. HBR) often execute multi-stage queries on cold cache (e.g., Level 1 barcode search followed by Level 2 helper tab track scraping). Each stage may invoke UI synchronization and inject `<li>` elements into `ul.release-labels:not(.inline)` multiple times.
- **Dedicated Immediate Observer**: To eliminate visual flash and race conditions with debounced form observers, attach a focused `childList` `MutationObserver` directly to `ul.release-labels:not(.inline)`. Any newly appended `<li>` immediately triggers `reconcileReleaseLabelsDOM()`.
- **Structural Identity over Count Heuristics**: Do not rely on count checks like `listItems.length <= releaseLabels.length`. Instead, scan for structural companion signatures (`[data-hbr-label-provider]`, `a[href*="beatport.com"]`). If the companion label is not selected as an active primary release label in state (e.g. overridden by `[no label]`), cleanly demote it to `ul.alt-values` under `#hbr-beatport-label-alt` and sanitize `AppState.data.release.labels`.

### Native Harmony Provider Architecture vs. Companion Script Lifecycle

- **Native Harmony Multi-Provider Resolution (`harmonizer/merge.ts`)**:
  - `labels` is an `immutableReleaseProperty` strictly cloned from the primary/preferred provider (e.g. Spotify).
  - Harmony's `mergeResolvableEntityArray` combines only `externalIds` across providers—it **never merges catalog numbers**.
  - `AlternativeValues.tsx` computes label uniqueness via `identifier = [name, catalogNumber].join('\t')`. When a secondary provider (like Beatport) possesses a catalog number that the primary provider lacks, Harmony identifies it as a distinct value and renders it in `ul.alt-values`.
  - Form seeding strictly preserves the primary provider's release label (without the secondary catalog number).
- **Cold Cache vs. Warm Cache Divergence**:
  - **Warm Cache**: Companion scripts (HBR) run synchronously on page load *before* HE maps labels. HBR detects that the native server-rendered label matches Beatport's label name and grafts the catalog number directly onto `labels.0`. HE then maps `labels.0` and strips the matching barcode catalog number, causing Beatport to vanish from `ul.alt-values`.
  - **Cold Cache**: HE runs on page load and maps the label (e.g. `MusicHub` -> `[no label]`). HBR later queries Beatport and fails to find `MusicHub`, treating Beatport's recovery as a new secondary label (`labels.1`). HE's observer catches this, sanitizes the seed form, and demotes the row to `ul.alt-values` as `#hbr-beatport-label-alt`.
  - **Architectural Ground Truth**: The cold cache behavior—where Beatport's recovered label with catalog number is preserved in `ul.alt-values` as an unselected alternative while `labels.0` is seeded—is actually **100% faithful to native Harmony's multi-provider architecture** when Spotify is the primary input provider.

---

## 2. Active Implementation: Generic Structural Resolution

### Core Principle

Rather than maintaining lists of third-party script IDs or relying on loose text-matching fallbacks, we rely on Harmony's structural invariant:
**Unselected alternative values are wrapped in `.alt-value`; active/effective labels are not.**

```javascript
/**
 * Finds active release label DOM elements, structurally excluding
 * unselected alternative provider values (.alt-value).
 * @param {number} [index] - The release label index (0, 1, ...).
 * @returns {HTMLElement[]}
 */
findLabelElements: (index = null) => {
    const labelsRow = UI_UTILS.findReleaseInfoRow('Labels');
    if (!labelsRow) return [];

    const activeSpans = Array.from(labelsRow.querySelectorAll('.entity-links'))
        .filter(span => !span.closest('.alt-value'));

    if (index !== null) {
        return activeSpans[index] ? [activeSpans[index]] : [];
    }
    return activeSpans;
};
```

### Benefits

- **Zero Third-Party Coupling**: No knowledge required of companion script names, selectors, or markup conventions.
- **Strict Isolation**: Unselected alternative suggestions with matching names (e.g. Tidal's raw `recordJet`) are never mutated or badged.
- **Deterministic 1:1 Indexing**: `releaseData.labels[i]` directly maps to `activeSpans[i]`.

---

---

## 3. Archived Implementation: Explicit Companion-Scoped Resolution

*(Preserved for historical reference in case specific companion script attribute inspection is ever needed).*

`javascript
/**
 * Finds DOM elements matching an active or injected release label via explicit third-party selectors.
 * @param {string} labelName - The label name to find.
 * @param {number} [index] - The primary/injected label index if applicable.
 * @returns {HTMLElement[]}
 */
findLabelElementsExplicit: (labelName, index = null) => {
    const elements = [];
    const primarySpans = AppState.dom.labelListElements
        ? Array.from(AppState.dom.labelListElements)
        : Array.from(document.querySelectorAll('ul.release-labels:not(.inline) li span.entity-links'));

    // 1. Direct index match within primary release labels
    if (index !== null && primarySpans[index]) {
        elements.push(primarySpans[index]);
        return elements;
    }

    const cleanTarget = (labelName || '').trim().toLowerCase();
    const labelsRow = UI_UTILS.findReleaseInfoRow('Labels');

    // 2. Injected companion labels (e.g., HBR injected labels)
    if (labelsRow) {
        const injectedSpans = Array.from(labelsRow.querySelectorAll('.entity-links')).filter(span => isThirdPartyElement(span));
        if (cleanTarget) {
            for (const span of injectedSpans) {
                if (span.textContent.trim().toLowerCase() === cleanTarget) {
                    elements.push(span);
                }
            }
        }
        if (elements.length === 0 && index !== null && index >= primarySpans.length) {
            const injectedIndex = index - primarySpans.length;
            if (injectedSpans[injectedIndex]) {
                elements.push(injectedSpans[injectedIndex]);
            }
        }
        if (elements.length > 0) return elements;
    }

    // 3. Fallback: match by name strictly within primary release labels
    if (cleanTarget) {
        for (const span of primarySpans) {
            if (span.textContent.trim().toLowerCase() === cleanTarget) {
                elements.push(span);
            }
        }
    }

    return elements;
};
`

---

## 4. Field Modification Badges (Consolidated BadgeHost Pattern)

When elements (such as release labels) are modified by multiple enhancements (e.g. `mapLabelMbids` / `setNoLabel` overwriting the label name, and `removeBarcodeCatalogNumbers` stripping barcode-matching catalog numbers):

### Architectural Solution: `UI_UTILS.badgeHost`

- **Consolidated Single Badge**: Directly creates or manages a single `.he-badge` attached after the anchor element (`span.entity-links`). No wrapper container or flexbox spacing is required.
- **Separation of Concerns**: Enhancement modules only perform business logic and call `UI_UTILS.badgeHost(anchor).set(key, config)`. They never perform DOM sibling queries or know about other modules.
- **Aggregated Tooltip & Variant**:
  - Automatically derives the highest priority badge type (e.g., `'overwritten'` over `'added'`).
  - Combines individual module tooltips into a clean multi-line tooltip (`\n` separated):

    ```text
    Original label: DistroKid
    Removed catalog number (matches barcode): 701518733991
    ```

- **Node Cleanup**: When catalog numbers are removed from adjacent text nodes, whitespace-only remainder text nodes are removed (`node.remove()`) rather than left behind as ghost spacing.
- **Full Idempotency**: Repeated observer runs simply update the badge's internal `Map` (`_badgeEntries`) and re-render without duplicates or DOM jitter.

---

## 5. Self-Release Label Nuances (`setNoLabel`)

### Catalog Number Guard

- Self-release heuristics (`isSelf`: remaining label name empty after removing artist credits) must verify whether a catalog number exists.
- Catalog numbers originate from two sources:
  - **Native Harmony scrapers** (e.g. OTOTOY): Serialized directly into `__FRSH_STATE__` as `release.labels[i].catalogNumber`.
  - **Companion scripts** (e.g. HBR for Beatport): Ingested from `<input name="labels.N.catalog_number" data-hbr-beatport>` into `release.labels[i].catalogNumber` by `ingestExternalFormData()`.
- If `label.catalogNumber` or `releaseData.catalogNumber` contains a non-empty string, the release is assumed to be a formal imprint/release rather than a self-release.
- `setNoLabel` skips overwriting any label with an existing catalog number to `[no label]`.

---

## 6. Provider Error Banners & Compact "Not Found" Badges (`compactNotFoundMessages`)

### Background & Problem (kellnerd/harmony#265)

When querying multiple providers simultaneously for a release or barcode, providers that do not have the release render intrusive, full-width red error banners (`.message.error`) at the top of the page. This clutters the UI and distracts from actual releases.

### Architectural Solution: Zero-Shift Badge Architecture

1. **DOM Hierarchy & Sibling Isolation**:
   - Checkbox `<label class="provider-input <provider>">` elements live in a flex row (`form.center > div.row`).
   - Rather than inserting elements inside the `<label>` (which would cause clicking the badge or selecting text to inadvertently toggle the checkbox), the `<label>` is wrapped in a dedicated container:

     ```html
     <div class="he-provider-chip-slot">
         <label class="provider-input <provider>" for="<provider>-input">...</label>
         <span class="he-not-found-badge" title="...">no results</span>
     </div>
     ```

   - `.he-provider-chip-slot`: `position: relative; display: inline-flex; vertical-align: top;`
   - `.he-not-found-badge`: `position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%);`
   - Because `.he-not-found-badge` is positioned absolutely, its box contributes 0px width to the flex flow, eliminating button displacement and horizontal layout shift.
   - The parent `.row` receives `.has-he-badges { margin-bottom: 2.2em; row-gap: 1.8em; }` to prevent badge overlap with downstream elements and chips on wrapped lines.

2. **Strict Error Discrimination & Generic Resolution**:
   - **Generic Dynamic Resolution**: `findProviderLabel` resolves target buttons dynamically via `providerClass` (`label.provider-input.${providerClass}`) and text matching without static provider maps, ensuring immediate zero-maintenance compatibility when new providers are added to Harmony.
   - **Positive Allowlist Signatures**: Uses anchored regexes (`NOT_FOUND_SIGNATURES`) to match only known release-level "not found" messages. Any system/server errors (5xx/4xx), rate limits, or auth drops naturally fail to match and remain prominent red banners without requiring negative regex blocklists:
     - Deezer: `/^no data\s*\(code\s*800\)/i` -> badge label `no data`
     - Universal lookup: `/^API returned no (?:matching )?results/i` -> badge label `no results`
     - Beatport: `/^Search returned no matching results for/i` -> badge label `no results`
     - Melon: `/^Album (?:song list )?not found/i` -> badge label `not found`
     - Generic: `/^Release not found/i` -> badge label `not found`
   - Using anchored patterns (`^...`) prevents false positives on partial release warnings (e.g. Tidal's *"The API returned no data for some artists..."*).

3. **Faithful Tooltip Pattern**:
   - Uses native browser tooltips (`title` attribute) with multi-line formatting:

     ```text
     <ProviderName>: <messageText>
     <api_url>
     ```

   - Avoids synthesizing speculative status codes or labels beyond Harmony's native message content.
