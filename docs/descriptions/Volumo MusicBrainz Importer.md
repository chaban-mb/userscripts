Allows importing releases from Volumo into MusicBrainz.

### Features
- **Direct Import**: Extracts release metadata (title, artists, tracks with durations, barcode, record label, and catalog number) from the page structure or API and seeds the MusicBrainz release editor.
- **Harmony Integration**: Provides a link to import/seed the release via the Harmony platform.
- **Quick Access**: If the release URL is already registered in MusicBrainz, displays a direct link to open the release on MusicBrainz.
- **Background Lookups**: Looks up record labels and release/track artists in MusicBrainz via the API using their Volumo profile URLs and automatically seeds their MBIDs to streamline matching.
