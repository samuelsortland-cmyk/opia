// Renders Opia previews with Playwright: a pose sheet + live moods.
// Usage: node opia/tools/render-preview.js   (writes opia/assets/preview-*.png)
const path = require('path');
const { chromium } = require('playwright');
const R = path.join(__dirname, '..', 'renderer');
const OUT = path.join(__dirname, '..', 'assets');

const html = `<!DOCTYPE html><html><head><link rel="stylesheet" href="file://${R}/pet.css">
<style>html,body{background:#9fb7c9 !important}</style></head><body>
<div id="bubble"></div><canvas id="pet-canvas"></canvas><button id="prompt-btn">✦</button>
<script src="file://${R}/sprite.js"></script><script src="file://${R}/behavior.js"></script></body></html>`;

(async () => {
  const browser = await chromium.launch(require('fs').existsSync('/opt/pw-browsers/chromium') && !process.env.PW_DEFAULT ? { executablePath: require('fs').realpathSync('/opt/pw-browsers/chromium') } : {});
  const page = await browser.newPage({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const tmp = path.join(require('os').tmpdir(), 'opia-preview.html');
  require('fs').writeFileSync(tmp, html);
  await page.goto('file://' + tmp);
  await page.waitForTimeout(300);

  // static pose sheet straight from OpiaSprite
  const poses = {
    neutral: {}, lookLeftUp: { eyeDX: -1, eyeDY: -1 }, blink: { blink: 1 }, happy: { eyes: 'happy', blush: 1 },
    error: { eyes: 'x', hatTilt: 0.38, hatX: 2, hatLift: -1 }, browsing: { eyeDX: 1, squint: true, monocleGlint: 0.4, tilt: 0.12 },
    hatTip: { eyes: 'happy', armR: 1.2, hatLift: 4, hatTilt: -0.45, hatX: 2 }, dangle: { dangle: 1, eyes: 'wide', armL: 1, armR: 1, shadow: false },
    sleeping: { eyes: 'closed', hatTilt: 0.22, hatX: 1, particles: [{ kind: 'z', x: 33, y: 16, a: 1 }, { kind: 'zs', x: 38, y: 10, a: 0.6 }] },
  };
  await page.evaluate(() => { window.__sp = window.OpiaSprite.create(document.getElementById('pet-canvas'), { scale: 2 }); });
  for (const [name, pose] of Object.entries(poses)) {
    await page.evaluate(p => window.__sp.draw(p), pose);
    await page.screenshot({ path: path.join(OUT, `preview-pose-${name}.png`) });
  }
  // live behaviour moods
  await page.evaluate(() => { window.__pet = window.OpiaBehavior.start({ canvas: document.getElementById('pet-canvas'), sprite: window.__sp }); });
  for (const mood of ['idle', 'thinking', 'working', 'browsing', 'success', 'error', 'sleeping']) {
    await page.evaluate(m => window.__pet.setMood(m), mood);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: path.join(OUT, `preview-mood-${mood}.png`) });
  }
  await page.evaluate(() => { window.__pet.setMood('idle'); window.__pet.react('click'); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, 'preview-react-click.png') });
  await page.evaluate(() => window.__pet.react('pet'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, 'preview-react-pet.png') });
  // perf: frames over 2s
  const fps = await page.evaluate(() => new Promise(r => { let n = 0; const s = window.OpiaSprite; const orig = window.__sp.draw; window.__sp.draw = p => { n++; orig(p); }; setTimeout(() => r(n / 2), 2000); }));
  console.log('frames/s:', fps);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  await browser.close();
})();
