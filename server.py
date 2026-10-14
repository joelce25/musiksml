import os
import re
import hmac
import time
import json
import base64
import hashlib
import struct
import shutil
import asyncio
import tempfile
import threading
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp
import requests
from bs4 import BeautifulSoup
import numpy as np
from dotenv import load_dotenv

load_dotenv()

DEFAULT_SPOTIFY_CLIENT_ID = "d04495cb61d649f9910929fe60fee796"
DEFAULT_SPOTIFY_CLIENT_SECRET = "6416b56ed57241d7977040f599104050"

try:
    import librosa
    HAS_LIBROSA = True
except Exception:
    HAS_LIBROSA = False

FFMPEG_PATH = shutil.which("ffmpeg")
if not FFMPEG_PATH:
    try:
        import imageio_ffmpeg
        FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        FFMPEG_PATH = None

app = FastAPI(title="musiksml API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DOWNLOAD_DIR = Path("downloads")
DOWNLOAD_DIR.mkdir(exist_ok=True)
def get_ydl_base_opts() -> dict:
    raw_cookies = os.getenv("YOUTUBE_COOKIES", "").strip()
    cookie_file = Path("/tmp/youtube_cookies.txt") if os.name != "nt" else Path("cookies.txt")
    has_valid_cookies = False

    if raw_cookies:
        try:
            # Reconstruir saltos de línea por si Railway los escapó
            formatted_cookies = raw_cookies.replace("\\n", "\n")
            cookie_file.write_text(formatted_cookies, encoding="utf-8")
            has_valid_cookies = True
        except Exception as e:
            print(f"Error escribiendo cookies: {e}")
    elif cookie_file.exists() and cookie_file.stat().st_size > 100:
        has_valid_cookies = True

    opts = {
        "quiet": True,
        "no_warnings": True,
        "nocheckcertificate": True,
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        }
    }

    if has_valid_cookies:
        # Con cookies activas usamos web + tv para que yt-dlp envíe la sesión autenticada
        opts["cookiefile"] = str(cookie_file)
        opts["extractor_args"] = {
            "youtube": {
                "player_client": ["web", "tv"]
            }
        }
    else:
        # Sin cookies intentamos tv_embedded y android_vr
        opts["extractor_args"] = {
            "youtube": {
                "player_client": ["tv_embedded", "android_vr", "mweb"]
            }
        }

    return opts

download_locks = {}
artwork_cache = {}
global_lock = threading.Lock()


def get_track_lock(key: str) -> threading.Lock:
    with global_lock:
        if key not in download_locks:
            download_locks[key] = threading.Lock()
        return download_locks[key]


class UrlRequest(BaseModel):
    url: str


MAJOR_TO_CAMELOT = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
MINOR_TO_CAMELOT = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]


def analyze_real_audio_file(file_path: str):
    """Calcula el BPM matemático real y la clave Camelot con Librosa DSP."""
    if not HAS_LIBROSA:
        return 124, "8A"
    try:
        y, sr = librosa.load(file_path, sr=22050, mono=True, offset=15.0, duration=60.0)
        if len(y) < sr * 5:
            y, sr = librosa.load(file_path, sr=22050, mono=True, duration=45.0)

        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo = librosa.feature.tempo(onset_envelope=onset_env, sr=sr)
        bpm_val = float(np.ndim(tempo) and tempo[0] or tempo)
        bpm = int(round(bpm_val))

        if bpm < 75:
            bpm *= 2
        elif bpm > 175:
            bpm = int(round(bpm / 2))

        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        chroma_vals = np.sum(chroma, axis=1)

        maj_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
        min_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

        best_score = -1e9
        best_camelot = "8A"

        for i in range(12):
            maj_corr = np.corrcoef(chroma_vals, np.roll(maj_profile, i))[0, 1]
            min_corr = np.corrcoef(chroma_vals, np.roll(min_profile, i))[0, 1]
            if maj_corr > best_score:
                best_score = maj_corr
                best_camelot = MAJOR_TO_CAMELOT[i]
            if min_corr > best_score:
                best_score = min_corr
                best_camelot = MINOR_TO_CAMELOT[i]

        return bpm, best_camelot
    except Exception:
        return 124, "8A"


