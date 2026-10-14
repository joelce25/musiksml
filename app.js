"use strict";

// The deployed frontend keeps the existing API. Local development uses one origin.
const API_BASE = ""; // Vercel forwards /api to Railway; audio uses the same origin.
const STORAGE_KEY = "musiksml_studio_v4";
const $ = (id) => document.getElementById(id);
const state = {
  library: [],
  playlists: [],
  imported: null,
  queue: [],
  favorites: [],
  view: "homeView",
  selectedPlaylist: null,
  search: "",
  onlyFavorites: false,
  sort: "recent",
  fade: 6,
  automix: true,
  mixName: "Mi primera sesión",
  volume: 0.85,
};
const localURLs = new Map();
const sessionFiles = new Map();
const downloadingTracks = new Set();
let storageWarning = false;
let exportJob = null;
let exportWorker = null;

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("toastContainer").replaceChildren(el);
  setTimeout(() => el.remove(), 4800);
}
function initializeTheme() {
  const system = matchMedia("(prefers-color-scheme: dark)");
  let preference = null;
  try {
    preference = localStorage.getItem("musiksml_theme");
  } catch {}
  if (!["light", "dark"].includes(preference)) preference = null;
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#171916" : "#f6f5f1";
    $("lightThemeBtn").setAttribute("aria-pressed", String(theme === "light"));
    $("darkThemeBtn").setAttribute("aria-pressed", String(theme === "dark"));
  };
  for (const [id, theme] of [
    ["lightThemeBtn", "light"],
    ["darkThemeBtn", "dark"],
  ]) {
    $(id).onclick = () => {
      preference = theme;
      apply(theme);
      try {
        localStorage.setItem("musiksml_theme", theme);
      } catch {
        toast(
          "Tema cambiado. El navegador no permitió guardar la preferencia para la próxima visita.",
        );
      }
    };
  }
  system.addEventListener("change", () => {
    if (!preference) apply(system.matches ? "dark" : "light");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === "musiksml_theme" || event.key === null) {
      preference = ["light", "dark"].includes(event.newValue)
        ? event.newValue
        : null;
      apply(preference || (system.matches ? "dark" : "light"));
    }
  });
  apply(preference || (system.matches ? "dark" : "light"));
}
function downloadButton(track) {
  const busy = downloadingTracks.has(track.id);
  return `<button class="small-button download-track" aria-label="Descargar ${escapeHTML(track.title)}" aria-busy="${busy}" ${busy ? "disabled" : ""}>
    <svg class="download-icon ${busy ? "hidden" : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></svg>
    <span class="download-spinner ${busy ? "" : "hidden"}" aria-hidden="true"></span><span class="download-label">${busy ? "Preparando…" : "Descargar"}</span></button>`;
}
function updateDownloadButtons(id, busy) {
  document.querySelectorAll(".track-row").forEach((row) => {
    if (row.dataset.trackId !== id) return;
    const button = row.querySelector(".download-track");
    if (!button) return;
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    button.querySelector(".download-label").textContent = busy
      ? "Preparando…"
      : "Descargar";
    button.querySelector(".download-icon").classList.toggle("hidden", busy);
    button.querySelector(".download-spinner").classList.toggle("hidden", !busy);
  });
}
function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        s
      ],
  );
}
function seconds(value) {
  if (!Number.isFinite(Number(value)) || value < 0) return "0:00";
  const n = Math.floor(value);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
function parseTime(value) {
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^\d+:\d{1,2}(?:\.\d+)?$/.test(text)) {
    const [m, s] = text.split(":").map(Number);
    return s < 60 ? m * 60 + s : NaN;
  }
  return NaN;
}
function hash(value) {
  let h = 2166136261;
  for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
function normalizeTrack(track) {
  return {
    id: trackIdentity(track),
    title: String(track.title || "Sin título"),
    artist: String(track.artist || "Artista desconocido"),
    duration: Math.max(0, Number(track.duration) || 0),
    bpm: Number(track.bpm) || null,
    key: /^([1-9]|1[0-2])[AB]$/.test(track.key) ? track.key : null,
    genre: String(track.genre || ""),
    url: String(track.url || ""),
    search_query: String(track.search_query || ""),
    thumbnail: safeImage(track.thumbnail),
    source: String(track.source || (track.localBlobUrl ? "Local" : "")),
    localId:
      track.localId ||
      (track.localBlobUrl ? `legacy_${track.id || hash(track.title)}` : null),
    isRealAudioAnalyzed: Boolean(track.isRealAudioAnalyzed),
    analysis: normalizeAnalysis(track.analysis),
  };
}
function safeImage(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    storageWarning = true;
    return fallback;
  }
}
function loadState() {
  const saved = readJSON(STORAGE_KEY, null);
  if (saved && typeof saved === "object") {
    state.library = Array.isArray(saved.library)
      ? saved.library.filter(Boolean).map((t) => ({
          ...normalizeTrack(t),
          id: t.id || t.uid || trackIdentity(t),
        }))
      : [];
    state.playlists = Array.isArray(saved.playlists)
      ? saved.playlists
          .filter((p) => p && Array.isArray(p.trackIds))
          .map((p) => ({ ...p, title: String(p.title || "Playlist") }))
      : [];
    state.queue = Array.isArray(saved.queue)
      ? saved.queue
          .filter((q) => q?.track)
          .map((q) => ({ ...q, track: normalizeTrack(q.track) }))
      : [];
    state.imported =
      saved.imported && Array.isArray(saved.imported.tracks)
        ? {
            ...saved.imported,
            tracks: saved.imported.tracks.map(normalizeTrack),
          }
        : null;
    state.favorites = Array.isArray(saved.favorites) ? saved.favorites : [];
    state.fade = Number.isFinite(saved.fade)
      ? Math.min(16, Math.max(0, saved.fade))
      : 6;
    state.automix = saved.automix !== false;
    state.mixName = String(saved.mixName || state.mixName);
    state.volume = Number.isFinite(saved.volume)
      ? Math.min(1, Math.max(0, saved.volume))
      : 0.85;
  } else {
    // Read older collections without deleting any of the user's existing storage.
    const legacy = readJSON(
      "musiksml_clean_library_v3",
      readJSON("musiksml_library", []),
    );
    state.library = Array.isArray(legacy) ? legacy.map(normalizeTrack) : [];
    const queue = readJSON("musiksml_clean_queue_v3", []);
    state.queue = Array.isArray(queue)
      ? queue.map((t) => ({ track: normalizeTrack(t), start: 0, end: null }))
      : [];
  }
  repairCollections();
}
function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        library: state.library,
        playlists: state.playlists,
        imported: state.imported,
        queue: state.queue,
        favorites: state.favorites,
        fade: state.fade,
        automix: state.automix,
        mixName: state.mixName,
        volume: state.volume,
      }),
    );
    return true;
  } catch {
    toast(
      "No hay espacio para guardar los cambios. Se conservarán en esta pestaña, pero no al recargar.",
    );
    return false;
  }
}
let dbPromise;
function openAudioDB() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("musiksml_audio", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("El almacenamiento de audio está bloqueado."));
    });
  return dbPromise;
}
async function putAudio(id, file) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function getAudio(id) {
  if (sessionFiles.has(id)) return sessionFiles.get(id);
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function mediaURL(track, mode = "inline") {
  if (track.localId) {
    if (!localURLs.has(track.localId)) {
      const blob = await getAudio(track.localId);
      if (!blob)
        throw new Error(
          `Vuelve a añadir el archivo «${track.title}». Su audio no está guardado en este navegador.`,
        );
      localURLs.set(track.localId, URL.createObjectURL(blob));
    }
    return localURLs.get(track.localId);
  }
  const params = new URLSearchParams({ mode });
  let isYoutube = false;
  try {
    isYoutube = /(^|\.)youtube\.com$|^youtu\.be$/.test(
      new URL(track.url).hostname,
    );
  } catch {}
  if (isYoutube) params.set("url", track.url);
  else
    params.set(
      "query",
      track.search_query || `${track.artist} - ${track.title} official audio`,
    );
  return `${API_BASE}/api/media?${params}`;
}
async function request(url, options = {}, timeout = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const externalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", externalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : body.detail?.message ||
              `No se pudo completar la solicitud (${response.status}).`,
      );
    }
    // Consume bodies here so timeouts and cancellation also cover audio downloads.
    return options.audio ? await response.arrayBuffer() : await response.json();
  } catch (error) {
    if (error.name === "AbortError" && !options.signal?.aborted)
      throw new Error("La solicitud tardó demasiado. Inténtalo otra vez.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", externalAbort);
  }
}
function switchView(id) {
  if (!$(id)?.classList.contains("view")) return;
  state.view = id;
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = el.id !== id;
    el.classList.toggle("active", el.id === id);
  });
  document.querySelectorAll(".nav-link").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === id);
    if (el.dataset.view === id) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "instant" });
  $("main").focus({ preventScroll: true });
  render();
}
function addToLibrary(tracks) {
  for (const track of tracks) {
    const idx = state.library.findIndex((t) => t.id === track.id);
    if (idx < 0) state.library.push(track);
    else state.library[idx] = mergeTrack(state.library[idx], track);
  }
}
function saveImportedPlaylist() {
  const imported = state.imported;
  if (!imported?.tracks.length) return false;
  addToLibrary(imported.tracks);
  const playlist = {
    id: imported.id,
    title: imported.title,
    source: imported.source,
    trackIds: [...new Set(imported.tracks.map((t) => t.id))],
  };
  const idx = state.playlists.findIndex((p) => p.id === playlist.id);
  if (idx < 0) state.playlists.unshift(playlist);
  else state.playlists[idx] = playlist;
  return persist();
}
function addToQueue(tracks) {
  let added = 0;
  for (const track of tracks) {
    if (!state.queue.some((q) => q.track.id === track.id)) {
      state.queue.push({
        track,
        start: 0,
        end: null,
        fadeOut: null,
        levelDb: 0,
        edited: false,
      });
      added++;
    }
  }
  persist();
  render();
  engine.preloadNext();
  return added;
}
function favorite(track) {
  if (state.favorites.includes(track.id))
    state.favorites = state.favorites.filter((id) => id !== track.id);
  else {
    state.favorites.push(track.id);
    addToLibrary([track]);
  }
  persist();
  render();
  updatePlayer();
}
function imageArt(el, track) {
  paintArtwork(el, track);
}
function empty(container, title, text, actionView = null, action = "") {
  container.innerHTML = `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">↝</span><h2>${escapeHTML(title)}</h2><p>${escapeHTML(text)}</p>${actionView ? `<button class="button secondary" data-view="${actionView}">${escapeHTML(action)}</button>` : ""}</div>`;
}
function renderTrack(track, context, index) {
  const row = document.createElement("article");
  row.className = `track-row${engine.track?.id === track.id ? " playing" : ""}`;
  row.dataset.trackId = track.id;
  const inQueue = state.queue.some((q) => q.track.id === track.id);
  const isFavorite = state.favorites.includes(track.id);
  const title = escapeHTML(track.title);
  row.innerHTML = `<button class="track-play" aria-label="Reproducir ${title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg></button>
    <div class="track-art tone-${index % 5}" aria-hidden="true"></div>
    <div class="track-main"><strong class="track-title" title="${title}">${title}</strong><div class="track-artist">${escapeHTML(track.artist)}</div></div>
    <div class="track-metrics" title="${track.isRealAudioAnalyzed ? "Audio analizado" : "Tempo y tonalidad orientativos"}"><span>${track.bpm ? Math.round(track.bpm) : "—"} BPM</span><span class="track-key">${escapeHTML(track.key || "—")}</span><span class="track-duration">${track.duration ? seconds(track.duration) : "—:—"}</span></div>
    <div class="track-actions">${context === "queue" ? `<div class="queue-order"><button class="move-up" aria-label="Subir ${title}" ${index === 0 ? "disabled" : ""}>↑</button><button class="move-down" aria-label="Bajar ${title}" ${index === state.queue.length - 1 ? "disabled" : ""}>↓</button></div><button class="icon-button remove-track" aria-label="Quitar ${title} de la sesión">×</button>${downloadButton(track)}` : `<button class="icon-button favorite ${isFavorite ? "is-favorite" : ""}" aria-label="${isFavorite ? "Quitar" : "Añadir"} ${title} ${isFavorite ? "de" : "a"} favoritas" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button><button class="small-button add-mix ${inQueue ? "added" : ""}" ${inQueue ? "disabled" : ""}>${inQueue ? "En mix ✓" : "＋ Mix"}</button>${downloadButton(track)}`}</div>`;
  imageArt(row.querySelector(".track-art"), track);
  row.querySelector(".track-play").onclick = () => {
    if (engine.transition?.track.id === track.id && engine.source === context)
      engine.toggle();
    else engine.playFrom(track, context);
  };
  row.querySelector(".download-track").onclick = () => downloadTrack(track);
  if (context !== "queue") {
    if (context === "library") {
      const preview = document.createElement("div");
      preview.className = "track-preview";
      preview.setAttribute("aria-hidden", "true");
      preview.innerHTML = `<span class="preview-kicker">EN TU BIBLIOTECA</span><strong>${title}</strong><span>${escapeHTML(track.artist)}${track.duration ? ` · ${seconds(track.duration)}` : ""}</span><div class="preview-bars"><i></i><i></i><i></i><i></i><i></i></div>`;
      row.append(preview);
    }
    row.querySelector(".favorite").onclick = () => favorite(track);
    row.querySelector(".add-mix").onclick = () => {
      addToQueue([track]);
      toast("Canción añadida a tu sesión.");
    };
  } else {
    row.querySelector(".remove-track").onclick = () => {
      if (engine.source === "queue" && engine.track?.id === track.id)
        engine.stop();
      else if (engine.transition?.track.id === track.id) engine.cancelFade();
      state.queue.splice(index, 1);
      persist();
      render();
      engine.preloadNext();
    };
    const move = (offset) => {
      [state.queue[index], state.queue[index + offset]] = [
        state.queue[index + offset],
        state.queue[index],
      ];
      persist();
      render();
      engine.preloadNext();
    };
    row.querySelector(".move-up").onclick = () => move(-1);
    row.querySelector(".move-down").onclick = () => move(1);
    const q = state.queue[index];
    makeClipEditor(row, q, index);
  }
  return row;
}
function fragmentDuration(q) {
  return Math.max(0, (q.end ?? q.track.duration ?? 0) - (q.start || 0));
}
function transitionDuration(
  a,
  b,
  fade = state.automix ? (a?.fadeOut ?? state.fade) : 0,
) {
  if (!a || !b) return 0;
  return Math.max(
    0,
    Math.min(fade, fragmentDuration(a) / 2, fragmentDuration(b) / 2),
  );
}
function sessionDuration() {
  return state.queue.reduce(
    (sum, q, i) =>
      sum +
      fragmentDuration(q) -
      (i ? transitionDuration(state.queue[i - 1], q) : 0),
    0,
  );
}
function renderImported() {
  const imported = state.imported;
  $("playlistShowcase").classList.toggle("hidden", !imported?.tracks.length);
  $("importToolbar").classList.toggle("hidden", !imported?.tracks.length);
  $("homeReturn").classList.toggle("hidden", !imported?.tracks.length);
  if (!imported?.tracks.length) {
    empty(
      $("importedTracksContainer"),
      "Tu próximo descubrimiento empieza aquí.",
      "Pega un enlace arriba o añade archivos de audio desde tu dispositivo.",
    );
    return;
  }
  $("currentImportTitle").textContent = imported.title;
  $("homeImportTitle").textContent = imported.title;
  $("showcaseSourceTag").textContent = imported.source || "TU PLAYLIST";
  const durationSummary = imported.tracks.every((track) => track.duration > 0)
    ? seconds(imported.tracks.reduce((sum, track) => sum + track.duration, 0))
    : "Duración disponible al reproducir";
  $("showcaseStatsRow").textContent =
    `${imported.tracks.length} canciones · ${durationSummary}`;
  const saved = state.playlists.some((p) => p.id === imported.id);
  $("saveAllToLibBtn").textContent = saved
    ? "Actualizar playlist ✓"
    : "Guardar playlist ＋";
  $("importSavedHint").textContent = saved
    ? "En tu biblioteca · disponible en este navegador"
    : "Guarda esta colección en tu biblioteca";
  imageArt($("showcaseCover"), imported.tracks[0]);
  $("importedTracksContainer").replaceChildren(
    ...imported.tracks.map((t, i) => renderTrack(t, "import", i)),
  );
}
function playlistTracks(playlist) {
  return playlist.trackIds
    .map((id) => state.library.find((t) => t.id === id))
    .filter(Boolean);
}
function libraryTracks() {
  let list = state.selectedPlaylist
    ? playlistTracks(
        state.playlists.find((p) => p.id === state.selectedPlaylist) || {
          trackIds: [],
        },
      )
    : [...state.library];
  if (state.onlyFavorites)
    list = list.filter((t) => state.favorites.includes(t.id));
  const query = state.search.toLocaleLowerCase();
  if (query)
    list = list.filter((t) =>
      `${t.title} ${t.artist} ${t.genre} ${t.bpm || ""} ${t.key || ""}`
        .toLocaleLowerCase()
        .includes(query),
    );
  if (state.sort === "title")
    list.sort((a, b) => a.title.localeCompare(b.title, "es"));
  else if (state.sort === "bpm")
    list.sort((a, b) => (a.bpm || 0) - (b.bpm || 0));
  else if (!state.selectedPlaylist) list.reverse();
  return list;
}
function renderLibrary() {
  $("librarySummary").textContent =
    `${state.library.length} canciones · ${state.playlists.length} playlists · guardadas en este navegador.`;
  $("libraryPlaylists").replaceChildren();
  for (const [i, p] of state.playlists.entries()) {
    const tile = document.createElement("div");
    tile.className = `playlist-tile ${state.selectedPlaylist === p.id ? "active" : ""}`;
    tile.innerHTML = `<button class="open-playlist" aria-label="Abrir playlist ${escapeHTML(p.title)}"><div class="collection-art"></div><h3>${escapeHTML(p.title)}</h3><p>${p.trackIds.length} canciones · ${escapeHTML(p.source || "Colección")}</p></button><button class="delete-playlist" aria-label="Eliminar playlist ${escapeHTML(p.title)}">×</button>`;
    imageArt(tile.querySelector(".collection-art"), playlistTracks(p)[0]);
    if (i % 2)
      tile.querySelector(".collection-art").style.background = "#d3dac8";
    tile.querySelector(".open-playlist").onclick = () => {
      state.selectedPlaylist = p.id;
      state.onlyFavorites = false;
      renderLibrary();
    };
    tile.querySelector(".delete-playlist").onclick = async () => {
      if (
        await confirmAction(
          "¿Eliminar esta playlist?",
          "Las canciones seguirán en tu biblioteca.",
          "Eliminar",
        )
      ) {
        state.playlists = state.playlists.filter((item) => item.id !== p.id);
        if (state.selectedPlaylist === p.id) state.selectedPlaylist = null;
        persist();
        render();
      }
    };
    $("libraryPlaylists").append(tile);
  }
  const playlist = state.playlists.find((p) => p.id === state.selectedPlaylist);
  $("librarySelection").classList.toggle("hidden", !playlist);
  $("selectedPlaylistTitle").textContent = playlist?.title || "";
  $("favoritesBtn").classList.toggle("active", state.onlyFavorites);
  $("allLibraryBtn").classList.toggle(
    "active",
    !state.onlyFavorites && !playlist,
  );
  const list = libraryTracks();
  if (!list.length)
    empty(
      $("libraryTracksContainer"),
      state.search
        ? "Ninguna canción con ese nombre."
        : state.onlyFavorites
          ? "Guarda lo que te mueve."
          : "Tu colección empieza contigo.",
      state.search
        ? "Prueba con otro título o artista."
        : state.onlyFavorites
          ? "Toca el corazón de una canción para encontrarla aquí."
          : "Las playlists que importes se guardarán aquí, con su nombre y sus canciones.",
      state.library.length ? null : "importView",
      "Importar mi música ↗",
    );
  else
    $("libraryTracksContainer").replaceChildren(
      ...list.map((t, i) => renderTrack(t, "library", i)),
    );
}
function renderQueue() {
  $("mixQueueContainer")
    .querySelectorAll(".track-row")
    .forEach((row) => durationObserver.unobserve(row));
  $("mixDuration").textContent =
    `${state.queue.length} canciones · ${seconds(sessionDuration())} de música`;
  $("exportMixBtn").disabled = !state.queue.length || Boolean(exportJob);
  $("smartSortQueueBtn").disabled =
    state.queue.length < 2 || Boolean(exportJob);
  $("clearQueueBtn").disabled = !state.queue.length || Boolean(exportJob);
  for (const id of ["crossfadeSlider", "automixToggle", "mixNameInput"]) {
    $(id).disabled = Boolean(exportJob);
  }
  if (!state.queue.length)
    empty(
      $("mixQueueContainer"),
      "La próxima sesión lleva tu nombre.",
      "Añade canciones con «＋ Mix». Después elige el orden y ajusta tus transiciones.",
      "libraryView",
      "Elegir canciones ↗",
    );
  else
    $("mixQueueContainer").replaceChildren(
      ...state.queue.map((q, i) => renderTrack(q.track, "queue", i)),
    );
  if (exportJob) {
    $("mixQueueContainer")
      .querySelectorAll("input, button")
      .forEach((el) => {
        el.disabled = true;
      });
  }
  refreshSessionOverview();
  if (state.view === "mixView") {
    for (const q of state.queue.slice(0, 2)) {
      if (!q.track.duration && !attemptedDurations.has(q.track.id)) {
        attemptedDurations.add(q.track.id);
        loadClipAudio(q);
      }
    }
  }
  updateStudio();
}
function render() {
  $("libCountBadge").textContent = state.library.length;
  $("queueCountBadge").textContent = state.queue.length;
  renderImported();
  renderLibrary();
  renderQueue();
}
function compatibility(a, b) {
  if (!a || !b) return { score: 0, label: "TRANSICIÓN SUAVE" };
  const aBpm = a.analysis?.bpm || (a.isRealAudioAnalyzed ? a.bpm : null);
  const bBpm = b.analysis?.bpm || (b.isRealAudioAnalyzed ? b.bpm : null);
  if (!aBpm || !bBpm) return { score: 0, label: "CRUCE SUAVE" };
  const diff = Math.abs(aBpm - bBpm);
  if (!a.isRealAudioAnalyzed || !b.isRealAudioAnalyzed || !a.key || !b.key)
    return {
      score: 40 - diff * 3,
      label: diff <= 8 ? "RITMOS CERCANOS" : "CRUCE BREVE",
    };
  const an = parseInt(a.key),
    bn = parseInt(b.key);
  const harmonic =
    a.key === b.key ||
    (a.key.slice(-1) === b.key.slice(-1) &&
      [1, 11].includes(Math.abs(an - bn))) ||
    (an === bn && a.key.slice(-1) !== b.key.slice(-1));
  return {
    score: (harmonic ? 100 : 20) - diff * 3,
    label: harmonic && diff <= 8 ? "TONOS COMPATIBLES" : "TRANSICIÓN SUAVE",
  };
}
function smartSort() {
  if (state.queue.length < 2) return;
  const pool = [...state.queue];
  const sorted = [pool.shift()];
  while (pool.length) {
    let best = 0;
    for (let i = 1; i < pool.length; i++)
      if (
        compatibility(sorted.at(-1).track, pool[i].track).score >
        compatibility(sorted.at(-1).track, pool[best].track).score
      )
        best = i;
    sorted.push(pool.splice(best, 1)[0]);
  }
  state.queue = sorted;
  persist();
  render();
  engine.preloadNext();
  toast(
    "Orden sugerido con los datos de audio disponibles. Puedes mover cada canción.",
  );
}

