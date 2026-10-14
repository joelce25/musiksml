"""YouTube metadata, audio cache and extraction configuration.

Metadata imports do not require an audio stream. Cached audio is served before
contacting YouTube. Runtime credentials remain in Railway environment variables.
"""

import base64
import binascii
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
from http.cookiejar import MozillaCookieJar
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
import yt_dlp

LOG = logging.getLogger(__name__)
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
COOKIE_LOCK = threading.Lock()
COOKIE_SIGNATURE = None
AUTH_COOKIES = {
    "LOGIN_INFO",
    "SAPISID",
    "SID",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "__Secure-1PAPISID",
    "__Secure-3PAPISID",
}
AUDIO_TYPES = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm",
    ".opus": "audio/ogg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
}


class YouTubeError(Exception):
    def __init__(self, code, message, status=502, retryable=False):
        super().__init__(message)
        self.code, self.message, self.status, self.retryable = (
            code,
            message,
            status,
            retryable,
        )

    def detail(self):
        return {"code": self.code, "message": self.message, "retryable": self.retryable}


def classify_error(error):
    text = str(error).lower()
    if "sign in to confirm" in text or "not a bot" in text or "login_required" in text:
        return YouTubeError(
            "YOUTUBE_ACCESS_BLOCKED",
            "YouTube está bloqueando la conexión del servidor. La configuración de acceso del servidor debe revisarse; repetir la descarga no resolverá el bloqueo.",
            503,
        )
    if "cookies" in text and any(
        word in text for word in ["expired", "rotated", "no longer valid"]
    ):
        return YouTubeError(
            "YOUTUBE_SESSION_EXPIRED",
            "La sesión de YouTube del servidor ha caducado. Debe actualizarse antes de descargar.",
            503,
        )
    if any(
        word in text
        for word in [
            "private video",
            "private playlist",
            "members-only",
            "sign in to confirm your age",
        ]
    ):
        return YouTubeError(
            "YOUTUBE_RESTRICTED",
            "Este contenido requiere una cuenta con acceso. Prueba con un vídeo o una playlist pública.",
            403,
        )
    if any(
        word in text
        for word in [
            "video unavailable",
            "video is unavailable",
            "playlist does not exist",
            "has been removed",
            "not available in your country",
        ]
    ):
        return YouTubeError(
            "YOUTUBE_UNAVAILABLE",
            "El vídeo o la playlist no están disponibles para el servidor. Comprueba el enlace y que el contenido sea público.",
            404,
        )
    if "429" in text or "too many requests" in text:
        return YouTubeError(
            "YOUTUBE_RATE_LIMITED",
            "YouTube ha limitado temporalmente las solicitudes. Espera antes de volver a intentar.",
            503,
            True,
        )
    if any(word in text for word in ["proxy", "407", "tunnel connection failed"]):
        return YouTubeError(
            "YOUTUBE_PROXY_ERROR",
            "La conexión configurada para YouTube no está disponible. Debe revisarse en el servidor.",
            503,
        )
    if any(
        word in text
        for word in [
            "timed out",
            "timeout",
            "connection reset",
            "network is unreachable",
        ]
    ):
        return YouTubeError(
            "YOUTUBE_NETWORK_ERROR",
            "No se pudo conectar con YouTube a tiempo. Inténtalo de nuevo más tarde.",
            504,
            True,
        )
    return YouTubeError(
        "YOUTUBE_EXTRACTION_FAILED",
        "No se pudo obtener el audio de YouTube. Prueba con otro vídeo público o añade el archivo desde tu dispositivo.",
    )


