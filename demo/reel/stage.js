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
    const r = $('ring'), page = el.closest('.page');
    let x = 0, y = 0, n = el;
    while (n && n !== page) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    r.style.left = x - 5 + 'px'; r.style.top = y - 5 + 'px';
    r.style.width = el.offsetWidth + 10 + 'px'; r.style.height = el.offsetHeight + 10 + 'px';
    r.classList.add('on');
  }
  const ringOff = () => $('ring').classList.remove('on');

  function toast(text, ms = 3200) {
    $('toastText').textContent = text;
    $('toast').classList.add('show');
    setTimeout(() => $('toast').classList.remove('show'), ms);
  }

  // ---------- fling physics (same feel as Opia's main-process physics) ----------
  let onBounce = null;
  let flingSeq = 0;
  function fling(vx, vy, { g = 1500, maxMs = 0 } = {}) {
    const my = ++flingSeq, tStart = performance.now();
    return new Promise((resolve) => {
      const G = g, REST = 0.62, WALL = 0.7, minX = -26, maxX = W - P + 26, minY = -30, floor = H - TASK - P;
      let last = performance.now(), bounces = 0, airborne = true;
      emit({ type: 'physics', event: 'launch', speed: Math.hypot(vx, vy) * 2 });
      (function step() {
        if (my !== flingSeq) return resolve();
        if (maxMs && performance.now() - tStart > maxMs) { emit({ type: 'physics', event: 'rest', bounces: Math.max(bounces, 4) }); return resolve(); }
        const t = performance.now(), dt = Math.min(0.04, (t - last) / 1000); last = t;
        vy += G * dt; vx *= 1 - 0.15 * dt;
        pos.x += vx * dt; pos.y += vy * dt;
        if (pos.x < minX || pos.x > maxX) { pos.x = pos.x < minX ? minX : maxX; const h = Math.abs(vx); vx = -vx * WALL; if (h > 80) { bounces++; emit({ type: 'physics', event: 'bounce', side: 'wall', strength: h * 2 }); if (onBounce) onBounce(h); } }
        if (pos.y < minY) { pos.y = minY; const h = Math.abs(vy); vy = Math.abs(vy) * REST; if (h > 80) { bounces++; emit({ type: 'physics', event: 'bounce', side: 'ceiling', strength: h * 2 }); if (onBounce) onBounce(h); } }
        if (pos.y >= floor) {
          pos.y = floor;
          if (vy > 140) { const h = vy; vy = -vy * REST; vx *= 0.9; if (h > 450) bounces++; emit({ type: 'physics', event: 'bounce', side: 'floor', strength: h * 2 }); if (onBounce) onBounce(h); }
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

  function setPet(x, y) { flingSeq++; pos.x = x; pos.y = y; place(); }
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

  // ================================================================== reel v2: fast, punchy cut
  const cam = $('cam'), fx = $('fx'), kt = $('kt');
  let camScale = 1, camX = 0, camY = 0, shakeUntil = 0, shakeAmp = 0;
  function camApply() {
    const t = performance.now();
    const sx = t < shakeUntil ? (Math.random() * 2 - 1) * shakeAmp : 0, sy = t < shakeUntil ? (Math.random() * 2 - 1) * shakeAmp : 0;
    cam.style.transform = `translate(${camX + sx}px, ${camY + sy}px) scale(${camScale})`;
    requestAnimationFrame(camApply);
  }
  requestAnimationFrame(camApply);
  function tween(from, to, ms, fn, ease = (k) => 1 - Math.pow(1 - k, 3)) {
    return new Promise((res) => { const t0 = performance.now(); (function f() { const k = Math.min(1, (performance.now() - t0) / ms); fn(from + (to - from) * ease(k)); if (k < 1) requestAnimationFrame(f); else res(); })(); });
  }
  // zoom the "camera" towards a point (stage coords), e.g. punch(1.2, 270, 400)
  async function punch(scale, x = W / 2, y = H / 2, ms = 220) {
    cam.style.transformOrigin = `${x}px ${y}px`;
    await tween(camScale, scale, ms, (v) => { camScale = v; });
  }
  function shake(amp = 8, ms = 260) { shakeAmp = amp; shakeUntil = performance.now() + ms; }
  function flash(color = '#fff') { const f = $('flash'); f.style.background = color; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  function sticker(emoji, x, y, size = 56) {
    const el = document.createElement('div'); el.className = 'sticker'; el.textContent = emoji;
    el.style.left = x - size / 2 + 'px'; el.style.top = y - size / 2 + 'px'; el.style.fontSize = size + 'px';
    fx.appendChild(el); setTimeout(() => el.remove(), 1200);
  }
  function confetti(x, y, n = 36) {
    const colors = ['#ffd23f', '#ff7a59', '#4cd964', '#5ac8fa', '#d97757', '#fff'];
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div'); el.className = 'conf'; el.style.background = colors[i % colors.length];
      fx.appendChild(el);
      let px = x, py = y, vx = (Math.random() - .5) * 520, vy = -260 - Math.random() * 420, rot = Math.random() * 360, vr = (Math.random() - .5) * 900;
      const t0 = performance.now(); let last = t0;
      (function f() { const t = performance.now(), dt = (t - last) / 1000; last = t; vy += 900 * dt; px += vx * dt; py += vy * dt; rot += vr * dt;
        el.style.transform = `translate(${px}px, ${py}px) rotate(${rot}deg)`; el.style.opacity = Math.max(0, 1 - (t - t0) / 1500);
        if (t - t0 < 1500) requestAnimationFrame(f); else el.remove(); })();
    }
  }
  // meme captions: lines of words; *word* = yellow, _word_ = orange
  function say(lines, { small = false, gap = 85 } = {}) {
    kt.className = small ? 'small' : ''; kt.innerHTML = '';
    let i = 0;
    for (const line of [].concat(lines)) {
      const l = document.createElement('span'); l.className = 'line';
      for (const raw of line.split(' ')) {
        const w = document.createElement('span'); w.className = 'w';
        let txt = raw;
        let m;
        if ((m = raw.match(/^([^*\w$]*)\*(.+)\*([^*\w]*)$/))) { w.classList.add('em'); txt = m[1] + m[2] + m[3]; }
        else if ((m = raw.match(/^([^_\w]*)_(.+)_([^_\w]*)$/))) { w.classList.add('hot'); txt = m[1] + m[2] + m[3]; }
        w.textContent = txt; w.style.animationDelay = (i++ * gap) + 'ms'; l.appendChild(w);
      }
      kt.appendChild(l);
    }
    return sleep(i * gap + 200);
  }
  async function unsay() { kt.classList.add('out'); await sleep(170); kt.innerHTML = ''; kt.className = ''; }
  function stamp(text, color) { const st = $('stamp'); st.textContent = text; st.style.color = color; st.classList.remove('go'); void st.offsetWidth; st.classList.add('go'); }
  function petCenter() { return { x: pos.x + P / 2, y: pos.y + P * 0.62 }; }
  function resetScene() { camScale = 1; camX = 0; $('stamp').classList.remove('go'); $('endcard').classList.remove('on'); ringOff(); kt.innerHTML = ''; }

  window.reel2 = {
    // 0. Cold open: Opia crashes onto the screen
    async cold() {
      resetScene(); game(false); browser('hidden'); panel(false);
      setPet(360, -P - 20);
      onBounce = (h) => { if (h > 300) { shake(Math.min(14, h / 70), 240); const c = petCenter(); sticker('💥', c.x - 40, c.y + 30, 64); } };
      fling(-380, 700, { g: 2600, maxMs: 2300 });
      await sleep(80);
      await say(['*POV:*', 'your desktop pet', 'got a _JOB_ 💼'], { gap: 110 });
      await sleep(850); onBounce = null;
    },
    // 1. Ask (fast)
    async ask() {
      resetScene(); flingSeq++; await unsay(); game(false); browser('back'); showPage('pgQuiz', 't1', 'quiz.example.edu/geography/practice-3');
      $('score').classList.remove('on'); ['q1b', 'q2a', 'q3c'].forEach((q) => $(q).classList.remove('sel'));
      setPet(W - P - 8, H - TASK - P); panel(true);
      say(['you:', '"do my *practice* *quiz*"'], { small: true, gap: 70 });
      punch(1.12, 270, 560, 900);
      await sleep(250);
      await typeInPanel('Do the practice quiz in my open tab', 14);
      emit({ type: 'status', mood: 'thinking', text: 'On it! 🎩' });
      const c = petCenter(); sticker('👀', c.x - 70, c.y - 70, 60);
      emit({ type: 'tool', name: 'mcp__playwright__browser_tabs', summary: 'Finding your quiz tab' });
      await sleep(420);
      emit({ type: 'tool', name: 'mcp__playwright__browser_snapshot', summary: 'Reading the questions' });
      await sleep(380);
    },
    // 2. The payoff, at speed
    async fill() {
      panel(false); browser('front'); await punch(1, W / 2, H / 2, 160);
      flash(); await unsay();
      say(['it does it', '*IN* your tab 🤯'], { gap: 75 });
      await sleep(250);
      for (const [id, label] of [['q1b', 'Canberra'], ['q2a', 'The Nile'], ['q3c', 'India']]) {
        const el = $(id); ringOn(el);
        punch(1.07, 200, 520, 120);
        await sleep(110); el.classList.add('sel');
        emit({ type: 'tool', name: 'mcp__playwright__browser_click', summary: `Clicking ${label}` });
        let x = 0, y = 0, n = el; while (n && n.id !== 'app') { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        sticker('✅', 460, y + 10, 40);
        await sleep(190); punch(1, 200, 520, 100);
      }
      ringOn($('submit')); await sleep(140); ringOff();
      $('score').classList.add('on');
      shake(10, 260); stamp('3/3 ✅', '#1a9a4f'); confetti(270, 470, 44);
      emit({ type: 'done', result: 'Done! 3 / 3 🎩', durationMs: 6000 });
      await sleep(1250);
    },
    // 3. Meanwhile, gaming
    async gaming() {
      resetScene(); await unsay(); game(true); browser('mini'); showPage('pgInbox', 't0', 'mail.example.com/inbox');
      $('toast').classList.remove('show'); setPet(W - P - 6, H - TASK - P - 4);
      flash();
      say(['meanwhile you’re', '*gaming* 🎮'], { gap: 80 });
      emit({ type: 'status', mood: 'browsing', text: 'Reading your inbox' });
      await sleep(650);
      emit({ type: 'tool', name: 'mcp__playwright__browser_snapshot', summary: 'Skimming 3 new emails' });
      await sleep(450);
      toast('Done: practice moved to 4:30 Thursday 📚', 2400); sticker('🔔', 455, 600, 50);
      emit({ type: 'done', result: 'Inbox summarized! 🎩', durationMs: 5000 });
      await sleep(1100);
    },
    // 4. YEET
    async yeet() {
      resetScene(); await unsay(); game(false); browser('hidden'); $('toast').classList.remove('show');
      setPet(175, H - TASK - P); flash();
      say(['you can *YEET* him 🚀'], { gap: 80 });
      cursor.x = 120; cursor.y = 620; drawCur();
      await moveCur(pos.x + 95, pos.y + 120, 280);
      emit({ type: 'physics', event: 'launch', speed: 600 });
      const sx = pos.x, sy = pos.y, t0 = performance.now();
      while (performance.now() - t0 < 230) {
        const k = (performance.now() - t0) / 230;
        setPet(sx - 70 * k, sy - 200 * k); cursor.x = pos.x + 95; cursor.y = pos.y + 120; drawCur();
        await sleep(16);
      }
      cur.classList.remove('on');
      onBounce = (h) => { if (h > 250) { shake(Math.min(16, h / 60), 220); const c = petCenter(); sticker(['💥', '💫', '💥'][Math.floor(Math.random() * 3)], c.x, c.y - 20, 58); } };
      await fling(1500, -1250, { g: 2600, maxMs: 1900 });
      onBounce = null; await unsay();
      say(['he’s *fine* 🙂'], { gap: 80 });
      await sleep(650);
    },
    // 5. No payments
    async noPay() {
      resetScene(); await unsay(); game(false); browser('front'); showPage('pgShop', 't2', 'gadgetshop.example.com/checkout');
      $('blocked').classList.remove('on'); setPet(W - P - 8, H - TASK - P); flash();
      say(['tries to buy', '_$129_ headphones…'], { small: true, gap: 70 });
      await sleep(380);
      ringOn($('placeOrder')); punch(1.12, 160, 600, 200);
      emit({ type: 'tool', name: 'mcp__playwright__browser_click', summary: 'Clicking Place order' });
      await sleep(330); ringOff();
      punch(1, 160, 600, 120);
      $('blocked').classList.add('on'); stamp('BLOCKED 🚫', '#d2302a'); shake(14, 320); flash('#ff3b30');
      emit({ type: 'status', mood: 'error', text: 'No payments! 🎩' });
      await sleep(500); await unsay();
      say(['never spends', 'your *money* 💸'], { gap: 75 });
      await sleep(900);
    },
    // 6. End card
    async end() {
      resetScene(); await unsay(); $('endcard').classList.add('on');
      await sleep(3000);
    },
  };
})();
