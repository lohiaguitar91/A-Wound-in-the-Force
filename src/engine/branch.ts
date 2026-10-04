import type { Atlas, AtlasEvent, Fate, OverrideKeyframe, Pivot } from '../data/types';
import { buildIndex, propagate, type Reason } from './causal';
import { TerritoryModel, diffControl } from './territory';

export type Status = 'kept' | 'removed' | 'added' | 'uncertain' | 'hidden';

export interface EventStatus extends Reason {
  status: Status;
}

export type ChangeKind = 'removed' | 'added' | 'uncertain' | 'kept' | 'territory' | 'fate' | 'conflict';

export interface Change {
  kind: ChangeKind;
  date: number;
  title: string;
  detail: string;
  pivot: string | null;
  eventId?: string;
  systemId?: string;
  systems?: string[];
  speculative: boolean;
}

export interface Conflict {
  a: string;
  b: string;
  reason: string;
  kind: 'declared' | 'derived';
}

export interface BranchResult {
  pivots: string[];
  /** Status for every base event and every added event of the selected pivots. */
  status: Map<string, EventStatus>;
  /** Events that happen in this timeline (base kept/uncertain + added), sorted by start date. */
  events: AtlasEvent[];
  /** All event records visible to the UI including removed ones (for strikethrough views). */
  allEvents: Map<string, AtlasEvent>;
  territory: TerritoryModel;
  fates: Map<string, Fate | null>;
  changes: Change[];
  conflicts: Conflict[];
  horizon: number | null;
  isBase: boolean;
}

function byDate(a: AtlasEvent, b: AtlasEvent): number {
  return a.date.start - b.date.start || a.date.end - b.date.end || a.name.localeCompare(b.name);
}

const sysName = (atlas: Atlas) => {
  const m = new Map(atlas.systems.map((s) => [s.id, s.name]));
  return (id: string) => m.get(id) ?? id;
};
const facName = (atlas: Atlas) => {
  const m = new Map(atlas.factions.map((f) => [f.id, f.short]));
  return (id: string | null) => (id ? m.get(id) ?? id : 'no one');
};

