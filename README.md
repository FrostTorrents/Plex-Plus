# 📦 Stream Plus — Changelog _(formerly Plex Plus)_

All notable changes to this project will be documented in this file.

---

## [Unreleased] – Rebrand prep _(no code release yet)_

### 🏷 Renamed
- Project name changed from **Plex Plus** to **Stream Plus** across README, Wiki, and in-app/UI text (popup title, toasts, overlay labels).

### 📌 Notes
- The browser extension manifest `"name"` will switch to **“Stream Plus”** in the next code update.
- No functional changes in this entry; brand/copy updates only.
- Storage keys and settings are unchanged; no migration needed.

---

## [v1.3.1] – 2025-11-10

### 🐛 Fixed
- Skipper obeys per-show rules: only clicks a skip overlay if it can classify it as **Intro/Recap/Opening** or **Credits/Outro** **and** the corresponding series rule is explicitly **ON**.
- Beta **Rules** chip parsing is reliable across native and custom checkboxes (`role="checkbox"`, `aria-checked`, `data-state`, class-based states).
- Transport controls excluded from skipper targeting to prevent accidental 10-second seeks/replays.
- **Fade-to-Sleep** logic is properly gated whenever the main timer is paused.

### ✨ Added
- **Skip overlay lock:** when a rule is **OFF**, the in-player skip button is made inert (`pointer-events: none`) so nothing—manual clicks, Plex UI, or other scripts—can trigger it.
- Series title resolution improved with a cached fallback to ensure rules are read for the correct show even when the player UI hides metadata.

### 🔁 Changed
- Safer defaults: unknown/unclassified skip buttons are ignored unless a matching rule is explicitly enabled.
- Minor overlay/popup polish carried forward from **1.3.0**.

### ⚠️ Note
- If Plex’s own **“Automatically skip intros”** is enabled in Plex Web settings, Plex may still jump the playhead. Disable that setting for the account/library if you want Stream Plus to be the source of truth.

---

## [v1.3.0] – 2025-11-08

### 🏷 Renamed
- Project renamed from **Plex Sleep Timer** to **Plex Plus**.

### ✨ Added
- **Beta** tab in the popup with a master toggle.
- **Episode Guard:** auto-stop after _N_ consecutive episodes; counter resets after >10 minutes of inactivity.
- **Fade-to-Sleep:** progressively reduces volume (~5% every 30s) during the final _N_ minutes of the timer.
- **Per-Show Rules:** floating Rules chip on Plex pages to toggle **skip intro**, **skip credits**, and optional **lower volume** per series.
- **Skipper** honors rules: intro/credits skipping respects the per-show settings.
- **Binge Suggestions** (local-only): cards in the Beta tab that (a) suggest an Episode Guard value based on your habits, and (b) surface “keep watching” titles from recent history.
- **Additive presets:** **15m / 30m / 60m** buttons now increment the timer each click (e.g., 15m + 15m + 30m → 60m).

### 🔁 Changed
- Timer behavior: starting a timer while the video is paused now pauses the timer (**“Waiting”**) and auto-resumes when playback starts. Pausing video mid-timer also pauses the countdown; resuming playback resumes the timer.
- UI polish: refreshed popup styling (cards, pills, fieldsets).

### 🧹 Internal
- Refactored content script to support paused/resumed timer state, and to gate fade logic while paused.

---

## [v1.2.0] – 2025-10-31

### ✨ Added
- **Skipper Automation** tab in the popup UI  
- Auto-click for:
  - 🎬 **Skip Intro**
  - 🎞 **Skip Credits**
  - ⏭ **Play Next Episode**
- `MutationObserver` integration for real-time DOM updates  
- Simulated mouse events for robust button clicking  
- Playback progress awareness to distinguish intro vs credits  
- Configurable delay (ms) between skip checks  
- Persistent enable/disable state and delay via `chrome.storage`

---

## [v1.1.0] – 2025-10-25

### ✨ Added
- Option to **lower volume** instead of pausing or muting  
- Volume level selector input (%)  
- Option persists across sessions

---

## [v1.0.0] – 2025-10-20

### 🎉 Initial Release
- Sleep timer with custom time input  
- Preset buttons: **15m**, **30m**, **60m**  
- **Mute instead of pause** toggle  
- **Dim screen** when timer ends  
- **Countdown display** toggle  
- **Timer history** logging
