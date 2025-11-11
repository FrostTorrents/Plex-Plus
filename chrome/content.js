// content.js — overlay + sleep timer + skipper bootstrap + series key publisher
// • Overlay is draggable + resizable with a handle
// • Position/scale/opacity persist in chrome.storage.local (overlayState)
// • Popup can toggle/show and adjust via messages
// • Timer only counts down while the video is playing (auto-pauses/resumes with playback)

let settings = {};
let currentSeriesTitle = '';
let fadeInterval = null;
let originalVolume = 1;
let remainingSeconds = 0;
let timerInterval = null;       // ticking loop
let timerSuspended = false;     // true when video is paused/ended
let videoEventsBound = false;   // ensure we bind once

const fadeVolumeStep = 5; // 5% every 30s in final minutes
const IS_TOP = window.top === window;

// ---------- boot ----------
(async function init() {
  settings = await getSettings();

  if (IS_TOP) {
    currentSeriesTitle = resolveSeriesTitle();
    publishActiveSeries(currentSeriesTitle);

    if (settings.countdownVisible) {
      await ensureOverlayVisible();
    }

    // Wire to current <video> (and any future swaps)
    bindVideoEventsOnce();

    handleEpisodeGuard();
    startSkippersWhenReady();
    watchSeriesChanges();
  } else {
    currentSeriesTitle = await waitForActiveSeriesTitle(60, 200) || 'Unknown Series';
    startSkippersWhenReady();
  }

  // Popup -> content control (ensure overlay is visible first for timer ops)
  chrome.runtime.onMessage.addListener((msg) => {
    if (!IS_TOP) return; // overlay lives in top frame
    if (!msg?.type) return;

    if (msg.type === 'overlay:toggle') {
      if (msg.show) ensureOverlayVisible();
      else removeOverlay();
    } else if (msg.type === 'timer:add') {
      ensureOverlayVisible().then(() => startOrExtendTimer((Number(msg.minutes) || 0) * 60));
    } else if (msg.type === 'timer:sub') {
      ensureOverlayVisible().then(() => {
        remainingSeconds = Math.max(0, remainingSeconds - ((Number(msg.minutes) || 10) * 60));
        updateDisplay();
      });
    } else if (msg.type === 'timer:cancel') {
      ensureOverlayVisible().then(() => stopTimer());
    }
  });

  // Storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    Object.keys(changes).forEach(k => (settings[k] = changes[k].newValue));

    if (IS_TOP && Object.prototype.hasOwnProperty.call(changes, 'countdownVisible')) {
      changes.countdownVisible.newValue ? ensureOverlayVisible() : removeOverlay();
    }

    if (typeof window.updateSkipperSettings === 'function') window.updateSkipperSettings(settings, currentSeriesTitle);
    if (typeof window.updateOutroSettings === 'function') window.updateOutroSettings(settings, currentSeriesTitle);
    if (typeof window.updateNextSettings === 'function') window.updateNextSettings(settings, currentSeriesTitle);
  });
})();

// ---------- skippers ----------
function startSkippersWhenReady() {
  waitFor(() => typeof window.initSkipper === 'function', 40, 120).then(ok => ok && window.initSkipper(settings, currentSeriesTitle));
  waitFor(() => typeof window.initOutroSkipper === 'function', 40, 120).then(ok => ok && window.initOutroSkipper(settings, currentSeriesTitle));
  waitFor(() => typeof window.initNextSkipper === 'function', 40, 120).then(ok => ok && window.initNextSkipper(settings, currentSeriesTitle));
}

function waitFor(predicate, retries = 30, delay = 150) {
  return new Promise(resolve => {
    const t = setInterval(() => {
      if (predicate()) { clearInterval(t); resolve(true); }
      else if (--retries <= 0) { clearInterval(t); resolve(false); }
    }, delay);
  });
}

async function waitForActiveSeriesTitle(retries = 60, delay = 200) {
  for (let i = 0; i < retries; i++) {
    const v = await readActiveSeriesFromLocal();
    if (v) return v;
    await new Promise(r => setTimeout(r, delay));
  }
  return null;
}

// ---------- series helpers ----------
function readActiveSeriesFromLocal() {
  return new Promise(resolve => {
    chrome.storage.local.get(['activeSeriesTitle'], ({ activeSeriesTitle }) => resolve(activeSeriesTitle || null));
  });
}

function publishActiveSeries(title) {
  const canonical = canonicalizeSeriesTitle(title);
  const key = normalizeTitle(canonical);
  chrome.storage.local.set({ activeSeriesTitle: canonical, activeSeriesKey: key, activeSeriesUpdatedAt: Date.now() });
}

function normalizeTitle(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}\s]+/gu, '').trim();
}

