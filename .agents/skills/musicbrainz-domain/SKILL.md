---
name: musicbrainz-domain
description: MusicBrainz web application architecture, Knockout/React components, seeding protocols, Harmony DOM patterns, and CAA upload architecture.
---

# MusicBrainz Domain Knowledge & Architecture

Welcome to the **musicbrainz-domain** skill for the userscripts repository. This skill provides comprehensive architectural documentation and technical specifications for developing robust userscripts targeting MusicBrainz.org.

## Core Domain Invariants & Policies

- **Rate Limiting**: Enforce $\ge 1.0\text{s}$ delay with backoff against `musicbrainz.org` Web Services. Never run ad-hoc HTTP request loops against production.
- **Offline Fixture Discovery**: Develop and verify heuristics offline using recorded unit fixtures (`tests/test_*.js` or mock responses) rather than hammering live endpoints.
- **MusicBrainz Form Dirty Checking**: When tracking user modifications in MusicBrainz forms, exclude `.edit-note` textareas and CSRF tokens from dirty detection to prevent false-positive edit submissions.

## Triggers

This skill should be referenced whenever:

- Designing or debugging userscripts targeting MusicBrainz (`*.user.js`).
- Interacting with Knockout viewmodels (`window.MB.releaseEditor`) or React/Redux relationship editors (`window.MB.relationshipEditor`).
- Constructing URL relationship submissions, search queries, or external link seeding payloads.
- Implementing form dirty detection, pristine baseline tracking, or DOM mutation patterns (Harmony DOM patterns).
- Interacting with the Cover Art Archive (CAA) upload subsystem (`MB.Art`).

## Table of Contents (Reference Documents)

1. [MusicBrainz Architecture & Nuances](references/musicbrainz_architecture.md)
   - UI Architecture (Knockout.js vs DOM), Source Code References, Private JSON API (/ws/js/), Search Syntax, URL Relationships (link_type), Release Editor Observables, Language & Script Schemas, Relationship Editor (React/Redux), Edit Payload Generation & Submission, Dry Run & Interception, Seeding vs Client-Side Hydration, Cover Art Subsystem (MB.Art), Entity Autocomplete, Entity Merge Strategies, Video Flag Architecture, and Form Input Dirty Detection.

2. [MusicBrainz Seeding Specification](references/musicbrainz_seeding_specification.md)
   - Detailed specification for seeding releases, tracks, artists, labels, and external links via URL parameters and POST form submissions.

3. [Harmony DOM Patterns](references/harmony_dom_patterns.md)
   - Robust DOM traversal patterns, sibling index resolution, container scoping, and badge host management for userscript DOM enhancements.

4. [CAA Upload Architecture](references/caa_upload_architecture.md)
   - Cover Art Archive upload pipelines, image processing workflows, API endpoints, and error handling protocols.

5. [Solr 10 Search Upgrades Specification](references/solr_10_search_upgrades.md)
   - Solr 10 search engine upgrades (SEARCH-753, SEARCH-752), target-type field additions, and deprecation migrations.

6. [Guess Case & Guess Feat Improver Specification](references/guesscase_improver_spec.md)
   - Title-artist split engine heuristics, CJK separator handling, safety fallbacks, and regression test matrix.

7. Importer Architecture References:
   - [YouTube Button Architecture](references/youtube_button_architecture.md)
   - [YouTube Channel Metadata & Link Extraction](references/youtube_channel_metadata_and_links.md)
   - [YouTube Duration Sources](references/youtube_duration_sources.md)
