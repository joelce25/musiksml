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

// =========================================================
// DEDUCTOR DE GÉNEROS CORREGIDO (PRIORIDAD SALSA/BACHATA/CUMBIA/TRAP)
// =========================================================
const GENRE_RULES = [
  {
    genre: "Salsa",
    bpmRange: [92, 106],
    keywords: [
      "hector lavoe", "willie colon", "marc anthony", "grupo niche", "joe arroyo",
      "gilberto santa rosa", "victor manuelle", "frankie ruiz", "eddie santiago",
      "maelо ruiz", "maelo ruiz", "jerry rivera", "tito nieves", "tito rojas",
      "oscar d'leon", "oscar d leon", "ruben blades", "celia cruz", "dlG",
      "adolescentes", "adolescent's", "la india", "fruko", "el gran combo",
      "dimension latina", "cheo feliciano", "ismael rivera", "ray barretto",
      "fania", "sonora ponceña", "richie ray", "bobby cruz", "willy garcia",
      "guayacan", "hermanos lebron", "los titan", "tony vega", "rey ruiz",
      "andy montañez", "cano estremera", "dan den", "charanga habanera",
      "los van van", "alexander abreu", "havana d'primera", "chiquito team band",
      "zaperoko", "daniela darcourt", "yahaira", "brunella torpoco", "salsa"
    ]
  },
  {
    genre: "Bachata / Merengue",
    bpmRange: [118, 134],
    keywords: [
      "romeo santos", "aventura", "prince royce", "juan luis guerra", "zacarias ferreira",
      "anthony santos", "frank reyes", "raulin rodriguez", "monchy", "alexandra",
      "joe veras", "luis vargas", "kiko rodriguez", "elvis martinez", "toby love",
      "xtreme", "optimo", "el chaval", "sergio vargas", "eddy herrera",
      "wilfrido vargas", "hermanos rosario", "olgatanon", "olga tañon",
      "elvis crespo", "proyecto uno", "ilegales", "fulanito", "bachata", "merengue"
    ]
  },
  {
    genre: "Cumbia / Tropical",
    bpmRange: [94, 106],
    keywords: [
      "grupo 5", "agua marina", "armonia 10", "corazon serrano", "hermanos yaipen",
      "caribeños", "marisol", "chacal", "los mirlos", "juaneco", "bareto",
      "los angeles azules", "ke personajes", "damas gratis", "amar azul", "rafaga",
      "rodrigo", "gilda", "los palmeras", "la nueva luna", "luck ra", "la t y la m",
      "bm", "americo", "noche de brujas", "santaferia", "bronco", "selena",
      "kumbia kings", "super lamas", "cañaveral", "cumbia", "chicha"
    ]
  },
  {
    genre: "Trap Latino",
    bpmRange: [130, 146],
    keywords: [
      "anuel", "anuel aa", "bryant myers", "almighty", "noriel", "miky woodz",
      "jon z", "ele a el dominio", "duki", "khea", "ysy a", "neo pistea", "c.r.o",
      "eladio", "eladio carrion", "luar la l", "dei v", "omar courtz", "hades66",
      "yvngchimi", "chimi", "neutro shorty", "big soto", "juhn", "darkiel",
      "amenazzy", "youngchimi", "clarent", "pressure 9x19", "trap", "drill"
    ]
  },
  {
    genre: "Hip-Hop / Rap",
    bpmRange: [84, 96],
    keywords: [
      "canserbero", "cancerbero", "lil supa", "akapellah", "apache", "nk profeta",
      "al2", "aldeano", "los aldeanos", "kase.o", "violadores del verso", "nach",
      "sfdk", "ayax", "prok", "foyone", "natos", "waor", "santa fe klan",
      "cartel de santa", "gera mx", "aleman", "charles ans", "nanpa basico",
      "aczino", "trueno", "wos", "acru", "bardero$", "2pac", "tupac", "eminem",
      "drake", "kendrick lamar", "travis scott", "kanye", "50 cent", "snoop dogg",
      "notorious b.i.g", "biggie", "nas", "jay-z", "ice cube", "dr. dre",
      "wu-tang", "mobb deep", "j. cole", "future", "metro boomin", "21 savage",
      "playboi carti", "asap rocky", "pop smoke", "central cee", "rap", "hip hop", "boom bap"
    ]
  },
  {
    genre: "Dembow",
    bpmRange: [116, 124],
    keywords: [
      "el alfa", "chimbala", "rochy rd", "tokischa", "bulin 47", "angel dior",
      "kaly ocho", "ceky viciny", "yailin", "larebelion", "dembow"
    ]
  },
  {
    genre: "Reggaeton Clásico",
    bpmRange: [92, 98],
    keywords: [
      "daddy yankee", "don omar", "tego calderon", "wisin & yandel", "wisin y yandel",
      "hector el father", "hector & tito", "hector y tito", "tito el bambino",
      "plan b", "chencho corleone", "zion & lennox", "zion y lennox", "arcangel",
      "de la ghetto", "jowell & randy", "jowell y randy", "ñengo flow", "baby rasta",
      "ivy queen", "alexis & fido", "alexis y fido", "rakim", "ken-y", "r.k.m",
      "angel y khriz", "trebol clan", "dalmata", "franco el gorila", "eddie dee",
      "vico c", "voltio", "yaga & mackie", "magnate", "tony dize", "jadiel"
    ]
  },
  {
    genre: "Reggaeton",
    bpmRange: [90, 100],
    keywords: [
      "bad bunny", "feid", "ferxxo", "karol g", "rauw alejandro", "myke towers",
      "jhayco", "jhay cortez", "ozuna", "j balvin", "maluma", "nicky jam", "sech",
      "mora", "quevedo", "saiko", "blessd", "ryan castro", "cris mj", "floyymenor",
      "standly", "young miko", "bad gyal", "tainy", "lenny tavarez", "dalex",
      "justin quiles", "manuel turizo", "danny ocean", "reggaeton", "perreo"
    ]
  },
  {
    genre: "R&B / Soul",
    bpmRange: [82, 104],
    keywords: [
      "the weeknd", "sza", "frank ocean", "brent faiyaz", "daniel caesar",
      "kali uchis", "chris brown", "usher", "partynextdoor", "bryson tiller",
      "alicia keys", "bruno mars", "anderson .paak", "silk sonic", "r&b", "soul"
    ]
  },
  {
    genre: "Tech House",
    bpmRange: [124, 128],
    keywords: [
      "fisher", "chris lake", "michael bibi", "pawsa", "cloonee", "john summit",
      "dom dolla", "mau p", "acraze", "jamie jones", "marco carola", "paco osuna",
      "wade", "the martinez brothers", "gorgon city", "tech house"
    ]
  },
  {
    genre: "Techno / Hard Techno",
    bpmRange: [132, 145],
    keywords: [
      "charlotte de witte", "amelie lens", "adam beyer", "eli brown", "sara landry",
      "nico moreno", "i hate models", "999999999", "indira paganotto", "boris brejcha",
      "anyma", "tale of us", "artbat", "camelphat", "techno"
    ]
  },
  {
    genre: "Guaracha / Tribal",
    bpmRange: [128, 132],
    keywords: ["victor cardenas", "fumaratto", "marcela reyes", "guaracha", "tribal", "aleteo"]
  },
  {
    genre: "EDM / House",
    bpmRange: [122, 128],
    keywords: [
      "calvin harris", "david guetta", "tiesto", "martin garrix", "avicii", "zedd",
      "alesso", "swedish house mafia", "skrillex", "fred again", "peggy gou",
      "keinemusik", "black coffee", "meduza", "james hype", "alan walker",
      "marshmello", "kygo", "daft punk", "disclosure", "rüfüs du sol"
    ]
  },
  {
    genre: "Rock / Indie",
    bpmRange: [112, 136],
    keywords: [
      "arctic monkeys", "the strokes", "tame impala", "nirvana", "linkin park",
      "queen", "metallica", "ac/dc", "guns n' roses", "red hot chili", "soda stereo",
      "gustavo cerati", "enanitos verdes", "hombres g", "caifanes", "prisioneros",
      "coldplay", "imagine dragons", "twenty one pilots", "the killers", "oasis",
      "radiohead", "gorillaz", "the neighbourhood", "lana del rey"
    ]
  },
  {
    genre: "Pop / Dance",
    bpmRange: [112, 124],
    keywords: [
      "dua lipa", "taylor swift", "lady gaga", "ariana grande", "billie eilish",
      "olivia rodrigo", "sabrina carpenter", "justin bieber", "katy perry", "rihanna",
      "shakira", "rosalia", "aitana", "tini", "emilia", "michael jackson",
      "madonna", "harry styles", "adele", "ed sheeran", "charli xcx"
    ]
  }
];

