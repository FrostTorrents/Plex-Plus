/* content.js — full file (rules popover, reliable series resolution)
 * - Minimal transparent timer overlay (+/-10m, resizable, opacity via Shift+Wheel)
 * - Auto-pause/resume timer with playback; fade-to-sleep (beta); episode guard (beta)
 * - Top-left rules icon opens a small POPOVER with 3 checkboxes:
 *     [ ] Skip intro   [ ] Skip credits   [ ] Lower volume
 *   Applies to the entire SERIES. Works on preplay and in-player views.
 * - Caches last seen series title so rules can be edited from the player even
 *   when the DOM doesn’t expose titles.
 */

/* -------------------------- Small DOM / Utils -------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const pad2  = (n) => n.toString().padStart(2, "0");
const fmt   = (ms) => (ms<=0? "00:00" : `${pad2(Math.floor(ms/60000))}:${pad2(Math.floor(ms/1000)%60)}`);

function waitForVideoElement(cb, timeoutMs=30000){
  const start=performance.now();
  (function loop(){
    const v=$("video"); if(v){ cb(v); return; }
    if(performance.now()-start>timeoutMs) return;
    requestAnimationFrame(loop);
  })();
}

/* ------------------------------- State -------------------------------- */
let sleepEndTime = 0;
let pausedRemainingMs = 0;
let timerPaused = false;
let sleepOptions = { mute:false, dim:false, showCountdown:true, lowerVolume:false, volumeLevel:0.1 };
let countdownInterval = null;
let fadeInterval = null;

let overlayEl = null;
let countdownEl = null;
let dimEl = null;
let toastEl = null;

/* Rules UI (icon + popover, top-left) */
let chipEl = null;
let popoverEl = null;

/* Overlay prefs (user-resizable & transparent) */
const OVERLAY_DEFAULTS = { w:200, h:33, opacity:0.45 };
let overlayPrefs = { ...OVERLAY_DEFAULTS };

/* Beta settings (cached) */
let beta = {
  betaMaster:false,
  episodeGuardEn:false,
  episodeGuardN:3,
  fadeEn:false,
  fadeMinutes:5,
  perShowEn:false,
};

/* Episode guard counters */
let episodeCount = 0;
let lastStopTs = 0;

/* Storage keys */
const WATCH_HISTORY_KEY   = "watchHistory";
const LAST_SERIES_TITLE   = "plexPlus:lastSeriesTitle";

/* ------------------------- Series / Titles ------------------------- */
function readSeriesTitleFromDom(){
  const gp = document.querySelector('[data-qa-id="metadata-grandparent-title"]')
        || document.querySelector('[data-testid="metadataGrandparentTitle"]')
        || document.querySelector('.PrePlayTitle .grandparent-title');
  if (gp?.textContent?.trim()) return gp.textContent.trim();

  const t = document.querySelector('[data-qa-id="metadata-title"]')
        || document.querySelector('[data-testid="metadataTitle"]')
        || document.querySelector('.PrePlayTitle .title');
  if (t?.textContent?.trim()) return t.textContent.trim();

  const dt = document.title.replace(/\s+-\s*Plex.*/i, "").trim();
  return dt || "";
}

function readEpisodeTitleFromDom(){
  const el = document.querySelector('[data-qa-id="metadata-title"]')
        || document.querySelector('.PrePlayTitle .title')
        || document.querySelector('[data-testid="metadataTitle"]');
  const t = el?.textContent?.trim();
  if (t) return t;
  const dt = document.title.replace(/\s+-\s*Plex.*/i, "").trim();
  return dt || "Unknown";
}

/** Resolve series title robustly, using cache when DOM is missing (player view). */
async function resolveSeriesTitle(){
  const dom = readSeriesTitleFromDom();
  if (dom && dom.toLowerCase() !== "plex" && dom.toLowerCase() !== "unknown") return dom;

  const s = await new Promise((r)=>chrome.storage.local.get([LAST_SERIES_TITLE], r));
  return s[LAST_SERIES_TITLE] || "Unknown Series";
}

/** Update cache when we’re clearly on a preplay/show page. */
function maybeCacheSeriesTitle(){
  const series = readSeriesTitleFromDom();
  const onShowPage = !!(document.querySelector('[data-qa-id="metadata-title"]') ||
                        document.querySelector('.PrePlayTitle .title') ||
                        document.querySelector('[data-testid="metadataTitle"]'));
  if (onShowPage && series) {
    chrome.storage.local.set({ [LAST_SERIES_TITLE]: series });
  }
}

