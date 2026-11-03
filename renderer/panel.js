'use strict';
// Opia 5.5 prompt panel: chat log, prompt box, permission cards, settings.
(function () {
  const opia = window.opia;
  const $ = (id) => document.getElementById(id);

  const log = $('log');
  const promptEl = $('prompt');
  const sendBtn = $('btn-send');
  const stopBtn = $('btn-stop');
  const stateLine = $('state-line');
  const queueLine = $('queue-line');
  const settingsEl = $('settings');
  const setupEl = $('setup');

  let busy = false;
  let currentAssistant = null; // { el, text } for the bubble being streamed
  let currentSteps = null;     // container for this turn's tool steps

  const MOOD_LABEL = {
    idle: 'idle', listening: 'listening…', thinking: 'thinking…', working: 'working…',
    browsing: 'browsing…', success: 'done ✓', error: 'hit a snag', sleeping: 'napping 💤',
  };

  // ------------------------------------------------------------ rendering

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Tiny, safe markdown: code blocks, inline code, bold, italics, links, line breaks.
  function md(text) {
    const parts = String(text || '').split(/```/);
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        const body = part.replace(/^[\w-]*\n/, '');
        return `<pre><code>${escapeHtml(body)}</code></pre>`;
      }
      let h = escapeHtml(part);
      h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
      h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
      h = h.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>');
      h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
      h = h.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
      h = h.replace(/^#{1,6} (.+)$/gm, '<b>$1</b>');
      h = h.replace(/^\s*[-*] (.+)$/gm, '• $1');
      h = h.replace(/\n/g, '<br>');
      return h;
    }).join('');
  }

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  }

  function scrollDown(force) {
    if (force || atBottom()) requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  function addMsg(cls, html) {
    const stick = atBottom();
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.innerHTML = html;
    log.appendChild(el);
    scrollDown(stick);
    return el;
  }

  function endAssistantBubble() {
    if (currentAssistant) currentAssistant.el.classList.remove('streaming');
    currentAssistant = null;
  }

  const COPY_ICON = '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9.5" height="9.5" rx="2"/><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6A1.5 1.5 0 0 0 5.5 12.5H7"/></svg>';
  function copyText(text, btn) {
    const done = () => { btn.parentElement.classList.add('copied'); btn.lastChild.textContent = 'Copied'; setTimeout(() => { btn.parentElement.classList.remove('copied'); btn.lastChild.textContent = 'Copy'; }, 1500); };
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(done, () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (_) {} ta.remove();
    });
  }

  function appendAssistant(text, isDelta) {
    const stick = atBottom();
    startChat();
    if (!currentAssistant) {
      const el = addMsg('assistant streaming', `<div class="body"></div><div class="actions"><button class="copy" title="Copy">${COPY_ICON}<span>Copy</span></button></div>`);
      currentAssistant = { el, text: '' };
      const holder = currentAssistant;
      el.querySelector('.copy').addEventListener('click', (e) => copyText(holder.text, e.currentTarget));
      currentSteps = null; // steps after this message start a new group
    }
    currentAssistant.text = isDelta ? currentAssistant.text + text : text;
    currentAssistant.el.querySelector('.body').innerHTML = md(currentAssistant.text);
    if (!isDelta) endAssistantBubble();
    scrollDown(stick);
  }

  function startChat() { document.body.classList.add('chatting'); }

  function addStep(name, summary) {
    startChat();
    endAssistantBubble();
    if (!currentSteps) {
      currentSteps = addMsg('steps', '');
    }
    const stick = atBottom();
    const row = document.createElement('div');
    row.className = 'step' + (/playwright|browser/i.test(name || '') ? ' browser' : '');
    row.innerHTML = `<span class="dot"></span><span class="txt">${escapeHtml(summary || name || 'Working')}</span>`;
    currentSteps.appendChild(row);
    // Only the latest step "spins".
    currentSteps.querySelectorAll('.step.active').forEach((s) => s.classList.remove('active'));
    row.classList.add('active');
    scrollDown(stick);
  }

  function finishSteps() {
    if (currentSteps) currentSteps.querySelectorAll('.step.active').forEach((s) => s.classList.remove('active'));
    currentSteps = null;
  }

  function prettyInput(input) {
    if (!input || typeof input !== 'object') return String(input || '');
    if (input.command) return input.command;
    if (input.file_path && input.content != null) return `${input.file_path}\n\n${String(input.content).slice(0, 600)}`;
    if (input.file_path) return input.file_path;
    try { return JSON.stringify(input, null, 2).slice(0, 1200); } catch (_) { return ''; }
  }

  function addPermissionCard(p) {
    if (document.querySelector(`.perm[data-id="${CSS.escape(p.id)}"]`)) return;
    startChat();
    endAssistantBubble();
    const el = addMsg('perm', `
      <div class="perm-head">🧐 Opia would like to use <b>${escapeHtml(p.toolName || 'a tool')}</b></div>
      <div class="perm-sum">${escapeHtml(p.summary || '')}</div>
      <pre class="perm-input">${escapeHtml(prettyInput(p.input))}</pre>
      <div class="perm-actions">
        <button class="deny">Deny</button>
        <button class="allow">Allow</button>
      </div>`, true);
    el.dataset.id = p.id;
    el.querySelector('.allow').addEventListener('click', () => respond(p.id, true));
    el.querySelector('.deny').addEventListener('click', () => respond(p.id, false));
    scrollDown(true);
    el.querySelector('.allow').focus();
  }

  function respond(id, allow) {
    opia.respondPermission(id, allow);
    markPermission(id, allow);
  }

  function markPermission(id, allow) {
    const el = document.querySelector(`.perm[data-id="${CSS.escape(id)}"]`);
    if (!el || el.classList.contains('resolved')) return;
    el.classList.add('resolved', allow ? 'allowed' : 'denied');
    el.querySelector('.perm-actions').innerHTML = `<span class="verdict">${allow ? '✓ Allowed' : '✕ Denied'}</span>`;
  }

  function syncButtons() {
    const hasText = !!promptEl.value.trim();
    stopBtn.hidden = !(busy && !hasText);
    sendBtn.hidden = busy && !hasText;
    sendBtn.disabled = !hasText;
    sendBtn.title = busy ? 'Queue this after the current task (Enter)' : 'Send (Enter)';
  }

  function setBusy(b) {
    busy = b;
    syncButtons();
    document.body.classList.toggle('busy', b);
  }

  function setQueue(n) {
    queueLine.hidden = !n;
    queueLine.textContent = n ? `${n} more task${n > 1 ? 's' : ''} queued` : '';
  }

  // ------------------------------------------------------------ agent events

  opia.onAgentEvent((ev) => {
    switch (ev.type) {
      case 'status':
        stateLine.textContent = ev.text ? `${MOOD_LABEL[ev.mood] || ev.mood} ${ev.text}`.slice(0, 80) : (MOOD_LABEL[ev.mood] || ev.mood || '');
        stateLine.dataset.mood = ev.mood || '';
        if (['thinking', 'working', 'browsing'].includes(ev.mood)) setBusy(true);
        break;
      case 'assistant':
        appendAssistant(ev.text || '', ev.delta === true);
        break;
      case 'tool':
        addStep(ev.name, ev.summary);
        break;
      case 'permission':
        addPermissionCard(ev);
        break;
      case 'permission-resolved':
        markPermission(ev.id, ev.allow);
        break;
      case 'done': {
        endAssistantBubble();
        finishSteps();
        if (ev.stopped) { setBusy(false); stateLine.textContent = 'stopped'; setTimeout(refreshState, 400); break; }
        const bits = [];
        if (ev.durationMs) bits.push(`${(ev.durationMs / 1000).toFixed(1)}s`);
        if (typeof ev.costUsd === 'number' && ev.costUsd > 0) bits.push(`~$${ev.costUsd.toFixed(3)}`);
        addMsg('meta', `✓ done${bits.length ? ' · ' + bits.join(' · ') : ''}`);
        stateLine.textContent = MOOD_LABEL.success;
        setTimeout(refreshState, 300);
        break;
      }
      case 'error':
        endAssistantBubble();
        finishSteps();
        addMsg('error', `⚠ ${escapeHtml(ev.message || 'Something went wrong')}`);
        stateLine.textContent = MOOD_LABEL.error;
        refreshState();
        break;
      case 'queue':
        setQueue(ev.length || 0);
        break;
      case 'update':
        showUpdate(ev);
        break;
      case 'link':
        refreshExtension();
        break;
      case 'link-blocked':
        addMsg('meta', `🎩 Blocked a payment step (${escapeHtml(ev.reason || 'payment')}). I never make payments.`);
        break;
      default:
        break;
    }
  });

  async function refreshState() {
    try {
      const st = await opia.getState();
      setBusy(st.busy);
      setQueue(st.queue);
      (st.pendingPermissions || []).forEach(addPermissionCard);
    } catch (_) {}
  }

  // ------------------------------------------------------------ composer

  async function send(text) {
    text = (text != null ? text : promptEl.value).trim();
    if (!text) return;
    promptEl.value = '';
    autosize();
    endAssistantBubble();
    finishSteps();
    startChat();
    addMsg('user', md(text));
    scrollDown(true);
    setBusy(true);
    const res = await opia.sendPrompt(text);
    if (res && res.ok === false) {
      addMsg('error', `⚠ ${escapeHtml(res.error || 'Could not send')}`);
      refreshState();
    } else if (res && res.queued) {
      addMsg('meta', `queued (#${res.position}) — Opia will get to it right after the current task`);
    }
  }

  function autosize() {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 180) + 'px';
    syncButtons();
  }

  promptEl.addEventListener('input', autosize);
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { if (!settingsEl.hidden) settingsEl.hidden = true; else opia.hidePanel(); }
  });
  sendBtn.addEventListener('click', () => send());
  async function stopNow() {
    setBusy(false); // the UI resets right away; Opia kills the task in the background
    endAssistantBubble();
    finishSteps();
    stateLine.textContent = 'stopped';
    const r = await opia.cancel();
    addMsg('meta', `■ stopped${r && r.dropped ? ` · dropped ${r.dropped} queued task(s)` : ''}`);
    setTimeout(refreshState, 400);
  }
  stopBtn.addEventListener('click', stopNow);
  // Ctrl+. or Ctrl+Shift+X in the panel also stops.
  document.addEventListener('keydown', (e) => {
    if (busy && (e.ctrlKey || e.metaKey) && (e.key === '.' || (e.shiftKey && e.key.toLowerCase() === 'x'))) { e.preventDefault(); stopNow(); }
  });
  log.addEventListener('click', (e) => {
    const ex = e.target.closest('.example');
    if (ex) send(ex.textContent);
  });

  $('btn-close').addEventListener('click', () => opia.hidePanel());
  $('btn-quit').addEventListener('click', () => {
    if (busy && !confirm('Opia is working on a task. Stop it and turn Opia off?')) return;
    opia.turnOff();
  });
  $('btn-new').addEventListener('click', async () => {
    await opia.newSession();
    endAssistantBubble();
    finishSteps();
    log.querySelectorAll('.msg').forEach((m) => m.remove());
    document.body.classList.remove('chatting');
    setGreeting();
    addMsg('meta', 'new chat — Opia forgot the previous conversation');
    promptEl.focus();
  });

  // ------------------------------------------------------------ settings

  const FIELDS = ['openAtLogin', 'permissionMode', 'browserMode', 'extensionToken', 'browserProfile', 'screenAccess', 'quiet', 'autoUpdateCheck', 'updateRepo', 'updateBranch', 'updatePath', 'updateToken', 'browserHeadless', 'browser', 'browserPath', 'cwd', 'claudePath', 'model'];

  async function loadSettings() {
    const s = await opia.getSettings();
    for (const k of FIELDS) {
      const el = $('set-' + k);
      if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k] == null ? '' : s[k];
      if (k === 'browserMode' && !el.dataset.watch) { el.dataset.watch = '1'; el.addEventListener('change', async () => { await opia.setSettings({ browserMode: el.value }); refreshExtension({ card: true }); }); }
    }
  }

  $('btn-settings-close').addEventListener('click', () => { settingsEl.hidden = true; });
  $('mode-chip').addEventListener('click', () => { settingsEl.hidden = false; loadSettings(); refreshExtension(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !settingsEl.hidden && document.activeElement !== promptEl) settingsEl.hidden = true; });

  // Greeting by time of day, and the composer chip showing where Opia browses.
  function setGreeting() {
    const h = new Date().getHours();
    const part = h < 5 ? 'tonight' : h < 12 ? 'this morning' : h < 18 ? 'this afternoon' : 'this evening';
    $('hero-greeting').textContent = `What can I do for you ${part}?`;
  }
  const MODE_LABEL = { link: 'All my tabs', mine: 'Picked tabs', separate: 'Own browser' };
  async function refreshModeChip() {
    let st, ln;
    try { st = await opia.getSettings(); } catch (_) { return; }
    const chip = $('mode-chip');
    chip.classList.remove('ok', 'warn');
    let label = MODE_LABEL[st.browserMode] || 'Browser';
    if (st.browserMode === 'link') {
      try { ln = await opia.linkStatus(); } catch (_) { ln = null; }
      if (ln && ln.connected) { chip.classList.add('ok'); label += ` · ${ln.tabs}`; } else { chip.classList.add('warn'); label = 'Opia Link: not connected'; }
    } else if (st.browserMode === 'separate') chip.classList.add('ok');
    $('mode-label').textContent = label;
  }

  $('btn-settings').addEventListener('click', () => {
    settingsEl.hidden = !settingsEl.hidden;
    if (!settingsEl.hidden) { loadSettings(); refreshExtension(); }
  });

  async function saveSettings() {
    const partial = {};
    for (const k of FIELDS) {
      const el = $('set-' + k);
      partial[k] = el.type === 'checkbox' ? el.checked : el.value;
    }
    await opia.setSettings(partial);
    $('settings-saved').textContent = 'Saved ✓ (applies to the next task)';
    setTimeout(() => { $('settings-saved').textContent = ''; }, 2500);
    checkClaude();
    refreshExtension({ card: true });
  }
  $('btn-settings-save').addEventListener('click', saveSettings);

  // ------------------------------------------------------------ "my browser" extension setup

  const BROWSER_NAME = { msedge: 'Edge', chrome: 'Chrome' };
  let extCard = null;
  let linkCard = null;
  function showLinkSteps(res) {
    const where = res && res.browser ? res.browser : 'Edge';
    addMsg('meta setup-card', `I opened ${where}'s Extensions page and the Opia Link folder (its path is copied). In ${where}:
      <ol class="steps">
        <li>Turn on <b>Developer mode</b> (a switch on the Extensions page).</li>
        <li>Click <b>Load unpacked</b>.</li>
        <li>Paste the path (<b>Ctrl+V</b>) into the folder box, or pick the <b>opia-link</b> folder, then click <b>Select Folder</b>.</li>
      </ol>I'll say "Opia Link connected!" when it works.${res && res.dir ? `<div class="path">${escapeHtml(res.dir)}</div>` : ''}`);
  }
  async function refreshLink({ card = false } = {}) {
    let st;
    try { st = await opia.linkStatus(); } catch (_) { return; }
    $('ext-status').textContent = st.connected ? `✓ Opia Link connected (${st.tabs} tab${st.tabs === 1 ? '' : 's'})` : '✗ Opia Link not connected yet';
    $('btn-ext-install').hidden = true;
    $('btn-link-connect').hidden = !!st.connected;
    $('btn-link-connect').textContent = 'Connect my Edge';
    if (st.connected && linkCard) { linkCard.remove(); linkCard = null; addMsg('meta', '✓ Opia Link connected! I can work in all your tabs now.'); }
    if (card && !st.connected && !linkCard) {
      linkCard = addMsg('meta setup-card', `🧐 To work in <b>all your Edge tabs</b>, connect Opia Link, my little browser extension (one-time, about 30 seconds).
        <div class="setup-actions">
          <button class="link-connect">Connect my Edge</button>
          <button class="ext-separate">Use my own invisible browser instead</button>
        </div>`);
      linkCard.querySelector('.link-connect').addEventListener('click', async () => showLinkSteps(await opia.connectLink()));
      linkCard.querySelector('.ext-separate').addEventListener('click', async () => {
        await opia.setSettings({ browserMode: 'separate' });
        linkCard.remove(); linkCard = null;
        addMsg('meta', 'OK, I\'ll browse in my own invisible browser. Change it any time in Settings.');
      });
    }
  }
  $('btn-link-connect').addEventListener('click', async () => showLinkSteps(await opia.connectLink()));

  async function refreshExtension({ card = false } = {}) {
    refreshModeChip();
    let ext, st;
    try { st = await opia.getSettings(); } catch (_) { return; }
    $('btn-link-connect').hidden = true;
    if (st.browserMode === 'link') return refreshLink({ card });
    if (linkCard) { linkCard.remove(); linkCard = null; }
    if (st.browserMode === 'separate') {
      $('ext-status').textContent = 'Opia uses its own invisible browser.';
      $('btn-ext-install').hidden = true;
      return;
    }
    try { ext = await opia.checkExtension(); } catch (_) { return; }
    const where = ext.installed ? `${BROWSER_NAME[ext.browser] || ext.browser}${ext.profile && ext.profile !== 'Default' ? ' (' + ext.profile + ')' : ''}` : '';
    $('ext-status').textContent = ext.installed ? `✓ Playwright Extension found in ${where}` : '✗ Playwright Extension not installed yet';
    $('btn-ext-install').hidden = !!ext.installed;
    if (ext.installed && extCard) { extCard.remove(); extCard = null; addMsg('meta', `✓ Extension found in ${where}. I'll work in your own tabs now.`); }
    if (card && !ext.installed && st.browserMode === 'mine' && !extCard) {
      extCard = addMsg('meta setup-card', `🧐 To work in <b>your own Edge tabs</b>, I need the free Playwright Extension (one-time, about a minute).
        <div class="setup-actions">
          <button class="ext-install">Install in Edge</button>
          <button class="ext-recheck">I installed it</button>
          <button class="ext-separate">Use my own invisible browser instead</button>
        </div>`);
      extCard.querySelector('.ext-install').addEventListener('click', () => opia.installExtension());
      extCard.querySelector('.ext-recheck').addEventListener('click', () => refreshExtension());
      extCard.querySelector('.ext-separate').addEventListener('click', async () => {
        await opia.setSettings({ browserMode: 'separate' });
        extCard.remove(); extCard = null;
        addMsg('meta', 'OK, I\'ll browse in my own invisible browser. Change it any time in Settings.');
      });
    }
  }
  $('btn-ext-install').addEventListener('click', () => opia.installExtension());

  $('btn-shortcuts').addEventListener('click', async () => {
    const r = await opia.createShortcuts();
    $('shortcut-status').textContent = r.ok ? '✓ Shortcut on your Desktop and in the Start menu.' : (r.error || 'Could not create the shortcut.');
  });

  // ------------------------------------------------------------ updates

  let updateBanner = null;
  function showUpdate(u) {
    if (!u || !u.state) return;
    $('update-status').textContent = u.message || u.state;
    $('btn-update-apply').hidden = u.state !== 'available';
    $('btn-update-check').disabled = ['checking', 'downloading', 'installing', 'restarting'].includes(u.state);
    $('btn-update-apply').disabled = $('btn-update-check').disabled;
    if (u.state === 'available' && !updateBanner) {
      updateBanner = addMsg('meta update', `🎩 A new version of Opia is out. <button class="update-now">Update now</button>`);
      updateBanner.querySelector('.update-now').addEventListener('click', () => opia.applyUpdate());
    } else if (updateBanner && u.state !== 'available') {
      const btn = updateBanner.querySelector('.update-now');
      if (btn) btn.remove();
      updateBanner.append(' ' + (u.message || ''));
      if (['error', 'manual', 'restarting', 'current'].includes(u.state)) updateBanner = null;
    }
    if (u.state === 'error' || u.state === 'manual') addMsg('error', `⚠ ${escapeHtml(u.message || 'Update failed')}`);
  }
  $('btn-update-check').addEventListener('click', async () => {
    if (!settingsEl.hidden) await saveSettings(); // use the source/token currently typed in
    showUpdate(await opia.checkUpdate());
  });
  $('btn-update-apply').addEventListener('click', () => opia.applyUpdate());
  opia.getUpdateState().then((u) => { if (u && u.state && u.state !== 'idle') showUpdate(u); }).catch(() => {});

  // ------------------------------------------------------------ Claude Code check

  async function checkClaude() {
    let st;
    try { st = await opia.checkClaude(); } catch (err) { st = { installed: false, error: err.message }; }
    if (st && st.installed && st.loggedIn === false) {
      setupEl.hidden = false;
      $('setup-detail').textContent = `Claude Code ${st.version || ''} is installed but not logged in. Run \`claude auth login\` in a terminal to log in.`;
    } else if (st && st.installed) {
      setupEl.hidden = true;
      $('logo').title = `Claude Code ${st.version || ''}`.trim();
    } else {
      setupEl.hidden = false;
      $('setup-detail').textContent = st && st.error ? `(${st.error})` : 'Claude Code CLI was not found.';
    }
  }
  $('btn-recheck').addEventListener('click', checkClaude);

  // ------------------------------------------------------------ init

  window.addEventListener('focus', () => promptEl.focus());
  setGreeting();
  syncButtons();
  checkClaude();
  refreshExtension({ card: true });
  window.addEventListener('focus', () => { if (extCard) refreshExtension(); });
  refreshState();
  autosize();
})();
