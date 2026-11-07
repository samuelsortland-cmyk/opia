'use strict';
// Opia 5.5 settings: a small JSON file in the app's userData folder.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = Object.freeze({
  permissionMode: 'ask', // 'ask' | 'auto'
  browserHeadless: true, // invisible by default so no window ever pops up over a game
  cwd: os.homedir(),
  claudePath: 'claude',
  model: '',
  browser: '', // '' = auto-detect installed Edge/Chrome/Brave/Chromium (Edge first) | 'chrome' | 'msedge' | 'chromium' | 'firefox'
  browserPath: '', // optional explicit browser executable; overrides `browser`
  browserMode: 'link', // 'link' = every tab of your own Edge/Chrome via Opia Link | 'mine' = Playwright Extension (tab group) | 'separate' = Opia's own invisible browser
  extensionToken: '', // PLAYWRIGHT_MCP_EXTENSION_TOKEN from the Playwright Extension (skips the connect dialog)
  browserProfile: '', // optional Chrome profile dir name for extension mode, e.g. "Profile 1"
  quiet: true, // never take keyboard focus on its own (safe while gaming)
  screenAccess: true, // let Opia take screenshots of your screen (see_screen tool)
  autoUpdateCheck: true, // check GitHub for a new version at startup and every few hours
  updateRepo: 'samuelsortland-cmyk/opia',
  updateBranch: 'main',
  updatePath: '', // folder inside the repo that holds Opia ('' = the repo root)
  updateToken: '', // optional read-only GitHub token, needed only if the repo is private
  helpersEnabled: true, // let Opia call in helper Opias for long tasks (uses more of your Claude plan)
  maxHelpers: 3, // at most this many helpers at once (1-5)
  crewEnabled: true, // join the Crew Board (~/.agent-crew): take prompts from it and coordinate with Amir and other agent apps
  openAtLogin: false, // start Opia when you log in
  shortcutsMade: false, // internal: Desktop/Start menu shortcuts were created once
  settingsVersion: 3,
});

class Settings {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'opia-settings.json');
    this.data = { ...DEFAULTS };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...DEFAULTS, ...sanitize(raw) };
      // v2: Opia works in your own browser tab by default (was: its own invisible browser).
      // v3: Opia Link (all your tabs, Opia's own extension) is the default way to use your browser.
      if (!(raw.settingsVersion >= 3)) {
        this.data.browserMode = 'link';
        this.data.settingsVersion = 3;
      }
      // Opia moved from the claude-team repo to its own repo: follow it.
      if (this.data.updateRepo === 'samuelsortland-cmyk/claude-team') {
        Object.assign(this.data, { updateRepo: DEFAULTS.updateRepo, updateBranch: DEFAULTS.updateBranch, updatePath: DEFAULTS.updatePath });
      }
    } catch (_) { /* first run or broken file: keep defaults */ }
  }

  get() {
    return { ...this.data };
  }

  set(partial) {
    this.data = { ...this.data, ...sanitize(partial || {}) };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[opia] could not save settings:', err.message);
    }
    return this.get();
  }
}

function sanitize(obj) {
  const out = {};
  if (obj.permissionMode === 'ask' || obj.permissionMode === 'auto') out.permissionMode = obj.permissionMode;
  if (typeof obj.browserHeadless === 'boolean') out.browserHeadless = obj.browserHeadless;
  if (typeof obj.cwd === 'string' && obj.cwd.trim()) out.cwd = obj.cwd.trim();
  if (typeof obj.claudePath === 'string' && obj.claudePath.trim()) out.claudePath = obj.claudePath.trim();
  if (typeof obj.model === 'string') out.model = obj.model.trim();
  if (['', 'chrome', 'msedge', 'chromium', 'firefox'].includes(obj.browser)) out.browser = obj.browser;
  if (typeof obj.browserPath === 'string') out.browserPath = obj.browserPath.trim();
  if (['link', 'mine', 'separate'].includes(obj.browserMode)) out.browserMode = obj.browserMode;
  if (typeof obj.extensionToken === 'string') out.extensionToken = obj.extensionToken.trim();
  if (typeof obj.browserProfile === 'string') out.browserProfile = obj.browserProfile.trim();
  if (typeof obj.quiet === 'boolean') out.quiet = obj.quiet;
  if (typeof obj.openAtLogin === 'boolean') out.openAtLogin = obj.openAtLogin;
  if (typeof obj.helpersEnabled === 'boolean') out.helpersEnabled = obj.helpersEnabled;
  if (typeof obj.crewEnabled === 'boolean') out.crewEnabled = obj.crewEnabled;
  if (obj.maxHelpers != null && Number.isFinite(Number(obj.maxHelpers))) out.maxHelpers = Math.max(1, Math.min(5, Math.round(Number(obj.maxHelpers))));
  if (typeof obj.shortcutsMade === 'boolean') out.shortcutsMade = obj.shortcutsMade;
  if (typeof obj.screenAccess === 'boolean') out.screenAccess = obj.screenAccess;
  if (typeof obj.autoUpdateCheck === 'boolean') out.autoUpdateCheck = obj.autoUpdateCheck;
  if (typeof obj.updateRepo === 'string') out.updateRepo = obj.updateRepo.trim();
  if (typeof obj.updateBranch === 'string') out.updateBranch = obj.updateBranch.trim();
  if (typeof obj.updatePath === 'string') out.updatePath = obj.updatePath.trim().replace(/^\/+|\/+$/g, '');
  if (typeof obj.updateToken === 'string') out.updateToken = obj.updateToken.trim();
  return out;
}

module.exports = { Settings, DEFAULTS };
