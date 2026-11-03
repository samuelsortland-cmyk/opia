#!/usr/bin/env node
'use strict';
// Self-test for the Opia agent backend.
//   node opia/main/tools/selftest.js          # fake CLI only (no network, no login)
//   node opia/main/tools/selftest.js --real   # also one tiny real `claude -p` run

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { OpiaAgent, checkClaude } = require('../agent');

const FAKE = path.join(__dirname, 'fake-claude.js');
fs.chmodSync(FAKE, 0o755);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opia-test-'));

function makeAgent(settings, answer) {
  const events = [];
  const asked = [];
  const agent = new OpiaAgent({
    userDataDir: tmp,
    getSettings: () => ({ claudePath: FAKE, cwd: tmp, permissionMode: 'ask', ...settings }),
    onPermissionRequest: async (req) => { asked.push(req); return answer(req); },
  });
  agent.on('event', (e) => events.push(e));
  return { agent, events, asked };
}

(async () => {
  // 1. checkClaude with fake + missing binary
  assert.deepStrictEqual((await checkClaude(FAKE)).installed, true);
  assert.strictEqual((await checkClaude({ claudePath: FAKE })).loggedIn, true);
  const missing = await checkClaude('/nope/claude');
  assert.strictEqual(missing.installed, false);
  console.log('ok checkClaude', missing.error.slice(0, 40));

  // 2. ask mode, user allows -> browser auto-allowed, Bash prompted
  {
    const { agent, events, asked } = makeAgent({}, () => ({ allow: true }));
    const r = await agent.run('find cats');
    assert.ok(r.ok, JSON.stringify(events));
    assert.strictEqual(asked.length, 1);
    assert.strictEqual(asked[0].toolName, 'Bash');
    assert.match(asked[0].summary, /ls ~/);
    assert.ok(events.find((e) => e.type === 'permission' && e.toolName === 'Bash'));
    const perms = JSON.parse(r.result.slice(6));
    assert.strictEqual(perms.mcp__playwright__browser_click.behavior, 'allow');
    assert.strictEqual(perms.Bash.behavior, 'allow');
    assert.deepStrictEqual(perms.Bash.updatedInput, { command: 'ls ~', description: 'List home folder' });
    assert.ok(events.find((e) => e.type === 'status' && e.mood === 'browsing' && e.text === 'Opening example.com'));
    assert.ok(events.find((e) => e.type === 'tool' && e.summary === 'List home folder'));
    assert.ok(events.find((e) => e.type === 'assistant' && e.text === 'You said: find cats'));
    const done = events.find((e) => e.type === 'done');
    assert.strictEqual(done.sessionId, 'fake-session-1');
    assert.strictEqual(done.costUsd, 0.01);
    assert.strictEqual(agent.sessionId, 'fake-session-1');
    console.log('ok ask/allow, events:', events.map((e) => e.type + (e.mood ? ':' + e.mood : '')).join(' '));

    // 3. follow-up resumes the session; stale session falls back to a fresh one
    agent.sessionId = 'stale';
    const r2 = await agent.run('again');
    assert.ok(r2.ok);
    assert.strictEqual(agent.sessionId, 'fake-session-1');
    console.log('ok stale-session fallback');
    agent.dispose();
  }

  // 4. deny
  {
    const { agent } = makeAgent({}, () => ({ allow: false }));
    const r = await agent.run('rm stuff');
    const perms = JSON.parse(r.result.slice(6));
    assert.strictEqual(perms.Bash.behavior, 'deny');
    assert.ok(perms.Bash.message);
    console.log('ok deny');
    agent.dispose();
  }

  // 5. auto mode never asks
  {
    const { agent, asked } = makeAgent({ permissionMode: 'auto' }, () => ({ allow: false }));
    const r = await agent.run('go');
    assert.strictEqual(asked.length, 0);
    assert.strictEqual(JSON.parse(r.result.slice(6)).Bash.behavior, 'allow');
    console.log('ok auto mode');
    agent.dispose();
  }

  // 6. busy guard + cancel while waiting on a permission prompt
  {
    const { agent, events } = makeAgent({}, () => new Promise(() => {})); // never answers
    const p = agent.run('long task');
    await new Promise((res) => setTimeout(res, 800));
    assert.strictEqual(agent.busy, true);
    await agent.run('second');
    assert.ok(events.find((e) => e.type === 'error' && /busy/i.test(e.message)));
    const t = Date.now();
    agent.cancel();
    await p;
    assert.strictEqual(agent.busy, false);
    assert.ok(events.find((e) => e.type === 'done' && e.result === '(stopped)'), JSON.stringify(events.slice(-3)));
    console.log(`ok cancel (${Date.now() - t}ms)`);
    agent.dispose();
  }

  // 7. not logged in
  {
    process.env.FAKE_LOGGED_OUT = '1';
    const { agent, events } = makeAgent({}, () => ({ allow: true }));
    await agent.run('hi');
    delete process.env.FAKE_LOGGED_OUT;
    const err = events.find((e) => e.type === 'error');
    assert.match(err.message, /log in/);
    console.log('ok login error:', err.message.slice(0, 60));
    agent.dispose();
  }

  // 8. missing binary on run
  {
    const { agent, events } = makeAgent({ claudePath: '/nope/claude' }, () => ({ allow: true }));
    await agent.run('hi');
    assert.match(events.find((e) => e.type === 'error').message, /not found/i);
    console.log('ok missing binary on run');
    agent.dispose();
  }

  // 9. real CLI (optional)
  if (process.argv.includes('--real')) {
    console.log('real:', await checkClaude('claude'));
    const events = [];
    const agent = new OpiaAgent({
      userDataDir: tmp,
      getSettings: () => ({ cwd: tmp, permissionMode: 'ask' }),
      onPermissionRequest: async (req) => { console.log('  permission asked:', req.toolName, req.summary); return { allow: true }; },
    });
    agent.on('event', (e) => { events.push(e); console.log('  ev', JSON.stringify(e).slice(0, 160)); });
    const r = await agent.run('Use the Bash tool to run `echo opia-ok`, then reply with exactly what it printed.');
    console.log('real run ok:', r.ok, 'session:', agent.sessionId);
    const r2 = await agent.run('What did the command print? One word.');
    console.log('real follow-up ok:', r2.ok, r2.result);
    agent.dispose();
  }

  console.log('ALL OK');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
