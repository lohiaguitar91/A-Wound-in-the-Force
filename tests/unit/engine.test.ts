import { describe, expect, it } from 'vitest';
import type { Atlas, AtlasEvent, Snapshot } from '../../src/data/types';
import { buildIndex, propagate } from '../../src/engine/causal';
import { TerritoryModel } from '../../src/engine/territory';
import { applyPivots } from '../../src/engine/branch';

const ev = (id: string, start: number, links: Partial<AtlasEvent['links']> = {}, extra: Partial<AtlasEvent> = {}): AtlasEvent => ({
  id,
  name: id,
  type: 'battle',
  date: { start, end: start, approx: false, uncertainty: 0 },
  location: { system: 'a' },
  factions: [],
  summary: 'x',
  source: 'https://starwars.fandom.com/wiki/x',
  continuity: 'legends',
  importance: 1,
  links: { requires: [], enables: [], prevents: [], ...links },
  era: 'old-republic',
  ...extra,
});

describe('propagate', () => {
  const events = [
    ev('root', -10),
    ev('child', -9, { requires: ['root'] }),
    ev('grandchild', -8, { requires: ['child'] }),
    ev('kept', -8, { requires: ['root'] }),
    ev('keptChild', -7, { requires: ['kept'] }),
    ev('loose', -7),
    ev('rootEnabler', -10, { enables: ['loose'] }),
    ev('looseDep', -6, { requires: ['loose'] }),
    ev('unrelated', -5),
  ];
  const index = buildIndex(events);

  it('removes everything that transitively requires a removed event', () => {
    const r = propagate(index, new Map([['root', { reason: 'seed', pivot: 'p' }]]), new Map());
    expect([...r.removed.keys()].sort()).toEqual(['child', 'grandchild', 'kept', 'keptChild', 'root']);
    expect(r.removed.get('grandchild')!.cause).toBe('child');
    expect(r.removed.has('unrelated')).toBe(false);
  });

  it('honours keep rules and records them', () => {
    const r = propagate(index, new Map([['root', { reason: 'seed', pivot: 'p' }]]), new Map([['kept', { reason: 'spared', pivot: 'p' }]]));
    expect(r.removed.has('kept')).toBe(false);
    expect(r.removed.has('keptChild')).toBe(false);
    expect(r.keptDespite.get('kept')!.cause).toBe('root');
  });

  it('marks loosely connected events uncertain and propagates uncertainty along requires', () => {
    const r = propagate(index, new Map([['rootEnabler', { reason: 'seed', pivot: 'p' }]]), new Map());
    expect(r.removed.has('loose')).toBe(false);
    expect(r.uncertain.get('loose')!.cause).toBe('rootEnabler');
    expect(r.uncertain.get('looseDep')!.cause).toBe('loose');
  });
});

describe('TerritoryModel', () => {
  const snaps: Snapshot[] = [
    { date: -100, note: 'a', source: 's', control: { red: ['x', 'y'] } },
    { date: -50, note: 'b', source: 's', control: { red: ['x'], blue: ['y'] } },
    { date: 0, note: 'c', source: 's', control: { blue: ['x', 'y'] } },
  ];
  it('steps between snapshots and tracks since', () => {
    const m = new TerritoryModel(snaps, ['x', 'y', 'z']);
    expect(m.controlOf('y', -75)).toEqual({ faction: 'red', since: -100 });
    expect(m.controlOf('y', -50)).toEqual({ faction: 'blue', since: -50 });
    expect(m.controlOf('x', 10)).toEqual({ faction: 'blue', since: 0 });
    expect(m.controlOf('x', -10).since).toBe(-100);
    expect(m.controlOf('z', -10).faction).toBeNull();
    expect(m.controlOf('x', -200).faction).toBeNull();
  });
  it('applies overrides from their date onward, over later base keyframes', () => {
    const m = new TerritoryModel(snaps, ['x', 'y', 'z'], [
      { date: -60, note: 'o', source: 's', control: { green: ['y'] }, release: [], suppress: [], pivot: 'p' },
    ]);
    expect(m.controlOf('y', -70).faction).toBe('red');
    expect(m.controlOf('y', -60).faction).toBe('green');
    expect(m.controlOf('y', 5).faction).toBe('green');
    expect(m.controlOf('x', 5).faction).toBe('blue');
  });
  it('suppresses a faction and releases systems', () => {
    const m = new TerritoryModel(snaps, ['x', 'y', 'z'], [
      { date: -40, note: 'o', source: 's', control: {}, release: ['y'], suppress: ['blue'], pivot: 'p' },
    ]);
    expect(m.controlOf('y', -40).faction).toBeNull();
    expect(m.controlOf('x', 5).faction).toBeNull(); // blue suppressed
    expect(m.controlOf('x', -45).faction).toBe('red');
  });
});

