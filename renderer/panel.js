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

  function appendAssistant(text, isDelta) {
    const stick = atBottom();
    if (!currentAssistant) {
      currentAssistant = { el: addMsg('assistant streaming', ''), text: '' };
      currentSteps = null; // steps after this message start a new group
    }
    currentAssistant.text = isDelta ? currentAssistant.text + text : text;
    currentAssistant.el.innerHTML = md(currentAssistant.text);
    if (!isDelta) endAssistantBubble();
    scrollDown(stick);
  }

  function addStep(name, summary) {
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

  function setBusy(b) {
    busy = b;
    stopBtn.hidden = !b;
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
        const bits = [];
        if (ev.durationMs) bits.push(`${(ev.durationMs / 1000).toFixed(1)}s`);
        if (typeof ev.costUsd === 'number' && ev.costUsd > 0) bits.push(`~$${ev.costUsd.toFixed(3)}`);
        addMsg('meta', `✓ done${bits.length ? ' · ' + bits.join(' · ') : ''}`);
        stateLine.textContent = MOOD_LABEL.success;
        refreshState();
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
    promptEl.style.height = Math.min(promptEl.scrollHeight, 160) + 'px';
  }

  promptEl.addEventListener('input', autosize);
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape') opia.hidePanel();
  });
  sendBtn.addEventListener('click', () => send());
  stopBtn.addEventListener('click', async () => {
    const r = await opia.cancel();
    addMsg('meta', `stopped${r && r.dropped ? ` · dropped ${r.dropped} queued task(s)` : ''}`);
    refreshState();
  });
  log.addEventListener('click', (e) => {
    const ex = e.target.closest('.example');
    if (ex) send(ex.textContent);
  });

  $('btn-close').addEventListener('click', () => opia.hidePanel());
  $('btn-new').addEventListener('click', async () => {
    await opia.newSession();
    endAssistantBubble();
    finishSteps();
    log.querySelectorAll('.msg:not(.system)').forEach((m) => m.remove());
    addMsg('meta', 'new chat — Opia forgot the previous conversation');
    promptEl.focus();
  });

  // ------------------------------------------------------------ settings

  const FIELDS = ['permissionMode', 'browserMode', 'extensionToken', 'browserProfile', 'screenAccess', 'quiet', 'autoUpdateCheck', 'updateRepo', 'updateBranch', 'updatePath', 'updateToken', 'browserHeadless', 'browser', 'browserPath', 'cwd', 'claudePath', 'model'];

  async function loadSettings() {
    const s = await opia.getSettings();
    for (const k of FIELDS) {
      const el = $('set-' + k);
      if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k] == null ? '' : s[k];
    }
  }

  $('btn-settings').addEventListener('click', () => {
    settingsEl.hidden = !settingsEl.hidden;
    if (!settingsEl.hidden) loadSettings();
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
  }
  $('btn-settings-save').addEventListener('click', saveSettings);

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
  checkClaude();
  refreshState();
  autosize();
})();
