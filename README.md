# Opia 5.5 🎩🧐

A jittery little pixel desktop pet that **does things on your computer** for you. Opia is the orange critter from the original sprite, now in a top hat and a monocle. It twitches, blinks, looks around, and wanders along the bottom of your screen. Click the ✦ button and ask it to do something. It browses in **its own invisible browser** through Claude Code, without touching your mouse, keyboard or windows, so you can keep playing a game or working while it works.

> Opia's brain is the **Claude Code CLI** (`claude -p`), using your own Claude login. No API key is needed.

**Demo video:** [`docs/opia-demo.mp4`](docs/opia-demo.mp4), about 90 seconds. It shows Opia's real sprite, animation and panel; the agent's steps in it are scripted. To re-record it, run `node tools/demo/record.js`. It needs ffmpeg and a Playwright browser: run `npx playwright install chromium`, or set `OPIA_DEMO_PLAYWRIGHT` to another Playwright install whose browsers are already downloaded.

## Prerequisites

- **Node.js 18+** (and npm)
- **Claude Code CLI**, installed and logged in:
  ```bash
  npm install -g @anthropic-ai/claude-code
  ```
  ```bash
  claude
  ```
  Run `claude` once in a terminal, finish the login, then exit.
- **A Chromium-family browser** installed: Microsoft Edge (built into Windows), Chrome, Brave or Chromium. Opia finds it by itself and uses Edge first. No browser extension is needed. If you have none, run `npx playwright install chromium` in Opia's folder after `npm install`.

## Install & run

Download Opia: https://github.com/samuelsortland-cmyk/opia/archive/refs/heads/main.zip, then unzip it. Or clone it:
```bash
git clone https://github.com/samuelsortland-cmyk/opia
```
Open a terminal in the unzipped or cloned folder (the one with `package.json`), then:
```bash
npm install
```
```bash
npm start
```

Opia appears in the bottom-right corner of your screen, and a tray/menu-bar icon appears with it.

## Using Opia

| Do this | What happens |
|---|---|
| Hover Opia and click **✦** (or press **Ctrl/Cmd+Shift+O**, double-click, or right-click Opia) | Opens the prompt panel |
| Type a task and press **Enter** | Opia thinks, browses, and works; progress shows in the panel and in Opia's speech bubble |
| Close the panel (✕ or Esc) | **Opia keeps working in the background.** You get a notification when it's done or needs approval |
| Send another task while busy | It is queued and runs next |
| ■ Stop | Cancels the current task and clears the queue |
| ＋ New chat | Forgets the previous conversation (otherwise Opia remembers it with `--resume`) |
| Drag Opia | Moves it. Let go and it falls to the bottom of the screen with gravity |
| **Fling Opia** (drag fast and let go) | It flies, bounces off the screen edges and floor, and maybe gets dizzy. Click it mid-air to catch it |
| Ask about your screen ("what's this question?", "can you see my screen?") | Opia takes a screenshot of the display under your cursor and looks at it |
| Stroke Opia with the cursor | It likes being petted |
| Tray → Snooze wandering | Opia stays put |

Example tasks:
- "Find the 3 top stories on Hacker News and summarize them"
- "What's taking up the most space in my Downloads folder?"
- "Open my company's status page and tell me if anything is down"
- "Rename all the screenshots on my Desktop to include their date"
- "Look at my screen and explain this error message"

### Moods

Opia's animation follows what the agent is doing: **thinking** (tapping, looking up), **browsing** (the monocle glints as Opia peers at pages), **working**, **listening** (waiting for your OK), **success** (tips its hat and hops), **error** (shakes), and **sleeping** (Zzz, after being ignored for a while).

## Browsing while you do something else

By default, Opia uses **its own browser**: a separate profile in Opia's app-data folder, running **invisibly (headless)**. No setup or extension is needed.

- It never moves your real mouse, presses your keys, or opens windows over what you're doing. That makes it safe while you play a game.
- **Quiet mode** (on by default) means that when Opia needs an OK or finishes, you get a notification instead of a pop-up window.
- **Logging in to sites:** Opia's browser remembers logins.
  1. Untick **Settings → Hide Opia's browser**.
  2. Ask Opia to open the site, then sign in yourself in the window that appears.
  3. Tick the setting again.

  Opia never types passwords for you.

Downsides compared with working in your own tab:
- It doesn't see your existing tabs or your normal logins. You sign in once in Opia's browser instead.
- Some sites treat invisible (headless) browsers with suspicion and show more CAPTCHAs. For those, untick "Hide Opia's browser".
- While "Hide Opia's browser" is unticked, the browser window can grab focus when it opens. Keep it ticked while gaming.

### Optional: work in a tab you already have open
Choose **Settings → Where Opia browses → My browser**. Opia then works in an existing Chrome or Edge tab with your logins, using the [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm). You install it once, keep the browser open, and pick the tab when asked; paste the extension's token into Settings to skip that step. Without an extension, working in your existing tabs isn't possible: Chrome blocks outside control of your normal profile.

## Seeing your screen

When a task needs it, Opia can take a **screenshot of the display under your mouse** and look at it. It does this when you say things like "this page" or "can you see my screen?".
- Screenshots are only taken while Opia is working on a task you gave it, and the pet shows "Peeking at your screen 🧐".
- On Windows and macOS, Opia's own windows are hidden from the screenshot.
- Opia can **see** your screen but can't click or type on it. To act on a web page you're looking at, it opens the same address in its own browser.
- Turn it off with **Settings → Let Opia see my screen**.
- **macOS:** the first time, allow Opia (or the terminal you started it from) in **System Settings → Privacy & Security → Screen Recording**.