/* Series-scoped rules key */
const rulesKeyForSeries = (series) => `rules:SERIES:${series}`;

/* --------------------------- Load persisted --------------------------- */
chrome.storage.local.get(
  ["plexSleepEndTime","plexSleepOptions","overlayW","overlayH","overlayOpacity"].concat(Object.keys(beta)),
  (s)=>{
    Object.assign(beta, { ...beta, ...s });

    overlayPrefs.w = clamp(parseInt(s.overlayW ?? OVERLAY_DEFAULTS.w,10) || OVERLAY_DEFAULTS.w, 160, 480);
    overlayPrefs.h = clamp(parseInt(s.overlayH ?? OVERLAY_DEFAULTS.h,10) || OVERLAY_DEFAULTS.h, 28, 80);
    overlayPrefs.opacity = clamp(Number(s.overlayOpacity ?? OVERLAY_DEFAULTS.opacity), 0.2, 0.9);

    // Restore in-flight timer
    const inFlight = s.plexSleepEndTime && s.plexSleepEndTime > Date.now();
    if (inFlight) {
      if (s.plexSleepOptions) sleepOptions = { ...sleepOptions, ...s.plexSleepOptions };
      waitForVideoElement((v)=>{
        if (!v.paused && !v.ended) {
          sleepEndTime = s.plexSleepEndTime;
          injectOverlay();
          startCountdownUI();
          attachFadeIfEnabled();
        } else {
          pausedRemainingMs = Math.max(0, s.plexSleepEndTime - Date.now());
          timerPaused = true; sleepEndTime = 0;
          chrome.storage.local.set({ plexSleepEndTime: 0 });
          injectOverlay(); updateCountdown();
          showToast("⏸️ Timer paused (waiting for playback)");
        }
      });
    }

    // Initial rules UI + cache attempt
    setTimeout(()=>{ injectRulesChip(); maybeCacheSeriesTitle(); }, 300);
  }
);

/* Watch for SPA changes to keep cache fresh */
const spaMo = new MutationObserver(()=> maybeCacheSeriesTitle());
spaMo.observe(document.documentElement, { childList:true, subtree:true });

/* --------------------------- Messaging API ---------------------------- */
chrome.runtime.onMessage.addListener((message)=>{
  if (!message || !message.action) return;

  if (message.action === "start_timer") {
    const durationMs = Math.max(0, (message.endTime || 0) - Date.now());
    if (message.options) sleepOptions = { ...sleepOptions, ...message.options };

    waitForVideoElement((v)=>{
      if (v.paused || v.ended) {
        pausedRemainingMs = durationMs;
        timerPaused = true;
        sleepEndTime = 0;
        chrome.storage.local.set({ plexSleepEndTime: 0, plexSleepOptions: sleepOptions });
        injectOverlay(); updateCountdown();
        showToast("⏸️ Timer paused (start playback to begin)");
        const onFirstPlay = ()=>{ v.removeEventListener("play", onFirstPlay); if (pausedRemainingMs > 0) startTimerWithDuration(pausedRemainingMs); };
        v.addEventListener("play", onFirstPlay, { once: true });
      } else {
        startTimerWithDuration(durationMs);
      }
    });
  }
  else if (message.action === "cancel_timer") {
    cancelTimer(true);
    showToast("❌ Sleep timer canceled");
  }
  else if (message.action === "add_10") {
    adjustTimer(10);
  }
  else if (message.action === "sub_10") {
    adjustTimer(-10);
  }
  else if (message.action === "beta_settings_updated") {
    chrome.storage.local.get(Object.keys(beta), (s)=>Object.assign(beta, beta, s));
    updateRulesChipVisibility();
  }
});

/* -------------------------- Timer & Countdown ------------------------- */
function startTimerWithDuration(durationMs){
  timerPaused = false; pausedRemainingMs = 0;
  sleepEndTime = Date.now() + durationMs;
  chrome.storage.local.set({ plexSleepEndTime: sleepEndTime, plexSleepOptions: sleepOptions });
  injectOverlay(); startCountdownUI(); attachFadeIfEnabled();
  showToast("⏱️ Sleep timer started");
}

function startCountdownUI(){
  injectOverlay(); updateCountdown();
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(()=>{
    if (timerPaused) { updateCountdown(); return; }
    if (!sleepEndTime) { clearInterval(countdownInterval); return; }
    const remaining = sleepEndTime - Date.now();
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      executeSleepAction();
      return;
    }
    updateCountdown();
  }, 500);
}

