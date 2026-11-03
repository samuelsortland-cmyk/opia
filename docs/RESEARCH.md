# Opia 5.5: Research on AI Desktop Pets

*Compiled by worker-research, 2026-11-01. Sources are listed at the end. Claims marked "(unverified)" come from secondary or blog sources only.*

---

## 1. Executive summary

Desktop pets have been around for about 35 years: Neko on the PC-98 (late 1980s), eSheep, Shimeji, Desktop Goose. The ones people love have three things in common:

1. **Autonomy.** They do things nobody asked for, like walking, sleeping, falling and getting into mischief, so they seem to have a life of their own.
2. **Responsiveness.** They notice you. They chase the cursor, react when grabbed and thrown, and look at what you're doing.
3. **Low cost of ownership.** They are small, cheap on CPU, easy to dismiss, and never block your work.

The assistants people hated, Clippy and BonziBuddy, broke rule 3. Clippy **interrupted** with context-free advice and could not easily be turned off. BonziBuddy **betrayed trust** (it was labelled adware/spyware and ended in a class action and shutdown). For Opia, the lesson is to be lively *in its own space* and helpful *only when asked*.

From 2025–2026 a new category appeared: **pets that visualize coding agents**. Examples are OpenPets, claudlet, AgentBuddy, Claude Pet and Clawd Buddy. They hook into Claude Code's event hooks and show *working / waiting for approval / done / error* as animations. Anthropic itself shipped a short-lived `/buddy` terminal pet (an April Fools 2026 easter egg, unverified) and reportedly an open-source ESP32 "desk buddy" (unverified). **What almost none of them do is act**: they visualize an agent that lives elsewhere. Opia's angle is to be the pet *and* the agent. You give it a prompt, it drives its own browser in the background, and it asks you before touching your machine.

The technically sound way to build this, given the user's "Claude Code CLI, not API" decision, is:
- spawn `claude -p … --output-format stream-json --verbose --include-partial-messages` per turn and continue with `--resume <session_id>`;
- route approvals through `--permission-prompt-tool mcp__opia__approve` (a tiny stdio MCP server) to a card in the pet UI;
- give it a browser through `@playwright/mcp` with a **dedicated `--user-data-dir`**, so it never touches the user's own browser and can run while they work;
- use `--strict-mcp-config` so only Opia's MCP servers load, and do **not** use `--bare` (bare mode ignores the subscription/OAuth login).

---

## 2. Landscape

### 2.1 Classic pets and assistants