function canonicalizeSeriesTitle(s) {
  let t = (s || '').trim();
  t = t.replace(/\s*[-–—]\s*S\d+\s*[·x×]?\s*E\d+\s*$/i, '');
  t = t.replace(/\s*\(\s*S\d+\s*[·x×]?\s*E\d+\s*\)\s*$/i, '');
  t = t.replace(/\s*\bS(?:eason)?\s*\d+\s*[·x×.]?\s*E(?:pisode)?\s*\d+\b.*$/i, '');
  t = t.replace(/\s*\bS\d+\s*E\d+\b.*$/i, '');
  t = t.replace(/\s*[-–—]\s*Season\s*\d+\s*Episode\s*\d+\s*$/i, '');
  t = t.replace(/\s*\bSeason\s*\d+\s*Episode\s*\d+\b.*$/i, '');
  return t.trim();
}

function watchSeriesChanges() {
  let last = currentSeriesTitle;
  const check = () => {
    const now = resolveSeriesTitle();
    if (now && now !== last) {
      last = now;
      currentSeriesTitle = now;
      publishActiveSeries(now);
      if (typeof window.updateSkipperSettings === 'function') window.updateSkipperSettings(settings, currentSeriesTitle);
      if (typeof window.updateOutroSettings === 'function') window.updateOutroSettings(settings, currentSeriesTitle);
      if (typeof window.updateNextSettings === 'function') window.updateNextSettings(settings, currentSeriesTitle);
    }
  };
  const mo = new MutationObserver(check);
  mo.observe(document, { childList: true, subtree: true });
  setInterval(check, 1500);
}

function getSettings() {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: 'getSettings' }, resolve));
}

function resolveSeriesTitle() {
  const el =
    document.querySelector('[data-qa-id="metadataGrandparentTitle"]') ||
    document.querySelector('[data-testid="metadataGrandparentTitle"]') ||
    document.querySelector('.PrePlayTitle .grandparent-title') ||
    document.querySelector('[data-testid="metadata-title"]');
  let raw = el?.textContent?.trim();
  if (!raw || raw.length < 2) raw = (document.title || '').replace(/\s+-\s*Plex.*/i, '').trim();
  return canonicalizeSeriesTitle(raw || 'Unknown Series');
}

// ---------- video helpers (drive timer with playback) ----------
function getVideo() {
  return document.querySelector('video');
}

function isVideoPlaying() {
  const v = getVideo();
  return !!(v && !v.paused && !v.ended && v.readyState > 2);
}

function bindVideoEventsOnce() {
  if (videoEventsBound) return;
  const v = getVideo();
  if (!v) return;

  videoEventsBound = true;
  v.addEventListener('play', onVideoPlay, { passive: true });
  v.addEventListener('pause', onVideoPause, { passive: true });
  v.addEventListener('ended', onVideoEnded, { passive: true });

  // If Plex swaps the <video>, rebind automatically
  const mo = new MutationObserver(() => {
    const nv = getVideo();
    if (nv && !nv.__spBound) {
      nv.__spBound = true;
      nv.addEventListener('play', onVideoPlay, { passive: true });
      nv.addEventListener('pause', onVideoPause, { passive: true });
      nv.addEventListener('ended', onVideoEnded, { passive: true });
    }
  });
  mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
}

function onVideoPlay() {
  timerSuspended = false;
  if (remainingSeconds > 0 && !timerInterval) {
    startOrExtendTimer(0); // resume ticking loop
  }
}

function onVideoPause() {
  timerSuspended = true; // loop continues but won't tick
}

function onVideoEnded() {
  timerSuspended = true;
  // optional: stopTimer(); // keep or remove depending on preference
}

// ---------- overlay + timer ----------
async function ensureOverlayVisible() {
  let overlay = document.getElementById('overlay');
  if (!overlay) {
    await injectOverlay();
    overlay = document.getElementById('overlay');
    bindOverlayControls();
  }
  if (overlay) overlay.style.display = 'inline-flex';
  return overlay;
}

function removeOverlay() {
  const overlay = document.getElementById('overlay');
  if (overlay) overlay.remove();
  stopTimer();
}

