/* popup.js – full file
 * Handles: tab switching, sleep timer controls, skipper settings,
 * beta features (master toggle, episode guard, fade-to-sleep, per-show rules),
 * and local-only "binge suggestion" cards.
 */

// ---------- Small DOM helpers ----------
const $  = (id) => document.getElementById(id);
const q  = (sel, root=document) => root.querySelector(sel);
const qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
// Clamp helper
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

// ---------- Tabs ----------
qa(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    qa(".tab-button").forEach((b) => b.classList.remove("active"));
    qa(".tab-content").forEach((c) => (c.style.display = "none"));
    btn.classList.add("active");
    const tabId = btn.dataset.tab;
    $(tabId).style.display = "block";
  });
});

// ---------- Defaults ----------
const TIMER_DEFAULTS = {
  timerMinutes: 60,
  muteInsteadOfPause: false,
  dimScreen: false,
  countdownToggle: true,
  lowerVolumeCheckbox: false,
  volumeLevelInput: 10, // percent
};

const SKIPPER_DEFAULTS = {
  enableSkipper: false,
  skipperDelay: 1000,
};

const BETA_DEFAULTS = {
  betaMaster: false,
  episodeGuardEn: false,
  episodeGuardN: 3,
  fadeEn: false,
  fadeMinutes: 5,
  perShowEn: false,
};

// ---------- Initialization ----------
document.addEventListener("DOMContentLoaded", async () => {
  await hydrateTimerUI();
  await hydrateSkipperUI();
  await hydrateBetaUI();
  wireTimerUI();
  wireSkipperUI();
  wireBetaUI();
  renderBingeCards(); // may render "not enough history yet" if empty
});

// ---------- Storage helpers ----------
function getAll(keys, fallbacks) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve({ ...fallbacks, ...data }));
  });
}
function setAll(payload) {
  return new Promise((resolve) => chrome.storage.local.set(payload, resolve));
}

// ---------- Active tab helper ----------
async function getActiveTabId() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id);
    });
  });
}

// ============================================================================
// Sleep Timer UI
// ============================================================================
async function hydrateTimerUI() {
  const s = await getAll(Object.keys(TIMER_DEFAULTS), TIMER_DEFAULTS);

  if ($("timerInput")) $("timerInput").value = s.timerMinutes;
  if ($("muteInsteadOfPause")) $("muteInsteadOfPause").checked = s.muteInsteadOfPause;
  if ($("dimScreen")) $("dimScreen").checked = s.dimScreen;
  if ($("countdownToggle")) $("countdownToggle").checked = s.countdownToggle;
  if ($("lowerVolumeCheckbox")) $("lowerVolumeCheckbox").checked = s.lowerVolumeCheckbox;

  if ($("volumeLevelInput")) $("volumeLevelInput").value = s.volumeLevelInput;
  if ($("volumeLevelContainer")) {
    $("volumeLevelContainer").style.display = s.lowerVolumeCheckbox ? "block" : "none";
  }

  // wire preset buttons to increment input on each click
  qa(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inc = parseInt(btn.dataset.minutes, 10);        // 15 / 30 / 60
      const input = $("timerInput");
      const max = parseInt(input.max || "480", 10);
      const prev = Math.max(0, parseInt(input.value || "0", 10));
      const next = clamp(prev + inc, 1, max);
      input.value = next;
      $("statusMessage").textContent = `+${inc}m → ${next}m total`;
    });
  });
}

function wireTimerUI() {
  // Show/hide volume level when "lower volume" is toggled
  $("lowerVolumeCheckbox")?.addEventListener("change", (e) => {
    const show = !!e.target.checked;
    if ($("volumeLevelContainer")) $("volumeLevelContainer").style.display = show ? "block" : "none";
  });

  $("startBtn")?.addEventListener("click", async () => {
    const minutes = Math.max(1, parseInt($("timerInput").value || "60", 10));
    const endTime = Date.now() + minutes * 60 * 1000;

    const options = {
      mute: $("muteInsteadOfPause").checked,
      dim: $("dimScreen").checked,
      showCountdown: $("countdownToggle").checked,
      lowerVolume: $("lowerVolumeCheckbox").checked,
      volumeLevel: Math.min(100, Math.max(0, parseInt($("volumeLevelInput").value || "10", 10))) / 100, // 0..1
    };

    // Persist for future sessions / keyboard shortcuts
    await setAll({
      timerMinutes: minutes,
      muteInsteadOfPause: options.mute,
      dimScreen: options.dim,
      countdownToggle: options.showCountdown,
      lowerVolumeCheckbox: options.lowerVolume,
      volumeLevelInput: Math.round(options.volumeLevel * 100),
      plexSleepEndTime: endTime,
      plexSleepOptions: options,
    });

    const tabId = await getActiveTabId();
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "start_timer", endTime, options });
      $("statusMessage").textContent = `⏱️ Timer started for ${minutes} minutes`;
    } else {
      $("statusMessage").textContent = "No active tab found.";
    }
  });

  $("cancelBtn")?.addEventListener("click", async () => {
    const tabId = await getActiveTabId();
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { action: "cancel_timer" });
      $("statusMessage").textContent = "❌ Timer canceled";
    } else {
      $("statusMessage").textContent = "No active tab found.";
    }
    await setAll({ plexSleepEndTime: 0 });
  });
}

