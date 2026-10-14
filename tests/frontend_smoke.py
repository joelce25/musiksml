"""Browser regression checks for persistence, real audio playback and WAV export.
Run with the repository Python dependencies and a Playwright/system Chromium.
An isolated local server starts automatically; external media responses are fixtures.
"""

import atexit
import io
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np
import soundfile as sf
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
temporary = tempfile.TemporaryDirectory(prefix="musiksml-browser-tests-")
ARTIFACTS = Path(temporary.name)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    PORT = sock.getsockname()[1]
BASE = f"http://127.0.0.1:{PORT}"
code = (
    "from server import app; from fastapi.staticfiles import StaticFiles; import uvicorn; app.mount('/', StaticFiles(directory='.', html=True)); uvicorn.run(app, host='127.0.0.1', port="
    + str(PORT)
    + ", log_level='warning')"
)
server = subprocess.Popen(
    [sys.executable, "-c", code],
    cwd=ROOT,
    env={
        **os.environ,
        "PYTHONDONTWRITEBYTECODE": "1",
        "NUMBA_CACHE_DIR": str(ARTIFACTS / "numba"),
    },
)


def cleanup():
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
    temporary.cleanup()


atexit.register(cleanup)
for _ in range(300):
    try:
        urllib.request.urlopen(BASE + "/openapi.json", timeout=1)
        break
    except (OSError, urllib.error.URLError):
        if server.poll() is not None:
            raise RuntimeError("The test API could not start")
        time.sleep(0.1)
else:
    raise RuntimeError("The test API did not become ready")
local_test = io.BytesIO()
sr_local = 22050
t_local = np.arange(sr_local * 20) / sr_local
signal_local = 0.2 * np.sin(2 * np.pi * 440 * t_local)
for offset in np.arange(0, 20, 0.5):
    i = int(offset * sr_local)
    signal_local[i : i + 1000] += (
        0.6
        * np.exp(-np.arange(1000) / 150)
        * np.sin(2 * np.pi * 100 * np.arange(1000) / sr_local)
    )
sf.write(local_test, signal_local, sr_local, format="WAV")

sr = 44100
fixtures = {}
for i, freq in enumerate([440, 660, 880]):
    buf = io.BytesIO()
    t = np.arange(sr * 6) / sr
    sf.write(buf, 0.2 * np.sin(2 * np.pi * freq * t), sr, format="WAV")
    fixtures[str(i)] = buf.getvalue()
