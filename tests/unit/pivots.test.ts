// Per-pivot checks against the real atlas data (built from data/**).
import { describe, expect, it } from 'vitest';
import { loadRaw, normalize } from '../../scripts/lib/data.mjs';
import type { Atlas } from '../../src/data/types';
import { applyPivots, type BranchResult } from '../../src/engine/branch';
import { diffControl } from '../../src/engine/territory';

const atlas: Atlas = normalize(loadRaw());
const base = applyPivots(atlas, []);

function sampleDates(p: Atlas['pivots'][number]): number[] {
  const dates = new Set<number>([p.divergence.date, p.divergence.date + 1, p.horizon]);
  for (const k of p.branch.territory) {
    dates.add(k.date);
    dates.add(k.date + 0.5);
  }
  return [...dates];
}

function holdingsEqual(a: BranchResult, b: BranchResult, t: number): boolean {
  const ha = a.territory.holdingsAt(t);
  const hb = b.territory.holdingsAt(t);
  if (ha.size !== hb.size) return false;
  for (const [f, list] of ha) {
    const other = hb.get(f);
    if (!other || other.length !== list.length || other.some((s, i) => s !== list[i])) return false;
  }
  return true;
}

describe('base timeline', () => {
  it('shows every real event and no speculation', () => {
    const real = atlas.events.filter((e) => !e.latent);
    expect(base.events).toHaveLength(real.length);
    expect(base.events.every((e) => !e.speculative)).toBe(true);
    expect(base.changes).toEqual([]);
  });
  it('has territory at key moments', () => {
    expect(base.territory.controlOf('coruscant', -25053).faction).toBe('galactic-republic');
    expect(base.territory.controlOf('korriban', -6000).faction).toBe('old-sith-empire');
    expect(base.territory.controlOf('korriban', -3958).faction).toBe('revan-sith-empire');
    expect(base.territory.controlOf('coruscant', -10).faction).toBe('galactic-empire');
    expect(base.territory.controlOf('coruscant', 27).faction).toBe('yuuzhan-vong');
  });
});

