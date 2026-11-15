---
name: musicbrainz-domain
description: >-
  Use when building or debugging MusicBrainz userscripts, interacting with
  Knockout (`window.MB.releaseEditor`) or React/Redux (`window.MB.relationshipEditor`)
  viewmodels, seeding releases/URLs, handling form dirty-checking, or working
  with Cover Art Archive (`MB.Art`), Solr 10 search, Harmony DOM patterns, or
  YouTube importer metadata/UI.
---

# MusicBrainz Domain Knowledge & Architecture

## Core Domain Invariants & Policies

- **Rate Limiting**: Enforce $\ge 1.0\text{s}$ delay with backoff against `musicbrainz.org` Web Services. Never run ad-hoc HTTP request loops against production.
- **Offline Fixture Discovery**: Develop and verify heuristics offline using recorded unit fixtures (`tests/test_*.js` or mock responses) rather than hammering live endpoints.
- **MusicBrainz Form Dirty Checking**: When tracking user modifications in MusicBrainz forms, exclude `.edit-note` textareas and CSRF tokens from dirty detection to prevent false-positive edit submissions.
- **NEVER** mutate Release Editor or Relationship Editor DOM directly when Knockout (`window.MB.releaseEditor`) or React/Redux (`window.MB.relationshipEditor`) state is available.
- **NEVER** use `title` instead of `name` when seeding releases, mediums, or tracks via `/release/add`.
- **NEVER** run ad-hoc HTTP request loops against `musicbrainz.org` without $\ge 1.0\text{s}$ rate limiting and backoff.

## Reference Documents

Read only the reference matching your current task:

1. **Knockout/React UI, `/ws/js/` API, release/relationship editors, dirty-checking, or entity merges:** Read [`references/musicbrainz_architecture.md`](references/musicbrainz_architecture.md).
2. **Seeding releases, tracks, artists, labels, or external links via URL/POST:** Read [`references/musicbrainz_seeding_specification.md`](references/musicbrainz_seeding_specification.md).
3. **Harmony DOM traversal, sibling index resolution, or badge host management:** Read [`references/harmony_dom_patterns.md`](references/harmony_dom_patterns.md).
4. **Cover Art Archive (`MB.Art`) upload pipelines or image processing:** Read [`references/caa_upload_architecture.md`](references/caa_upload_architecture.md).
5. **Solr 10 search upgrades (`SEARCH-753`, `SEARCH-752`) or deprecated search fields:** Read [`references/solr_10_search_upgrades.md`](references/solr_10_search_upgrades.md).
6. **Guess Case / Guess Feat title-artist split heuristics or CJK separators:** Read [`references/guesscase_improver_spec.md`](references/guesscase_improver_spec.md).
7. **YouTube importer button placement, SPA/Polymer layout integration, or click-handler wiring:** Read [`references/youtube_button_architecture.md`](references/youtube_button_architecture.md).
8. **YouTube channel metadata extraction, handle/UCID resolution, or channel link seeding:** Read [`references/youtube_channel_metadata_and_links.md`](references/youtube_channel_metadata_and_links.md).
9. **YouTube video duration sources, `ytInitialPlayerResponse` parsing, or chapter timing:** Read [`references/youtube_duration_sources.md`](references/youtube_duration_sources.md).

## Done When

**Done when:** Userscript or domain logic uses the documented Knockout/Redux/seeding APIs, respects the $\ge 1.0\text{s}$ rate limit, excludes `.edit-note`/CSRF from dirty-checking, and passes offline unit/fixture tests without hitting live `musicbrainz.org` endpoints.
