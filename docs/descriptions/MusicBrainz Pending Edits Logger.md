# MusicBrainz: Pending Edits Logger

Real-time diagnostic and debug auditor that monitors pending changes across MusicBrainz entity editors.

## Features

- **Multi-Editor Auditing**: Inspects active pending changes across Release Editor (`MB.releaseEditor.allEdits()`), Relationship Editors (`MB.relationshipEditor`), External Links Editors, and raw HTML form inputs.
- **Manual & Automated Audits**: Exposes `window.auditPageForPendingEdits()` for manual diagnostic console auditing alongside real-time live change logging.
- **Form Baseline Snapshotting**: Tracks form state hydration (`mb-hydration`) to accurately detect dirty form inputs.