@app.post("/api/analyze-local")
async def analyze_local_mp3(file: UploadFile = File(...)):
    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        bpm, key = analyze_real_audio_file(tmp_path)
        genre = "Reggaeton / Urbano" if bpm < 110 else ("Tech House" if bpm <= 126 else "Electrónica / Club")
        return {
            "filename": file.filename,
            "bpm": bpm,
            "key": key,
            "genre": genre
        }
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass


@app.get("/api/artwork")
def get_artwork(q: str = Query(...)):
    clean_q = re.sub(r"\(.*?\)|\[.*?\]|official|video|audio|lyrics|hd|4k|feat\.|ft\.", " ", q, flags=re.I)
    clean_q = " ".join(clean_q.split())

    if clean_q in artwork_cache:
        return {"url": artwork_cache[clean_q]}

    try:
        r = requests.get(
            "https://itunes.apple.com/search",
            params={"term": clean_q, "media": "music", "limit": 1},
            timeout=4
        )
        data = r.json()
        if data.get("resultCount", 0) > 0:
            art = data["results"][0].get("artworkUrl100", "").replace("100x100bb", "600x600bb")
            if art:
                artwork_cache[clean_q] = art
                return {"url": art}
    except Exception:
        pass

    try:
        r2 = requests.get(
            "https://api.deezer.com/search",
            params={"q": clean_q, "limit": 1},
            timeout=4
        )
        d2 = r2.json()
        if d2.get("data"):
            art = d2["data"][0].get("album", {}).get("cover_xl") or d2["data"][0].get("album", {}).get("cover_big")
            if art:
                artwork_cache[clean_q] = art
                return {"url": art}
    except Exception:
        pass

    return {"url": ""}


def estimate_initial_meta(title: str, artist: str, duration: int = 200):
    combined = f"{artist} {title}".lower()
    camelot_keys = ["8A", "8B", "9A", "7A", "6A", "5A", "10B", "11A", "4A", "9B", "6B", "7B"]
    seed = sum(ord(c) for c in f"{artist}{title}")
    key = camelot_keys[seed % len(camelot_keys)]

    if any(w in combined for w in [
        "reggaeton", "urbano", "feid", "bad bunny", "rauw", "karol", "daddy", "chencho",
        "plan b", "joan", "hector", "trebol", "noise", "wisin", "yandel", "don omar",
        "tego", "zion", "lennox", "arcangel", "ñengo", "jowell", "randy", "ivy queen",
        "tito", "bambino", "nicky jam", "dalmata", "baby rasta", "gringo", "perreo"
    ]):
        bpm = 92 + (seed % 11)
        genre = "Reggaeton / Urbano"
    elif any(w in combined for w in ["tech house", "fisher", "acraze", "cloonee", "pawsa", "house"]):
        bpm = 124 + (seed % 5)
        genre = "Tech House"
    elif any(w in combined for w in ["guaracha", "tribal", "aoki", "tiesto", "guetta", "edm", "electro"]):
        bpm = 128 + (seed % 5)
        genre = "Electrónica / Club"
    elif any(w in combined for w in ["pop", "dua lipa", "weeknd", "bruno", "rihanna", "calvin"]):
        bpm = 116 + (seed % 12)
        genre = "Pop / Dance"
    else:
        bpm = 96 + ((duration or 190) % 28)
        genre = "Reggaeton / Urbano" if bpm < 112 else "Crossover"

    return bpm, key, genre


def parse_pathfinder_items(items_list):
    """Convierte los items del JSON interno Pathfinder v2 de Spotify a nuestro formato."""
    parsed = []
    for item in items_list:
        track_Wrapper = item.get("itemV2", {}).get("data", {}) or item.get("item", {}).get("data", {})
        if not track_Wrapper:
            continue
        t_title = track_Wrapper.get("name")
        if not t_title:
            continue

        # Extraer artistas
        artists_items = track_Wrapper.get("artists", {}).get("items", [])
        artists_names = [a.get("profile", {}).get("name", "") for a in artists_items if a.get("profile", {}).get("name")]
        t_artist = ", ".join(artists_names) or "Artista"

        # Extraer duración
        dur_ms = (
            track_Wrapper.get("trackDuration", {}).get("totalMilliseconds")
            or track_Wrapper.get("duration", {}).get("totalMilliseconds")
            or 200000
        )
        dur = int(dur_ms / 1000)

        # Extraer portada oficial del álbum
        cover_sources = track_Wrapper.get("albumOfTrack", {}).get("coverArt", {}).get("sources", [])
        cover_url = cover_sources[0].get("url", "") if cover_sources else ""

        bpm, key, genre = estimate_initial_meta(t_title, t_artist, dur)
        parsed.append({
            "title": t_title,
            "artist": t_artist,
            "duration": dur,
            "bpm": bpm,
            "key": key,
            "genre": genre,
            "source": "Spotify",
            "search_query": f"{t_artist} - {t_title} official audio",
            "thumbnail": cover_url
        })
    return parsed


