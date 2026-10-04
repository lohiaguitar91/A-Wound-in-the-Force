import type { AtlasEvent } from '../data/types';

export interface Reason {
  reason: string;
  pivot: string | null;
  cause?: string; // event id that caused this status, when propagated
}

export interface CausalIndex {
  byId: Map<string, AtlasEvent>;
  requiredBy: Map<string, string[]>; // X -> events that require X
  preventedBy: Map<string, string[]>; // X -> events that prevent X
}

export function buildIndex(events: Iterable<AtlasEvent>): CausalIndex {
  const byId = new Map<string, AtlasEvent>();
  const requiredBy = new Map<string, string[]>();
  const preventedBy = new Map<string, string[]>();
  for (const e of events) byId.set(e.id, e);
  for (const e of byId.values()) {
    for (const r of e.links.requires) {
      if (!requiredBy.has(r)) requiredBy.set(r, []);
      requiredBy.get(r)!.push(e.id);
    }
    for (const p of e.links.prevents) {
      if (!preventedBy.has(p)) preventedBy.set(p, []);
      preventedBy.get(p)!.push(e.id);
    }
  }
  return { byId, requiredBy, preventedBy };
}

export interface PropagationResult {
  removed: Map<string, Reason>;
  uncertain: Map<string, Reason>;
  keptDespite: Map<string, Reason>; // events spared by a keep rule although a requirement vanished
}

/**
 * Remove every event that (transitively) requires a removed event, unless a keep
 * rule spares it. Events that were merely *enabled* by a removed event become
 * "uncertain" instead of being silently kept or dropped.
 */
export function propagate(
  index: CausalIndex,
  seeds: Map<string, Reason>,
  keep: Map<string, Reason>,
  seedUncertain: Map<string, Reason> = new Map(),
): PropagationResult {
  const removed = new Map<string, Reason>(seeds);
  const keptDespite = new Map<string, Reason>();
  const queue = [...seeds.keys()];
  while (queue.length) {
    const r = queue.shift()!;
    const removedEv = index.byId.get(r);
    for (const dep of index.requiredBy.get(r) ?? []) {
      if (removed.has(dep)) continue;
      const k = keep.get(dep);
      if (k) {
        if (!keptDespite.has(dep)) keptDespite.set(dep, { ...k, cause: r });
        continue;
      }
      const src = removed.get(r)!;
      removed.set(dep, {
        reason: `requires “${removedEv?.name ?? r}”, which no longer happens`,
        pivot: src.pivot,
        cause: r,
      });
      queue.push(dep);
    }
  }
  const uncertain = new Map<string, Reason>();
  for (const [id, reason] of seedUncertain) if (!removed.has(id) && index.byId.has(id)) uncertain.set(id, reason);
  for (const r of removed.keys()) {
    const ev = index.byId.get(r);
    if (!ev) continue;
    for (const loose of ev.links.enables) {
      if (removed.has(loose) || uncertain.has(loose)) continue;
      if (!index.byId.has(loose)) continue;
      uncertain.set(loose, {
        reason: `was made more likely by “${ev.name}”, which no longer happens`,
        pivot: removed.get(r)!.pivot,
        cause: r,
      });
    }
  }
  // Uncertainty flows downstream along hard dependencies: if X is uncertain,
  // anything that requires X cannot be more certain than X.
  const uq = [...uncertain.keys()];
  while (uq.length) {
    const u = uq.shift()!;
    const uev = index.byId.get(u);
    for (const dep of index.requiredBy.get(u) ?? []) {
      if (removed.has(dep) || uncertain.has(dep)) continue;
      uncertain.set(dep, {
        reason: `requires “${uev?.name ?? u}”, which is itself uncertain`,
        pivot: uncertain.get(u)!.pivot,
        cause: u,
      });
      uq.push(dep);
    }
  }
  return { removed, uncertain, keptDespite };
}