## Updating Opia

Opia can update itself from GitHub.
- It checks at startup and every 6 hours. When there's a new version, the pet tells you and you get a notification.
- To update, click **Update now** in the panel, or use **tray → Update Opia now**. You can also check by hand with **Settings → Updates → Check now**.
- Updating downloads the new version, replaces the app files (your settings and `node_modules` are kept), runs `npm install` if needed, and restarts Opia.
- **Update source:** a repo, branch and folder set in **Settings → Updates**. The default is this repo, `samuelsortland-cmyk/opia`, branch `main`.
- **Private repo (only if you point updates at one):** GitHub only serves private repos with a token. Either make the repo public, or create a fine-grained token with read-only *Contents* access to that one repo (GitHub → Settings → Developer settings → Personal access tokens), then paste it into **Settings → Updates → GitHub token**.
- The first update on a copy installed from a zip always runs once, because that copy doesn't record its version yet.
- If an update needs a new Electron version, Opia asks you to quit and run `npm install` yourself.

## Safety model

- **Separate browser by default.** Opia's browser has its own profile, so it can't see your normal browser's tabs, cookies or logins. If you switch to *My browser* mode, Opia works only in the tab you share, and it can see whatever that site shows you while logged in. Disconnect any time from the extension.
- **Permission cards.** In **Ask** mode (default), browsing and read-only tools run freely. Anything that runs a shell command or changes files shows an **Allow / Deny** card with the exact command or file first. If the panel is hidden, you get a notification (with Quiet mode off, the panel also appears, without taking focus). Unanswered requests are denied after a timeout.
- **Auto mode** (Settings → Permissions) approves everything. Only use it when you trust the task.
- Opia is told to stop and ask before purchases, sending messages or email, entering credentials, or deleting things, and to treat web page content as untrusted (prompt injection).
- Everything runs locally on your computer through your own Claude Code login. Usage counts against your Claude plan.

## Settings (⚙ in the panel)

| Setting | Meaning |
|---|---|
| Permissions | `Ask` (default) or `Auto` |
| Where Opia browses | **Opia's own browser** (default, no setup) or **My browser** (an existing tab; needs the Playwright Extension) |
| Extension token | *My browser* mode only: optional `PLAYWRIGHT_MCP_EXTENSION_TOKEN` to skip the tab-connect dialog |
| Chrome profile | *My browser* mode only: optional profile folder name (e.g. `Profile 1`) |
| Quiet mode | On by default: never pop up over other apps; notify instead |
| Let Opia see my screen | On by default: allows screenshots while it works on your task |
| Updates | Check automatically (on), update source repo / branch / folder, optional GitHub token for a private repo |
| Hide Opia's browser | On by default: Opia's browser runs invisibly. Turn off to watch it or to sign in to sites |
| Opia's browser | Auto (Edge first, then Chrome or Brave; default), or force Chrome, Chromium, Edge or Firefox |
| Working folder | Where shell and file tools start (default: your home folder) |
| Claude path | Path to the `claude` binary if it isn't on the PATH Opia sees |
| Model | Optional model override passed to `claude --model` |

Settings live in `opia-settings.json` in Electron's userData folder.

## Troubleshooting

- **"Opia needs Claude Code to think"**: install the CLI (above). On macOS, apps launched from Finder don't see your shell PATH. Opia checks common locations, but you can also set **Claude path** (find it with `which claude`).
- **"Not logged in" / auth errors**: run `claude` once in a terminal and log in.
- **Browser tasks fail with a Chrome error**: install Chrome, or choose *Chromium* in settings and run `npx playwright install chromium`.
- **Linux: Opia is a black box instead of transparent**: transparency needs a compositing window manager (most desktop environments have one). On some NVIDIA setups, try `npm start -- --disable-gpu`.
- **Linux: clicks don't pass through Opia's empty space**: Electron doesn't support forwarded mouse events on Linux, so the pet window (200×200) stays clickable there.
- **Opia went to sleep**: it naps after about 90 s without attention. Move the mouse near it or click it.

## Project layout

```
opia/
  main/main.js         Electron main: pet window, panel, tray, IPC, task queue
  main/preload.js      window.opia bridge (contextIsolation on, no node in renderers)
  main/settings.js     JSON settings
  main/agent.js        Claude Code CLI wrapper (stream-json, --resume, MCP config)
  main/physics.js      fling physics: gravity, bounces, friction
  main/updater.js      self-updater from GitHub
  main/tools/          MCP bridge (approve + see_screen), helpers
  renderer/index.html  pet window (canvas + speech bubble + ✦ button)
  renderer/app.js      wires agent events → moods, drag/click, click-through
  renderer/sprite.js   pixel-art Opia with hat and monocle
  renderer/behavior.js jitter, blinking, gaze, wandering, moods
  renderer/panel.*     prompt panel UI
  assets/              sprite source and icons
  docs/RESEARCH.md     research on AI desktop pets that shaped Opia's design
```

## Credits

The design is based on the research in [`docs/RESEARCH.md`](docs/RESEARCH.md): classic desktop pets (eSheep, Shimeji, Desktop Goose), lessons from Clippy and BonziBuddy, and the 2025–26 wave of Claude Code companion pets.