class SafeLogger:
    # yt-dlp errors can contain proxy URLs. Never publish credentials in logs.
    def __init__(self):
        self.account_cookies_recognized = False
        self.token_requested = False
        self.clients = set()

    def debug(self, message):
        if "Found YouTube account cookies" in message:
            self.account_cookies_recognized = True
        if "Generating a " in message and " PO Token for " in message:
            self.token_requested = True
        # Keep only known client names, never the original log or token values.
        match = re.search(r"Downloading ([a-z_ ]+) player API JSON", message)
        if match:
            client = match[1].replace(" ", "_")
            if client in {
                "web",
                "web_embedded",
                "web_creator",
                "web_safari",
                "web_music",
                "tv_samsung",
                "visionos",
                "mweb",
                "tv",
            }:
                self.clients.add(client)

    def summary(self):
        return {
            "account_cookies_recognized": self.account_cookies_recognized,
            "token_requested": self.token_requested,
            "clients_attempted": sorted(self.clients),
        }

    def warning(self, message):
        LOG.warning("yt-dlp warning: %s", classify_error(message).code)

    def error(self, message):
        LOG.error("yt-dlp error: %s", classify_error(message).code)


def youtube_link(url):
    try:
        parsed = urlparse(url.strip())
        if (
            parsed.scheme not in {"https", "http"}
            or parsed.username
            or parsed.password
            or parsed.port
        ):
            raise ValueError()
        host = (parsed.hostname or "").lower()
        if host not in {
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "music.youtube.com",
            "youtu.be",
            "www.youtu.be",
        }:
            raise ValueError()
        query = parse_qs(parsed.query)
        playlist = query.get("list", [None])[0]
        if playlist and not re.fullmatch(r"[A-Za-z0-9_-]{2,150}", playlist):
            raise ValueError()
        if host.endswith("youtu.be"):
            video = parsed.path.strip("/")
        elif parsed.path in {"/watch", "/watch/"}:
            video = query.get("v", [None])[0]
        elif parsed.path.startswith(("/shorts/", "/embed/", "/live/")):
            video = parsed.path.split("/")[2]
        else:
            video = None
        if video and not VIDEO_ID.fullmatch(video):
            raise ValueError()
        if not video and not playlist:
            raise ValueError()
        return video, playlist
    except (ValueError, IndexError, AttributeError):
        raise YouTubeError(
            "INVALID_YOUTUBE_URL",
            "Pega un enlace válido de vídeo o playlist de YouTube.",
            400,
        ) from None


def cookie_file():
    """Validate and materialize configured cookies; refresh when the binding changes."""
    global COOKIE_SIGNATURE
    encoded = os.getenv("YOUTUBE_COOKIES_B64", "").strip().strip("\"'")
    if encoded:
        try:
            data = base64.b64decode("".join(encoded.split()), validate=True)
            signature = hashlib.sha256(data).hexdigest()
            # Validate before replacing a usable cookie jar. Values never leave this function.
            with COOKIE_LOCK:
                path = Path(tempfile.gettempdir()) / "musiksml-youtube-cookies.txt"
                if signature != COOKIE_SIGNATURE or not path.is_file():
                    fd, candidate = tempfile.mkstemp(
                        prefix="musiksml-cookies-", suffix=".txt"
                    )
                    try:
                        with os.fdopen(fd, "wb") as output:
                            output.write(data)
                        jar = MozillaCookieJar(candidate)
                        jar.load(ignore_discard=True, ignore_expires=True)
                        os.replace(candidate, path)
                        COOKIE_SIGNATURE = signature
                    finally:
                        Path(candidate).unlink(missing_ok=True)
                return path
        except (binascii.Error, ValueError, OSError):
            raise YouTubeError(
                "YOUTUBE_COOKIES_INVALID",
                "Las cookies configuradas no son un archivo Netscape válido codificado en Base64. Revisa YOUTUBE_COOKIES_B64 en Railway.",
                503,
            ) from None
    configured = os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
    if configured:
        path = Path(configured)
        try:
            jar = MozillaCookieJar(str(path))
            jar.load(ignore_discard=True, ignore_expires=True)
        except (OSError, ValueError):
            raise YouTubeError(
                "YOUTUBE_COOKIES_INVALID",
                "No se puede leer el archivo de cookies configurado en el servidor.",
                503,
            ) from None
        return path
    return None


