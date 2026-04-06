# Harmony Development Notes: URL Seeding Refactor

This document contains technical details for a potential future refactor of the URL seeding logic in `Harmony Enhancements.user.js`.

## Current Strategy: Form Scraping
The script currently scrapes `urls.X.url` and `urls.X.link_type` from the hidden inputs of the `release-seeder` (Import) form. This approach is simple and relies on Harmony's pre-calculated integer IDs.

## Future Strategy: JSON State Extraction
If the form scraping becomes unreliable or if we need to work with the raw data, we can switch to extracting from the `__FRSH_STATE__` script tag.

### 1. URL Type ID Mapping
The following mapping connects Harmony's named types back to MusicBrainz relationship type IDs as defined in the Harmony source:

```javascript
/* Harmony's internal mapping: */
const HARMONY_URL_TYPE_IDS = {
    'production': 72,
    'amazon asin': 77,
    'discography entry': 288,
    'license': 301,
    'get the music': 73,
    'purchase for mail-order': 79,
    'purchase for download': 74,
    'download for free': 75,
    'free streaming': 85,
    'streaming': 980,
    'crowdfunding page': 906,
    'show notes': 729,
    'other databases': 82,
    'discogs': 76,
    'vgmdb': 86,
    'secondhandsongs': 308,
    'allmusic': 755,
    'BookBrainz': 850,
};
```

### 2. State Pointer Resolution
Harmony (Deno Fresh) often uses a serialized state where properties like `externalLinks` are integer indices into a shared value array (`v[0]`). 

**Resolution Logic (Draft):**
```javascript
// Within getReleaseDataFromJSON
if (typeof releaseObj.externalLinks === 'number' && data.v?.[0]?.[releaseObj.externalLinks]) {
    const resolvedLinks = data.v[0][releaseObj.externalLinks];
    releaseObj.urls = (resolvedLinks.links || []).map(l => ({
        url: l.url,
        link_type: HARMONY_URL_TYPE_IDS[l.types?.[0]?.toLowerCase()] || null
    }));
}
```
