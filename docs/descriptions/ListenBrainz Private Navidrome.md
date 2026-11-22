Connects ListenBrainz's built-in **BrainzPlayer** directly to a private, Tailscale-isolated, or LAN-hosted **Navidrome** (or Subsonic-compatible) server without exposing your server to the public internet or sharing your real credentials with ListenBrainz's backend.

### Why This Is Needed

ListenBrainz uses a hybrid architecture for Navidrome:

- **Setup & Validation (Server-Side):** When connecting a Navidrome instance in ListenBrainz Settings, ListenBrainz's backend performs a server-side `GET /rest/ping` check before saving. If your server lives exclusively inside a private network (e.g., a Tailscale tailnet, WireGuard VPN, or local LAN), this check fails and prevents enabling Navidrome in BrainzPlayer.
- **BrainzPlayer Playback (100% Client-Side):** Once enabled, all track searches (`/rest/search3`), cover art (`/rest/getCoverArt`), and audio streaming (`/rest/stream`) happen **directly between your web browser and your Navidrome server**.

This userscript intercepts ListenBrainz's `<script id="global-react-props">` payload at `document-start` before React hydrates and replaces the dummy server details with your private Navidrome URL and locally generated Subsonic MD5 token stored in script-scoped `GM.getValue` / `GM.setValue` storage.

### Setup Instructions

#### 1. Unlock Navidrome in ListenBrainz Settings (Dummy Public Server)

To satisfy ListenBrainz's backend `/rest/ping` validation and unlock the BrainzPlayer toggle without exposing your real server:

1. Open **[ListenBrainz Music Services Settings](https://listenbrainz.org/settings/music-services/details/)**.
2. In the **Navidrome** section, enter the official public Navidrome demo credentials:
   - **Navidrome Server URL:** `https://demo.navidrome.org`
   - **Username:** `demo`
   - **Password:** `demo`
3. Click **Connect to Navidrome**.
4. Open **[BrainzPlayer Settings](https://listenbrainz.org/settings/brainzplayer/)**, ensure **Navidrome** is toggled **ON**, drag it to the top of your priority list, and click **Save**.

#### 2. Generate Your Local Subsonic Auth Config (Python One-Liner)

Subsonic API token authentication (`t = md5(password + salt)`) does not expire as long as your password remains unchanged. Run the following Python 3 one-liner locally in your terminal—your password is hidden via `getpass`, never leaves your machine, and the generated JSON is **automatically copied to your clipboard** (via `clip` on Windows, `pbcopy` on macOS, or `wl-copy` / `xclip` / `xsel` on Linux):

**Linux / macOS / Bash:**

```bash
python3 -c 'import getpass, hashlib, json, secrets, shutil, subprocess; u = input("Navidrome URL: ").strip().rstrip("/"); n = input("Username: ").strip(); p = getpass.getpass("Password: "); s = secrets.token_hex(6); t = hashlib.md5((p + s).encode()).hexdigest(); j = json.dumps({"instance_url": u, "username": n, "salt": s, "md5_auth_token": t}); c = next((cmd for cmd in (["pbcopy"], ["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"], ["clip"]) if shutil.which(cmd[0])), None); r = subprocess.run(c, input=j.encode(), check=False) if c else None; print("\n" + j + ("\n(Copied to clipboard!)" if r and r.returncode == 0 else ""))'
```

**Windows (PowerShell / CMD):**

```powershell
python -c "import getpass, hashlib, json, secrets, shutil, subprocess; u = input('Navidrome URL: ').strip().rstrip('/'); n = input('Username: ').strip(); p = getpass.getpass('Password: '); s = secrets.token_hex(6); t = hashlib.md5((p + s).encode()).hexdigest(); j = json.dumps({'instance_url': u, 'username': n, 'salt': s, 'md5_auth_token': t}); c = next((cmd for cmd in (['clip'], ['pbcopy'], ['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']) if shutil.which(cmd[0])), None); r = subprocess.run(c, input=j.encode(), check=False) if c else None; print('\n' + j + ('\n(Copied to clipboard!)' if r and r.returncode == 0 else ''))"
```

The JSON object is automatically copied to your clipboard (and printed in the terminal as a fallback).

#### 3. Configure the Userscript

1. Open any page on **[listenbrainz.org](https://listenbrainz.org/)**.
2. Click your userscript manager extension icon (Violentmonkey / Tampermonkey) and select **`Configure Private Navidrome...`**.
3. Paste (`Ctrl+V` / `Cmd+V`) the JSON string generated in Step 2 into the prompt and click **OK** (or submit an empty prompt to clear your configuration).
4. The page will reload automatically and BrainzPlayer will now stream directly from your private Navidrome instance.

### Caveats & Technical Requirements

- **HTTPS Required (Mixed Content):** Because `https://listenbrainz.org` is served over HTTPS, modern browsers block plain `http://` subresource `fetch()` and `<audio>` requests as Mixed Content (with the exception of `http://localhost` / `http://127.0.0.1`). Your private Navidrome URL must use `https://` with a browser-trusted TLS certificate—for Tailscale, enable MagicDNS HTTPS certificates and use `tailscale serve` or Tailscale Services (`https://navidrome.<tailnet>.ts.net`).
- **CORS Headers:** Navidrome automatically sets `Access-Control-Allow-Origin: *` on `/rest/*` endpoints, which is required for cross-origin browser `fetch()` and `<audio crossOrigin="anonymous">` playback. Ensure any reverse proxy in front of Navidrome preserves these headers.
- **Chromium Private Network Access (PNA):** Tailscale CGNAT addresses (`100.64.0.0/10`) are outside RFC1918 private ranges and are not blocked by Chromium's Private Network Access checks. If you connect to a raw LAN IP (`192.168.x.x` / `10.x.x.x`), Chromium-based browsers may display a local network access permission prompt or require the `Access-Control-Allow-Private-Network: true` response header.
- **Server-Side "Import Starred Tracks" Won't Sync:** Because ListenBrainz's backend only stores the dummy `demo.navidrome.org` connection, the server-side *"Import loved tracks from Navidrome"* button in Music Services settings cannot reach your private server. Real-time listen submission (scrobbling) when playing tracks in BrainzPlayer happens client-side from your browser and works normally.
- **Password Changes:** Because the Subsonic token is derived from `md5(password + salt)`, changing your Navidrome password invalidates the stored token. Re-run the Python one-liner and update **`Configure Private Navidrome...`** whenever you change your password.
