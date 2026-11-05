# Opia 5.5 🎩🧐

A jittery little pixel desktop pet that **does things on your computer** for you. Opia is the orange critter from the original sprite, now in a top hat and a monocle. It twitches, blinks, looks around, and wanders along the bottom of your screen. Click the ✦ button and ask it to do something. It works **inside your own Edge or Chrome tabs** through Claude Code: it reads and clicks in the page directly, without touching your mouse or keyboard, so you can keep playing a game or working while it works.

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
- **Microsoft Edge or Google Chrome** (version 125 or later). Opia works in your tabs through Opia Link, its own extension, which you add once with **Connect my Edge**. Prefer no extension? Choose *Opia's own invisible browser* in Settings. If you have none, run `npx playwright install chromium` in Opia's folder after `npm install`.

## Install & run

1. Download Opia: https://github.com/samuelsortland-cmyk/opia/archive/refs/heads/main.zip and unzip it. Or clone it with `git clone https://github.com/samuelsortland-cmyk/opia`.
2. **Windows:** double-click **`Start Opia.bat`** in the Opia folder. The first time, it installs what Opia needs (about a minute).
   **Mac/Linux:** in a terminal in the Opia folder, run `npm install` once, then `npm start`.
3. Opia appears in the bottom-right corner of your screen, with a tray/menu-bar icon.

**Opening Opia later (Windows):**
- On first start, Opia adds an **Opia 5.5** shortcut to your **Desktop** and **Start menu**. Double-click it, or press the Windows key and type "Opia".
- If Opia is already running, the shortcut opens its panel.
- Lost the shortcut? Use **tray → Create desktop shortcut**, or **Settings → Opening Opia**.
- **Start Opia when I log in:** tray checkbox, or **Settings → Opening Opia**.
- `Start Opia.bat` always works too.

## Using Opia

The chat panel is laid out like a familiar chat app:
- **Opia** is in the top-left corner, with what it's doing right now underneath.
- **New chat**, **Settings**, **Hide** and **⏻ Turn off** are in the top right.
- Before you've said anything, a greeting and some example tasks fill the panel.
- Your messages appear in bubbles. Opia's replies have a **Copy** button underneath.
- At the bottom is a rounded message box. Its Send button becomes **■ Stop** while Opia works; type something to queue it instead. The chip in the box shows where Opia browses; click it for Settings.
- Light and dark themes follow your system setting.


| Do this | What happens |
|---|---|
| Hover Opia and click **✦** (or press **Ctrl/Cmd+Shift+O**, or double-click Opia) | Opens the prompt panel |
| **Right-click Opia** | A menu: Open Opia, Stop current task, Snooze wandering, Hide Opia, **Turn off Opia** |
| **⏻** in the panel's title bar (or tray → Turn off Opia) | Turns Opia off completely (stops any running task first) |
| Type a task and press **Enter** | Opia thinks, browses, and works; progress shows in the panel and in Opia's speech bubble |
| Close the panel (✕ or Esc) | **Opia keeps working in the background.** You get a notification when it's done or needs approval |
| Send another task while busy | It is queued and runs next |
| ■ Stop (or **Ctrl+.** in the panel, or **tray → Stop current task**) | Stops the current task **immediately**, even if it's stuck: Claude Code and everything it started (browser tools, commands) are shut down, and the queue is cleared |
| **Chats** (▯ icon, top right) | Your chat history: Opia remembers every chat. Click one to go back to it, and Opia picks up that conversation where you left off. Hover a chat to **rename** ✎ or **delete** 🗑 it; **Delete all chats** is at the bottom (click twice) |
| ✎ New chat | Starts a fresh chat; the old one stays in **Chats** until you delete it |
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

## Working in your browser (Opia Link)

By default, Opia works in **all your open Edge (or Chrome) tabs** through **Opia Link**, its own small browser extension. Your tabs keep their normal logins. Opia can find "my quiz tab" even when it's in the background, and fill it in right there, with no tab picking.

**One-time setup (about 30 seconds):**
1. In Opia's panel, click **Connect my Edge**. Opia opens Edge's Extensions page and the Opia Link folder, and copies the folder's path.
2. In Edge, turn on **Developer mode** (a switch on the Extensions page).
3. Click **Load unpacked**, paste the path (**Ctrl+V**) or pick the `opia-link` folder, then click **Select Folder**.
4. Opia says **"Opia Link connected!"**. Keep Edge open, and you're done. Opia Link reconnects by itself whenever Opia and Edge are both running.

