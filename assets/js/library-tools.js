"use strict";

// Identity belongs to the recording, rather than to its position in a playlist.
function trackIdentity(track) {
  if (track.localId || track.localBlobUrl)
    return String(
      track.localId || track.id || track.uid || `local_${hash(track.title)}`,
    );
  try {
    const url = new URL(track.url);
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname)) {
      const video = url.hostname.endsWith("youtu.be")
        ? url.pathname.split("/").filter(Boolean)[0]
        : url.searchParams.get("v") ||
          url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
      if (video) return `youtube_${video}`;
    }
    if (url.hostname === "open.spotify.com" && /\/track\//.test(url.pathname))
      return `spotify_${url.pathname.split("/track/")[1].split("/")[0]}`;
    return `track_${hash(url.origin + url.pathname + url.search)}`;
  } catch {}
  if (
    track.id &&
    !track.uid &&
    !track.search_query &&
    track.source !== "Spotify"
  )
    return String(track.id);
  const text = (value) =>
    String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  return `song_${hash(`${text(track.artist)}|${text(track.title)}`)}`;
}

function mergeTrack(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    ...incoming,
    thumbnail: incoming.thumbnail || existing.thumbnail,
    duration:
      existing.analysis?.duration || incoming.duration || existing.duration,
    analysis: existing.analysis || incoming.analysis || null,
    isRealAudioAnalyzed:
      existing.isRealAudioAnalyzed || incoming.isRealAudioAnalyzed,
    bpm: existing.isRealAudioAnalyzed
      ? existing.bpm
      : incoming.bpm || existing.bpm,
    key: existing.isRealAudioAnalyzed
      ? existing.key
      : incoming.key || existing.key,
  };
}

function repairCollections() {
  const aliases = new Map();
  const unique = new Map();
  const visit = (track) => {
    const id = trackIdentity(track);
    aliases.set(track.id, id);
    const normalized = { ...track, id };
    unique.set(id, mergeTrack(unique.get(id), normalized));
    return normalized;
  };
  state.library.forEach(visit);
  state.queue.forEach((q) => {
    q.track = visit(q.track);
  });
  state.imported?.tracks.forEach(visit);
  // Imported songs and unsaved queue entries must not be added to the library.
  state.library = [...new Set(state.library.map((t) => aliases.get(t.id)))].map(
    (id) => unique.get(id),
  );
  const queueIds = new Set();
  state.queue = state.queue.filter((q) => {
    if (queueIds.has(q.track.id)) return false;
    queueIds.add(q.track.id);
    q.track = unique.get(q.track.id);
    q.start = Math.max(0, Number(q.start) || 0);
    q.end = Number.isFinite(q.end) && q.end > q.start ? q.end : null;
    q.fadeOut = Number.isFinite(q.fadeOut)
      ? Math.max(0, Math.min(16, q.fadeOut))
      : null;
    q.levelDb = Math.max(-12, Math.min(6, Number(q.levelDb) || 0));
    return true;
  });
  state.favorites = [
    ...new Set(state.favorites.map((id) => aliases.get(id) || id)),
  ];
  state.playlists.forEach((playlist) => {
    playlist.trackIds = [
      ...new Set(playlist.trackIds.map((id) => aliases.get(id) || id)),
    ];
  });
  if (state.imported)
    state.imported.tracks = [
      ...new Set(state.imported.tracks.map((t) => t.id)),
    ].map((id) => unique.get(id));
}

const artworkRequests = new Map();
const failedArtwork = new Set();
const artworkTasks = [];
let artworkActive = 0;
function resolveArtwork(track) {
  if (artworkRequests.has(track.id)) return artworkRequests.get(track.id);
  const promise = new Promise((resolve) => {
    artworkTasks.push(async () => {
      try {
        const data = await request(
          `${API_BASE}/api/artwork?${new URLSearchParams({ q: `${track.artist} ${track.title}` })}`,
          {},
          12000,
        );
        resolve(safeImage(data.url));
      } catch {
        resolve("");
      }
    });
  });
  artworkRequests.set(track.id, promise);
  pumpArtwork();
  return promise;
}
function pumpArtwork() {
  while (artworkActive < 3 && artworkTasks.length) {
    artworkActive++;
    artworkTasks
      .shift()()
      .finally(() => {
        artworkActive--;
        pumpArtwork();
      });
  }
}

const artworkObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      artworkObserver.unobserve(entry.target);
      entry.target._loadArtwork?.();
    }
  },
  { rootMargin: "160px" },
);

function paintArtwork(el, track) {
  const key = `${track?.id || "empty"}|${track?.thumbnail || ""}`;
  if (el.dataset.artKey === key) return;
  artworkObserver.unobserve(el);
  el.dataset.artKey = key;
  const initials = String(track?.title || "m.")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const fallback = document.createElement("span");
  fallback.className = "art-initials";
  fallback.textContent = track ? initials : "m.";
  el.replaceChildren(fallback);
  if (!track) return;
  el.style.setProperty("--art-hue", parseInt(hash(track.id), 36) % 360);
  el.classList.add("has-art-identity");
  el._loadArtwork = async () => {
    const candidates = [track.thumbnail];
    if (track.id.startsWith("youtube_")) {
      const video = track.id.slice(8);
      candidates.push(
        `https://i.ytimg.com/vi/${video}/hqdefault.jpg`,
        `https://i.ytimg.com/vi/${video}/mqdefault.jpg`,
      );
    }
    const display = (url) =>
      new Promise((resolve) => {
        if (!url || failedArtwork.has(url) || el.dataset.artKey !== key) {
          resolve(false);
          return;
        }
        const img = new Image();
        img.alt = "";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.onload = () => {
          if (el.dataset.artKey === key) el.replaceChildren(img);
          resolve(true);
        };
        img.onerror = () => {
          failedArtwork.add(url);
          resolve(false);
        };
        img.src = url;
      });
    for (const url of [...new Set(candidates)]) if (await display(url)) return;
    // Album lookups are shared by library, decks and player, and only run onscreen.
    const recovered = await resolveArtwork(track);
    if (await display(recovered)) {
      track.thumbnail = recovered;
      state.library
        .filter((t) => t.id === track.id)
        .forEach((t) => {
          t.thumbnail = recovered;
        });
      persist();
    }
  };
  artworkObserver.observe(el);
}
