# Cover Art Archive (CAA) Upload Architecture

Insights from reverse-engineering the MusicBrainz + Internet Archive upload pipeline while fixing error logging and 503 retry handling in `MusicBrainz Artwork Uploader Turbo`.

---

## Upload Pipeline Overview

The upload flow has **three sequential phases**, each backed by a jQuery Deferred:

```text
sign_upload  →  upload_image  →  submit_edit
(MB server)    (Internet Archive)   (MB server)
```

**Source:** `musicbrainz-server/root/static/scripts/edit/MB/Art.js`

---

## Phase 1: `sign_upload` (Signing)

**Endpoint:** `GET /ws/js/{cover|event}-art-upload/{gid}`

**Returns:** JSON with S3-compatible `formdata` fields (presigned upload credentials) and `image_id`.

**On failure**, the native code populates two Knockout observables **before** rejecting:

```javascript
postfields.fail(function (jqxhr, status, error) {
    const errorInfo = jqxhr.responseJSON?.error;
    if (errorInfo && typeof errorInfo === 'object') {
        fileUpload.signErrorMessage(errorInfo.message);
        fileUpload.signErrorDetails(errorInfo.error_details ?? '');
    }
    deferred.reject('error obtaining signature: ' + status + ' ' + error);
});
```

**Rejection shape** (via `toNativePromise → reject(args)`):

```text
errorList = ['error obtaining signature: error Bad Request']
```

- A single plain string — the HTTP status text. No numeric code.
- The actual error detail lives in the Knockout observables, not in the rejection args.

### Sign Error JSON Shape

The `detach_with_error` Perl sub serializes errors as:

```perl
error => (blessed($error) ? "$error" : $error)
```

- If `$error` is a **hashref** (e.g. from `_detach_with_ia_server_error`) → JSON object: `{"error": {"message": "...", "error_details": "..."}}`
- If `$error` is a **plain string** (e.g. `'invalid mime_type'`) → JSON string: `{"error": "invalid mime_type"}`

The native `sign_upload` JS only sets observables when `errorInfo` is an object:

```javascript
const errorInfo = jqxhr.responseJSON?.error;
if (errorInfo && typeof errorInfo === 'object') {
    fileUpload.signErrorMessage(errorInfo.message);
    fileUpload.signErrorDetails(errorInfo.error_details ?? '');
}
```

For plain-string errors, `signErrorMessage` is **not set** and the retry logic falls back to the raw rejection string.

### All Sign Error Responses from `_art_upload`

| Trigger | HTTP status | `error` shape | Retriable? |
| --- | --- | --- | --- |
| IA connection/read failure (bucket create/check) | 400 | `{message, error_details}` — IA error text | ✅ via `hasRetryPhrase` (message contains "try again") |
| IA metadata API returns empty `{}` (item not yet registered) | 500 | `{message}` — "We've hit a temporary delay...try again" | ✅ via `hasRetryPhrase` |
| IA item is dark (DMCA takedown) | 400 | `{message}` — "Internet Archive has had a takedown request" | ❌ no retry phrase |
| Bucket owned by wrong account | 400 | `{message}` — "we don't own the associated item" | ❌ no retry phrase |
| Invalid MIME type | 400 | `"invalid mime_type"` (plain string) | ❌ `signErrorMessage` not set |
| Image ID already in use | 400 | `{message: "The ID $id is already in use"}` | ❌ no retry phrase |
| Not logged in | 400 | plain string | ❌ |

**Known `error_details` variants** (all from `_detach_with_ia_server_error`, all retriable):

| Variant | `error_details` content |
| --- | --- |
| Connection timeout | `"Can't connect to archive.org:443 (Connection timed out)\n\nConnection timed out at .../LWP/Protocol/http.pm line 49.\n"` |
| Read timeout | `"read timeout at .../Net/HTTP/Methods.pm line 274.\n"` |
| IA offline page | Full `<html>` page: `<title>Internet Archive: Temporarily Offline</title>` — with embedded `data:image/jpeg;base64,...` logos |
| IA 503 HTML | `"<html><body><h1>503 Service Unavailable</h1>\nNo server is available...\n</body></html>\n"` |
| XPath parse error on conflict response | Perl exception object (stringified) |
| IA metadata API non-success | Raw IA metadata response body |

**Key insight:** `message` is **always** `"...Please wait a few moments and try again."` across all `_detach_with_ia_server_error` cases. `_detach_with_temporary_delay` uses a different message but also contains "try again". `error_details` never needs to be parsed — `message` alone is sufficient for retry detection via `hasRetryPhrase`.

---

## Phase 2: `upload_image` (Binary upload to IA S3)

**Destination:** Direct XHR to Internet Archive S3 endpoint (from presigned `formdata`).

**On failure:**

```javascript
deferred.reject('error uploading image: ' + xhr.status + ' ' + xhr.responseText, xhr.status);
```

**Rejection shape:**

```text
errorList = ['error uploading image: 503 <html>...', 503]
```