function refineGenreAndMeta(track) {
  const text = `${track.artist || ""} ${track.title || ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let genre = track.genre || "Crossover";
  let bpm = Number(track.bpm) || 102;

  for (const rule of GENRE_RULES) {
    const matched = rule.keywords.some((kw) => {
      const cleanKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return text.includes(cleanKw);
    });
    if (matched) {
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
  libraryViewMode: "list",
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
  updateLibraryDashboard();
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
    return { compatible: true, label: "MEZCLA PERFECTA", score: 100 - bpmDiff };
  }
  if (keyMatch && bpmDiff <= 12) {
    return { compatible: true, label: "TONO COMPATIBLE", score: 75 - bpmDiff };
  }
  if (bpmDiff <= 3) {
    return { compatible: true, label: "MISMO TEMPO", score: 65 };
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

  // Actualizar el título de la pestaña del navegador
  document.title = `▶ ${refined.title} — ${refined.artist} • musiksml`;

  const streamUrl = buildMediaUrl(refined, "inline");
  updatePlayerUI(refined);
  highlightPlayingRows();
  updateTransitionMonitor();
  updateLibraryDashboard();
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
      showToast("Cargando pista...");
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
      const pct = ((cur / dur) * 100).toFixed(1);
      const seek = document.getElementById("seekSlider");
      if (!seek.matches(":active")) seek.value = pct;

      const mobFill = document.getElementById("mobileProgressFill");
      if (mobFill) mobFill.style.width = `${pct}%`;

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
  showToast(`Preparando MP3: ${refined.title}`);

  try {
    const res = await fetch(buildMediaUrl(refined, "download"));
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "No se pudo descargar");
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
    showToast(`Descargado: ${refined.title}`);
  } catch (e) {
    showToast(`Error: ${e.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }
}

