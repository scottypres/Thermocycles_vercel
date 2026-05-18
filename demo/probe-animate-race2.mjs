import { chromium } from 'playwright';

const URL = 'https://thermocycles-vercel.vercel.app/';
const TRIES = parseInt(process.argv[2] || '50', 10);
const HEADLESS = !process.argv.includes('--headed');

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('tourSeen_rankine', '1');
    localStorage.setItem('tourSeen_refrigeration', '1');
    localStorage.setItem('tourSeen', '1');
  } catch {}

  // Instrument requestAnimationFrame so we can count ticks.
  window.__rafCounts = { scheduled: 0, fired: 0, errors: [] };
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => {
    window.__rafCounts.scheduled++;
    return orig.call(window, (t) => {
      window.__rafCounts.fired++;
      try {
        cb(t);
      } catch (e) {
        window.__rafCounts.errors.push(String(e?.message || e));
      }
    });
  };
});

const page = await ctx.newPage();
page.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`  [browser err] ${msg.text()}`);
});

// Slow CPU 4× to widen any hydration/click race window.
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

// One initial nav + click into Rankine to capture the URL.
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.locator('text=Rankine Cycle').first().click();
await page.waitForSelector('button:has-text("Animate")', { timeout: 10000 });
const RANKINE_URL = page.url();

let stalls = 0;
const stallDetail = [];

for (let i = 1; i <= TRIES; i++) {
  // Reload (via location.reload) — closer to Cmd+R than goto.
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  const animBtn = page.locator('button:has-text("Animate")').first();
  await animBtn.waitFor({ state: 'visible', timeout: 10000 });

  // Reset RAF counter just before click.
  await page.evaluate(() => { window.__rafCounts = { scheduled: 0, fired: 0, errors: [] }; });

  const beforeHash = await page.evaluate(() => {
    let h = 0;
    document.querySelectorAll('svg [cx],svg [cy],svg [transform]').forEach((el) => {
      const v = (el.getAttribute('cx') || '') + ',' + (el.getAttribute('cy') || '') + ',' + (el.getAttribute('transform') || '');
      for (let j = 0; j < v.length; j++) h = ((h * 31) + v.charCodeAt(j)) | 0;
    });
    return h;
  });

  const tClick = Date.now();
  await animBtn.click();

  // Wait up to 2000ms for motion.
  let firstMoveAt = null;
  let btnFlipped = false;
  while (Date.now() - tClick < 2000) {
    const probe = await page.evaluate((before) => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Animate|Pause/.test(b.textContent || ''));
      let h = 0;
      document.querySelectorAll('svg [cx],svg [cy],svg [transform]').forEach((el) => {
        const v = (el.getAttribute('cx') || '') + ',' + (el.getAttribute('cy') || '') + ',' + (el.getAttribute('transform') || '');
        for (let j = 0; j < v.length; j++) h = ((h * 31) + v.charCodeAt(j)) | 0;
      });
      return { btnText: btn?.textContent?.trim() || '', moved: h !== before, raf: { ...window.__rafCounts } };
    }, beforeHash);
    if (probe.btnText && /Pause/.test(probe.btnText)) btnFlipped = true;
    if (probe.moved) { firstMoveAt = Date.now() - tClick; break; }
    await page.waitForTimeout(20);
  }

  if (firstMoveAt == null) {
    stalls++;
    const final = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /Animate|Pause/.test(b.textContent || ''));
      return { btnText: btn?.textContent?.trim(), raf: { ...window.__rafCounts } };
    });
    stallDetail.push({ try: i, btn: final.btnText, raf: final.raf });
    console.log(`  ${i}: STALL — btn="${final.btnText}" rafScheduled=${final.raf.scheduled} rafFired=${final.raf.fired} errs=${JSON.stringify(final.raf.errors)}`);
  } else {
    if (i % 10 === 0) console.log(`  ${i}: ${firstMoveAt}ms`);
  }
}

console.log(`\nResult: ${stalls}/${TRIES} stalls`);
if (stallDetail.length) {
  console.log('Stall details:');
  for (const d of stallDetail) console.log(`  try ${d.try}: ${JSON.stringify(d)}`);
}

await browser.close();
