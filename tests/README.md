# Frontend checks

With the project's Python dependencies installed and either Playwright Chromium or system Chromium available:

```sh
python tests/frontend_smoke.py
```

Set `MUSIKSML_CHROMIUM` to use a specific browser executable. The test starts and stops its own local FastAPI/static server and uses temporary files and a fresh browser profile. It leaves repository files unchanged.

It checks named playlist persistence, navigation and reload, queue ordering and trims, real two-deck audio playback, pausing a crossfade, finite session completion, cancellation and loading failures, local audio persistence through IndexedDB, legacy library migration, and responsive layouts. It downloads and inspects a rendered WAV for duration, channel count, song order and clipping. Local upload uses the actual API; remote Spotify/YouTube responses use deterministic audio fixtures, so the test does not require live external services.

Appearance checks cover following the system theme, explicit light/dark choices, persistence after reload and synchronization across tabs. Download checks cover phone visibility, loading feedback across views, duplicate protection and recovery after a failed request.

Studio regressions additionally import overlapping Spotify playlists, migrate duplicate IDs while retaining favorites and trims, recover failed cover images, resolve unknown audio durations before playback, edit fractional seconds and range controls, and exercise a manual two-deck crossfader. Unequal fragment lengths verify that a long outgoing song retains its tail and that live playback and WAV export use the same overlap. Real audio fixtures test silence detection, level matching, reliable tempo detection, cancellation, and preservation of manual edits.

For just these studio regressions, run `python tests/frontend_smoke.py --studio-only`. Set `MUSIKSML_ARTIFACTS` to a directory outside the checkout to retain screenshots and rendered test WAV files for review.