**How it stays out of your way:**
- Opia's clicks and typing go **into the page**, never through your real mouse or keyboard.
- Opia never brings Edge to the front or switches the tab you're looking at. Tabs it opens (only when you ask) open in the background.
- It attaches to your tabs only while it's working on a task. While it's working, Edge shows a "started debugging this browser" bar, which goes away when the task ends.
- Opia Link only talks to Opia on your own computer (`127.0.0.1`). Both sides prove they share a secret that Opia generated, so web pages can't use it.
- When Opia updates, it refreshes Opia Link's files and the extension reloads itself.

### No payments, ever
Opia never makes payments or purchases, even if you ask. This is enforced in three places:
1. **Opia's instructions:** it refuses buying, ordering, checking out, paid subscriptions, donating, sending money, and entering card or bank details.
2. **Payment sites are refused:** Opia won't open PayPal, Stripe checkout, Klarna, Afterpay, Venmo, Cash App, Robux purchase pages and similar.
3. **The in-page guard:** while Opia is working in a tab, Opia Link locks card and bank fields, payment frames, payment pages, and pay / buy / place order / checkout buttons (and "subscribe"-style buttons when a price is shown). You'll see "🎩 Blocked by Opia" on the page.

When Opia lets go of the tab, everything works normally for you again. Note: while Opia is working, these payment controls are locked for you too in the tabs it's using.

This is a strong guard but not a perfect one: an unusual payment flow it doesn't recognize could slip through. Don't leave one-click purchasing set up anywhere you'd hate a surprise.

### Other options (Settings → Where Opia browses)
- **My browser, picked tabs (Playwright Extension):** uses the store's [Playwright Extension](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm) instead of Developer mode. Opia only sees the tabs in its own tab group (drag tabs in to share them), and Edge comes to the front when it connects.
- **Opia's own invisible browser:** no setup. Opia uses a separate, hidden Edge/Chrome profile, so results don't appear in your tabs. Untick **Hide Opia's browser** to sign in to sites there once.

## Chat history

- Every chat is saved on your computer (`opia-chats.json` in Opia's app-data folder) and comes back when you restart Opia.
- Each chat is its own Claude Code conversation, so switching chats switches what Opia remembers.
- Chats are named after your first message; rename them any time.
- **Deleting a chat** removes it from Opia and also deletes Claude Code's own saved copy of that conversation (`~/.claude/projects/…/<session>.jsonl`), so it's really gone. Other conversations aren't touched.
- You can't switch or delete the chat Opia is working in until you stop the task (■).

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

- **Your tabs, no payments.** With Opia Link, Opia can work in any tab you have open, only while it's on a task you gave it, and never makes payments (see above). In *picked tabs* mode it works only in the tabs you share with it. It can see whatever that site shows you while logged in, and it treats page content as untrusted. Disconnect any time from the extension. For full isolation, use *Opia's own invisible browser*, which has its own profile and can't see your tabs, cookies or logins.
- **Permission cards.** In **Ask** mode (default), browsing and read-only tools run freely. Anything that runs a shell command or changes files asks first, showing the exact command or file. If Opia's chat is closed, a card **slides in at the right edge of your screen**, styled like the message box, with **Allow / Deny** right on it. It never takes keyboard focus, so it can't interrupt a game, and ↗ opens the chat. With Quiet mode off, the chat also opens (without taking focus). Unanswered requests are denied after 5 minutes, and the card shows the countdown.
- **Auto mode** (Settings → Permissions) approves everything. Only use it when you trust the task.
- Opia is told to stop and ask before purchases, sending messages or email, entering credentials, or deleting things, and to treat web page content as untrusted (prompt injection).
- Everything runs locally on your computer through your own Claude Code login. Usage counts against your Claude plan.

## Settings (⚙ in the panel)

| Setting | Meaning |
|---|---|
| Permissions | `Ask` (default) or `Auto` |
| Where Opia browses | **My browser, all tabs (Opia Link)** (default; one-time Connect my Edge), **picked tabs** (Playwright Extension), or **Opia's own invisible browser** (no setup) |
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
  main/chats.js        chat history (saved chats, each tied to its Claude Code session)
  main/link.js         Opia Link relay: the extension <-> Playwright MCP bridge, payment-site block
extension/             Opia Link browser extension (all tabs via chrome.debugger) + payment guard
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