- **Two args**: a string (contains the actual HTTP status code and response body) plus the numeric status code.
- **No Knockout observables are set** — `signErrorMessage`, `signErrorDetails`, `editErrorMessage` all remain at their default empty string.
- The numeric status code (`503`) is passed as `errorList[1]`, directly detectable via `typeof err === 'number'`.

---

## Phase 3: `submit_edit` (Edit submission)

**Endpoint:** `POST` to MB server to finalize the edit.

**On failure:**

```javascript
deferred.reject(msg);
```

- Single string rejection.
- MB server sets `fileUpload.editErrorMessage(...)` before rejection.
- Nonce expiry is detectable: `editErrorMessage().includes('expired')`.

---

## `toNativePromise` Conversion

The userscript converts jQuery Deferreds to native Promises using:

```javascript
toNativePromise(deferred) {
    return new Promise((resolve, reject) => {
        deferred.done(resolve).fail((...args) => reject(args));
    });
}
```

`args` is the spread of all jQuery `.fail()` callback arguments. So if `.fail(msg, status)` fires, `catch(error)` receives `error = [msg, status]` — always an array.

---

## Retry Logic (`_handleRetry`)

### Status Code Extraction Priority

1. **5xx/429/408 scan of `textSources`** — catches `"error uploading image: 503 ..."` strings from `upload_image`
2. **Numeric fallback from `errorList`** — catches `503` passed as second arg by `upload_image`
3. **`hasRetryPhrase`** — catches all known IA `message` strings (`"try again"`) when MB wraps IA errors as HTTP 400

### `textSources` Contents

For each phase, `textSources` is built from:

- Strings and `.message` properties in the rejection args (`errorList`)
- `file.signErrorMessage()` — the human-readable IA error message
- `file.editErrorMessage()` — the edit submission error

**NOT included:** `file.signErrorDetails()` — it's either a Perl stack trace or a raw IA HTML page, neither of which adds detection value beyond what `signErrorMessage` already provides.

### Retriable Conditions

```javascript
const isRetriable = (
    httpStatus >= 500 ||
    httpStatus === 429 ||
    httpStatus === 408 ||
    httpStatus === 0 ||
    httpStatus === null ||
    hasRetryPhrase          // catches MB's HTTP 400 wrapper around IA errors
);
```

When `isRetriable && httpStatus === 400` (MB wrapping an IA error):

- Re-scan `textSources` for 5xx codes → if found, use that
- Otherwise, if `hasRetryPhrase` → assign `503`

### `errorDetail` for Display

Built from human-readable observables only — **never** from `signErrorDetails`:

```javascript
const signMsg = file.signErrorMessage?.() ?? '';
const editMsg = file.editErrorMessage?.() ?? '';
const rawStr  = errorList.find(e => typeof e === 'string' && e) ?? '';
// rawStr is the fallback for upload_image (no observables set)
const errorDetail = [signMsg, editMsg].filter(Boolean).join(' - ') || rawStr;
```

Then truncated with whitespace normalization: `.replace(/\s{2,}/g, ' ').trim().slice(0, 200)`.

---

## Knockout Observables on File Objects

| Observable | Set by | Phase | Contains |
| --- | --- | --- | --- |
| `signErrorMessage` | Native `sign_upload` `.fail()` | Sign | Human-readable MB error message |
| `signErrorDetails` | Native `sign_upload` `.fail()` | Sign | Raw IA response (HTML or Perl trace) — **not useful for parsing** |
| `editErrorMessage` | Native `submit_edit` `.fail()` | Submit | Edit submission error text |

`upload_image` sets **no Knockout observables** on failure.

---

## Source Files

| File | Location |
| --- | --- |
| Client-side upload JS | `musicbrainz-server/root/static/scripts/edit/MB/Art.js` |
| Server-side signing endpoint | `musicbrainz-server/lib/MusicBrainz/Server/Controller/WS/js.pm` → `_art_upload` |
| Userscript | `src/MusicBrainz Artwork Uploader Turbo.user.js` |

---

## Harmony Cover Art Seeding Integration

### Architecture & Responsibility Breakdown

- **Harmony (Server-Side / Deno Fresh)**:
  - Fetches streaming API metadata and renders cover previews using direct API responses (e.g., Spotify 640×640 `b273`, Tidal 1280×1280, Deezer 1000×1000).
  - Deterministically transforms known fixed patterns (e.g. Apple Music / iTunes thumbnail URLs to full-size PNGs).
- **ECAU (Client-Side Userscript)**:
  - Executes `HarmonySeeder.insertSeedLinks()`.
  - Runs `addDimensions()`, which probes uncompressed master candidate URLs via Image Max URL (e.g., Spotify `82c1` 2000×2000, Tidal `origin.jpg` 3000×3000).
  - Updates the figure's `<a href>` directly via `updateCoverUrl(fig, imageInfo.url)` once probing resolves.
  - Inserts formatted dimension / file size labels in `<figcaption>`.
- **Downstream Consumer Scripts (e.g. Falcon)**:
  - Scrapes `figure.cover-image a[href]` to obtain the full-resolution artwork without needing to duplicate provider-specific CDN maximisation logic.
