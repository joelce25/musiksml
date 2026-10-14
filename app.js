const API_BASE =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? ""
    : "https://musiksml-production.up.railway.app";

const STORAGE_KEY_LIBRARY = "musiksml_clean_library_v3";
const STORAGE_KEY_QUEUE = "musiksml_clean_queue_v3";

const CAMELOT_WHEEL = {
  "1A": ["1A", "12A", "2A", "1B"],
  "2A": ["2A", "1A", "3A", "2B"],
  "3A": ["3A", "2A", "4A", "3B"],
  "4A": ["4A", "3A", "5A", "4B"],
  "5A": ["5A", "4A", "6A", "5B"],
  "6A": ["6A", "5A", "7A", "6B"],
  "7A": ["7A", "6A", "8A", "7B"],
  "8A": ["8A", "7A", "9A", "8B"],
  "9A": ["9A", "8A", "10A", "9B"],
  "10A": ["10A", "9A", "11A", "10B"],
  "11A": ["11A", "10A", "12A", "11B"],
  "12A": ["12A", "11A", "1A", "12B"],
  "1B": ["1B", "12B", "2B", "1A"],
  "2B": ["2B", "1B", "3B", "2A"],
  "3B": ["3B", "2B", "4B", "3A"],
  "4B": ["4B", "3B", "5B", "4A"],
  "5B": ["5B", "4B", "6B", "5A"],
  "6B": ["6B", "5B", "7B", "6A"],
  "7B": ["7B", "6B", "8B", "7A"],
  "8B": ["8B", "7B", "9B", "8A"],
  "9B": ["9B", "8B", "10B", "9A"],
  "10B": ["10B", "9B", "11B", "10A"],
  "11B": ["11B", "10B", "12B", "11A"],
  "12B": ["12B", "11B", "1B", "12A"],
};