def extract_with_playwright_headless(playlist_id: str):
    """
    Usa Chromium invisible para abrir la playlist de Spotify, capturar el token y el hash
    Pathfinder real de la sesión y pedir TODAS las canciones (148, 500, 1000+) de un solo golpe.
    """
    from playwright.sync_api import sync_playwright

    captured_auth = {"bearer": None, "client_token": None, "sha256": None}
    all_tracks = []
    playlist_name = "Spotify Playlist"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        )
        page = context.new_page()

        def handle_request(request):
            if "pathfinder" in request.url and request.method == "POST":
                headers = request.headers
                if "authorization" in headers:
                    captured_auth["bearer"] = headers["authorization"]
                if "client-token" in headers:
                    captured_auth["client_token"] = headers["client-token"]
                try:
                    post_json = json.loads(request.post_data or "{}")
                    if post_json.get("operationName") in ("fetchPlaylist", "fetchPlaylistContents"):
                        sha = post_json.get("extensions", {}).get("persistedQuery", {}).get("sha256Hash")
                        if sha:
                            captured_auth["sha256"] = sha
                except Exception:
                    pass

        def handle_response(response):
            nonlocal playlist_name
            if "pathfinder" in response.url and response.status == 200:
                try:
                    data = response.json()
                    pl_v2 = data.get("data", {}).get("playlistV2", {})
                    if pl_v2.get("name"):
                        playlist_name = pl_v2["name"]
                    content = pl_v2.get("content", {})
                    items = content.get("items", [])
                    if items:
                        all_tracks.extend(parse_pathfinder_items(items))
                except Exception:
                    pass

        page.on("request", handle_request)
        page.on("response", handle_response)

        page.goto(f"https://open.spotify.com/playlist/{playlist_id}", wait_until="networkidle", timeout=25000)
        page.wait_for_timeout(1500)

        # Si la playlist tiene más canciones de las cargadas en la primera vista, pedimos el resto con el mismo token y hash capturados
        if captured_auth["bearer"] and captured_auth["sha256"]:
            offset = len(all_tracks)
            headers = {
                "Authorization": captured_auth["bearer"],
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0"
            }
            if captured_auth["client_token"]:
                headers["client-token"] = captured_auth["client_token"]

            while offset < 2000:
                payload = {
                    "variables": {
                        "uri": f"spotify:playlist:{playlist_id}",
                        "offset": offset,
                        "limit": 300
                    },
                    "operationName": "fetchPlaylistContents",
                    "extensions": {
                        "persistedQuery": {
                            "version": 1,
                            "sha256Hash": captured_auth["sha256"]
                        }
                    }
                }
                r = requests.post("https://api-partner.spotify.com/pathfinder/v2/query", headers=headers, json=payload, timeout=10)
                if r.status_code != 200:
                    # Probar con operationName fetchPlaylist si el hash pertenece a la operación principal
                    payload["operationName"] = "fetchPlaylist"
                    payload["variables"]["enableWatchFeedEntrypoint"] = False
                    r = requests.post("https://api-partner.spotify.com/pathfinder/v2/query", headers=headers, json=payload, timeout=10)
                    if r.status_code != 200:
                        break

                res_data = r.json()
                items = res_data.get("data", {}).get("playlistV2", {}).get("content", {}).get("items", [])
                if not items:
                    break
                batch = parse_pathfinder_items(items)
                if not batch:
                    break
                all_tracks.extend(batch)
                if len(items) < 100:
                    break
                offset += len(items)

        # Si aún faltan pistas por cargar mediante scroll en el DOM
        if len(all_tracks) <= 100:
            for _ in range(8):
                page.mouse.wheel(0, 4000)
                page.wait_for_timeout(600)

        browser.close()

    # Eliminar posibles duplicados manteniendo el orden exacto de la playlist
    seen = set()
    unique_tracks = []
    for t in all_tracks:
        k = f"{t['title']}|{t['artist']}"
        if k not in seen:
            seen.add(k)
            unique_tracks.append(t)

    return playlist_name, unique_tracks


