// Shared data pipeline: load authoring JSON under data/, validate it against the
// schemas, and normalize it into the single atlas.json the app consumes.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..', '..');
export const DATA_DIR = join(ROOT, 'data');

export const MINIMUMS = { systems: 120, events: 250, factions: 12, pivots: 10 };
export const SPEC_PIVOTS = [
  'sadow-wins-great-hyperspace-war',
  'exar-kun-never-falls',
  'revan-stays-home',
  'mass-shadow-generator-never-fires',
  'malak-betrayal-fails',
  'revan-never-redeemed',
  'bane-dies-on-ruusan',
  'order-66-fails',
  'rebellion-loses-yavin',
  'yuuzhan-vong-win',
];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function readDirJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: join(dir, f), data: readJson(join(dir, f)) }));
}

/** Load the raw authoring files (not yet validated). */
export function loadRaw() {
  const sys = readDirJson(join(DATA_DIR, 'systems'));
  const ev = readDirJson(join(DATA_DIR, 'events'));
  const terr = readDirJson(join(DATA_DIR, 'territory'));
  const piv = readDirJson(join(DATA_DIR, 'pivots'));
  return {
    regions: readJson(join(DATA_DIR, 'regions.json')),
    eras: readJson(join(DATA_DIR, 'eras.json')),
    factions: existsSync(join(DATA_DIR, 'factions.json')) ? readJson(join(DATA_DIR, 'factions.json')) : [],
    hyperlanes: existsSync(join(DATA_DIR, 'hyperlanes.json')) ? readJson(join(DATA_DIR, 'hyperlanes.json')) : [],
    systems: sys.flatMap((f) => f.data.map((d) => ({ ...d, __file: f.file }))),
    events: ev.flatMap((f) => f.data.map((d) => ({ ...d, __file: f.file }))),
    territory: terr.flatMap((f) => f.data.map((d) => ({ ...d, __file: f.file }))),
    pivots: piv.flatMap((f) => f.data.map((d) => ({ ...d, __file: f.file }))),
  };
}

function makeAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(readJson(join(DATA_DIR, 'schema', 'defs.json')));
  return ajv;
}

const strip = (arr) => arr.map(({ __file, ...rest }) => rest);

/** Normalize a date (number or object) into {start,end,approx,uncertainty}. */
export function normDate(d) {
  if (typeof d === 'number') return { start: d, end: d, approx: false, uncertainty: 0 };
  return {
    start: d.start,
    end: d.end ?? d.start,
    approx: Boolean(d.approx),
    uncertainty: d.uncertainty ?? 0,
  };
}

const GRID_RE = /^([A-V])-([1-9]|1[0-9]|2[0-4])$/;
export function parseGrid(grid) {
  const m = GRID_RE.exec(grid);
  if (!m) return null;
  return { col: m[1].charCodeAt(0) - 65, row: Number(m[2]) - 1 };
}

// Deterministic jitter inside a grid square so systems sharing a square spread out
// the same way on every build.
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
export function gridToWorld(grid, id) {
  const g = parseGrid(grid);
  if (!g) return null;
  const h = hash32(id);
  const jx = ((h & 0xffff) / 0xffff - 0.5) * 0.72;
  const jy = (((h >>> 16) & 0xffff) / 0xffff - 0.5) * 0.72;
  return { x: +(g.col + 0.5 + jx).toFixed(3), y: +(g.row + 0.5 + jy).toFixed(3) };
}

/**
 * Validate the raw data. Returns { errors: string[], warnings: string[], counts }.
 * Pure structural + referential checks; no network.
 */
