'use strict';
// Self-test for main/crew.js (the shared Crew Board library). Plain node, no deps:
//   node tools/crew-selftest.js
// Uses a throwaway board folder; exits non-zero on the first failure.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-selftest-'));
process.env.AGENT_CREW_DIR = dir;
const { createCrew, resolveDir } = require('../main/crew');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(['ok', name]); console.log(`ok   ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push(['FAIL', name]); console.log(`FAIL ${name}\n     ${e && e.stack || e}`); }
}

(async () => {
  const opia = createCrew({ id: 'opia', name: 'Opia', app: 'Opia test', strengths: 'browser tabs, web research' });
  const amir = createCrew({ id: 'Amir', name: 'Amir', app: 'Amir test', strengths: 'PC desktop, files, shell', dir });

  await test('dir resolves from AGENT_CREW_DIR and option', () => {
    assert.strictEqual(opia.dir, path.resolve(dir));
    assert.strictEqual(amir.dir, path.resolve(dir));
    assert.strictEqual(resolveDir(), path.resolve(dir));
    assert.strictEqual(amir.id, 'amir');
    assert.ok(fs.existsSync(path.join(dir, 'board')) && fs.existsSync(path.join(dir, 'agents')));
  });

  let prompt;
  await test('postAs user prompt: id/promptId/format/filename', () => {
    prompt = opia.postAs('user', { to: 'all', kind: 'prompt', text: '  Find a cheap flight to Oslo  ' });
    assert.match(prompt.id, /^\d{13}-user-[0-9a-f]{6}$/);
    assert.strictEqual(prompt.promptId, prompt.id);
    assert.strictEqual(prompt.text, 'Find a cheap flight to Oslo');
    assert.strictEqual(prompt.from, 'user');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'board', `${prompt.id}.json`), 'utf8'));
    assert.deepStrictEqual(onDisk, prompt);
  });

  await test('post validates and clips', () => {
    assert.throws(() => opia.post({ text: '   ' }));
    const m = opia.post({ to: 'AMIR!!', kind: 'weird', promptId: prompt.id, text: 'x'.repeat(5000) });
    assert.strictEqual(m.from, 'opia');
    assert.strictEqual(m.to, 'amir');
    assert.strictEqual(m.kind, 'note');
    assert.strictEqual(m.text.length, 4000);
    const n = opia.post({ text: 'no prompt' });
    assert.strictEqual(n.promptId, null);
    assert.strictEqual(n.to, 'all');
  });

  await test('list from the other instance: order, since, limit, promptId', async () => {
    await delay(2);
    const plan = amir.post({ kind: 'plan', promptId: prompt.id, text: 'I take the desktop part' });
    const all = amir.list();
    assert.strictEqual(all.length, 4);
    assert.deepStrictEqual(all.map((m) => m.id), all.map((m) => m.id).slice().sort());
    assert.strictEqual(all[0].id, prompt.id);
    assert.strictEqual(all[3].id, plan.id);
    const since = amir.list({ since: prompt.id });
    assert.strictEqual(since.length, 3);
    assert.ok(!since.some((m) => m.id === prompt.id));
    assert.deepStrictEqual(amir.list({ limit: 2 }).map((m) => m.id), all.slice(-2).map((m) => m.id));
    assert.deepStrictEqual(amir.list({ since: prompt.id, limit: 1 }).map((m) => m.id), [all[1].id]);
    const thread = opia.list({ promptId: prompt.id });
    assert.deepStrictEqual(thread.map((m) => m.kind), ['prompt', 'note', 'plan']);
  });

  await test('readers ignore *.tmp and bad JSON', () => {
    fs.writeFileSync(path.join(dir, 'board', '9999999999999-x-aaaaaa.json.tmp'), '{"half');
    fs.writeFileSync(path.join(dir, 'board', '0000000000001-bad-bbbbbb.json'), '{not json');
    assert.strictEqual(opia.list().length, 4);
    fs.unlinkSync(path.join(dir, 'board', '0000000000001-bad-bbbbbb.json'));
  });

  await test('watch reports new messages once, from another instance', async () => {
    const got = [];
    const stop = opia.watch((msgs) => got.push(...msgs));
    const a = amir.post({ promptId: prompt.id, text: 'note 1' });
    const b = amir.post({ promptId: prompt.id, text: 'note 2' });
    for (let i = 0; i < 40 && got.length < 2; i++) await delay(50);
    await delay(1200);  // a poll tick later: still no duplicates
    stop();
    assert.deepStrictEqual(got.map((m) => m.id), [a.id, b.id]);
    const after = amir.post({ text: 'after unsubscribe' });
    await delay(1200);
    assert.ok(!got.some((m) => m.id === after.id));
  });

  await test('watch throwing callback does not break others', async () => {
    let n = 0;
    const s1 = opia.watch(() => { throw new Error('boom'); });
    const s2 = opia.watch((msgs) => { n += msgs.length; });
    amir.post({ text: 'ping' });
    for (let i = 0; i < 40 && !n; i++) await delay(50);
    s1(); s2();
    assert.strictEqual(n, 1);
  });

  await test('wait resolves on a new matching message (ignores own + other prompts)', async () => {
    const t0 = Date.now();
    const p = amir.wait({ promptId: prompt.id, timeoutMs: 5000 });
    await delay(100);
    amir.post({ promptId: prompt.id, text: 'my own note' });       // own: ignored
    opia.post({ text: 'unrelated thread' });                        // other prompt: ignored
    await delay(100);
    const res = opia.post({ kind: 'result', promptId: prompt.id, text: 'Opia result' });
    const got = await p;
    assert.deepStrictEqual(got.map((m) => m.id), [res.id]);
    assert.ok(Date.now() - t0 < 3000, 'resolved promptly');
  });

  await test('wait resolves [] on timeout', async () => {
    const t0 = Date.now();
    const got = await opia.wait({ promptId: prompt.id, timeoutMs: 400 });
    assert.deepStrictEqual(got, []);
    assert.ok(Date.now() - t0 >= 380);
  });

  await test('wait with since returns already-posted messages immediately; from filter', async () => {
    const thread = opia.list({ promptId: prompt.id });
    const got = await opia.wait({ promptId: prompt.id, since: prompt.id, timeoutMs: 3000, from: 'amir' });
    assert.ok(got.length >= 1 && got.every((m) => m.from === 'amir'));
    assert.ok(got.length < thread.length);
    const none = await opia.wait({ since: thread[thread.length - 1].id, timeoutMs: 200, from: ['nobody'] });
    assert.deepStrictEqual(none, []);
  });

  await test('presence: online, merge, offline, stale, removal', async () => {
    opia.startHeartbeat();
    amir.startHeartbeat();
    amir.setPresence({ state: 'working', doing: 'checking   files', promptId: prompt.id });
    let ag = opia.agents();
    assert.deepStrictEqual(ag.map((a) => a.id), ['amir', 'opia']);
    assert.ok(ag.every((a) => a.online));
    const a = ag[0];
    assert.strictEqual(a.state, 'working');
    assert.strictEqual(a.doing, 'checking files');
    assert.strictEqual(a.promptId, prompt.id);
    assert.strictEqual(a.name, 'Amir');
    assert.strictEqual(a.strengths, 'PC desktop, files, shell');
    amir.setPresence({ state: 'idle' });                 // merge keeps the rest
    assert.strictEqual(opia.agents()[0].doing, 'checking files');

    // a beat older than 15 s counts as offline
    const f = path.join(dir, 'agents', 'amir.json');
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, JSON.stringify({ ...p, beat: Date.now() - 20000 }));
    ag = opia.agents();
    assert.strictEqual(ag[0].online, false);
    assert.strictEqual(ag[0].state, 'offline');

    amir.stopHeartbeat({ remove: false });
    ag = opia.agents();
    assert.strictEqual(ag[0].online, false);
    assert.strictEqual(ag[0].state, 'offline');

    amir.startHeartbeat();
    assert.strictEqual(opia.agents()[0].online, true);
    amir.stopHeartbeat();
    assert.deepStrictEqual(opia.agents().map((x) => x.id), ['opia']);
    opia.stopHeartbeat();
    assert.deepStrictEqual(opia.agents(), []);
  });

  await test('formatForAgent', () => {
    const txt = opia.formatForAgent(opia.list({ promptId: prompt.id }));
    const lines = txt.split('\n');
    assert.match(lines[0], /^\[\d\d:\d\d:\d\d\] user→all \(prompt\): Find a cheap flight to Oslo$/);
    assert.ok(lines.some((l) => /opia→all \(result\): Opia result$/.test(l)));
    assert.ok(/no messages/.test(opia.formatForAgent([])));
  });

  await test('clear empties the board and watchers see removals', async () => {
    let removed = [];
    const stop = amir.watch((fresh, info) => { removed = removed.concat(info.removed); });
    const before = opia.list({ limit: 1000 }).length;
    opia.clear();
    assert.deepStrictEqual(opia.list(), []);
    assert.deepStrictEqual(amir.list(), []);
    for (let i = 0; i < 40 && removed.length < before; i++) await delay(50);
    stop();
    assert.strictEqual(removed.length, before);
  });

  await test('board is capped (prunes oldest past 500)', () => {
    for (let i = 0; i < 505; i++) opia.post({ text: `bulk ${i}` });
    const n = fs.readdirSync(path.join(dir, 'board')).filter((f) => f.endsWith('.json')).length;
    assert.ok(n <= 500 && n >= 400, `files: ${n}`);
    const last = opia.list({ limit: 1 })[0];
    assert.strictEqual(last.text, 'bulk 504');
    opia.clear();
  });

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  const failed = results.filter((r) => r[0] !== 'ok');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