def extract_full_spotify_playlist(url: str):
    """Extrae TODAS las canciones de una playlist de Spotify (148, 500+) superando el bloqueo de Feb 2026."""
    match = re.search(r"playlist/([a-zA-Z0-9]+)", url)
    playlist_id = match.group(1) if match else None
    if not playlist_id:
        raise ValueError("URL de playlist de Spotify inválida.")

    # 1. Extraer con Playwright Headless (Supera el límite de 100 y el bloqueo 403 de Febrero 2026)
    try:
        playlist_name, tracks = extract_with_playwright_headless(playlist_id)
        if len(tracks) > 0:
            return playlist_name, tracks
    except Exception as e:
        print(f"Aviso Playwright: {e}")

    # 2. Respaldo por embed si Playwright no está instalado aún
    headers = {"User-Agent": "Mozilla/5.0"}
    embed_url = f"https://open.spotify.com/embed/playlist/{playlist_id}"
    resp = requests.get(embed_url, headers=headers, timeout=12)
    soup = BeautifulSoup(resp.text, "html.parser")
    next_data = soup.find("script", {"id": "__NEXT_DATA__"})
    tracks_found = []
    playlist_name = "Spotify Playlist"

    if next_data and next_data.string:
        data = json.loads(next_data.string)
        entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
        playlist_name = entity.get("name", playlist_name)
        for idx, item in enumerate(entity.get("trackList", [])):
            title = item.get("title", f"Track {idx+1}")
            artist = item.get("subtitle", "Artista")
            duration = int(item.get("duration", 200000) / 1000)
            bpm, key, genre = estimate_initial_meta(title, artist, duration)
            tracks_found.append({
                "title": title,
                "artist": artist,
                "duration": duration,
                "bpm": bpm,
                "key": key,
                "genre": genre,
                "source": "Spotify",
                "search_query": f"{artist} - {title} official audio",
                "thumbnail": ""
            })

    return playlist_name, tracks_found


@app.post("/api/analyze")
def analyze_link(req: UrlRequest):
    url = req.url.strip()

    if "spotify.com" in url:
        try:
            if "playlist/" in url:
                playlist_name, tracks = extract_full_spotify_playlist(url)
                if tracks:
                    return {
                        "type": "spotify_playlist",
                        "title": playlist_name,
                        "tracks": tracks
                    }

            headers = {"User-Agent": "Mozilla/5.0"}
            resp = requests.get(url, headers=headers, timeout=10)
            soup = BeautifulSoup(resp.text, "html.parser")
            og_title = soup.find("meta", property="og:title")
            og_desc = soup.find("meta", property="og:description")
            og_img = soup.find("meta", property="og:image")
            if og_title:
                t_name = og_title.get("content", "Track")
                t_artist = og_desc.get("content", "").split("·")[0].strip() if og_desc else "Artista"
                cover = og_img.get("content", "") if og_img else ""
                bpm, key, genre = estimate_initial_meta(t_name, t_artist, 200)
                return {
                    "type": "spotify_single",
                    "title": t_name,
                    "tracks": [{
                        "title": t_name,
                        "artist": t_artist,
                        "duration": 200,
                        "bpm": bpm,
                        "key": key,
                        "genre": genre,
                        "source": "Spotify",
                        "search_query": f"{t_artist} - {t_name} official audio",
                        "thumbnail": cover
                    }]
                }
            raise HTTPException(status_code=400, detail="No se pudo leer la lista de Spotify.")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Error leyendo Spotify: {str(e)}")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if "entries" in info:
                tracks = []
                for entry in list(info["entries"]):
                    if not entry:
                        continue
                    vid_id = entry.get("id", "")
                    title = entry.get("title", "Audio")
                    uploader = entry.get("uploader", entry.get("channel", "YouTube"))
                    dur = entry.get("duration") or 200
                    vid_url = entry.get("url") or f"https://www.youtube.com/watch?v={vid_id}"
                    thumb = f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg" if vid_id else ""
                    bpm, key, genre = estimate_initial_meta(title, uploader, dur)
                    tracks.append({
                        "title": title,
                        "artist": uploader,
                        "duration": dur,
                        "bpm": bpm,
                        "key": key,
                        "genre": genre,
                        "source": "YouTube",
                        "url": vid_url,
                        "thumbnail": thumb
                    })
                return {
                    "type": "youtube_playlist",
                    "title": info.get("title", "Playlist de YouTube"),
                    "tracks": tracks
                }
            else:
                vid_id = info.get("id", "")
                title = info.get("title", "Audio")
                uploader = info.get("uploader", "YouTube")
                dur = info.get("duration") or 200
                thumb = info.get("thumbnail") or (f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg" if vid_id else "")
                bpm, key, genre = estimate_initial_meta(title, uploader, dur)
                return {
                    "type": "youtube_single",
                    "title": title,
                    "tracks": [{
                        "title": title,
                        "artist": uploader,
                        "duration": dur,
                        "bpm": bpm,
                        "key": key,
                        "genre": genre,
                        "source": "YouTube",
                        "url": info.get("webpage_url", url),
                        "thumbnail": thumb
                    }]
                }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"No se pudo procesar el link: {str(e)}")


