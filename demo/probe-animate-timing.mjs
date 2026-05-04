import { chromium } from 'playwright';

const URL = 'https://thermocycles-vercel.vercel.app/';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('tourSeen_rankine', '1');
    localStorage.setItem('tourSeen_refrigeration', '1');
    localStorage.setItem('tourSeen', '1');
  } catch {}
});

const page = await ctx.newPage();

// Capture browser console for any errors thrown inside the RAF loop.
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`[browser ERROR] ${msg.text()}`);
});
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.locator('text=Rankine Cycle').first().click();
await page.waitForSelector('button:has-text("Animate")', { timeout: 5000 });
await page.waitForTimeout(800); // let cycle fully settle

// Locate the T-s draggable state-point readout (mutates each tick when animating).
// Use the sprite circle on the schematic as a stable observable: it has data
// attributes via animProgress so we'll just sample the rendered SVG instead.
async function snapshotState() {
  return page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Animate|Pause/.test(b.textContent || ''));
    const btnText = btn?.textContent?.trim();
    // Hash all SVG element transform/cx/cy attributes to detect any positional change.
    const svgs = document.querySelectorAll('svg');
    let h = 0;
    svgs.forEach((s) => {
      s.querySelectorAll('[cx],[cy],[transform],[d]').forEach((el) => {
        const v = (el.getAttribute('cx') || '') + ',' + (el.getAttribute('cy') || '') + ',' + (el.getAttribute('transform') || '') + ',' + (el.getAttribute('d') || '').slice(0, 30);
        for (let i = 0; i < v.length; i++) h = ((h * 31) + v.charCodeAt(i)) | 0;
      });
    });
    return { btnText, svgHash: h, t: performance.now() };
  });
}

console.log('=== Run 1: cold click ===');
const animateBtn = page.locator('button:has-text("Animate")').first();
const before = await snapshotState();
console.log(`  before:  btn="${before.btnText}" hash=${before.svgHash}`);

const tClick = Date.now();
await animateBtn.click();

// Poll snapshot every 16ms (one frame) for up to 2s
let firstFlipAt = null;
let firstMoveAt = null;
const baselineHash = before.svgHash;
const startedAt = Date.now();
while (Date.now() - startedAt < 2500) {
  const s = await snapshotState();
  const elapsed = Date.now() - tClick;
  if (firstFlipAt == null && /Pause/.test(s.btnText || '')) {
    firstFlipAt = elapsed;
    console.log(`  +${elapsed}ms btn flipped to "${s.btnText}"`);
  }
  if (firstMoveAt == null && firstFlipAt != null && s.svgHash !== baselineHash) {
    firstMoveAt = elapsed;
    console.log(`  +${elapsed}ms svg hash changed (animation moving)`);
    break;
  }
  await page.waitForTimeout(16);
}
if (firstMoveAt == null) console.log(`  NO MOTION DETECTED in 2500ms`);

// Check whether boilerPath is sane on cycle (read via React fiber probe is tricky;
// instead inspect the rendered SVG paths labelled with the boiler segment).
const boilerPathInfo = await page.evaluate(() => {
  const paths = [...document.querySelectorAll('path')];
  // The cycle path on T-s diagram has many points; just count paths that look cycle-shaped.
  return {
    totalPaths: paths.length,
    pathLengths: paths.slice(0, 10).map((p) => (p.getAttribute('d') || '').length),
  };
});
console.log(`  boilerPath/SVG state: totalPaths=${boilerPathInfo.totalPaths}, first10 d-lens=${JSON.stringify(boilerPathInfo.pathLengths)}`);

console.log('\n=== Run 2: pause + immediate re-click ===');
// Pause first
await page.locator('button:has-text("Pause")').first().click();
await page.waitForTimeout(50);
const animBtn2 = page.locator('button:has-text("Animate")').first();
const before2 = await snapshotState();
console.log(`  before:  btn="${before2.btnText}" hash=${before2.svgHash}`);
const tClick2 = Date.now();
await animBtn2.click();
let flip2 = null, move2 = null;
const startedAt2 = Date.now();
while (Date.now() - startedAt2 < 2500) {
  const s = await snapshotState();
  const elapsed = Date.now() - tClick2;
  if (flip2 == null && /Pause/.test(s.btnText || '')) { flip2 = elapsed; console.log(`  +${elapsed}ms btn flipped`); }
  if (move2 == null && flip2 != null && s.svgHash !== before2.svgHash) { move2 = elapsed; console.log(`  +${elapsed}ms svg moved`); break; }
  await page.waitForTimeout(16);
}
if (move2 == null) console.log(`  NO MOTION DETECTED`);

console.log('\n=== Run 3: rapid double-click ===');
// Pause via state to be safe, then double-click animate
const cur = await snapshotState();
if (/Pause/.test(cur.btnText || '')) {
  await page.locator('button:has-text("Pause")').first().click();
  await page.waitForTimeout(50);
}
const animBtn3 = page.locator('button:has-text("Animate")').first();
const before3 = await snapshotState();
console.log(`  before:  btn="${before3.btnText}" hash=${before3.svgHash}`);
const tClick3 = Date.now();
await animBtn3.click();
await page.waitForTimeout(80); // brief gap
// click whichever is showing
const tog = await page.locator('button').filter({ hasText: /Animate|Pause/ }).first();
await tog.click().catch(() => {});
await page.waitForTimeout(80);
const tog2 = await page.locator('button').filter({ hasText: /Animate|Pause/ }).first();
await tog2.click().catch(() => {});
const startedAt3 = Date.now();
let move3 = null;
while (Date.now() - startedAt3 < 2500) {
  const s = await snapshotState();
  const elapsed = Date.now() - tClick3;
  if (move3 == null && s.svgHash !== before3.svgHash) {
    move3 = elapsed;
    console.log(`  +${elapsed}ms svg moved (after rapid toggle), btn="${s.btnText}"`);
    break;
  }
  await page.waitForTimeout(16);
}
if (move3 == null) console.log(`  NO MOTION after rapid toggle, btn="${(await snapshotState()).btnText}"`);

await browser.close();
