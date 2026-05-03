import 'dotenv/config';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'script.json');
const MANIFEST_PATH = resolve(__dirname, 'manifest.json');
const AUDIO_DIR = resolve(__dirname, 'audio');
const OUTPUT_DIR = resolve(__dirname, 'output');

const URL = process.env.DEMO_URL || 'https://thermocycles-vercel.vercel.app/';

function ffprobeDuration(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]).toString().trim();
  return parseFloat(out);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const script = JSON.parse(await readFile(SCRIPT_PATH, 'utf8'));
const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

// Verify all audio exists and capture durations
const durations = {};
let total = 0;
for (const beat of script.beats) {
  const f = resolve(AUDIO_DIR, `${beat.id}.mp3`);
  if (!existsSync(f)) {
    console.error(`Missing audio: ${f}. Run 'npm run audio' first.`);
    process.exit(1);
  }
  durations[beat.id] = ffprobeDuration(f);
  total += durations[beat.id];
}
console.log(`Total audio length: ${total.toFixed(1)}s across ${script.beats.length} beats.`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: manifest.viewport || { width: 1280, height: 800 },
  recordVideo: { dir: OUTPUT_DIR, size: manifest.viewport || { width: 1280, height: 800 } },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

// Inject a visible fake cursor that follows real cursor moves.
await page.addInitScript(() => {
  window.__installCursor = () => {
    if (document.getElementById('__demoCursor')) return;
    const c = document.createElement('div');
    c.id = '__demoCursor';
    c.style.cssText = `
      position: fixed; left: 0; top: 0; width: 22px; height: 22px;
      pointer-events: none; z-index: 2147483647;
      background: radial-gradient(circle at 35% 35%, #ff3366 0%, #aa0033 60%, transparent 70%);
      border: 2px solid white; border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      transform: translate(-11px, -11px); transition: transform 80ms linear;
    `;
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => {
      c.style.left = e.clientX + 'px';
      c.style.top = e.clientY + 'px';
    }, { capture: true });
  };
});
page.on('load', () => page.evaluate(() => window.__installCursor && window.__installCursor()).catch(() => {}));

async function resolveSelector(action) {
  for (const sel of [action.selector, action.fallback].filter(Boolean)) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: 1500 });
      return loc;
    } catch {}
  }
  return null;
}

async function runAction(action) {
  switch (action.do) {
    case 'goto':
      await page.goto(action.url === '@DEMO_URL' ? URL : action.url, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.__installCursor && window.__installCursor()).catch(() => {});
      break;
    case 'wait':
      if (action.selector) await page.waitForSelector(action.selector, { timeout: 5000 }).catch(() => {});
      break;
    case 'click': {
      const loc = await resolveSelector(action);
      if (loc) await loc.click({ timeout: 2000 }).catch((e) => console.warn(`  click failed: ${e.message}`));
      else console.warn(`  click skipped (no match): ${action.selector}`);
      break;
    }
    case 'moveTo': {
      const loc = await resolveSelector(action);
      if (loc) {
        const box = await loc.boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      }
      break;
    }
    case 'dragSlider': {
      const loc = await resolveSelector(action);
      if (!loc) break;
      const box = await loc.boundingBox();
      if (!box) break;
      const min = parseFloat((await loc.getAttribute('min')) || '0');
      const max = parseFloat((await loc.getAttribute('max')) || '1');
      const t = Math.max(min, Math.min(max, action.to));
      const ratio = (t - min) / (max - min);
      const targetX = box.x + box.width * ratio;
      const startX = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(startX, y);
      await page.mouse.down();
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(startX + ((targetX - startX) * i) / steps, y);
        await sleep(30);
      }
      await page.mouse.up();
      break;
    }
    case 'clickInDiagram': {
      const loc = await resolveSelector(action);
      if (!loc) break;
      const box = await loc.boundingBox();
      if (!box) break;
      await page.mouse.click(box.x + box.width * action.x, box.y + box.height * action.y);
      break;
    }
    case 'dragInDiagram': {
      const loc = await resolveSelector(action);
      if (!loc) break;
      const box = await loc.boundingBox();
      if (!box) break;
      const [fx, fy] = action.from;
      const [tx, ty] = action.to;
      const sx = box.x + box.width * fx;
      const sy = box.y + box.height * fy;
      const ex = box.x + box.width * tx;
      const ey = box.y + box.height * ty;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      const steps = 30;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(sx + ((ex - sx) * i) / steps, sy + ((ey - sy) * i) / steps);
        await sleep(40);
      }
      await page.mouse.up();
      break;
    }
    case 'dragLabel': {
      const loc = await resolveSelector(action);
      if (!loc) break;
      const box = await loc.boundingBox();
      if (!box) break;
      const sx = box.x + box.width / 2;
      const sy = box.y + box.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      const dy = action.dy || 0;
      const dx = action.dx || 0;
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(sx + (dx * i) / steps, sy + (dy * i) / steps);
        await sleep(40);
      }
      await page.mouse.up();
      break;
    }
    case 'scrollToBottom':
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
      break;
    case 'scrollToTop':
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      break;
    case 'dismissDialog': {
      for (const txt of ['Close', 'Got it', 'Skip', 'Dismiss', 'X']) {
        const loc = page.locator(`text=${txt}`).first();
        if (await loc.isVisible().catch(() => false)) {
          await loc.click().catch(() => {});
          break;
        }
      }
      break;
    }
    default:
      console.warn(`  unknown action: ${action.do}`);
  }
}

const startWall = Date.now();
let beatStart = 0;
for (const beat of script.beats) {
  const dur = durations[beat.id];
  const actions = (manifest.beats && manifest.beats[beat.id]) || [];
  console.log(`\n[${beat.id}] ${dur.toFixed(1)}s — ${actions.length} actions`);

  // Schedule each action at its 'at' time within the beat
  const beatStartedAt = Date.now();
  let actionIdx = 0;
  while (actionIdx < actions.length) {
    const action = actions[actionIdx];
    const elapsed = (Date.now() - beatStartedAt) / 1000;
    const wait = Math.max(0, (action.at || 0) - elapsed);
    if (wait > 0) await sleep(wait * 1000);
    console.log(`  +${(action.at || 0).toFixed(1)}s ${action.do} ${action.selector || ''}`);
    await runAction(action);
    actionIdx++;
  }
  // Hold for remaining beat time
  const elapsed = (Date.now() - beatStartedAt) / 1000;
  const remain = dur - elapsed;
  if (remain > 0) await sleep(remain * 1000);
  beatStart += dur;
}

console.log(`\nWall time: ${((Date.now() - startWall) / 1000).toFixed(1)}s`);
await context.close();
await browser.close();
console.log('Video saved to demo/output/ (look for .webm).');
