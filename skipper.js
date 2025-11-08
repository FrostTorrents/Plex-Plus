/* skipper.js — full file (series-level rules, safe targets)
 * Purpose: Auto-click Plex "Skip Intro/Credits/Recap" only.
 * Fixes:
 *  - Uses SERIES-wide rules (rules:SERIES:<seriesTitle>) so choices apply to the whole show.
 *  - Hard-excludes seek/replay/skip-back/forward/next controls to prevent 10s jumps.
 *  - Keeps existing delay/polling behavior and light DOM re-checks.
 */

/* ------------------------------ Config ------------------------------- */
const CFG_DEFAULTS = {
  enableSkipper: false,
  skipperDelay: 1000, // ms
};

let cfg = { ...CFG_DEFAULTS };

/* Load config */
chrome.storage.local.get(Object.keys(CFG_DEFAULTS), (s) => {
  cfg = { ...CFG_DEFAULTS, ...s };
});

/* Listen for popup updates */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "skipper_settings_updated") {
    chrome.storage.local.get(Object.keys(CFG_DEFAULTS), (s) => {
      cfg = { ...CFG_DEFAULTS, ...s };
      log(`Skipper settings updated: enable=${cfg.enableSkipper} delay=${cfg.skipperDelay}ms`);
    });
  }
});

/* React to direct storage changes (optional) */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let touched = false;
  for (const k of Object.keys(CFG_DEFAULTS)) {
    if (k in changes) {
      cfg[k] = changes[k].newValue ?? CFG_DEFAULTS[k];
      touched = true;
    }
  }
  if (touched) log(`Skipper storage changed: enable=${cfg.enableSkipper} delay=${cfg.skipperDelay}ms`);
});

/* ------------------------ Series-level Rules ------------------------- */
/* Prefer grandparent (series) title when available */
function getSeriesTitle() {
  const gp =
    document.querySelector('[data-qa-id="metadata-grandparent-title"]') ||
    document.querySelector('[data-testid="metadataGrandparentTitle"]') ||
    document.querySelector('.PrePlayTitle .grandparent-title');
  if (gp?.textContent?.trim()) return gp.textContent.trim();

  const t =
    document.querySelector('[data-qa-id="metadata-title"]') ||
    document.querySelector('[data-testid="metadataTitle"]') ||
    document.querySelector('.PrePlayTitle .title');
  if (t?.textContent?.trim()) return t.textContent.trim();

  const dt = document.title.replace(/\s+-\s+Plex.*/i, "").trim();
  return dt || "Unknown Series";
}

function rulesKeyForSeries(series) {
  return `rules:SERIES:${series}`;
}

async function getSeriesRules() {
  const series = getSeriesTitle();
  if (!series) return {};
  const key = rulesKeyForSeries(series);
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (data) => resolve(data[key] || {}));
  });
}

/* ----------------------------- Finders ------------------------------- */
/** Decide if an element is a valid "Skip Intro/Credits/Recap" control */
function isSkipEl(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;

  const text = (el.textContent || "").trim().toLowerCase();
  const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().toLowerCase();
  const ids  = (el.getAttribute("data-testid") || el.getAttribute("data-qa-id") || "").toLowerCase();
  const blob = `${text} ${aria} ${ids}`.replace(/\s+/g, " ");

  // --- HARD EXCLUDES: seek/back/forward/next/replay etc. ---
  if (/\b(10s|10 s|10 seconds|replay|seek|back|forward|rewind|previous|next episode|skip-back|skipback|skip forward|skip-forward|seekback|seek-back|seekforward|seek-forward)\b/.test(blob)) {
    return false;
  }

  // --- STRICT INCLUDES: must clearly reference skip + (intro|credits|recap) ---
  const mentionsSkip   = /\b(skip)\b/.test(blob);
  const mentionsIntro  = /\bintro\b/.test(blob);
  const mentionsCredit = /\bcredit|credits\b/.test(blob);
  const mentionsRecap  = /\brecap\b/.test(blob);

  if (!mentionsSkip) return false;
  if (!(mentionsIntro || mentionsCredit || mentionsRecap)) return false;

  // Visibility & clickability
  const rect = el.getBoundingClientRect?.();
  if (!rect || rect.width < 20 || rect.height < 16) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none" || parseFloat(style.opacity) < 0.1) return false;

  return true;
}