export function validate(raw) {
  const errors = [];
  const warnings = [];
  const ajv = makeAjv();
  const schemaFor = (name) => ajv.compile(readJson(join(DATA_DIR, 'schema', `${name}.schema.json`)));
  const check = (name, data, label) => {
    const v = schemaFor(name);
    if (!v(data)) {
      for (const e of v.errors ?? []) {
        const idx = /^\/(\d+)/.exec(e.instancePath || '');
        const rec = idx ? data[Number(idx[1])] : null;
        const who = rec && rec.id ? `${rec.id}` : e.instancePath;
        errors.push(`[schema:${label}] ${who} ${e.instancePath} ${e.message}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}`);
      }
    }
  };
  check('systems', strip(raw.systems), 'systems');
  check('factions', raw.factions, 'factions');
  check('events', strip(raw.events), 'events');
  check('territory', strip(raw.territory), 'territory');
  check('hyperlanes', raw.hyperlanes, 'hyperlanes');
  check('pivots', strip(raw.pivots), 'pivots');

  const regionIds = new Set(raw.regions.regions.map((r) => r.id));
  const systems = new Map();
  const factions = new Map();
  const events = new Map();
  const pivots = new Map();

  const dupe = (map, rec, label) => {
    if (map.has(rec.id)) errors.push(`[dupe:${label}] duplicate id "${rec.id}" (${rec.__file ?? ''})`);
    map.set(rec.id, rec);
  };
  raw.systems.forEach((s) => dupe(systems, s, 'systems'));
  raw.factions.forEach((f) => dupe(factions, f, 'factions'));
  raw.events.forEach((e) => dupe(events, e, 'events'));
  raw.pivots.forEach((p) => dupe(pivots, p, 'pivots'));

  const wikiMarkup = /\[\[|\{\{|<ref|\]\]|\}\}/;
  const checkSummary = (rec, label) => {
    if (typeof rec.summary === 'string' && wikiMarkup.test(rec.summary)) {
      errors.push(`[summary:${label}] ${rec.id} contains wiki markup; summaries must be written in our own words`);
    }
  };

  // Systems
  for (const s of raw.systems) {
    checkSummary(s, 'systems');
    if (!parseGrid(s.grid)) errors.push(`[grid] ${s.id} has invalid grid "${s.grid}"`);
    if (!regionIds.has(s.region)) errors.push(`[region] ${s.id} region "${s.region}" unknown`);
    if (s.fate && !events.has(s.fate.event)) errors.push(`[fate] ${s.id} fate event "${s.fate.event}" does not exist`);
    if (s.coordinates) {
      const g = parseGrid(s.grid);
      if (g && (Math.floor(s.coordinates.x) !== g.col || Math.floor(s.coordinates.y) !== g.row)) {
        errors.push(`[coords] ${s.id} coordinates (${s.coordinates.x}, ${s.coordinates.y}) are outside grid square ${s.grid}`);
      }
    }
  }
  // Factions
  for (const f of raw.factions) {
    checkSummary(f, 'factions');
    if (f.era.end !== undefined && f.era.end < f.era.start) errors.push(`[era] faction ${f.id} ends before it starts`);
  }
  // Events (base + speculative in pivots)
  const specIdsByPivot = new Map();
  for (const p of raw.pivots) {
    const ids = new Set();
    for (const e of p.branch.add ?? []) {
      if (events.has(e.id)) errors.push(`[dupe:events] pivot ${p.id} adds "${e.id}" which already exists as a real event`);
      if (ids.has(e.id)) errors.push(`[dupe:events] pivot ${p.id} adds "${e.id}" twice`);
      ids.add(e.id);
    }
    specIdsByPivot.set(p.id, ids);
  }
  const allSpecIds = new Set([...specIdsByPivot.values()].flatMap((s) => [...s]));

  const checkEvent = (e, label, allowedExtraIds) => {
    checkSummary(e, label);
    const d = normDate(e.date);
    if (!Number.isFinite(d.start) || !Number.isFinite(d.end)) errors.push(`[date] ${e.id} date does not parse`);
    if (d.end < d.start) errors.push(`[date] ${e.id} ends (${d.end}) before it starts (${d.start})`);
    if (e.location.system) {
      const s = systems.get(e.location.system);
      if (!s) errors.push(`[location] ${e.id} location system "${e.location.system}" does not exist`);
      else if (!parseGrid(s.grid)) errors.push(`[location] ${e.id} location "${e.location.system}" has no valid grid square`);
    }
    if (e.location.region && !regionIds.has(e.location.region)) errors.push(`[location] ${e.id} region "${e.location.region}" unknown`);
    for (const f of e.factions) if (!factions.has(f)) errors.push(`[faction] ${e.id} references unknown faction "${f}"`);
    for (const kind of ['requires', 'enables', 'prevents']) {
      for (const t of e.links?.[kind] ?? []) {
        if (t === e.id) errors.push(`[links] ${e.id} ${kind} itself`);
        const ok = events.has(t) || allowedExtraIds.has(t);
        if (!ok) {
          const where = allSpecIds.has(t) ? 'a speculative event of another pivot' : 'nothing';
          errors.push(`[links] ${e.id}.${kind} -> "${t}" points at ${where}`);
        } else if (kind === 'prevents') {
          const target = events.get(t);
          if (target && !target.latent) errors.push(`[links] ${e.id}.prevents -> "${t}" must point at a latent event (one that real history prevented)`);
        }
      }
    }
  };
  for (const e of raw.events) {
    if (e.speculative) errors.push(`[speculative] real event ${e.id} must not be marked speculative`);
    // Base events may prevent latent base events; they must never point at pivot-only events.
    checkEvent(e, 'events', new Set());
    if (e.latent) {
      const preventers = raw.events.filter((o) => (o.links?.prevents ?? []).includes(e.id));
      if (preventers.length === 0) errors.push(`[latent] ${e.id} is latent but nothing prevents it`);
    }
  }
  for (const p of raw.pivots) {
    for (const e of p.branch.add ?? []) {
      if (!e.speculative) errors.push(`[speculative] pivot ${p.id} added event ${e.id} must be marked speculative`);
      if (!e.basis) warnings.push(`[basis] speculative event ${e.id} (pivot ${p.id}) has no lore basis note`);
      checkEvent(e, `pivot:${p.id}`, specIdsByPivot.get(p.id));
    }
  }

  // Territory keyframes
  const expandSpec = (spec, who) => {
    const out = new Set();
    const list = Array.isArray(spec) ? { systems: spec } : spec;
    for (const sid of list.systems ?? []) {
      if (!systems.has(sid)) errors.push(`[territory] ${who} references unknown system "${sid}"`);
      out.add(sid);
    }
    for (const rid of list.regions ?? []) {
      if (!regionIds.has(rid)) errors.push(`[territory] ${who} references unknown region "${rid}"`);
      for (const s of raw.systems) if (s.region === rid) out.add(s.id);
    }
    for (const sid of list.except ?? []) {
      if (!systems.has(sid)) errors.push(`[territory] ${who} except unknown system "${sid}"`);
      out.delete(sid);
    }
    return out;
  };
  const checkKeyframe = (k, who) => {
    for (const [fid, spec] of Object.entries(k.control)) {
      if (!factions.has(fid)) errors.push(`[territory] ${who} controls by unknown faction "${fid}"`);
      expandSpec(spec, who);
    }
    if (k.release) expandSpec(k.release, who);
    for (const fid of k.suppress ?? []) if (!factions.has(fid)) errors.push(`[territory] ${who} suppresses unknown faction "${fid}"`);
  };
  raw.territory.forEach((k, i) => checkKeyframe(k, `keyframe#${i}@${k.date}`));
  let lastDate = -Infinity;
  for (const k of [...raw.territory].sort((a, b) => a.date - b.date)) {
    if (k.date < lastDate) errors.push('[territory] keyframes not sortable');
    lastDate = k.date;
  }

  // Hyperlanes
  for (const h of raw.hyperlanes) {
    checkSummary(h, 'hyperlanes');
    for (const sid of h.systems) if (!systems.has(sid)) errors.push(`[hyperlane] ${h.id} references unknown system "${sid}"`);
  }

  // Pivots
  for (const p of raw.pivots) {
    if (!events.has(p.divergence.event)) errors.push(`[pivot] ${p.id} divergence event "${p.divergence.event}" does not exist`);
    if (p.horizon < p.divergence.date) errors.push(`[pivot] ${p.id} horizon is before its divergence`);
    for (const key of ['remove', 'keep', 'uncertain']) {
      for (const ref of p.branch[key] ?? []) {
        if (!events.has(ref.event)) errors.push(`[pivot] ${p.id}.${key} references unknown event "${ref.event}"`);
      }
    }
    p.branch.territory.forEach((k, i) => {
      checkKeyframe(k, `pivot ${p.id} territory#${i}`);
      if (k.date < p.divergence.date) errors.push(`[pivot] ${p.id} territory override at ${k.date} precedes divergence ${p.divergence.date}`);
    });
    for (const f of p.branch.fates ?? []) {
      if (!systems.has(f.system)) errors.push(`[pivot] ${p.id} fate for unknown system "${f.system}"`);
      if (f.fate && !events.has(f.fate.event) && !specIdsByPivot.get(p.id).has(f.fate.event)) {
        errors.push(`[pivot] ${p.id} fate event "${f.fate.event}" does not exist`);
      }
    }
    for (const c of p.conflicts ?? []) {
      if (!pivots.has(c.pivot)) errors.push(`[pivot] ${p.id} conflicts with unknown pivot "${c.pivot}"`);
    }
    if (!SPEC_PIVOTS.includes(p.id)) warnings.push(`[pivot] ${p.id} is not one of the SPEC.md pivot ids`);
  }

  const counts = {
    systems: raw.systems.length,
    systemsWithGrid: raw.systems.filter((s) => parseGrid(s.grid)).length,
    events: raw.events.filter((e) => !e.latent).length,
    latentEvents: raw.events.filter((e) => e.latent).length,
    speculativeEvents: raw.pivots.reduce((n, p) => n + (p.branch.add?.length ?? 0), 0),
    factions: raw.factions.length,
    pivots: raw.pivots.length,
    territoryKeyframes: raw.territory.length,
    hyperlanes: raw.hyperlanes.length,
    missingSpecPivots: SPEC_PIVOTS.filter((id) => !pivots.has(id)),
  };
  return { errors, warnings, counts };
}