tracks = [
    {
        "title": title,
        "artist": "Sesión de prueba",
        "url": f"https://www.youtube.com/watch?v=fixture{i}",
        "duration": 6,
        "bpm": 120 + i,
        "key": "8A",
    }
    for i, title in enumerate(["Luz de tarde", "Después del sol", "La noche sigue"])
]
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("MUSIKSML_CHROMIUM")
        or shutil.which("chromium")
        or p.chromium.executable_path,
        headless=True,
        args=["--no-sandbox"],
    )
    context = browser.new_context(
        viewport={"width": 1440, "height": 1000}, accept_downloads=True
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def route_api(route):
        url = route.request.url
        if "/api/analyze-local" in url:
            route.continue_()
        elif "/api/analyze" in url:
            route.fulfill(
                json={
                    "title": "Tardes sin prisa",
                    "tracks": tracks,
                    "type": "youtube_playlist",
                }
            )
        elif "/api/media" in url:
            key = next((str(i) for i in range(3) if f"fixture{i}" in url), "0")
            route.fulfill(
                body=fixtures[key],
                content_type="audio/wav",
                headers={"Access-Control-Allow-Origin": "*"},
            )
        else:
            route.continue_()

    page.route("**/api/**", route_api)
    page.goto(BASE + "/", wait_until="networkidle")
    # Follow system appearance until the user explicitly chooses a theme.
    page.emulate_media(color_scheme="dark")
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")
    expect(page.locator("#darkThemeBtn")).to_have_attribute("aria-pressed", "true")
    page.locator("#lightThemeBtn").click()
    page.emulate_media(color_scheme="light")
    page.emulate_media(color_scheme="dark")
    expect(page.locator("html")).to_have_attribute("data-theme", "light")
    page.locator("#darkThemeBtn").click()
    page.reload(wait_until="networkidle")
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")
    assert (
        page.locator('meta[name="theme-color"]').get_attribute("content") == "#171916"
    )
    other = context.new_page()
    other.goto(BASE + "/", wait_until="networkidle")
    expect(other.locator("html")).to_have_attribute("data-theme", "dark")
    page.locator("#lightThemeBtn").click()
    expect(other.locator("html")).to_have_attribute("data-theme", "light")
    other.close()
    print(
        "PASS system appearance, explicit theme choice, reload and cross-tab synchronization",
        flush=True,
    )
    page.get_by_role("button", name="Traer mi música").click()
    page.locator("#urlInput").fill("https://www.youtube.com/playlist?list=test-music")
    page.get_by_role("button", name="Importar música", exact=True).click()
    expect(page.locator("#currentImportTitle")).to_have_text("Tardes sin prisa")
    expect(page.locator("#importedTracksContainer .track-row")).to_have_count(3)
    page.get_by_role("button", name="Biblioteca 3", exact=True).click()
    expect(page.locator(".playlist-tile h3")).to_have_text("Tardes sin prisa")
    # The download action remains visible on a phone, including while loading.
    page.set_viewport_size({"width": 390, "height": 844})
    pending_downloads = []
    page.route("**/api/media*", lambda route: pending_downloads.append(route))
    button = page.locator("#libraryTracksContainer .download-track").first
    expect(button).to_be_visible()
    assert button.bounding_box()["height"] >= 44
    button.click()
    expect(button).to_have_attribute("aria-busy", "true")
    expect(button).to_be_disabled()
    page.wait_for_timeout(100)
    assert len(pending_downloads) == 1
    # Re-rendering a different view must preserve the pending state for that song.
    page.locator('.nav-link[data-view="importView"]').click()
    busy = page.locator('#importedTracksContainer .download-track[aria-busy="true"]')
    expect(busy).to_have_count(1)
    expect(busy).to_be_disabled()
    busy.evaluate("el => el.click()")
    assert len(pending_downloads) == 1
    with page.expect_download() as individual_download:
        pending_downloads[0].fulfill(body=fixtures["0"], content_type="audio/mpeg")
    assert individual_download.value.suggested_filename.endswith(".mp3")
    expect(busy).to_have_count(0)
    page.unroute("**/api/media*")
    # A failed download restores the control and shows a useful error.
    page.route(
        "**/api/media*",
        lambda route: route.fulfill(
            status=503, json={"detail": "Descarga de prueba no disponible"}
        ),
    )
    page.locator("#importedTracksContainer .download-track").first.click()
    expect(page.locator("#toastContainer")).to_contain_text(
        "Descarga de prueba no disponible"
    )
    expect(
        page.locator("#importedTracksContainer .download-track").first
    ).to_be_enabled()
    page.unroute("**/api/media*")
    page.set_viewport_size({"width": 1440, "height": 1000})
    print(
        "PASS mobile download, loading state across views, duplicate protection and error recovery",
        flush=True,
    )
    page.get_by_role("button", name="Importar", exact=True).click()
    expect(page.locator("#currentImportTitle")).to_have_text("Tardes sin prisa")
    page.reload(wait_until="networkidle")
    page.get_by_role("button", name="Importar", exact=True).click()
    expect(page.locator("#currentImportTitle")).to_have_text("Tardes sin prisa")
    page.get_by_role("button", name="Crear un mix").click()
    expect(page.locator("#mixQueueContainer .track-row")).to_have_count(3)
    print("PASS import, automatic named playlist save, navigation, reload", flush=True)
    page.locator(".trim-start").nth(0).fill("0:01")
    page.locator(".trim-start").nth(0).press("Tab")
    page.locator(".trim-end").nth(0).fill("0:04")
    page.locator(".trim-end").nth(0).press("Tab")
    page.locator(".trim-end").nth(1).fill("0:05")
    page.locator(".trim-end").nth(1).press("Tab")
    page.locator("#crossfadeSlider").fill("1")
    expect(page.locator("#mixDuration")).to_contain_text("0:12")
    page.locator("#mixNameInput").fill("Mi tarde")
    page.locator(".move-up").nth(2).click()
    expect(page.locator("#mixQueueContainer .track-title").nth(1)).to_have_text(
        "La noche sigue"
    )
    page.locator(".move-down").nth(1).click()
    page.reload(wait_until="networkidle")
    page.locator('.nav-link[data-view="mixView"]').click()
    expect(page.locator("#mixNameInput")).to_have_value("Mi tarde")
    expect(page.locator(".trim-start").nth(0)).to_have_value("0:01")
    expect(page.locator(".trim-end").nth(0)).to_have_value("0:04")
    expect(page.locator("#mixDuration")).to_contain_text("0:12")
    print("PASS queue order, trims, settings persistence", flush=True)
    page.locator("#startMixBtn").click()
    page.wait_for_function(
        'engine.track?.title === "Luz de tarde" && !engine.active.paused'
    )
    page.wait_for_function("engine.prepared !== null")
    page.wait_for_function("Boolean(engine.transition)", timeout=10000)
    page.locator("#playPauseBtn").click()
    page.wait_for_function("engine.active.paused && engine.transition?.incoming.paused")
    elapsed = page.evaluate("engine.transition.elapsed")
    page.wait_for_timeout(450)
    assert abs(page.evaluate("engine.transition.elapsed") - elapsed) < 0.11
    page.locator("#playPauseBtn").click()
    page.wait_for_function(
        'engine.track?.title === "Después del sol" && !engine.transition', timeout=10000
    )
    assert page.evaluate("!engine.active.paused")
    page.wait_for_function(
        'engine.track?.title === "La noche sigue" && !engine.transition', timeout=12000
    )
    page.wait_for_function("engine.active.paused", timeout=10000)
    assert page.evaluate("engine.track.title") == "La noche sigue"
    print(
        "PASS real media playback, automatic crossfade, pause/resume during fade, finite session end",
        flush=True,
    )
    with page.expect_download(timeout=30000) as download_info:
        page.locator("#exportMixBtn").click()
    download = download_info.value
    assert download.suggested_filename == "Mi tarde.wav"
    path = str(ARTIFACTS / "mix.wav")
    download.save_as(path)
    with wave.open(path) as audio:
        assert audio.getnchannels() == 2 and audio.getframerate() == 44100
        duration = audio.getnframes() / audio.getframerate()
        assert abs(duration - 12) < 0.02, duration
        pcm = np.frombuffer(
            audio.readframes(audio.getnframes()), dtype=np.int16
        ).reshape(-1, 2)
        assert np.max(np.abs(pcm.astype(np.int32))) <= 32113
        for position, freq in [(0.5, 440), (3.5, 660), (9, 880)]:
            chunk = pcm[int(position * sr) : int(position * sr) + sr // 2, 0]
            peak = np.argmax(abs(np.fft.rfft(chunk))) * sr / len(chunk)
            assert abs(peak - freq) < 4, (position, peak, freq)
    print(
        "PASS WAV export: stereo, 44.1kHz, exact trimmed duration, song order, no clipping",
        flush=True,
    )
    # Cancelling an export aborts the pending fetch and restores editable controls.
    page.evaluate(
        "document.getElementById('exportMixBtn').click(); document.getElementById('cancelExportBtn').click()"
    )
    page.wait_for_function("exportJob === null")
    expect(page.locator("#exportStatus")).to_contain_text("cancelada")
    expect(page.locator("#mixNameInput")).to_be_enabled()
    # Invalid fragments leave the previously valid saved value intact.
    page.locator(".trim-end").nth(0).fill("9:99")
    page.locator(".trim-end").nth(0).press("Tab")
    expect(page.locator(".trim-end").nth(0)).to_have_attribute("aria-invalid", "true")
    assert page.evaluate("state.queue[0].end") == 4
    page.reload(wait_until="networkidle")
    page.locator('.nav-link[data-view="mixView"]').click()
    # A broken media response must not silently change the playing song.
    page.route(
        "**/api/media*", lambda route: route.fulfill(status=500, body="unavailable")
    )
    page.locator("#startMixBtn").click()
    expect(page.locator("#toastContainer")).to_contain_text(
        "No se pudo cargar", timeout=15000
    )
    assert page.evaluate("engine.track === null && !engine.loading")
    page.unroute("**/api/media*")
    page.locator("#startMixBtn").click()
    page.wait_for_function('engine.track?.title === "Luz de tarde"')
    page.evaluate(
        "document.querySelectorAll('#mixQueueContainer .track-play')[2].click(); document.querySelectorAll('#mixQueueContainer .track-play')[1].click()"
    )
    page.wait_for_function(
        'engine.track?.title === "Después del sol" && !engine.loading'
    )
    assert page.evaluate("!engine.active.paused")
    page.locator("#playPauseBtn").click()
    print(
        "PASS cancellation, invalid trim protection, failed media recovery and rapid track switching",
        flush=True,
    )
    # Clearing an active session stops both decks only after accepting the dialog.
    page.locator("#playPauseBtn").click()
    page.wait_for_function("!engine.active.paused")
    page.locator("#clearQueueBtn").click()
    page.locator("#confirmCancelBtn").click()
    expect(page.locator("#mixQueueContainer .track-row")).to_have_count(3)
    page.locator("#clearQueueBtn").click()
    page.locator("#confirmAcceptBtn").click()
    page.wait_for_function("state.queue.length === 0 && engine.track === null")
    assert page.evaluate("engine.decks.every(d => d.paused)")
    expect(page.locator("#playerTitle")).to_have_text("Tu próxima favorita")
    print("PASS clear-session confirmation and playback cleanup", flush=True)
    page.locator('.nav-link[data-view="importView"]').click()
    page.locator("#sendAllToMixBtn").click()
    # Import through the real backend, then reload and play the file restored from IndexedDB.
    page.locator("#localFileInput").set_input_files(
        {
            "name": "Local prueba.wav",
            "mimeType": "audio/wav",
            "buffer": local_test.getvalue(),
        }
    )
    expect(page.locator("#currentImportTitle")).to_have_text(
        "Mis archivos", timeout=30000
    )
    page.reload(wait_until="networkidle")
    page.locator('.nav-link[data-view="importView"]').click()
    page.locator("#importedTracksContainer .track-play").click()
    page.wait_for_function(
        'engine.track?.title === "Local prueba" && !engine.active.paused'
    )
    assert page.evaluate('engine.active.src.startsWith("blob:")')
    print(
        "PASS real backend audio upload and local audio restored after reload",
        flush=True,
    )
    page.locator('.nav-link[data-view="mixView"]').click()
    page.screenshot(
        path=str(ARTIFACTS / "studio.png"), full_page=True, animations="disabled"
    )
    for theme in ["light", "dark"]:
        page.locator(f"#{theme}ThemeBtn").click()
        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({"width": width, "height": 900})
            for view in ["homeView", "importView", "libraryView", "mixView"]:
                page.locator(f'.nav-link[data-view="{view}"]').click()
                assert not page.evaluate(
                    "document.documentElement.scrollWidth > innerWidth"
                ), (theme, width, view)
                if view != "homeView":
                    root = {
                        "importView": "importedTracksContainer",
                        "libraryView": "libraryTracksContainer",
                        "mixView": "mixQueueContainer",
                    }[view]
                    row = page.locator(f"#{root} .track-row").first
                    expect(row.locator(".download-track")).to_be_visible()
                    assert row.locator(".download-track").bounding_box()["height"] >= 44
                    assert row.locator(".track-play").bounding_box()["width"] >= 44
                    assert (
                        row.locator(".track-title").evaluate(
                            "el => parseFloat(getComputedStyle(el).fontSize)"
                        )
                        >= 16
                    )
                    download_box = row.locator(".download-track").bounding_box()
                    assert (
                        download_box["x"] >= 0
                        and download_box["x"] + download_box["width"] <= width + 1
                    )
            if width == 390:
                page.screenshot(
                    path=str(ARTIFACTS / f"mobile-{theme}.png"),
                    full_page=True,
                    animations="disabled",
                )
    assert not errors, errors
    print(
        "PASS populated light/dark views at 320–1440 px, readable songs, touch targets and no JavaScript errors",
        flush=True,
    )
    legacy = browser.new_context()
    legacy.add_init_script(
        "localStorage.setItem('musiksml_clean_library_v3', JSON.stringify([{id:'old-song',title:'Mi canción anterior',artist:'Mi artista',bpm:100,key:'9A'}])); localStorage.setItem('musiksml_library', JSON.stringify([{title:'Backup anterior'}]))"
    )
    old_page = legacy.new_page()
    old_page.goto(BASE + "/", wait_until="networkidle")
    old_page.locator('.nav-link[data-view="libraryView"]').click()
    expect(old_page.locator("#libraryTracksContainer .track-title")).to_have_text(
        "Mi canción anterior"
    )
    assert old_page.evaluate('localStorage.getItem("musiksml_library") !== null')
    legacy.close()
    print("PASS legacy library migration without deleting previous storage", flush=True)
    browser.close()