function listNames(ids: string[], name: (id: string) => string, max = 3): string {
  const names = ids.map(name);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

/**
 * Apply zero or more pivots to the atlas and return the resulting timeline.
 * Pure: the same inputs always give the same result, so toggling a pivot off
 * restores real history exactly.
 */
export function applyPivots(atlas: Atlas, selected: readonly string[]): BranchResult {
  const pivotsById = new Map(atlas.pivots.map((p) => [p.id, p]));
  const pivots = atlas.pivots.filter((p) => selected.includes(p.id)); // deterministic order (by number)
  const systemIds = atlas.systems.map((s) => s.id);
  const changes: Change[] = [];
  const conflicts: Conflict[] = [];
  const nameOf = sysName(atlas);
  const fname = facName(atlas);

  // Union graph: base events + speculative events of the selected pivots.
  const allEvents = new Map<string, AtlasEvent>();
  for (const e of atlas.events) allEvents.set(e.id, e);
  const addedBy = new Map<string, Pivot>();
  for (const p of pivots) {
    for (const e of p.branch.add) {
      allEvents.set(e.id, e);
      addedBy.set(e.id, p);
    }
  }
  const index = buildIndex(allEvents.values());

  // Seeds, keeps and explicit uncertainties from every selected pivot.
  const seeds = new Map<string, Reason>();
  const keep = new Map<string, Reason>();
  const explicitUncertain = new Map<string, Reason>();
  for (const p of pivots) {
    for (const r of p.branch.remove) if (!seeds.has(r.event)) seeds.set(r.event, { reason: r.reason, pivot: p.id });
    for (const r of p.branch.keep) if (!keep.has(r.event)) keep.set(r.event, { reason: r.reason, pivot: p.id });
    for (const r of p.branch.uncertain) if (!explicitUncertain.has(r.event)) explicitUncertain.set(r.event, { reason: r.reason, pivot: p.id });
  }
  const { removed, uncertain, keptDespite } = propagate(index, seeds, keep, explicitUncertain);

  const horizon = pivots.length ? Math.min(...pivots.map((p) => p.horizon)) : null;

  // Statuses.
  const status = new Map<string, EventStatus>();
  for (const e of allEvents.values()) {
    const added = addedBy.get(e.id);
    if (removed.has(e.id)) {
      status.set(e.id, { status: 'removed', ...removed.get(e.id)! });
      continue;
    }
    if (added) {
      status.set(e.id, { status: 'added', reason: e.basis ?? 'speculative event added by this branch', pivot: added.id });
      continue;
    }
    if (e.latent) {
      const preventers = index.preventedBy.get(e.id) ?? [];
      const released = preventers.length > 0 && preventers.every((p) => removed.has(p));
      if (released) {
        const cause = preventers[0];
        status.set(e.id, {
          status: 'added',
          reason: `no longer prevented by “${allEvents.get(cause)?.name ?? cause}”`,
          pivot: removed.get(cause)!.pivot,
          cause,
        });
      } else status.set(e.id, { status: 'hidden', reason: 'prevented in this timeline', pivot: null });
      continue;
    }
    const u = uncertain.get(e.id);
    if (u) {
      status.set(e.id, { status: 'uncertain', ...u });
      continue;
    }
    if (horizon !== null && e.date.start > horizon) {
      status.set(e.id, { status: 'uncertain', reason: `after this branch's horizon (${-horizon > 0 ? -horizon + ' BBY' : horizon + ' ABY'}); real history shown but unverified`, pivot: null });
      continue;
    }
    const k = keptDespite.get(e.id);
    status.set(e.id, { status: 'kept', reason: k ? k.reason : '', pivot: k ? k.pivot : null, cause: k?.cause });
  }

  // Territory: base snapshots + overrides of the selected pivots.
  const overrides: (OverrideKeyframe & { pivot: string })[] = [];
  for (const p of pivots) for (const k of p.branch.territory) overrides.push({ ...k, pivot: p.id });
  const territory = new TerritoryModel(atlas.territory, systemIds, overrides);

  // Fates: a destruction that no longer happens leaves the world lit.
  const fates = new Map<string, Fate | null>();
  for (const s of atlas.systems) {
    let fate: Fate | null = s.fate ?? null;
    if (fate && removed.has(fate.event)) {
      const ev = allEvents.get(fate.event);
      changes.push({
        kind: 'fate',
        date: ev?.date.start ?? 0,
        title: `${s.name} is never ${fate.state}`,
        detail: `“${ev?.name ?? fate.event}” does not happen in this timeline, so ${s.name} stays on the map.`,
        pivot: removed.get(fate.event)!.pivot,
        systemId: s.id,
        speculative: true,
      });
      fate = null;
    }
    fates.set(s.id, fate);
  }
  for (const p of pivots) {
    for (const f of p.branch.fates) {
      const sys = atlas.systems.find((s) => s.id === f.system);
      if (!sys) continue;
      const next = f.fate ?? null;
      fates.set(f.system, next);
      const ev = next ? allEvents.get(next.event) : undefined;
      changes.push({
        kind: 'fate',
        date: ev?.date.start ?? p.divergence.date,
        title: next ? `${sys.name} is ${next.state}` : `${sys.name} survives`,
        detail: f.reason,
        pivot: p.id,
        systemId: f.system,
        speculative: true,
      });
    }
  }

  // Change list: events.
  for (const [id, st] of status) {
    const e = allEvents.get(id)!;
    if (st.status === 'removed') {
      const explicit = seeds.has(id);
      changes.push({
        kind: 'removed',
        date: e.date.start,
        title: `${e.name} no longer happens`,
        detail: explicit ? st.reason : `Removed by propagation: ${st.reason}.`,
        pivot: st.pivot,
        eventId: id,
        systemId: e.location.system,
        speculative: true,
      });
    } else if (st.status === 'added') {
      changes.push({
        kind: 'added',
        date: e.date.start,
        title: e.name,
        detail: e.latent ? `Speculative — ${st.reason}.` : `Speculative — ${e.basis ?? e.summary}`,
        pivot: st.pivot,
        eventId: id,
        systemId: e.location.system,
        speculative: true,
      });
    } else if (st.status === 'uncertain' && st.pivot !== null) {
      changes.push({
        kind: 'uncertain',
        date: e.date.start,
        title: `${e.name} becomes uncertain`,
        detail: `Loosely connected: ${st.reason}.`,
        pivot: st.pivot,
        eventId: id,
        systemId: e.location.system,
        speculative: true,
      });
    } else if (st.status === 'kept' && st.cause) {
      changes.push({
        kind: 'kept',
        date: e.date.start,
        title: `${e.name} still happens`,
        detail: `The branch keeps it although “${allEvents.get(st.cause)?.name ?? st.cause}” is gone: ${st.reason}`,
        pivot: st.pivot,
        eventId: id,
        systemId: e.location.system,
        speculative: true,
      });
    }
  }

  // Change list: territory, by comparing the branch's own control just before and at each override date.
  for (const k of overrides) {
    const before = territory.controlAt(k.date - 0.001);
    const after = territory.controlAt(k.date);
    const diff = diffControl(before, after);
    if (!diff.length) continue;
    const gains = new Map<string, string[]>();
    for (const d of diff) {
      const key = d.to ?? '__none';
      if (!gains.has(key)) gains.set(key, []);
      gains.get(key)!.push(d.system);
    }
    const parts: string[] = [];
    for (const [f, list] of gains) {
      parts.push(f === '__none' ? `${listNames(list, nameOf)} left unclaimed` : `${fname(f)} take${list.length === 1 ? 's' : ''} ${listNames(list, nameOf)}`);
    }
    changes.push({
      kind: 'territory',
      date: k.date,
      title: k.note,
      detail: parts.join('; ') + '.',
      pivot: k.pivot,
      systems: diff.map((d) => d.system),
      speculative: true,
    });
  }

  // Conflicts: declared by data, plus derived (a pivot's divergence point removed by another pivot).
  const seen = new Set<string>();
  for (const p of pivots) {
    for (const c of p.conflicts) {
      if (!selected.includes(c.pivot)) continue;
      const key = [p.id, c.pivot].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({ a: p.id, b: c.pivot, reason: c.reason, kind: 'declared' });
    }
  }
  for (const p of pivots) {
    if (pivots.length < 2) break;
    // Would the other selected pivots, on their own, erase this pivot's divergence point?
    const othersSeeds = new Map<string, Reason>();
    for (const q of pivots) {
      if (q.id === p.id) continue;
      for (const r of q.branch.remove) if (!othersSeeds.has(r.event)) othersSeeds.set(r.event, { reason: r.reason, pivot: q.id });
    }
    const st = propagate(index, othersSeeds, keep).removed.get(p.divergence.event);
    if (st && st.pivot && st.pivot !== p.id) {
      const key = [p.id, st.pivot].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const other = pivotsById.get(st.pivot);
      conflicts.push({
        a: st.pivot,
        b: p.id,
        reason: `“${other?.name ?? st.pivot}” already removes “${allEvents.get(p.divergence.event)?.name}”, the event this pivot diverges from, so the two branches cannot both be literally true. Both are applied; where they overlap the later-dated override wins.`,
        kind: 'derived',
      });
    }
  }
  for (const c of conflicts) {
    changes.push({
      kind: 'conflict',
      date: Math.min(pivotsById.get(c.a)!.divergence.date, pivotsById.get(c.b)!.divergence.date),
      title: `Conflict: ${pivotsById.get(c.a)!.name} × ${pivotsById.get(c.b)!.name}`,
      detail: c.reason,
      pivot: c.a,
      speculative: true,
    });
  }

  changes.sort((a, b) => a.date - b.date || a.title.localeCompare(b.title));

  const events = [...allEvents.values()]
    .filter((e) => {
      const s = status.get(e.id)!.status;
      return s === 'kept' || s === 'uncertain' || s === 'added';
    })
    .sort(byDate);

  return {
    pivots: pivots.map((p) => p.id),
    status,
    events,
    allEvents,
    territory,
    fates,
    changes,
    conflicts,
    horizon,
    isBase: pivots.length === 0,
  };
}
