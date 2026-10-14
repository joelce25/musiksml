# musiksml

The static frontend runs on Vercel. FastAPI, FFmpeg, Chromium and the YouTube token provider run together on Railway using `Dockerfile` and `railway.toml`.

## Railway

The Docker image pins the official yt-dlp nightly **2026.10.10.233141**, verifies its SHA-256, and installs version **2.0.2** of both the Python token plugin and its HTTP server. This extractor includes the maintained `tv_samsung` client and updated authenticated defaults. Node 24 and Deno are included. `python scripts/start.py` starts the provider, verifies its version, then starts the API. If either process stops, the container exits so Railway can restart it.

`/api/health` reports installed versions, runtime availability, token-server compatibility, cookie status and whether an explicit YouTube proxy is configured. It never returns credential values. `/api/debug-cookies` preserves the existing cookie diagnostic API. Session-cookie detection is a heuristic; only a successful YouTube request proves usable access.

Optional variables, configured securely in Railway:

- `YOUTUBE_COOKIES_B64`: Base64 of a valid Netscape cookie file. Whitespace in Base64 is accepted. Changes refresh the cookie file atomically. Expired cookies are reported. Cookies can still be rejected by YouTube.
- `YOUTUBE_COOKIES_FILE`: A mounted Netscape cookie file, when not using Base64.
- `YOUTUBE_PROXY`: An HTTP/HTTPS proxy URL for YouTube traffic, including proxy authentication if needed. This is a server environment credential, not a frontend setting. Configure it only when an authorized, functioning outbound route is available. The same route is passed to the token provider for consistent token binding. A blocked datacenter IP cannot be made reliable merely by adding token libraries or retrying stale cookies.
- `YOUTUBE_PLAYER_CLIENTS`: Optional override of comma-separated supported yt-dlp clients. Leave unset to use yt-dlp's maintained defaults, selected according to authentication and available runtimes.
- `DOWNLOAD_DIR`: Default `downloads`. For retained audio across redeployments, mount a Railway volume and point this variable to its downloads directory. The code does not create a Railway volume.
- `YOUTUBE_POT_BASE_URL`: Defaults to the supervised local provider at `http://127.0.0.1:4416`. An external provider must match the plugin version.

Public video imports use YouTube's official oEmbed metadata when available, so a streaming challenge does not unnecessarily block importing a title. Playlist imports and song searches use flat metadata extraction. They do not require cookies for public content. Restricted content and IP-based restrictions can still require outside configuration.

The audio cache is checked before remote extraction. Resolved searches are saved so repeat downloads can use the cache without contacting YouTube. Audio extraction and conversion happen once, under a per-video lock and a two-download concurrency limit. Downloads support ranges and Unicode filenames. API failures expose a safe error code and actionable message, never a raw proxy credential or cookie value.

Spotify reads wait for document content and captured playlist data, instead of `networkidle`. A playlist with no readable tracks returns an error instead of being presented as one song.

## Development and validation

Use Python 3.11, install `requirements.txt` and `tests/requirements.txt`, and ensure FFmpeg is on PATH. For deployed service testing:

```sh
docker build -t musiksml .
docker run --rm -p 127.0.0.1:8000:8000 musiksml
```

Configure credentials as server variables; never commit `.env` or cookie files.

```sh
python -m pytest tests/test_youtube_service.py -q
python tests/frontend_smoke.py
```

Unit tests use controlled extractor responses to exercise actual cache, cookie handling, request validation, errors and HTTP file serving. Browser tests verify the frontend and local upload through FastAPI. Neither replaces testing a public YouTube video and playlist from the actual Railway instance. Verify an uncached MP3 download as well as imports before claiming full YouTube readiness.