def cookie_status():
    result = {
        "cookies_detected": False,
        "total_cookie_lines": 0,
        "valid_netscape_tabs": False,
        "youtube_session_found": False,
    }
    try:
        path = cookie_file()
        if not path:
            return result
        jar = MozillaCookieJar(str(path))
        jar.load(ignore_discard=True, ignore_expires=True)
        cookies = list(jar)
        active = [c for c in cookies if c.expires in (None, 0) or not c.is_expired()]
        result.update(
            cookies_detected=True,
            total_cookie_lines=len(cookies),
            valid_netscape_tabs=True,
            youtube_session_found=any(
                c.name in AUTH_COOKIES
                and c.domain.lstrip(".") in {"youtube.com", "google.com"}
                for c in active
            ),
            expired_cookie_count=len(cookies) - len(active),
        )
        return result
    except (YouTubeError, OSError, ValueError):
        result["configuration_error"] = "YOUTUBE_COOKIES_INVALID"
        return result


def extraction_options(with_cookies=True):
    opts = {
        "quiet": True,
        "no_warnings": False,
        "logger": SafeLogger(),
        "retries": 2,
        "extractor_retries": 2,
        "fragment_retries": 2,
        "socket_timeout": 20,
        "extractor_args": {
            "youtubepot-bgutilhttp": {
                "base_url": [os.getenv("YOUTUBE_POT_BASE_URL", "http://127.0.0.1:4416")]
            }
        },
    }
    runtimes = {}
    for name in ["deno", "node"]:
        path = shutil.which(name)
        if path:
            runtimes[name] = {"path": path}
    opts["js_runtimes"] = runtimes
    # yt-dlp selects maintained clients according to authentication and JS support.
    # Forcing troubleshooting clients here prevented newer defaults from running.
    clients = os.getenv("YOUTUBE_PLAYER_CLIENTS", "").strip()
    if clients:
        opts["extractor_args"]["youtube"] = {
            "player_client": [c.strip() for c in clients.split(",") if c.strip()]
        }
    proxy = os.getenv("YOUTUBE_PROXY", "").strip()
    if proxy:
        opts["proxy"] = proxy
    if with_cookies:
        path = cookie_file()
        if path:
            opts["cookiefile"] = str(path)
    return opts


def metadata_row(info):
    video_id = str(info.get("id", ""))
    if not VIDEO_ID.fullmatch(video_id):
        return None
    return {
        "id": video_id,
        "title": info.get("title") or "Audio",
        "artist": info.get("uploader") or info.get("channel") or "YouTube",
        "duration": info.get("duration") or 0,
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "thumbnail": info.get("thumbnail")
        or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
    }