function refineGenreAndMeta(track) {
  const text = `${track.artist || ""} ${track.title || ""}`.toLowerCase();
  let genre = track.genre || "Crossover";
  let bpm = Number(track.bpm) || 100;

  const rules = [
    {
      genre: "Trap Latino",
      bpmRange: [130, 146],
      keywords: [
        "anuel", "bryant myers", "almighty", "noriel", "miky woodz", "jon z",
        "duki", "khea", "ysy a", "neo pistea", "cro", "eladio", "luar la l",
        "dei v", "omar courtz", "hades66", "yvngchimi", "trap", "drill"
      ]
    },
    {
      genre: "Hip-Hop / Rap",
      bpmRange: [84, 96],
      keywords: [
        "canserbero", "cancerbero", "2pac", "tupac", "eminem", "drake", "kendrick",
        "travis scott", "kanye", "50 cent", "snoop", "notorious", "biggie",
        "santa fe klan", "cartel de santa", "akapellah", "apache", "gera mx",
        "aleman", "trueno", "wos", "acru", "kase.o", "nach", "sfdk", "rap", "hip hop"
      ]
    },
    {
      genre: "Dembow",
      bpmRange: [116, 124],
      keywords: ["el alfa", "chimbala", "rochy rd", "tokischa", "bulin 47", "angel dior", "dembow"]
    },
    {
      genre: "Reggaeton Clásico",
      bpmRange: [92, 98],
      keywords: [
        "daddy yankee", "don omar", "tego", "wisin", "yandel", "plan b", "chencho",
        "zion", "lennox", "arcangel", "de la ghetto", "jowell", "randy", "ñengo",
        "baby rasta", "ivy queen", "alexis", "fido", "trebol clan", "dalmata", "hector"
      ]
    },
    {
      genre: "Reggaeton",
      bpmRange: [90, 100],
      keywords: [
        "bad bunny", "feid", "ferxxo", "karol g", "rauw", "myke towers", "jhayco",
        "ozuna", "j balvin", "maluma", "nicky jam", "sech", "mora", "quevedo",
        "saiko", "blessd", "ryan castro", "cris mj", "young miko", "reggaeton", "perreo"
      ]
    },
    {
      genre: "R&B / Soul",
      bpmRange: [82, 104],
      keywords: [
        "the weeknd", "sza", "frank ocean", "brent faiyaz", "daniel caesar",
        "kali uchis", "chris brown", "usher", "partynextdoor", "r&b", "soul"
      ]
    },
    {
      genre: "Tech House",
      bpmRange: [124, 128],
      keywords: [
        "fisher", "chris lake", "michael bibi", "pawsa", "cloonee", "john summit",
        "dom dolla", "mau p", "acraze", "jamie jones", "marco carola", "wade", "tech house"
      ]
    },
    {
      genre: "Techno",
      bpmRange: [132, 144],
      keywords: [
        "charlotte de witte", "amelie lens", "adam beyer", "eli brown", "sara landry",
        "nico moreno", "i hate models", "boris brejcha", "anyma", "techno"
      ]
    },
    {
      genre: "Guaracha",
      bpmRange: [128, 132],
      keywords: ["victor cardenas", "fumaratto", "guaracha", "tribal", "aleteo"]
    },
    {
      genre: "House / Dance",
      bpmRange: [122, 128],
      keywords: [
        "calvin harris", "david guetta", "tiesto", "martin garrix", "avicii", "zedd",
        "alesso", "fred again", "peggy gou", "keinemusik", "black coffee", "meduza"
      ]
    },
    {
      genre: "Cumbia",
      bpmRange: [96, 105],
      keywords: [
        "grupo 5", "agua marina", "armonia 10", "corazon serrano", "angeles azules",
        "ke personajes", "damas gratis", "amar azul", "luck ra", "cumbia"
      ]
    },
    {
      genre: "Salsa / Bachata",
      bpmRange: [98, 124],
      keywords: [
        "romeo santos", "aventura", "prince royce", "marc anthony", "hector lavoe",
        "willie colon", "grupo niche", "frankie ruiz", "eddie santiago", "salsa", "bachata"
      ]
    },
    {
      genre: "Rock / Indie",
      bpmRange: [112, 136],
      keywords: [
        "arctic monkeys", "the strokes", "tame impala", "nirvana", "linkin park",
        "queen", "metallica", "soda stereo", "cerati", "coldplay", "imagine dragons"
      ]
    },
    {
      genre: "Pop",
      bpmRange: [112, 124],
      keywords: [
        "dua lipa", "taylor swift", "bruno mars", "lady gaga", "ariana grande",
        "billie eilish", "olivia rodrigo", "rihanna", "shakira", "rosalia", "michael jackson"
      ]
    }
  ];

  for (const rule of rules) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      genre = rule.genre;
      if (!track.isRealAudioAnalyzed) {
        const seed = Array.from(text).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const span = rule.bpmRange[1] - rule.bpmRange[0] + 1;
        bpm = rule.bpmRange[0] + (seed % span);
      }
      break;
    }
  }

  return {
    ...track,
    id: track.id || track.uid || `trk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    genre,
    bpm,
    key: track.key || "8A",
  };
}

const state = {
  importedTracks: [],
  library: [],
  mixQueue: [],
  currentTrack: null,
  globalSearch: "",
  genreFilter: "ALL",
  sortBy: "recent",
  harmonicOnly: false,
  crossfadeSec: 6,
  isCrossfading: false,
};

const deckA = new Audio();
const deckB = new Audio();
deckA.crossOrigin = "anonymous";
deckB.crossOrigin = "anonymous";

let activeDeck = deckA;
let standbyDeck = deckB;
let masterVolume = 0.9;
let fadeInterval = null;

function loadPersistedState() {
  try {
    localStorage.removeItem("musiksml_library");
    localStorage.removeItem("musiksml_tracks");
    const savedLib = JSON.parse(localStorage.getItem(STORAGE_KEY_LIBRARY) || "[]");
    const savedQueue = JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || "[]");
    state.library = Array.isArray(savedLib) ? savedLib.map(refineGenreAndMeta) : [];
    state.mixQueue = Array.isArray(savedQueue) ? savedQueue.map(refineGenreAndMeta) : [];
  } catch (_) {
    state.library = [];
    state.mixQueue = [];
  }
}

function saveLibrary() {
  localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(state.library));
  updateCounters();
  populateGenreSelect();
}

function saveQueue() {
  localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(state.mixQueue));
  updateCounters();
  updateTransitionMonitor();
}

function getCompatibilityInfo(ref, cand) {
  if (!ref || !cand) return { compatible: false, label: "", score: 0 };
  const refKey = ref.key || "8A";
  const candKey = cand.key || "8A";
  const keyMatch = (CAMELOT_WHEEL[refKey] || [refKey]).includes(candKey);
  const bpmDiff = Math.abs((ref.bpm || 100) - (cand.bpm || 100));

  if (keyMatch && bpmDiff <= 6) {
    return { compatible: true, label: "ARMÓNICA + TEMPO", score: 100 - bpmDiff };
  }
  if (keyMatch && bpmDiff <= 12) {
    return { compatible: true, label: "CLAVE COMPATIBLE", score: 75 - bpmDiff };
  }
  if (bpmDiff <= 3) {
    return { compatible: true, label: "TEMPO EXACTO", score: 65 };
  }
  return { compatible: false, label: "", score: Math.max(0, 40 - bpmDiff) };
}

function buildMediaUrl(track, mode = "stream") {
  if (track.localBlobUrl) return track.localBlobUrl;
  const params = new URLSearchParams({ mode });
  if (track.url && track.url.includes("youtube.com")) {
    params.set("url", track.url);
  } else {
    params.set("query", track.search_query || `${track.artist} - ${track.title} official audio`);
  }
  return `${API_BASE}/api/media?${params.toString()}`;
}

async function playTrack(track, useCrossfade = false) {
  if (!track) return;
  const refined = refineGenreAndMeta(track);
  state.currentTrack = refined;

  const streamUrl = buildMediaUrl(refined, "inline");
  updatePlayerUI(refined);
  highlightPlayingRows();
  updateTransitionMonitor();
  if (state.harmonicOnly) renderLibrary();

  if (useCrossfade && !activeDeck.paused && state.crossfadeSec > 0) {
    triggerCrossfadeTo(streamUrl);
  } else {
    clearInterval(fadeInterval);
    standbyDeck.pause();
    activeDeck.src = streamUrl;
    activeDeck.volume = masterVolume;
    try {
      await activeDeck.play();
      setPlayButtonIcon(true);
    } catch (_) {
      showToast("Cargando stream...");
    }
  }
}

function triggerCrossfadeTo(nextUrl) {
  if (state.isCrossfading) return;
  state.isCrossfading = true;

  standbyDeck.src = nextUrl;
  standbyDeck.volume = 0;
  standbyDeck.play().catch(() => {});

  const durationMs = Math.max(1000, state.crossfadeSec * 1000);
  const steps = 30;
  const stepTime = durationMs / steps;
  let currentStep = 0;

  const outgoing = activeDeck;
  const incoming = standbyDeck;

  clearInterval(fadeInterval);
  fadeInterval = setInterval(() => {
    currentStep++;
    const p = Math.min(1, currentStep / steps);
    outgoing.volume = Math.max(0, masterVolume * (1 - p));
    incoming.volume = Math.min(masterVolume, masterVolume * p);

    const fillEl = document.getElementById("bridgeProgressFill");
    if (fillEl) fillEl.style.width = `${Math.round(p * 100)}%`;

    if (p >= 1) {
      clearInterval(fadeInterval);
      outgoing.pause();
      outgoing.currentTime = 0;
      activeDeck = incoming;
      standbyDeck = outgoing;
      state.isCrossfading = false;
      if (fillEl) fillEl.style.width = "0%";
      bindActiveDeckEvents();
      setPlayButtonIcon(true);
    }
  }, stepTime);
}

function bindActiveDeckEvents() {
  deckA.ontimeupdate = null;
  deckB.ontimeupdate = null;
  deckA.onended = null;
  deckB.onended = null;

  activeDeck.ontimeupdate = () => {
    const cur = activeDeck.currentTime || 0;
    const dur = activeDeck.duration || 0;
    document.getElementById("currentTimeLabel").textContent = formatSeconds(cur);
    if (dur > 0 && isFinite(dur)) {
      document.getElementById("totalTimeLabel").textContent = formatSeconds(dur);
      const seek = document.getElementById("seekSlider");
      if (!seek.matches(":active")) {
        seek.value = ((cur / dur) * 100).toFixed(1);
      }
      const remaining = dur - cur;
      if (
        state.crossfadeSec > 0 &&
        remaining <= state.crossfadeSec &&
        remaining > 0.4 &&
        !state.isCrossfading
      ) {
        const next = getNextTrackInContext();
        if (next) playNextTrack(true);
      }
    }
  };

  activeDeck.onended = () => {
    if (!state.isCrossfading) playNextTrack(false);
  };
}

bindActiveDeckEvents();

function getNextTrackInContext() {
  if (state.mixQueue.length > 0) {
    const idx = state.currentTrack
      ? state.mixQueue.findIndex((t) => t.id === state.currentTrack.id)
      : -1;
    if (idx >= 0 && idx + 1 < state.mixQueue.length) return state.mixQueue[idx + 1];
    return state.mixQueue[0];
  }
  const list = state.importedTracks.length > 0 ? state.importedTracks : state.library;
  if (!list.length || !state.currentTrack) return null;
  const idx = list.findIndex((t) => t.id === state.currentTrack.id);
  return idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
}

function playNextTrack(withCrossfade = true) {
  const next = getNextTrackInContext();
  if (next) playTrack(next, withCrossfade);
  else setPlayButtonIcon(false);
}

function playPrevTrack() {
  const list =
    state.mixQueue.length > 0
      ? state.mixQueue
      : state.importedTracks.length > 0
      ? state.importedTracks
      : state.library;
  if (!list.length || !state.currentTrack) return;
  const idx = list.findIndex((t) => t.id === state.currentTrack.id);
  if (idx > 0) playTrack(list[idx - 1], false);
}

async function triggerMp3Download(track, btn = null) {
  const refined = refineGenreAndMeta(track);
  const prevText = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "...";
  }
  showToast(`Descargando: ${refined.title}`);

  try {
    const res = await fetch(buildMediaUrl(refined, "download"));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Fallo en la descarga");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${refined.artist} - ${refined.title}`.replace(/[\\/*?:"<>|]/g, "").trim() + ".mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`MP3 listo: ${refined.title}`);
  } catch (e) {
    showToast(`Error: ${e.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }
}

function createTrackRowElement(track, index, context) {
  const refined = refineGenreAndMeta(track);
  const row = document.createElement("div");
  row.className = "track-row";
  row.dataset.id = refined.id;

  if (state.currentTrack && state.currentTrack.id === refined.id) {
    row.classList.add("playing");
  }

  const compat =
    state.currentTrack && state.currentTrack.id !== refined.id
      ? getCompatibilityInfo(state.currentTrack, refined)
      : { compatible: false };

  const thumb =
    refined.thumbnail ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23181c28'/%3E%3C/svg%3E";

  row.innerHTML = `
    <div class="cell-index">
      <button class="row-play-trigger" title="Reproducir">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <polygon points="6 4 20 12 6 20 6 4"/>
        </svg>
      </button>
    </div>

    <div class="cell-track">
      <img class="track-thumb" src="${thumb}" alt="" loading="lazy" decoding="async" />
      <div class="track-text">
        <div class="track-title">${escapeHtml(refined.title)}</div>
        <div class="track-artist">${escapeHtml(refined.artist)}</div>
      </div>
    </div>

    <div class="cell-genre">
      <span class="genre-tag">${escapeHtml(refined.genre)}</span>
      ${compat.compatible ? `<span class="harmonic-dot" title="${compat.label}"></span>` : ""}
    </div>

    <div class="cell-bpm">${refined.bpm}</div>

    <div class="cell-key">
      <span class="key-badge">${escapeHtml(refined.key)}</span>
    </div>

    <div class="cell-actions">
      ${
        context !== "library"
          ? `<button class="row-btn save-lib" title="Guardar en Colección">+ Col</button>`
          : `<button class="row-btn del-lib" title="Eliminar">×</button>`
      }
      ${
        context !== "queue"
          ? `<button class="row-btn add-mix" title="Enviar a Automix">+ Mix</button>`
          : `<button class="row-btn del-mix" title="Quitar">×</button>`
      }
      <button class="row-btn dl" title="Descargar MP3">MP3</button>
    </div>
  `;

  if (!refined.thumbnail) {
    fetchArtworkLazy(refined, row.querySelector(".track-thumb"));
  }

  row.querySelector(".row-play-trigger").addEventListener("click", () => playTrack(refined, false));
  row.querySelector(".dl").addEventListener("click", (e) =>
    triggerMp3Download(refined, e.currentTarget)
  );

  const saveLib = row.querySelector(".save-lib");
  if (saveLib) {
    saveLib.addEventListener("click", () => {
      addTrackToLibrary(refined);
      showToast("Añadida a Colección");
    });
  }

  const delLib = row.querySelector(".del-lib");
  if (delLib) {
    delLib.addEventListener("click", () => {
      state.library = state.library.filter((t) => t.id !== refined.id);
      saveLibrary();
      renderLibrary();
    });
  }

  const addMix = row.querySelector(".add-mix");
  if (addMix) {
    addMix.addEventListener("click", () => {
      addTrackToQueue(refined);
      showToast("En cola Automix");
    });
  }

  const delMix = row.querySelector(".del-mix");
  if (delMix) {
    delMix.addEventListener("click", () => {
      state.mixQueue = state.mixQueue.filter((t) => t.id !== refined.id);
      saveQueue();
      renderQueue();
    });
  }

  return row;
}

function matchesGlobalFilter(t) {
  if (!state.globalSearch) return true;
  const q = state.globalSearch.toLowerCase();
  return (
    (t.title || "").toLowerCase().includes(q) ||
    (t.artist || "").toLowerCase().includes(q) ||
    (t.genre || "").toLowerCase().includes(q) ||
    String(t.bpm || "").includes(q) ||
    (t.key || "").toLowerCase().includes(q)
  );
}

function renderImportedTracks() {
  const container = document.getElementById("importedTracksContainer");
  const list = state.importedTracks.filter(matchesGlobalFilter);

  document.getElementById("importTrackCount").textContent = list.length;
  const has = list.length > 0;
  document.getElementById("saveAllToLibBtn").disabled = !has;
  document.getElementById("sendAllToMixBtn").disabled = !has;
  document.getElementById("downloadBatchBtn").disabled = !has;

  container.innerHTML = "";
  if (!has) {
    container.innerHTML = `<div class="empty-box">Pega un enlace de Spotify o YouTube arriba para listar las pistas.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((t, i) => frag.appendChild(createTrackRowElement(t, i, "import")));
  container.appendChild(frag);
}

function renderLibrary() {
  const container = document.getElementById("libraryTracksContainer");
  let list = state.library.filter(matchesGlobalFilter);

  if (state.genreFilter !== "ALL") list = list.filter((t) => t.genre === state.genreFilter);
  if (state.harmonicOnly && state.currentTrack) {
    list = list.filter(
      (t) =>
        t.id === state.currentTrack.id || getCompatibilityInfo(state.currentTrack, t).compatible
    );
  }

  if (state.sortBy === "bpm-asc") list.sort((a, b) => a.bpm - b.bpm);
  else if (state.sortBy === "bpm-desc") list.sort((a, b) => b.bpm - a.bpm);
  else if (state.sortBy === "key") list.sort((a, b) => a.key.localeCompare(b.key));
  else if (state.sortBy === "title") list.sort((a, b) => a.title.localeCompare(b.title));

  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = `<div class="empty-box">Sin pistas en la colección.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((t, i) => frag.appendChild(createTrackRowElement(t, i, "library")));
  container.appendChild(frag);
}

function renderQueue() {
  const container = document.getElementById("mixQueueContainer");
  const list = state.mixQueue.filter(matchesGlobalFilter);

  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = `<div class="empty-box">Secuencia vacía. Añade pistas con "+ Mix".</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((t, i) => frag.appendChild(createTrackRowElement(t, i, "queue")));
  container.appendChild(frag);
  updateTransitionMonitor();
}

function sortQueueByHarmonicFlow() {
  if (state.mixQueue.length < 2) return;
  const pool = [...state.mixQueue];
  const sorted = [pool.shift()];

  while (pool.length > 0) {
    const last = sorted[sorted.length - 1];
    let bestIdx = 0;
    let bestScore = -999;

    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const compat = getCompatibilityInfo(last, c);
      const score = compat.score - Math.abs((last.bpm || 100) - (c.bpm || 100)) * 2;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    sorted.push(pool.splice(bestIdx, 1)[0]);
  }

  state.mixQueue = sorted;
  saveQueue();
  renderQueue();
  showToast("Secuencia ordenada por Camelot y BPM");
}

function addTrackToLibrary(track) {
  const r = refineGenreAndMeta(track);
  const exists = state.library.some(
    (t) =>
      t.id === r.id ||
      (t.title.toLowerCase() === r.title.toLowerCase() &&
        t.artist.toLowerCase() === r.artist.toLowerCase())
  );
  if (!exists) {
    state.library.unshift(r);
    saveLibrary();
  }
}

function addTrackToQueue(track) {
  const r = refineGenreAndMeta(track);
  if (!state.mixQueue.some((t) => t.id === r.id)) {
    state.mixQueue.push(r);
    saveQueue();
    renderQueue();
  }
}

function populateGenreSelect() {
  const select = document.getElementById("genreFilterSelect");
  const cur = select.value;
  const genres = Array.from(new Set(state.library.map((t) => t.genre))).sort();
  select.innerHTML = `<option value="ALL">Géneros (${state.library.length})</option>`;
  genres.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    select.appendChild(opt);
  });
  if (genres.includes(cur)) select.value = cur;
}

function updateCounters() {
  document.getElementById("libCountBadge").textContent = state.library.length;
  document.getElementById("queueCountBadge").textContent = state.mixQueue.length;
}

function updatePlayerUI(track) {
  document.getElementById("playerTitle").textContent = track.title;
  document.getElementById("playerArtist").textContent = track.artist;
  if (track.thumbnail) {
    document.getElementById("playerCover").src = track.thumbnail;
  }
  document.getElementById("playerBadges").textContent = `• ${track.bpm} BPM • ${track.key}`;
  document.getElementById("downloadCurrentBtn").disabled = false;
}

function updateTransitionMonitor() {
  const cur = state.currentTrack || state.mixQueue[0] || null;
  const next = getNextTrackInContext() || state.mixQueue[1] || null;

  document.getElementById("deckATitle").textContent = cur ? cur.title : "Sin reproducción";
  document.getElementById("deckAMeta").textContent = cur ? cur.artist : "—";
  document.getElementById("deckAMetrics").textContent = cur
    ? `${cur.bpm} BPM • ${cur.key}`
    : "-- BPM • --";

  document.getElementById("deckBTitle").textContent = next ? next.title : "En espera";
  document.getElementById("deckBMeta").textContent = next ? next.artist : "—";
  document.getElementById("deckBMetrics").textContent = next
    ? `${next.bpm} BPM • ${next.key}`
    : "-- BPM • --";

  const badge = document.getElementById("bridgeCompatibilityBadge");
  if (cur && next) {
    const compat = getCompatibilityInfo(cur, next);
    badge.textContent = compat.compatible ? compat.label : "CROSSFADE ACTIVO";
  } else {
    badge.textContent = "STANDBY";
  }
}

function highlightPlayingRows() {
  document.querySelectorAll(".track-row").forEach((r) => {
    r.classList.toggle("playing", Boolean(state.currentTrack && r.dataset.id === state.currentTrack.id));
  });
}

function setPlayButtonIcon(isPlaying) {
  const svg = document.getElementById("playIconSvg");
  svg.innerHTML = isPlaying
    ? `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`
    : `<polygon points="6 4 20 12 6 20 6 4"/>`;
}

async function fetchArtworkLazy(track, imgEl) {
  try {
    const q = encodeURIComponent(`${track.artist} ${track.title}`);
    const r = await fetch(`${API_BASE}/api/artwork?q=${q}`);
    const d = await r.json();
    if (d.url && imgEl) {
      track.thumbnail = d.url;
      imgEl.src = d.url;
    }
  } catch (_) {}
}

function formatSeconds(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg) {
  const c = document.getElementById("toastContainer");
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

document.addEventListener("DOMContentLoaded", () => {
  loadPersistedState();
  updateCounters();
  populateGenreSelect();
  renderImportedTracks();
  renderLibrary();
  renderQueue();

  const navLinks = document.querySelectorAll(".rail-link");
  const switchView = (viewId) => {
    navLinks.forEach((b) => b.classList.toggle("active", b.dataset.view === viewId));
    document.querySelectorAll(".view-pane").forEach((p) => {
      p.classList.toggle("active", p.id === viewId);
    });
    document.getElementById("mainScrollArea").scrollTop = 0;
  };

  navLinks.forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  document.getElementById("brandHome").addEventListener("click", () => switchView("importView"));

  // Atajos de teclado de estudio (Ctrl+K, Espacio, 1-2-3)
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      document.getElementById("globalFilterInput").focus();
    }
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (e.code === "Space") {
      e.preventDefault();
      document.getElementById("playPauseBtn").click();
    } else if (e.key === "1") switchView("importView");
    else if (e.key === "2") switchView("libraryView");
    else if (e.key === "3") switchView("mixView");
  });

  document.getElementById("pasteClipboardBtn").addEventListener("click", async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) document.getElementById("urlInput").value = t.trim();
    } catch (_) {}
  });

  document.getElementById("importForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("urlInput").value.trim();
    if (!url) return;

    const btn = document.getElementById("analyzeBtn");
    const spinner = document.getElementById("analyzeSpinner");
    const banner = document.getElementById("importStatusBanner");

    btn.disabled = true;
    spinner.classList.remove("hidden");
    banner.classList.remove("hidden", "error");
    banner.textContent = "Sincronizando metadatos...";

    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "No se pudo leer el enlace");

      state.importedTracks = (data.tracks || []).map(refineGenreAndMeta);
      document.getElementById("currentImportTitle").textContent = data.title || "Resultados";
      banner.classList.add("hidden");
      renderImportedTracks();
    } catch (err) {
      banner.classList.add("error");
      banner.textContent = err.message;
    } finally {
      btn.disabled = false;
      spinner.classList.add("hidden");
    }
  });

  document.getElementById("saveAllToLibBtn").addEventListener("click", () => {
    state.importedTracks.forEach(addTrackToLibrary);
    renderLibrary();
    showToast(`${state.importedTracks.length} pistas añadidas a Colección`);
  });

  document.getElementById("sendAllToMixBtn").addEventListener("click", () => {
    state.importedTracks.forEach(addTrackToQueue);
    switchView("mixView");
  });

  document.getElementById("downloadBatchBtn").addEventListener("click", async () => {
    for (const track of state.importedTracks) {
      await triggerMp3Download(track);
    }
  });

  document.getElementById("localFileInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    showToast(`Analizando ${files.length} archivo(s)...`);

    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const r = await fetch(`${API_BASE}/api/analyze-local`, { method: "POST", body: fd });
        const meta = await r.json();
        const item = refineGenreAndMeta({
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: "Local Audio",
          bpm: meta.bpm || 124,
          key: meta.key || "8A",
          genre: meta.genre || "Local",
          localBlobUrl: URL.createObjectURL(file),
          isRealAudioAnalyzed: true,
        });
        state.importedTracks.unshift(item);
        addTrackToLibrary(item);
      } catch (_) {}
    }
    renderImportedTracks();
    renderLibrary();
    e.target.value = "";
  });

  const filterInput = document.getElementById("globalFilterInput");
  const clearBtn = document.getElementById("clearSearchBtn");
  filterInput.addEventListener("input", () => {
    state.globalSearch = filterInput.value.trim();
    clearBtn.classList.toggle("hidden", !state.globalSearch);
    renderImportedTracks();
    renderLibrary();
    renderQueue();
  });

  clearBtn.addEventListener("click", () => {
    filterInput.value = "";
    state.globalSearch = "";
    clearBtn.classList.add("hidden");
    renderImportedTracks();
    renderLibrary();
    renderQueue();
  });

  document.getElementById("genreFilterSelect").addEventListener("change", (e) => {
    state.genreFilter = e.target.value;
    renderLibrary();
  });

  document.getElementById("sortLibrarySelect").addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    renderLibrary();
  });

  const harmBtn = document.getElementById("harmonicMatchToggleBtn");
  harmBtn.addEventListener("click", () => {
    state.harmonicOnly = !state.harmonicOnly;
    harmBtn.classList.toggle("active-filter", state.harmonicOnly);
    renderLibrary();
  });

  document.getElementById("clearLibraryBtn").addEventListener("click", () => {
    if (!state.library.length) return;
    if (confirm("¿Vaciar toda la colección?")) {
      state.library = [];
      saveLibrary();
      renderLibrary();
    }
  });

  document.getElementById("smartSortQueueBtn").addEventListener("click", sortQueueByHarmonicFlow);
  document.getElementById("clearQueueBtn").addEventListener("click", () => {
    state.mixQueue = [];
    saveQueue();
    renderQueue();
  });

  const cfSlider = document.getElementById("crossfadeSlider");
  cfSlider.addEventListener("input", () => {
    state.crossfadeSec = Number(cfSlider.value);
    const txt = state.crossfadeSec === 0 ? "CUT" : `${state.crossfadeSec}.0s`;
    document.getElementById("crossfadeLabel").textContent = txt;
    document.getElementById("automixStatePill").textContent = `XFADE ${txt}`;
  });

  document.getElementById("playPauseBtn").addEventListener("click", () => {
    if (!state.currentTrack) {
      const first = state.mixQueue[0] || state.importedTracks[0] || state.library[0];
      if (first) playTrack(first, false);
      return;
    }
    if (activeDeck.paused) {
      activeDeck.play();
      setPlayButtonIcon(true);
    } else {
      activeDeck.pause();
      setPlayButtonIcon(false);
    }
  });

  document.getElementById("nextTrackBtn").addEventListener("click", () => playNextTrack(true));
  document.getElementById("prevTrackBtn").addEventListener("click", playPrevTrack);

  document.getElementById("seekSlider").addEventListener("input", (e) => {
    if (activeDeck.duration) {
      activeDeck.currentTime = (Number(e.target.value) / 100) * activeDeck.duration;
    }
  });

  document.getElementById("volumeSlider").addEventListener("input", (e) => {
    masterVolume = Number(e.target.value);
    activeDeck.volume = masterVolume;
  });

  document.getElementById("downloadCurrentBtn").addEventListener("click", (e) => {
    if (state.currentTrack) triggerMp3Download(state.currentTrack, e.currentTarget);
  });
});