function cancelTimer(removeUi=false){
  if (countdownInterval){ clearInterval(countdownInterval); countdownInterval=null; }
  if (fadeInterval){ clearInterval(fadeInterval); fadeInterval=null; }
  sleepEndTime = 0; pausedRemainingMs = 0; timerPaused = false;
  chrome.storage.local.set({ plexSleepEndTime: 0 });
  if (removeUi) removeOverlay();
}

function executeSleepAction(){
  waitForVideoElement((v)=>{
    try{
      if (sleepOptions.lowerVolume) v.volume = clamp(sleepOptions.volumeLevel ?? 0.1, 0, 1);
      else if (sleepOptions.mute) v.muted = true;
      else v.pause();
    }catch{}
  });
  if (sleepOptions.dim) applyDim(true);
  showToast("😴 Sleep time reached");
  if (fadeInterval){ clearInterval(fadeInterval); fadeInterval=null; }
  sleepEndTime = 0;
  chrome.storage.local.set({ plexSleepEndTime: 0 });
}

/* ----------------------------- Fade Logic ----------------------------- */
function attachFadeIfEnabled(){
  if (!(beta.betaMaster && beta.fadeEn)) return;
  if (!sleepEndTime) return;

  if (fadeInterval) clearInterval(fadeInterval);
  const fadeEveryMs = 30*1000;
  const windowMs = Math.max(1, beta.fadeMinutes)*60*1000;

  fadeInterval = setInterval(()=>{
    if (timerPaused) return;
    if (!sleepEndTime){ clearInterval(fadeInterval); fadeInterval=null; return; }
    const remaining = sleepEndTime - Date.now();
    if (remaining <= 0){ clearInterval(fadeInterval); fadeInterval=null; return; }
    if (remaining <= windowMs){
      waitForVideoElement((v)=>{ v.volume = clamp(+((v.volume - 0.05).toFixed(2)), 0, 1); });
    }
  }, fadeEveryMs);
}

/* --------------------------- Overlay / UI ----------------------------- */
function adjustTimer(deltaMinutes){
  const deltaMs = deltaMinutes * 60 * 1000;
  if (timerPaused){
    pausedRemainingMs = Math.max(1000, (pausedRemainingMs || 0) + deltaMs);
    updateCountdown();
    showToast(`${deltaMinutes>0?"➕":"➖"} ${Math.abs(deltaMinutes)} minutes (paused)`);
    return;
  }
  if (sleepEndTime > 0){
    sleepEndTime = Math.max(Date.now()+1000, sleepEndTime + deltaMs);
    chrome.storage.local.set({ plexSleepEndTime: sleepEndTime });
    updateCountdown();
    showToast(`${deltaMinutes>0?"➕":"➖"} ${Math.abs(deltaMinutes)} minutes`);
  }
}

function applyOverlaySizeAndStyle(){
  if (!overlayEl) return;
  overlayEl.style.width  = `${overlayPrefs.w}px`;
  overlayEl.style.height = `${overlayPrefs.h}px`;
  overlayEl.style.background = `rgba(18,18,22, ${overlayPrefs.opacity})`;
}

function saveOverlayPrefs(){
  chrome.storage.local.set({ overlayW: overlayPrefs.w, overlayH: overlayPrefs.h, overlayOpacity: overlayPrefs.opacity });
}

