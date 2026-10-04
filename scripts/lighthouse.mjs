#!/usr/bin/env node
// Run Lighthouse (mobile preset) against the built site using the sandbox's Chromium.
// Usage: node scripts/lighthouse.mjs [url]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const outDir = '.lighthouse';
mkdirSync(outDir, { recursive: true });
const chromePath = process.env.CHROME_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

async function reachable(u) {
  try {
    const r = await fetch(u, { method: 'GET' });
    return r.ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await reachable(url))) {
  console.log('starting preview server…');
  spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await reachable(url)); i++) await new Promise((r) => setTimeout(r, 500));
}

const jsonPath = join(outDir, 'report.json');
const args = [
  'lighthouse', url,
  '--output=json', '--output=html', `--output-path=${join(outDir, 'report')}`,
  '--only-categories=performance,accessibility,best-practices,seo',
  '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
  '--quiet',
];
const res = spawnSync('npx', args, { stdio: 'inherit', env: { ...process.env, ...(chromePath ? { CHROME_PATH: chromePath } : {}) } });
server?.kill();
if (res.status !== 0) {
  console.error('lighthouse failed');
  process.exit(res.status ?? 1);
}
const report = JSON.parse(readFileSync(join(outDir, 'report.report.json'), 'utf8'));
const scores = Object.fromEntries(Object.entries(report.categories).map(([k, v]) => [k, Math.round(v.score * 100)]));
const audits = report.audits;
const summary = {
  url,
  fetchTime: report.fetchTime,
  formFactor: report.configSettings.formFactor,
  scores,
  metrics: {
    firstContentfulPaint: audits['first-contentful-paint']?.displayValue,
    largestContentfulPaint: audits['largest-contentful-paint']?.displayValue,
    totalBlockingTime: audits['total-blocking-time']?.displayValue,
    cumulativeLayoutShift: audits['cumulative-layout-shift']?.displayValue,
    speedIndex: audits['speed-index']?.displayValue,
  },
  failingAccessibility: Object.values(audits).filter((a) => a.score !== null && a.score < 1 && report.categories.accessibility.auditRefs.some((r) => r.id === a.id)).map((a) => a.id),
};
writeFileSync(join('docs', 'lighthouse-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log('Lighthouse (mobile):', JSON.stringify(scores));
console.log('metrics:', JSON.stringify(summary.metrics));
if (summary.failingAccessibility.length) console.log('accessibility audits below 100:', summary.failingAccessibility.join(', '));
const ok = scores.performance >= 85 && scores.accessibility >= 90;
console.log(ok ? 'OK: performance ≥ 85 and accessibility ≥ 90' : 'FAILED thresholds (performance ≥ 85, accessibility ≥ 90)');
process.exit(ok ? 0 : 1);
