// Opia 5.5 Reel stage: drives the real Opia pet + chat panel through short scenes.
// Each window.reel.* scene function returns a promise that resolves when the scene is done.
(function () {
  const W = 540, H = 960, TASK = 34, P = 190;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const petEl = $('pet'), panelEl = $('panel');
  const pos = { x: W - P - 12, y: H - TASK - P };
  const cursor = { x: 270, y: 600 };
  const listeners = [];
  let allowMove = false;

  function place() { petEl.style.left = pos.x + 'px'; petEl.style.top = pos.y + 'px'; }
  place();

  const hub = window.__stage = {
    moveBy(dx, dy) { if (allowMove) { pos.x += dx; pos.y += dy; place(); } },
    getBounds: () => ({ x: pos.x, y: pos.y, width: P, height: P }),
    getWorkArea: () => ({ x: 0, y: 0, width: W, height: H - TASK }),
    getCursor: () => ({ x: Math.round(cursor.x), y: Math.round(cursor.y) }),
    onAgentEvent(cb) { listeners.push(cb); return () => {}; },
    emit(ev) { listeners.forEach((cb) => { try { cb(ev); } catch (e) { console.error(e); } }); },
    prompts: [],
  };
  const emit = hub.emit;

  // ---------- cursor ----------
  const cur = $('cur');
  function drawCur() { cur.style.left = cursor.x + 'px'; cur.style.top = cursor.y + 'px'; }
  async function moveCur(x, y, ms = 500) {
    const x0 = cursor.x, y0 = cursor.y, t0 = performance.now();
    cur.classList.add('on');
    while (true) {
      const k = Math.min(1, (performance.now() - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      cursor.x = x0 + (x - x0) * e; cursor.y = y0 + (y - y0) * e; drawCur();
      if (k >= 1) break;
      await sleep(16);
    }
  }

  // ---------- panel helpers (the real panel.html in an iframe) ----------
  const pdoc = () => panelEl.contentDocument;
  async function typeInPanel(text, perChar = 45) {
    const ta = pdoc().getElementById('prompt');
    ta.focus();
    for (let i = 1; i <= text.length; i++) {
      ta.value = text.slice(0, i);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(perChar);
    }
    await sleep(250);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  // ---------- browser helpers ----------
  function showPage(id, tab, url) {
    ['pgQuiz', 'pgInbox', 'pgShop'].forEach((p) => $(p).classList.toggle('on', p === id));
    ['t0', 't1', 't2'].forEach((t) => $(t).classList.toggle('on', t === tab));
    $('url').textContent = url;
  }
  function ringOn(el) {
    const r = $('ring'), page = el.closest('.page').getBoundingClientRect(), b = el.getBoundingClientRect();
    const z = 2; // #app zoom
    r.style.left = (b.left - page.left) / z - 5 + 'px'; r.style.top = (b.top - page.top) / z - 5 + 'px';
    r.style.width = b.width / z + 10 + 'px'; r.style.height = b.height / z + 10 + 'px';
    r.classList.add('on');
  }
  const ringOff = () => $('ring').classList.remove('on');

  function toast(text, ms = 3200) {
    $('toastText').textContent = text;
    $('toast').classList.add('show');
    setTimeout(() => $('toast').classList.remove('show'), ms);
  }

  // ---------- fling physics (same feel as Opia's main-process physics) ----------
  function fling(vx, vy) {
    return new Promise((resolve) => {
      const G = 1500, REST = 0.62, WALL = 0.7, minX = -26, maxX = W - P + 26, minY = -30, floor = H - TASK - P;
      let last = performance.now(), bounces = 0, airborne = true;
      emit({ type: 'physics', event: 'launch', speed: Math.hypot(vx, vy) * 2 });
      (function step() {
        const t = performance.now(), dt = Math.min(0.04, (t - last) / 1000); last = t;
        vy += G * dt; vx *= 1 - 0.15 * dt;
        pos.x += vx * dt; pos.y += vy * dt;
        if (pos.x < minX || pos.x > maxX) { pos.x = pos.x < minX ? minX : maxX; const h = Math.abs(vx); vx = -vx * WALL; if (h > 80) { bounces++; emit({ type: 'physics', event: 'bounce', side: 'wall', strength: h * 2 }); } }
        if (pos.y < minY) { pos.y = minY; const h = Math.abs(vy); vy = Math.abs(vy) * REST; if (h > 80) { bounces++; emit({ type: 'physics', event: 'bounce', side: 'ceiling', strength: h * 2 }); } }
        if (pos.y >= floor) {
          pos.y = floor;
          if (vy > 140) { const h = vy; vy = -vy * REST; vx *= 0.9; if (h > 450) bounces++; emit({ type: 'physics', event: 'bounce', side: 'floor', strength: h * 2 }); }
          else { vy = 0; airborne = false; vx *= 0.86; }
        }
        place();
        if (!airborne && Math.abs(vx) < 20) { emit({ type: 'physics', event: 'rest', bounces: Math.max(bounces, 4) }); return resolve(); }
        requestAnimationFrame(step);
      })();
    });
  }

  // ---------- a small generic block game for the "keep playing" scene ----------
  let gameOn = false;
  const g = $('gc').getContext('2d');
  const hero = { x: 120, y: 0, vy: 0 }; let scroll = 0, tLast = 0, score = 120;
  const coins = Array.from({ length: 60 }, (_, i) => ({ x: 300 + i * 120, y: 560 - (i % 4) * 40, got: false }));
  const groundY = (x) => 700 - Math.round(Math.sin(x / 200) * 2) * 30 - (Math.floor(x / 420) % 3 === 2 ? 30 : 0);
  function loop(t) {
    if (!gameOn) return;
    const dt = Math.min(50, t - (tLast || t)); tLast = t; scroll += dt * 0.2;
    const gy = groundY(scroll + hero.x);
    if (hero.y >= gy - 40 && Math.random() < 0.03) hero.vy = -10;
    hero.vy += 0.6; hero.y = Math.min(hero.y + hero.vy, gy - 40); if (hero.y >= gy - 40) hero.vy = 0;
    const sky = g.createLinearGradient(0, 0, 0, 960); sky.addColorStop(0, '#5fb4ff'); sky.addColorStop(1, '#c5e9ff');
    g.fillStyle = sky; g.fillRect(0, 0, 540, 960);
    g.fillStyle = '#ffffffd8';
    for (let c = 0; c < 5; c++) { const cx = ((c * 230 - scroll * 0.3) % 800 + 800) % 800 - 120; g.fillRect(cx, 120 + (c % 3) * 50, 90, 24); g.fillRect(cx + 22, 104 + (c % 3) * 50, 46, 22); }
    for (let x = -(scroll % 30); x < 540; x += 30) {
      const top = groundY(x + scroll);
      g.fillStyle = '#4caf50'; g.fillRect(x, top, 30, 10); g.fillStyle = '#8d6e4a'; g.fillRect(x, top + 10, 30, 960 - top);
      g.strokeStyle = '#00000022'; g.strokeRect(x + .5, top + .5, 30, 960 - top);
    }
    coins.forEach((k) => { const sx = k.x - scroll; if (k.got || sx < -20 || sx > 560) return;
      if (Math.abs(sx - hero.x - 12) < 24 && Math.abs(k.y - hero.y - 16) < 34) { k.got = true; score += 10; }
      g.fillStyle = '#ffd23f'; g.fillRect(sx - 8, k.y - 8, 16, 16); g.fillStyle = '#e0a800'; g.fillRect(sx - 3, k.y - 5, 6, 10); });
    g.fillStyle = '#3b6fd8'; g.fillRect(hero.x, hero.y + 16, 26, 24); g.fillStyle = '#ffcc99'; g.fillRect(hero.x + 3, hero.y, 20, 18);
    g.fillStyle = '#222'; g.fillRect(hero.x + 15, hero.y + 6, 3, 3);
    g.fillStyle = '#000a'; g.fillRect(400, 60, 124, 36); g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.fillText('⭐ ' + score, 414, 85);
    requestAnimationFrame(loop);
  }
  function game(on) { gameOn = on; $('game').style.display = on ? 'block' : 'none'; $('tbGame').classList.toggle('on', on); if (on) requestAnimationFrame(loop); }

  function setPet(x, y) { pos.x = x; pos.y = y; place(); }
  function panel(open) { panelEl.classList.toggle('open', open); }
  function browser(mode) { // 'front' | 'back' | 'mini' | 'hidden'
    const b = $('browser');
    b.style.display = mode === 'hidden' ? 'none' : 'block';
    b.classList.toggle('back', mode === 'back');
    b.classList.toggle('mini', mode === 'mini');
  }

  // ---------- scenes ----------
  window.reel = {
    // 1. Ask Opia in its chat panel
    async ask() {
      game(false); browser('back'); showPage('pgQuiz', 't1', 'quiz.example.edu/geography/practice-3');
      setPet(W - P - 8, H - TASK - P); panel(true);
      cursor.x = 400; cursor.y = 820;
      await sleep(450);
      await typeInPanel('Do the practice quiz in my open tab');
      emit({ type: 'status', mood: 'thinking', text: 'Ooh, a quiz! 🎩' });
      await sleep(500);
      emit({ type: 'tool', name: 'mcp__playwright__browser_tabs', summary: 'Finding your quiz tab' });
      await sleep(700);
      emit({ type: 'tool', name: 'mcp__playwright__browser_snapshot', summary: 'Reading the questions' });
      await sleep(700);
    },
    // 2. The payoff: answers appear in the user's own tab
    async fill() {
      panel(false); browser('front'); await sleep(450);
      for (const [id, label] of [['q1b', 'Canberra'], ['q2a', 'The Nile'], ['q3c', 'India']]) {
        const el = $(id); ringOn(el); await sleep(260);
        el.classList.add('sel');
        emit({ type: 'tool', name: 'mcp__playwright__browser_click', summary: `Clicking ${label}` });
        await sleep(520);
      }
      ringOn($('submit')); await sleep(350);
      emit({ type: 'tool', name: 'mcp__playwright__browser_click', summary: 'Clicking Submit answers' });
      await sleep(250); ringOff(); $('score').classList.add('on');
      emit({ type: 'assistant', text: 'Done! I filled in all three answers in your tab and submitted it: 3 / 3. 🎩' });
      emit({ type: 'done', result: 'All done! 3 / 3 in your tab. 🎩', durationMs: 9000 });
      await sleep(1300);
    },
    // 3. Keep gaming while Opia works in the background
    async gaming() {
      game(true); browser('mini'); showPage('pgInbox', 't0', 'mail.example.com/inbox');
      setPet(W - P - 6, H - TASK - P - 4);
      $('toast').classList.remove('show');
      emit({ type: 'status', mood: 'browsing', text: 'Reading your inbox' });
      await sleep(700);
      emit({ type: 'tool', name: 'mcp__playwright__browser_snapshot', summary: 'Skimming 3 new emails' });
      await sleep(1200);
      toast('Done: practice moved to 4:30 Thursday, library book due Friday 📚', 3000);
      emit({ type: 'done', result: 'Inbox summarized! Practice moved to 4:30 Thu.', durationMs: 7000 });
      await sleep(1500);
    },
    // 4. Fling physics
    async fling() {
      game(false); browser('hidden'); setPet(175, H - TASK - P);
      cursor.x = 120; cursor.y = 560; drawCur();
      await moveCur(pos.x + 95, pos.y + 120, 500);
      emit({ type: 'physics', event: 'launch', speed: 600 });
      // drag it up and to the left...
      const sx = pos.x, sy = pos.y, t0 = performance.now();
      while (performance.now() - t0 < 380) {
        const k = (performance.now() - t0) / 380;
        setPet(sx - 90 * k, sy - 240 * k); cursor.x = pos.x + 95; cursor.y = pos.y + 120; drawCur();
        await sleep(16);
      }
      // ...and let go with a flick
      cur.classList.remove('on');
      await fling(1100, -950);
      await sleep(700);
    },
    // 5. No payments, ever
    async noPay() {
      game(false); browser('front'); showPage('pgShop', 't2', 'gadgetshop.example.com/checkout');
      $('blocked').classList.remove('on');
      setPet(W - P - 8, H - TASK - P);
      await sleep(500);
      ringOn($('placeOrder'));
      emit({ type: 'tool', name: 'mcp__playwright__browser_click', summary: 'Clicking Place order' });
      await sleep(600);
      ringOff(); $('blocked').classList.add('on');
      emit({ type: 'status', mood: 'error', text: 'No payments! I never spend your money 🎩' });
      await sleep(1900);
    },
  };
})();