function injectOverlay(){
  if (!overlayEl){
    overlayEl = document.createElement("div");
    overlayEl.id = "plex-sleeper-overlay";
    overlayEl.style.cssText = `
      position: fixed; bottom: 14px; right: 14px; z-index: 2147483647;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 4px 6px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12);
      backdrop-filter: blur(6px); color:#fff; font: 11px/1.1 system-ui,-apple-system,Segoe UI,Roboto,Arial;
      box-shadow: 0 4px 12px rgba(0,0,0,.25); overflow: hidden;
    `;

    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:6px;";

    const btnMinus = document.createElement("button");
    btnMinus.textContent = "−10m";
    btnMinus.style.cssText = tinyBtn();
    btnMinus.title = "Subtract 10 minutes";
    btnMinus.addEventListener("click", ()=>adjustTimer(-10));

    countdownEl = document.createElement("div");
    countdownEl.id = "plex-sleeper-countdown";
    countdownEl.style.cssText = `
      min-width:50px; text-align:center; font-weight:700; letter-spacing:.2px;
      padding:2px 8px; border-radius:8px; background:rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.10);
    `;
    countdownEl.title = "Sleep timer remaining";

    const btnPlus = document.createElement("button");
    btnPlus.textContent = "+10m";
    btnPlus.style.cssText = tinyBtn();
    btnPlus.title = "Add 10 minutes";
    btnPlus.addEventListener("click", ()=>adjustTimer(10));

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "×";
    btnCancel.style.cssText = tinyBtn(true);
    btnCancel.title = "Cancel timer";
    btnCancel.addEventListener("click", ()=>cancelTimer(true));

    row.appendChild(btnMinus);
    row.appendChild(countdownEl);
    row.appendChild(btnPlus);
    row.appendChild(btnCancel);
    overlayEl.appendChild(row);

    // Resize handle
    const handle = document.createElement("div");
    handle.title = "Drag to resize";
    handle.style.cssText = `
      position:absolute; right:4px; bottom:4px; width:10px; height:10px;
      border-right:2px solid rgba(255,255,255,.35); border-bottom:2px solid rgba(255,255,255,.35);
      opacity:.7; cursor:nwse-resize; pointer-events:auto;
    `;
    overlayEl.appendChild(handle);

    // Drag-to-resize
    let drag=null;
    handle.addEventListener("mousedown",(e)=>{
      e.preventDefault();
      drag = { startX:e.clientX, startY:e.clientY, startW:overlayPrefs.w, startH:overlayPrefs.h };
      document.addEventListener("mousemove", onDrag);
      document.addEventListener("mouseup", onStop);
    });
    function onDrag(e){
      if(!drag) return;
      const dx=e.clientX - drag.startX, dy=e.clientY - drag.startY;
      overlayPrefs.w = clamp(drag.startW + dx, 160, 480);
      overlayPrefs.h = clamp(drag.startH + dy, 28, 80);
      applyOverlaySizeAndStyle();
    }
    function onStop(){
      if(!drag) return;
      saveOverlayPrefs();
      document.removeEventListener("mousemove", onDrag);
      document.removeEventListener("mouseup", onStop);
      drag=null;
    }

    // Shift+wheel to adjust transparency
    overlayEl.addEventListener("wheel",(e)=>{
      if(!e.shiftKey) return;
      e.preventDefault();
      overlayPrefs.opacity = clamp(overlayPrefs.opacity + (e.deltaY < 0 ? 0.05 : -0.05), 0.2, 0.9);
      applyOverlaySizeAndStyle(); saveOverlayPrefs();
    }, { passive:false });

    document.documentElement.appendChild(overlayEl);
  }

  applyOverlaySizeAndStyle();
  overlayEl.style.display = sleepOptions.showCountdown ? "flex" : "none";
  updateCountdown();

  // Ensure the top-left rules chip exists as well
  injectRulesChip();
}

function removeOverlay(){
  if (overlayEl?.parentNode) overlayEl.parentNode.removeChild(overlayEl);
  overlayEl = null; countdownEl = null;
  if (dimEl?.parentNode) dimEl.parentNode.removeChild(dimEl);
  dimEl = null;
}

/* -------------------- Rules Icon + Popover (top-left) ------------------ */
function injectRulesChip(){
  if (!(beta.betaMaster && beta.perShowEn)) { removeRulesChip(); return; }
  if (chipEl) { updateRulesChipVisibility(); return; }

  chipEl = document.createElement("button");
  chipEl.id = "plex-plus-rules-chip";
  chipEl.setAttribute("aria-label","Per-show options");
  chipEl.title = "Per-show rules";
  chipEl.style.cssText = `
    position: fixed; top: 12px; left: 46px; z-index: 2147483646;
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.25);
    background: rgba(25,25,28,.55); color: #fff; cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,.25); backdrop-filter: blur(4px);
  `;
  chipEl.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h8M20 7h-4M4 17h4M20 17h-8M12 5v4M8 15v4"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;

  chipEl.addEventListener("click", (e)=>{ e.preventDefault(); e.stopPropagation(); toggleRulesPopover(); });
  document.addEventListener("click", (e)=>{
    // click-outside to close
    if (popoverEl && !popoverEl.contains(e.target) && e.target !== chipEl) closeRulesPopover();
  }, true);

  document.documentElement.appendChild(chipEl);
  updateRulesChipVisibility();
}

function removeRulesChip(){
  closeRulesPopover();
  chipEl?.remove();
  chipEl = null;
}