/** Expand a control spec into a set of system ids. */
function expand(spec, systemsByRegion) {
  const list = Array.isArray(spec) ? { systems: spec } : spec;
  const out = new Set(list.systems ?? []);
  for (const rid of list.regions ?? []) for (const sid of systemsByRegion.get(rid) ?? []) out.add(sid);
  for (const sid of list.except ?? []) out.delete(sid);
  return out;
}

/** Turn delta keyframes into full snapshots {date, note, source, control: {faction: [systems]}}. */
export function buildSnapshots(keyframes, systemsByRegion) {
  const sorted = [...keyframes].sort((a, b) => a.date - b.date);
  const current = new Map(); // system -> faction
  const snaps = [];
  for (const k of sorted) {
    if (k.reset) current.clear();
    if (k.release) for (const sid of expand(k.release, systemsByRegion)) current.delete(sid);
    for (const fid of k.suppress ?? []) for (const [sid, f] of [...current]) if (f === fid) current.delete(sid);
    for (const [fid, spec] of Object.entries(k.control)) for (const sid of expand(spec, systemsByRegion)) current.set(sid, fid);
    const control = {};
    for (const [sid, fid] of current) (control[fid] ??= []).push(sid);
    for (const fid of Object.keys(control)) control[fid].sort();
    snaps.push({ date: k.date, note: k.note, source: k.source, control });
  }
  return snaps;
}

