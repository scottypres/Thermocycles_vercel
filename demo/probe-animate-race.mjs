import { chromium } from 'playwright';

const URL = 'https://thermocycles-vercel.vercel.app/';
const TRIES = 30;
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
page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`  [browser err] ${msg.text()}`);
});

async function snapshotSvgHash() {
  return page.evaluate(() => {
    let h = 0;
    document.querySelectorAll('svg [cx],svg [cy],svg [transform]').forEach((el) => {
      const v = (el.getAttribute('cx') || '') + ',' + (el.getAttribute('cy') || '') + ',' + (el.getAttribute('transform') || '');
      for (let i = 0; i < v.length; i++) h = ((h * 31) + v.charCodeAt(i)) | 0;
    });
    return h;
  });
}

let stalls = 0;
let totalAttempts = 0;
const motionTimes = [];

// Navigate once to land in the Rankine app and avoid landing-page click cost.
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.locator('text=Rankine Cycle').first().click();
await page.waitForSelector('button:has-text("Animate")', { timeout: 10000 });

const RANKINE_URL = page.url(); // direct URL into Rankine

for (let i = 1; i <= TRIES; i++) {
  await page.goto(RANKINE_URL, { waitUntil: 'domcontentloaded' });
  // Click Animate as soon as it shows up.
  const animBtn = page.locator('button:has-text("Animate")').first();
  await animBtn.waitFor({ state: 'visible', timeout: 8000 });
  const beforeHash = await snapshotSvgHash();
  const tClick = Date.now();
  await animBtn.click();

  // Wait for either button flip or motion. Cap at 3000ms.
  let firstMoveAt = null;
  let btnFlippedAt = null;
  const start = Date.now();
  while (Date.now() - start < 3000) {
    const elapsed = Date.now() - tClick;
    const [btnTxt, hash] = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Animate|Pause/.test(b.textContent || ''));
      let h = 0;
      document.querySelectorAll('svg [cx],svg [cy],svg [transform]').forEach((el) => {
        const v = (el.getAttribute('cx') || '') + ',' + (el.getAttribute('cy') || '') + ',' + (el.getAttribute('transform') || '');
        for (let i = 0; i < v.length; i++) h = ((h * 31) + v.charCodeAt(i)) | 0;
      });
      return [btn?.textContent?.trim() || '', h];
    });
    if (btnFlippedAt == null && /Pause/.test(btnTxt)) btnFlippedAt = elapsed;
    if (firstMoveAt == null && hash !== beforeHash) {
      firstMoveAt = elapsed;
      break;
    }
    await page.waitForTimeout(20);
  }

  totalAttempts++;
  if (firstMoveAt == null) {
    stalls++;
    // Stall detected; capture state.
    const state = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Animate|Pause/.test(b.textContent || ''));
      return { btnText: btn?.textContent?.trim() };
    });
    console.log(`  try ${i}: STALL — btn="${state.btnText}", flipped=${btnFlippedAt}ms`);
    // Try clicking once more to see if a second click rescues it.
    const t2 = Date.now();
    await page.locator('button').filter({ hasText: /Animate|Pause/ }).first().click();
    await page.waitForTimeout(80);
    await page.locator('button').filter({ hasText: /Animate|Pause/ }).first().click();
    let recovered = null;
    const s2 = Date.now();
    while (Date.now() - s2 < 1500) {
      const h = await snapshotSvgHash();
      if (h !== beforeHash) {
        recovered = Date.now() - t2;
        break;
      }
      await page.waitForTimeout(20);
    }
    console.log(`    rescue via toggle: ${recovered != null ? `motion at +${recovered}ms` : 'still stalled'}`);
  } else {
    motionTimes.push(firstMoveAt);
    process.stdout.write(`  try ${i}: ${firstMoveAt}ms (flip ${btnFlippedAt}ms)${i % 5 === 0 ? '\n' : '   '}`);
  }
}

console.log(`\n\nResult: ${stalls}/${totalAttempts} stalls`);
if (motionTimes.length) {
  motionTimes.sort((a, b) => a - b);
  const med = motionTimes[Math.floor(motionTimes.length / 2)];
  const max = motionTimes[motionTimes.length - 1];
  console.log(`Motion latency: median=${med}ms, max=${max}ms`);
}

await browser.close();
