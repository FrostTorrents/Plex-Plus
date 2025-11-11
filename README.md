# Stream Plus — Smart Sleeper & Skipper for Plex

A Chrome/Chromium extension that adds a **per-show skipper**, a **sleep timer** with a tiny **floating overlay**, and binge-safety tools for Plex.  
A Firefox port exists but is currently **outdated** (see Roadmap).

---

## ✨ What it does

**Per-Show Rules (Rules Chip)**
- Toggle per-series:
  - 🎬 **Skip Intro**
  - 🎞️ **Skip Credits** (modular `outro.js`)
  - 🔉 **Lower volume in credits** (optional)
- “🚫 **Disable this series**” (series-wide) using robust title canonicalization.
- Skipper actions honor your per-show settings.

**Skipper Automation**
- 🖱️ Clicks only when on-screen text matches known labels (“Intro”, “Recap”, “Opening”, “Credits”, “Outro”, “Play Next”).
- 🧠 Playback/DOM aware to avoid false clicks.
- ⚙️ Configurable global delay between checks; persists via `chrome.storage`.

**Sleep Timer**
- 🪟 Tiny overlay: draggable, **resizable**, opacity via **Shift + mouse-wheel**.
- ➕ Presets **+15 / +30 / +60**, **−10**, and **Cancel** (additive).
- ⌚ **Playback-aware**: timer **only counts down while the video is actually playing**; auto-pauses on pause/end and resumes on play.
- 🌗 Optional **Fade-to-Sleep** (lowers volume ~5% every 30s in the final minutes).
- 🛑 End-of-timer actions: **pause** or **mute**, plus optional **dim screen**.
- 🧷 Position, scale & opacity **persist across sessions**.

**Binge Guards**
- 🧱 **Episode Guard**: stop after *N* consecutive episodes; auto-reset after 10 minutes idle.
- 💡 (Planned) **Binge Suggestions**: local-only suggestions for guard values & “keep watching”.

**Popup UI**
- Three clean tabs:
  - **Sleeper** – overlay toggle & timer controls
  - **Skipper** – per-show rules & series disable
  - **Global** – extension-wide settings (delay, volume, end-of-timer behavior)
- ☕ “Buy me a coffee” link supported.

---

## 🧩 How it works (high level)

manifest.json
background.js # settings storage, message broker
content.js # overlay, timer, series-key, boots skippers, playback-aware timer
skip.js # Intro skipper
outro.js # Credits/outro skipper
next.js # Play Next skipper
popup.html / popup.js # 3-tab UI: Sleeper, Skipper, Global
overlay.html # the floating timer bar (injected by content.js)
options.html (legacy) # advanced settings (optional)
styles.css # shared styles (light use)

markdown
Copy code

- `content.js`:
  - Canonicalizes the **series title** (strips “SxxExx”, etc.), publishes `activeSeriesTitle` + `activeSeriesKey` to `chrome.storage.local`.
  - Injects/controls the **overlay** (drag, resize, opacity; state persisted).
  - **Playback-aware timer** bound to `<video>` play/pause/ended events.
  - Boots skippers (`skip.js`, `outro.js`, `next.js`) when ready.
- `popup.js`:
  - Reads/writes settings via `chrome.storage.sync`.
  - Sends messages to the active Plex tab (works on `app.plex.tv` and local Plex hosts/IPs).
  - Ensures the overlay is visible before timer actions.

**Storage (key examples)**
- `countdownVisible`, `globalEnabled`, `skipDelayMs`, `volumeLevel`
- `perShowRulesByKey`, `perShowRules`, `disabledSeriesKeys`
- `overlayState` `{ left, top, scale, opacity }` (local)
- `activeSeriesTitle`, `activeSeriesKey` (local)

---

## 🔧 Install (Chrome / Edge / Brave)

1. **Clone** the repo or download it.
2. Put your icons in `chrome/icons/` as:
icon16.png icon48.png icon128.png

pgsql
Copy code
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select the `chrome/` folder.
4. Open Plex (`app.plex.tv` or your local Plex host), start a video.

> If the extension fails to load: double-check the icon filenames & paths in `manifest.json`.

### Firefox (temporary note)

A Firefox version exists but is **behind** the Chrome build. Some modules run, but overlay and skipper wiring need updates for parity. See **Roadmap**.

---

## 🛠️ Permissions

```json
{
"permissions": ["storage", "scripting", "activeTab"],
"host_permissions": [
 "*://*.plex.tv/*",
 "*://*/*"         // local Plex servers (optional but recommended)
]
}
You can narrow host permissions if you only use app.plex.tv.

🧪 Troubleshooting
Timer buttons don’t do anything

Ensure Sleeper → Show floating timer overlay is checked.

Make sure you have an active Plex tab; the popup also falls back to the active tab for local Plex.

Check the page console: look for [SmartSkipper] logs.

Not skipping intro/credits

Global → Enable all automation must be on.

Skipper → Skip Intro / Skip Credits must be on and the series must not be disabled.

Increase Global → Delay (ms) if clicks are racing the DOM (~500–800ms).

Overlay jumps or disappears

We clamp it to the viewport; drag it away from the edges.

Opacity is adjustable via Shift + mouse-wheel (persists).

🧱 Design details (nerdy)
Series keying: canonicalizeSeriesTitle() strips season/episode & punctuation; normalizeTitle() lowercases and strips non-alphanumerics → stable per-show key.

Playback-aware timer: counts down only when !video.paused && !video.ended && readyState > 2; auto-pauses on pause/ended, resumes on play.

Overlay state persisted in chrome.storage.local.overlayState, restored on injection.

Messaging: popup ensures overlay visibility for timer:add/sub/cancel before updating.

📦 Building / Packaging
No bundler required. For a Chrome zip:

bash
Copy code
zip -r stream-plus-chrome.zip chrome \
  -x "*/.git/*" "*/node_modules/*" "*.DS_Store"
Firefox build (WIP) will live under firefox/ with its own manifest once updated.

🧭 Roadmap
 Update Firefox build to parity with Chrome (MV3 compatibility).

 Add Binge Suggestions (local-only) UI tab.

 Smarter label detection (site variations / languages).

 Optional global hotkeys for timer presets.

 Export/import user settings.

 Small-screen popup compact mode toggle.

🔐 Privacy
All data is local. No analytics. No external network calls.

Uses chrome.storage for settings and overlay state.

🤝 Contributing
PRs welcome! Please:

Keep file/function names consistent with the current architecture.

Avoid heavy dependencies; vanilla + DOM observers are preferred.

Add clear console logs for any non-trivial behavior.

☕ Support
If this saved you a thousand clicks:
Buy me a coffee — thank you! 💛

📜 License
MIT (proposed). If you need a different license, open an issue.