/** Normalize raw data into the atlas document the app loads. */
export function normalize(raw) {
  const systemsByRegion = new Map();
  for (const s of raw.systems) {
    if (!systemsByRegion.has(s.region)) systemsByRegion.set(s.region, []);
    systemsByRegion.get(s.region).push(s.id);
  }
  const eraOf = (year) => raw.eras.eras.find((e) => year >= e.start && year < e.end)?.id ?? raw.eras.eras[raw.eras.eras.length - 1].id;

  const systems = strip(raw.systems).map((s) => ({
    ...s,
    importance: s.importance ?? 2,
    coordinates: s.coordinates ?? gridToWorld(s.grid, s.id),
  }));
  const normEvent = (e) => ({
    ...e,
    date: normDate(e.date),
    importance: e.importance ?? 2,
    links: { requires: [], enables: [], prevents: [], ...(e.links ?? {}) },
    era: eraOf(normDate(e.date).start),
  });
  const events = strip(raw.events).map(normEvent);
  const territory = buildSnapshots(strip(raw.territory), systemsByRegion);

  const pivots = strip(raw.pivots)
    .sort((a, b) => a.number - b.number)
    .map((p) => ({
      ...p,
      branch: {
        remove: p.branch.remove ?? [],
        keep: p.branch.keep ?? [],
        uncertain: p.branch.uncertain ?? [],
        add: (p.branch.add ?? []).map(normEvent),
        fates: p.branch.fates ?? [],
        // Overrides stay as deltas, but with every spec expanded to explicit system ids.
        territory: [...p.branch.territory]
          .sort((a, b) => a.date - b.date)
          .map((k) => ({
            date: k.date,
            note: k.note,
            source: k.source,
            control: Object.fromEntries(Object.entries(k.control).map(([fid, spec]) => [fid, [...expand(spec, systemsByRegion)].sort()])),
            release: k.release ? [...expand(k.release, systemsByRegion)].sort() : [],
            suppress: k.suppress ?? [],
          })),
      },
      conflicts: p.conflicts ?? [],
    }));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      continuity: 'legends',
      counts: {
        systems: systems.length,
        events: events.filter((e) => !e.latent).length,
        factions: raw.factions.length,
        pivots: pivots.length,
        territoryKeyframes: territory.length,
      },
    },
    eras: raw.eras,
    regions: raw.regions,
    factions: raw.factions,
    systems,
    hyperlanes: raw.hyperlanes,
    events,
    territory,
    pivots,
  };
}
