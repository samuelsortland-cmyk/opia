'use strict';
// Crew Board: a shared message board on disk that lets separate agent apps (Opia, Amir, ...)
// running as the same user on the same PC see each other and coordinate. No server, no ports,
// no dependencies: one JSON file per message, one heartbeat file per agent.
//
//   CREW_DIR/board/<ts13>-<from>-<rand6>.json   one message (immutable, written atomically)
//   CREW_DIR/agents/<id>.json                   presence heartbeat, rewritten every 5 s
//
// CREW_DIR = env AGENT_CREW_DIR, else ~/.agent-crew. The protocol is documented in docs/CREW.md.
// This file is shared byte-for-byte between apps: keep it pure Node (CommonJS, no Electron).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KINDS = ['prompt', 'plan', 'note', 'question', 'result', 'status'];
const STATES = ['idle', 'working', 'offline'];
const MAX_TEXT = 4000;
const MAX_FILES = 500;        // prune the board back to KEEP_FILES once it grows past this
const KEEP_FILES = 400;
const BEAT_MS = 5000;
const ONLINE_MS = 15000;
const POLL_MS = 1000;
const STALE_AGENT_MS = 7 * 24 * 3600 * 1000;

const clip = (s, n) => { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const line = (s, n) => clip(String(s == null ? '' : s).replace(/\s+/g, ' '), n);
const cleanId = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
const cleanRef = (s) => { s = String(s == null ? '' : s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80); return s || null; };
const isMsgFile = (f) => f.endsWith('.json');
const noop = () => {};
let lastTs = 0;   // strictly increasing per process, so same-millisecond posts keep their order
const nextTs = () => (lastTs = Math.max(Date.now(), lastTs + 1));

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

function mkdirp(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

// write <file> atomically: tmp file + rename (retried: Windows AV/indexers briefly lock files)
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 6 || !['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(e.code)) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw e;
      }
      sleepSync(15 * (i + 1));
    }
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function unlinkQuiet(file) {
  for (let i = 0; i < 4; i++) {
    try { fs.unlinkSync(file); return true; } catch (e) {
      if (e.code === 'ENOENT') return true;
      if (!['EPERM', 'EBUSY'].includes(e.code)) return false;
      sleepSync(15 * (i + 1));
    }
  }
  return false;
}

function resolveDir(dir) {
  return path.resolve(dir || process.env.AGENT_CREW_DIR || path.join(os.homedir(), '.agent-crew'));
}

/**
 * @param {object} o
 * @param {string} o.id          short lowercase agent id ("opia", "amir")
 * @param {string} [o.name]      display name ("Opia")
 * @param {string} [o.app]       app + version ("Opia 5.11.0")
 * @param {string} [o.strengths] one line: what this agent is good at
 * @param {string} [o.dir]       board folder (default: env AGENT_CREW_DIR or ~/.agent-crew)
 */
function createCrew({ id, name, app, strengths, dir } = {}) {
  const selfId = cleanId(id);
  if (!selfId) throw new Error('createCrew: id is required ([a-z0-9_-])');
  const root = resolveDir(dir);
  const boardDir = path.join(root, 'board');
  const agentsDir = path.join(root, 'agents');
  const presenceFile = path.join(agentsDir, `${selfId}.json`);
  mkdirp(boardDir);
  mkdirp(agentsDir);

  const cache = new Map();     // filename -> parsed message (messages never change once written)
  let presence = {
    id: selfId,
    name: line(name || selfId, 40),
    app: line(app || '', 60),
    pid: process.pid,
    beat: 0,
    state: 'idle',
    doing: '',
    strengths: line(strengths || '', 300),
    promptId: null,
  };
  let beatTimer = null;

  // ---------- board ----------

  function readMsg(f) {
    if (cache.has(f)) return cache.get(f);
    const m = readJson(path.join(boardDir, f));
    if (!m || typeof m !== 'object' || typeof m.text !== 'string') return null;   // half-written / foreign: retry later
    const msg = {
      id: f.slice(0, -5),
      ts: Number(m.ts) || 0,
      from: cleanId(m.from) || 'unknown',
      to: cleanId(m.to) || 'all',
      kind: KINDS.includes(m.kind) ? m.kind : 'note',
      promptId: cleanRef(m.promptId),
      text: clip(m.text, MAX_TEXT),
    };
    cache.set(f, msg);
    return msg;
  }

  function files() {
    const names = listDir(boardDir).filter(isMsgFile).sort();
    if (cache.size > names.length + 50) {   // forget deleted files
      const live = new Set(names);
      for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    }
    return names;
  }

  function prune(names) {
    if (names.length <= MAX_FILES) return;
    for (const f of names.slice(0, names.length - KEEP_FILES)) { unlinkQuiet(path.join(boardDir, f)); cache.delete(f); }
    const now = Date.now();   // also sweep tmp files left behind by a crash
    for (const f of listDir(boardDir)) {
      if (!f.endsWith('.tmp')) continue;
      try { if (now - fs.statSync(path.join(boardDir, f)).mtimeMs > 60000) unlinkQuiet(path.join(boardDir, f)); } catch { /* ignore */ }
    }
  }

  function postAs(from, { to = 'all', kind = 'note', promptId = null, text } = {}) {
    const sender = cleanId(from);
    if (!sender) throw new Error('crew.post: invalid sender');
    const body = clip(text, MAX_TEXT);
    if (!body) throw new Error('crew.post: empty text');
    mkdirp(boardDir);
    const ts = nextTs();
    const msgId = `${String(ts).padStart(13, '0')}-${sender}-${crypto.randomBytes(3).toString('hex')}`;
    const k = KINDS.includes(kind) ? kind : 'note';
    const msg = {
      id: msgId,
      ts,
      from: sender,
      to: cleanId(to) || 'all',
      kind: k,
      // a user prompt is its own thread
      promptId: cleanRef(promptId) || (k === 'prompt' ? msgId : null),
      text: body,
    };
    const f = `${msgId}.json`;
    writeAtomic(path.join(boardDir, f), JSON.stringify(msg, null, 2));
    cache.set(f, msg);
    try { prune(files()); } catch { /* ignore */ }
    poke();
    return msg;
  }

  function post(o) { return postAs(selfId, o); }

  /**
   * Messages sorted oldest -> newest.
   * since: id (exclusive). With since, returns the FIRST `limit` messages after it (safe for paging);
   * without, the LAST `limit` messages. promptId filters to one prompt's thread.
   */
  function list({ since = null, limit = 200, promptId = null } = {}) {
    let names = files();
    if (since) { const s = `${since}.json`; names = names.filter((f) => f > s); }
    const pid = cleanRef(promptId);
    const out = [];
    for (const f of names) {
      const m = readMsg(f);
      if (!m) continue;
      if (pid && m.promptId !== pid && m.id !== pid) continue;
      out.push(m);
    }
    const n = Math.max(1, Number(limit) || 200);
    if (out.length <= n) return out;
    return since ? out.slice(0, n) : out.slice(-n);
  }

  function clear() {
    for (const f of listDir(boardDir)) if (isMsgFile(f) || f.endsWith('.tmp')) unlinkQuiet(path.join(boardDir, f));
    cache.clear();
    poke();
  }

  // ---------- watching (one shared scanner per crew, fs.watch + 1 s poll fallback) ----------

  const subs = new Set();
  let seen = null;           // Set of filenames already reported
  let fsw = null;
  let pollTimer = null;
  let pokeTimer = null;
  let lastWatchTry = 0;

  function startWatcher() {
    lastWatchTry = Date.now();
    try {
      fsw = fs.watch(boardDir, { persistent: false }, () => poke());
      fsw.on('error', () => { try { fsw.close(); } catch { /* ignore */ } fsw = null; });
    } catch { fsw = null; }
  }

  function scan() {
    if (!seen) return;
    let names;
    try { names = files(); } catch { return; }
    const live = new Set(names);
    const removed = [];
    for (const f of seen) if (!live.has(f)) { seen.delete(f); removed.push(f.slice(0, -5)); }
    const fresh = [];
    for (const f of names) {
      if (seen.has(f)) continue;
      const m = readMsg(f);
      if (!m) continue;     // not readable yet: try again next scan
      seen.add(f);
      fresh.push(m);
    }
    if (!fresh.length && !removed.length) return;
    for (const cb of [...subs]) {
      try { cb(fresh, { removed }); } catch { /* never throw from watchers */ }
    }
  }

  function poke() {
    if (!seen || pokeTimer) return;
    pokeTimer = setTimeout(() => { pokeTimer = null; scan(); }, 40);
    if (pokeTimer.unref) pokeTimer.unref();
  }

  function startScanner() {
    if (seen) return;
    seen = new Set(files());
    startWatcher();
    pollTimer = setInterval(() => {
      if (!fsw && Date.now() - lastWatchTry > 10000) { mkdirp(boardDir); startWatcher(); }
      scan();
    }, POLL_MS);
    if (pollTimer.unref) pollTimer.unref();
  }

  function stopScanner() {
    if (subs.size) return;
    if (fsw) { try { fsw.close(); } catch { /* ignore */ } fsw = null; }
    clearInterval(pollTimer); pollTimer = null;
    clearTimeout(pokeTimer); pokeTimer = null;
    seen = null;
  }

  /**
   * cb(newMessages[], { removed: id[] }) whenever messages appear (or vanish: clear/prune).
   * Messages that already exist when watching starts are not reported. Returns unsubscribe().
   */
  function watch(cb) {
    if (typeof cb !== 'function') return noop;
    startScanner();
    subs.add(cb);
    return () => { subs.delete(cb); stopScanner(); };
  }

  /**
   * Resolves with new matching messages as soon as any exist, or [] after timeoutMs.
   * promptId: only that thread. since: id; messages after it count as new even if they already exist.
   * from: id or id[] to accept (default: anyone but me).
   */
  function wait({ promptId = null, since = null, timeoutMs = 60000, from = null } = {}) {
    const pid = cleanRef(promptId);
    const froms = from == null ? null : new Set([].concat(from).map(cleanId));
    const match = (m) => (froms ? froms.has(m.from) : m.from !== selfId) && (!pid || m.promptId === pid || m.id === pid);
    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      let unsub = noop;
      const finish = (msgs) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsub();
        resolve(msgs);
      };
      unsub = watch((fresh) => {
        const hits = fresh.filter(match).filter((m) => !since || m.id > since);
        if (hits.length) finish(hits);
      });
      if (since) {
        const already = list({ since, limit: 1000 }).filter(match);
        if (already.length) return finish(already);
      }
      timer = setTimeout(() => finish([]), Math.max(0, Number(timeoutMs) || 0));
    });
  }

  // ---------- presence ----------

  function writePresence() {
    presence.beat = Date.now();
    presence.pid = process.pid;
    try { mkdirp(agentsDir); writeAtomic(presenceFile, JSON.stringify(presence, null, 2)); } catch { /* ignore */ }
  }

  function setPresence({ state, doing, promptId } = {}) {
    if (state !== undefined && STATES.includes(state)) presence.state = state;
    if (doing !== undefined) presence.doing = line(doing, 160);
    if (promptId !== undefined) presence.promptId = cleanRef(promptId);
    writePresence();
    return { ...presence };
  }

  function startHeartbeat() {
    if (presence.state === 'offline') presence.state = 'idle';
    writePresence();
    if (beatTimer) return;
    beatTimer = setInterval(() => { try { writePresence(); } catch { /* ignore */ } }, BEAT_MS);
    if (beatTimer.unref) beatTimer.unref();
  }

  function stopHeartbeat({ remove = true } = {}) {
    clearInterval(beatTimer); beatTimer = null;
    if (remove) { unlinkQuiet(presenceFile); return; }
    presence.state = 'offline';
    presence.promptId = null;
    writePresence();
  }

  function agents() {
    const now = Date.now();
    const out = [];
    for (const f of listDir(agentsDir)) {
      if (!isMsgFile(f)) continue;
      const p = readJson(path.join(agentsDir, f));
      if (!p || typeof p !== 'object') continue;
      const aid = cleanId(p.id) || cleanId(f.slice(0, -5));
      const beat = Number(p.beat) || 0;
      if (!aid || now - beat > STALE_AGENT_MS) continue;
      const state = STATES.includes(p.state) ? p.state : 'idle';
      const online = state !== 'offline' && now - beat < ONLINE_MS;
      out.push({
        id: aid,
        name: line(p.name || aid, 40),
        app: line(p.app || '', 60),
        pid: Number(p.pid) || 0,
        beat,
        state: online ? state : 'offline',
        doing: line(p.doing || '', 160),
        strengths: line(p.strengths || '', 300),
        promptId: cleanRef(p.promptId),
        online,
      });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // ---------- text for a model ----------

  function formatForAgent(messages) {
    const msgs = [].concat(messages || []).filter(Boolean);
    if (!msgs.length) return 'The crew board has no messages for this prompt yet.';
    const pad = (n) => String(n).padStart(2, '0');
    return msgs.map((m) => {
      const d = new Date(m.ts || 0);
      const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      return `[${t}] ${m.from}→${m.to} (${m.kind}): ${String(m.text || '').trim()}`;
    }).join('\n');
  }

  return {
    id: selfId,
    dir: root,
    boardDir,
    agentsDir,
    post,
    postAs,
    list,
    watch,
    wait,
    clear,
    setPresence,
    presence: () => ({ ...presence }),
    startHeartbeat,
    stopHeartbeat,
    agents,
    formatForAgent,
  };
}

module.exports = { createCrew, resolveDir, KINDS };
