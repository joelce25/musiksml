document.addEventListener('DOMContentLoaded', () => {
const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8000'
  : 'https://musiksml-production.up.railway.app';

  const FALLBACK_COVER = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80';

  const state = {
    extractedTracks: [],
    playlistSearchQuery: '',
    activeSort: 'smart-mix',
    selectedGenre: 'TODAS',
    searchText: '',
    bpmMin: null,
    bpmMax: null,
    playingId: null,
    tapTimestamps: [],

    crate: [
      {
        id: 'c1',
        title: 'Quevedo: Bzrp Music Sessions, Vol. 52',
        artist: 'Bizarrap & Quevedo',
        genre: 'Electrónica / Club',
        bpm: 128,
        key: '8A',
        source: 'Spotify',
        search_query: 'Bizarrap Quevedo Vol 52 official audio',
        thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/1c/96/80/1c968098-6f4b-531e-c586-97b0a5e965d4/196626945068.jpg/600x600bb.jpg'
      },
      {
        id: 'c2',
        title: 'Losing It',
        artist: 'FISHER',
        genre: 'Tech House',
        bpm: 125,
        key: '9A',
        source: 'YouTube',
        search_query: 'FISHER Losing It audio',
        thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/9b/19/62/9b1962a4-f728-043c-1402-6c7a7c667f9d/00602567892410.rgb.jpg/600x600bb.jpg'
      },
      {
        id: 'c3',
        title: 'LOKERA',
        artist: 'Rauw Alejandro, Lyanno & Brray',
        genre: 'Reggaeton / Urbano',
        bpm: 102,
        key: '5A',
        source: 'Spotify',
        search_query: 'Rauw Alejandro Lokera official audio',
        thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/0f/10/98/0f1098a3-3c3d-a217-4209-64a17fb9d4c2/196589186782.jpg/600x600bb.jpg'
      },
      {
        id: 'c4',
        title: 'Titanium (feat. Sia)',
        artist: 'David Guetta',
        genre: 'Pop / Dance',
        bpm: 126,
        key: '8B',
        source: 'YouTube',
        search_query: 'David Guetta Titanium official audio',
        thumbnail: 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/3c/0b/7e/3c0b7e9d-1a16-0f82-e2a3-2539d9f3590f/5099909735156.jpg/600x600bb.jpg'
      }
    ]
  };

  // =========================================================
  // 1. NAVEGACIÓN ENTRE VISTAS
  // =========================================================
  const menuButtons = document.querySelectorAll('.menu-item');
  const views = document.querySelectorAll('.view');

  function switchView(viewId) {
    menuButtons.forEach(b => b.classList.toggle('active', b.dataset.view === viewId));
    views.forEach(v => v.classList.toggle('active', v.id === viewId));

    if (viewId === 'view-crate') {
      renderGenreTags();
      renderCrateTable();
    }
    if (viewId === 'view-curator') {
      renderCuratorView();
    }
    if (viewId === 'view-studio') {
      calcPitchDiff();
      renderCamelotHelper();
      renderPhraseTimings(128);
    }
  }

  menuButtons.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  function updateCrateCounter() {
    document.getElementById('crate-counter').textContent = state.crate.length;
  }
  updateCrateCounter();

  // =========================================================
  // 2. ANALIZAR ENLACES (PLAYLISTS COMPLETAS + PORTADAS EN SEGUNDO PLANO)
  // =========================================================
  const urlForm = document.getElementById('url-form');
  const urlInput = document.getElementById('url-input');
  const btnFetch = document.getElementById('btn-fetch-url');
  const extractedSection = document.getElementById('extracted-section');
  const extractedGrid = document.getElementById('extracted-grid');
  const playlistSearchInput = document.getElementById('playlist-search-input');
  const clearPlSearchBtn = document.getElementById('btn-clear-pl-search');

  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;

    btnFetch.disabled = true;
    btnFetch.innerHTML = `<span>Extrayendo pistas...</span>`;

    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'No se pudo analizar el enlace');
      }

      const data = await res.json();
      state.extractedTracks = (data.tracks || []).map((t, i) => ({
        ...t,
        _origIndex: i
      }));
      state.playlistSearchQuery = '';
      if (playlistSearchInput) playlistSearchInput.value = '';
      clearPlSearchBtn?.classList.add('hidden');

      document.getElementById('extracted-title').textContent = data.title || 'Pistas encontradas';
      extractedSection.classList.remove('hidden');
      renderExtractedCards();
      toast(`Se reconocieron ${state.extractedTracks.length} pistas en total.`);

      // Cargar automáticamente las portadas que falten en segundo plano
      hydrateMissingArtworks();
    } catch (err) {
      toast(`Error: ${err.message}`);
    } finally {
      btnFetch.disabled = false;
      btnFetch.innerHTML = `<span>Analizar enlace</span><i class="ph ph-arrow-right"></i>`;
    }
  });

  // Buscador en vivo dentro de la playlist importada (para tus 148+ canciones)
  playlistSearchInput?.addEventListener('input', (e) => {
    state.playlistSearchQuery = e.target.value;
    clearPlSearchBtn?.classList.toggle('hidden', !state.playlistSearchQuery);
    renderExtractedCards();
  });

  clearPlSearchBtn?.addEventListener('click', () => {
    state.playlistSearchQuery = '';
    if (playlistSearchInput) playlistSearchInput.value = '';
    clearPlSearchBtn.classList.add('hidden');
    renderExtractedCards();
  });

  function renderExtractedCards() {
    extractedGrid.innerHTML = '';
    const q = state.playlistSearchQuery.trim().toLowerCase();

    const filtered = state.extractedTracks.filter(t => {
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q) ||
        String(t.bpm).includes(q)
      );
    });

    const countBadge = document.getElementById('extracted-count');
    if (countBadge) {
      countBadge.textContent = q
        ? `${filtered.length} de ${state.extractedTracks.length} pistas`
        : `${state.extractedTracks.length} pistas`;
    }

    filtered.forEach((track) => {
      const idx = track._origIndex;
      const cover = track.thumbnail || FALLBACK_COVER;
      const card = document.createElement('div');
      card.className = 'track-card';
      card.innerHTML = `
        <div class="tc-main">
          <div class="tc-artwork-wrap">
            <img class="tc-artwork" id="ext-art-${idx}" src="${cover}" alt="Cover" loading="lazy" onerror="this.src='${FALLBACK_COVER}'">
            <button type="button" class="tc-play-overlay" data-preview-idx="${idx}" title="Escuchar vista previa">
              <i class="ph-fill ph-play"></i>
            </button>
          </div>
          <div class="tc-info">
            <div class="tc-title" title="${track.title}">${track.title}</div>
            <div class="tc-artist">${track.artist}</div>
            <div class="tc-specs">
              <span class="spec-tag bpm">${track.bpm} BPM</span>
              <span class="spec-tag key">${track.key}</span>
              <span class="spec-tag">${track.genre}</span>
            </div>
          </div>
        </div>
        <div class="tc-footer">
          <button type="button" class="btn-accent" data-dl-idx="${idx}">
            <i class="ph ph-download-simple"></i> Descargar MP3
          </button>
          <button type="button" class="btn-secondary" data-save-idx="${idx}">
            <i class="ph ph-plus"></i> Biblioteca
          </button>
        </div>
      `;
      extractedGrid.appendChild(card);
    });

    extractedGrid.querySelectorAll('[data-preview-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const track = state.extractedTracks[Number(btn.dataset.previewIdx)];
        if (track) streamTrackInPlayer(track);
      });
    });

    extractedGrid.querySelectorAll('[data-dl-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const track = state.extractedTracks[Number(btn.dataset.dlIdx)];
        if (track) triggerDirectDownload(track, btn);
      });
    });

    extractedGrid.querySelectorAll('[data-save-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const track = state.extractedTracks[Number(btn.dataset.saveIdx)];
        if (track) {
          addTrackToCrate(track);
          toast(`"${track.title}" añadida a tu Biblioteca.`);
        }
      });
    });
  }

  // Busca automáticamente la portada oficial de iTunes/Deezer para las canciones que no traigan imagen
  async function hydrateMissingArtworks() {
    const missing = state.extractedTracks.filter(t => !t.thumbnail);
    const concurrency = 4;
    let cursor = 0;

    async function worker() {
      while (cursor < missing.length) {
        const item = missing[cursor++];
        try {
          const query = `${item.artist} ${item.title}`;
          const res = await fetch(`${API_BASE}/api/artwork?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.url) {
              item.thumbnail = data.url;
              const imgEl = document.getElementById(`ext-art-${item._origIndex}`);
              if (imgEl) imgEl.src = data.url;
            }
          }
        } catch (_) {}
      }
    }

    const workers = [];
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
  }

  function buildMediaUrl(track, mode = 'download') {
    const q = track.url
      ? `url=${encodeURIComponent(track.url)}`
      : `query=${encodeURIComponent(track.search_query || `${track.artist}${track.title}`)}`;
    return `${API_BASE}/api/media?${q}&mode=${mode}`;
  }

  function triggerDirectDownload(track, btnEl = null) {
    const audioEl = document.getElementById('audio-player');
    const streamUrl = buildMediaUrl(track, 'stream');
    if (audioEl.src === streamUrl && !audioEl.paused) {
      audioEl.pause();
    }

    if (btnEl) {
      const original = btnEl.innerHTML;
      btnEl.disabled = true;
      btnEl.innerHTML = `<i class="ph ph-spinner"></i> Preparando MP3...`;
      setTimeout(() => {
        btnEl.disabled = false;
        btnEl.innerHTML = original;
      }, 4500);
    }

    toast(`Descargando "${track.title}" en MP3...`);
    const dlUrl = buildMediaUrl(track, 'download');
    const a = document.createElement('a');
    a.href = dlUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  document.getElementById('btn-save-all-crate')?.addEventListener('click', () => {
    const q = state.playlistSearchQuery.trim().toLowerCase();
    const listToSave = q
      ? state.extractedTracks.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
      : state.extractedTracks;

    listToSave.forEach(t => addTrackToCrate(t));
    toast(`${listToSave.length} pistas añadidas a la Biblioteca.`);
    switchView('view-crate');
  });

  function addTrackToCrate(t) {
    state.crate.push({
      id: 'tr_' + Date.now() + Math.random().toString(36).slice(2, 6),
      title: t.title,
      artist: t.artist,
      genre: t.genre || 'Crossover',
      bpm: Number(t.bpm) || 124,
      key: t.key || '8A',
      source: t.source || 'Web',
      url: t.url || '',
      search_query: t.search_query || `${t.artist} ${t.title}`,
      thumbnail: t.thumbnail || FALLBACK_COVER,
      localBlobUrl: t.localBlobUrl || null
    });
    updateCrateCounter();
  }

  // =========================================================
  // 3. ORDENAMIENTO INTELIGENTE MULTICRITERIO
  // =========================================================
  function camelotDistance(k1, k2) {
    if (k1 === k2) return 0;
    const n1 = parseInt(k1, 10), l1 = k1.slice(-1);
    const n2 = parseInt(k2, 10), l2 = k2.slice(-1);
    const diff = Math.min(Math.abs(n1 - n2), 12 - Math.abs(n1 - n2));
    if (n1 === n2 && l1 !== l2) return 0.5;
    if (l1 === l2 && diff === 1) return 1;
    return 4 + diff;
  }

  function applySorting(mode) {
    state.activeSort = mode;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === mode));

    if (mode === 'bpm-asc') {
      state.crate.sort((a, b) => a.bpm - b.bpm || camelotDistance(a.key, b.key));
    } else if (mode === 'bpm-desc') {
      state.crate.sort((a, b) => b.bpm - a.bpm);
    } else if (mode === 'genre') {
      state.crate.sort((a, b) => a.genre.localeCompare(b.genre) || a.bpm - b.bpm);
    } else if (mode === 'harmonic') {
      state.crate.sort((a, b) => {
        const na = parseInt(a.key, 10), nb = parseInt(b.key, 10);
        return na - nb || a.key.localeCompare(b.key) || a.bpm - b.bpm;
      });
    } else if (mode === 'smart-mix') {
      if (state.crate.length > 2) {
        const pool = [...state.crate].sort((a, b) => a.bpm - b.bpm);
        const route = [pool.shift()];

        while (pool.length > 0) {
          const last = route[route.length - 1];
          let bestIndex = 0;
          let lowestCost = Infinity;

          pool.forEach((candidate, idx) => {
            const bpmDelta = Math.abs(candidate.bpm - last.bpm);
            const harmonicCost = camelotDistance(last.key, candidate.key) * 3.5;
            const genreCost = candidate.genre === last.genre ? 0 : 4;
            const totalCost = (bpmDelta * 1.8) + harmonicCost + genreCost;

            if (totalCost < lowestCost) {
              lowestCost = totalCost;
              bestIndex = idx;
            }
          });
          route.push(pool.splice(bestIndex, 1)[0]);
        }
        state.crate = route;
      }
    }
    renderCrateTable();
  }

  document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applySorting(btn.dataset.sort);
      toast(`Lista ordenada por: ${btn.textContent.trim()}`);
    });
  });

  function renderGenreTags() {
    const bar = document.getElementById('genre-tags-bar');
    if (!bar) return;
    const genres = ['TODAS', ...new Set(state.crate.map(t => t.genre))];
    bar.innerHTML = genres.map(g => `
      <button type="button" class="tag-btn ${state.selectedGenre === g ? 'active' : ''}" data-g="${g}">
        ${g}
      </button>
    `).join('');

    bar.querySelectorAll('.tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedGenre = btn.dataset.g;
        renderGenreTags();
        renderCrateTable();
      });
    });
  }

  const crateTbody = document.getElementById('crate-tbody');
  let draggedRowIndex = null;

  function renderCrateTable() {
    if (!crateTbody) return;
    crateTbody.innerHTML = '';

    const filtered = state.crate.filter(t => {
      const gMatch = state.selectedGenre === 'TODAS' || t.genre === state.selectedGenre;
      const q = state.searchText.toLowerCase();
      const qMatch = !q ||
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.genre.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        String(t.bpm).includes(q);
      const minOk = !state.bpmMin || t.bpm >= state.bpmMin;
      const maxOk = !state.bpmMax || t.bpm <= state.bpmMax;
      return gMatch && qMatch && minOk && maxOk;
    });

    filtered.forEach((track, i) => {
      const next = filtered[i + 1];
      let compatHtml = `<span style="color:var(--text-muted); font-size:12px;">Fin de lista</span>`;

      if (next) {
        const bpmDiff = Math.abs(track.bpm - next.bpm);
        const hDist = camelotDistance(track.key, next.key);
        const pitchReq = (((next.bpm - track.bpm) / track.bpm) * 100).toFixed(1);
        const sign = pitchReq > 0 ? '+' : '';

        if (bpmDiff <= 4 && hDist <= 1) {
          compatHtml = `<span style="color:var(--accent); font-size:12px; font-weight:500;">Armónica ideal (${sign}${pitchReq}% pitch)</span>`;
        } else if (bpmDiff <= 6) {
          compatHtml = `<span style="color:var(--teal); font-size:12px;">Fluida (${sign}${pitchReq}% pitch)</span>`;
        } else {
          compatHtml = `<span style="color:var(--coral); font-size:12px;">Salto de ${bpmDiff} BPM (Usar Loop)</span>`;
        }
      }

      const tr = document.createElement('tr');
      tr.draggable = true;
      tr.dataset.idx = i;
      if (track.id === state.playingId) tr.classList.add('is-playing');

      tr.innerHTML = `
        <td style="font-family:var(--font-mono); color:var(--text-muted);">${String(i + 1).padStart(2, '0')}</td>
        <td>
          <div class="row-track-cell">
            <img class="row-thumb" src="${track.thumbnail || FALLBACK_COVER}" alt="" onerror="this.src='${FALLBACK_COVER}'">
            <div>
              <div style="font-weight:600;">${track.title}</div>
              <div style="font-size:12px; color:var(--text-secondary);">${track.artist}</div>
            </div>
          </div>
        </td>
        <td><span class="spec-tag">${track.genre}</span></td>
        <td>
          <input type="number" class="inline-bpm-input" value="${track.bpm}" min="50" max="220" data-bpm-id="${track.id}" title="Editar BPM manualmente">
        </td>
        <td><span class="spec-tag key">${track.key}</span></td>
        <td>${compatHtml}</td>
        <td style="text-align:right;">
          <div style="display:inline-flex; gap:6px;">
            <button type="button" class="btn-secondary" data-play-id="${track.id}" title="Escuchar">
              <i class="ph-fill ph-play"></i>
            </button>
            <button type="button" class="btn-secondary" data-dl-id="${track.id}" title="Descargar MP3">
              <i class="ph ph-download-simple"></i>
            </button>
            <button type="button" class="btn-secondary" data-del-id="${track.id}" title="Eliminar">
              <i class="ph ph-trash"></i>
            </button>
          </div>
        </td>
      `;

      tr.addEventListener('dragstart', () => { draggedRowIndex = i; });
      tr.addEventListener('dragover', (e) => e.preventDefault());
      tr.addEventListener('drop', () => {
        if (draggedRowIndex === null || draggedRowIndex === i) return;
        const moved = state.crate.splice(draggedRowIndex, 1)[0];
        state.crate.splice(i, 0, moved);
        draggedRowIndex = null;
        renderCrateTable();
      });

      crateTbody.appendChild(tr);
    });

    crateTbody.querySelectorAll('[data-bpm-id]').forEach(inp => {
      inp.addEventListener('change', () => {
        const t = state.crate.find(x => x.id === inp.dataset.bpmId);
        if (t) {
          t.bpm = Number(inp.value) || 120;
          renderCrateTable();
        }
      });
    });

    crateTbody.querySelectorAll('[data-play-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = state.crate.find(x => x.id === btn.dataset.playId);
        if (t) streamTrackInPlayer(t);
      });
    });

    crateTbody.querySelectorAll('[data-dl-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = state.crate.find(x => x.id === btn.dataset.dlId);
        if (t) triggerDirectDownload(t, btn);
      });
    });

    crateTbody.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.crate = state.crate.filter(x => x.id !== btn.dataset.delId);
        updateCrateCounter();
        renderCrateTable();
      });
    });
  }

  document.getElementById('filter-bpm-min')?.addEventListener('input', (e) => {
    state.bpmMin = e.target.value ? Number(e.target.value) : null;
    renderCrateTable();
  });
  document.getElementById('filter-bpm-max')?.addEventListener('input', (e) => {
    state.bpmMax = e.target.value ? Number(e.target.value) : null;
    renderCrateTable();
  });
  document.getElementById('global-filter')?.addEventListener('input', (e) => {
    state.searchText = e.target.value;
    switchView('view-crate');
  });

  // =========================================================
  // 4. ANÁLISIS REAL DE MP3 LOCAL CON LIBROSA EN EL SERVIDOR PYTHON
  // =========================================================
  document.getElementById('local-audio-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const titleEl = document.getElementById('local-upload-title');
    const subEl = document.getElementById('local-upload-sub');
    if (titleEl) titleEl.textContent = 'Analizando audio...';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (subEl) subEl.textContent = `Procesando (${i + 1}/${files.length}): ${file.name}`;
      const blobUrl = URL.createObjectURL(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, '');

      let bpm = 124;
      let key = '8A';
      let genre = 'Crossover';

      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/api/analyze-local`, {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          const dsp = await res.json();
          bpm = dsp.bpm;
          key = dsp.key;
          genre = dsp.genre;
        }
      } catch (_) {}

      // También buscarle su portada si el nombre del archivo tiene Artista - Canción
      let cover = FALLBACK_COVER;
      try {
        const artRes = await fetch(`${API_BASE}/api/artwork?q=${encodeURIComponent(cleanName)}`);
        if (artRes.ok) {
          const artJson = await artRes.json();
          if (artJson.url) cover = artJson.url;
        }
      } catch (_) {}

      state.crate.unshift({
        id: 'loc_' + Date.now() + Math.random(),
        title: cleanName,
        artist: 'MP3 Analizado (DSP)',
        genre,
        bpm,
        key,
        source: 'Local',
        thumbnail: cover,
        localBlobUrl: blobUrl
      });
    }

    if (titleEl) titleEl.textContent = 'Analizar MP3 locales';
    if (subEl) subEl.textContent = 'Detectar BPM y Tono real (DSP)';
    updateCrateCounter();
    toast(`Análisis DSP completado para ${files.length} archivo(s).`);
    switchView('view-crate');
  });

  // =========================================================
  // 5. CURADOR IA & FLUJO DE ENERGÍA
  // =========================================================
  function renderCuratorView() {
    const stagesEl = document.getElementById('curator-stages');
    const stepsEl = document.getElementById('curator-steps');
    if (!stagesEl || !stepsEl) return;

    const low = state.crate.filter(t => t.bpm < 114);
    const mid = state.crate.filter(t => t.bpm >= 114 && t.bpm <= 126);
    const high = state.crate.filter(t => t.bpm > 126);

    const groups = [
      { name: 'Apertura & Urbano (90–113 BPM)', sub: 'Ideal para calentar pista o bloque de reggaeton.', items: low },
      { name: 'Groove & Club (114–126 BPM)', sub: 'Transición fluida hacia Tech House y Pop Dance.', items: mid },
      { name: 'Peak Time (127+ BPM)', sub: 'Máxima intensidad energética para el cierre.', items: high }
    ];

    stagesEl.innerHTML = groups.map(g => `
      <div class="stage-card">
        <h4>${g.name}</h4>
        <p>${g.sub}</p>
        ${g.items.length ? g.items.map(t => `
          <div class="stage-item">
            <span>${t.title}</span>
            <strong style="font-family:var(--font-mono); color:var(--accent);">${t.bpm} BPM · ${t.key}</strong>
          </div>
        `).join('') : `<div style="font-size:12px; color:var(--text-muted);">Sin pistas en este rango</div>`}
      </div>
    `).join('');

    const sorted = [...state.crate].sort((a, b) => a.bpm - b.bpm);
    stepsEl.innerHTML = sorted.map((t, i) => {
      const next = sorted[i + 1];
      if (!next) return `<div class="step-row"><strong>Cierre (${t.title}):</strong> Aplicar filtro paso-alto gradual en los últimos 16 tiempos.</div>`;
      const delta = next.bpm - t.bpm;
      const advice = Math.abs(delta) <= 4
        ? `Ajustar pitch de "${next.title}" a ${t.bpm} BPM e intercambiar graves (Bass Swap) tras frase de 16 compases.`
        : `Salto de ${delta} BPM: cerrar "${t.title}" con loop de 4 tiempos + eco y lanzar "${next.title}" al corte.`;
      return `
        <div class="step-row">
          <strong>${i + 1}. ${t.title} (${t.bpm} BPM, ${t.key}) → ${next.title} (${next.bpm} BPM, ${next.key})</strong>
          <div style="color:var(--text-secondary); margin-top:4px;">${advice}</div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('btn-apply-smart-order')?.addEventListener('click', () => {
    applySorting('smart-mix');
    switchView('view-crate');
    toast('Orden inteligente aplicado a tu Biblioteca.');
  });

  // =========================================================
  // 6. UTILIDADES DE CABINA (STUDIO)
  // =========================================================
  function calcPitchDiff() {
    const f = parseFloat(document.getElementById('pitch-from')?.value || 100);
    const t = parseFloat(document.getElementById('pitch-to')?.value || 104);
    const pct = ((t - f) / f) * 100;
    const sign = pct >= 0 ? '+' : '';
    document.getElementById('pitch-output').textContent =
      `${sign}${pct.toFixed(2)}% (${Math.abs(pct) <= 6 ? 'Rango natural' : 'Activar Keylock / Master Tempo'})`;
  }
  document.getElementById('pitch-from')?.addEventListener('input', calcPitchDiff);
  document.getElementById('pitch-to')?.addEventListener('input', calcPitchDiff);

  function renderCamelotHelper() {
    const key = document.getElementById('camelot-picker')?.value || '8A';
    const num = parseInt(key, 10);
    const lettr = key.slice(-1);
    const prev = num === 1 ? 12 : num - 1;
    const next = num === 12 ? 1 : num + 1;
    const rel = lettr === 'A' ? 'B' : 'A';

    document.getElementById('camelot-matches').innerHTML = `
      <div class="harmony-box">Mismo Tono<strong>${key}</strong></div>
      <div class="harmony-box">Subir Energía (+1)<strong>${next}${lettr}</strong></div>
      <div class="harmony-box">Bajar Energía (-1)<strong>${prev}${lettr}</strong></div>
      <div class="harmony-box">Escala Relativa<strong>${num}${rel}</strong></div>
    `;
  }
  document.getElementById('camelot-picker')?.addEventListener('change', renderCamelotHelper);

  function renderPhraseTimings(bpm = 128) {
    const beat = 60 / bpm;
    const grid = document.getElementById('timing-grid');
    if (!grid) return;
    grid.innerHTML = `
      <div class="harmony-box">16 Beats (4 compases)<strong>${(beat * 16).toFixed(1)} s</strong></div>
      <div class="harmony-box">32 Beats (8 compases)<strong>${(beat * 32).toFixed(1)} s</strong></div>
      <div class="harmony-box">64 Beats (Intro completa)<strong>${(beat * 64).toFixed(1)} s</strong></div>
      <div class="harmony-box">Delay 1/4 Nota<strong>${(beat * 250).toFixed(0)} ms</strong></div>
    `;
  }

  let fxCtx = null;
  document.querySelectorAll('.fx-pad').forEach(pad => {
    pad.addEventListener('click', () => {
      if (!fxCtx) fxCtx = new (window.AudioContext || window.webkitAudioContext)();
      const now = fxCtx.currentTime;
      const osc = fxCtx.createOscillator();
      const gain = fxCtx.createGain();
      osc.connect(gain);
      gain.connect(fxCtx.destination);

      const type = pad.dataset.fx;
      if (type === 'sub') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(115, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.75);
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.start(now);
        osc.stop(now + 0.8);
      } else if (type === 'siren') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(760, now + 0.25);
        osc.frequency.linearRampToValueAtTime(440, now + 0.5);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
        osc.start(now);
        osc.stop(now + 0.52);
      } else if (type === 'laser') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1300, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.28);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(980, now + 0.65);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc.start(now);
        osc.stop(now + 0.7);
      }
    });
  });

  // =========================================================
  // 7. REPRODUCTOR DE AUDIO Y ECUALIZADOR EN VIVO
  // =========================================================
  const audioEl = document.getElementById('audio-player');
  const playToggleBtn = document.getElementById('btn-toggle-play');
  const playIcon = document.getElementById('icon-play-state');
  const scrubInput = document.getElementById('scrub-input');
  let eqReady = false;
  let lowNode, midNode, highNode;

  function setupEqNodes() {
    if (eqReady) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(audioEl);
      lowNode = ctx.createBiquadFilter();
      lowNode.type = 'lowshelf';
      lowNode.frequency.value = 240;

      midNode = ctx.createBiquadFilter();
      midNode.type = 'peaking';
      midNode.frequency.value = 1100;

      highNode = ctx.createBiquadFilter();
      highNode.type = 'highshelf';
      highNode.frequency.value = 4200;

      src.connect(lowNode);
      lowNode.connect(midNode);
      midNode.connect(highNode);
      highNode.connect(ctx.destination);
      eqReady = true;
    } catch (_) {}
  }

  function streamTrackInPlayer(track) {
    state.playingId = track.id || null;
    document.getElementById('np-title').textContent = track.title;
    document.getElementById('np-artist').textContent = `${track.artist} · ${track.genre}`;
    document.getElementById('np-bpm').textContent = track.bpm;
    document.getElementById('np-key').textContent = track.key;
    document.getElementById('np-cover').src = track.thumbnail || FALLBACK_COVER;
    renderPhraseTimings(track.bpm);

    const srcUrl = track.localBlobUrl || buildMediaUrl(track, 'stream');
    audioEl.src = srcUrl;
    setupEqNodes();
    audioEl.play().then(() => {
      playIcon.className = 'ph-fill ph-pause';
      renderCrateTable();
    }).catch(() => {
      toast('Cargando audio en el reproductor...');
    });
  }

  playToggleBtn?.addEventListener('click', () => {
    if (!audioEl.src && state.crate.length) {
      streamTrackInPlayer(state.crate[0]);
      return;
    }
    if (audioEl.paused) {
      audioEl.play();
      playIcon.className = 'ph-fill ph-pause';
    } else {
      audioEl.pause();
      playIcon.className = 'ph-fill ph-play';
    }
  });

  document.getElementById('btn-next-track')?.addEventListener('click', () => {
    if (!state.crate.length) return;
    const idx = state.crate.findIndex(t => t.id === state.playingId);
    const next = state.crate[(idx + 1) % state.crate.length];
    if (next) streamTrackInPlayer(next);
  });

  document.getElementById('btn-prev-track')?.addEventListener('click', () => {
    if (!state.crate.length) return;
    const idx = state.crate.findIndex(t => t.id === state.playingId);
    const prev = state.crate[(idx - 1 + state.crate.length) % state.crate.length];
    if (prev) streamTrackInPlayer(prev);
  });

  audioEl?.addEventListener('timeupdate', () => {
    if (!audioEl.duration) return;
    scrubInput.value = (audioEl.currentTime / audioEl.duration) * 100;
    document.getElementById('time-cur').textContent = fmtTime(audioEl.currentTime);
    document.getElementById('time-dur').textContent = fmtTime(audioEl.duration);
  });

  scrubInput?.addEventListener('input', () => {
    if (audioEl.duration) {
      audioEl.currentTime = (scrubInput.value / 100) * audioEl.duration;
    }
  });

  document.getElementById('vol-input')?.addEventListener('input', (e) => {
    audioEl.volume = parseFloat(e.target.value);
  });

  ['low', 'mid', 'high'].forEach(band => {
    const sl = document.getElementById(`eq-${band}`);
    const lbl = document.getElementById(`eq-${band}-lbl`);
    sl?.addEventListener('input', () => {
      const v = Number(sl.value);
      lbl.textContent = `${v > 0 ? '+' : ''}${v} dB`;
      if (band === 'low' && lowNode) lowNode.gain.value = v;
      if (band === 'mid' && midNode) midNode.gain.value = v;
      if (band === 'high' && highNode) highNode.gain.value = v;
    });
  });

  document.getElementById('btn-eq-flat')?.addEventListener('click', () => {
    ['low', 'mid', 'high'].forEach(b => {
      document.getElementById(`eq-${b}`).value = 0;
      document.getElementById(`eq-${b}-lbl`).textContent = '0 dB';
    });
    if (lowNode) lowNode.gain.value = 0;
    if (midNode) midNode.gain.value = 0;
    if (highNode) highNode.gain.value = 0;
  });

  // =========================================================
  // 8. TAP TEMPO & EXPORTACIONES
  // =========================================================
  document.getElementById('tap-tempo-btn')?.addEventListener('click', () => {
    const now = performance.now();
    if (state.tapTimestamps.length && now - state.tapTimestamps[state.tapTimestamps.length - 1] > 2000) {
      state.tapTimestamps = [];
    }
    state.tapTimestamps.push(now);
    if (state.tapTimestamps.length > 6) state.tapTimestamps.shift();

    if (state.tapTimestamps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < state.tapTimestamps.length; i++) {
        sum += state.tapTimestamps[i] - state.tapTimestamps[i - 1];
      }
      const bpm = Math.round(60000 / (sum / (state.tapTimestamps.length - 1)));
      document.getElementById('tap-bpm-readout').textContent = `${bpm} BPM`;
    }
  });

  function downloadTextFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }

  document.getElementById('btn-export-m3u')?.addEventListener('click', () => {
    let out = '#EXTM3U\n';
    state.crate.forEach(t => {
      out += `#EXTINF:200,[${t.bpm} BPM - ${t.key}] ${t.artist} - ${t.title}\n${t.title}.mp3\n`;
    });
    downloadTextFile(out, 'musiksml_setlist.m3u', 'audio/x-mpegurl');
    toast('Archivo .M3U exportado.');
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    let csv = 'Posicion,Titulo,Artista,Genero,BPM,Tono\n';
    state.crate.forEach((t, i) => {
      csv += `${i + 1},"${t.title}","${t.artist}","${t.genre}",${t.bpm},${t.key}\n`;
    });
    downloadTextFile(csv, 'musiksml_crate.csv', 'text/csv');
    toast('Archivo .CSV exportado.');
  });

  document.getElementById('btn-export-xml')?.addEventListener('click', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="musiksml" Version="1.0"/>
  <COLLECTION Entries="${state.crate.length}">
${state.crate.map((t, i) => `    <TRACK TrackID="${i + 1}" Name="${t.title}" Artist="${t.artist}" Genre="${t.genre}" AverageBpm="${t.bpm}.00" Tonality="${t.key}"/>`).join('\n')}
  </COLLECTION>
</DJ_PLAYLISTS>`;
    downloadTextFile(xml, 'musiksml_rekordbox.xml', 'text/xml');
    toast('Archivo Rekordbox .XML exportado.');
  });

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function toast(msg) {
    const stack = document.getElementById('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  renderGenreTags();
  renderCrateTable();
});