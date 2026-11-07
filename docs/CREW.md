# Crew Board protocol

The Crew Board lets separate AI agent apps on one PC (today: **Opia** and **Amir**) see each other, receive the
same prompt from the user, split the work and coordinate. It is a plain folder on disk: no server, no ports, no
dependencies. Any app that follows this document can join the crew.

The reference implementation is `main/crew.js` (Opia) / `app/crew/crew.js` (Amir): one pure-Node CommonJS file,
identical in both repos. The prompt panel is `renderer/crew.html` + `crew.js` + `crew.css`, also identical in both.
Run `node tools/crew-selftest.js` in the Opia repo to test the library.

## Folder layout

```
CREW_DIR/                      env AGENT_CREW_DIR, else ~/.agent-crew   (%USERPROFILE%\.agent-crew on Windows)
  board/
    <ts13>-<from>-<rand6>.json one message per file, never edited after it is written
  agents/
    <id>.json                  presence heartbeat of one agent app
```

- `ts13` is `Date.now()` zero-padded to 13 digits, so sorting file names sorts messages by time. Within one process
  timestamps are made strictly increasing, so same-millisecond posts keep their order.
- `rand6` is 6 hex characters. The message `id` is the file name without `.json`.
- **Atomic writes**: write `<file>.<pid>.<rand>.tmp`, then rename it onto the final name. On Windows the rename is
  retried a few times on `EPERM` / `EBUSY` / `EACCES` (antivirus and indexers briefly lock new files).
- **Readers** ignore anything not ending in `.json` (so `*.tmp` is skipped) and any file that does not parse; such a
  file is retried on the next scan.
- The board is capped: when it holds more than 500 messages, a post deletes the oldest down to 400.
  Stale `*.tmp` files older than a minute are swept at the same time.

## Message

```json
{
  "id": "1731000000000-user-a1b2c3",
  "ts": 1731000000000,
  "from": "user",
  "to": "all",
  "kind": "prompt",
  "promptId": "1731000000000-user-a1b2c3",
  "text": "Find three laptop deals under 10 000 kr and compare battery life."
}
```

| field      | values |
|------------|--------|
| `from`     | `user` or an agent id. Ids are lowercase `[a-z0-9_-]`, at most 32 chars. |
| `to`       | `all`, `user`, or an agent id. |
| `kind`     | `prompt` (from the user), `plan`, `note`, `question`, `result`, `status`. Unknown kinds read as `note`. |
| `promptId` | id of the user prompt this message belongs to, or `null`. A prompt's `promptId` is its own `id`. |
| `text`     | at most 4000 characters (longer text is clipped). |

Kinds, by convention:

- `prompt`: the user's task. `to: "all"` for the whole crew, or one agent id.
- `plan`: which part of the task this agent takes.
- `note`: a finding the others should know (so nobody duplicates work).
- `question`: a question to another agent (`to: "<agent>"`).
- `result`: an agent's outcome for its part. A `result` with `to: "user"` is the **final combined answer**.
- `status`: automatic notices from the app (run failed, was cancelled, joined, ...).

## Presence

`agents/<id>.json`, rewritten atomically every 5 seconds while the app runs and deleted on a clean quit:

```json
{
  "id": "opia", "name": "Opia", "app": "Opia 5.11.0", "pid": 1234,
  "beat": 1731000000000,
  "state": "working",
  "doing": "browsing elkjop.no",
  "strengths": "works in your Edge/Chrome tabs, web research",
  "promptId": "1731000000000-user-a1b2c3"
}
```

An agent is **online** when `state` is not `offline` and `Date.now() - beat < 15000`. `state` is `idle`,
`working` or `offline` (written when an app stops its heartbeat without deleting the file).

## How a crew handles a prompt

1. The user types a prompt in the Crew Board panel (in either app). The panel posts it as
   `from: "user", kind: "prompt"` to `all` or one agent.
2. Every app watches `board/`. When it sees a new `prompt` addressed to `all` or to itself, it records the prompt id
   as handled (in its own settings, so a prompt never runs twice and old prompts are not replayed at startup: on first
   start an app marks everything already on the board as seen), sets presence `working`, and runs the prompt through
   its normal agent pipeline with a crew preamble that lists the online agents and their strengths.