async function injectOverlay() {
  try {
    const res = await fetch(chrome.runtime.getURL('overlay.html'));
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const overlayTemplate = doc.querySelector('#overlay');
    if (!overlayTemplate) return;

    // clone and force runtime-safe styles
    const overlay = overlayTemplate.cloneNode(true);
    overlay.id = 'overlay';
    overlay.style.position = 'fixed';
    overlay.style.zIndex = '2147483647';
    overlay.style.display = 'inline-flex';
    overlay.style.alignItems = 'center';
    overlay.style.transformOrigin = 'left top';
    overlay.style.maxWidth = 'calc(100vw - 16px)';
    overlay.style.maxHeight = '96px';
    overlay.style.boxSizing = 'border-box';
    overlay.style.userSelect = 'none';
    overlay.style.touchAction = 'none';
    overlay.style.cursor = 'move';
    overlay.style.left = overlay.style.left || '20px';
    overlay.style.top  = overlay.style.top  || '20px';
    overlay.style.pointerEvents = 'auto';
    overlay.style.borderRadius = overlay.style.borderRadius || '18px';

    // Add a resize handle ▣
    const handle = document.createElement('div');
    handle.id = 'overlayResizeHandle';
    Object.assign(handle.style, {
      position: 'absolute',
      right: '8px',
      top: '50%',
      transform: 'translateY(-50%)',
      width: '14px',
      height: '14px',
      borderRadius: '4px',
      background: 'rgba(255,255,255,0.14)',
      border: '1px solid rgba(255,255,255,0.3)',
      cursor: 'ew-resize',
      pointerEvents: 'auto'
    });
    handle.title = 'Drag to resize';
    overlay.appendChild(handle);

    document.body.appendChild(overlay);

    // Restore persisted state
    const state = await loadOverlayState();
    applyOverlayState(overlay, state);

    // Keep a base (unscaled) width for scaling math
    const rect = overlay.getBoundingClientRect();
    const scale = state.scale || 1;
    overlay.dataset.baseW = String(rect.width / scale);
    overlay.dataset.baseH = String(rect.height / scale);

    // Ensure clamped
    clampOverlay(overlay);
  } catch (e) {
    console.warn('[SmartSkipper] Overlay injection failed:', e);
  }
}

function bindOverlayControls() {
  const overlay = document.getElementById('overlay');
  const timerDisplay = document.getElementById('timerDisplay');
  if (!overlay || !timerDisplay) return;

  // Click actions on overlay buttons
  overlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.add) {
      startOrExtendTimer(parseInt(t.dataset.add, 10) * 60);
    } else if (t.dataset.sub) {
      remainingSeconds = Math.max(0, remainingSeconds - 600);
      updateDisplay();
    } else if (t.id === 'cancelTimer') {
      stopTimer();
    }
  });

  // Opacity via Shift + wheel (persist)
  const saveOpacityDebounced = debounce(() => saveOverlayState(getOverlayStateSync()), 250);
  document.addEventListener('wheel', (e) => {
    const overlayNow = document.getElementById('overlay');
    if (!overlayNow) return;
    if (!e.shiftKey) return;
    e.preventDefault();
    const current = parseFloat(getComputedStyle(overlayNow).opacity) || 1;
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    overlayNow.style.opacity = String(Math.max(0.1, Math.min(1, current + delta)));
    saveOpacityDebounced();
  }, { passive: false });

  // Dragging (persist)
  let dragging = false, ox = 0, oy = 0;
  overlay.addEventListener('mousedown', (e) => {
    // ignore when starting on the resize handle
    if (e.target && e.target.id === 'overlayResizeHandle') return;
    dragging = true;
    const rect = overlay.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    overlay.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    overlay.style.cursor = 'move';
    saveOverlayState(getOverlayStateSync());
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = e.clientX - ox;
    const y = e.clientY - oy;
    setOverlayPositionClamped(overlay, x, y);
  });

  // Resizing with handle (persist)
  const handle = document.getElementById('overlayResizeHandle');
  let resizing = false;
  let startX = 0;
  handle.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    resizing = true;
    startX = e.clientX;
    overlay.style.cursor = 'ew-resize';
    e.preventDefault();
  });
  document.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    overlay.style.cursor = 'move';
    clampOverlay(overlay);
    saveOverlayState(getOverlayStateSync());
  });
  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const baseW = parseFloat(overlay.dataset.baseW || '340'); // fallback guess
    const currentRect = overlay.getBoundingClientRect();
    const desiredW = Math.max(220, currentRect.width + (e.clientX - startX));
    startX = e.clientX;
    let newScale = desiredW / baseW;
    newScale = Math.max(0.6, Math.min(2.2, newScale));
    overlay.style.transform = `scale(${newScale})`;
  });

  // Re-clamp on viewport resize
  window.addEventListener('resize', () => {
    clampOverlay(overlay);
    saveOverlayState(getOverlayStateSync());
  });

  // Initial timer text
  updateDisplay();
}

// ---- overlay state (persist) ----
function getOverlayStateSync() {
  const overlay = document.getElementById('overlay');
  if (!overlay) return { left: 20, top: 20, opacity: 1, scale: 1 };
  const rect = overlay.getBoundingClientRect();
  const opacity = parseFloat(getComputedStyle(overlay).opacity) || 1;
  const scale = (() => {
    const m = /scale\(([\d.]+)\)/.exec(overlay.style.transform || '');
    return m ? parseFloat(m[1]) : 1;
  })();
  return { left: Math.round(rect.left), top: Math.round(rect.top), opacity, scale };
}

