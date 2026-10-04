#!/usr/bin/env node
// Merge + validate + normalize data/** into public/data/atlas.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRaw, validate, normalize, ROOT } from './lib/data.mjs';

const raw = loadRaw();
const { errors } = validate(raw);
if (errors.length) {
  for (const e of errors) console.error('error:', e);
  console.error(`build-data: ${errors.length} validation error(s); refusing to build.`);
  process.exit(1);
}
const atlas = normalize(raw);
const out = join(ROOT, 'public', 'data');
mkdirSync(out, { recursive: true });
const json = JSON.stringify(atlas);
writeFileSync(join(out, 'atlas.json'), json);
console.log(`build-data: wrote public/data/atlas.json (${(json.length / 1024).toFixed(0)} KB; ${atlas.meta.counts.systems} systems, ${atlas.meta.counts.events} events, ${atlas.meta.counts.factions} factions, ${atlas.meta.counts.pivots} pivots)`);