function updateRulesChipVisibility(){
  if (!chipEl) return;
  if (!(beta.betaMaster && beta.perShowEn)) { chipEl.style.display = "none"; return; }
  const v = $("video");
  const playing = !!(v && !v.paused && !v.ended);
  chipEl.style.display = playing ? "none" : "inline-flex";
}

/* ---- Popover ---- */
async function toggleRulesPopover(){
  if (popoverEl) { closeRulesPopover(); return; }
  const series = await resolveSeriesTitle();
  if (!series || series === "Unknown Series") { showToast("⚠️ No series detected here"); return; }

  const key = rulesKeyForSeries(series);
  const data = await new Promise((r)=>chrome.storage.local.get([key], r));
  const rules = data[key] || { skipIntro:true, skipCredits:true, lowerVolume:false };

  popoverEl = document.createElement("div");
  popoverEl.style.cssText = `
    position: fixed; top: 46px; left: 12px; z-index: 2147483647;
    background: rgba(20,20,24,.92); color:#fff; border:1px solid rgba(255,255,255,.18);
    border-radius: 10px; padding: 8px 10px; width: 220px;
    box-shadow: 0 10px 24px rgba(0,0,0,.35); backdrop-filter: blur(6px);
    font: 12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial;
  `;
  popoverEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div style="opacity:.85;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px;">${series}</div>
      <button id="pp-close" style="all:unset;cursor:pointer;opacity:.8;">✕</button>
    </div>
    <label style="display:flex;gap:8px;align-items:center;margin:6px 0;"><input id="pp-skip-intro" type="checkbox"> Skip intro</label>
    <label style="display:flex;gap:8px;align-items:center;margin:6px 0;"><input id="pp-skip-credits" type="checkbox"> Skip credits</label>
    <label style="display:flex;gap:8px;align-items:center;margin:6px 0;"><input id="pp-lower-vol" type="checkbox"> Lower volume (cap 60%)</label>
  `;
  document.documentElement.appendChild(popoverEl);

  $("#pp-close", popoverEl).addEventListener("click", (e)=>{ e.stopPropagation(); closeRulesPopover(); });

  const apply = async ()=>{
    const next = {
      skipIntro:   $("#pp-skip-intro", popoverEl).checked,
      skipCredits: $("#pp-skip-credits", popoverEl).checked,
      lowerVolume: $("#pp-lower-vol", popoverEl).checked,
    };
    await chrome.storage.local.set({ [key]: next });
    showToast("✅ Rules updated");
    // Apply lower-volume immediately if enabled
    if (next.lowerVolume) waitForVideoElement((v)=>{ if (v.volume > 0.6) v.volume = 0.6; });
  };

  // seed values
  $("#pp-skip-intro", popoverEl).checked   = rules.skipIntro   !== false;
  $("#pp-skip-credits", popoverEl).checked = rules.skipCredits !== false;
  $("#pp-lower-vol", popoverEl).checked    = !!rules.lowerVolume;

  // attach listeners
  $("#pp-skip-intro", popoverEl).addEventListener("change", apply);
  $("#pp-skip-credits", popoverEl).addEventListener("change", apply);
  $("#pp-lower-vol", popoverEl).addEventListener("change", apply);
}

function closeRulesPopover(){
  popoverEl?.remove();
  popoverEl = null;
}

/* Keep rules UI around across SPA updates */
setInterval(()=>{ if (!chipEl) injectRulesChip(); else updateRulesChipVisibility(); }, 1500);

/* ------------------------------ Countdown ----------------------------- */
function updateCountdown(){
  if (!overlayEl || !countdownEl) return;
  if (!sleepOptions.showCountdown){ overlayEl.style.display="none"; return; }
  if (timerPaused){ countdownEl.textContent = `⏸ ${fmt(pausedRemainingMs)}`; return; }
  const remaining = Math.max(0, sleepEndTime - Date.now());
  countdownEl.textContent = `⏱ ${fmt(remaining)}`;
}

function applyDim(on){
  if (on){
    if (!dimEl){
      dimEl = document.createElement("div");
      dimEl.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,.55);
        z-index:2147483646; pointer-events:none; transition:opacity .25s ease; opacity:0;
      `;
      document.documentElement.appendChild(dimEl);
      requestAnimationFrame(()=>dimEl.style.opacity="1");
    }
  } else if (dimEl){
    dimEl.style.opacity="0";
    setTimeout(()=>dimEl?.parentNode?.removeChild(dimEl),250);
    dimEl=null;
  }
}