class YouTubeService:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.guard = threading.Lock()
        self.locks = {}
        self.slots = threading.BoundedSemaphore(2)

    def _lock(self, key):
        with self.guard:
            return self.locks.setdefault(key, threading.Lock())

    def cached_audio(self, video_id):
        if not VIDEO_ID.fullmatch(video_id or ""):
            return None
        matches = [
            p
            for p in self.directory.iterdir()
            if p.is_file()
            and p.suffix.lower() in AUDIO_TYPES
            and (p.stem == video_id or f"[{video_id}]" in p.name)
            and p.stat().st_size > 0
        ]
        return next(
            (p for p in matches if p.suffix == ".mp3"), matches[0] if matches else None
        )

    def _record(self, video_id, info, query=None):
        data = {
            "id": video_id,
            "title": info.get("title") or "Audio",
            "artist": info.get("uploader") or info.get("artist") or "YouTube",
        }
        targets = [self.directory / f".{video_id}.json"]
        if query:
            digest = hashlib.sha256(query.strip().casefold().encode()).hexdigest()
            targets.append(self.directory / f".query-{digest}.json")
        for target in targets:
            fd, candidate = tempfile.mkstemp(dir=self.directory, prefix=".metadata-")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as output:
                    json.dump(data, output)
                os.replace(candidate, target)
            finally:
                Path(candidate).unlink(missing_ok=True)
        return data

    def _cached_query(self, query):
        digest = hashlib.sha256(query.strip().casefold().encode()).hexdigest()
        try:
            return json.loads((self.directory / f".query-{digest}.json").read_text())
        except (OSError, ValueError):
            return None

    def _cached_result(self, video_id, info=None):
        path = self.cached_audio(video_id)
        if not path:
            return None
        if not info:
            try:
                info = json.loads((self.directory / f".{video_id}.json").read_text())
            except (OSError, ValueError):
                info = {"title": path.stem.replace(f"[{video_id}]", "").strip()}
        return path, info.get("title") or video_id

    def analyze(self, url):
        video_id, playlist_id = youtube_link(url)
        if playlist_id:
            target = f"https://www.youtube.com/playlist?list={playlist_id}"
            opts = extraction_options(with_cookies=False)
            opts.update(extract_flat="in_playlist", skip_download=True)
            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(target, download=False)
                if not info:
                    raise YouTubeError(
                        "YOUTUBE_PLAYLIST_UNAVAILABLE",
                        "No se pudo leer la playlist. Comprueba que sea pública y que el enlace sea correcto.",
                        404,
                    )
                rows = [
                    metadata_row(entry) for entry in info.get("entries", []) if entry
                ]
                rows = [row for row in rows if row]
                if not rows:
                    raise YouTubeError(
                        "YOUTUBE_PLAYLIST_EMPTY",
                        "No hay canciones disponibles en esta playlist.",
                        404,
                    )
                return {
                    "type": "youtube_playlist",
                    "title": info.get("title") or "Playlist de YouTube",
                    "tracks": rows,
                }
            except YouTubeError:
                raise
            except Exception as error:
                raise classify_error(error) from None
        target = f"https://www.youtube.com/watch?v={video_id}"
        # Public metadata uses YouTube's official oEmbed endpoint, not audio extraction.
        try:
            proxy = os.getenv("YOUTUBE_PROXY", "").strip()
            kwargs = {"proxies": {"http": proxy, "https": proxy}} if proxy else {}
            response = requests.get(
                "https://www.youtube.com/oembed",
                params={"url": target, "format": "json"},
                timeout=10,
                **kwargs,
            )
            response.raise_for_status()
            data = response.json()
            if data.get("title"):
                row = metadata_row(
                    {
                        "id": video_id,
                        "title": data["title"],
                        "uploader": data.get("author_name"),
                        "thumbnail": data.get("thumbnail_url"),
                    }
                )
                return {
                    "type": "youtube_single",
                    "title": row["title"],
                    "tracks": [row],
                }
        except (requests.RequestException, ValueError):
            pass
        try:
            opts = extraction_options()
            opts.update(noplaylist=True, skip_download=True)
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(target, download=False)
            row = metadata_row(info or {})
            if not row:
                raise YouTubeError(
                    "YOUTUBE_UNAVAILABLE", "No se pudo leer el vídeo de YouTube.", 404
                )
            return {"type": "youtube_single", "title": row["title"], "tracks": [row]}
        except YouTubeError:
            raise
        except Exception as error:
            raise classify_error(error) from None

    def audio(self, url=None, query=None):
        query = query.strip() if query else None
        video_id = None
        if url:
            video_id, _ = youtube_link(url)
            if not video_id:
                raise YouTubeError(
                    "VIDEO_REQUIRED",
                    "Para descargar, usa un enlace de vídeo, no de playlist.",
                    400,
                )
        elif query:
            known = self._cached_query(query)
            if known:
                cached = self._cached_result(known.get("id"), known)
                if cached:
                    return cached
        else:
            raise YouTubeError(
                "MISSING_MEDIA_TARGET",
                "Falta el enlace o el nombre de la canción.",
                400,
            )
        if video_id:
            cached = self._cached_result(video_id)
            if cached:
                return cached
        if not self.slots.acquire(timeout=5):
            raise YouTubeError(
                "DOWNLOAD_BUSY",
                "Hay otras descargas en curso. Espera unos segundos e inténtalo de nuevo.",
                429,
                True,
            )
        try:
            if not video_id:
                opts = extraction_options(with_cookies=False)
                opts.update(extract_flat=True, skip_download=True, playlistend=1)
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info = ydl.extract_info(f"ytsearch1:{query}", download=False)
                entry = next(
                    (
                        row
                        for row in (info or {}).get("entries", [])
                        if row and VIDEO_ID.fullmatch(str(row.get("id", "")))
                    ),
                    None,
                )
                if not entry:
                    raise YouTubeError(
                        "YOUTUBE_SEARCH_EMPTY",
                        "No se encontró una canción disponible con esa búsqueda.",
                        404,
                    )
                video_id = entry["id"]
                # Flat search does not require streaming formats or authenticated cookies.
                self._record(video_id, entry, query)
                cached = self._cached_result(video_id, entry)
                if cached:
                    return cached
            with self._lock(video_id):
                cached = self._cached_result(video_id)
                if cached:
                    return cached
                ffmpeg = shutil.which("ffmpeg")
                if not ffmpeg:
                    raise YouTubeError(
                        "FFMPEG_MISSING",
                        "El servidor no tiene disponible la conversión de audio. Debe repararse su instalación.",
                        503,
                    )
                opts = extraction_options()
                opts.update(
                    verbose=True,
                    format="bestaudio/bestaudio*/best[acodec!=none]",
                    noplaylist=True,
                    outtmpl=str(self.directory / "%(id)s.%(ext)s"),
                    ffmpeg_location=ffmpeg,
                    overwrites=True,
                    postprocessors=[
                        {
                            "key": "FFmpegExtractAudio",
                            "preferredcodec": "mp3",
                            "preferredquality": "320",
                        }
                    ],
                )
                try:
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        info = ydl.extract_info(
                            f"https://www.youtube.com/watch?v={video_id}", download=True
                        )
                except Exception as error:
                    failure = classify_error(error)
                    LOG.warning(
                        "YouTube download failed: %s; diagnostics=%s",
                        failure.code,
                        opts["logger"].summary(),
                    )
                    raise failure from None
                self._record(video_id, info or {}, query)
                cached = self._cached_result(video_id, info)
                if not cached:
                    raise YouTubeError(
                        "AUDIO_OUTPUT_MISSING",
                        "La descarga no produjo un archivo de audio válido.",
                    )
                return cached
        except YouTubeError:
            raise
        except Exception as error:
            raise classify_error(error) from None
        finally:
            self.slots.release()