// ============================================================================
// Skipper UI
// ============================================================================
async function hydrateSkipperUI() {
  const s = await getAll(Object.keys(SKIPPER_DEFAULTS), SKIPPER_DEFAULTS);
  if ($("enableSkipper")) $("enableSkipper").checked = s.enableSkipper;
  if ($("skipperDelay")) $("skipperDelay").value = s.skipperDelay;
}

function wireSkipperUI() {
  $("saveSkipperSettings")?.addEventListener("click", async () => {
    const payload = {
      enableSkipper: $("enableSkipper").checked,
      skipperDelay: Math.max(100, parseInt($("skipperDelay").value || "1000", 10)),
    };
    await setAll(payload);

    // notify content to refresh skipper config
    const tabId = await getActiveTabId();
    if (tabId) chrome.tabs.sendMessage(tabId, { action: "skipper_settings_updated" });

    toast("✅ Skipper settings saved");
  });
}

// ============================================================================
// Beta UI (Master toggle, Episode Guard, Fade-to-Sleep, Per-Show Rules)
// ============================================================================
async function hydrateBetaUI() {
  const s = await getAll(Object.keys(BETA_DEFAULTS), BETA_DEFAULTS);

  if ($("betaMaster")) $("betaMaster").checked = s.betaMaster;

  if ($("episodeGuardEn")) $("episodeGuardEn").checked = s.episodeGuardEn;
  if ($("episodeGuardN")) $("episodeGuardN").value = s.episodeGuardN;

  if ($("fadeEn")) $("fadeEn").checked = s.fadeEn;
  if ($("fadeMinutes")) $("fadeMinutes").value = s.fadeMinutes;

  if ($("perShowEn")) $("perShowEn").checked = s.perShowEn;
}

function wireBetaUI() {
  $("saveBeta")?.addEventListener("click", async () => {
    const payload = {
      betaMaster: $("betaMaster").checked,
      episodeGuardEn: $("episodeGuardEn").checked,
      episodeGuardN: Math.max(1, parseInt($("episodeGuardN").value || "3", 10)),
      fadeEn: $("fadeEn").checked,
      fadeMinutes: Math.max(1, parseInt($("fadeMinutes").value || "5", 10)),
      perShowEn: $("perShowEn").checked,
    };
    await setAll(payload);

    // tell content scripts to refresh their cached beta settings
    const tabId = await getActiveTabId();
    if (tabId) chrome.tabs.sendMessage(tabId, { action: "beta_settings_updated" });

    toast("✅ Beta settings saved");
  });
}
// Donate button
$("donateBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://square.link/u/JZUUls2L" });
});


// ============================================================================
// Binge Suggestion Cards (local-only, privacy friendly)
// - Reads chrome.storage.local.watchHistory: [{ ts, title }]
// - Suggest typical stop length (avg per day)
// - Suggest recent titles to "keep watching"
// ============================================================================
async function renderBingeCards() {
  const root = $("bingeCards");
  if (!root) return;
  root.innerHTML = "";

  const { watchHistory = [] } = await getAll(["watchHistory"], { watchHistory: [] });
  if (!watchHistory.length) {
    root.innerHTML = `<div class="hint">Not enough history yet. Watch a few episodes and check back!</div>`;
    return;
  }

  // Group by calendar day
  const byDay = new Map();
  for (const entry of watchHistory) {
    const day = new Date(entry.ts).toDateString();
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }
  const sessionLengths = Array.from(byDay.values())
    .map((arr) => arr.length)
    .filter((n) => n > 0);

  const typical =
    sessionLengths.length > 0
      ? Math.round(sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length)
      : 3;

  // Top titles by recent frequency (last 100)
  const byTitle = new Map();
  for (const e of watchHistory.slice(-100)) {
    byTitle.set(e.title, (byTitle.get(e.title) || 0) + 1);
  }
  const top = Array.from(byTitle.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Card 1: suggest Episode Guard = typical
  const guard = document.createElement("div");
  guard.className = "card";
  guard.innerHTML = `
    <div class="card-title">You usually stop after ~${typical} eps</div>
    <div class="card-sub">Want to set Episode Guard to ${typical}?</div>
    <div class="card-actions">
      <button id="applyGuard">Set to ${typical}</button>
    </div>`;
  root.appendChild(guard);

  $("applyGuard")?.addEventListener("click", () => {
    if ($("betaTabBtn")) $("betaTabBtn").click();
    if ($("episodeGuardEn")) $("episodeGuardEn").checked = true;
    if ($("episodeGuardN")) $("episodeGuardN").value = typical;
    toast("🛡️ Episode Guard updated (not saved yet)");
  });

  // Card 2: keep watching – recent favorites
  if (top.length) {
    const titles = top.map(([t]) => t);
    const rec = document.createElement("div");
    rec.className = "card";
    rec.innerHTML = `
      <div class="card-title">Keep watching</div>
      <div class="card-list">${titles.map((t) => `<div class="pill">${escapeHtml(t)}</div>`).join("")}</div>`;
    root.appendChild(rec);
  }
}

// ---------- Utils ----------
function toast(msg) {
  // Simple inline status message; could be enhanced later
  const el = $("statusMessage") || $("suggestion");
  if (el) el.textContent = msg;
}

// Basic escape for titles
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
