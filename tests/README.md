# Frontend checks

With the project's Python dependencies installed and either Playwright Chromium or system Chromium available:

```sh
python tests/frontend_smoke.py
```

Set `MUSIKSML_CHROMIUM` to use a specific browser executable. The test starts and stops its own local FastAPI/static server and uses temporary files and a fresh browser profile. It leaves repository files unchanged.

It checks named playlist persistence, navigation and reload, queue ordering and trims, real two-deck audio playback, pausing a crossfade, finite session completion, cancellation and loading failures, local audio persistence through IndexedDB, legacy library migration, and responsive layouts. It downloads and inspects a rendered WAV for duration, channel count, song order and clipping. Local upload uses the actual API; remote Spotify/YouTube responses use deterministic audio fixtures, so the test does not require live external services.

Appearance checks cover following the system theme, explicit light/dark choices, persistence after reload and synchronization across tabs. Download checks cover phone visibility, loading feedback across views, duplicate protection and recovery after a failed request.
