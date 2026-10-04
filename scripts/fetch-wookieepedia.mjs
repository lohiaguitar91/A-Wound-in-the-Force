#!/usr/bin/env node
// Verify the hand-authored data against Wookieepedia's MediaWiki API.
//
//   node scripts/fetch-wookieepedia.mjs --check-urls      # every source URL resolves to a real page
//   node scripts/fetch-wookieepedia.mjs --verify-grid     # compare each system's grid square with the infobox
//   node scripts/fetch-wookieepedia.mjs --all             # both
//
// Rules: at most one request per second, a descriptive User-Agent, and raw
// responses cached in the gitignored .cache/wookieepedia/ folder so re-runs
// never hit the API twice for the same page. Nothing is written to data/;
// the script prints a report and writes docs/verification-report.json.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRaw, ROOT } from './lib/data.mjs';
import { parseGridFromWikitext, parseRegionFromWikitext, titleFromUrl } from './lib/wikitext.mjs';

const API = 'https://starwars.fandom.com/api.php';
const UA = process.env.ATLAS_USER_AGENT ?? 'GalaxyAtlas/0.1 (personal non-commercial fan atlas; https://github.com/lohiaguitar91/A-Wound-in-the-Force; data verification script)';
const CACHE = join(ROOT, '.cache', 'wookieepedia');
mkdirSync(CACHE, { recursive: true });

const args = new Set(process.argv.slice(2));
const doUrls = args.has('--check-urls') || args.has('--all');
const doGrid = args.has('--verify-grid') || args.has('--all');
if (!doUrls && !doGrid) {
  console.log('usage: node scripts/fetch-wookieepedia.mjs [--check-urls] [--verify-grid] [--all]');
  process.exit(0);
}

let lastRequest = 0;
async function api(params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const key = createHash('sha1').update(qs.toString()).digest('hex');
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const wait = 1000 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${qs}`);
  const json = await res.json();
  writeFileSync(file, JSON.stringify(json));
  return json;
}

const raw = loadRaw();
const report = { generatedAt: new Date().toISOString(), missingPages: [], redirects: [], gridMismatches: [], gridConfirmed: [], regionNotes: [], errors: [] };

if (doUrls) {
  const urls = new Set();
  const add = (u) => { if (u) urls.add(u); };
  for (const s of raw.systems) { add(s.source); for (const x of s.sources ?? []) add(x); }
  for (const f of raw.factions) add(f.source);
  for (const e of raw.events) add(e.source);
  for (const h of raw.hyperlanes) add(h.source);
  for (const k of raw.territory) add(k.source);
  for (const p of raw.pivots) { add(p.source); for (const b of p.basis) add(b.source); for (const e of p.branch.add ?? []) add(e.source); for (const k of p.branch.territory) add(k.source); }
  const titles = [...urls].map(titleFromUrl).filter(Boolean);
  console.log(`checking ${titles.length} page titles (${Math.ceil(titles.length / 50)} batched requests, 1/s)…`);
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    try {
      const json = await api({ action: 'query', titles: batch.join('|'), redirects: '1' });
      for (const p of json.query?.pages ?? []) if (p.missing) report.missingPages.push(p.title);
      for (const r of json.query?.redirects ?? []) report.redirects.push({ from: r.from, to: r.to });
    } catch (err) {
      report.errors.push(String(err));
      console.error('request failed:', err.message);
    }
  }
  console.log(`missing pages: ${report.missingPages.length}; redirects: ${report.redirects.length}`);
  for (const t of report.missingPages) console.log('  MISSING', t);
}

if (doGrid) {
  console.log(`verifying grid squares for ${raw.systems.length} systems (1 request/s)…`);
  for (const s of raw.systems) {
    const title = titleFromUrl(s.source);
    try {
      const json = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: title, redirects: '1' });
      const page = json.query?.pages?.[0];
      const text = page?.revisions?.[0]?.slots?.main?.content ?? '';
      const grid = parseGridFromWikitext(text);
      const region = parseRegionFromWikitext(text);
      if (!grid) report.regionNotes.push({ system: s.id, note: 'no grid square found in infobox', region });
      else if (grid !== s.grid) report.gridMismatches.push({ system: s.id, ours: s.grid, wiki: grid, flaggedUncertain: Boolean(s.gridUncertain) });
      else report.gridConfirmed.push(s.id);
      if (region && !region.toLowerCase().includes(s.region.replace(/-/g, ' ').split(' ')[0])) report.regionNotes.push({ system: s.id, note: `wiki region "${region}" vs ours "${s.region}"` });
    } catch (err) {
      report.errors.push(`${s.id}: ${err}`);
      console.error(s.id, 'failed:', err.message);
    }
  }
  console.log(`grid confirmed: ${report.gridConfirmed.length}; mismatches: ${report.gridMismatches.length}`);
  for (const m of report.gridMismatches) console.log(`  ${m.system}: ours ${m.ours}, wiki ${m.wiki}${m.flaggedUncertain ? ' (was flagged uncertain)' : ''}`);
}

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'verification-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('report written to docs/verification-report.json');
