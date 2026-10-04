#!/usr/bin/env node
// npm run validate:data — schema + referential checks, then counts vs. minimums.
import { loadRaw, validate, MINIMUMS, SPEC_PIVOTS } from './lib/data.mjs';

const raw = loadRaw();
const { errors, warnings, counts } = validate(raw);

const fmt = (n) => String(n).padStart(5, ' ');
console.log('Galaxy Atlas data validation');
console.log('----------------------------');
console.log(`systems            ${fmt(counts.systems)}  (with grid coordinates: ${counts.systemsWithGrid}, minimum ${MINIMUMS.systems})`);
console.log(`events             ${fmt(counts.events)}  (minimum ${MINIMUMS.events}; plus ${counts.latentEvents} latent, ${counts.speculativeEvents} speculative in pivots)`);
console.log(`factions           ${fmt(counts.factions)}  (minimum ${MINIMUMS.factions})`);
console.log(`pivots             ${fmt(counts.pivots)}  (SPEC.md lists ${SPEC_PIVOTS.length})`);
console.log(`territory keyframes${fmt(counts.territoryKeyframes)}`);
console.log(`hyperlanes         ${fmt(counts.hyperlanes)}`);
if (counts.missingSpecPivots.length) {
  console.log(`SPEC.md pivots not yet authored: ${counts.missingSpecPivots.join(', ')}`);
}

const minErrors = [];
if (counts.systemsWithGrid < MINIMUMS.systems) minErrors.push(`need at least ${MINIMUMS.systems} systems with grid coordinates (have ${counts.systemsWithGrid})`);
if (counts.events < MINIMUMS.events) minErrors.push(`need at least ${MINIMUMS.events} events (have ${counts.events})`);
if (counts.factions < MINIMUMS.factions) minErrors.push(`need at least ${MINIMUMS.factions} factions (have ${counts.factions})`);
const pivotFloor = Number(process.env.ATLAS_MIN_PIVOTS ?? 7);
if (counts.pivots < pivotFloor) minErrors.push(`need at least ${pivotFloor} pivots (have ${counts.pivots})`);

for (const w of warnings) console.warn('warning:', w);
for (const e of errors) console.error('error:', e);
for (const e of minErrors) console.error('error:', e);

if (errors.length || minErrors.length) {
  console.error(`\nFAILED with ${errors.length + minErrors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`\nOK — ${warnings.length} warning(s). Every record has a Wookieepedia source URL and an own-words summary (schema-enforced).`);
