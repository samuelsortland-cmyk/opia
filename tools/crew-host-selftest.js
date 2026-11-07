#!/usr/bin/env node
'use strict';
// Self-test for main/crew-host.js (Opia's Crew Board intake + crew tools), in a temp folder.
//   node tools/crew-host-selftest.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { createCrew } = require('../main/crew');
const { CrewHost, buildPreamble } = require('../main/crew-host');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opia-crew-host-'));
const stateFile = path.join(tmp, 'userData', 'opia-crew-state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await sleep(50); }
  return false;
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e && e.stack); process.exitCode = 1; }
}

function makeHost(enqueued) {
  const crew = createCrew({ id: 'opia', name: 'Opia', app: 'Opia test', strengths: 'tabs', dir: tmp });
  const host = new CrewHost({ crew, stateFile, name: 'Opia', strengths: 'tabs', enqueue: (item) => enqueued.push(item) });
  return { crew, host };
}

(async () => {
  const user = createCrew({ id: 'amir', name: 'Amir', app: 'Amir test', strengths: 'desktop', dir: tmp });
  user.startHeartbeat();
  const old = user.postAs('user', { to: 'all', kind: 'prompt', text: 'an old prompt from before Opia ever ran' });

  let enqueued = [];
  let { crew, host } = makeHost(enqueued);

  await test('first start marks existing prompts as seen', async () => {
    host.start();
    await sleep(300);
    assert.strictEqual(enqueued.length, 0);
    assert.ok(fs.existsSync(stateFile));
    assert.ok(crew.agents().some((a) => a.id === 'opia' && a.online && a.state === 'idle'));
  });

  let prompt;
  await test('a new user prompt is enqueued once, with the preamble', async () => {
    prompt = user.postAs('user', { to: 'all', kind: 'prompt', text: 'Find three laptop deals' });
    user.postAs('user', { to: 'amir', kind: 'prompt', text: 'only for amir' });
    user.post({ kind: 'note', promptId: prompt.id, text: 'not a prompt' });
    assert.ok(await until(() => enqueued.length >= 1));
    await sleep(1500); // let the poll fallback run too
    assert.strictEqual(enqueued.length, 1);
    const it = enqueued[0];
    assert.strictEqual(it.crewPromptId, prompt.id);
    assert.ok(it.text.startsWith('[CREW BOARD]'));
    assert.ok(it.text.includes(`prompt id: ${prompt.id}`));
    assert.ok(it.text.includes('- Amir (amir): desktop'));
    assert.ok(it.text.includes('- Opia (opia) (you): tabs'));
    assert.ok(it.text.includes('The coordinator is Amir (amir)'));
    assert.ok(it.text.includes('mcp__opia__crew_post'));
    assert.ok(it.text.trim().endsWith("User's prompt: Find three laptop deals"));
    assert.strictEqual(it.display, 'Crew Board: Find three laptop deals');
    assert.ok(!enqueued.some((e) => e.text.includes(old.text)));
  });

  await test('crew tools: post / read / wait / agents during the run', async () => {
    host.runStarted(prompt.id);
    let me = crew.agents().find((a) => a.id === 'opia');
    assert.strictEqual(me.state, 'working');
    assert.strictEqual(me.promptId, prompt.id);
    host.agentEvent({ type: 'tool', summary: 'Opening elkjop.no' });
    await sleep(1100);
    host.agentEvent({ type: 'status', text: 'Reading prices' });
    assert.ok(await until(() => crew.agents().find((a) => a.id === 'opia').doing === 'Reading prices', 2500));

    let r = await host.tool('post', { text: 'I take the shops', kind: 'plan' });
    assert.strictEqual(r.text, 'Posted (plan to all).');
    const t0 = Date.now();
    r = await host.tool('wait', { seconds: 1 });
    assert.strictEqual(r.text, 'No new messages after 1 s.');
    assert.ok(Date.now() - t0 >= 900);
    setTimeout(() => user.post({ kind: 'plan', promptId: prompt.id, text: 'I take battery specs' }), 300);
    r = await host.tool('wait', { seconds: 10 });
    assert.ok(/amir→all \(plan\): I take battery specs/.test(r.text), r.text);
    r = await host.tool('read', {});
    assert.ok(r.text.includes('opia→all (plan): I take the shops'));
    assert.ok(r.text.includes('user→all (prompt): Find three laptop deals'));
    r = await host.tool('agents', {});
    assert.ok(/- Amir \(amir\): idle\. Strengths: desktop/.test(r.text), r.text);
    assert.ok(/- Opia \(opia\) \(you\): working/.test(r.text), r.text);
    r = await host.tool('post', { text: '' });
    assert.ok(r.error);
    r = await host.tool('nope', {});
    assert.ok(r.error);
  });

  await test('run end without a result posts a status and goes idle', async () => {
    host.runEnded(prompt.id, { ok: true, result: 'Found 3 deals.' });
    const st = crew.list({ promptId: prompt.id }).filter((m) => m.kind === 'status' && m.from === 'opia');
    assert.strictEqual(st.length, 1);
    assert.ok(st[0].text.startsWith('Opia finished without posting a result: Found 3 deals.'));
    const me = crew.agents().find((a) => a.id === 'opia');
    assert.strictEqual(me.state, 'idle');
    assert.strictEqual(me.promptId, null);
  });

  await test('run end after a posted result posts no status', async () => {
    const p2 = user.postAs('user', { to: 'opia', kind: 'prompt', text: 'Just you this time' });
    assert.ok(await until(() => enqueued.length === 2));
    assert.ok(enqueued[1].text.includes('sent this prompt to you alone'));
    host.runStarted(p2.id);
    await host.tool('post', { text: 'Done: 42', kind: 'result', to: 'user' });
    host.runEnded(p2.id, { ok: true, result: 'Done' });
    const msgs = crew.list({ promptId: p2.id });
    assert.ok(!msgs.some((m) => m.kind === 'status'));
    assert.ok(msgs.some((m) => m.kind === 'result' && m.to === 'user' && m.text === 'Done: 42'));
  });

  await test('stopped / error runs post status text', async () => {
    host.runEnded('1-user-aaaaaa', { stopped: true });
    host.runEnded('2-user-bbbbbb', { ok: false, error: 'Claude Code exited.' });
    const st = crew.list({}).filter((m) => m.kind === 'status').map((m) => m.text);
    assert.ok(st.includes('Opia stopped: cancelled by the user.'));
    assert.ok(st.includes('Opia stopped: Claude Code exited.'));
  });

  await test('not replayed after a restart; fresh prompts that came in while off are picked up', async () => {
    host.stop();
    assert.ok(!crew.agents().some((a) => a.id === 'opia'));
    const whileOff = user.postAs('user', { to: 'all', kind: 'prompt', text: 'sent while Opia was off' });
    enqueued = [];
    ({ crew, host } = makeHost(enqueued));
    host.start();
    await sleep(1500);
    assert.deepStrictEqual(enqueued.map((e) => e.crewPromptId), [whileOff.id]);
    host.stop();
    enqueued = [];
    ({ crew, host } = makeHost(enqueued));
    host.start();
    await sleep(1500);
    assert.strictEqual(enqueued.length, 0);
  });

  await test('window feed: messages, reset on clear, agents poll', async () => {
    const got = [];
    host.on('update', (p) => got.push(p));
    host.viewerOpened();
    user.post({ text: 'hello panel' });
    assert.ok(await until(() => got.some((p) => p.messages && p.messages.some((m) => m.text === 'hello panel'))));
    user.clear();
    assert.ok(await until(() => got.some((p) => p.reset === true)));
    assert.ok(await until(() => got.some((p) => Array.isArray(p.agents)), 4500));
    host.viewerClosed();
  });

  await test('buildPreamble: alone and coordinator variants', () => {
    const self = { id: 'amir', name: 'Amir', strengths: 'desktop', toolPrefix: '' };
    const both = buildPreamble({ self, agents: [{ id: 'opia', name: 'Opia', strengths: 'tabs', online: true }], prompt: { id: 'x', to: 'all', text: 'T' }, transcript: '-' });
    assert.ok(both.includes('You are the coordinator (Amir)'));
    assert.ok(both.includes('crew_wait about 20 seconds'));
    const alone = buildPreamble({ self, agents: [{ id: 'opia', name: 'Opia', online: false }], prompt: { id: 'x', to: 'all', text: 'T' }, transcript: '-' });
    assert.ok(alone.includes('You are the only agent online'));
    assert.ok(!alone.includes('- Opia (opia)'));
  });

  host.stop();
  user.stopHeartbeat();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
