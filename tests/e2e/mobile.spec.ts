import { test, expect, type Page, type CDPSession } from '@playwright/test';
import type { AtlasHooks } from '../../src/app/app';

declare global {
  interface Window {
    __atlas?: AtlasHooks;
  }
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__atlas?.ready === true);
  await page.waitForTimeout(150);
}

async function touch(client: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: { x: number; y: number; id?: number }[]): Promise<void> {
  await client.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

test('the map fills the viewport on first load and the galaxy spans the width', async ({ page, viewport }) => {
  await ready(page);
  const box = (await page.locator('#map').boundingBox())!;
  const vp = viewport!;
  expect(box.width * box.height).toBeGreaterThanOrEqual(0.7 * vp.width * vp.height);
  const g = await page.evaluate(() => window.__atlas!.galaxyScreenBounds());
  expect(g.w).toBeGreaterThanOrEqual(vp.width * 0.9); // no tiny galaxy floating in empty space
  expect(g.h).toBeGreaterThanOrEqual(vp.height * 0.35);
  expect(g.x + g.w / 2).toBeGreaterThan(vp.width * 0.3);
  expect(g.x + g.w / 2).toBeLessThan(vp.width * 0.7);
});

test('there is no horizontal page scroll', async ({ page, viewport }) => {
  await ready(page);
  const vp = viewport!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(vp.width);
  await page.evaluate(() => window.scrollTo(200, 0));
  expect(await page.evaluate(() => window.scrollX)).toBe(0);
  // Open the widest sheet and check again.
  await page.locator('#btn-whatif').tap();
  await expect(page.locator('#sheet')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vp.width);
  const sheetBox = (await page.locator('#sheet').boundingBox())!;
  expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(vp.width + 0.5);
});

test('touch pan and pinch-zoom move the camera', async ({ page }) => {
  await ready(page);
  const client = await page.context().newCDPSession(page);
  const before = await page.evaluate(() => window.__atlas!.getView());
  // One-finger pan.
  await touch(client, 'touchStart', [{ x: 200, y: 420 }]);
  for (let i = 1; i <= 10; i++) await touch(client, 'touchMove', [{ x: 200 - i * 10, y: 420 - i * 8 }]);
  await touch(client, 'touchEnd', []);
  await page.waitForTimeout(400);
  const afterPan = await page.evaluate(() => window.__atlas!.getView());
  expect(Math.hypot(afterPan.cx - before.cx, afterPan.cy - before.cy)).toBeGreaterThan(0.5);
  expect(afterPan.scale).toBeCloseTo(before.scale, 3);
  // Two-finger pinch out.
  await touch(client, 'touchStart', [{ x: 170, y: 430, id: 0 }, { x: 230, y: 430, id: 1 }]);
  for (let i = 1; i <= 12; i++) await touch(client, 'touchMove', [{ x: 170 - i * 7, y: 430, id: 0 }, { x: 230 + i * 7, y: 430, id: 1 }]);
  await touch(client, 'touchEnd', []);
  await page.waitForTimeout(200);
  const afterPinch = await page.evaluate(() => window.__atlas!.getView());
  expect(afterPinch.scale).toBeGreaterThan(afterPan.scale * 1.6);
  // Pinch in.
  await touch(client, 'touchStart', [{ x: 120, y: 430, id: 0 }, { x: 280, y: 430, id: 1 }]);
  for (let i = 1; i <= 12; i++) await touch(client, 'touchMove', [{ x: 120 + i * 5, y: 430, id: 0 }, { x: 280 - i * 5, y: 430, id: 1 }]);
  await touch(client, 'touchEnd', []);
  await page.waitForTimeout(200);
  const afterPinchIn = await page.evaluate(() => window.__atlas!.getView());
  expect(afterPinchIn.scale).toBeLessThan(afterPinch.scale * 0.8);
});

test('the time scrubber moves through every era', async ({ page }) => {
  await ready(page);
  const eras = await page.evaluate(() => window.__atlas!.eraIds());
  expect(eras).toEqual(['pre-republic', 'old-republic', 'rise-of-the-empire', 'rebellion', 'new-republic', 'new-jedi-order', 'legacy']);
  const slider = page.locator('#time');
  const box = (await slider.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const x0 = box.x + 14;
  const x1 = box.x + box.width - 14;
  const seen = new Set<string>();
  const times: number[] = [];
  await touch(client, 'touchStart', [{ x: x0, y }]);
  for (let i = 0; i <= 80; i++) {
    await touch(client, 'touchMove', [{ x: x0 + ((x1 - x0) * i) / 80, y }]);
    seen.add((await page.evaluate(() => document.querySelector<HTMLElement>('.era-tick.active')?.dataset.id ?? '')) || '');
    times.push(await page.evaluate(() => window.__atlas!.getTime()));
  }
  await touch(client, 'touchEnd', []);
  for (const e of eras) expect(seen, `era ${e} reached while dragging`).toContain(e);
  // Time increases monotonically and spans the whole range.
  for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
  expect(times[0]).toBeLessThan(-30000);
  expect(times[times.length - 1]).toBeGreaterThan(100);
  // Keyboard works too.
  await slider.focus();
  await page.keyboard.press('Home');
  expect(await page.evaluate(() => window.__atlas!.getTime())).toBeLessThanOrEqual(-36999);
  await expect(page.locator('#time-readout')).toContainText('BBY');
});

test('tapping a system opens its bottom sheet with a source link', async ({ page }) => {
  await ready(page);
  const pos = (await page.evaluate(() => window.__atlas!.screenPosOf('coruscant')))!;
  await page.touchscreen.tap(pos[0], pos[1]);
  const sheet = page.locator('#sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Coruscant');
  await expect(sheet.getByRole('link', { name: /Wookieepedia/ })).toHaveAttribute('href', /starwars\.fandom\.com\/wiki\//);
  await expect(sheet.getByText(/Grid L-9/)).toBeVisible();
  // Events listed here can be opened.
  await sheet.locator('.row-btn').first().tap();
  await expect(page.locator('#sheet-title')).not.toHaveText('Coruscant');
  await page.locator('#sheet-close').tap();
  await expect(sheet).toBeHidden();
  // Tapping empty space closes nothing further and tapping a system after a pan still works.
  const pos2 = (await page.evaluate(() => window.__atlas!.screenPosOf('korriban')))!;
  if (pos2[0] > 20 && pos2[0] < 370) {
    await page.touchscreen.tap(pos2[0], pos2[1]);
    await expect(page.locator('#sheet-title')).toHaveText('Korriban');
  }
});

test('every pivot can be toggled on and off', async ({ page }) => {
  await ready(page);
  await page.locator('#btn-whatif').tap();
  const ids = await page.evaluate(() => window.__atlas!.pivotIds());
  expect(ids.length).toBeGreaterThanOrEqual(7);
  const banner = page.locator('#whatif-banner');
  for (const id of ids) {
    const sw = page.locator(`[role="switch"][data-pivot="${id}"]`);
    await sw.scrollIntoViewIfNeeded();
    await sw.tap();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => window.__atlas!.getPivots())).toContain(id);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/\d+ changes/);
    await sw.tap();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => window.__atlas!.getPivots())).not.toContain(id);
  }
  await expect(banner).toBeHidden();
  // Combine two conflicting pivots: the conflict is explained in the UI.
  await page.locator('[role="switch"][data-pivot="malak-betrayal-fails"]').tap();
  await page.locator('[role="switch"][data-pivot="revan-never-redeemed"]').tap();
  await expect(page.locator('.pivot-conflict')).toContainText(/Conflict/);
});

test('the "What changed" list jumps the scrubber', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__atlas!.setPivots(['mass-shadow-generator-never-fires']));
  await page.locator('#whatif-banner').tap();
  await expect(page.getByRole('tab', { name: /What changed/ })).toHaveAttribute('aria-selected', 'true');
  const rows = page.locator('.change .row-btn');
  expect(await rows.count()).toBeGreaterThan(5);
  await expect(rows.first()).toContainText(/Malachor|Mass Shadow/);
  const dateText = (await rows.first().locator('.row-date').textContent())!;
  await rows.first().tap();
  const t = await page.evaluate(() => window.__atlas!.getTime());
  expect(Math.round(Math.abs(t))).toBe(Number(dateText.replace(/[^\d]/g, '')));
});

test('primary controls meet the 44px touch target size', async ({ page }) => {
  await ready(page);
  for (const sel of ['#btn-search', '#btn-whatif', '#btn-about', '#btn-play', '#btn-events', '#btn-zoom-in', '#btn-zoom-out', '#btn-zoom-fit', '#time']) {
    const box = (await page.locator(sel).boundingBox())!;
    expect(box.height, sel).toBeGreaterThanOrEqual(44);
    expect(box.width, sel).toBeGreaterThanOrEqual(40);
  }
});
