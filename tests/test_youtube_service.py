import base64
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import server
import youtube_service as ys

ID = "xYQgNZ14G_Q"
URL = f"https://www.youtube.com/watch?v={ID}"


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch, tmp_path):
    for name in [
        "YOUTUBE_COOKIES_B64",
        "YOUTUBE_COOKIES_FILE",
        "YOUTUBE_PROXY",
        "YOUTUBE_PLAYER_CLIENTS",
    ]:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(ys.tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(ys, "COOKIE_SIGNATURE", None)


def cookie_data(name="__Secure-3PSID", value="test-session", expires="0"):
    return f"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t{expires}\t{name}\t{value}\n".encode()


def test_cookie_rotation_validation_and_session_names(monkeypatch):
    monkeypatch.setenv("YOUTUBE_COOKIES_B64", base64.b64encode(cookie_data()).decode())
    path = ys.cookie_file()
    assert path.stat().st_mode & 0o777 == 0o600
    assert ys.cookie_status()["youtube_session_found"] is True
    monkeypatch.setenv(
        "YOUTUBE_COOKIES_B64", base64.b64encode(cookie_data(value="updated")).decode()
    )
    assert b"updated" in ys.cookie_file().read_bytes()
    monkeypatch.setenv("YOUTUBE_COOKIES_B64", "not base64")
    with pytest.raises(ys.YouTubeError) as error:
        ys.cookie_file()
    assert error.value.code == "YOUTUBE_COOKIES_INVALID"
    assert b"updated" in path.read_bytes()


def test_expired_cookies_do_not_claim_an_active_session(monkeypatch):
    monkeypatch.setenv(
        "YOUTUBE_COOKIES_B64", base64.b64encode(cookie_data(expires="1")).decode()
    )
    assert ys.cookie_status()["youtube_session_found"] is False
    assert ys.cookie_status()["expired_cookie_count"] == 1


def test_cached_audio_bypasses_youtube_and_invalid_cookies(monkeypatch, tmp_path):
    service = ys.YouTubeService(tmp_path)
    path = tmp_path / f"Me Pones en Tensión [{ID}].mp3"
    path.write_bytes(b"existing-audio")
    monkeypatch.setenv("YOUTUBE_COOKIES_B64", "invalid")
    extractor = MagicMock(
        side_effect=AssertionError("No remote lookup for a cached MP3")
    )
    monkeypatch.setattr(ys.yt_dlp, "YoutubeDL", extractor)
    assert service.audio(url=URL)[0] == path
    extractor.assert_not_called()


def test_single_video_import_uses_public_metadata_not_streaming(monkeypatch, tmp_path):
    response = MagicMock()
    response.json.return_value = {
        "title": "Vídeo público",
        "author_name": "Artista",
        "thumbnail_url": "https://i.ytimg.com/test.jpg",
    }
    monkeypatch.setattr(ys.requests, "get", MagicMock(return_value=response))
    monkeypatch.setenv("YOUTUBE_COOKIES_B64", "invalid")
    extractor = MagicMock(
        side_effect=AssertionError("Importing metadata must not extract audio")
    )
    monkeypatch.setattr(ys.yt_dlp, "YoutubeDL", extractor)
    result = ys.YouTubeService(tmp_path).analyze(URL)
    assert result["tracks"][0]["url"] == URL
    assert result["tracks"][0]["title"] == "Vídeo público"
    extractor.assert_not_called()


def fake_ydl(monkeypatch, result=None, effect=None):
    factory = MagicMock()
    instance = factory.return_value.__enter__.return_value
    if effect:
        instance.extract_info.side_effect = effect
    else:
        instance.extract_info.return_value = result
    monkeypatch.setattr(ys.yt_dlp, "YoutubeDL", factory)
    return factory, instance


def test_playlist_is_flat_and_independent_of_cookies(monkeypatch, tmp_path):
    monkeypatch.setenv("YOUTUBE_COOKIES_B64", "invalid")
    factory, instance = fake_ydl(
        monkeypatch,
        {
            "title": "Mi lista",
            "entries": [{"id": ID, "title": "Canción"}, None, {"id": "invalid"}],
        },
    )
    result = ys.YouTubeService(tmp_path).analyze(
        "https://www.youtube.com/playlist?list=PLexample"
    )
    assert len(result["tracks"]) == 1
    assert result["tracks"][0]["url"] == URL
    opts = factory.call_args.args[0]
    assert "cookiefile" not in opts
    assert opts["extract_flat"] == "in_playlist"
    assert instance.extract_info.call_args.kwargs["download"] is False


def test_flat_search_reuses_cached_audio_then_persists_resolution(
    monkeypatch, tmp_path
):
    path = tmp_path / f"{ID}.mp3"
    path.write_bytes(b"audio")
    factory, instance = fake_ydl(
        monkeypatch, {"entries": [{"id": ID, "title": "Me Pones en Tensión"}]}
    )
    service = ys.YouTubeService(tmp_path)
    assert service.audio(query="The Noise - Me Pones en Tension")[0] == path
    assert factory.call_args.args[0]["extract_flat"] is True
    instance.extract_info.side_effect = AssertionError(
        "The resolved query must be cached"
    )
    assert service.audio(query="THE NOISE - ME PONES EN TENSION")[0] == path
    assert instance.extract_info.call_count == 1


def test_uncached_audio_performs_one_full_extraction(monkeypatch, tmp_path):
    monkeypatch.setattr(ys.shutil, "which", lambda name: "/usr/bin/" + name)

    def download(target, download):
        assert target == URL and download is True
        (tmp_path / f"{ID}.mp3").write_bytes(b"converted-audio")
        return {"id": ID, "title": "Resultado"}

    factory, instance = fake_ydl(monkeypatch, effect=download)
    path, title = ys.YouTubeService(tmp_path).audio(url=URL)
    assert path.suffix == ".mp3" and title == "Resultado"
    assert instance.extract_info.call_count == 1
    assert factory.call_args.args[0]["postprocessors"][0]["key"] == "FFmpegExtractAudio"


def test_runtime_configuration_supports_proxy_and_matching_provider(monkeypatch):
    monkeypatch.setenv("YOUTUBE_PROXY", "http://user:password@proxy.example:8080")
    opts = ys.extraction_options()
    assert opts["proxy"] == "http://user:password@proxy.example:8080"
    assert opts["extractor_args"]["youtubepot-bgutilhttp"]["base_url"] == [
        "http://127.0.0.1:4416"
    ]
    assert "youtube" not in opts["extractor_args"]
    monkeypatch.setenv("YOUTUBE_PLAYER_CLIENTS", "tv_samsung,web")
    assert ys.extraction_options()["extractor_args"]["youtube"]["player_client"] == [
        "tv_samsung",
        "web",
    ]


def test_extractor_selects_supported_clients_for_authenticated_and_public_sessions(
    monkeypatch,
):
    from yt_dlp.extractor.youtube import YoutubeIE

    for authenticated in [False, True]:
        monkeypatch.setattr(
            YoutubeIE, "is_authenticated", property(lambda self: authenticated)
        )
        with ys.yt_dlp.YoutubeDL(ys.extraction_options()) as ydl:
            extractor = YoutubeIE(ydl)
            extractor.initialize()
            clients = extractor._get_requested_clients(URL, {}, False)
        assert "tv_samsung" in clients
        assert "web" in clients
        assert "tv_downgraded" not in clients


def test_diagnostic_logger_never_retains_cookies_tokens_or_proxy_credentials(caplog):
    logger = ys.SafeLogger()
    logger.debug("[debug] Found YouTube account cookies")
    logger.debug("[youtube] Downloading tv samsung player API JSON")
    logger.debug(
        "[youtube] Generating a gvs PO Token for web client via bgutil HTTP server"
    )
    logger.debug("[debug] Generated POT: secret-token")
    logger.warning("Proxy error http://user:secret-password@proxy.example:80")
    assert logger.summary() == {
        "account_cookies_recognized": True,
        "token_requested": True,
        "clients_attempted": ["tv_samsung"],
    }
    assert "secret-" not in str(vars(logger)) + caplog.text


@pytest.mark.parametrize(
    "error,code,status",
    [
        (
            "Sign in to confirm you’re not a bot. http://user:password@proxy.example",
            "YOUTUBE_ACCESS_BLOCKED",
            503,
        ),
        ("Video unavailable", "YOUTUBE_UNAVAILABLE", 404),
        ("Private video", "YOUTUBE_RESTRICTED", 403),
        ("Connection timed out", "YOUTUBE_NETWORK_ERROR", 504),
    ],
)
def test_failures_are_classified_without_exposing_credentials(error, code, status):
    failure = ys.classify_error(error)
    assert (failure.code, failure.status) == (code, status)
    assert "password" not in str(failure.detail())


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/watch?v=" + ID,
        "file:///etc/passwd",
        "https://youtube.com.evil.test/watch?v=" + ID,
        "https://user:password@youtube.com/watch?v=" + ID,
    ],
)
def test_unsupported_urls_never_reach_the_extractor(url, monkeypatch, tmp_path):
    factory, _ = fake_ydl(monkeypatch)
    with pytest.raises(ys.YouTubeError):
        ys.YouTubeService(tmp_path).analyze(url)
    factory.assert_not_called()