// Two media decks feed Web Audio gains. iOS can ignore Audio.volume;
// gain nodes also let both decks pause and resume without jumping the fade.
class AudioMixer {
  constructor() {
    this.decks = [new Audio(), new Audio()];
    this.active = this.decks[0];
    this.standby = this.decks[1];
    this.track = null;
    this.source = "import";
    this.list = [];
    this.context = null;
    this.nodes = new Map();
    this.filters = new Map();
    this.master = null;
    this.transition = null;
    this.revision = 0;
    this.preloadRevision = 0;
    this.prepared = null;
    this.loading = false;
    this.advancing = false;
    for (const deck of this.decks) {
      deck.crossOrigin = "anonymous";
      deck.preload = "auto";
      deck.addEventListener("loadedmetadata", () => {
        const track = deck._track;
        if (track && Number.isFinite(deck.duration)) {
          refreshTrackDuration(track, deck.duration);
        }
      });
      deck.addEventListener("ended", () => {
        if (
          this.transition &&
          [this.transition.outgoing, this.transition.incoming].includes(deck)
        )
          this.finishFade();
        if (
          deck === this.active &&
          !this.transition &&
          !this.loading &&
          !this.advancing
        )
          this.next(false);
      });
      deck.addEventListener("error", () => {
        if (deck === this.active && !this.loading && !deck._waiting) {
          this.cancelFade();
          toast(
            "No se pudo reproducir el audio. Prueba de nuevo o elige otra canción.",
          );
          updatePlayer();
        }
      });
      for (const event of ["play", "pause", "waiting", "playing"])
        deck.addEventListener(event, () => {
          if (deck === this.active) updatePlayer();
        });
    }
    setInterval(() => this.tick(), 70);
  }
  async initialize() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext)
        throw new Error(
          "Este navegador no permite mezclar audio. Prueba con Safari, Chrome o Firefox actualizado.",
        );
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = state.volume;
      this.master.connect(this.context.destination);
      for (const deck of this.decks) {
        const source = this.context.createMediaElementSource(deck);
        const gain = this.context.createGain();
        const bass = this.context.createBiquadFilter();
        bass.type = "lowshelf";
        bass.frequency.value = 180;
        source.connect(bass);
        bass.connect(gain);
        gain.connect(this.master);
        this.nodes.set(deck, gain);
        this.filters.set(deck, bass);
      }
    }
    if (this.context.state === "suspended") await this.context.resume();
  }
  gain(deck, value) {
    if (this.nodes.has(deck)) {
      const gain = this.nodes.get(deck).gain;
      gain.cancelScheduledValues(this.context.currentTime);
      gain.setTargetAtTime(value, this.context.currentTime, 0.015);
    }
  }
  trackGain(track, source = this.source) {
    return source === "queue" ? clipGain(queueEntry(track)) : 1;
  }
  refreshGains() {
    if (this.transition) {
      if (this.transition.manual || this.active.paused) this.holdFade();
      else this.scheduleFade();
    } else if (this.track) this.gain(this.active, this.trackGain(this.track));
  }
  holdFade() {
    const t = this.transition;
    if (!t) return;
    const p = t.manual ? t.position : Math.min(1, t.elapsed / t.duration);
    this.gain(
      t.outgoing,
      Math.cos((p * Math.PI) / 2) * this.trackGain(this.track),
    );
    this.gain(
      t.incoming,
      Math.sin((p * Math.PI) / 2) * this.trackGain(t.track, t.source),
    );
    for (const [deck, bass] of [
      [t.outgoing, -12 * p],
      [t.incoming, -12 * (1 - p)],
    ]) {
      const param = this.filters.get(deck)?.gain;
      if (param) {
        param.cancelScheduledValues(this.context.currentTime);
        param.setTargetAtTime(bass, this.context.currentTime, 0.02);
      }
    }
  }
  scheduleFade() {
    const t = this.transition;
    if (!t || t.manual) return this.holdFade();
    const remaining = Math.max(0.01, t.duration - t.elapsed);
    const from = Math.min(1, t.elapsed / t.duration);
    for (const [deck, incoming, level] of [
      [t.outgoing, false, this.trackGain(this.track)],
      [t.incoming, true, this.trackGain(t.track, t.source)],
    ]) {
      const curve = Float32Array.from({ length: 128 }, (_, i) => {
        const p = from + ((1 - from) * i) / 127;
        return (
          level *
          (incoming ? Math.sin((p * Math.PI) / 2) : Math.cos((p * Math.PI) / 2))
        );
      });
      const gain = this.nodes.get(deck).gain;
      gain.cancelScheduledValues(this.context.currentTime);
      gain.setValueCurveAtTime(curve, this.context.currentTime, remaining);
      const bass = this.filters.get(deck).gain;
      bass.cancelScheduledValues(this.context.currentTime);
      bass.setValueAtTime(
        incoming ? -12 * (1 - from) : -12 * from,
        this.context.currentTime,
      );
      bass.linearRampToValueAtTime(
        incoming ? 0 : -12,
        this.context.currentTime + remaining,
      );
    }
  }
  async manualBridge(position = 0) {
    if (!this.track || this.source !== "queue" || !this.nextTrack())
      return toast(
        "Reproduce una sesión con al menos dos canciones para usar el cruce manual.",
      );
    if (!this.transition?.manual) {
      if (this.active.paused)
        return toast("Reproduce el tema A antes de cargar el cruce manual.");
      if (this.transition || this.loading) return;
      await this.start(this.nextTrack(), true, null, {
        manual: true,
        position,
      });
    } else {
      this.transition.position = position;
      this.holdFade();
      if (position >= 1) this.finishFade();
    }
  }
  volume(value) {
    state.volume = value;
    if (this.master)
      this.master.gain.setValueAtTime(value, this.context.currentTime);
  }
  playlist() {
    return this.source === "queue"
      ? state.queue.map((q) => q.track)
      : this.list;
  }
  nextTrack() {
    const list = this.playlist();
    const idx = list.findIndex((t) => t.id === this.track?.id);
    return idx < 0 ? null : list[idx + 1] || null;
  }
  trim(track, source = this.source) {
    const q =
      source === "queue"
        ? state.queue.find((q) => q.track.id === track.id)
        : null;
    return {
      start: q?.start || 0,
      end: q?.end ?? (track.duration || Infinity),
    };
  }
  waitReady(deck, url, track) {
    if (deck._url === url && deck.readyState >= 3) {
      deck._track = track;
      return Promise.resolve();
    }
    if (deck._url === url && deck._waiting) return deck._waiting;
    deck._cancelWait?.();
    deck._url = url;
    deck._track = track;
    const ready = new Promise((resolve, reject) => {
      let timeout;
      const clean = () => {
        clearTimeout(timeout);
        deck.removeEventListener("canplay", onReady);
        deck.removeEventListener("error", onError);
        deck._cancelWait = null;
      };
      const onReady = () => {
        clean();
        resolve();
      };
      const onError = () => {
        clean();
        reject(
          new Error(`No se pudo cargar «${track.title}». Inténtalo de nuevo.`),
        );
      };
      deck._cancelWait = () => {
        clean();
        reject(new DOMException("Carga reemplazada", "AbortError"));
      };
      deck.addEventListener("canplay", onReady);
      deck.addEventListener("error", onError);
      timeout = setTimeout(() => {
        clean();
        reject(
          new Error("El audio tardó demasiado en cargar. Inténtalo de nuevo."),
        );
      }, 90000);
      deck.src = url;
      deck.load();
    });
    deck._waiting = ready;
    ready
      .finally(() => {
        if (deck._waiting === ready) deck._waiting = null;
      })
      .catch(() => {});
    return ready;
  }
  async preloadNext() {
    if (this.transition || this.loading) return;
    const revision = ++this.preloadRevision;
    const next = this.nextTrack();
    this.prepared = null;
    if (!next) {
      this.standby._cancelWait?.();
      this.standby.pause();
      return;
    }
    try {
      const url = await mediaURL(next);
      if (revision !== this.preloadRevision || this.transition || this.loading)
        return;
      const deck = this.standby;
      await this.waitReady(deck, url, next);
      if (revision !== this.preloadRevision) return;
      deck.currentTime = this.trim(next).start;
      this.prepared = next.id;
    } catch {
      /* A failed prefetch is retried explicitly at playback, with a visible error. */
    }
  }
  async playFrom(track, source = "import") {
    if (this.track?.id === track.id && this.source === source && !this.loading)
      return this.toggle();
    const list =
      source === "queue"
        ? state.queue.map((q) => q.track)
        : source === "library"
          ? libraryTracks()
          : state.imported?.tracks || [track];
    return this.start(track, false, { source, list: [...list] });
  }
  async start(track, fade = false, playback = null, manual = null) {
    const revision = ++this.revision;
    this.preloadRevision++;
    this.cancelFade();
    this.loading = true;
    $("playerState").textContent = "CARGANDO…";
    $("studioStatus").lastChild.textContent = " CARGANDO AUDIO";
    const incoming = this.standby;
    const outgoing = this.active;
    const source = playback?.source || this.source;
    const list = playback?.list || this.list;
    try {
      await this.initialize();
      const url = await mediaURL(track);
      if (revision !== this.revision) return;
      await this.waitReady(incoming, url, track);
      if (revision !== this.revision) return;
      const trim = this.trim(track, source);
      if (trim.start >= incoming.duration || trim.end <= trim.start)
        throw new Error(
          "El fragmento está fuera de la canción. Ajusta su inicio y final.",
        );
      incoming.currentTime = trim.start;
      this.gain(incoming, 0);
      await incoming.play();
      if (revision !== this.revision) return;
      const remaining = Math.max(
        0,
        Math.min(
          outgoing.duration,
          this.track ? this.trim(this.track).end : 0,
        ) - outgoing.currentTime,
      );
      const nextDuration = Math.min(incoming.duration, trim.end) - trim.start;
      const outgoingEntry =
        this.source === "queue"
          ? queueEntry(this.track)
          : { track: this.track, ...this.trim(this.track || {}) };
      const incomingEntry =
        source === "queue" ? queueEntry(track) : { track, ...trim };
      const plannedFade = this.track
        ? transitionDuration(
            outgoingEntry,
            incomingEntry,
            outgoingEntry?.fadeOut ?? state.fade,
          )
        : 0;
      const duration =
        fade && !outgoing.paused && this.track
          ? Math.min(plannedFade, remaining, nextDuration / 2)
          : 0;
      if (duration > 0.05 || (manual && !outgoing.paused && remaining > 0.1)) {
        this.transition = {
          outgoing,
          incoming,
          track,
          source,
          list,
          duration: Math.max(0.1, duration),
          elapsed: 0,
          lastTime: this.context.currentTime,
          manual: Boolean(manual),
          position: manual ? Number($("manualCrossfader").value) / 100 : 0,
        };
        this.scheduleFade();
      } else {
        outgoing.pause();
        this.gain(outgoing, 0);
        this.active = incoming;
        this.standby = outgoing;
        this.track = track;
        this.source = source;
        this.list = list;
        this.gain(incoming, this.trackGain(track, source));
        this.prepared = null;
      }
      this.loading = false;
      this.advancing = false;
      render();
      updatePlayer();
      this.preloadNext();
      return true;
    } catch (error) {
      if (revision === this.revision) {
        incoming.pause();
        this.gain(outgoing, this.track ? this.trackGain(this.track) : 1);
        this.loading = false;
        this.advancing = false;
        if (error.name !== "AbortError") toast(error.message);
        updatePlayer();
        updateStudio();
      }
    } finally {
      if (revision === this.revision) this.loading = false;
    }
  }
  cancelFade() {
    if (!this.transition) return;
    this.transition.incoming.pause();
    this.gain(this.transition.incoming, 0);
    this.gain(this.transition.outgoing, this.trackGain(this.track));
    for (const filter of this.filters.values()) {
      filter.gain.cancelScheduledValues(this.context.currentTime);
      filter.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.transition = null;
    $("bridgeProgressFill").style.width = "0%";
    $("manualCrossfader").value = 0;
  }
  stop() {
    this.revision++;
    this.preloadRevision++;
    this.cancelFade();
    for (const deck of this.decks) {
      deck._cancelWait?.();
      deck.pause();
      this.gain(deck, 0);
    }
    this.track = null;
    this.loading = false;
    this.advancing = false;
    this.prepared = null;
    updatePlayer();
  }
  finishFade() {
    const t = this.transition;
    if (!t) return;
    this.transition = null;
    t.outgoing.pause();
    this.gain(t.outgoing, 0);
    this.active = t.incoming;
    this.standby = t.outgoing;
    this.track = t.track;
    this.source = t.source;
    this.list = t.list;
    this.gain(this.active, this.trackGain(this.track));
    for (const filter of this.filters.values()) {
      filter.gain.cancelScheduledValues(this.context.currentTime);
      filter.gain.setValueAtTime(0, this.context.currentTime);
    }
    this.advancing = false;
    this.prepared = null;
    $("bridgeProgressFill").style.width = "0%";
    $("manualCrossfader").value = 0;
    render();
    updatePlayer();
    this.preloadNext();
  }
  tick() {
    if (this.transition) {
      const t = this.transition,
        now = this.context.currentTime;
      if (!t.incoming.paused && !t.manual)
        t.elapsed += Math.max(0, now - t.lastTime);
      t.lastTime = now;
      const p = t.manual ? t.position : Math.min(1, t.elapsed / t.duration);
      $("bridgeProgressFill").style.width = `${p * 100}%`;
      if (
        p >= 1 ||
        (t.manual &&
          !t.outgoing.paused &&
          t.outgoing.currentTime >=
            Math.min(t.outgoing.duration, this.trim(this.track).end) - 0.08)
      )
        this.finishFade();
    }
    if (!this.track) return;
    const trim = this.trim(this.track);
    const end = Math.min(this.active.duration || Infinity, trim.end);
    const duration = end - trim.start;
    const elapsed = Math.max(0, this.active.currentTime - trim.start);
    $("currentTimeLabel").textContent = seconds(elapsed);
    $("totalTimeLabel").textContent = Number.isFinite(duration)
      ? seconds(duration)
      : "—";
    $("seekSlider").disabled = !Number.isFinite(duration) || duration <= 0;
    if (document.activeElement !== $("seekSlider"))
      $("seekSlider").value =
        duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
    if (
      !this.active.paused &&
      !this.transition &&
      !this.loading &&
      !this.advancing
    ) {
      const remaining = end - this.active.currentTime;
      const next = this.nextTrack();
      const a =
        this.source === "queue"
          ? queueEntry(this.track)
          : { track: this.track, ...trim };
      const b =
        this.source === "queue"
          ? queueEntry(next)
          : next
            ? { track: next, ...this.trim(next) }
            : null;
      const overlap = transitionDuration(a, b);
      if (
        next &&
        state.automix &&
        overlap > 0 &&
        this.prepared === next.id &&
        remaining <= overlap
      )
        this.next(true);
      else if (remaining <= 0.08) {
        this.active.pause();
        if (next) this.next(false);
        else updatePlayer();
      }
    }
  }
  async next(fade = true) {
    if (this.loading || this.advancing) return;
    if (this.transition) {
      this.finishFade();
      return;
    }
    const next = this.nextTrack();
    if (!next) {
      toast("Llegaste al final de la sesión.");
      updatePlayer();
      return;
    }
    this.advancing = true;
    await this.start(next, fade);
  }
  previous() {
    const list = this.playlist();
    const idx = list.findIndex((t) => t.id === this.track?.id);
    if (
      this.active.currentTime - (this.track ? this.trim(this.track).start : 0) >
        3 ||
      idx <= 0
    ) {
      this.seek(0);
      return;
    }
    this.start(list[idx - 1], false);
  }
  async toggle() {
    if (this.loading) {
      this.revision++;
      this.loading = false;
      this.advancing = false;
      this.standby._cancelWait?.();
      this.standby.pause();
      updatePlayer();
      return;
    }
    if (!this.track) {
      const first =
        state.queue[0]?.track || state.imported?.tracks[0] || state.library[0];
      if (first)
        return this.playFrom(
          first,
          state.queue.length
            ? "queue"
            : state.imported?.tracks.length
              ? "import"
              : "library",
        );
      toast("Añade una canción para empezar.");
      return;
    }
    if (this.active.paused) {
      try {
        await this.initialize();
        if (
          this.active.ended ||
          this.active.currentTime >= this.trim(this.track).end - 0.05
        )
          this.active.currentTime = this.trim(this.track).start;
        if (this.transition) {
          this.transition.lastTime = this.context.currentTime;
          await this.transition.incoming.play();
        }
        await this.active.play();
        if (this.transition) {
          this.transition.lastTime = this.context.currentTime;
          this.scheduleFade();
        }
      } catch {
        toast(
          "No se pudo iniciar el audio. Toca reproducir para intentarlo otra vez.",
        );
      }
    } else {
      if (this.transition) {
        if (!this.transition.manual)
          this.transition.elapsed = Math.min(
            this.transition.duration,
            this.transition.elapsed +
              Math.max(0, this.context.currentTime - this.transition.lastTime),
          );
        this.holdFade();
      }
      this.active.pause();
      this.transition?.incoming.pause();
    }
    updatePlayer();
  }
  seek(percent) {
    if (!this.track) return;
    this.cancelFade();
    const trim = this.trim(this.track);
    const end = Math.min(this.active.duration, trim.end);
    if (Number.isFinite(end))
      this.active.currentTime =
        trim.start + ((end - trim.start) * percent) / 100;
    this.preloadNext();
  }
  applyTrim() {
    this.cancelFade();
    const trim = this.trim(this.track);
    if (
      this.active.currentTime < trim.start ||
      this.active.currentTime > trim.end
    )
      this.active.currentTime = trim.start;
  }
}
const engine = new AudioMixer();
function updatePlayer() {
  const track = engine.track;
  const playing = !engine.active.paused;
  document.querySelectorAll(".track-row").forEach((row) => {
    const audible =
      playing &&
      (row.dataset.trackId === track?.id ||
        row.dataset.trackId === engine.transition?.track.id);
    row.classList.toggle("is-audible", audible);
    const button = row.querySelector(".track-play");
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${audible ? '<path d="M7 5h4v14H7zm7 0h4v14h-4Z"/>' : '<path d="m8 5 11 7-11 7Z"/>'}</svg>`;
    button.setAttribute(
      "aria-label",
      `${audible ? "Pausar" : "Reproducir"} ${row.querySelector(".track-title").textContent}`,
    );
  });
  $("playIconSvg").innerHTML = playing
    ? '<path d="M7 5h4v14H7zm7 0h4v14h-4Z"/>'
    : '<path d="m9 5 11 7-11 7Z"/>';
  $("playPauseBtn").setAttribute(
    "aria-label",
    engine.loading ? "Cancelar carga" : playing ? "Pausar" : "Reproducir",
  );
  const studioPlaying = playing && engine.source === "queue";
  $("startMixBtn").innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true">${studioPlaying ? '<path d="M7 5h4v14H7zm7 0h4v14h-4Z"/>' : '<path d="m9 5 11 7-11 7Z"/>'}</svg>`;
  $("startMixBtn").setAttribute(
    "aria-label",
    studioPlaying ? "Pausar sesión" : "Reproducir sesión",
  );
  $("playerState").textContent = engine.loading
    ? "CARGANDO…"
    : engine.transition
      ? "EN TRANSICIÓN"
      : playing
        ? "BUEN FLOW."
        : track
          ? "EN PAUSA."
          : "SIN PRISAS.";
  if (track) {
    $("playerTitle").textContent = track.title;
    $("playerArtist").textContent = track.artist;
    imageArt($("playerCover"), track);
    $("favoriteCurrentBtn").disabled = false;
    const favored = state.favorites.includes(track.id);
    $("favoriteCurrentBtn").textContent = favored ? "♥" : "♡";
    $("favoriteCurrentBtn").classList.toggle("is-favorite", favored);
    $("favoriteCurrentBtn").setAttribute("aria-pressed", String(favored));
    document.title = `${playing ? "▶ " : ""}${track.title} — musiksml`;
    document
      .querySelectorAll(".track-row")
      .forEach((row) =>
        row.classList.toggle("playing", row.dataset.trackId === track.id),
      );
    if ("mediaSession" in navigator && "MediaMetadata" in window)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
      });
  } else {
    $("playerTitle").textContent = "Tu próxima favorita";
    $("playerArtist").textContent = "Elige una canción para empezar";
    imageArt($("playerCover"), null);
    $("favoriteCurrentBtn").disabled = true;
    $("favoriteCurrentBtn").textContent = "♡";
    $("favoriteCurrentBtn").classList.remove("is-favorite");
    $("currentTimeLabel").textContent = $("totalTimeLabel").textContent =
      "0:00";
    $("seekSlider").value = 0;
    $("seekSlider").disabled = true;
    document.title = "musiksml — Tu música, sin pausas.";
  }
  updateStudio();
}
function updateStudio() {
  const inSession = engine.source === "queue" && Boolean(engine.track);
  const a = inSession ? engine.track : state.queue[0]?.track;
  const b = inSession
    ? engine.transition?.track || engine.nextTrack()
    : state.queue[1]?.track;
  for (const [suffix, t] of [
    ["A", a],
    ["B", b],
  ]) {
    $(`deck${suffix}Title`).textContent =
      t?.title || (suffix === "A" ? "Tu primera canción" : "El siguiente tema");
    $(`deck${suffix}Meta`).textContent =
      t?.artist ||
      (suffix === "A" ? "Añade música a la sesión" : "Sin canciones en espera");
    const tempo = t?.analysis?.bpm || (t?.isRealAudioAnalyzed ? t.bpm : null);
    $(`deck${suffix}Metrics`).textContent =
      `${tempo ? Math.round(tempo) : "—"} BPM · ${t?.isRealAudioAnalyzed ? t.key || "—" : t?.analysis ? "audio listo" : "audio por preparar"}`;
    imageArt($(`deckArt${suffix}`), t);
    $(`deckArt${suffix}`).parentElement.classList.toggle(
      "is-playing",
      inSession &&
        !engine.active.paused &&
        (suffix === "A" || Boolean(engine.transition)),
    );
  }
  $("bridgeCompatibilityBadge").textContent =
    inSession && engine.transition
      ? "MEZCLANDO…"
      : a && b
        ? compatibility(a, b).label
        : "A TU RITMO";
  $("studioStatus").lastChild.textContent =
    inSession && engine.loading
      ? " CARGANDO AUDIO"
      : inSession && engine.transition
        ? " EN TRANSICIÓN"
        : !inSession || engine.active.paused
          ? " LISTO PARA ESCUCHAR"
          : " EN REPRODUCCIÓN";
  $("manualCrossfader").disabled =
    !inSession ||
    !b ||
    engine.loading ||
    Boolean(engine.transition && !engine.transition.manual) ||
    (!engine.transition && engine.active.paused);
  $("cueNextMixBtn").disabled =
    !inSession ||
    !b ||
    engine.loading ||
    Boolean(engine.transition) ||
    engine.active.paused;
  $("nextMixBtn").disabled = !inSession || !b || engine.loading;
  $("manualMixHint").textContent = engine.transition?.manual
    ? "Cruce manual activo · mueve de A hacia B. Al llegar a B, la siguiente canción toma el relevo."
    : "Prueba el cruce en vivo con A y B. Para el archivo exportado, ajusta los tiempos y las transiciones de cada tema abajo.";
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function safeFilename(name) {
  return (
    String(name)
      .replace(/[\\/:*?"<>|]/g, "")
      .trim()
      .slice(0, 150) || "musiksml"
  );
}
async function downloadTrack(track) {
  if (downloadingTracks.has(track.id)) return false;
  downloadingTracks.add(track.id);
  updateDownloadButtons(track.id, true);
  try {
    let blob, extension;
    if (track.localId) {
      blob = await getAudio(track.localId);
      if (!blob)
        throw new Error("Vuelve a añadir el archivo local para descargarlo.");
      extension =
        blob.name?.split(".").at(-1) ||
        (blob.type.includes("wav") ? "wav" : "mp3");
    } else {
      toast(`Preparando «${track.title}»…`);
      const data = await request(
        await mediaURL(track, "download"),
        { audio: true },
        180000,
      );
      blob = new Blob([data], { type: "audio/mpeg" });
      extension = "mp3";
    }
    downloadBlob(
      blob,
      `${safeFilename(`${track.artist} - ${track.title}`)}.${extension}`,
    );
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  } finally {
    downloadingTracks.delete(track.id);
    updateDownloadButtons(track.id, false);
  }
}

// Encode away from the UI thread. Peak normalization prevents clipped WAV output.
function wavWorker() {
  self.onmessage = ({ data }) => {
    const { channels, sampleRate } = data;
    const length = channels[0].length,
      count = channels.length;
    let peak = 1;
    for (const samples of channels)
      for (let i = 0; i < samples.length; i++)
        peak = Math.max(peak, Math.abs(samples[i]));
    const scale = 0.98 / peak;
    const buffer = new ArrayBuffer(44 + length * count * 2),
      view = new DataView(buffer);
    const text = (offset, value) => {
      for (let i = 0; i < value.length; i++)
        view.setUint8(offset + i, value.charCodeAt(i));
    };
    text(0, "RIFF");
    view.setUint32(4, buffer.byteLength - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, count, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * count * 2, true);
    view.setUint16(32, count * 2, true);
    view.setUint16(34, 16, true);
    text(36, "data");
    view.setUint32(40, length * count * 2, true);
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (const samples of channels) {
        const value = Math.max(-1, Math.min(1, samples[i] * scale));
        view.setInt16(
          offset,
          Math.round(value * (value < 0 ? 32768 : 32767)),
          true,
        );
        offset += 2;
      }
    }
    self.postMessage(buffer, [buffer]);
  };
}
async function exportMix() {
  if (exportJob || !state.queue.length) return;
  const job = {
    controller: new AbortController(),
    cancelled: false,
    rejectWorker: null,
  };
  exportJob = job;
  const queue = state.queue.map((q) => ({ ...q, track: { ...q.track } }));
  const fade = state.automix ? state.fade : 0,
    name = state.mixName;
  const maxBytes = 512 * 1024 * 1024,
    sampleRate = 44100;
  const ensureActive = () => {
    if (job.cancelled)
      throw new DOMException("Exportación cancelada", "AbortError");
  };
  const progress = (text, value) => {
    if (!job.cancelled) {
      $("exportStatus").textContent = text;
      $("exportProgress").value = value;
    }
  };
  $("exportPanel").classList.remove("hidden");
  renderQueue();
  const offlineConstructor =
    window.OfflineAudioContext || window.webkitOfflineAudioContext;
  let workerURL;
  try {
    if (!offlineConstructor)
      throw new Error(
        "Tu navegador no permite exportar audio. Prueba con Safari, Chrome o Firefox actualizado.",
      );
    const decodeContext = new offlineConstructor(2, 1, sampleRate);
    const entries = [];
    let decodedBytes = 0;
    for (const [index, q] of queue.entries()) {
      ensureActive();
      if (q.track.duration * sampleRate * 8 > maxBytes / 2) {
        throw new Error(
          `«${q.track.title}» es demasiado larga para procesarla en este navegador. Divide el archivo antes de añadirlo a la sesión.`,
        );
      }
      progress(
        `Preparando canción ${index + 1} de ${queue.length}: ${q.track.title}`,
        Math.round((index / queue.length) * 55),
      );
      let array;
      if (q.track.localId) {
        const file = await getAudio(q.track.localId);
        if (!file)
          throw new Error(
            `Vuelve a añadir «${q.track.title}» para incluirla en el mix.`,
          );
        if (file.size > maxBytes / 3)
          throw new Error(
            "Este archivo es demasiado grande para mezclarlo aquí. Usa un archivo más corto.",
          );
        array = await file.arrayBuffer();
      } else
        array = await request(
          await mediaURL(q.track),
          { audio: true, signal: job.controller.signal },
          180000,
        );
      ensureActive();
      if (array.byteLength > maxBytes / 3)
        throw new Error(
          "Una canción supera la memoria disponible para exportar. Usa un archivo más corto.",
        );
      let buffer;
      try {
        buffer = await decodeContext.decodeAudioData(array);
      } catch {
        throw new Error(
          `No se pudo decodificar «${q.track.title}». Usa un archivo MP3 o WAV válido.`,
        );
      }
      ensureActive();
      refreshTrackDuration(q.track, buffer.duration);
      const start = q.start || 0,
        end = q.end ?? buffer.duration;
      if (start >= end || end > buffer.duration + 0.1)
        throw new Error(
          `Revisa el fragmento de «${q.track.title}»: está fuera de la duración real.`,
        );
      const actualEnd = Math.min(end, buffer.duration);
      // Keep only the selected fragment to avoid retaining unnecessary PCM data.
      const frames = Math.floor((actualEnd - start) * sampleRate);
      const trimmed = decodeContext.createBuffer(
        Math.min(2, buffer.numberOfChannels),
        frames,
        sampleRate,
      );
      const offset = Math.floor(start * sampleRate);
      for (let c = 0; c < trimmed.numberOfChannels; c++)
        trimmed.copyToChannel(
          buffer.getChannelData(c).subarray(offset, offset + frames),
          c,
        );
      decodedBytes += frames * trimmed.numberOfChannels * 4;
      if (decodedBytes * 3 > maxBytes)
        throw new Error(
          "La mezcla supera la memoria disponible. Acorta los fragmentos o exporta la sesión en dos partes.",
        );
      entries.push({
        buffer: trimmed,
        duration: frames / sampleRate,
        start: 0,
        fadeIn: 0,
        fadeOut: 0,
        fadeSeconds: state.automix ? (q.fadeOut ?? fade) : 0,
        gain: clipGain(q),
      });
    }
    let total = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const overlap = i
        ? Math.min(
            entries[i - 1].fadeSeconds,
            entries[i - 1].duration / 2,
            entry.duration / 2,
          )
        : 0;
      entry.start = total - overlap;
      entry.fadeIn = overlap;
      if (i) entries[i - 1].fadeOut = overlap;
      total = entry.start + entry.duration;
    }
    const frames = Math.ceil(total * sampleRate);
    // Decoded inputs + rendered stereo + transfer copies + 16-bit WAV.
    if (decodedBytes + frames * 20 > maxBytes)
      throw new Error(
        "La mezcla supera la memoria disponible. Acorta los fragmentos o divídela en dos sesiones.",
      );
    ensureActive();
    progress("Uniendo canciones y suavizando transiciones…", 65);
    const offline = new offlineConstructor(2, frames, sampleRate);
    const steps = 128;
    for (const entry of entries) {
      const source = offline.createBufferSource(),
        gain = offline.createGain(),
        bass = offline.createBiquadFilter();
      source.buffer = entry.buffer;
      bass.type = "lowshelf";
      bass.frequency.value = 180;
      source.connect(bass);
      bass.connect(gain);
      gain.connect(offline.destination);
      const fadeIn = Float32Array.from(
        { length: steps },
        (_, i) => entry.gain * Math.sin(((i / (steps - 1)) * Math.PI) / 2),
      );
      const fadeOut = Float32Array.from(
        { length: steps },
        (_, i) => entry.gain * Math.cos(((i / (steps - 1)) * Math.PI) / 2),
      );
      gain.gain.setValueAtTime(entry.gain, entry.start);
      if (entry.fadeIn) {
        gain.gain.setValueCurveAtTime(fadeIn, entry.start, entry.fadeIn);
        bass.gain.setValueAtTime(-12, entry.start);
        bass.gain.linearRampToValueAtTime(0, entry.start + entry.fadeIn);
      }
      if (entry.fadeOut) {
        gain.gain.setValueCurveAtTime(
          fadeOut,
          entry.start + entry.duration - entry.fadeOut,
          entry.fadeOut,
        );
        bass.gain.setValueAtTime(
          0,
          entry.start + entry.duration - entry.fadeOut,
        );
        bass.gain.linearRampToValueAtTime(-12, entry.start + entry.duration);
      }
      source.start(entry.start);
      source.stop(entry.start + entry.duration);
    }
    const rendered = await offline.startRendering();
    ensureActive();
    progress("Preparando tu archivo WAV…", 90);
    workerURL = URL.createObjectURL(
      new Blob([`(${wavWorker.toString()})()`], { type: "text/javascript" }),
    );
    exportWorker = new Worker(workerURL);
    const channels = Array.from({ length: rendered.numberOfChannels }, (_, c) =>
      rendered.getChannelData(c).slice(),
    );
    const wav = await new Promise((resolve, reject) => {
      job.rejectWorker = reject;
      exportWorker.onmessage = (e) => resolve(e.data);
      exportWorker.onerror = () =>
        reject(
          new Error(
            "No se pudo crear el archivo WAV. Prueba con una sesión más corta.",
          ),
        );
      exportWorker.postMessage(
        { channels, sampleRate },
        channels.map((c) => c.buffer),
      );
    });
    ensureActive();
    downloadBlob(
      new Blob([wav], { type: "audio/wav" }),
      `${safeFilename(name)}.wav`,
    );
    progress(`Tu mix está listo · ${seconds(total)} · WAV estéreo`, 100);
    toast("Tu mezcla se ha descargado como una sola canción.");
  } catch (error) {
    if (error.name === "AbortError" || job.cancelled)
      progress("Exportación cancelada.", 0);
    else {
      $("exportStatus").textContent = error.message;
      toast(error.message);
    }
    if (job.cancelled) {
      $("exportStatus").textContent =
        "Exportación cancelada. Tu sesión sigue guardada.";
      $("exportProgress").value = 0;
    }
  } finally {
    exportWorker?.terminate();
    exportWorker = null;
    if (workerURL) URL.revokeObjectURL(workerURL);
    exportJob = null;
    $("cancelExportBtn").disabled = true;
    renderQueue();
  }
}
function cancelExport() {
  if (!exportJob) return;
  exportJob.cancelled = true;
  exportJob.controller.abort();
  exportJob.rejectWorker?.(new DOMException("Cancelado", "AbortError"));
  exportWorker?.terminate();
  $("exportStatus").textContent = "Cancelando…";
  $("cancelExportBtn").disabled = true;
}
function confirmAction(title, description, accept) {
  $("confirmTitle").textContent = title;
  $("confirmDescription").textContent = description;
  $("confirmAcceptBtn").textContent = accept;
  const dialog = $("confirmDialog");
  dialog.showModal();
  return new Promise((resolve) => {
    const close = () => {
      dialog.removeEventListener("close", close);
      resolve(dialog.returnValue === "accept");
    };
    dialog.returnValue = "";
    dialog.addEventListener("close", close);
  });
}
function syncSettings() {
  $("crossfadeSlider").value = state.fade;
  $("crossfadeLabel").textContent = `${state.fade} s`;
  $("automixToggle").checked = state.automix;
  $("volumeSlider").value = state.volume;
  $("mixNameInput").value = state.mixName;
}
async function importLink(event) {
  event.preventDefault();
  const input = $("urlInput").value.trim();
  let url;
  try {
    url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)spotify\.com$|(^|\.)youtube\.com$|^youtu\.be$/.test(url.hostname)
    )
      throw new Error();
  } catch {
    toast("Pega un enlace HTTPS de Spotify o YouTube.");
    return;
  }
  $("analyzeBtn").disabled = true;
  $("analyzeSpinner").classList.remove("hidden");
  $("analyzeBtnText").textContent = "Importando…";
  $("importStatusBanner").classList.remove("hidden", "error");
  $("importStatusBanner").textContent =
    "Buscando tus canciones. Las playlists grandes pueden tardar un poco.";
  try {
    const data = await request(
      `${API_BASE}/api/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.href }),
      },
      120000,
    );
    if (!Array.isArray(data.tracks) || !data.tracks.length)
      throw new Error(
        "No encontramos canciones en ese enlace. Prueba con una playlist pública.",
      );
    const tracks = data.tracks.map(normalizeTrack);
    state.imported = {
      id: `playlist_${hash(url.origin + url.pathname + (url.searchParams.has("list") ? `?list=${url.searchParams.get("list")}` : url.searchParams.has("v") ? `?v=${url.searchParams.get("v")}` : ""))}`,
      title: String(data.title || "Mi playlist"),
      source: url.hostname.includes("spotify") ? "Spotify" : "YouTube",
      url: url.href,
      tracks,
    };
    const saved = saveImportedPlaylist();
    $("importStatusBanner").classList.add("hidden");
    render();
    toast(
      saved
        ? `${tracks.length} canciones importadas. Playlist guardada en tu biblioteca.`
        : "Canciones importadas. No se pudieron guardar al recargar.",
    );
  } catch (error) {
    $("importStatusBanner").classList.add("error");
    $("importStatusBanner").textContent = error.message;
  } finally {
    $("analyzeBtn").disabled = false;
    $("analyzeSpinner").classList.add("hidden");
    $("analyzeBtnText").textContent = "Importar música";
  }
}
async function importLocal(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  $("uploadTopBtn").disabled = true;
  $("uploadImportBtn").disabled = true;
  const tracks = [];
  let failed = 0,
    unsaved = 0;
  for (const [index, file] of files.entries()) {
    toast(`Analizando archivo ${index + 1} de ${files.length}…`);
    try {
      const form = new FormData();
      form.append("file", file);
      const meta = await request(
        `${API_BASE}/api/analyze-local`,
        { method: "POST", body: form },
        120000,
      );
      const id = `local_${crypto.randomUUID ? crypto.randomUUID() : Date.now() + "_" + Math.random().toString(36).slice(2)}`;
      sessionFiles.set(id, file);
      try {
        await putAudio(id, file);
      } catch {
        unsaved++;
      }
      const track = normalizeTrack({
        id,
        localId: id,
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: "Tu archivo",
        duration: 0,
        bpm: meta.bpm,
        key: meta.key,
        genre: meta.genre,
        source: "Local",
        isRealAudioAnalyzed: true,
      });
      // Browser metadata supplies true duration; the backend analysis need not change.
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("No se pudo leer la duración del archivo.")),
            12000,
          );
          audio.onloadedmetadata = () => {
            clearTimeout(timer);
            resolve();
          };
          audio.onerror = () => {
            clearTimeout(timer);
            reject(
              new Error("Archivo de audio no compatible con este navegador."),
            );
          };
          audio.src = url;
        });
        track.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      } finally {
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
      }
      tracks.push(track);
    } catch (error) {
      failed++;
      toast(`${file.name}: ${error.message}`);
    }
  }
  if (tracks.length) {
    const previous =
      state.imported?.source === "Local" ? state.imported.tracks : [];
    state.imported = {
      id: "playlist_local",
      title: "Mis archivos",
      source: "Local",
      tracks: [...previous, ...tracks],
    };
    const saved = saveImportedPlaylist();
    switchView("importView");
    if (unsaved || !saved)
      toast(
        "Audio añadido a esta pestaña. El almacenamiento no permitió guardar todo: vuelve a añadir los archivos después de recargar.",
      );
    else
      toast(
        `${tracks.length} archivos guardados con su audio.${failed ? ` ${failed} no se pudieron importar.` : ""}`,
      );
  }
  $("uploadTopBtn").disabled = false;
  $("uploadImportBtn").disabled = false;
  event.target.value = "";
}

function initializeUI() {
  initializeTheme();
  loadState();
  syncSettings();
  render();
  if (storageWarning)
    toast(
      "No se pudieron recuperar todos los datos guardados. La información anterior no se ha borrado.",
    );
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (button) switchView(button.dataset.view);
  });
  $("uploadTopBtn").onclick = $("uploadImportBtn").onclick = () =>
    $("localFileInput").click();
  $("localFileInput").onchange = importLocal;
  $("importForm").onsubmit = importLink;
  $("pasteClipboardBtn").onclick = async () => {
    try {
      $("urlInput").value = (await navigator.clipboard.readText()).trim();
      $("urlInput").focus();
    } catch {
      $("urlInput").focus();
      toast("Mantén presionado el campo para pegar tu enlace.");
    }
  };
  $("saveAllToLibBtn").onclick = () => {
    if (saveImportedPlaylist()) toast("Playlist guardada en tu biblioteca.");
    render();
  };
  $("sendAllToMixBtn").onclick = () => {
    addToQueue(state.imported?.tracks || []);
    switchView("mixView");
  };
  $("downloadBatchBtn").onclick = async () => {
    const tracks = [...(state.imported?.tracks || [])];
    if (!tracks.length) return;
    $("downloadBatchBtn").disabled = true;
    let done = 0;
    for (const track of tracks) {
      if (!(await downloadTrack(track))) break;
      done++;
    }
    toast(`${done} de ${tracks.length} canciones descargadas.`);
    $("downloadBatchBtn").disabled = false;
  };
  $("allLibraryBtn").onclick = $("backAllBtn").onclick = () => {
    state.selectedPlaylist = null;
    state.onlyFavorites = false;
    renderLibrary();
  };
  $("favoritesBtn").onclick = () => {
    state.selectedPlaylist = null;
    state.onlyFavorites = true;
    renderLibrary();
  };
  $("librarySearch").oninput = (event) => {
    state.search = event.target.value;
    renderLibrary();
  };
  $("sortLibrarySelect").onchange = (event) => {
    state.sort = event.target.value;
    renderLibrary();
  };
  $("mixPlaylistBtn").onclick = () => {
    const playlist = state.playlists.find(
      (p) => p.id === state.selectedPlaylist,
    );
    if (playlist) {
      addToQueue(playlistTracks(playlist));
      state.mixName = playlist.title;
      persist();
      syncSettings();
      switchView("mixView");
    }
  };
  $("smartSortQueueBtn").onclick = smartSort;
  $("prepareMixBtn").onclick = prepareAutomix;
  $("cancelPrepareBtn").onclick = () => studioJob?.controller.abort();
  $("cueNextMixBtn").onclick = () => {
    $("manualCrossfader").value = 0;
    engine.manualBridge(0);
  };
  $("manualCrossfader").oninput = (event) =>
    engine.manualBridge(Number(event.target.value) / 100);
  $("clearQueueBtn").onclick = async () => {
    if (
      await confirmAction(
        "¿Vaciar la sesión?",
        "Las canciones siguen en tu biblioteca. Se borrará el orden y los fragmentos de esta sesión.",
        "Vaciar",
      )
    ) {
      state.queue = [];
      if (engine.source === "queue") engine.stop();
      persist();
      renderQueue();
      engine.preloadNext();
    }
  };
  $("confirmCancelBtn").onclick = () => $("confirmDialog").close("cancel");
  $("confirmAcceptBtn").onclick = () => $("confirmDialog").close("accept");
  $("crossfadeSlider").oninput = (event) => {
    state.fade = Number(event.target.value);
    $("crossfadeLabel").textContent = `${state.fade} s`;
    persist();
    document
      .querySelectorAll("#mixQueueContainer .track-row")
      .forEach((row) => {
        const q = row._queueEntry;
        const input = row.querySelector(".clip-fade");
        if (input && q.fadeOut == null) input.value = state.fade;
        row._refreshClip?.();
      });
    refreshSessionOverview();
  };
  $("automixToggle").onchange = (event) => {
    state.automix = event.target.checked;
    if (!state.automix) engine.cancelFade();
    persist();
    renderQueue();
  };
  $("mixNameInput").oninput = (event) => {
    state.mixName = event.target.value || "Mi sesión";
    persist();
  };
  $("startMixBtn").onclick = () => {
    if (engine.source === "queue" && engine.track) engine.toggle();
    else if (state.queue.length) engine.playFrom(state.queue[0].track, "queue");
    else toast("Añade canciones a la sesión para empezar.");
  };
  $("nextMixBtn").onclick = $("nextTrackBtn").onclick = () => engine.next(true);
  $("prevTrackBtn").onclick = () => engine.previous();
  $("playPauseBtn").onclick = () => engine.toggle();
  $("seekSlider").oninput = (event) => engine.seek(Number(event.target.value));
  $("volumeSlider").oninput = (event) => {
    engine.volume(Number(event.target.value));
    persist();
  };
  $("favoriteCurrentBtn").onclick = () => {
    if (engine.track) favorite(engine.track);
  };
  $("exportMixBtn").onclick = () => {
    $("cancelExportBtn").disabled = false;
    exportMix();
  };
  $("cancelExportBtn").onclick = cancelExport;
  if ("mediaSession" in navigator) {
    for (const [action, handler] of [
      [
        "play",
        () => {
          if (engine.active.paused) engine.toggle();
        },
      ],
      [
        "pause",
        () => {
          if (!engine.active.paused) engine.toggle();
        },
      ],
      ["nexttrack", () => engine.next(true)],
      ["previoustrack", () => engine.previous()],
    ]) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    }
  }
}
initializeUI();
