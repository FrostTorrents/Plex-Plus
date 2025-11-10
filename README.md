# Stream Plus

Smart sleep timer and intro or credits skipper for Plex Web. Stream Plus adds a minimal floating timer, per show rules, and a safer skipper that only clicks when it is clearly an intro, recap, opening, credits, or outro. Everything is local, no accounts, no telemetry.

## Why use Stream Plus
- Skip only when you want, per series
- Pause aware timer that waits while video is paused and resumes on play
- Additive presets for quick stacking of time
- Optional fade to sleep volume ramp during the final minutes
- Beta lab for early features

## Features
- Per Show Rules chip on Plex pages
  - Toggle Skip intro
  - Toggle Skip credits
  - Optional Lower volume
  - Rules stored per series
- Safer skipper
  - Clicks only when the overlay text matches Intro, Recap, Opening, Credits, or Outro and when the series rule is on
  - When a rule is off, Stream Plus locks the skip button with pointer events set to none
  - Transport controls ignored to prevent 10 second jumps
- Floating timer overlay
  - Tiny draggable bar, default size about 200 by 33
  - Buttons for minus 10 minutes, plus 10 minutes, Cancel
  - Shift plus mouse wheel adjusts opacity
  - Additive presets 15, 30, 60
- Fade to Sleep
  - Reduces volume about 5 percent every 30 seconds during the final N minutes
  - Pauses when the main timer is paused
- Episode Guard
  - Auto stop after N consecutive episodes with a cooldown reset after 10 minutes idle
- Binge Suggestions
  - Local only hints for Episode Guard and quick continue

## Compatibility
- Plex Web on Chromium based browsers
- Tested on Chrome, Edge, Brave, Opera

## Permissions
- activeTab, scripting, storage
- Used for overlay injection, skipper logic, and saving settings
- All data is stored locally in your browser

## Install
1. Download the release zip or clone the repo
2. Open chrome colon slash slash extensions
3. Enable Developer mode
4. Click Load unpacked, select the project folder
5. Open Plex Web in a tab
6. Click the extension icon and pin Stream Plus

## Update
- Pull or download the new release into the same folder
- Go to chrome colon slash slash extensions and click Reload on Stream Plus
- Refresh your Plex Web tab

## Quick start
1. Start an episode or movie in Plex Web
2. Open the popup, pick a preset or set a custom time
3. Use the Rules chip on the show page or in the player to set Skip intro or Skip credits for that series
4. Optional, enable Fade to Sleep or Episode Guard in the Beta tab

## Notes on naming
- The project is Stream Plus in code and docs
- The extension manifest name is Stream Plus starting with the next packaged build

## Tips
- If Plex has Automatically skip intros enabled in account settings, Plex may still jump the playhead. Disable that in Plex or leave the overlay lock on for series where you do not want skips
- Unknown skip buttons are ignored unless a matching rule is on

## Troubleshooting
- The timer is not visible
  - Ensure the extension is loaded and the Plex tab is active
  - Refresh the Plex page
- Skips still happen when rules are off
  - Check Plex account setting Automatically skip intros
  - Keep overlay lock on for that show
- Rules do not stick
  - Make sure third party cookies or site data are not being cleared on close
  - Confirm storage is allowed in your browser profile

## Roadmap
- Manifest rename already planned and safe
- Export or Import settings
- Optional tiny countdown in the Plex control bar
- Firefox build

## Privacy
- No accounts, no analytics, no remote servers
- All settings and rules live in chrome.storage on your machine

## Contributing
- Open an issue for bugs or ideas
- PRs are welcome. Keep code small, readable, and safe by default

## License
- MIT
