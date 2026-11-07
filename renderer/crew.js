'use strict';
// Crew Board panel: one prompt box for every agent app on this PC (Opia, Amir, ...).
// Talks only to window.crewApi (each app's preload): list, agents, send, clear, onUpdate, self.
// The same file runs in every app, so nothing here is app-specific.

(() => {
  // window.parent fallback: lets tools/crew-preview.html host this page in an iframe with a fake API
  const api = window.crewApi || (() => { try { return window.parent !== window ? window.parent.crewApi : null; } catch { return null; } })();
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const KNOWN = {
    user: { name: 'You', color: null },
    opia: { name: 'Opia', color: '#f08a24' },
    amir: { name: 'Amir', color: '#3b82f6' },
  };
  const PALETTE = ['#10a37f', '#a855f7', '#e11d74', '#0ea5b7', '#ca8a04', '#64748b', '#16a34a', '#dc4c2c'];
  const KIND_LABEL = { prompt: 'prompt', plan: 'plan', note: 'note', question: 'question', result: 'result', status: 'status' };

  const state = {
    messages: new Map(),   // id -> message
    agents: [],            // presence[]
    self: null,            // { id, name }
    sending: false,
    clearArmed: null,      // timer while "click again to clear" is showing
  };

  // ---------- helpers ----------

  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const agentOf = (id) => state.agents.find((a) => a.id === id);
  function nameOf(id) {
    if (id === 'all') return 'Everyone';
    if (id === 'user') return 'You';
    const a = agentOf(id);
    if (a && a.name) return a.name;
    if (KNOWN[id]) return KNOWN[id].name;
    return id ? id.charAt(0).toUpperCase() + id.slice(1) : '?';
  }
  function colorOf(id) {
    if (KNOWN[id]) return KNOWN[id].color;
    return PALETTE[hash(id) % PALETTE.length];
  }
  function tint(node, id) {
    const c = colorOf(id);
    if (c) node.style.setProperty('--agent', c);
  }
  const pad = (n) => String(n).padStart(2, '0');
  function timeOf(ts) {
    const d = new Date(ts || 0);
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return t;
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t}`;
  }
  function agoOf(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  function showError(msg) {
    const e = $('error');
    e.textContent = msg || '';
    e.hidden = !msg;
    if (msg) setTimeout(() => { if (e.textContent === msg) e.hidden = true; }, 6000);
  }
  function avatar(id) {
    const a = el('span', 'avatar', nameOf(id).charAt(0).toUpperCase());
    tint(a, id);
    return a;
  }

  // ---------- agents ----------

  function renderAgents() {
    const box = $('agents');
    box.textContent = '';
    const list = state.agents.slice().sort((a, b) => (b.online - a.online) || (a.id < b.id ? -1 : 1));
    if (!list.length) {
      box.appendChild(el('span', 'agents-empty', 'No agents online yet. Open an agent app to join.'));
    }
    for (const a of list) {
      const chip = el('div', `chip ${a.online ? 'on' : 'off'} ${a.online && a.state === 'working' ? 'working' : ''}`);
      tint(chip, a.id);
      chip.appendChild(el('span', 'dot'));
      const body = el('div', 'chip-body');
      body.appendChild(el('span', 'chip-name', a.name || nameOf(a.id)));
      let sub = a.online ? (a.state === 'working' ? (a.doing || 'working') : (a.doing || 'ready')) : `offline · ${agoOf(a.beat)}`;
      body.appendChild(el('span', 'chip-sub', sub));
      chip.appendChild(body);
      const tip = [a.name || a.id, a.app, a.online ? a.state : 'offline', a.doing, a.strengths && `Good at: ${a.strengths}`].filter(Boolean).join('\n');
      chip.title = tip;
      box.appendChild(chip);
    }
    renderTo();
  }

  function renderTo() {
    const sel = $('to');
    const prev = sel.value || 'all';
    const ids = new Set(['opia', 'amir']);
    for (const a of state.agents) ids.add(a.id);
    const opts = [['all', 'Everyone']].concat([...ids].sort().map((id) => {
      const a = agentOf(id);
      return [id, nameOf(id) + (a && !a.online ? ' (offline)' : '')];
    }));
    const sig = JSON.stringify(opts);
    if (sel.dataset.sig === sig) return;
    sel.dataset.sig = sig;
    sel.textContent = '';
    for (const [v, label] of opts) {
      const o = el('option', null, label);
      o.value = v;
      sel.appendChild(o);
    }
    sel.value = opts.some(([v]) => v === prev) ? prev : 'all';
  }

  // ---------- feed ----------

  function groupsOf(msgs) {
    const groups = new Map();   // key -> { prompt, items[], last }
    for (const m of msgs) {
      const key = m.promptId || m.id && m.kind === 'prompt' && m.id || '_general';
      let g = groups.get(key);
      if (!g) { g = { key, prompt: null, items: [], first: m.ts, last: m.ts }; groups.set(key, g); }
      if (m.kind === 'prompt' && m.id === key) g.prompt = m;
      else g.items.push(m);
      g.last = Math.max(g.last, m.ts);
      g.first = Math.min(g.first, m.ts);
    }
    return [...groups.values()].sort((a, b) => a.first - b.first);
  }

  function messageNode(m) {
    const final = m.kind === 'result' && m.to === 'user';
    const row = el('div', `msg kind-${m.kind}${final ? ' final' : ''}`);
    tint(row, m.from);
    if (m.kind === 'status') {
      row.appendChild(el('span', 'status-dot'));
      const t = el('span', 'status-text');
      t.appendChild(el('b', null, nameOf(m.from)));
      t.appendChild(document.createTextNode(' ' + m.text));
      row.appendChild(t);
      row.appendChild(el('time', null, timeOf(m.ts)));
      return row;
    }
    row.appendChild(avatar(m.from));
    const body = el('div', 'msg-body');
    const head = el('div', 'msg-head');
    head.appendChild(el('span', 'who', nameOf(m.from)));
    if (m.to && m.to !== 'all') head.appendChild(el('span', 'to-tag', `→ ${nameOf(m.to)}`));
    head.appendChild(el('span', `badge b-${m.kind}`, final ? 'final answer' : (KIND_LABEL[m.kind] || m.kind)));
    head.appendChild(el('time', null, timeOf(m.ts)));
    body.appendChild(head);
    body.appendChild(el('div', 'text', m.text));
    row.appendChild(body);
    return row;
  }

  function workingNode(agent) {
    const row = el('div', 'msg working-row');
    tint(row, agent.id);
    row.appendChild(avatar(agent.id));
    const b = el('div', 'typing');
    b.appendChild(el('span', 'who', agent.name || nameOf(agent.id)));
    const dots = el('span', 'dots');
    dots.append(el('i'), el('i'), el('i'));
    b.appendChild(dots);
    if (agent.doing) b.appendChild(el('span', 'doing', agent.doing));
    row.appendChild(b);
    return row;
  }

  function renderFeed() {
    const feed = $('feed');
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    const box = $('groups');
    box.textContent = '';
    const msgs = [...state.messages.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    $('empty').hidden = msgs.length > 0;
    for (const g of groupsOf(msgs)) {
      const sec = el('section', 'group');
      if (g.prompt) {
        const p = g.prompt;
        const pr = el('div', 'prompt');
        const meta = el('div', 'prompt-meta');
        meta.appendChild(el('span', null, p.to === 'all' ? 'To everyone' : `To ${nameOf(p.to)}`));
        meta.appendChild(el('time', null, timeOf(p.ts)));
        pr.appendChild(meta);
        pr.appendChild(el('div', 'bubble', p.text));
        sec.appendChild(pr);
      } else if (g.key === '_general') {
        sec.appendChild(el('div', 'group-label', 'General'));
      } else {
        sec.appendChild(el('div', 'group-label', 'Earlier prompt'));
      }
      const thread = el('div', 'thread');
      for (const m of g.items) thread.appendChild(messageNode(m));
      for (const a of state.agents) {
        if (a.online && a.state === 'working' && a.promptId && a.promptId === g.key) thread.appendChild(workingNode(a));
      }
      if (thread.childNodes.length) sec.appendChild(thread);
      box.appendChild(sec);
    }
    if (nearBottom) feed.scrollTop = feed.scrollHeight;
  }

  function addMessages(msgs) {
    let changed = false;
    for (const m of msgs || []) {
      if (!m || !m.id || state.messages.has(m.id)) continue;
      state.messages.set(m.id, m);
      changed = true;
    }
    return changed;
  }

  async function reload() {
    try {
      const msgs = await api.list();
      state.messages.clear();
      addMessages(msgs);
      renderFeed();
    } catch (e) { showError(`Could not read the board: ${e && e.message || e}`); }
  }

  // ---------- composer ----------

  const input = $('input');
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    $('btn-send').disabled = state.sending || !input.value.trim();
  }

  async function send() {
    const text = input.value.trim();
    if (!text || state.sending) return;
    state.sending = true;
    autosize();
    try {
      const m = await api.send(text, $('to').value || 'all');
      input.value = '';
      if (m && addMessages([m])) renderFeed();
      const feed = $('feed');
      feed.scrollTop = feed.scrollHeight;
      showError('');
    } catch (e) {
      showError(`Could not send: ${e && e.message || e}`);
    } finally {
      state.sending = false;
      autosize();
      input.focus();
    }
  }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  $('btn-send').addEventListener('click', send);

  const clearBtn = $('btn-clear');
  clearBtn.addEventListener('click', async () => {
    if (!state.clearArmed) {
      clearBtn.classList.add('armed');
      clearBtn.textContent = 'Click again to clear';
      state.clearArmed = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    try {
      await api.clear();
      state.messages.clear();
      renderFeed();
    } catch (e) { showError(`Could not clear: ${e && e.message || e}`); }
  });
  function disarm() {
    clearTimeout(state.clearArmed);
    state.clearArmed = null;
    clearBtn.classList.remove('armed');
    clearBtn.textContent = 'Clear board';
  }

  // ---------- start ----------

  if (!api) {
    showError('Crew Board is not connected (window.crewApi is missing).');
    renderAgents();
    renderFeed();
    return;
  }

  api.onUpdate((u) => {
    if (!u) return;
    if (u.reset) { reload(); }
    let feedDirty = false;
    if (Array.isArray(u.agents)) { state.agents = u.agents; renderAgents(); feedDirty = true; }
    if (Array.isArray(u.messages) && addMessages(u.messages)) feedDirty = true;
    if (feedDirty && !u.reset) renderFeed();
  });

  (async () => {
    try {
      const me = await api.self();
      if (me && me.id) {
        state.self = me;
        $('host-line').textContent = `opened from ${me.name || nameOf(me.id)}`;
      }
    } catch { /* optional */ }
    try { state.agents = (await api.agents()) || []; } catch { state.agents = []; }
    renderAgents();
    await reload();
    autosize();
    input.focus();
  })();

  // keep "offline · 3 min ago" and day labels fresh
  setInterval(renderAgents, 30000);
})();