function createTrackCardElement(track, context) {
  const refined = refineGenreAndMeta(track);
  const card = document.createElement("div");
  card.className = "track-card";
  card.dataset.id = refined.id;

  if (state.currentTrack && state.currentTrack.id === refined.id) {
    card.classList.add("playing");
  }

  const compat =
    state.currentTrack && state.currentTrack.id !== refined.id
      ? getCompatibilityInfo(state.currentTrack, refined)
      : { compatible: false, label: "" };

  const thumb =
    refined.thumbnail ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect width='60' height='60' rx='8' fill='%231a1e2d'/%3E%3C/svg%3E";

  card.innerHTML = `
    <div>
      <button class="card-play-btn" title="Reproducir">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <polygon points="6 4 20 12 6 20 6 4"/>
        </svg>
      </button>
    </div>

    <img class="card-thumb" src="${thumb}" alt="" loading="lazy" decoding="async" />

    <div class="card-main">
      <div class="card-title">${escapeHtml(refined.title)}</div>
      <div class="card-artist">${escapeHtml(refined.artist)}</div>
    </div>

    <div class="card-genre-wrap">
      <span class="genre-badge">${escapeHtml(refined.genre)}</span>
      ${compat.compatible ? `<span class="compat-tag">${compat.label}</span>` : ""}
    </div>

    <div class="card-metrics">
      <span class="bpm-chip">${refined.bpm} BPM</span>
      <span class="key-chip">${escapeHtml(refined.key)}</span>
    </div>

    <div class="card-actions">
      ${
        context !== "library"
          ? `<button class="card-btn save-lib" title="Guardar en Biblioteca">+ Biblio</button>`
          : `<button class="card-btn del-lib" title="Quitar de Biblioteca">Quitar</button>`
      }
      ${
        context !== "queue"
          ? `<button class="card-btn add-mix" title="Enviar a Automix">+ Mix</button>`
          : `<button class="card-btn del-mix" title="Quitar de la cola">&times;</button>`
      }
      <button class="card-btn dl-btn" title="Descargar MP3">MP3</button>
    </div>
  `;

  if (!refined.thumbnail) {
    fetchArtworkLazy(refined, card.querySelector(".card-thumb"));
  }

  card.querySelector(".card-play-btn").addEventListener("click", () => playTrack(refined, false));
  card.querySelector(".dl-btn").addEventListener("click", (e) =>
    triggerMp3Download(refined, e.currentTarget)
  );

  const saveLib = card.querySelector(".save-lib");
  if (saveLib) {
    saveLib.addEventListener("click", () => {
      addTrackToLibrary(refined);
      showToast("Guardada en Biblioteca");
    });
  }

  const delLib = card.querySelector(".del-lib");
  if (delLib) {
    delLib.addEventListener("click", () => {
      state.library = state.library.filter((t) => t.id !== refined.id);
      saveLibrary();
      renderLibrary();
    });
  }

  const addMix = card.querySelector(".add-mix");
  if (addMix) {
    addMix.addEventListener("click", () => {
      addTrackToQueue(refined);
      showToast("Añadida a Automix");
    });
  }

  const delMix = card.querySelector(".del-mix");
  if (delMix) {
    delMix.addEventListener("click", () => {
      state.mixQueue = state.mixQueue.filter((t) => t.id !== refined.id);
      saveQueue();
      renderQueue();
    });
  }

  return card;
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
  const showcase = document.getElementById("playlistShowcase");
  const list = state.importedTracks.filter(matchesGlobalFilter);

  const has = list.length > 0;
  showcase.classList.toggle("hidden", !state.importedTracks.length);
  document.getElementById("saveAllToLibBtn").disabled = !has;
  document.getElementById("sendAllToMixBtn").disabled = !has;
  document.getElementById("downloadBatchBtn").disabled = !has;

  if (state.importedTracks.length > 0) {
    const avgBpm = Math.round(
      state.importedTracks.reduce((acc, t) => acc + (t.bpm || 100), 0) / state.importedTracks.length
    );
    const firstThumb = state.importedTracks.find((t) => t.thumbnail)?.thumbnail || "";
    if (firstThumb) document.getElementById("showcaseCover").src = firstThumb;
    document.getElementById("showcaseStatsRow").innerHTML = `
      <span>${list.length} pistas</span>
      <span>•</span>
      <span>Promedio ${avgBpm} BPM</span>
    `;
  }

  container.innerHTML = "";
  if (!has) {
    container.innerHTML = `
      <div class="empty-card">
        Pega un link de Spotify o YouTube arriba para cargar las tarjetas de canciones.
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((t) => frag.appendChild(createTrackCardElement(t, "import")));
  container.appendChild(frag);
}

function updateLibraryDashboard() {
  document.getElementById("statTotalTracks").textContent = state.library.length;
  if (!state.library.length) {
    document.getElementById("statAvgBpm").textContent = "-- BPM";
    document.getElementById("statTopGenre").textContent = "—";
    document.getElementById("statCompatibleNow").textContent = "0";
    return;
  }

  const avg = Math.round(
    state.library.reduce((s, t) => s + (Number(t.bpm) || 100), 0) / state.library.length
  );
  document.getElementById("statAvgBpm").textContent = `${avg} BPM`;

  const counts = {};
  state.library.forEach((t) => {
    counts[t.genre] = (counts[t.genre] || 0) + 1;
  });
  const topGenre = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  document.getElementById("statTopGenre").textContent = topGenre;

  if (state.currentTrack) {
    const compatCount = state.library.filter(
      (t) =>
        t.id !== state.currentTrack.id && getCompatibilityInfo(state.currentTrack, t).compatible
    ).length;
    document.getElementById("statCompatibleNow").textContent = String(compatCount);
  } else {
    document.getElementById("statCompatibleNow").textContent = "—";
  }
}

function renderGenrePillsBar() {
  const bar = document.getElementById("libraryGenreChips");
  if (!bar) return;
  const genres = Array.from(new Set(state.library.map((t) => t.genre))).sort();
  if (!genres.length) {
    bar.innerHTML = "";
    return;
  }

  bar.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.className = `genre-pill-filter ${state.genreFilter === "ALL" ? "active" : ""}`;
  allBtn.textContent = `Todos (${state.library.length})`;
  allBtn.onclick = () => {
    state.genreFilter = "ALL";
    document.getElementById("genreFilterSelect").value = "ALL";
    renderLibrary();
  };
  bar.appendChild(allBtn);

  genres.forEach((g) => {
    const count = state.library.filter((t) => t.genre === g).length;
    const b = document.createElement("button");
    b.className = `genre-pill-filter ${state.genreFilter === g ? "active" : ""}`;
    b.textContent = `${g} (${count})`;
    b.onclick = () => {
      state.genreFilter = g;
      document.getElementById("genreFilterSelect").value = g;
      renderLibrary();
    };
    bar.appendChild(b);
  });
}

function renderLibrary() {
  updateLibraryDashboard();
  renderGenrePillsBar();

  const container = document.getElementById("libraryTracksContainer");
  container.classList.toggle("grid-view", state.libraryViewMode === "grid");

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
    container.innerHTML = `
      <div class="empty-card">
        Tu biblioteca aún no tiene pistas con este filtro. Importa una playlist o guarda canciones con "+ Biblio".
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((t) => frag.appendChild(createTrackCardElement(t, "library")));
  container.appendChild(frag);
}

function renderQueue() {
  const container = document.getElementById("mixQueueContainer");
  const list = state.mixQueue.filter(matchesGlobalFilter);

  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = `
      <div class="empty-card">
        Tu cola Automix está vacía. Pulsa "+ Mix" en cualquier canción para armar tu sesión.
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((t) => frag.appendChild(createTrackCardElement(t, "queue")));
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
  showToast("Cola ordenada por compatibilidad Camelot y BPM");
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
  select.innerHTML = `<option value="ALL">Todos los géneros (${state.library.length})</option>`;
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

  document.getElementById("deckATitle").textContent = cur ? cur.title : "Sin pista activa";
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
    badge.textContent = "AUTOMIX READY";
  }
}

function highlightPlayingRows() {
  document.querySelectorAll(".track-card").forEach((r) => {
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

  const navLinks = document.querySelectorAll(".side-link");
  const switchView = (viewId) => {
    navLinks.forEach((b) => b.classList.toggle("active", b.dataset.view === viewId));
    document.querySelectorAll(".view-section").forEach((p) => {
      p.classList.toggle("active", p.id === viewId);
    });
    document.getElementById("mainScrollArea").scrollTop = 0;
  };

  navLinks.forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  document.getElementById("brandHome").addEventListener("click", () => switchView("importView"));
  document.getElementById("mobileBrandHome").addEventListener("click", () => switchView("importView"));

  // Manejo de input de URL y pegado compatible con móviles (iOS/Android)
  const urlInput = document.getElementById("urlInput");
  const clearUrlBtn = document.getElementById("clearUrlBtn");

  urlInput.addEventListener("input", () => {
    clearUrlBtn.classList.toggle("hidden", !urlInput.value);
  });

  clearUrlBtn.addEventListener("click", () => {
    urlInput.value = "";
    clearUrlBtn.classList.add("hidden");
    urlInput.focus();
  });

  document.getElementById("pasteClipboardBtn").addEventListener("click", async () => {
    urlInput.focus();
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          clearUrlBtn.classList.remove("hidden");
          showToast("Enlace pegado");
          return;
        }
      }
      throw new Error("Clipboard fallback");
    } catch (_) {
      // En móviles donde el navegador bloquea readText, seleccionamos el campo para que salga el globo "Pegar"
      urlInput.focus();
      urlInput.select();
      showToast("Mantén presionado el campo y toca 'Pegar'");
    }
  });

  document.getElementById("importForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    const btn = document.getElementById("analyzeBtn");
    const spinner = document.getElementById("analyzeSpinner");
    const banner = document.getElementById("importStatusBanner");

    btn.disabled = true;
    spinner.classList.remove("hidden");
    banner.classList.remove("hidden", "error");
    banner.textContent = "Extrayendo canciones y analizando géneros...";

    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "No se pudo leer el enlace");

      state.importedTracks = (data.tracks || []).map(refineGenreAndMeta);
      document.getElementById("currentImportTitle").textContent = data.title || "Playlist cargada";
      document.getElementById("showcaseSourceTag").textContent =
        url.includes("spotify") ? "SPOTIFY PLAYLIST" : "YOUTUBE MEDIA";
      banner.classList.add("hidden");
      renderImportedTracks();
      showToast(`${state.importedTracks.length} canciones listas`);
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
    showToast(`${state.importedTracks.length} pistas guardadas en Biblioteca`);
  });

  document.getElementById("sendAllToMixBtn").addEventListener("click", () => {
    state.importedTracks.forEach(addTrackToQueue);
    switchView("mixView");
    showToast("Enviadas a Automix");
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
          artist: "Archivo Local",
          bpm: meta.bpm || 120,
          key: meta.key || "8A",
          genre: meta.genre || "Audio Local",
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

  document.getElementById("viewListBtn").addEventListener("click", (e) => {
    state.libraryViewMode = "list";
    e.currentTarget.classList.add("active");
    document.getElementById("viewGridBtn").classList.remove("active");
    renderLibrary();
  });

  document.getElementById("viewGridBtn").addEventListener("click", (e) => {
    state.libraryViewMode = "grid";
    e.currentTarget.classList.add("active");
    document.getElementById("viewListBtn").classList.remove("active");
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
    if (confirm("¿Vaciar todas las pistas de tu Biblioteca?")) {
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
    const txt = state.crossfadeSec === 0 ? "OFF" : `${state.crossfadeSec}s`;
    document.getElementById("crossfadeLabel").textContent = txt;
    document.getElementById("automixStatePill").textContent = `AUTOMIX ${txt}`;
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