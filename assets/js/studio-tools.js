"use strict";

let studioJob = null;
let analysisTail = Promise.resolve();
const analysisJobs = new Map();
const attemptedDurations = new Set();
let activeAnalyses = 0;

function normalizeAnalysis(value) {
  if (
    !value ||
    value.version !== 1 ||
    !(value.duration > 0) ||
    !Array.isArray(value.peaks)
  )
    return null;
  return {
    version: 1,
    duration: Number(value.duration),
    contentStart: Math.max(0, Number(value.contentStart) || 0),
    contentEnd: Math.min(
      value.duration,
      Number(value.contentEnd) || value.duration,
    ),
    peaks: value.peaks
      .slice(0, 256)
      .map((p) => Math.min(1, Math.max(0, Number(p) || 0))),
    gain: Math.min(1.4, Math.max(0, Number(value.gain) || 1)),
    peak: Math.max(0, Number(value.peak) || 0),
    rms: Math.max(0, Number(value.rms) || 0),
    bpm: value.bpm > 0 ? Number(value.bpm) : null,
    confidence: Math.min(1, Math.max(0, Number(value.confidence) || 0)),
  };
}
function exactTime(value) {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(Math.max(0, value) * 100) / 100;
  const minutes = Math.floor(rounded / 60);
  const rest = (rounded - minutes * 60).toFixed(2).replace(/\.?0+$/, "");
  const [whole, fraction] = rest.split(".");
  return `${minutes}:${whole.padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}
function clipGain(q) {
  const gain =
    (q?.track.analysis?.gain ?? 1) * Math.pow(10, (q?.levelDb || 0) / 20);
  return q?.track.analysis?.peak
    ? Math.min(gain, 0.9 / q.track.analysis.peak)
    : gain;
}
function queueEntry(track) {
  return state.queue.find((q) => q.track.id === track?.id);
}
function refreshTrackDuration(track, duration, analysis = null) {
  if (!Number.isFinite(duration) || duration <= 0) return;
  for (const list of [
    state.library,
    state.imported?.tracks || [],
    state.queue.map((q) => q.track),
    [track],
  ]) {
    for (const found of list.filter((t) => t.id === track.id)) {
      found.duration = duration;
      if (analysis) found.analysis = analysis;
    }
  }
  document.querySelectorAll(".track-row").forEach((row) => {
    if (row.dataset.trackId !== track.id) return;
    row.querySelector(".track-duration").textContent = seconds(duration);
    if (row._refreshClip) row._refreshClip();
  });
  persist();
  refreshSessionOverview();
}
function refreshSessionOverview() {
  const unknown = state.queue.filter((q) => !q.track.duration).length;
  $("mixDuration").textContent =
    `${state.queue.length} canciones · ${unknown ? "calculando duración" : `${seconds(sessionDuration())} de música`}`;
  $("prepareMixBtn").disabled =
    !state.queue.length || Boolean(studioJob) || Boolean(exportJob);
  $("cancelPrepareBtn").classList.toggle("hidden", !studioJob);
  $("exportMixBtn").disabled =
    !state.queue.length ||
    Boolean(exportJob) ||
    Boolean(studioJob) ||
    activeAnalyses > 0;
  $("mixTimeline").replaceChildren();
  let offset = 0;
  state.queue.forEach((q, i) => {
    if (i) offset -= transitionDuration(state.queue[i - 1], q);
    const clip = document.createElement("button");
    clip.className = `timeline-clip tone-${i % 5}`;
    clip.style.flexGrow = Math.max(1, fragmentDuration(q));
    clip.innerHTML = `<span>${String(i + 1).padStart(2, "0")} · ${escapeHTML(q.track.title)}</span><small>${seconds(offset)} → ${q.track.duration ? seconds(fragmentDuration(q)) : "por cargar"}</small>`;
    clip.setAttribute("aria-label", `Editar ${q.track.title}`);
    clip.onclick = () => {
      const row = [...$("mixQueueContainer").children].find(
        (r) => r.dataset.trackId === q.track.id,
      );
      row?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "center",
      });
      row?.querySelector(".trim-start")?.focus({ preventScroll: true });
    };
    $("mixTimeline").append(clip);
    offset += fragmentDuration(q);
  });
}

async function analyzeTrack(track, externalSignal) {
  if (track.analysis) return track.analysis;
  if (analysisJobs.has(track.id)) {
    const existing = analysisJobs.get(track.id);
    if (externalSignal?.aborted) existing.cancel();
    else if (externalSignal) {
      externalSignal.addEventListener("abort", existing.cancel, { once: true });
      existing
        .finally(() =>
          externalSignal.removeEventListener("abort", existing.cancel),
        )
        .catch(() => {});
    }
    return existing;
  }
  const controller = new AbortController();
  const signal = controller.signal;
  const cancel = () => controller.abort();
  if (externalSignal?.aborted) cancel();
  else externalSignal?.addEventListener("abort", cancel, { once: true });
  const task = analysisTail
    .catch(() => {})
    .then(async () => {
      if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
      activeAnalyses++;
      refreshSessionOverview();
      let worker;
      try {
        const maxBytes = 128 * 1024 * 1024;
        if (track.duration * 22050 * 8 > maxBytes)
          throw new Error(
            "Este audio es demasiado largo para analizarlo en el navegador. Puedes editar los tiempos y exportar fragmentos más cortos.",
          );
        let array;
        if (track.localId) {
          const file = await getAudio(track.localId);
          if (!file)
            throw new Error(
              "Vuelve a añadir el archivo local para preparar su audio.",
            );
          if (file.size > maxBytes / 2)
            throw new Error(
              "El archivo es demasiado grande para analizarlo aquí.",
            );
          array = await file.arrayBuffer();
        } else
          array = await request(
            await mediaURL(track),
            { audio: true, signal },
            180000,
          );
        if (array.byteLength > maxBytes / 2)
          throw new Error(
            "El archivo es demasiado grande para analizarlo aquí.",
          );
        const Offline =
          window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Offline)
          throw new Error(
            "Este navegador no permite analizar audio. Usa Safari o Chrome actualizado.",
          );
        const decoder = new Offline(1, 1, 22050);
        const buffer = await decoder.decodeAudioData(array);
        if (buffer.length * buffer.numberOfChannels * 4 > maxBytes)
          throw new Error(
            "El audio supera la memoria disponible para analizarlo.",
          );
        if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
        worker = new Worker("assets/js/audio-analysis-worker.js");
        const channels = Array.from(
          { length: Math.min(2, buffer.numberOfChannels) },
          (_, c) => buffer.getChannelData(c).slice(),
        );
        const analysis = await new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeout);
            signal.removeEventListener("abort", abortWorker);
          };
          const abortWorker = () => {
            cleanup();
            reject(new DOMException("Cancelado", "AbortError"));
          };
          const timeout = setTimeout(() => {
            cleanup();
            reject(
              new Error(
                "El análisis tardó demasiado. Puedes editar los tiempos manualmente.",
              ),
            );
          }, 30000);
          signal.addEventListener("abort", abortWorker, { once: true });
          worker.onmessage = (event) => {
            cleanup();
            resolve(normalizeAnalysis(event.data));
          };
          worker.onerror = () => {
            cleanup();
            reject(
              new Error(
                "No se pudo analizar el audio. Puedes ajustar los tiempos manualmente.",
              ),
            );
          };
          worker.postMessage(
            {
              channels,
              sampleRate: buffer.sampleRate,
              duration: buffer.duration,
            },
            channels.map((c) => c.buffer),
          );
        });
        refreshTrackDuration(track, buffer.duration, analysis);
        return analysis;
      } finally {
        worker?.terminate();
        activeAnalyses--;
        refreshSessionOverview();
      }
    });
  analysisTail = task;
  task.cancel = cancel;
  analysisJobs.set(track.id, task);
  task
    .finally(() => {
      analysisJobs.delete(track.id);
      externalSignal?.removeEventListener("abort", cancel);
    })
    .catch(() => {});
  return task;
}

const durationObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      durationObserver.unobserve(entry.target);
      const q = entry.target._queueEntry;
      if (!q || q.track.duration || attemptedDurations.has(q.track.id))
        continue;
      attemptedDurations.add(q.track.id);
      loadClipAudio(q);
    }
  },
  { rootMargin: "80px" },
);

async function loadClipAudio(q, button = null) {
  document.querySelectorAll(".track-row").forEach((row) => {
    if (row.dataset.trackId !== q.track.id) return;
    const status = row.querySelector(".clip-audio-status");
    if (status) {
      status.classList.remove("error");
      status.textContent = "Cargando el audio y calculando su duración…";
    }
  });
  if (button) {
    button.disabled = true;
    button.textContent = "Preparando…";
  }
  try {
    await analyzeTrack(q.track);
  } catch (error) {
    document.querySelectorAll(".track-row").forEach((row) => {
      if (row.dataset.trackId === q.track.id) {
        const status = row.querySelector(".clip-audio-status");
        if (status) {
          status.textContent =
            error.name === "AbortError"
              ? "Carga cancelada. Puedes volver a preparar el audio."
              : error.message;
          status.classList.toggle("error", error.name !== "AbortError");
        }
      }
    });
    if (button) toast(error.message);
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = q.track.analysis
        ? "Audio listo ✓"
        : "Preparar audio";
    }
  }
}

async function prepareAutomix() {
  if (studioJob || exportJob || !state.queue.length) return;
  const job = { controller: new AbortController() };
  studioJob = job;
  $("prepareStatus").classList.remove("hidden");
  refreshSessionOverview();
  let prepared = 0,
    failed = 0;
  try {
    for (const [i, q] of [...state.queue].entries()) {
      if (job.controller.signal.aborted) break;
      $("prepareStatus").textContent =
        `Preparando ${i + 1}/${state.queue.length} · ${q.track.title}`;
      try {
        const analysis = await analyzeTrack(q.track, job.controller.signal);
        if (job.controller.signal.aborted) break;
        if (!q.edited) {
          q.start = analysis.contentStart;
          q.end = analysis.contentEnd;
        }
        q.autoPrepared = true;
        prepared++;
      } catch (error) {
        if (job.controller.signal.aborted) break;
        failed++;
      }
    }
    if (!job.controller.signal.aborted) {
      // Long blends are useful only when measured tempos are close. Otherwise
      // use a shorter crossfade and avoid stacking two bass lines for too long.
      state.queue.forEach((q, i) => {
        if (q.transitionEdited || i === state.queue.length - 1) return;
        const next = state.queue[i + 1];
        const a = q.track.analysis?.bpm,
          b = next.track.analysis?.bpm;
        q.fadeOut =
          a && b && Math.abs(a - b) <= 8
            ? Math.min(10, Math.round((480 / a) * 10) / 10)
            : 4;
      });
      state.automix = true;
      syncSettings();
    }
    persist();
    $("prepareStatus").textContent = job.controller.signal.aborted
      ? "Preparación cancelada. Se conservan los ajustes y el audio ya analizado."
      : prepared
        ? `${prepared} canciones preparadas${failed ? ` · ${failed} no se pudieron cargar` : ""}. Silencios recortados, volúmenes equilibrados y cruces ajustados. Tus recortes manuales se conservan.`
        : "No se pudo preparar el audio. Puedes ajustar los tiempos manualmente o volver a intentar.";
  } finally {
    studioJob = null;
    renderQueue();
    if (engine.track && engine.source === "queue") engine.applyTrim();
    engine.preloadNext();
  }
}

function makeClipEditor(row, q, index) {
  const edit = document.createElement("div");
  edit.className = "queue-edit clip-editor";
  const title = escapeHTML(q.track.title);
  const last = index === state.queue.length - 1;
  edit.innerHTML = `
    <div class="clip-heading"><span class="clip-number">${String(index + 1).padStart(2, "0")}</span><strong>Elige el fragmento</strong><span class="fragment-duration"></span></div>
    <div class="waveform" role="group" aria-label="Forma de onda de ${title}"><svg viewBox="0 0 576 80" preserveAspectRatio="none" aria-hidden="true"></svg><div class="wave-selection" aria-hidden="true"></div><span class="wave-empty">Prepara el audio para ver su onda</span><input class="wave-seek" type="range" min="0" max="1" step="0.1" value="0" aria-label="Escuchar un segundo de ${title}" disabled></div>
    <div class="cue-fields"><label>Entrada <span><input class="trim-start" aria-label="Inicio de ${title}, minutos y segundos" inputmode="decimal" value="0:00"><small class="start-seconds"></small></span><input class="start-range" type="range" min="0" max="1" step="0.1" value="0" aria-label="Segundo de entrada de ${title}"></label><label>Salida <span><input class="trim-end" aria-label="Final de ${title}, minutos y segundos" inputmode="decimal" placeholder="Cargando duración…"><small class="end-seconds"></small></span><input class="end-range" type="range" min="0" max="1" step="0.1" value="1" aria-label="Segundo de salida de ${title}"></label></div>
    <div class="clip-tools"><button class="small-button preview-intro"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg> Entrada</button><button class="small-button preview-outro"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg> Final</button><button class="small-button reset-trim">Canción completa</button><button class="small-button prepare-clip">Preparar audio</button></div>
    <div class="clip-transition"><label>Volumen del fragmento <input class="clip-level" type="range" min="-12" max="6" step="1" value="${q.levelDb || 0}" aria-label="Volumen de ${title}"><output class="clip-level-label">0 dB</output></label>${last ? '<p class="closing-note">Último tema · el mix conserva su final.</p>' : `<label>Cruce con el siguiente <input class="clip-fade" type="range" min="0" max="16" step="0.5" value="${q.fadeOut ?? state.fade}" aria-label="Transición después de ${title}"><output class="clip-fade-label"></output></label><button class="small-button preview-bridge">Escuchar cruce ↝</button>`}</div>
    <p class="clip-audio-status" role="status"></p>`;
  row.append(edit);
  row._queueEntry = q;
  let waveformKey = "";
  const refresh = () => {
    const duration = q.track.duration;
    const end = q.end ?? duration;
    const start = q.start || 0;
    for (const [selector, value] of [
      [".trim-start", start],
      [".trim-end", end],
    ]) {
      const input = edit.querySelector(selector);
      if (
        document.activeElement !== input &&
        !input.matches('[aria-invalid="true"]')
      )
        input.value =
          value || selector === ".trim-start" ? exactTime(value) : "";
    }
    for (const [selector, value] of [
      [".start-range", start],
      [".end-range", end],
      [".wave-seek", start],
    ]) {
      const input = edit.querySelector(selector);
      input.max = duration || 1;
      input.disabled = !duration || Boolean(exportJob) || Boolean(studioJob);
      if (document.activeElement !== input) input.value = value || 0;
    }
    edit.querySelector(".start-seconds").textContent =
      `${Math.round(start * 10) / 10} s`;
    edit.querySelector(".end-seconds").textContent =
      duration || q.end
        ? `${Math.round(end * 10) / 10} s`
        : "Duración por cargar";
    edit.querySelector(".fragment-duration").textContent =
      duration || q.end
        ? `${seconds(fragmentDuration(q))} seleccionados`
        : "Cargando final…";
    const selection = edit.querySelector(".wave-selection");
    selection.style.left = `${duration ? (start / duration) * 100 : 0}%`;
    selection.style.width = `${duration ? Math.max(0, (end - start) / duration) * 100 : 100}%`;
    const analysis = q.track.analysis;
    edit
      .querySelector(".wave-empty")
      .classList.toggle("hidden", Boolean(analysis));
    edit.querySelector(".prepare-clip").textContent = analysis
      ? "Audio listo ✓"
      : "Preparar audio";
    const status = edit.querySelector(".clip-audio-status");
    if (!status.classList.contains("error"))
      status.textContent = analysis
        ? `Onda real · ${analysis.bpm ? `${analysis.bpm} BPM medidos · ` : ""}volumen equilibrado${q.autoPrepared ? " · silencios recortados" : ""}`
        : "Puedes escribir 1:30 o 90 para elegir el mismo segundo. La salida completa se carga automáticamente.";
    if (analysis && waveformKey !== JSON.stringify(analysis.peaks)) {
      waveformKey = JSON.stringify(analysis.peaks);
      edit.querySelector(".waveform svg").innerHTML = analysis.peaks
        .map(
          (value, i) =>
            `<line x1="${i * 3 + 1.5}" x2="${i * 3 + 1.5}" y1="${40 - Math.max(1, value * 35)}" y2="${40 + Math.max(1, value * 35)}"/>`,
        )
        .join("");
    }
    edit.querySelector(".clip-level-label").textContent =
      `${q.levelDb > 0 ? "+" : ""}${q.levelDb || 0} dB`;
    const fadeLabel = edit.querySelector(".clip-fade-label");
    if (fadeLabel) {
      const next = state.queue[index + 1];
      const effective = transitionDuration(q, next);
      fadeLabel.textContent = state.automix
        ? `${Math.round(effective * 10) / 10} s${effective === 0 ? " · corte" : ""}`
        : "Automix desactivado";
    }
  };
  row._refreshClip = refresh;
  const setTrim = (key, value, input) => {
    const start = key === "start" ? value : q.start || 0;
    const end =
      key === "end" ? value : (q.end ?? (q.track.duration || Infinity));
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      end - start < 0.1 ||
      (q.track.duration && end > q.track.duration + 0.1)
    ) {
      input.setAttribute("aria-invalid", "true");
      input.classList.add("invalid");
      toast(
        "Elige segundos dentro de la canción. La salida debe estar después de la entrada.",
      );
      return;
    }
    input.removeAttribute("aria-invalid");
    input.classList.remove("invalid");
    q[key] = value;
    q.edited = true;
    if (engine.track?.id === q.track.id && engine.source === "queue")
      engine.applyTrim();
    persist();
    refresh();
    refreshSessionOverview();
    engine.preloadNext();
  };
  for (const [key, text, range] of [
    ["start", ".trim-start", ".start-range"],
    ["end", ".trim-end", ".end-range"],
  ]) {
    edit.querySelector(text).onchange = (e) =>
      setTrim(key, parseTime(e.target.value), e.target);
    edit.querySelector(range).oninput = (e) => {
      const boundary =
        key === "start"
          ? (q.end ?? q.track.duration) - 0.1
          : (q.start || 0) + 0.1;
      const value =
        key === "start"
          ? Math.min(Number(e.target.value), boundary)
          : Math.max(Number(e.target.value), boundary);
      e.target.value = value;
      setTrim(key, value, e.target);
    };
  }
  edit.querySelector(".wave-seek").onchange = (e) =>
    previewClip(q, Number(e.target.value));
  edit.querySelector(".preview-intro").onclick = () =>
    previewClip(q, q.start || 0);
  edit.querySelector(".preview-outro").onclick = () =>
    previewClip(q, Math.max(q.start || 0, (q.end ?? q.track.duration) - 8));
  edit.querySelector(".reset-trim").onclick = () => {
    q.start = 0;
    q.end = null;
    q.edited = true;
    edit.querySelectorAll("[aria-invalid]").forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.classList.remove("invalid");
    });
    persist();
    refresh();
    refreshSessionOverview();
    if (engine.track?.id === q.track.id && engine.source === "queue")
      engine.applyTrim();
  };
  edit.querySelector(".prepare-clip").onclick = (e) =>
    loadClipAudio(q, e.currentTarget);
  edit.querySelector(".clip-level").oninput = (e) => {
    q.levelDb = Number(e.target.value);
    persist();
    refresh();
    engine.refreshGains();
  };
  const fade = edit.querySelector(".clip-fade");
  if (fade)
    fade.oninput = (e) => {
      q.fadeOut = Number(e.target.value);
      q.transitionEdited = true;
      persist();
      refresh();
      refreshSessionOverview();
    };
  edit
    .querySelector(".preview-bridge")
    ?.addEventListener("click", () => previewBridge(q));
  refresh();
  if (!q.track.duration) durationObserver.observe(row);
}

async function previewClip(q, position) {
  const ready = await engine.start(q.track, false, {
    source: "queue",
    list: state.queue.map((item) => item.track),
  });
  if (!ready) return;
  const trim = engine.trim(q.track, "queue");
  engine.active.currentTime = Math.max(
    trim.start,
    Math.min(position, trim.end - 0.1),
  );
}
async function previewBridge(q) {
  const next = state.queue[state.queue.indexOf(q) + 1];
  if (!next) return;
  if (!state.automix) {
    toast("Activa las transiciones automáticas para escuchar este cruce.");
    return;
  }
  const ready = await engine.start(q.track, false, {
    source: "queue",
    list: state.queue.map((item) => item.track),
  });
  if (!ready) return;
  const revision = engine.revision;
  engine.active.pause();
  await engine.preloadNext();
  if (engine.revision !== revision) return;
  if (engine.track?.id !== q.track.id || engine.prepared !== next.track.id) {
    toast(
      "La siguiente canción todavía no está lista. Prueba a preparar su audio.",
    );
    return;
  }
  const fade = transitionDuration(q, next);
  engine.active.currentTime = Math.max(
    q.start || 0,
    (q.end ?? q.track.duration) - fade - 2,
  );
  await engine.toggle();
}