/* pill buttons */
function tinyBtn(isIcon=false){
  return `
    appearance:none; cursor:pointer; font-weight:600; color:#fff;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 999px;
    padding: ${isIcon ? "4px 8px" : "4px 10px"};
    min-width: ${isIcon ? "28px" : "auto"};
    line-height: 1.1;
    transition: background .15s ease, border-color .15s ease, transform .06s ease;
  `;
}

function showToast(text){
  if (!toastEl){
    toastEl = document.createElement("div");
    toastEl.style.cssText = `
      position:fixed; bottom:16px; left:16px; z-index:2147483647;
      background:rgba(25,25,28,.94); color:#fff; border:1px solid rgba(255,255,255,.15);
      border-radius:10px; padding:8px 12px; box-shadow:0 6px 18px rgba(0,0,0,.35);
      font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; opacity:0; transform:translateY(6px);
      transition: opacity .2s ease, transform .2s ease;
    `;
    document.documentElement.appendChild(toastEl);
  }
  toastEl.textContent = text;
  requestAnimationFrame(()=>{ toastEl.style.opacity="1"; toastEl.style.transform="translateY(0)"; });
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>{ toastEl.style.opacity="0"; toastEl.style.transform="translateY(6px)"; }, 1600);
}

/* --------------------------- Episode Guard ---------------------------- */
function onPlaybackStart(){
  if (Date.now() - lastStopTs > 10*60*1000) episodeCount = 0;
  updateRulesChipVisibility(); // hide while playing
  if (timerPaused && pausedRemainingMs > 0) startTimerWithDuration(pausedRemainingMs);
  applyPerShowVolumeRule();
}

function onPlaybackPause(){
  updateRulesChipVisibility(); // show when paused
  if (sleepEndTime > 0){
    pausedRemainingMs = Math.max(0, sleepEndTime - Date.now());
    timerPaused = true; sleepEndTime = 0;
    chrome.storage.local.set({ plexSleepEndTime: 0 });
    injectOverlay(); updateCountdown();
    showToast("⏸️ Timer paused");
  }
}

function onPlaybackEnded(){
  recordEpisodeEnd();
  lastStopTs = Date.now();
  updateRulesChipVisibility(); // show on end

  if (!(beta.betaMaster && beta.episodeGuardEn)) return;
  episodeCount++;
  const limit = beta.episodeGuardN || 3;
  if (episodeCount >= limit){
    waitForVideoElement((v)=>{ try{ v.pause(); }catch{} });
    injectOverlay(); applyDim(true);
    showToast("🛑 Episode guard triggered");
    episodeCount = 0;
  }
}

/* Attach playback hooks */
function attachPlaybackHooks(video){
  if (video.__plexPlusHooked) return;
  video.__plexPlusHooked = true;
  video.addEventListener("play",  onPlaybackStart, { passive:true });
  video.addEventListener("pause", onPlaybackPause, { passive:true });
  video.addEventListener("ended", onPlaybackEnded,   { passive:true });
}
waitForVideoElement(attachPlaybackHooks);

/* --------------------------- Watch History ---------------------------- */
async function recordEpisodeEnd(){
  try{
    const title = readEpisodeTitleFromDom();
    const data = await new Promise((resolve)=>chrome.storage.local.get([WATCH_HISTORY_KEY], resolve));
    const hist = Array.isArray(data[WATCH_HISTORY_KEY]) ? data[WATCH_HISTORY_KEY] : [];
    hist.push({ ts: Date.now(), title });
    while (hist.length > 500) hist.shift();
    chrome.storage.local.set({ [WATCH_HISTORY_KEY]: hist });
  }catch{}
}

/* ---------------------------- Per-Show Rules -------------------------- */
async function getPerShowRules(){
  const series = await resolveSeriesTitle(); if (!series) return {};
  const key = rulesKeyForSeries(series);
  const data = await new Promise((resolve)=>chrome.storage.local.get([key], resolve));
  return data[key] || {};
}

/* Apply lower-volume rule immediately at (re)start */
async function applyPerShowVolumeRule(){
  if (!beta.betaMaster) return;
  const rules = await getPerShowRules();
  if (!rules.lowerVolume) return;
  waitForVideoElement((v)=>{ if (v.volume > 0.6) v.volume = 0.6; });
}

/* ------------------------------ Bootstrap ----------------------------- */
// (Everything else is event-driven)
