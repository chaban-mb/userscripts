# YouTube Channel & Video Metadata Extraction Architecture

Technical reference for YouTube metadata extraction across Desktop (`www.youtube.com`) and Mobile (`m.youtube.com`), Innertube API endpoints, in-memory Polymer component state (`#movie_player` & `ytd-browse`), SPA lifecycle isolation, and structured external link extraction.

---

## 1. Unified Extraction Architecture: Innertube vs. In-Memory Component State

### A. Why Legacy DOM & Window Globals Fail on SPA Navigation
During client-side SPA navigations (`yt-navigate-finish`, `popstate`, `MutationObserver` URL changes), YouTube's Polymer/Kevlar router does **not** synchronously update or remove static document tags or global initial state:
- `window.ytInitialData` and `window.ytInitialPlayerResponse` retain the **initial hard-load page's** payload across subsequent SPA navigations.
- `<script type="application/ld+json">`, `<meta itemprop="channelId">`, `<link rel="canonical">`, and RSS `<link>` tags in `document.head` retain stale data from previous videos/channels.
- Unscoped DOM queries like `document.querySelector('a[href*="/redirect?"]')` or `document.querySelector('yt-page-header-view-model')` can match hidden or outgoing Polymer views (`<ytd-watch-flexy hidden>`, `<ytd-browse hidden>`) if queried before YouTube swaps views.

### B. The Two Authoritative Data Sources (Shared Schema)
Both YouTube's **Innertube JSON API** (`POST /youtubei/v1/player` and `POST /youtubei/v1/browse`) and YouTube's **live in-memory component properties** (`#movie_player.getPlayerResponse()` and `ytd-browse.data` / `ytm-browse.data`) share the exact same underlying response schema and can be parsed by a single `YouTubeSchemaParser`:

1. **Video Metadata (`parsePlayerResponse(playerResponse, expectedVideoId)`)**:
   - **Validation Guard**: Strictly requires `playerResponse?.videoDetails?.videoId === expectedVideoId` and non-empty `videoDetails.title` + (`videoDetails.author` || `videoDetails.channelId`).
   - **Fields**:
     - `title`: `videoDetails.title`
     - `channelTitle`: `videoDetails.author`
     - `channelId`: `videoDetails.channelId` (`UC...`)
     - `channelHandle`: `microformat.playerMicroformatRenderer.ownerProfileUrl` (`/@Handle`)
     - `durationSeconds`: `microformat.playerMicroformatRenderer.lengthSeconds` || `videoDetails.lengthSeconds`
     - `directMs`: `streamingData.adaptiveFormats[0].approxDurationMs`
     - `description`: `videoDetails.shortDescription` ?? `microformat.playerMicroformatRenderer.description.simpleText`

2. **Channel Metadata (`parseBrowseResponse(browseResponse, expectedTarget)`)**:
   - **Validation Guard**: Validates `expectedTarget` (`@handle` or `UC...`) against `channelId`, `vanityChannelUrl`, or `handle` before accepting the payload or writing to `_channelCache`.
   - **Fields**:
     - `channelId`: `metadata.channelMetadataRenderer.externalId` || `header.c4TabbedHeaderRenderer.channelId` || `header.pageHeaderRenderer...subscribeButtonViewModel.channelId` || `microformat.microformatDataRenderer.channelProfileMicroformatDetails.profilePage.mainEntity.url`
     - `handle`: `metadata.channelMetadataRenderer.vanityChannelUrl` || `microformat.microformatDataRenderer...mainEntity.alternateName` || `header.pageHeaderRenderer...metadataRows`
     - `channelTitle`: `metadata.channelMetadataRenderer.title` || `microformat.microformatDataRenderer...mainEntity.name` || `header.pageHeaderRenderer.pageTitle`
     - `externalLinks`: Extracted from `microformat.microformatDataRenderer.channelProfileMicroformatDetails.profilePage.mainEntity.sameAs` and redirect endpoints (`/redirect?q=...`).

---

## 2. Empirical Benchmark: `InnertubeExtractor` vs. `InMemoryExtractor`

Across live Desktop (`www.youtube.com`) and Mobile (`m.youtube.com` with touch emulation) navigations, running `InnertubeExtractor` and `InMemoryExtractor` concurrently across 15 representative navigation scenarios revealed the following performance and completeness characteristics:

| Scenario Category | Platform | Typical `innertubeMs` | Typical `inMemoryMs` | Latency Advantage | Fast Path Winner | Anchor Delay (`anchorWaitMs`) | Parity & Completeness |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Video SPA Navigation** | Desktop | **120–150 ms** | 2,700–2,850 ms (19–22 polls) | **~2,600–2,700 ms faster** | `innertube` | 0 ms | 100% match |
| **Video SPA Navigation** | Mobile | **130–210 ms** | 1,100–2,270 ms (15–36 polls) | **~900–2,140 ms faster** | `innertube` | 1,000–2,270 ms | 100% match |
| **Video Cold Load** | Desktop | 180–290 ms | **1 ms** (1 poll) | +180–280 ms | `in_memory` | 1,160–2,370 ms | 100% match |
| **Video Cold Load** | Mobile | 90 ms | **1 ms** (1 poll) | +90 ms | `in_memory` | ~400 ms | 100% match |
| **Channel SPA Navigation** | Desktop | **250–460 ms** | 1,230–1,380 ms (8–9 polls) | **~920–980 ms faster** | `innertube` | — | 100% match |
| **Channel SPA (Multi-link)** | Desktop | ~1,400 ms | ~1,280 ms (5 polls) | Comparable | `innertube` | — | **Superior (All links)** |
| **Channel SPA Navigation** | Mobile | **730 ms** | 2,240 ms (32 polls) | **~1,500 ms faster** | `innertube` | ~440 ms | 100% match |
| **Channel Cold Load** | Mobile | **550 ms** | 1,170 ms (17 polls) | **~620 ms faster** | `innertube` | — | 100% match |

### Key Conclusions from the Benchmark
1. **SPA Navigations (Video & Channel, Desktop & Mobile)**:
   - When a user clicks a link in YouTube's SPA, `MutationObserver` detects the `location.href` change within ~50–150 ms.
   - At that moment, `#movie_player.getPlayerResponse()` and `ytd-browse.data` / `ytm-browse.data` still hold the **previous** page's data for another **1,000–2,800 ms** until YouTube finishes its internal navigation lifecycle (`yt-navigate-finish`).
   - By contrast, `InnertubeExtractor` (`POST /youtubei/v1/player` and `POST /youtubei/v1/browse`) fetches the new entity's metadata in **122–207 ms** (video) and **252–732 ms** (channel), allowing MusicBrainz buttons to render up to **2.4 seconds *before* `yt-navigate-finish` fires**!
2. **Cold Page Loads**:
   - Although `#movie_player.getPlayerResponse()` is available in `1 ms` once the player mounts, `InnertubeExtractor` (`89–285 ms`) runs concurrently with `DOMScanner.getButtonAnchorElement()` (`anchorWaitMs`: `393–2373 ms`), meaning `InnertubeExtractor` finishes long before the DOM button dock even exists (**0 ms added latency** after the anchor is ready).
3. **Superior Data Completeness on Channels (`sameAs` Links)**:
   - On channels with extensive external link sets (e.g. channels with 8 or more links), YouTube's in-memory `ytd-browse.data` on SPA navigation only populated a subset (e.g. 6 links) in its initial summary header, omitting links that were deferred to lazy-loaded About continuation panels.
   - By contrast, `POST /youtubei/v1/browse` with forced Desktop `WEB` client context (`clientName: 'WEB'`) returns `microformat.microformatDataRenderer.channelProfileMicroformatDetails.profilePage.mainEntity.sameAs` containing **all 8 external links** in a single network request on both Desktop and Mobile (`m.youtube.com`).

---

## 3. Innertube API Reference (`InnertubeExtractor`)

### A. Context & Forced `WEB` Client Helper
On `m.youtube.com`, the default `MWEB` Innertube context omits `microformatDataRenderer.sameAs` on `/youtubei/v1/browse` responses. Overriding `context.client.clientName = 'WEB'` (with header `'X-YouTube-Client-Name': '1'`) forces YouTube's backend to return the full Desktop `microformatDataRenderer` payload even when called from `m.youtube.com`:

