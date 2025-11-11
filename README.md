# 📦 Stream Plus

Smart sleep timer + intro/credits skipper for **Plex Web**.  
Minimal floating overlay, **per-show rules**, and a **safer skipper** that only clicks when it’s clearly an *Intro, Recap, Opening, Credits,* or *Outro*.  
No accounts. No telemetry. Everything stays local.

---

## 🔖 Versions

- **Chrome / Chromium (v2.0.0)** – current and actively maintained  
- **Firefox (legacy 1.x)** – **outdated but still functional**; temporary install only

---

## ✨ Why Stream Plus

- 🎯 **Per-series control** so it skips only when you want
- ⏱️ **Timer tracks playback** (pauses when video pauses/ends, resumes on play)
- ➕ **Additive presets** for fast stacking (+15 / +30 / +60 / −10 / Cancel)
- 🌙 Optional **fade-to-sleep** volume ramp near the end
- 🧱 **Episode Guard** to stop after N consecutive episodes
- 🔒 **Safety-first**: won’t click unknown buttons; skips only when rules allow

---

## 🧩 Features

### 🎛️ Per-Show Rules chip
- 🎬 Skip intro  
- 🎞️ Skip credits  
- 🔉 Lower volume during credits (optional)  
- 💾 Rules saved and applied **per series** (series-wide “Disable this series” supported)

### 🛡️ Safer skipper
- ✅ Clicks only if overlay text matches **Intro / Recap / Opening / Credits / Outro** *and* your rule is on  
- 🔒 When a rule is off, the skip button is **locked** (`pointer-events: none`)  
- ⏭️ Ignores transport controls to avoid accidental 10s jumps  
- 🗂️ Better series title resolution with cached fallback

### 🪟 Floating timer overlay
- 🧲 Tiny draggable bar (position, size, and opacity **persist**)
- ➖ −10m · ➕ +15m / +30m / +60m · ✖ Cancel  
- 🖱️ **Shift + Wheel** adjusts opacity  
- ⌚ Presets are **additive** (15 + 15 + 30 → 60m)  
- 🔁 Optional **fade-to-sleep** (~5% volume every 30s in final minutes)

### 🧱 Episode Guard
- 🛑 Auto-stop after **N consecutive episodes**  
- 🔁 Counter resets after **10 minutes** idle

### 🧠 Binge Suggestions *(local only)*
- 💡 Suggests Episode Guard values
- 🕒 Surfaces recent “Keep watching” picks (local history only)

---

## 🧪 Compatibility

- 🖥️ Plex Web (app.plex.tv and local servers)
- 🧭 Chromium-based browsers: **Chrome**, Edge, Brave, Opera  
- 🦊 **Firefox legacy** (temporary install; not on par with Chrome v2.0.0)

---

## 🔐 Permissions

- `activeTab`, `scripting`, `storage`  
Used for overlay injection, skipper logic, and saving settings.  
**No data leaves your browser.**

---

## 📥 Install

### 🧭 Chrome / Edge / Brave / Opera (v2.0.0)

1. ⬇️ Download the release ZIP **or** clone the repo  
2. 🔧 Open `chrome://extensions`  
3. 🧰 Enable **Developer mode**  
4. 📂 Click **Load unpacked** and select the `chrome/` folder (or project root if that’s where `manifest.json` lives)  
5. 🎞️ Open Plex Web and pin **Stream Plus** from the extensions menu

> Tip: If Plex is running on a local IP/hostname, Stream Plus still works. Pin the extension so the popup is one click away.

### 🦊 Firefox (Legacy)

1. ⬇️ Download the ZIP and extract  
2. 🔧 Visit `about:debugging#/runtime/this-firefox`  
3. 📂 Click **Load Temporary Add-on**  
4. 🧩 Select `manifest.json` from the Firefox build folder  
5. 🎞️ Open Plex Web

> ⚠️ **Temporary add-ons unload on browser restart.** Re-load when needed.  
> Firefox build is **outdated but functional**; some niceties (e.g., play-aware timer UI & newer skipper bits) may lag behind Chrome.

---

## ♻️ Update

- Replace files with the latest release (or `git pull`)  
- Reload the extension (`chrome://extensions` → **Reload**)  
- Refresh your Plex tab(s)

---

## 🚀 Quick Start

1. ▶️ Start a video in **Plex Web**  
2. ⏱️ Open the popup → use **+15 / +30 / +60 / −10 / Cancel**  
3. 🎛️ In **Skipper**, toggle **Skip intro** or **Skip credits** for the current series  
4. 🌗 Optional: turn on **Fade to Sleep** / **Episode Guard** (when available)  
5. 🧲 Drag the overlay, resize it, or Shift+Wheel to set opacity — it all **persists**

---

## 📝 Notes & Tips

- If Plex’s own **“Automatically skip intros”** is enabled, it may still jump the playhead.  
  → Disable in Plex settings or keep Stream Plus rules **off** for shows where you don’t want auto-skips.
- Unknown skip buttons are ignored unless the text matches and your rule allows it.
- If rules don’t seem to stick, ensure your browser/profile isn’t clearing site data on close.

---

## 🛠️ Troubleshooting

**Timer not visible**  
- Make sure Stream Plus is loaded and the Plex tab is active  
- Use the popup → **Sleeper** → **Show floating timer overlay**  
- Refresh Plex if needed

**Skips happen when rules are off**  
- Check Plex’s **Automatically skip intros**  
- Keep **overlay lock** on for that series (rules off = button locked)

**Firefox-specific quirks**  
- Manual skip buttons can be flaky when auto-skip is disabled (browser quirk)  
- Temporary add-ons unload on restart

---

## 🗺️ Roadmap

- Settings **export/import**
- Optional tiny countdown embedded in Plex controls
- Firefox parity with Chrome v2.x

---

## 🔏 Privacy

- 🚫 No accounts, no analytics, no remote servers  
- 💽 All data lives in your browser (`chrome.storage` / `browser.storage`)

---

## ☕ Support

If this helps you binge more responsibly:  
**Buy me a coffee** → https://square.link/u/JZUUls2L

---

## 🤝 Contributing

- Bug reports & feature ideas → Issues  
- PRs welcome — keep code small, safe-by-default, and easy to review

---

## 📄 License

**MIT** – see `LICENSE`.
