import { chromium } from 'playwright';

const URL = 'https://thermocycles-vercel.vercel.app/';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('tourSeen_rankine', '1');
    localStorage.setItem('tourSeen_refrigeration', '1');
  } catch {}
});

async function dumpAnimate(page, label) {
  console.log(`\n--- ${label} ---`);
  const all = await page.locator('button').allTextContents();
  const matches = all
    .map((t, i) => [t.trim(), i])
    .filter(([t]) => /animat/i.test(t));
  console.log(`  total buttons: ${all.length}`);
  console.log(`  Animate buttons:`, matches);
  // Locate via has-text
  const loc = page.locator('button:has-text("Animate")');
  const cnt = await loc.count();
  console.log(`  count via has-text("Animate"): ${cnt}`);
  for (let i = 0; i < cnt; i++) {
    const el = loc.nth(i);
    const vis = await el.isVisible().catch(() => false);
    const box = await el.boundingBox().catch(() => null);
    const enabled = await el.isEnabled().catch(() => null);
    console.log(`    [${i}] visible=${vis} enabled=${enabled} bbox=${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'null'}`);
  }
}

const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await dumpAnimate(page, 'Landing page');

console.log('\n>> entering Rankine');
await page.locator('text=Rankine Cycle').first().click();
await page.waitForSelector('[data-tour="theory"]', { timeout: 5000 });
await dumpAnimate(page, 'Rankine — initial');

// Try to make the button appear in case it's only revealed after some interaction.
console.log('\n>> placing a state point on T-s diagram');
const ts = page.locator('[data-tour="ts-diagram"]').first();
const tsBox = await ts.boundingBox();
if (tsBox) {
  await page.mouse.click(tsBox.x + tsBox.width * 0.5, tsBox.y + tsBox.height * 0.5);
  await page.waitForTimeout(400);
  await dumpAnimate(page, 'Rankine — after T-s click');
}

console.log('\n>> back, entering Refrigeration');
await page.locator('button:has-text("Back")').first().click().catch(() => {});
await page.waitForTimeout(400);
await page.locator('text=Refrigeration Cycle').first().click();
await page.waitForSelector('[data-tour="ref-refrigerants"]', { timeout: 5000 });
await dumpAnimate(page, 'Refrigeration — initial');

await browser.close();