function applyOverlayState(overlay, state) {
  const s = {
    left: Number.isFinite(state.left) ? state.left : 20,
    top: Number.isFinite(state.top) ? state.top : 20,
    opacity: Number.isFinite(state.opacity) ? state.opacity : 1,
    scale: Number.isFinite(state.scale) ? state.scale : 1
  };
  overlay.style.left = `${s.left}px`;
  overlay.style.top = `${s.top}px`;
  overlay.style.opacity = String(Math.max(0.1, Math.min(1, s.opacity)));
  overlay.style.transformOrigin = 'left top';
  overlay.style.transform = `scale(${Math.max(0.6, Math.min(2.2, s.scale))})`;
  clampOverlay(overlay);
}

function loadOverlayState() {
  return new Promise(resolve => {
    chrome.storage.local.get(['overlayState'], ({ overlayState }) => {
      resolve(overlayState || { left: 20, top: 20, opacity: 1, scale: 1 });
    });
  });
}
function saveOverlayState(state) {
  chrome.storage.local.set({ overlayState: state || getOverlayStateSync() });
}

function setOverlayPositionClamped(overlay, x, y) {
  // clamp within viewport (consider scaled size)
  const rect = overlay.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  const margin = 8;
  const maxLeft = (window.innerWidth  - w - margin);
  const maxTop  = (window.innerHeight - h - margin);
  const cl = Math.max(margin, Math.min(maxLeft, x));
  const ct = Math.max(margin, Math.min(maxTop, y));
  overlay.style.left = `${cl}px`;
  overlay.style.top  = `${ct}px`;
}

function clampOverlay(overlay) {
  const rect = overlay.getBoundingClientRect();
  setOverlayPositionClamped(overlay, rect.left, rect.top);
}

// ---- timer core (only tick while playing) ----
function startOrExtendTimer(deltaSeconds) {
  // Ensure video listeners are present
  bindVideoEventsOnce();

  remainingSeconds += deltaSeconds;
  if (remainingSeconds < 0) remainingSeconds = 0;
  updateDisplay();

  if (!timerInterval) {
    timerInterval = setInterval(() => {
      // Only tick while video is actually playing
      if (timerSuspended || !isVideoPlaying()) return;

      remainingSeconds--;
      updateDisplay();

      // Optional Fade-to-Sleep
      if (remainingSeconds <= 180 && !fadeInterval && settings?.sleepTimer?.fadeVolume) {
        startFadeVolume();
      }

      if (remainingSeconds <= 0) {
        handleTimerEnd();
        stopTimer();
      }
    }, 1000);
  }
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  clearInterval(fadeInterval);
  fadeInterval = null;
  remainingSeconds = 0;
  updateDisplay();
}

function updateDisplay() {
  const timerDisplay = document.getElementById('timerDisplay');
  if (!timerDisplay) return;
  const m = Math.floor(remainingSeconds / 60);
  const s = remainingSeconds % 60;
  timerDisplay.textContent = `⏳ ${m}:${String(s).padStart(2, '0')}`;
}

// ---- fade to sleep ----
function startFadeVolume() {
  const video = getVideo();
  if (!video) return;
  originalVolume = video.volume;

  fadeInterval = setInterval(() => {
    const v = getVideo();
    if (!v || remainingSeconds <= 0 || v.volume <= 0.05) {
      clearInterval(fadeInterval);
      fadeInterval = null;
      return;
    }
    v.volume = Math.max(0, v.volume - (fadeVolumeStep / 100));
  }, 30000);
}

// ---- timer end behavior ----
function handleTimerEnd() {
  const video = getVideo();
  if (video) {
    if (settings.muteInsteadOfPause) video.muted = true;
    else { try { video.pause(); } catch {} }
    try { video.volume = originalVolume; } catch {}
  }
  if (settings.dimScreen) {
    document.documentElement.classList.add('dimmed');
    document.body.classList.add('dimmed');
  }
}

// ---- episode guard ----
function handleEpisodeGuard() {
  if (!IS_TOP) return;
  const guard = settings.episodeGuard;
  if (!guard?.enabled) return;

  chrome.runtime.sendMessage({ type: 'incrementWatchedCount' }, (res) => {
    const updated = res?.updated;
    if (updated && updated.watchedCount >= guard.maxEpisodes) {
      const video = getVideo();
      if (video) try { video.pause(); } catch {}
      alert('🛑 Episode Guard limit reached.');
    }
  });

  setTimeout(() => chrome.runtime.sendMessage({ type: 'resetWatchedCount' }), 10 * 60 * 1000);
}

// ---------- utils ----------
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
