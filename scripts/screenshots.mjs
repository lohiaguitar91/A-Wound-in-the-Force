#!/usr/bin/env node
// Capture phone screenshots of every era and three pivots into docs/screenshots/.
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir]
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const baseUrl = process.argv[2] ?? process.env.ATLAS_URL ?? 'http://127.0.0.1:4173/';
const outDir = process.argv[3] ?? 'docs/screenshots';
mkdirSync(outDir, { recursive: true });

const ERA_YEARS = {
  'pre-republic': -30000,
  'old-republic': -3959,
  'rise-of-the-empire': -19,
  rebellion: 0,
  'new-republic': 9,
  'new-jedi-order': 27,
  legacy: 130,
};
const PIVOT_SHOTS = [
  ['sadow-wins-great-hyperspace-war', -4999, 'coruscant'],
  ['revan-stays-home', -3957, 'taris'],
  ['malak-betrayal-fails', -3955, 'coruscant'],
];

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__atlas?.ready === true);
await page.evaluate(() => window.__atlas.fullRes());
const settle = async () => {
  await page.waitForTimeout(250);
};

await settle();
await page.screenshot({ path: join(outDir, '00-first-load.png') });

for (const [era, year] of Object.entries(ERA_YEARS)) {
  await page.evaluate((y) => window.__atlas.setTime(y), year);
  await settle();
  await page.screenshot({ path: join(outDir, `era-${era}.png`) });
}

// A system sheet and the what-if panel.
await page.evaluate(() => window.__atlas.setTime(-3959));
await settle();
const pos = await page.evaluate(() => window.__atlas.screenPosOf('coruscant'));
await page.touchscreen.tap(pos[0], pos[1]);
await settle();
await page.screenshot({ path: join(outDir, 'sheet-system-coruscant.png') });
await page.click('#sheet-close');
await page.click('#btn-whatif');
await settle();
await page.screenshot({ path: join(outDir, 'whatif-panel.png') });
await page.click('#sheet-close');

for (const [pivot, year, system] of PIVOT_SHOTS) {
  await page.evaluate(({ pivot: p, year: y }) => {
    window.__atlas.setPivots([p]);
    window.__atlas.setTime(y);
  }, { pivot, year });
  await settle();
  await page.screenshot({ path: join(outDir, `pivot-${pivot}.png`) });
  const sp = await page.evaluate((s) => window.__atlas.screenPosOf(s), system);
  if (sp) {
    await page.touchscreen.tap(sp[0], sp[1]);
    await settle();
    await page.screenshot({ path: join(outDir, `pivot-${pivot}-sheet.png`) });
    await page.click('#sheet-close');
  }
  await page.click('#btn-whatif');
  await page.getByRole('tab', { name: /What changed/ }).click();
  await settle();
  await page.screenshot({ path: join(outDir, `pivot-${pivot}-changes.png`) });
  await page.click('#sheet-close');
  await page.evaluate(() => window.__atlas.setPivots([]));
}
await browser.close();
console.log(`screenshots written to ${outDir}`);
