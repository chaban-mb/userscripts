# Violentmonkey `@updateURL`, `@downloadURL`, `custom.*`, and `lastInstallURL` Behavior

Research against Violentmonkey's source code (`violentmonkey/violentmonkey` on GitHub, `master` branch) and Greasy Fork's metadata handling, answering how update/install URLs behave during Greasy Fork installation, in-place `localhost` re-installation via `tools/dev_server.js`, "Track external edits", and subsequent `CheckUpdate` runs.

---

## 1. How Violentmonkey Stores Script Identity and Update URLs

When a script is installed or updated, `parseScript(src)` in [`src/background/utils/db.js`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/db.js#L652-L739) populates the `VMScript` object:

| Field | Source & Storage Behavior | Primary Source |
| :--- | :--- | :--- |
| `meta.updateURL` / `meta.downloadURL` | Parsed from the script's `// ==UserScript==` block by `parseMeta()` (`defaultMetaType`). On every `parseScript()` call, `script.meta = meta` **replaces** the entire `meta` object. | [`src/background/utils/db.js#L711`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/db.js#L711), [`src/background/utils/script.js#L66-L90`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/script.js#L66-L90), [`src/common/userscript-meta.js#L54-L60`](https://github.com/violentmonkey/violentmonkey/blob/master/src/common/userscript-meta.js#L54-L60) |
| `custom.updateURL` / `custom.downloadURL` | **Not** set during installation (`getDefaultCustom()` only sets `origInclude`, `origExclude`, `origMatch`, `origExcludeMatch`, `origTag`). Only populated if the user manually edits them in the script's **Settings** tab in Violentmonkey's dashboard. | [`src/background/utils/script.js#L107-L115`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/script.js#L107-L115), [`src/options/views/edit/settings.vue#L69,L141-L150`](https://github.com/violentmonkey/violentmonkey/blob/master/src/options/views/edit/settings.vue#L141-L150) |
| `custom.lastInstallURL` | Set by `if (isValidHttpUrl(src.url)) custom.lastInstallURL = src.url;`. `isValidHttpUrl` matches any `http://` or `https://` URL that parses via `new URL()`. | [`src/background/utils/db.js#L717-L718`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/db.js#L717-L718), [`src/common/util.js#L244,L292`](https://github.com/violentmonkey/violentmonkey/blob/master/src/common/util.js#L292) |
| `props.uri` | **Not a URL.** Computed by `getNameURI(script)` as `encodeFilename(\`${ns}\n${name}\n\`)` from `@namespace` and `@name`. Used solely to match existing scripts for in-place updates (`getScript({ id, meta })`). | [`src/background/utils/db.js#L293-L299,L712`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/db.js#L712), [`src/background/utils/script.js#L148-L154`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/script.js#L148-L154) |

### Greasy Fork Install Case

- When installing from Greasy Fork, `src.url` is the Greasy Fork `.user.js` download URL (e.g., `https://update.greasyfork.org/scripts/...` or `https://greasyfork.org/scripts/...`), so `custom.lastInstallURL` is set to that Greasy Fork URL.
- Note on Greasy Fork itself: Greasy Fork normally strips/rewrites `@updateURL` and `@downloadURL` in served scripts to point to `update.greasyfork.org` (unless the script is served without rewriting). Whatever `@updateURL` / `@downloadURL` appears in the served file ends up in `meta.updateURL` / `meta.downloadURL`, while `custom.updateURL` and `custom.downloadURL` remain `undefined`.

---

## 2. In-Place Update & "Track external edits" from `http://localhost:8080/...`

When the user clicks **"Track in Violentmonkey"** from `http://localhost:8080/<script>.user.js` (same `@name` and `@namespace`) and enables **"Track external edits"**:

1. **Why `localhost` allows tracking:**
   In [`src/confirm/views/app.vue#L161`](https://github.com/violentmonkey/violentmonkey/blob/master/src/confirm/views/app.vue#L161), `isLocal` is `!isRemote(info.value.url)`. In [`src/common/util.js#L245-L259,L293`](https://github.com/violentmonkey/violentmonkey/blob/master/src/common/util.js#L245-L259), `isLocalUrlRe` explicitly matches `http://localhost` (and `127.0.0.1`, private IPs, `.localhost`), so `isLocal` is `true` and "Track external edits" is enabled.

2. **What gets overwritten during install & polling:**
   Both the initial click and every 500ms poll in `trackLocalFile()` → `onFileChanged()` → `installScript()` ([`src/confirm/views/app.vue#L453-L526`](https://github.com/violentmonkey/violentmonkey/blob/master/src/confirm/views/app.vue#L453-L526)) call `ParseScript` with `url: infoVal.url` (`http://localhost:8080/<script>.user.js`).
   Inside `parseScript(src)` ([`src/background/utils/db.js#L663-L718`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/db.js#L663-L718)):
   - `getScript({ id, meta })` matches the existing Greasy Fork script via `props.uri` (`@name` + `@namespace`).
   - `script.meta = meta` (`db.js:711`) **overwrites** `meta.updateURL` and `meta.downloadURL` with whatever is in the `localhost` script's metadata block (e.g., hardcoded GitHub URLs).
   - `if (isValidHttpUrl(src.url)) custom.lastInstallURL = src.url` (`db.js:718`) **overwrites** `custom.lastInstallURL` with `http://localhost:8080/<script>.user.js`! The source code even has an explicit comment on line 717:

     ```js
     // Allowing any http url including localhost as the user may keep multiple scripts there
     if (isValidHttpUrl(src.url)) custom.lastInstallURL = src.url;
     ```

   - **The original Greasy Fork `lastInstallURL` is NOT preserved.**
   - `custom.updateURL` and `custom.downloadURL` are untouched (if the user never edited them in Settings, they remain `undefined`).

3. **Which URL wins when `CheckUpdate` runs later:**
   `checkUpdate()` in [`src/background/utils/update.js#L55-L77`](https://github.com/violentmonkey/violentmonkey/blob/master/src/background/utils/update.js#L55-L77) resolves the URLs via `getScriptUpdateUrl(script, urlOpts)` in [`src/common/script.js#L94-L106`](https://github.com/violentmonkey/violentmonkey/blob/master/src/common/script.js#L94-L106):

   ```js
   const downloadURL = tryUrl(custom.downloadURL || meta.downloadURL || custom.lastInstallURL);
   const updateURL = tryUrl(custom.updateURL || meta.updateURL || downloadURL);
   ```

   The strict precedence order is:
   - **`downloadURL`**: `custom.downloadURL` → `meta.downloadURL` → `custom.lastInstallURL`
   - **`updateURL`**: `custom.updateURL` → `meta.updateURL` → `downloadURL`

   Therefore:
   - Because `tools/dev_server.js` preserves the script's `@updateURL` and `@downloadURL` (pointing to GitHub), **`meta.downloadURL` and `meta.updateURL` (GitHub) win** over `custom.lastInstallURL` (`http://localhost:8080/...`) during `CheckUpdate` (unless the user manually set `custom.downloadURL` / `custom.updateURL` in Settings).

---

## 3. Would Omitting `@updateURL` and `@downloadURL` in `tools/dev_server.js` Preserve the Greasy Fork URL?

**No — omitting them would not preserve the Greasy Fork URL and would actually break upstream updates.**

1. `parseScript` (`db.js:711`) replaces `script.meta = meta` wholesale, so omitting `@updateURL` and `@downloadURL` from the `localhost`-served script sets `meta.updateURL` and `meta.downloadURL` to `undefined`.
2. `parseScript` (`db.js:718`) still overwrites `custom.lastInstallURL` with `http://localhost:8080/<script>.user.js`, because `isValidHttpUrl` accepts `http://localhost:...`.
3. `props.uri` is only `@namespace` + `@name` (`getNameURI`), not a URL.
4. As a result, when `CheckUpdate` runs later, `getScriptUpdateUrl` (`src/common/script.js:101-102`) falls back to `custom.lastInstallURL` — which is now **`http://localhost:8080/<script>.user.js`** instead of Greasy Fork or GitHub.

Keeping `@updateURL` and `@downloadURL` in `tools/dev_server.js` (pointing to the canonical upstream GitHub URLs) is therefore the right behavior: it ensures `meta.updateURL` / `meta.downloadURL` shadow the overwritten `localhost` `custom.lastInstallURL`. If a user specifically wants updates from Greasy Fork after local tracking, they must either set `custom.updateURL` / `custom.downloadURL` in Violentmonkey's script Settings UI or reinstall from Greasy Fork when finished developing.