/** Determine what section is being skipped (intro/credits/recap/unknown) */
function getSectionForButton(btn) {
  const txt = (
    (btn.textContent || "") + " " +
    (btn.getAttribute("aria-label") || "") + " " +
    (btn.getAttribute("data-testid") || "") + " " +
    (btn.getAttribute("data-qa-id") || "")
  ).toLowerCase();

  if (txt.includes("intro"))   return "intro";
  if (txt.includes("credit"))  return "credits";
  if (txt.includes("recap"))   return "recap";
  return "unknown";
}

/** Attempt to find a skip button in Plex DOM */
function findSkipButton() {
  // Scan broadly but rely on strict classifier above
  const candidates = [
    '[data-testid*="skip"]',
    '[data-qa-id*="skip"]',
    'button',
    'div[role="button"]',
  ];

  for (const sel of candidates) {
    const nodes = Array.from(document.querySelectorAll(sel));
    const btn = nodes.find((el) => isSkipEl(el));
    if (btn) return btn;
  }

  // Shadow DOM fallback: scan shallow shadow roots
  const shadowHosts = document.querySelectorAll("*");
  for (const host of shadowHosts) {
    const root = host.shadowRoot;
    if (!root) continue;
    const nodes = Array.from(root.querySelectorAll('button, [role="button"], [data-testid], [data-qa-id]'));
    const btn = nodes.find((el) => isSkipEl(el));
    if (btn) return btn;
  }

  return null;
}

/* -------------------------- Click simulation ------------------------- */
function simulateClick(el) {
  try {
    // Avoid double-clicking the same element in quick succession
    const now = Date.now();
    if (el.__lastSimClick && now - el.__lastSimClick < 1000) return;
    el.__lastSimClick = now;

    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click?.();
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
  } catch (e) {
    try { el.click?.(); } catch {}
  }
}

/* -------------------------- Main skipper loop ------------------------ */
let pollTimer = null;

async function tryClickSkip() {
  if (!cfg.enableSkipper) return;

  const btn = findSkipButton();
  if (!btn) return;

  const section = getSectionForButton(btn);
  if (section === "unknown") return; // extra safety

  const rules = await getSeriesRules();

  // Respect SERIES-level rules
  if (section === "intro"   && rules.skipIntro   === false) { log("Rule: do NOT skip intro for this series"); return; }
  if (section === "credits" && rules.skipCredits === false) { log("Rule: do NOT skip credits for this series"); return; }

  const delay = Math.max(0, parseInt(cfg.skipperDelay, 10) || 0);
  if (delay > 0) {
    setTimeout(() => simulateClick(btn), delay);
  } else {
    simulateClick(btn);
  }
}

/* Start polling loop */
function ensurePolling() {
  if (pollTimer) clearInterval(pollTimer);
  const interval = clampInt(cfg.skipperDelay, 250, 3000); // tighter, sane range
  pollTimer = setInterval(tryClickSkip, interval);
  log(`Skipper polling at ${interval}ms (enabled=${cfg.enableSkipper})`);
}

function clampInt(n, min, max) {
  n = parseInt(n, 10);
  if (Number.isNaN(n)) n = min;
  return Math.min(max, Math.max(min, n));
}

/* Observe page changes to re-check quickly (helps when UI appears) */
const mo = new MutationObserver(() => {
  if (cfg.enableSkipper) {
    if (mo._t) cancelAnimationFrame(mo._t);
    mo._t = requestAnimationFrame(tryClickSkip);
  }
});
mo.observe(document.documentElement, { childList: true, subtree: true, attributes: false });

/* Bootstrap */
ensurePolling();

/* ------------------------------ Logging ------------------------------ */
function log(...args) {
  // Toggle for debugging if needed:
  // console.debug("[Plex Plus Skipper]", ...args);
}