def runtime_status():
    versions = {}
    for package in ["yt-dlp", "bgutil-ytdlp-pot-provider", "yt-dlp-ejs"]:
        try:
            versions[package] = version(package)
        except PackageNotFoundError:
            versions[package] = None
    runtimes = {}
    for name in ["node", "deno"]:
        path = shutil.which(name)
        if path:
            try:
                runtimes[name] = subprocess.check_output(
                    [path, "--version"], timeout=3, text=True
                ).splitlines()[0]
            except (OSError, subprocess.SubprocessError):
                runtimes[name] = "unavailable"
    provider = {"reachable": False, "compatible": False}
    try:
        with requests.Session() as session:
            session.trust_env = False
            response = session.get(
                os.getenv("YOUTUBE_POT_BASE_URL", "http://127.0.0.1:4416") + "/ping",
                timeout=2,
            )
            response.raise_for_status()
            server_version = response.json().get("version")
            provider.update(
                reachable=True,
                version=server_version,
                compatible=server_version == versions["bgutil-ytdlp-pot-provider"],
            )
    except (requests.RequestException, ValueError):
        pass
    return {
        "versions": versions,
        "runtimes": runtimes,
        "ffmpeg_available": bool(shutil.which("ffmpeg")),
        "token_provider": provider,
        "cookies": cookie_status(),
        "youtube_proxy_configured": bool(os.getenv("YOUTUBE_PROXY", "").strip()),
    }