@app.get("/api/media")
def get_or_download_audio(
    url: Optional[str] = Query(None),
    query: Optional[str] = Query(None),
    mode: str = Query("download")
):
    target = url if url else f"ytsearch1:{query}"
    if not target:
        raise HTTPException(status_code=400, detail="Falta URL o búsqueda.")

    lock = get_track_lock(target)
    with lock:
        try:
            info_opts = get_ydl_base_opts()
            info_opts["noplaylist"] = True

            with yt_dlp.YoutubeDL(info_opts) as ydl_info:
                info = ydl_info.extract_info(target, download=False)
                if "entries" in info:
                    info = info["entries"][0]
                vid_id = info.get("id", "audio")
                raw_title = info.get("title", "track")

            existing_mp3 = list(DOWNLOAD_DIR.glob(f"*[{vid_id}].mp3"))
            existing_any = [
                f for f in DOWNLOAD_DIR.glob(f"*[{vid_id}].*")
                if not f.name.endswith(".part") and not f.name.endswith(".ytdl")
            ]

            final_path = None
            if existing_mp3:
                final_path = existing_mp3[0]
            elif existing_any and not FFMPEG_PATH:
                final_path = existing_any[0]

            if not final_path or not final_path.exists():
                out_tmpl = str(DOWNLOAD_DIR / "%(title).75B [%(id)s].%(ext)s")
                ydl_opts = get_ydl_base_opts()
                ydl_opts.update({
                    "format": "ba/b",
                    "outtmpl": out_tmpl,
                    "noplaylist": True,
                    "overwrites": False,
                })
                if FFMPEG_PATH:
                    ydl_opts["ffmpeg_location"] = FFMPEG_PATH
                    ydl_opts["postprocessors"] = [{
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "320",
                    }]

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([info.get("webpage_url") or target])

                matches = [
                    f for f in DOWNLOAD_DIR.glob(f"*[{vid_id}]*")
                    if not f.name.endswith(".part") and not f.name.endswith(".ytdl")
                ]
                if not matches:
                    raise HTTPException(status_code=500, detail="No se encontró el archivo procesado.")
                final_path = matches[0]

            clean_filename = re.sub(r'[\\/*?:"<>|]', "", raw_title).strip() + final_path.suffix
            media_type = "audio/mpeg" if final_path.suffix.lower() == ".mp3" else "audio/webm"
            disposition = "attachment" if mode == "download" else "inline"

            return FileResponse(
                path=final_path,
                filename=clean_filename if mode == "download" else None,
                media_type=media_type,
                headers={"Content-Disposition": f'{disposition}; filename="{clean_filename}"'}
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error procesando audio: {str(e)}")


app.mount("/", StaticFiles(directory=".", html=True), name="static")