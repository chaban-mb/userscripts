# MusicBrainz Solr 10 Search Service Upgrades Specification & Nuances

Documentation of the upcoming MetaBrainz Solr 10 Search Service Upgrades (scheduled for November 30, 2026: [MetaBrainz Blog Post](https://blog.metabrainz.org/2026/08/31/search-upgrades-nov-30-2026/)), related Jira tickets, dual-compatibility implementation patterns, and post-deployment cleanup guidelines.

---

## 1. Background & Scope

On August 31, 2026, MetaBrainz announced the replacement of the legacy search service backend with Solr 10. While the `/ws/2` XML/JSON API interfaces remain backwards-compatible for most typical lookups, search result payloads and query indexing semantics contain several breaking deprecations, schema modernizations, and performance enhancements.

---

## 2. Key Jira Tickets & Architectural Nuances

### SEARCH-753: Direct `target-type` in Relationship Objects
* **Old Behavior (Solr 9 Search Service)**:
  When searching indexed entities (e.g. `/ws/2/url/?query=...`), relationship objects returned in `relation-list` / `relations` lacked a direct `target-type` field. Clients had to inspect keys of the relationship object (matching against a list of known entity types: `artist`, `release`, `recording`, `work`, `series`, `label`, `place`, `event`, etc.) to determine the related entity type.
* **New Behavior (Solr 10 Search Service)**:
  Every relationship object explicitly includes a `"target-type": "artist"` (or `"release"`, `"label"`, etc.) property.
* **Compatibility Invariant**:
  Inspect `rel['target-type']` first ($O(1)$ lookup). If missing (legacy Solr 9 response), fall back to scanning keys against `KNOWN_ENTITY_TYPES`.

### SEARCH-752: Deprecation of `target` Field
* **Old Behavior**:
  Relationship objects in search responses included a top-level `target` property holding the foreign entity's MBID (e.g. `rel.target = "mbid-uuid"`).
* **New Behavior**:
  The `target` property is deprecated in Solr 10 and scheduled for permanent removal. Target entities are nested under their type key (e.g. `rel.artist.id`, `rel.release.id`, etc.) or identified via `rel[targetType]?.id`.
* **Compatibility Invariant**:
  Do NOT rely on `rel.target`. Extract entity ID via:
  ```javascript
  const targetType = rel['target-type'] || detectTargetType(rel);
  const targetEntity = rel[targetType];
  const targetId = (typeof targetEntity === 'object' ? targetEntity.id : targetEntity) || rel.target || '';
  ```

### SEARCH-444: Flattened Relationship Arrays
* **Old Behavior**:
  Search results nested relationships within an XML-inherited wrapper structure:
  ```json
  {
    "relation-list": [
      {
        "relations": [ { ... } ]
      }
    ]
  }
  ```
  or `relation-list` containing an array of items.
* **New Behavior**:
  Responses standardize on a direct, flattened relations array:
  ```json
  {
    "relations": [ { ... } ]
  }
  ```
* **Compatibility Invariant**:
  Support both:
  ```javascript
  const relations = entity.relations || (entity['relation-list'] && entity['relation-list'].flatMap(l => l.relations || l)) || [];
  ```

### SEARCH-452: Native Indexing of All URL Entity Relationships
* **Old Behavior**:
  In Solr 9, indexed URL search results (`/ws/2/url/?query=...`) only indexed relationships to `artist` and `release` entities. Relationships to other entity types (`recording`, `work`, `label`, `event`, `series`, `place`, etc.) were missing from search results, requiring clients to perform individual sequential entity lookups (`/ws/2/url/<mbid>?inc=...-rels`) to discover them.
* **New Behavior**:
  Solr 10 indexes relationships to all first-class MusicBrainz entities directly in the search index.
* **Compatibility Invariant**:
  When relationships for non-artist/release entities are already present in the search hit, clients can skip additional sequential lookup requests, saving significant rate-limited round-trips.

### SEARCH-680 & SEARCH-681: Genre Relationships Support
* **Enhancement**:
  Genre relationships (`genre-rels`) are officially supported in search indexing and lookup subqueries.
* **Application**:
  Ensure `/ws/2/url/<mbid>` lookup requests include `genre-rels` in the `inc` parameter alongside `artist-rels+release-rels+recording-rels+...`.

### SEARCH-677: Disambiguation Comments in Search Results
* **Enhancement**:
  Search results for related entities now include the entity `disambiguation` field directly in the relationship target object, allowing rich, disambiguated badges in search pickers and inspection tables without secondary lookups.

### Live Case Study: Wikipedia URLs Mislinked to Wrong Entity Types & Solr 9 vs 10
* **Editor Mislink Phenomenon**:
  Wikipedia URLs are frequently linked to incorrect entity types in MusicBrainz—most commonly an album article (e.g. `https://en.wikipedia.org/wiki/Boomtown_(Toby_Keith_album)`) linked to a **`work`** instead of a **`release-group`**, or vice versa.
* **Solr 9 Search Deficiency**:
  Because Solr 9's URL index only indexes `artist` and `release` relationships:
  - Querying `url:*wikipedia.org* AND targettype:release-group` or `targettype:work` returns **0 results** on Solr 9.
  - Editors cannot search for mislinked Wikipedia URLs using Solr targettype filters today; they must search wide (`*wikipedia.org*`) and resolve each URL via sequential WS/2 lookups.
* **Solr 10 Search Fix (SEARCH-452)**:
  Solr 10 indexes all relationship types on URLs, enabling direct Lucene queries like `url:*wikipedia.org* AND targettype:work` to instantly isolate and audit mislinked entities.
* **Entity Type Key Normalization (`release_group` vs `release-group`)**:
  - In MusicBrainz Server WS/2 JSON responses, `target-type` is `"release_group"` (underscore) and the entity object is keyed under `rel.release_group`.
  - In MusicBrainz website paths and search syntax, it is `release-group` (hyphen).
  - Code must normalize `release_group` to `release-group` for UI display and canonical link routing (`https://musicbrainz.org/release-group/${id}`).

### Architectural Distinction: Search Service (`/ws/2/url/?query=...`) vs. Entity Lookup (`/ws/2/url/<mbid>`)
* **MusicBrainz Server Entity Lookup (`/ws/2/url/<mbid>`)**:
  Handled by the core Perl/Catalyst backend (`MusicBrainz::Server`). Lookup responses **already** flatten relationships under `relations: [...]` and include `"target-type": "artist"` in JSON responses today.
* **MusicBrainz Search Service (`/ws/2/url/?query=...`)**:
  Handled by the Java/Solr search indexing engine (`mb-solr` / `search-server`). Currently runs Solr 9, which outputs XML-inherited legacy envelopes (`relation-list`), omits `target-type`, and omits non-artist/release relationships.
* **Telemetry Scoping Invariant**:
  Solr telemetry MUST be strictly scoped to raw search hits (`_processPage`). It must NOT track relationships returned by secondary entity lookups (`resolveUnresolved`), as doing so would falsely attribute MusicBrainz Server lookup features to the Solr search engine.

---

## 3. Telemetry & Observability Pattern

To verify which path is taken in production and diagnose whether the client is hitting Solr 9 or Solr 10, use a canonical wide event telemetry tracker:

```javascript
class SolrTelemetryTracker {
  constructor() {
    this.metrics = {
      solr10_targetTypeDirect: 0,
      solr9_fallbackTypeScan: 0,
      solr9_deprecatedTargetPresent: 0,
      solr444_flatRelations: 0,
      solr444_legacyRelationList: 0,
      solr452_nativeNonArtistRelease: 0,
      searchesExecuted: 0
    };
  }

  record(event, payload = {}) {
    // Increment metric and log wide event
    if (this.metrics[event] !== undefined) {
      this.metrics[event]++;
    }
    console.info(`[SolrTelemetry] ${event}`, {
      timestamp: new Date().toISOString(),
      ...payload,
      metricsSnapshot: { ...this.metrics }
    });
  }

  isSolr10Active() {
    return this.metrics.solr10_targetTypeDirect > 0 || this.metrics.solr444_flatRelations > 0;
  }
}
```

In the UI, a compact diagnostic badge:
* 🟢 `Solr 10 (Native)`: When `solr10_targetTypeDirect > 0` or `solr444_flatRelations > 0`.
* 🟡 `Solr 9 (Compat)`: When `solr9_fallbackTypeScan > 0` or `solr444_legacyRelationList > 0`.
* ⚪ `Standby`: Before queries are performed.

---

## 4. Query Escaping Invariants

Solr / Lucene special characters (`+`, `-`, `&&`, `||`, `!`, `(`, `)`, `{`, `}`, `[`, `]`, `^`, `"`, `~`, `*`, `?`, `:`, `\`, `/`) must be handled carefully:
1. When constructing phrase queries (e.g. `url:"..."`), do NOT escape internal slashes `/` inside the quotation marks unless raw unquoted query building is utilized.
2. For wildcard searches (`resource:https\\://bandcamp.com/*`), backslash-escape colons and slashes outside quoted phrases:
   `resource:https\://example.com/artist/*`
3. Always provide a raw query preview container in debug interfaces so developers can inspect and copy the exact encoded URL sent to `/ws/2/url/?query=...`.

---

## 5. Post-Nov 30, 2026 Cleanup Checklist

Once Solr 10 deployment is verified in production:
- [ ] Search for `// TODO(solr10-cleanup)` markers across the codebase.
- [ ] Remove `KNOWN_ENTITY_TYPES` scanning fallback in `extractRelationInfo` (SEARCH-753).
- [ ] Drop legacy `rel['relation-list']` nesting unwrapping (SEARCH-444).
- [ ] Remove fallback checks for `rel.target` (SEARCH-752).
- [ ] Deprecate standalone sequential lookup fallback when full relationships are already indexed (SEARCH-452).
