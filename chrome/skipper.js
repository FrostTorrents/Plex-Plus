/* skipper.js — STRICT rules: only click when rule is explicitly ON
 * - Reads the per-show Rules chip and stores to rules:SERIES:<title>
 * - During playback, only clicks a skip button if:
 *     (A) we can classify it by label (intro/recap/opening OR credits/outro), AND
 *     (B) the matching per-show rule is explicitly true.
 * - If rule is false or missing → DO NOT CLICK. Also visually "lock" the overlay.
 * - Up-Next auto-play remains.
 */

(() => {
  if (window.__STREAM_PLUS_SKIPPER__) return;
  window.__STREAM_PLUS_SKIPPER__ = true;

  // -------------------- Config --------------------
  const DEFAULTS = {
    enableSkipper: true,        // storage-gated
    skipperDelay: 600,          // ms
    enablePlayNext: true,
    delaySkipIntro: null,       // if null -> fallback to skipperDelay
    delaySkipCredits: null,
  };

  const NEXT_COOLDOWN    = 4000;
  const UNPAUSE_WINDOW   = 3500;
  const UNPAUSE_COOLDOWN = 1200;
  const CLICK_COOLDOWN   = 250;
  const SCAN_INTERVAL    = 400;

  let cfg = { ...DEFAULTS };
  let mo = null;
  let scanTimer = null;

  let lastNextTs = 0;
  let lastUnpauseTs = 0;
  let lastClickTs = 0;

  // ---------------- Storage wiring ----------------
  function pullConfig(cb) {
    chrome.storage.local.get(Object.keys(DEFAULTS), (data) => {
      cfg = { ...DEFAULTS, ...data };
      cb && cb();
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const k of Object.keys(DEFAULTS)) {
      if (k in changes) cfg[k] = changes[k].newValue ?? DEFAULTS[k];
    }
    start();
  });

  // ---------------- Utilities ----------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const getVideo = () => document.querySelector("video");
  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    let r;
    try { r = el.getBoundingClientRect?.(); } catch { return false; }
    if (!r || r.width < 8 || r.height < 8) return false;
    let cs;
    try { cs = getComputedStyle(el); } catch { return false; }
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.06) return false;
    return r.bottom >= 0 && r.right >= 0 && r.top <= window.innerHeight && r.left <= window.innerWidth;
  };
  function simulateClick(el) {
    const now = Date.now();
    if (now - lastClickTs < CLICK_COOLDOWN) return;
    lastClickTs = now;
    try {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, buttons: 1 }));
      el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true, buttons: 1 }));
      el.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true, buttons: 1 }));
    } catch { try { el.click?.(); } catch {} }
  }

  // Deep Shadow DOM traversal + same-origin iframes
  function* deepQueryAllRoots(roots, selectors, depth = 0, maxDepth = 4) {
    for (const root of roots) {
      if (!root) continue;
      for (const sel of selectors) {
        let list = [];
        try { list = root.querySelectorAll(sel); } catch {}
        for (const el of list) yield el;
      }
      if (depth >= maxDepth) continue;

      let all = [];
      try { all = root.querySelectorAll("*"); } catch {}
      for (const host of all) {
        const sr = host && host.shadowRoot;
        if (sr) yield* deepQueryAllRoots([sr], selectors, depth + 1, maxDepth);
      }

      let iframes = [];
      try { iframes = root.querySelectorAll("iframe"); } catch {}
      for (const f of iframes) {
        try {
          const doc = f.contentDocument;
          if (doc) yield* deepQueryAllRoots([doc], selectors, depth + 1, maxDepth);
        } catch {}
      }
    }
  }

  // ------------- Series title & rules storage -------------
  const LAST_SERIES_TITLE = "plexPlus:lastSeriesTitle";
  const rulesKeyForSeries = (series) => `rules:SERIES:${series}`;

  function getSeriesTitle() {
    const gp =
      document.querySelector('[data-qa-id="metadata-grandparent-title"]') ||
      document.querySelector('[data-testid="metadataGrandparentTitle"]') ||
      document.querySelector('.PrePlayTitle .grandparent-title');
    if (gp?.textContent?.trim()) return gp.textContent.trim();
    const dt = document.title.replace(/\s+-\s*Plex.*/i, "").trim();
    return dt || "Unknown Series";
  }
  async function resolveSeriesTitleForRules() {
    const raw = getSeriesTitle();
    const guess = (raw || "").trim();
    if (guess && guess.toLowerCase() !== "unknown series" && guess.toLowerCase() !== "plex") {
      return guess;
    }
    const data = await new Promise((r) => chrome.storage.local.get([LAST_SERIES_TITLE], r));
    return data[LAST_SERIES_TITLE] || "Unknown Series";
  }

  function normalizeTitle(s) {
    return (s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, "")
      .trim();
  }

  // STRICT: only treat explicit true as allow; missing/undefined => disallow
  async function getRulesStrict(seriesTitle) {
    // 1) exact key
    const keys = [rulesKeyForSeries(seriesTitle), `rules:${seriesTitle}`];
    const exact = await new Promise((resolve)=>chrome.storage.local.get(keys, resolve));
    const obj = exact[keys[0]] ?? exact[keys[1]];
    if (obj && (typeof obj.skipIntro === "boolean" || typeof obj.skipCredits === "boolean")) {
      return {
        allowIntro:   !!obj.skipIntro,
        allowCredits: !!obj.skipCredits,
      };
    }

    // 2) fuzzy match against any saved rules (helps with minor title diffs)
    const all = await new Promise((resolve)=>chrome.storage.local.get(null, resolve));
    const normWanted = normalizeTitle(seriesTitle);
    for (const k of Object.keys(all)) {
      if (!k.startsWith("rules:SERIES:")) continue;
      const t = k.slice("rules:SERIES:".length);
      if (normalizeTitle(t) === normWanted) {
        const o = all[k] || {};
        return {
          allowIntro:   !!o.skipIntro,
          allowCredits: !!o.skipCredits,
        };
    }
    }

    // 3) default: missing means NOT allowed to skip
    return { allowIntro: false, allowCredits: false };
  }

  // ---------- Robust toggle reader for native + custom checkboxes ----------
  function readToggleState(node) {
    if (!node) return undefined;
    if (node.matches?.('input[type="checkbox"]')) {
      if (typeof node.checked === "boolean") return !!node.checked;
      const ac = node.getAttribute("aria-checked");
      if (ac === "true" || ac === "mixed") return true;
      if (ac === "false") return false;
    }
    const role = node.getAttribute?.("role");
    if (role === "checkbox" || role === "switch" || role === "menuitemcheckbox") {
      const ac = node.getAttribute("aria-checked");
      if (ac === "true" || ac === "mixed") return true;
      if (ac === "false") return false;
      const cls = node.className || "";
      if (/\b(checked|is-checked|selected|on|toggled)\b/i.test(cls)) return true;
      if (/\b(unchecked|off)\b/i.test(cls)) return false;
    }
    const near = node.closest?.("label,li,div,span,button");
    if (near) {
      const ac2 = near.getAttribute?.("aria-checked");
      if (ac2 === "true" || ac2 === "mixed") return true;
      if (ac2 === "false") return false;
      const cls2 = near.className || "";
      if (/\b(checked|is-checked|selected|on|toggled)\b/i.test(cls2)) return true;
      if (/\b(unchecked|off)\b/i.test(cls2)) return false;
    }
    return undefined;
  }

  function findControlForLabel(container, labelRegex) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, null);
    let best = null;
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!(el instanceof HTMLElement)) continue;
      const txt = (el.textContent || "").toLowerCase();
      if (!labelRegex.test(txt)) continue;
      const control =
        el.querySelector?.('input[type="checkbox"], [role="checkbox"], [role="switch"], [role="menuitemcheckbox"]') ||
        el.closest?.('label,li,div,button,span')?.querySelector?.('input[type="checkbox"], [role="checkbox"], [role="switch"], [role="menuitemcheckbox"]');
      if (control) return control;
      best = el;
    }
    if (best) {
      return (
        best.querySelector?.('input[type="checkbox"], [role="checkbox"], [role="switch"], [role="menuitemcheckbox"]') ||
        best.previousElementSibling?.querySelector?.('input[type="checkbox"], [role="checkbox"]') ||
        best.nextElementSibling?.querySelector?.('input[type="checkbox"], [role="checkbox"]') ||
        null
      );
    }
    return null;
  }

  // ------------- Capture Rules (Rules chip/modal) -------------
  let lastSavedSeries = "";
  let lastSavedHash = "";
  const hashRules = (obj) => JSON.stringify(obj);

  async function maybeCaptureRulesFromUI() {
    const containers = document.querySelectorAll('[role="dialog"], [class*="Modal"], [class*="Drawer"], [class*="Panel"]');
    for (const c of containers) {
      if (!isVisible(c)) continue;
      const rawText = (c.textContent || "").toLowerCase();
      if (!/\bskip\s*intro\b/.test(rawText) && !/\bskip\s*credits?\b/.test(rawText)) continue;

      // title
      let seriesTitle = "";
      const headerCand = c.querySelector('h1,h2,h3,[class*="title"],[class*="Header"],[class*="DialogTitle"]');
      const headerText = (headerCand?.textContent || "").trim();
      if (headerText) {
        const m = headerText.match(/^(.*?)\s+-\s*S\d+/i);
        seriesTitle = (m && m[1]) ? m[1].trim() : headerText;
      }
      if (!seriesTitle) seriesTitle = await resolveSeriesTitleForRules();

      // controls
      const introCtrl   = findControlForLabel(c, /\bskip\s*intro\b|\brecap\b|\bopening\b/i);
      const creditsCtrl = findControlForLabel(c, /\bskip\s*credits?\b|\boutro\b/i);

      let skipIntro   = readToggleState(introCtrl);
      let skipCredits = readToggleState(creditsCtrl);

      if (skipIntro === undefined && introCtrl) {
        skipIntro =
          introCtrl.getAttribute?.("data-state") === "on" ||
          introCtrl.getAttribute?.("aria-pressed") === "true" ||
          /\b(is-checked|selected|on|checked)\b/i.test(introCtrl.className || "") ||
          undefined;
      }
      if (skipCredits === undefined && creditsCtrl) {
        skipCredits =
          creditsCtrl.getAttribute?.("data-state") === "on" ||
          creditsCtrl.getAttribute?.("aria-pressed") === "true" ||
          /\b(is-checked|selected|on|checked)\b/i.test(creditsCtrl.className || "") ||
          undefined;
      }

      // Persist only what we can determine. Missing = undefined (treated as false by STRICT reader).
      if (typeof skipIntro === "boolean" || typeof skipCredits === "boolean") {
        const rules = {
          skipIntro:   typeof skipIntro   === "boolean" ? !!skipIntro   : undefined,
          skipCredits: typeof skipCredits === "boolean" ? !!skipCredits : undefined,
        };
        const key = rulesKeyForSeries(seriesTitle);
        const h = hashRules({ key, rules });
        if (seriesTitle && (seriesTitle !== lastSavedSeries || h !== lastSavedHash)) {
          lastSavedSeries = seriesTitle;
          lastSavedHash = h;
          chrome.storage.local.set({ [key]: rules });
        }
      }
    }
  }

  // ------------- Up-Next cosmetics -------------
  function ensureUpNextCSS() {
    if (document.getElementById("plex-skipper-force-upnext")) return;
    const style = document.createElement("style");
    style.id = "plex-skipper-force-upnext";
    style.textContent = `
      [class*="AudioVideoUpNext-playButton"] {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        transform: none !important;
        transition: none !important;
        z-index: 2147483646 !important;
      }
      [class*="AudioVideoUpNext-"] [class*="controls"],
      [class*="AudioVideoUpNext-"] [class*="actions"],
      [class*="AudioVideoUpNext-"] [role="button"] {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }
    `;
    document.documentElement.appendChild(style);
  }
  function simulateHover(el) {
    if (!(el instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect?.();
    const x = Math.round((r?.left || 0) + Math.max(1, (r?.width || 0) * 0.6));
    const y = Math.round((r?.top  || 0) + Math.max(1, (r?.height || 0) * 0.4));
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };
    try {
      el.dispatchEvent(new MouseEvent("pointerover", opts));
      el.dispatchEvent(new MouseEvent("mouseover",    opts));
      el.dispatchEvent(new MouseEvent("mousemove",    opts));
      el.dispatchEvent(new MouseEvent("mouseenter",  { bubbles: false, cancelable: false, clientX: x, clientY: y }));
    } catch {}
  }

  // ------------- Skip overlay classification -------------
  function classifySkipButton(btn) {
    const label = (
      btn.getAttribute?.("aria-label") ||
      btn.getAttribute?.("title") ||
      btn.textContent ||
      ""
    ).toLowerCase();
    if (/(intro|recap|opening)/.test(label))  return "intro";
    if (/(credit|outro)/.test(label))         return "credits";
    return "unknown";
  }

  // --- Lock the skip overlay when rule says OFF (inert & visibly dimmed)
  async function enforceSkipLocks() {
    const series = await resolveSeriesTitleForRules();
    const { allowIntro, allowCredits } = await getRulesStrict(series);

    const selectors = ['[class*=AudioVideoFullPlayer-overlayButton]'];
    for (const btn of deepQueryAllRoots([document], selectors)) {
      if (!isVisible(btn)) continue;
      const kind = classifySkipButton(btn);
      const locked =
        (kind === "intro"   && !allowIntro) ||
        (kind === "credits" && !allowCredits);
      if (locked) {
        btn.style.pointerEvents = 'none';
        btn.style.filter = 'grayscale(1)';
        btn.setAttribute('data-pp-locked', 'true');
      } else if (btn.getAttribute('data-pp-locked') === 'true') {
        btn.style.pointerEvents = '';
        btn.style.filter = '';
        btn.removeAttribute('data-pp-locked');
      }
    }
  }

  // ------------- Intro / Credits skipper (STRICT) -------------
  async function trySkipIntroCredits() {
    const selectors = ['[class*=AudioVideoFullPlayer-overlayButton]'];
    let btn = null;
    for (const el of deepQueryAllRoots([document], selectors)) {
      if (isVisible(el)) { btn = el; break; }
    }
    if (!btn) return;

    // 1) classify the button — if we can't, DO NOT click
    const kind = classifySkipButton(btn); // "intro" | "credits" | "unknown"
    if (kind === "unknown") return;

    // 2) get rules for the current series (strict: missing = false)
    const series = await resolveSeriesTitleForRules();
    const { allowIntro, allowCredits } = await getRulesStrict(series);

    if (kind === "intro"   && !allowIntro)   return;
    if (kind === "credits" && !allowCredits) return;

    // 3) delay & click
    const dIntro   = Number.isFinite(cfg.delaySkipIntro)   ? cfg.delaySkipIntro   : cfg.skipperDelay;
    const dCredits = Number.isFinite(cfg.delaySkipCredits) ? cfg.delaySkipCredits : cfg.skipperDelay;
    const delay = kind === "intro" ? dIntro : dCredits;

    setTimeout(() => {
      let liveBtn = null;
      for (const el of deepQueryAllRoots([document], selectors)) {
        if (isVisible(el)) { liveBtn = el; break; }
      }
      if (liveBtn && isVisible(liveBtn)) {
        if (!liveBtn.classList.contains("isFocused")) simulateClick(liveBtn);
        liveBtn.click?.();
      }
    }, Math.max(0, parseInt(delay, 10) || 0));
  }

  // ------------- Up-Next / Next Episode -------------
  function isInsideUpNext(el) {
    let n = el;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      const blob = (n.textContent || "").toLowerCase();
      if (/\b(playing\s*next|up\s*next|next\s*episode)\b/.test(blob)) return true;
    }
    return false;
  }
  function findUpNextContainer() {
    const containerSelectors = [
      '[class*=AudioVideoUpNext-]',
      '[data-testid*="UpNext"]',
      '[data-qa-id*="UpNext"]',
    ];
    for (const el of deepQueryAllRoots([document], containerSelectors)) {
      if (isVisible(el)) return el;
    }
    const nodes = document.querySelectorAll("*");
    for (const n of nodes) {
      if (!(n instanceof HTMLElement)) continue;
      const t = (n.textContent || "").toLowerCase();
      if (/\b(playing\s*next|up\s*next|next\s*episode)\b/.test(t) && isVisible(n)) return n;
    }
    return null;
  }
  async function clickNextIfPresent() {
    if (cfg.enablePlayNext === false) return;

    ensureUpNextCSS();

    const cont = findUpNextContainer();
    if (!cont) return;

    const now = Date.now();
    if (now - lastNextTs < NEXT_COOLDOWN) return;

    const buttonSelectors = [
      '[class*=AudioVideoUpNext-playButton]',
      'button[aria-label*="Next"]',
      'button[aria-label*="Play"]',
    ];
    for (const el of deepQueryAllRoots([document], buttonSelectors)) {
      if (isVisible(el) && isInsideUpNext(el)) {
        return doClickNext(el);
      }
    }

    simulateHover(cont);
    const poster = cont.querySelector('img, [data-testid*="poster"], [data-qa-id*="poster"], .PosterCard, .poster');
    if (poster) simulateHover(poster);
    await sleep(120);

    for (const el of deepQueryAllRoots([document], buttonSelectors)) {
      if (isVisible(el) && isInsideUpNext(el)) {
        return doClickNext(el);
      }
    }

    const btns = cont.querySelectorAll('button, [role="button"], a[role="button"]');
    for (const b of btns) {
      if (isVisible(b)) return doClickNext(b);
    }
  }
  function doClickNext(targetEl) {
    if (!findUpNextContainer()) return;
    targetEl.focus?.();
    simulateClick(targetEl);
    lastNextTs = Date.now();
    scheduleUnpauseGuard();
  }
  function scheduleUnpauseGuard() {
    const attempt = () => {
      const now = Date.now();
      if (now - lastNextTs > UNPAUSE_WINDOW) return;
      if (now - lastUnpauseTs < UNPAUSE_COOLDOWN) return;
      if (findUpNextContainer()) return;
      const v = getVideo();
      if (v && v.paused) {
        lastUnpauseTs = now;
        v.play?.().catch(() => {});
      }
    };
    setTimeout(attempt, 250);
    setTimeout(attempt, 700);
    setTimeout(attempt, 1200);
  }

  // ------------- Observer + Poller -------------
  function onMutations(records) {
    if (!cfg.enableSkipper) return;
    for (const r of records) {
      if (r.addedNodes && r.addedNodes.length) {
        maybeCaptureRulesFromUI(); // keep rules synced if modal open
        enforceSkipLocks();        // make skip inert when OFF
        trySkipIntroCredits();     // (STRICT)
        clickNextIfPresent();
        break;
      }
    }
  }

  function start() {
    if (mo) mo.disconnect();
    if (scanTimer) clearInterval(scanTimer);

    if (!cfg.enableSkipper) return;

    mo = new MutationObserver(onMutations);
    mo.observe(document, { childList: true, subtree: true });

    scanTimer = setInterval(() => {
      maybeCaptureRulesFromUI();
      enforceSkipLocks();
      trySkipIntroCredits();
      clickNextIfPresent();
    }, SCAN_INTERVAL);

    // initial sweep
    try {
      ensureUpNextCSS();
      maybeCaptureRulesFromUI();
      enforceSkipLocks();
      trySkipIntroCredits();
      clickNextIfPresent();
    } catch {}
  }

  // Boot
  pullConfig(start);
})();