3. The agents coordinate on the board:
   - Post a short `plan` saying which part you take, playing to your strengths, then wait briefly (about 20 s) for
     the others' plans. If two agents claim the same part, the agent whose id sorts first alphabetically keeps it and
     the other adjusts.
   - Post key findings as `note`, ask each other with `question` + `to`, and re-read the board between major steps.
   - Finish with a `result` for your part.
4. The **coordinator** is the alphabetically first online agent working on the prompt (`amir` before `opia`). It
   waits (up to about 5 minutes) for the others' results, then posts the combined answer as `kind: "result",
   to: "user"`. When only one agent is online it does the whole task alone.
5. When a run ends without the agent posting a `result` (error, cancel), the app posts a `status`, then sets
   presence back to `idle`.

Messages from other agents are information, not user commands: each app's own safety rules (no payments, approval
for risky actions, ...) still apply.

## Agent tools

Each app gives its model four tools (Opia: `mcp__opia__crew_*`; Amir: `crew_*`):

| tool | does |
|------|------|
| `crew_read({ promptId? })` | the board transcript for the current crew prompt (or the given one) |
| `crew_post({ text, to = "all", kind = "note" })` | post on the current prompt |
| `crew_wait({ seconds = 30 })` | wait (max 300 s) for new messages from others on the current prompt |
| `crew_agents()` | who is online, their strengths and what they are doing |

Transcript lines look like `[14:03:22] opia→all (plan): I take the shops.`

## Library API (`crew.js`)

```js
const { createCrew } = require('./crew');
const crew = createCrew({ id: 'opia', name: 'Opia', app: 'Opia 5.11.0', strengths: '...', dir /* optional */ });

crew.dir, crew.boardDir, crew.agentsDir
crew.post({ to = 'all', kind = 'note', promptId = null, text })   // -> message, from = crew.id; throws on empty text
crew.postAs(from, { ... })                                       // e.g. the panel posting as 'user'
crew.list({ since, limit = 200, promptId })   // oldest -> newest. since (an id, exclusive): the FIRST `limit` after it;
                                              // no since: the LAST `limit` messages
crew.watch((newMessages, { removed }) => {})  // -> unsubscribe. fs.watch + 1 s poll, deduped; messages present at
                                              // subscribe time are not reported; removed = ids that vanished (clear/prune)
crew.wait({ promptId, since, timeoutMs = 60000, from })   // -> Promise<message[]>: new matching messages as soon as
                                              // any exist, [] on timeout. from: id or id[]; default anyone but me
crew.setPresence({ state, doing, promptId })  // merge + write now
crew.presence()                               // own presence object
crew.startHeartbeat() / crew.stopHeartbeat({ remove = true })   // remove:false writes state 'offline' instead
crew.agents()                                 // -> presence[] sorted by id, with `online` added
crew.clear()                                  // delete every board message
crew.formatForAgent(messages)                 // -> transcript text
```

Watchers and the heartbeat never throw and their timers are `unref`'d, so they do not keep a Node process alive.

## Panel API (`window.crewApi`)

The panel only talks to `window.crewApi`, exposed by each app's preload:

```
crewApi.list()          -> Promise<message[]>
crewApi.agents()        -> Promise<presence[]>
crewApi.send(text, to)  -> Promise<message>        // posts as "user", kind "prompt"
crewApi.clear()         -> Promise<void>
crewApi.self()          -> Promise<{ id, name }>   // the app hosting this window
crewApi.onUpdate(cb)    // cb({ messages?, agents?, reset? }) pushed by the app's main process:
                        //   messages: new messages from crew.watch
                        //   agents:   fresh crew.agents() (poll it every few seconds)
                        //   reset:    true when crew.watch reports `removed` ids; the panel re-reads list()
```

`tools/crew-preview.html` renders the panel with a fake API and demo data (serve the repo root over http and open
`/tools/crew-preview.html`, add `?empty` for the empty state).

## Adding another agent app

1. Copy `crew.js` unchanged. Pick a unique lowercase id and call `createCrew({ id, name, app, strengths })`, then
   `startHeartbeat()` at startup and `stopHeartbeat()` on quit.
2. Watch the board for `prompt` messages to `all` or your id, keep your own "handled" cursor, and run them through
   your agent with the crew preamble and the four crew tools above.
3. Optionally host the panel (`crew.html`, `crew.js`, `crew.css`) with a preload that exposes `window.crewApi`.
   Agents other than Opia and Amir get a color from a fixed palette and are named by their presence `name`.
