// Records the Opia 5.5 demo video: real renderer code (sprite, behavior, app.js, panel) on a mock desktop.
// OPIA_DEMO_PLAYWRIGHT can point at another Playwright install whose browsers are already downloaded.
const { chromium } = require(process.env.OPIA_DEMO_PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');

const OPIA = path.resolve(__dirname, '..', '..');
const HERE = __dirname;
const OUT = path.join(require('os').tmpdir(), 'opia-demo-video');

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  // Set OPIA_DEMO_CHROME to a Chrome/Chromium binary if Playwright's own browser isn't installed
  // (or run: npx playwright install chromium).
  const browser = await chromium.launch(process.env.OPIA_DEMO_CHROME ? { executablePath: process.env.OPIA_DEMO_CHROME } : {});
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  });
  await ctx.route('http://opia.demo/**', async (route) => {
    const u = new URL(route.request().url());
    let file, body;
    if (u.pathname === '/stage.html' || u.pathname === '/mock.js') file = path.join(HERE, u.pathname);
    else file = path.join(OPIA, u.pathname);
    try { body = fs.readFileSync(file); } catch { return route.fulfill({ status: 404, body: 'nf' }); }
    if (/\/renderer\/(index|panel)\.html$/.test(u.pathname)) {
      body = body.toString().replace(/<head>/i, '<head><script src="/mock.js"></script>');
    }
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body });
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
  await page.goto('http://opia.demo/stage.html');
  await sleep(600);

  let mx = 640, my = 360;
  const move = async (x, y, ms = 600) => {
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await page.mouse.move(mx + (x - mx) * e, my + (y - my) * e);
      await sleep(ms / steps);
    }
    mx = x; my = y;
  };
  const ev = (e) => page.evaluate((e) => window.__stage.emit(e), e);
  const call = (fn, ...a) => page.evaluate(([fn, a]) => window[fn](...a), [fn, a]);
  const petBox = () => page.evaluate(() => window.__stage.getBounds());
  const petCenter = async () => { const b = await petBox(); return { x: b.x + 150, y: b.y + 190 }; };

  // ---- 1. Title card
  await sleep(2600);
  await call('card', false);
  await sleep(500);

  // ---- 2. Alive on the desktop
  await call('caption', 'Meet Opia 5.5', 'your dapper little desktop agent, in a top hat and monocle');
  await move(900, 420, 900);
  await sleep(2200);
  await call('caption', 'Never sits still', 'micro-twitches, blinks, fidgets, and eyes that follow your cursor');
  const pts = [[300, 200], [1180, 140], [700, 600], [1200, 520], [500, 400]];
  for (const [x, y] of pts) { await move(x, y, 700); await sleep(500); }
  await sleep(1200);

  await call('caption', 'Click it, pet it, pick it up', 'it squishes, giggles, blushes and dangles');
  let c = await petCenter();
  await move(c.x, c.y, 700);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
  await sleep(1300);
  c = await petCenter();
  for (let i = 0; i < 6; i++) { await move(c.x - 45, c.y - 5, 160); await move(c.x + 45, c.y + 5, 160); }
  await sleep(1600);
  c = await petCenter();
  await move(c.x, c.y, 300);
  await page.mouse.down();
  await move(c.x - 260, c.y - 220, 900);
  await move(c.x - 380, c.y - 160, 500);
  await sleep(500);
  await move(c.x - 400, c.y + 40, 300);
  await page.mouse.up();
  await sleep(1800);
  await move(640, 300, 600);
  await call('caption', 'Wanders off when it gets bored…', 'walks along the bottom of your screen');
  await sleep(4000);

  // ---- 3. Prompt button -> task
  await call('caption', 'Tap ✦ to give it a job', 'it runs on Claude Code with your own Claude login');
  await page.evaluate(() => window.__stage.setPos(980, 380));
  await sleep(700);
  c = await petCenter();
  const b = await petBox();
  await move(b.x + 170, b.y + 170, 600); // hover the pet so the prompt button shows
  await sleep(300);
  const btn = await page.frameLocator('#pet').locator('#prompt-btn').boundingBox();
  await move(btn.x + btn.width / 2, btn.y + btn.height / 2, 500);
  await page.mouse.down(); await page.mouse.up();
  await sleep(900);

  const panel = page.frameLocator('#panel');
  const ta = await panel.locator('#prompt').boundingBox();
  await move(ta.x + 60, ta.y + 20, 500);
  await page.mouse.down(); await page.mouse.up();
  const task = 'Check the Oslo weather for this weekend and save it to a note on my Desktop';
  await panel.locator('#prompt').pressSequentially(task, { delay: 28 });
  await sleep(400);
  await panel.locator('#prompt').press('Enter');
  await call('caption', null);
  await ev({ type: 'status', mood: 'thinking', text: 'Mulling it over…' });
  await sleep(1600);

  // Browser work happens in the user's own, already-open tab.
  await call('browser', true, false);
  await call('caption', 'Works right inside your own browser tab', 'through the Playwright Extension, with your logins');
  await ev({ type: 'tool', name: 'mcp__playwright__browser_type', summary: 'Typing “Oslo” into the search box' });
  await ev({ type: 'status', mood: 'browsing', text: 'Typing “Oslo”' });
  await call('ring', 'typed'); await call('typeInto', 'Oslo, Norway', 80);
  await sleep(1400);
  await call('ring', 'go'); await sleep(500);
  await ev({ type: 'tool', name: 'mcp__playwright__browser_click', summary: 'Clicking “Search”' });
  await sleep(600); await call('ring', null);
  await call('page', 1, 'skycast.example/oslo');
  await sleep(900);
  await ev({ type: 'tool', name: 'mcp__playwright__browser_snapshot', summary: 'Peering at the page' });
  await sleep(1300);
  await call('ring', 'wk');
  await ev({ type: 'tool', name: 'mcp__playwright__browser_click', summary: 'Clicking “Weekend”' });
  await sleep(1000); await call('ring', null);
  await call('page', 2, 'skycast.example/oslo/weekend');
  await sleep(800);
  await ev({ type: 'assistant', text: 'Found it! **Saturday:** 4°C, light snow 🌨  ·  **Sunday:** 6°C and sunny ☀' });
  await sleep(2200);

  // Permission card for the file write.
  await call('caption', 'Asks before touching your files or running commands', 'nothing risky happens without your OK');
  await ev({ type: 'tool', name: 'Write', summary: 'Writing oslo-weekend.txt' });
  await ev({ type: 'permission', id: 'p1', toolName: 'Write', input: { file_path: '~/Desktop/oslo-weekend.txt', content: 'Oslo this weekend\nSat: 4°C, light snow\nSun: 6°C, sunny' }, summary: 'Create this file?\n~/Desktop/oslo-weekend.txt' });
  await sleep(1800);
  const allow = panel.locator('.perm[data-id="p1"] button', { hasText: /allow/i }).first();
  const ab = await allow.boundingBox();
  if (ab) { await move(ab.x + ab.width / 2, ab.y + ab.height / 2, 700); await sleep(250); await page.mouse.down(); await page.mouse.up(); }
  else console.error('allow button not found');
  await sleep(300);
  await ev({ type: 'status', mood: 'working', text: 'Writing oslo-weekend.txt' });
  await sleep(1500);
  await call('showFile');
  await ev({ type: 'assistant', text: 'Saved the forecast to **oslo-weekend.txt** on your Desktop. Wrap up warm on Saturday! 🎩' });
  await ev({ type: 'done', result: 'Saved the forecast to oslo-weekend.txt on your Desktop. 🎩', sessionId: 'demo', costUsd: 0, durationMs: 14000 });
  await call('caption', 'Done, with a tip of the hat');
  await sleep(3800);

  // ---- 4. Background work while gaming
  await call('caption', null);
  await page.evaluate(() => window.__stage.hidePanel());
  await call('browser', false);
  await call('game', true);
  await call('caption', 'Busy playing? Opia keeps working', 'it never moves your mouse, presses your keys or steals focus');
  await page.evaluate(() => window.__stage.setPos(960, 380));
  // the player's own mouse keeps moving around the game
  const wiggle = (async () => { for (let i = 0; i < 26; i++) { await move(400 + Math.sin(i) * 300, 360 + Math.cos(i * 1.3) * 160, 220); } })();
  await sleep(1200);
  await call('browser', true, true);
  await call('page', 0, 'skycast.example/');
  await ev({ type: 'status', mood: 'browsing', text: 'Checking Tokyo flights…' });
  await sleep(1400);
  await call('typeInto', 'Tokyo, Japan', 70);
  await ev({ type: 'tool', name: 'mcp__playwright__browser_type', summary: 'Typing in your tab' });
  await sleep(1600);
  await call('page', 1, 'skycast.example/tokyo', 'Tokyo, Japan');
  await ev({ type: 'tool', name: 'mcp__playwright__browser_snapshot', summary: 'Peering at the page' });
  await sleep(2000);
  await call('caption', 'A quiet notification when it’s done', 'no windows popping up over your game');
  await ev({ type: 'done', result: 'Tokyo: 18°C and clear all weekend ☀', sessionId: 'demo', costUsd: 0, durationMs: 9000 });
  await call('toast', 'Done: Tokyo is 18°C and clear all weekend ☀');
  await wiggle;
  await sleep(1500);

  // ---- 5. End card
  await call('caption', null);
  await call('card', true, 'Opia <span>5.5</span>', 'cd opia && npm install && npm start');
  await sleep(3500);

  const vpath = await page.video().path();
  await ctx.close();
  await browser.close();
  const mp4 = path.join(OPIA, 'docs', 'opia-demo.mp4');
  require('child_process').execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', vpath, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', '30', mp4]);
  console.log('VIDEO', mp4);
})().catch((e) => { console.error(e); process.exit(1); });
