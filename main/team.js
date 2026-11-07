'use strict';
// Opia's team: when a long task splits into independent parts, the main Opia (#1) calls in
// helper Opias (#2, #3, ...). Each helper is its own Claude Code process working in parallel
// (own hidden browser), they coordinate on a shared team board, and the main Opia gets all
// results back to combine.

const { EventEmitter } = require('events');

const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

class Team extends EventEmitter {
  /**
   * @param {object} o
   * @param {(helper:{index,name}) => import('./agent').OpiaAgent} o.createAgent  makes a helper agent
   * @param {() => object} o.getSettings
   */
  constructor({ createAgent, getSettings }) {
    super();
    this.createAgent = createAgent;
    this.getSettings = getSettings;
    this.helpers = [];   // { index, name, task, state, last, result, agent }
    this.board = [];     // { from, text, at }
    this.goal = '';
    this.running = false;
  }

  snapshot() {
    return {
      running: this.running,
      goal: this.goal,
      board: this.board.length,
      helpers: this.helpers.map(({ index, name, state, last }) => ({ index, name, state, last })),
    };
  }
  _update() { this.emit('update', this.snapshot()); }

  // ---------- requests from the agents' team tools ----------
  async handle({ role, helper, action, args }) {
    switch (action) {
      case 'spawn':
        if (role !== 'lead') return { error: 'Only the main Opia can call in helpers.' };
        return { text: await this.spawn(args.goal, args.helpers) };
      case 'board_read':
        return { text: this.boardText() };
      case 'board_post': {
        const from = role === 'helper' && helper ? `Opia #${helper.index} (${helper.name})` : 'Main Opia (#1)';
        const text = clip(args.note, 800);
        if (!text) return { error: 'Empty note.' };
        this.board.push({ from, text, at: Date.now() });
        if (this.board.length > 200) this.board.shift();
        this._update();
        return { text: 'Posted.' };
      }
      default:
        return { error: `Unknown team action: ${action}` };
    }
  }

  boardText() {
    if (!this.board.length) return 'The team board is empty so far.';
    return this.board.map((b) => `- ${b.from}: ${b.text}`).join('\n');
  }

  // ---------- running a team ----------
  async spawn(goal, list) {
    const s = this.getSettings() || {};
    if (s.helpersEnabled === false) return 'Helpers are turned off in Opia\'s settings. Do the task yourself.';
    if (this.running) return 'A team is already working. Wait for it to finish.';
    const max = Math.max(1, Math.min(5, Number(s.maxHelpers) || 3));
    const tasks = (Array.isArray(list) ? list : []).filter((t) => t && t.task).slice(0, max);
    if (!tasks.length) return 'No helper tasks were given.';

    this.running = true;
    this.goal = clip(goal, 300);
    this.board = [];
    this.helpers = tasks.map((t, i) => ({ index: i + 2, name: clip(t.name || `Part ${i + 1}`, 32), task: String(t.task), state: 'starting', last: 'Getting ready…', result: '' }));
    this.emit('start', this.snapshot());
    this._update();

    const roster = this.helpers.map((h) => `- Opia #${h.index} "${h.name}": ${clip(h.task, 160)}`).join('\n');
    await Promise.all(this.helpers.map((h) => this._run(h, roster)));

    this.running = false;
    this.emit('finish', this.snapshot());
    this._update();
    const lines = this.helpers.map((h) => `### Opia #${h.index} — ${h.name} (${h.state})\n${h.result || '(no result)'}`);
    return `All ${this.helpers.length} helpers have finished.\n\n${lines.join('\n\n')}\n\n### Team board\n${this.boardText()}`;
  }

  async _run(h, roster) {
    const agent = this.createAgent({ index: h.index, name: h.name });
    h.agent = agent;
    let lastText = '';
    agent.on('event', (ev) => {
      if (ev.type === 'status' && ev.text) h.last = clip(ev.text, 90);
      if (ev.type === 'tool') h.last = clip(ev.summary || ev.name, 90);
      if (ev.type === 'assistant' && ev.text) lastText = ev.text;
      if (ev.type === 'permission') { h.state = 'waiting'; h.last = 'Waiting for your OK'; }
      if (ev.type === 'permission-resolved' || (ev.type === 'status' && h.state === 'waiting')) h.state = 'working';
      if (h.state === 'starting' && (ev.type === 'tool' || ev.type === 'assistant')) h.state = 'working';
      this.emit('helper-event', h, ev);
      this._update();
    });
    const prompt = `Overall goal (from the main Opia): ${this.goal}\n\nThe team:\n${roster}\n\nYOUR part, as Opia #${h.index} "${h.name}":\n${h.task}`;
    h.state = 'working';
    this._update();
    let r = { ok: false };
    try { r = await agent.run(prompt); } catch (e) { h.last = clip(e.message, 90); }
    if (h.state !== 'stopped') {
      h.state = r.ok ? 'done' : 'error';
      h.last = r.ok ? 'Done ✓' : (h.last || 'Hit a snag');
    }
    h.result = clip(r.result || lastText || '', 6000);
    try { agent.dispose(); } catch (_) {}
    h.agent = null;
    this._update();
  }

  /** Stop every helper now (Stop button, turning Opia off). */
  cancelAll() {
    for (const h of this.helpers) {
      if (h.agent) { h.state = 'stopped'; h.last = 'Stopped'; try { h.agent.cancel(); } catch (_) {} }
    }
    this._update();
  }
}

module.exports = { Team };