```javascript
_getContext: function (forceWebClient = false) {
    const apiKey = Utils.getYtcfgValue('INNERTUBE_API_KEY');
    const rawContext = Utils.getYtcfgValue('INNERTUBE_CONTEXT');
    if (!rawContext) return { apiKey, context: null };

    const context = JSON.parse(JSON.stringify(rawContext));
    if (forceWebClient) {
        if (!context.client) context.client = {};
        const isWebAlready = context.client.clientName === 'WEB';
        context.client.clientName = 'WEB';
        context.client.clientVersion = (isWebAlready && context.client.clientVersion)
            ? context.client.clientVersion
            : '2.20260220.00.00';
    }
    return { apiKey, context };
}
```

### B. Core Endpoints

#### 1. `POST /youtubei/v1/player` (Video Metadata)
- **Payload**: `{ context, videoId }` (using native client context `forceWebClient = false`)
- **Output**: Parsed via `YouTubeSchemaParser.parsePlayerResponse(raw, videoId)`. Also caches `(channelHandle, channelId, channelTitle)` in `DOMScanner._channelCache` so subsequent navigations to that creator's channel page skip `resolve_url`!

#### 2. `POST /youtubei/v1/navigation/resolve_url` (Resolve `@Handle` / Custom Path to `UC...`)
- **Payload**: `{ context, url: "https://www.youtube.com/@Handle" }`
- **Output**: `data.endpoint.browseEndpoint.browseId` (`UC...`). Skipped whenever `_channelCache` already maps `@handle -> UC...`.

#### 3. `POST /youtubei/v1/browse` (Channel Metadata & Complete `sameAs` External Links)
- **Headers**: `{ 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': context.client.clientVersion }`
- **Payload**: `{ context, browseId: channelId }` (with `forceWebClient = true`)
- **Output**: Parsed via `YouTubeSchemaParser.parseBrowseResponse(raw, expectedTarget)`. Caches `channelId`, `handle`, `channelTitle`, and `externalLinks` in `_channelCache` with `innertubeFetched = true`.

---

## 4. Reference Pattern: In-Memory Component Polling (`InMemoryExtractor`)

For future experiments or offline/zero-network userscripts where Innertube `fetch` calls are undesirable, YouTube's live Polymer/Kevlar components can be polled with target-ID verification:

```javascript
// 1. Video In-Memory Extraction (#movie_player.getPlayerResponse())
const moviePlayer = pageWin.document?.getElementById('movie_player')
    || document.getElementById('movie_player')
    || pageWin.movie_player;
const pr = moviePlayer?.getPlayerResponse?.();
const parsedVideo = YouTubeSchemaParser.parsePlayerResponse(pr, expectedVideoId);

// 2. Channel In-Memory Extraction (ytd-browse.data / ytm-browse.data)
const browseEl = pageWin.document?.querySelector('ytd-browse[page-subtype="channels"], ytd-browse, ytm-browse')
    || document.querySelector('ytd-browse[page-subtype="channels"], ytd-browse, ytm-browse');
const parsedChannel = YouTubeSchemaParser.parseBrowseResponse(browseEl?.data, expectedTarget);
```

> [!IMPORTANT]
> When reading `ytd-browse.data` or `ytm-browse.data` during SPA navigation, always validate `expectedTarget` (`@handle` or `UC...`) inside `parseBrowseResponse` because YouTube reuses the singleton `<ytd-browse>` element and leaves the previous channel's `.data` attached until the new browse response arrives.

---

## 5. Session Cache Isolation (`DOMScanner._channelCache`)

To prevent cross-creator cache pollution when navigating `Creator A Video -> Creator B Video -> Creator B Channel`:
- `cacheChannelData(handle, channelId, externalLinks, innertubeFetched, channelTitle)` must verify that `recordById` and `recordByHandle` refer to the same entity before merging.
- Never overwrite an existing record's `channelId` or `handle` if it conflicts with another creator's ID/handle; allocate a fresh object reference instead.
- Channel seeding to MusicBrainz (`edit-artist.url.0.text`) must **always** use the canonical `https://www.youtube.com/channel/UC...` URL rather than the `/@handle` URL, while cache invalidation on button press must evict **both** the canonical `channel/UC...` URL and the `/@handle` URL.