describe('applyPivots on a synthetic atlas', () => {
  const atlas: Atlas = {
    meta: { generatedAt: '', continuity: 'legends', counts: {} },
    eras: { range: { start: -100, end: 10 }, eras: [{ id: 'e', name: 'E', short: 'E', start: -100, end: 10 }], scale: [{ start: -100, end: 10, weight: 1 }] },
    regions: { center: { x: 0, y: 0 }, regions: [] },
    factions: [
      { id: 'red', name: 'Red', short: 'Red', color: '#f00', era: { start: -100 }, kind: 'state', summary: 'x', source: 'https://starwars.fandom.com/wiki/x', continuity: 'legends' },
      { id: 'blue', name: 'Blue', short: 'Blue', color: '#00f', era: { start: -100 }, kind: 'state', summary: 'x', source: 'https://starwars.fandom.com/wiki/x', continuity: 'legends' },
    ],
    systems: [
      { id: 'a', name: 'A', grid: 'A-1', region: 'r', coordinates: { x: 0, y: 0 }, importance: 1, summary: 'x', source: 'https://starwars.fandom.com/wiki/x', continuity: 'legends', fate: { event: 'boom', state: 'destroyed' } },
      { id: 'b', name: 'B', grid: 'A-2', region: 'r', coordinates: { x: 1, y: 1 }, importance: 1, summary: 'x', source: 'https://starwars.fandom.com/wiki/x', continuity: 'legends' },
    ],
    hyperlanes: [],
    events: [
      ev('win', -10, { prevents: ['latentLoss'] }),
      ev('boom', -9, { requires: ['win'] }),
      ev('latentLoss', -10, {}, { latent: true }),
      ev('later', -5, { requires: ['boom'] }),
      ev('loose', -4),
      ev('enabler', -9, { enables: ['loose'], requires: ['win'] }),
    ],
    territory: [{ date: -20, note: 'base', source: 's', control: { red: ['a', 'b'] } }],
    pivots: [
      {
        id: 'p1', number: 1, name: 'P1', question: 'q', divergence: { date: -10, event: 'win' }, premise: 'x', basis: [], source: 'https://starwars.fandom.com/wiki/x', horizon: -2,
        branch: {
          remove: [{ event: 'win', reason: 'flip' }],
          keep: [],
          uncertain: [],
          add: [ev('spec', -8, { requires: ['latentLoss'] }, { speculative: true, basis: 'because' })],
          territory: [{ date: -10, note: 'blue takes a', source: 's', control: { blue: ['a'] }, release: [], suppress: [] }],
          fates: [],
        },
        conflicts: [],
      },
      {
        id: 'p2', number: 2, name: 'P2', question: 'q', divergence: { date: -9, event: 'boom' }, premise: 'x', basis: [], source: 'https://starwars.fandom.com/wiki/x', horizon: 10,
        branch: { remove: [{ event: 'boom', reason: 'flip' }], keep: [], uncertain: [], add: [], territory: [], fates: [] },
        conflicts: [],
      },
    ],
  };

  it('base timeline hides latent events and keeps fates', () => {
    const base = applyPivots(atlas, []);
    expect(base.isBase).toBe(true);
    expect(base.status.get('latentLoss')!.status).toBe('hidden');
    expect(base.events.map((e) => e.id)).toEqual(['win', 'boom', 'enabler', 'later', 'loose']);
    expect(base.fates.get('a')).toEqual({ event: 'boom', state: 'destroyed' });
    expect(base.changes).toEqual([]);
    expect(base.conflicts).toEqual([]);
  });

  it('applies a pivot: removes, releases latent, adds speculative, flips fate and territory', () => {
    const r = applyPivots(atlas, ['p1']);
    expect(r.status.get('win')!.status).toBe('removed');
    expect(r.status.get('boom')!.status).toBe('removed');
    expect(r.status.get('later')!.status).toBe('removed');
    expect(r.status.get('latentLoss')!.status).toBe('added');
    expect(r.status.get('spec')!.status).toBe('added');
    expect(r.status.get('loose')!.status).toBe('uncertain');
    expect(r.fates.get('a')).toBeNull();
    expect(r.territory.controlOf('a', -10).faction).toBe('blue');
    expect(r.territory.controlOf('a', -11).faction).toBe('red');
    expect(r.territory.controlOf('b', -10).faction).toBe('red');
    const kinds = r.changes.map((c) => c.kind);
    expect(kinds).toContain('removed');
    expect(kinds).toContain('added');
    expect(kinds).toContain('uncertain');
    expect(kinds).toContain('territory');
    expect(kinds).toContain('fate');
    expect(r.changes.every((c) => c.speculative)).toBe(true);
  });

  it('detects a derived conflict when one pivot removes another pivot\'s divergence event', () => {
    const r = applyPivots(atlas, ['p1', 'p2']);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ a: 'p1', b: 'p2', kind: 'derived' });
    expect(r.changes.some((c) => c.kind === 'conflict')).toBe(true);
  });

  it('is pure: toggling off restores the base exactly', () => {
    const before = applyPivots(atlas, []);
    applyPivots(atlas, ['p1', 'p2']);
    const after = applyPivots(atlas, []);
    expect([...after.status]).toEqual([...before.status]);
    expect(after.events).toEqual(before.events);
    expect([...after.fates]).toEqual([...before.fates]);
    expect(after.changes).toEqual(before.changes);
    for (const t of [-30, -10, -5, 0]) expect([...after.territory.controlAt(t)]).toEqual([...before.territory.controlAt(t)]);
  });
});
