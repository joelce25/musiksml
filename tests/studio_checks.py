"""Regressions for the studio, canonical song identities and failed artwork."""

import io
import wave
from contextlib import suppress

import numpy as np
import soundfile as sf
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect


def run_studio_checks(browser, base, fixtures, artifacts):
    context = browser.new_context(
        viewport={"width": 1440, "height": 1100}, accept_downloads=True
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    lookups = []
    cover = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#b6d3c1"/><circle cx="100" cy="100" r="60" fill="#507369"/></svg>'
    shared = {
        "title": "Una canción compartida",
        "artist": "Artista",
        "duration": 6,
        "source": "Spotify",
        "thumbnail": base + "/broken-cover.jpg",
    }

    def route_api(route):
        url = route.request.url
        if "/api/analyze" in url:
            link = route.request.post_data_json["url"]
            first = "first" in link
            tracks = [
                {**shared, "uid": "entry-first" if first else "entry-second"},
                {
                    "uid": "only-first" if first else "only-second",
                    "title": "Primera" if first else "Segunda",
                    "artist": "Artista",
                    "duration": 6,
                    "source": "Spotify",
                    "thumbnail": "",
                },
            ]
            route.fulfill(
                json={
                    "title": "Primera colección" if first else "Segunda colección",
                    "type": "spotify_playlist",
                    "tracks": tracks,
                }
            )
        elif "/api/artwork" in url:
            lookups.append(url)
            route.fulfill(json={"url": base + "/recovered-cover.svg"})
        elif "/api/media" in url:
            key = next((key for key in fixtures if f"fixture{key}" in url), "0")
            route.fulfill(body=fixtures[key], content_type="audio/wav")
        else:
            route.continue_()

    page.route("**/api/**", route_api)
    page.route(
        "**/broken-cover.jpg", lambda route: route.fulfill(status=404, body="missing")
    )
    page.route(
        "**/recovered-cover.svg",
        lambda route: route.fulfill(body=cover, content_type="image/svg+xml"),
    )
    page.route(
        "https://i.ytimg.com/**",
        lambda route: route.fulfill(status=404, body="missing"),
    )
    page.goto(base + "/", wait_until="networkidle")
    for collection in ["first", "second"]:
        page.locator('.nav-link[data-view="importView"]').click()
        page.locator("#urlInput").fill(
            f"https://open.spotify.com/playlist/{collection}"
        )
        page.locator("#analyzeBtn").click()
        expect(page.locator("#currentImportTitle")).to_have_text(
            "Primera colección" if collection == "first" else "Segunda colección"
        )
    page.locator('.nav-link[data-view="libraryView"]').click()
    expect(page.locator("#libraryTracksContainer .track-row")).to_have_count(3)
    expect(page.locator(".playlist-tile")).to_have_count(2)
    assert page.evaluate("state.playlists.every(p => p.trackIds.length === 2)")
    assert page.evaluate(
        "state.playlists[0].trackIds[0] === state.playlists[1].trackIds[0]"
    )
    shared_row = page.locator("#libraryTracksContainer .track-row").filter(
        has_text="Una canción compartida"
    )
    expect(shared_row.locator(".track-art img")).to_have_attribute(
        "src", base + "/recovered-cover.svg"
    )
    shared_row.hover()
    expect(shared_row.locator(".track-preview")).to_be_visible()
    assert (
        shared_row.locator(".track-preview").evaluate(
            "el => getComputedStyle(el).visibility"
        )
        == "visible"
    )
    page.reload(wait_until="networkidle")
    page.locator('.nav-link[data-view="libraryView"]').click()
    expect(page.locator("#libraryTracksContainer .track-row")).to_have_count(3)
    print(
        "PASS shared Spotify song appears once, both playlists retain it, artwork recovery and hover details",
        flush=True,
    )

    # Simulate the old, playlist-dependent IDs to verify reference migration.
    legacy = {
        "library": [
            {**shared, "id": "old-first"},
            {**shared, "id": "old-second", "thumbnail": base + "/recovered-cover.svg"},
        ],
        "playlists": [
            {"id": "one", "title": "Uno", "trackIds": ["old-first"]},
            {"id": "two", "title": "Dos", "trackIds": ["old-second", "old-second"]},
        ],
        "favorites": ["old-second"],
        "queue": [{"track": {**shared, "id": "old-second"}, "start": 1, "end": 4}],
    }
    page.evaluate(
        "data => localStorage.setItem(STORAGE_KEY, JSON.stringify(data))", legacy
    )
    page.reload(wait_until="networkidle")
    assert page.evaluate(
        "state.library.length === 1 && state.favorites[0] === state.library[0].id && state.playlists.every(p => p.trackIds[0] === state.library[0].id && p.trackIds.length === 1)"
    )
    assert page.evaluate("state.queue[0].start === 1 && state.queue[0].end === 4")
    print(
        "PASS duplicate migration preserves favorites, playlist membership and existing trims",
        flush=True,
    )

    def seed_queue(queue, fade=6):
        page.evaluate(
            "({queue,fade}) => {engine.stop(); state.queue=queue.map(q=>({...q,track:normalizeTrack(q.track)})); state.fade=fade; state.automix=true; persist(); syncSettings(); switchView('mixView');}",
            {"queue": queue, "fade": fade},
        )

    def track(index, duration=6):
        return {
            "title": f"Fragmento {index}",
            "artist": "Prueba de estudio",
            "url": f"https://www.youtube.com/watch?v=fixture{index}",
            "duration": duration,
        }

    # Unknown YouTube durations must fill in the end without first pressing play.
    seed_queue([{"track": track(0, 0), "start": 0, "end": None}])
    page.wait_for_function(
        "state.queue[0].track.duration > 5.9 && activeAnalyses === 0"
    )
    expect(page.locator(".trim-end")).to_have_value("0:06")
    expect(page.locator(".waveform svg line")).to_have_count(192)
    page.locator(".trim-start").fill("1.25")
    page.locator(".trim-start").press("Tab")
    page.locator(".trim-end").fill("4.75")
    page.locator(".trim-end").press("Tab")
    assert page.evaluate("state.queue[0].start === 1.25 && state.queue[0].end === 4.75")
    page.reload(wait_until="networkidle")
    page.locator('.nav-link[data-view="mixView"]').click()
    expect(page.locator(".trim-start")).to_have_value("0:01.25")
    expect(page.locator(".trim-end")).to_have_value("0:04.75")
    page.locator(".start-range").fill("2.5")
    page.locator(".end-range").fill("5")
    assert page.evaluate("state.queue[0].start === 2.5 && state.queue[0].end === 5")
    page.locator(".wave-seek").fill("3.2")
    page.wait_for_function(
        "engine.track?.title === 'Fragmento 0' && engine.active.currentTime >= 3.1 && !engine.active.paused"
    )
    print(
        "PASS automatic unknown duration, real waveform, precise seconds, sliders and reload",
        flush=True,
    )

    # An outgoing six-second song must reach its tail before fading into 0.8 s.
    seed_queue(
        [
            {"track": track(0), "start": 0, "end": 6},
            {"track": track(1), "start": 1, "end": 1.8},
        ]
    )
    page.locator("#startMixBtn").click()
    page.wait_for_function("engine.prepared !== null")
    page.wait_for_function("Boolean(engine.transition)", timeout=12000)
    assert page.evaluate("engine.transition.outgoing.currentTime >= 5.5"), (
        "The old trigger cut off the outgoing song at 3.4 s"
    )
    assert abs(page.evaluate("engine.transition.duration") - 0.4) < 0.1
    page.wait_for_function("engine.track.title === 'Fragmento 1' && !engine.transition")
    page.wait_for_function("engine.active.paused")
    with page.expect_download() as exported:
        page.locator("#exportMixBtn").click()
    path = str(artifacts / "uneven-fragments.wav")
    exported.value.save_as(path)
    with wave.open(path) as audio:
        assert abs(audio.getnframes() / audio.getframerate() - 6.4) < 0.02
    print(
        "PASS short incoming fragment preserves outgoing tail; preview and WAV share the same overlap",
        flush=True,
    )

    seed_queue(
        [
            {"track": track(0), "start": 0, "end": 6, "fadeOut": 1},
            {"track": track(1), "start": 0, "end": 6},
        ]
    )
    page.locator(".preview-bridge").click()
    page.wait_for_function("Boolean(engine.transition)", timeout=12000)
    assert page.evaluate(
        "engine.transition.outgoing.currentTime >= 4.9 && engine.transition.duration <= 1.01"
    )
    page.wait_for_function(
        "engine.track?.title === 'Fragmento 1' && !engine.transition"
    )
    print(
        "PASS waveform seeking and dedicated transition preview load and play the selected seconds",
        flush=True,
    )

    # The manual fader holds two real media decks and uses equal-power gains.
    seed_queue(
        [
            {"track": track(0), "start": 0, "end": 6},
            {"track": track(1), "start": 0, "end": 6},
        ]
    )
    page.locator("#startMixBtn").click()
    page.wait_for_function("engine.prepared !== null && !engine.active.paused")
    page.locator("#cueNextMixBtn").click()
    page.wait_for_function("engine.transition?.manual === true")
    page.locator("#manualCrossfader").fill("50")
    page.wait_for_timeout(130)
    values = page.evaluate(
        "[engine.nodes.get(engine.transition.outgoing).gain.value, engine.nodes.get(engine.transition.incoming).gain.value]"
    )
    assert all(abs(value - 2**-0.5) < 0.06 for value in values), values
    page.locator("#playPauseBtn").click()
    page.wait_for_function("engine.active.paused && engine.transition.incoming.paused")
    assert page.evaluate("engine.transition.position === 0.5")
    page.locator("#playPauseBtn").click()
    page.locator("#manualCrossfader").fill("100")
    page.wait_for_function("engine.track.title === 'Fragmento 1' && !engine.transition")
    assert page.evaluate("!engine.active.paused")
    page.locator("#playPauseBtn").click()
    print(
        "PASS manual two-deck crossfader, equal-power gains, pause/resume and B handover",
        flush=True,
    )

    # Real samples with silence and different levels exercise preparation and export.
    sr = 44100
    for index, amplitude in [(3, 0.3), (4, 0.15)]:
        samples = np.zeros(sr * 6)
        t = np.arange(sr * 3) / sr
        samples[sr : sr * 4] = amplitude * np.sin(
            2 * np.pi * (440 if index == 3 else 660) * t
        )
        buf = io.BytesIO()
        sf.write(buf, samples, sr, format="WAV")
        fixtures[str(index)] = buf.getvalue()
    seed_queue(
        [
            {"track": track(3), "start": 0, "end": None},
            {"track": track(4), "start": 0, "end": None},
        ]
    )
    page.locator("#prepareMixBtn").click()
    page.wait_for_function(
        "studioJob === null && state.queue.every(q => q.autoPrepared)"
    )
    analysis = page.evaluate(
        "state.queue.map(q=>({start:q.start,end:q.end,gain:q.track.analysis.gain,fade:q.fadeOut,peaks:q.track.analysis.peaks.length}))"
    )
    assert all(
        0.9 < row["start"] < 1.05 and 4 <= row["end"] < 4.2 and row["peaks"] == 192
        for row in analysis
    ), analysis
    assert abs(analysis[1]["gain"] / analysis[0]["gain"] - 2) < 0.04, analysis
    assert analysis[0]["fade"] == 4
    page.locator(".trim-start").first.fill("1.5")
    page.locator(".trim-start").first.press("Tab")
    page.locator(".clip-fade").first.fill("0.5")
    page.locator("#prepareMixBtn").click()
    page.wait_for_function("studioJob === null")
    assert page.evaluate(
        "state.queue[0].start === 1.5 && state.queue[0].fadeOut === 0.5"
    )
    total = page.evaluate("sessionDuration()")
    with page.expect_download() as prepared_export:
        page.locator("#exportMixBtn").click()
    path = str(artifacts / "prepared-mix.wav")
    prepared_export.value.save_as(path)
    with wave.open(path) as audio:
        assert abs(audio.getnframes() / audio.getframerate() - total) < 0.03
        pcm = np.frombuffer(
            audio.readframes(audio.getnframes()), dtype=np.int16
        ).reshape(-1, 2)
    early = pcm[int(sr * 0.3) : int(sr * 0.8), 0].astype(float)
    late = pcm[int(sr * (total - 0.8)) : int(sr * (total - 0.3)), 0].astype(float)
    assert abs(np.sqrt(np.mean(early**2)) / np.sqrt(np.mean(late**2)) - 1) < 0.05
    print(
        "PASS real silence detection, volume matching, custom cuts and transitions preserved, accurate WAV",
        flush=True,
    )
    prepared_queue = page.evaluate("state.queue")

    # Reliable beat evidence is required: a constant tone must not acquire a BPM.
    for index, rhythmic in [(6, True), (7, False)]:
        t = np.arange(sr * 20) / sr
        samples = 0.1 * np.sin(2 * np.pi * 440 * t)
        if rhythmic:
            for offset in np.arange(0, 20, 0.5):
                start = int(offset * sr)
                pulse = np.arange(2200)
                samples[start : start + len(pulse)] += (
                    0.6 * np.exp(-pulse / 300) * np.sin(2 * np.pi * 100 * pulse / sr)
                )
        buf = io.BytesIO()
        sf.write(buf, samples, sr, format="WAV")
        fixtures[str(index)] = buf.getvalue()
        analysis = page.evaluate(
            "async track => (await analyzeTrack(normalizeTrack(track)))",
            track(index, 20),
        )
        if rhythmic:
            assert abs(analysis["bpm"] - 120) <= 2, analysis["bpm"]
        else:
            assert analysis["bpm"] is None, analysis["bpm"]
    print(
        "PASS measured tempo from real beats; sustained audio does not receive a fabricated BPM",
        flush=True,
    )

    # Preparation cancellation must abort an in-flight audio request and unlock export.
    pending = []
    page.route("**/api/media*", lambda route: pending.append(route))
    seed_queue([{"track": track(5), "start": 0, "end": None}])
    page.locator("#prepareMixBtn").click()
    page.wait_for_function("studioJob !== null")
    page.locator("#cancelPrepareBtn").click()
    page.wait_for_function("studioJob === null && activeAnalyses === 0")
    expect(page.locator("#prepareStatus")).to_contain_text("cancelada")
    expect(page.locator("#exportMixBtn")).to_be_enabled()
    page.unroute("**/api/media*")
    for route in pending:
        with suppress(PlaywrightError):
            route.abort()
    print(
        "PASS cancel preparation aborts audio loading and restores controls", flush=True
    )

    seed_queue(prepared_queue)
    for theme in ["light", "dark"]:
        page.locator(f"#{theme}ThemeBtn").click()
        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({"width": width, "height": 1000})
            assert not page.evaluate(
                "document.documentElement.scrollWidth > innerWidth"
            ), (theme, width)
            for control in [
                ".trim-start",
                ".trim-end",
                ".preview-intro",
                ".preview-outro",
                ".prepare-clip",
                "#prepareMixBtn",
                "#manualCrossfader",
            ]:
                box = page.locator(control).first.bounding_box()
                assert box and box["x"] >= 0 and box["x"] + box["width"] <= width + 1, (
                    theme,
                    width,
                    control,
                    box,
                )
                assert box["height"] >= 44, (control, box)
            if width in [390, 1440]:
                page.screenshot(
                    path=str(artifacts / f"studio-{theme}-{width}.png"),
                    full_page=True,
                    animations="disabled",
                )
    page.emulate_media(reduced_motion="reduce")
    assert not errors, errors
    print(
        "PASS expanded studio in both themes at 320–1440 px, touch controls and no JavaScript errors",
        flush=True,
    )
    context.close()