| Pet (year) | What it did | Why it felt alive | What annoyed people | Lesson for Opia |
|---|---|---|---|---|
| **Neko / oneko** (PC-98, late '80s; X11 oneko) | A cat chases the cursor, then sits, scratches and sleeps when the cursor stops | A simple chase → idle → sleep state machine with clear "noticing" | Nothing much; it's tiny and passive | Cursor attention plus a sleep state is the cheapest way to look alive |
| **eSheep** (Win 9x era, many ports) | A sheep walks along window tops and the taskbar, turns at edges, falls when dropped, sleeps | It respects the "physics" of your desktop (windows are floors, gravity exists) | Very little | Interacting with the screen edges and work-area bottom makes it look like it lives in your space |
| **Shimeji / Shimeji-ee** (2000s, open source) | Mascots walk, climb walls, hang from the ceiling, multiply, throw your windows off screen | Many behaviors chosen by weighted rules (`behaviors.xml`); the required actions are ChaseMouse, Fall, Dragged, Thrown | Too many clones, and window throwing gets disruptive | Weighted behavior selection; Dragged/Thrown/Fall is the minimum set of physical reactions |
| **Desktop Goose** (2020, Samperson) | A goose wanders, tracks mud, drags in memes and notes, steals the cursor | Mischief means agency; people say "he's really living on my desktop" | Steals the mouse; you hold Esc to make it leave | Personality comes from small bits of mischief, but **never take control from the user**. Always give an obvious "go away" |
| **Clippy / Office Assistant** (1997–2007) | Popped up offering help ("It looks like you're writing a letter…") | It had a face and expressions | Interrupted, repeated itself, was condescending, couldn't be turned off; Microsoft's own research found most users disliked it; off by default in Office XP and removed in 2007 | **Never interrupt unasked.** Show agent status quietly, offer help only when invoked, and make it easy to hide or mute |
| **BonziBuddy** (1999–2004) | A purple gorilla that told jokes, sang and "managed downloads" | Voice and gestures from Microsoft Agent | Labelled adware/spyware, class-action settlement in 2003, discontinued around 2004 | **Trust is the product.** Be local-first with no telemetry, show what the agent does, and get explicit consent for actions |

### 2.2 Modern AI pets and agent companions (2023–2026)

| Project | Stack | What it does | Acts on the computer? |
|---|---|---|---|
| **OpenPets** (alvinunreal) | Electron, tray-first | Pet reacts to Claude Code and other agents through hooks plus MCP tools (`openpets_react`, `openpets_say`); about 13 states; speech is throttled and drawn from static message pools ("Approval needed", "Something failed") | No (it visualizes) |
| **claudlet** (PyPI) | Python | Pixel buddy that types while Claude works, waits when Claude needs you and celebrates when done; a hard-hatted sidekick appears per subagent; clicking brings the terminal forward | No |
| **AgentBuddy** | macOS menu bar | Pet shows the aggregate state (working/waiting/done/celebrate) and sends notifications when an agent needs input | No |
| **Claude Pet** (IMMINJU) | Desktop, socket-driven | 17 states, each with its own animation; hooks write to a socket and the UI updates | No |
| **Clawd Buddy** | Python | Wires the UserPromptSubmit, Stop and PermissionRequest hooks to animations and 3-second speech bubbles | No |
| **Clawd** (KebeliSamet0) | Electron | Transparent, frameless, always-on-top pixel Claude mascot | No |
| **Campy** | — | 7 states: idle, happy, sleeping, eating, playing, excited, sad | No |
| **tamago-ai** | Electron + Ollama | Tamagotchi pet whose personality evolves through LLM chat | No |
| **Project Inaba, Mochi, MiniCPM-Desk-Pet** | Local LLMs | Chatty companions | No (chat only) |
| **Claw Desktop Pet** (kk43994) | Electron | Companion for the OpenClaw agent, with voice cloning and CSS animations | Indirectly |
| **tama96** | Tauri + MCP | A Tamagotchi that *AI agents* care for through MCP, with per-action permissions and rate limits | Reverse direction |
| **Claude Code `/buddy`** (Apr 2026, unverified) | Terminal | 18 species and rarity tiers tied to your account; reportedly removed, which prompted 40+ issues asking for it back | No |
| **Computer-use agents** (Claude computer use, Browser Use, UI-TARS, Agent S, TuriX) | Various | Full desktop or browser control | Yes, but there is no pet |

**Gap Opia fills:** no well-known project combines a lively pet with an agent that *does* things. The closest projects either visualize Claude Code (the hook pets) or are faceless computer-use agents.

The demand signal is strong: people asked loudly for `/buddy` back, and several independent hook pets appeared within months.

---

## 3. What makes a pet feel alive

### 3.1 Principles

1. **Never be perfectly still.** Breathing is a 1 px vertical bob on a 2–3 s sine. Add micro-jitter: a 1 px random offset at irregular 80–250 ms intervals while idle. This "can't sit still" energy is exactly what the user asked for ("jittery and alive a lot").
2. **Randomness with memory, not uniform noise.**
   - Choose the next idle action by weighted random with cooldowns, and don't repeat the last 1–2 actions.
   - Draw delays from a skewed distribution: exponential or log-normal around a mean, clamped. This gives occasional bursts and long pauses, which feel organic. Uniform random feels robotic.
   - Pick the random value once per cycle, not per frame. Re-rolling per frame is a common blink bug.
3. **Blinking.**
   - Interval: 2–6 s, around a ~3 s mean with jitter.
   - Duration: ~100–150 ms (2–3 frames at 20–30 fps).
   - Double-blink about 10–15% of the time.
   - Blink on gaze shifts. A sudden look-away plus a blink reads as thought.
4. **Gaze and attention.**
   - Eyes move first, as saccades (instant jumps, not slides), and the body or tilt follows about 150 ms later.
   - Track the cursor when it's within ~300 px, and look at it when the user clicks nearby.
   - Look *away* sometimes; constant staring is creepy.
   - While "working", glance toward where the browser window is, or up and to the side ("thinking").
5. **Secondary motion and follow-through.** The hat lags the body by one frame on hops and can tilt or lift when surprised. The monocle chain swings after moves, and the monocle glints when it "reads" or browses. Keep secondary motion subordinate: if the viewer watches the hat instead of the face, it's too much.
6. **Squash and stretch.** Squash on landing (about 0.85 height × 1.15 width) and stretch before a hop (the inverse) for 1–2 frames. Keep the area roughly constant.
7. **Layered idles.** Base loop (breathing plus blinking) → small fidgets every 4–12 s (look around, scratch, tap feet, adjust monocle, tip hat) → big idles every 30–90 s (stretch, wander a few hundred px, yawn, peek off the screen edge, trip and recover) → sleep after 60–120 s with no input (Zzz, monocle drops). Wake on the cursor or a click with a startled jump and the hat popping up.
8. **Physical reactions.** Dragged means legs flail. Dropped means it falls to the work-area bottom with squash on landing. Clicked means a happy hop and a random quip. Rapid clicks mean it gets dizzy or grumpy. These are the Shimeji minimum set (Dragged, Thrown, Fall, ChaseMouse).
9. **Moods tied to the agent.** Each agent state should be distinct *from across the room*:
   - **listening**: leans in, eyes wide;
   - **thinking**: taps a foot, looks up, a "…" bubble;
   - **working**: types or fiddles;
   - **browsing**: holds the monocle up, peers and glints;
   - **waiting for approval**: waves at the user with a "!" bubble and a gentle bounce (the only state allowed to call for attention);
   - **success**: tips its hat and hops;
   - **error**: shakes and its hat falls off;
   - **sleeping**: Zzz.

### 3.2 Avoiding Clippy syndrome

- Animations play in Opia's own little window; no popups over the user's work.
- Speech bubbles are short (≤ 60 chars), throttled (at most one unsolicited bubble per ~30 s), and drawn from a pool so they don't repeat back to back.
- Wandering stays at the bottom of the screen, pauses while the panel is open or the user is dragging, and can be turned off.
- Provide a "Hide / Snooze" option in the tray. Opia never takes the cursor or focus.
- Attention-seeking is allowed only for *approval needed* and *task finished*. Those are the moments the user would want to know.

---

## 4. Agent and safety patterns

### 4.1 Driving Claude Code headless (verified against `claude` 2.1.316 `--help` and the official docs)

**Command shape:**
```
claude -p "<prompt>" --output-format stream-json --verbose --include-partial-messages \
  --mcp-config <opia-mcp.json> --strict-mcp-config \
  --permission-prompt-tool mcp__opia__approve \
  --append-system-prompt "<Opia persona + rules>" \
  [--resume <session_id>] [--model <m>] [--max-turns 40]
```

**Gotchas:**
- **Variadic flags.** `--mcp-config <configs...>`, `--allowedTools <tools...>` and `--disallowedTools` are variadic. Put the prompt directly after `-p`, or feed it on stdin, or the prompt can be swallowed as a config path.
- **No `--bare`.** Bare mode never reads OAuth credentials or the keychain and needs `ANTHROPIC_API_KEY`. That contradicts the "use the CLI login" decision.
- **Manual mode by default.** Since v2.1.302, `-p` runs start in Manual mode. Any call that needs approval is **denied** unless a `--permission-prompt-tool` (or a hook) answers. Read-only tools and reads inside the working directories still run without approval.
- **Prompt-tool contract.**
  - Claude Code waits up to `MCP_TIMEOUT` (30 s default) for the server to connect.
  - The tool receives `{ tool_name, input, tool_use_id? }`.
  - It must return a text content block containing JSON, either `{"behavior":"allow","updatedInput":{...original input...}}` or `{"behavior":"deny","message":"User denied"}`.
  - It cannot approve MCP tools marked `requiresUserInteraction`.
- **`--permission-prompts none`** (v2.1.259+) denies everything that would prompt. Useful for an "unattended / browse-only" mode.
- **`--permission-mode`** accepts `default|manual`, `acceptEdits`, `plan`, `auto` (a classifier reviews actions), `dontAsk` and `bypassPermissions`. Opia's "auto" setting could map to `--permission-mode acceptEdits` plus the prompt tool, rather than `bypassPermissions`.
- **Stream format.**
  - The first event is `{"type":"system","subtype":"init", …, mcp_servers:[{name,status}], mcp_server_errors?}`. Use it to confirm `playwright` and `opia` are connected.
  - Then come `assistant` messages (content blocks `text` and `tool_use`), `user` messages (`tool_result`), `stream_event` (with `--include-partial-messages`, `event.delta.type=="text_delta"`), and `system/api_retry` events (show "retrying…").
  - Last comes `{"type":"result", result, session_id, total_cost_usd, duration_ms, is_error, permission_denials}`.
- **Resume.** `--resume <session_id>` finds the session from any cwd. The system prompt from `--append-system-prompt` is fixed for the session until compaction.
- **Cancel.** Send **SIGINT** first (ends the turn cleanly). SIGTERM exits with code 143 and leaves the turn unfinished.
- **Project config.** Without `--bare`, `-p` loads `.claude/settings.json` hooks and `.mcp.json` from the cwd with **no trust dialog**. Running from `$HOME` means any `~/.mcp.json` or project hooks there apply. `--strict-mcp-config` stops extra MCP servers; hooks still run.
- **Auth failures** come back as a `result` on stdout, not on stderr. Detect strings like "login"/"authentication" and show "Run `claude` once in a terminal to log in".
- `--max-budget-usd` exists, but for subscription users the cost is an estimate only.

### 4.2 Background browser work with Playwright MCP

- Config:
  ```json
  {"mcpServers":{"playwright":{"command":"node","args":["<path>/@playwright/mcp/cli.js","--user-data-dir","<userData>/opia-browser"]}}}
  ```
  Add `"--headless"` if the setting is on.
- **Headed by default.** A visible but *separate* Chromium window lets the user glance at progress while staying in their own browser.
- **Dedicated `--user-data-dir`.** Logins persist for Opia's browser only. A persistent profile allows one instance at a time, so do not run two Opia turns concurrently. Alternatively use `--isolated` (in-memory) for a throwaway mode.
- Other useful flags: `--viewport-size 1280x800`, `--output-dir` for screenshots, `--caps vision,pdf` (optional). Each flag also has a `PLAYWRIGHT_MCP_*` env var.
- Tools: `browser_navigate`, `browser_snapshot` (an accessibility tree, cheap and token-efficient; prefer it over screenshots), `browser_click`, `browser_type`, `browser_fill_form`, `browser_press_key`, `browser_tabs`, `browser_take_screenshot`, `browser_wait_for`, `browser_close`.
- The Chromium binary must be present. `@playwright/mcp` uses Playwright's browsers, so the first run may need `npx playwright install chromium`, or point at system Chrome with `--browser chrome`. Show a friendly error if the MCP server fails in `system/init`.
- Never use `--extension` (that attaches to the user's real Chrome), so Opia can't touch the user's own tabs.

### 4.3 Safety UX for an agent acting on someone's computer

- **Prompt injection is unsolved.** Anthropic reports a 23.6% attack success rate for browser agents without mitigations and 11.2% with them (Claude for Chrome). Their later research says even 1% is meaningful. Treat every web page as untrusted.
- **Enforce boundaries in code, not in the prompt** (arXiv 2511.19477). Concretely:
  - The permission tool auto-allows only browser tools plus read-only tools (Read, Glob, Grep, WebFetch/WebSearch if present).
  - Bash, Write, Edit, NotebookEdit and any other tool → an approval card showing the exact command or path.
  - "Always allow this session" is per tool, never global.
  - Deny by default on timeout (for example after 5 minutes) so a forgotten prompt can't hang.
- **Separation:** a separate browser profile, so no access to the user's cookies, banking sessions or email.
- **Sensitive actions:** the system prompt should tell Opia to stop and ask before purchases, sending messages or email, submitting forms with personal data, entering credentials, or deleting things. Also show the "browsing" mood plus the current URL in the panel so actions are visible.
- **Transparency:** stream every tool call as a one-line summary in the panel log ("Opening github.com", "Running: ls ~/Downloads").
- **Kill switch:** a visible Stop button in the panel and in the tray. Clicking the pet during work could offer "Stop?".
- **No telemetry**, and settings and logs stay local (the BonziBuddy lesson).

---

## 5. Technical notes (Electron)

| Topic | Note |
|---|---|
| Transparent window | `transparent:true, frame:false, hasShadow:false, resizable:false, skipTaskbar:true, alwaysOnTop:true`. On macOS use `win.setAlwaysOnTop(true,'screen-saver')` and `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})` to float over fullscreen apps |
| Linux transparency | Needs a compositing WM with ARGB visuals. Known workaround: `app.commandLine.appendSwitch('enable-transparent-visuals')`, sometimes `--disable-gpu` (NVIDIA), and create the window ~300 ms after `ready`. Without a compositor you get a black box. Document this in the README |
| Click-through | Transparent pixels are *not* click-through by default (Electron issue #1335). Pattern: `setIgnoreMouseEvents(true,{forward:true})` when the cursor is over transparent pixels and `false` over the sprite (renderer hit-tests canvas alpha → IPC). `forward` is supported on macOS/Windows only. On Linux, keep the window small and don't ignore |
| Dragging | Don't use `-webkit-app-region: drag` on the pet; drag regions swallow pointer events. Do a manual drag: mousedown, then screen-delta → `moveBy` over IPC |
| Multi-monitor | Clamp using `screen.getDisplayNearestPoint(center).workArea`, not the primary display. Wandering should stay on the current display |
| Cursor tracking | `screen.getCursorScreenPoint()` from main, polled by the renderer at ~10 Hz. That's enough for gaze and cheap. No global hooks needed |
| CPU | Pixel art at 200×200 doesn't need 60 fps. Run logic at ~30 fps with `requestAnimationFrame` plus an accumulator, and redraw only when the pose changes. Drop to ~10 fps when sleeping. Expect <1–2% CPU |
| `backgroundThrottling` | Set `false` on the pet window so animation continues while unfocused (it's always unfocused) |
| Focus | The pet window should not steal focus: `focusable:false` on Windows/Linux can break input, so prefer `showInactive()`. The panel window is a normal focusable window opened next to the pet |
| Child process | `spawn(claudePath, args, {cwd, env:{...process.env}, shell: process.platform==='win32'})`, because on Windows `claude` is a `.cmd` shim. GUI-launched apps on macOS don't inherit the shell PATH, so resolve `claude` from common locations (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, `%APPDATA%\npm`) or let the user set `claudePath` |
| Tray | Add a tray icon with Show/Hide pet, Open prompt, Snooze wandering, Stop task and Quit, since `skipTaskbar` removes the usual way to quit |

---

## 6. Recommendations for Opia 5.5 (prioritized)

**P0: must have**
1. **Pet and agent in one.** The Claude Code CLI runs through `claude -p` with stream-json and `--resume`. Every agent event maps to a visible mood: listening, thinking, working, browsing, waiting-for-approval, success, error.
2. **Safe by construction.** A `--permission-prompt-tool` relays to approval cards. Browser and read-only tools are auto-allowed, while Bash/Write/Edit need a click. Timeouts deny by default. Add a Stop button and SIGINT cancel.
3. **Its own browser.** Playwright MCP with a dedicated `--user-data-dir`, headed by default in a separate window, plus a headless toggle. `--strict-mcp-config`. Never attach to the user's Chrome.
4. **Jittery-alive animation engine.** Layered idles: always breathing and micro-jitter, then fidgets every 4–12 s, big idles every 30–90 s, and sleep after ~90 s. Randomized blinks (2–6 s, 120 ms, 12% double). Saccadic cursor gaze. Squash and stretch. Hat and monocle follow-through. Weighted random choice with cooldowns.
5. **Never Clippy.** No unsolicited popups. Bubbles are short and throttled. Attention-seeking only for approval and done. Hide and snooze are one click away in the tray.

**P1: should have**

6. **Physical desktop presence.** Wander along the work-area bottom, peek at screen edges, fall when dropped, flail when dragged, hop when clicked, get dizzy on rapid clicks.
7. **Helpful failure states.** Detect a missing `claude` binary or missing login and show the exact fix. Detect Playwright browser install errors from `system/init`.
8. **Live narration.** One-line tool summaries in the panel log and short bubbles over the pet. Stream text deltas into the panel.
9. **Click-through transparency** on macOS/Windows through alpha hit-testing, plus tray controls and the Linux compositor note in the README.

**P2: nice to have**

10. **Personality polish.**
    - Rotating quips in a dapper voice, e.g. "Splendid.", "Most curious…", "Allow me, old sport.", with no repeats back to back.
    - Monocle glint when it finds something.
    - Its hat pops off on errors and it puts it back on.
    - Time-of-day behavior (yawning late at night).
11. Task queue, a notification when a long background task finishes, "always allow this session" per tool, and a global hotkey to open the prompt.

---

## 7. Sources

**Claude Code headless and CLI**
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/cli-reference
- https://docs.claude.com/en/api/agent-sdk/permissions
- https://codepointer.substack.com/p/claude-code-permission-system-for

**Playwright MCP**
- https://github.com/microsoft/playwright-mcp
- https://playwright.dev/mcp/configuration/options (not reachable from this session; options were cross-checked through the GitHub README)

**Safety**
- https://anthropic.com/research/prompt-injection-defenses
- https://www.anthropic.com/news/claude-for-chrome
- https://arxiv.org/html/2511.19477v1
- https://www.browserbase.com/blog/ai-browser-prompt-injection-containment-security

**Electron**
- https://github.com/electron/electron/issues/1335
- https://electronjs.org/docs/latest/tutorial/custom-window-interactions
- https://github.com/electron/electron/issues/2170
- https://github.com/electron/electron/issues/40515
- https://nwjs.readthedocs.io/en/nw20/For%20Users/Advanced/Transparent%20Window/

**Classic pets**
- https://www.nathalielawhead.com/candybox/about-desktop-pets-virtual-companions-discussing-the-inhabitants-that-fill-the-void-of-our-digital-spaces
- https://sspai.com/post/91280
- https://github.com/chaoskagami/shimeji-ee
- https://dic.pixiv.net/en/a/Shimeji
- https://samperson.itch.io/desktop-goose
- https://windowscentral.com/you-can-now-download-untitled-goose-ruin-your-desktop
- https://www.majorgeeks.com/files/details/desktop_goose.html
- https://gigazine.net/news/20200131-desktop-goose
- https://appstream.debian.org/stretch/main/metainfo/oneko.html
- https://flathub.org/en/apps/com.daidouji.oneko

**Clippy and BonziBuddy**
- https://www.mentalfloss.com/article/504767/tragic-life-clippy-worlds-most-hated-virtual-assistant
- https://www.theregister.com/2023/06/12/clippy_designer_embarrassed
- https://www.seattlemet.com/news-and-city-life/2022/08/origin-story-of-clippy-the-microsoft-office-assistant
- https://www.neowin.net/amp/microsoft-ignored-focus-group-feedback-about-clippy/
- https://en.wikipedia.org/wiki/BonziBuddy
- https://itbrew.com/stories/2025/05/14/how-a-purple-talking-gorilla-took-spyware-mainstream

**Modern AI pets**
- https://gittrend.io/repo/alvinunreal/openpets
- https://skillsllm.com/skill/openpets
- https://pypi.org/project/claudlet/1.5.1/
- https://github.com/techgocodingnow/agentbuddy
- https://github.com/IMMINJU/claude-pet
- https://pypi.org/project/clawd-buddy/0.1.15/
- https://github.com/dropdevrahul/campy
- https://github.com/KebeliSamet0/clawd
- https://awesome.ecosyste.ms/projects/github.com%2Fswarmclawai%2Ftamago-ai
- https://www.hunted.space/dashboard/tama96-desktop-terminal-ai-pet
- https://github.com/topics/ai-pet
- https://www.mindstudio.ai/blog/what-is-claude-code-buddy-feature
- https://cloudinsight.cc/en/blog/claude-buddy-april-fools
- https://www.cnx-software.com/2026/05/16/anthropics-open-source-claude-desktop-buddy-turns-esp32-s3-devices-into-interactive-ai-desk-companions/ (headline only)
- https://www.simular.ai/articles/2026-the-year-desktop-agents-stop-being-a-toy

**Animation**
- https://dev.to/arkfuldodger/programming-natural-idle-character-animations-4l0g
- https://garagefarm.net/blog/idle-animation-tips-to-animate-your-characters
- https://itch.io/blog/559673/pixel-art-idle-cycle-animation-tutorial
- https://forum.gdevelop.io/t/solved-making-my-character-blink/46268
- https://www.visionaire-studio.net/forum/thread/blinking

**Attachment**
- https://en.wikipedia.org/wiki/Tamagotchi_effect
- https://techpolicy.press/when-users-say-goodbye-to-ai