def test_api_serves_cached_audio_with_range_and_unicode_filename(monkeypatch, tmp_path):
    service = ys.YouTubeService(tmp_path)
    path = tmp_path / f"Canción 日本語 [{ID}].mp3"
    path.write_bytes(b"0123456789")
    monkeypatch.setattr(server, "youtube", service)
    client = TestClient(server.app)
    response = client.get("/api/media", params={"url": URL})
    assert response.status_code == 200 and response.content == b"0123456789"
    assert "filename*=utf-8" in response.headers["content-disposition"].lower()
    response = client.get(
        "/api/media",
        params={"url": URL, "mode": "inline"},
        headers={"Range": "bytes=2-5"},
    )
    assert response.status_code == 206 and response.content == b"2345"
    assert response.headers["content-disposition"].startswith("inline")


def test_api_returns_actionable_structured_error(monkeypatch, tmp_path):
    service = ys.YouTubeService(tmp_path)
    monkeypatch.setattr(server, "youtube", service)
    fake_ydl(monkeypatch, effect=RuntimeError("Sign in to confirm you are not a bot"))
    response = TestClient(server.app).get("/api/media", params={"url": URL})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "YOUTUBE_ACCESS_BLOCKED"


def test_empty_spotify_playlist_is_not_misrepresented_as_a_song(monkeypatch):
    monkeypatch.setattr(
        server, "extract_full_spotify_playlist", lambda url: ("Empty", [])
    )
    response = TestClient(server.app).post(
        "/api/analyze", json={"url": "https://open.spotify.com/playlist/example"}
    )
    assert response.status_code == 404