describe.each(atlas.pivots.map((p) => [p.id, p] as const))('pivot %s', (_id, pivot) => {
  const result = applyPivots(atlas, [pivot.id]);

  it('changes territory from the divergence date onward', () => {
    const changed = sampleDates(pivot).filter((t) => t >= pivot.divergence.date && !holdingsEqual(base, result, t));
    expect(changed.length).toBeGreaterThan(0);
    // Nothing before the divergence may change.
    for (const t of [pivot.divergence.date - 1, pivot.divergence.date - 100]) expect(holdingsEqual(base, result, t)).toBe(true);
  });

  it('removes the events the branch names and everything downstream of them', () => {
    for (const r of pivot.branch.remove) expect(result.status.get(r.event)!.status).toBe('removed');
    const removed = new Set([...result.status].filter(([, s]) => s.status === 'removed').map(([id]) => id));
    const kept = new Set(pivot.branch.keep.map((k) => k.event));
    for (const e of result.allEvents.values()) {
      if (kept.has(e.id)) continue;
      if (e.links.requires.some((r) => removed.has(r))) expect(removed.has(e.id)).toBe(true);
    }
    for (const k of pivot.branch.keep) expect(result.status.get(k.event)!.status).not.toBe('removed');
    expect(removed.size).toBeGreaterThan(pivot.branch.remove.length); // propagation did some work
  });

  it('adds the branch\'s speculative events, labelled as speculation', () => {
    for (const e of pivot.branch.add) {
      const st = result.status.get(e.id)!;
      expect(st.status).toBe('added');
      expect(e.speculative).toBe(true);
      expect(result.events.find((x) => x.id === e.id)?.speculative).toBe(true);
    }
    expect(base.events.some((e) => e.speculative)).toBe(false);
  });

  it('lists every change in the "What changed" list', () => {
    const byEvent = new Map(result.changes.filter((c) => c.eventId).map((c) => [c.eventId!, c]));
    for (const [id, st] of result.status) {
      if (st.status === 'removed') expect(byEvent.get(id)?.kind).toBe('removed');
      if (st.status === 'added') expect(byEvent.get(id)?.kind).toBe('added');
      if (st.status === 'uncertain' && st.pivot) expect(byEvent.get(id)?.kind).toBe('uncertain');
    }
    for (const k of pivot.branch.territory) {
      const visible = diffControl(result.territory.controlAt(k.date - 0.001), result.territory.controlAt(k.date)).length > 0;
      const listed = result.changes.some((c) => c.kind === 'territory' && c.date === k.date && c.title === k.note);
      expect(listed).toBe(visible);
    }
    for (const f of pivot.branch.fates) expect(result.changes.some((c) => c.kind === 'fate' && c.systemId === f.system)).toBe(true);
    expect(result.changes.every((c) => c.speculative)).toBe(true);
    const dates = result.changes.map((c) => c.date);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it('toggling it off restores real history exactly', () => {
    const restored = applyPivots(atlas, []);
    expect([...restored.status]).toEqual([...base.status]);
    expect(restored.events.map((e) => e.id)).toEqual(base.events.map((e) => e.id));
    expect([...restored.fates]).toEqual([...base.fates]);
    expect(restored.changes).toEqual([]);
    for (const t of sampleDates(pivot)) expect(holdingsEqual(base, restored, t)).toBe(true);
    for (const t of [-36000, -25053, -5000, -3996, -3960, -3956, -3951, -1000, -19, 0, 27, 137]) expect(holdingsEqual(base, restored, t)).toBe(true);
  });
});

describe('specific lore consequences', () => {
  it('Sadow winning removes the Nadd/Kun lineage and the Sith Emperor', () => {
    const r = applyPivots(atlas, ['sadow-wins-great-hyperspace-war']);
    for (const id of ['sadow-exile-yavin', 'nadd-discovers-sadow-tomb', 'exar-kun-falls', 'ritual-of-nathema', 'reconstituted-sith-empire-founded', 'great-galactic-war-begins']) {
      expect(r.status.get(id)!.status).toBe('removed');
    }
    expect(r.status.get('sith-occupation-of-coruscant')!.status).toBe('added');
    expect(r.territory.controlOf('coruscant', -5000).faction).toBe('old-sith-empire');
    expect(r.fates.get('nathema')).toBeNull();
  });
  it('Kun never falling keeps Ossus intact and the Krath war still happens', () => {
    const r = applyPivots(atlas, ['exar-kun-never-falls']);
    expect(r.status.get('cron-supernova')!.status).toBe('removed');
    expect(r.fates.get('ossus')).toBeNull();
    expect(r.status.get('krath-coup-empress-teta')!.status).toBe('kept');
    expect(r.status.get('ulic-falls')!.status).toBe('kept');
    expect(r.status.get('mandalorian-wars-begin')!.status).toBe('uncertain');
    expect(r.status.get('jedi-crush-the-krath')!.status).toBe('added');
  });
  it('Revan staying home removes Malachor and the Jedi Civil War', () => {
    const r = applyPivots(atlas, ['revan-stays-home']);
    for (const id of ['battle-of-malachor-v', 'mass-shadow-generator-fires', 'jedi-civil-war-begins', 'revan-redeemed', 'sith-triumvirate-formed', 'exile-returns']) {
      expect(r.status.get(id)!.status).toBe('removed');
    }
    expect(r.fates.get('malachor-v')).toBeNull();
    expect(r.fates.get('taris')).toBeNull();
    expect(r.status.get('siege-of-taris')!.status).toBe('kept');
    expect(r.territory.controlOf('taris', -3957).faction).toBe('mandalorians');
  });
  it('No Mass Shadow Generator removes Nihilus and the Exile\'s arc but keeps the Jedi Civil War', () => {
    const r = applyPivots(atlas, ['mass-shadow-generator-never-fires']);
    for (const id of ['nihilus-becomes-wound', 'massacre-of-katarr', 'exile-exiled', 'exile-returns', 'battle-of-telos-iv-3951']) expect(r.status.get(id)!.status).toBe('removed');
    expect(r.status.get('jedi-civil-war-begins')!.status).toBe('kept');
    expect(r.status.get('sith-triumvirate-formed')!.status).toBe('uncertain');
    expect(r.status.get('first-jedi-purge')!.status).toBe('uncertain');
    expect(r.fates.get('malachor-v')).toBeNull();
    expect(r.fates.get('katarr')).toBeNull();
    expect(r.territory.controlOf('mandalore', -3959).faction).toBe('mandalorians');
  });
  it('Malak\'s failed betrayal spares Taris and Dantooine and hands Revan the galaxy', () => {
    const r = applyPivots(atlas, ['malak-betrayal-fails']);
    for (const id of ['revan-captured', 'bombardment-of-taris', 'bombardment-of-dantooine', 'revan-redeemed', 'destruction-of-star-forge', 'sith-triumvirate-formed']) expect(r.status.get(id)!.status).toBe('removed');
    expect(r.fates.get('taris')).toBeNull();
    expect(r.status.get('revan-conquers-the-republic')!.status).toBe('added');
    expect(r.territory.controlOf('coruscant', -3956).faction).toBe('revan-sith-empire');
  });
  it('Revan unredeemed keeps Taris destroyed but destroys the Republic fleet', () => {
    const r = applyPivots(atlas, ['revan-never-redeemed']);
    expect(r.fates.get('taris')).toEqual({ event: 'bombardment-of-taris', state: 'devastated' });
    expect(r.status.get('destruction-of-star-forge')!.status).toBe('removed');
    expect(r.status.get('darth-revan-returns-to-the-star-forge')!.status).toBe('added');
    expect(r.status.get('exile-returns')!.status).toBe('kept');
    expect(r.territory.controlOf('coruscant', -3953).faction).toBe('revan-sith-empire');
  });
  it('Bane dying removes the Banite line and the Empire', () => {
    const r = applyPivots(atlas, ['bane-dies-on-ruusan']);
    for (const id of ['rule-of-two-founded', 'bane-vs-zannah-ambria', 'palpatine-elected-chancellor', 'order-66', 'galactic-empire-declared', 'destruction-of-alderaan', 'battle-of-yavin']) expect(r.status.get(id)!.status).toBe('removed');
    expect(r.status.get('ruusan-reformation')!.status).toBe('kept');
    expect(r.status.get('yuuzhan-vong-invasion')!.status).toBe('uncertain');
    expect(r.fates.get('alderaan')).toBeNull();
    expect(r.territory.controlOf('coruscant', -10).faction).toBe('galactic-republic');
  });
  it('combining conflicting pivots explains the conflict', () => {
    const r = applyPivots(atlas, ['malak-betrayal-fails', 'revan-never-redeemed']);
    expect(r.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(r.conflicts.some((c) => c.kind === 'declared')).toBe(true);
    const r2 = applyPivots(atlas, ['revan-stays-home', 'mass-shadow-generator-never-fires']);
    expect(r2.conflicts.some((c) => c.kind === 'derived' && c.b === 'mass-shadow-generator-never-fires')).toBe(true);
    const r3 = applyPivots(atlas, ['sadow-wins-great-hyperspace-war', 'exar-kun-never-falls']);
    expect(r3.conflicts.some((c) => c.kind === 'declared')).toBe(true);
  });
  it('all pivots at once still produces a consistent timeline', () => {
    const r = applyPivots(atlas, atlas.pivots.map((p) => p.id));
    expect(r.events.length).toBeGreaterThan(50);
    expect(r.changes.length).toBeGreaterThan(100);
    for (const e of r.events) expect(['kept', 'uncertain', 'added']).toContain(r.status.get(e.id)!.status);
  });
});
