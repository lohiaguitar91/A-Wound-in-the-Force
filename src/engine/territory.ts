import type { OverrideKeyframe, Snapshot } from '../data/types';

export interface ControlState {
  faction: string | null;
  since: number; // year this faction's hold began (for fades)
}

interface SystemOverride {
  date: number;
  faction: string | null;
  pivot: string;
}

/**
 * Resolves "who controls which system at year t" from base keyframe snapshots
 * plus (optionally) branch overrides that persist from their date onward.
 */
export class TerritoryModel {
  private readonly snaps: Snapshot[];
  private readonly baseControl: Map<string, string | null>[] = []; // per snapshot: system -> faction
  private readonly baseSince: Map<string, number>[] = [];
  private readonly overrides = new Map<string, SystemOverride[]>();
  private readonly suppress: { date: number; faction: string }[] = [];
  readonly systems: string[];

  constructor(snapshots: Snapshot[], systems: string[], overrides: (OverrideKeyframe & { pivot: string })[] = []) {
    this.snaps = [...snapshots].sort((a, b) => a.date - b.date);
    this.systems = systems;
    let prev = new Map<string, string | null>();
    let prevSince = new Map<string, number>();
    for (const s of this.snaps) {
      const cur = new Map<string, string | null>();
      const since = new Map<string, number>();
      for (const [faction, list] of Object.entries(s.control)) {
        for (const sid of list) {
          cur.set(sid, faction);
          since.set(sid, prev.get(sid) === faction ? (prevSince.get(sid) ?? s.date) : s.date);
        }
      }
      this.baseControl.push(cur);
      this.baseSince.push(since);
      prev = cur;
      prevSince = since;
    }
    const sorted = [...overrides].sort((a, b) => a.date - b.date);
    for (const k of sorted) {
      for (const sid of k.release) this.push(sid, { date: k.date, faction: null, pivot: k.pivot });
      for (const [faction, list] of Object.entries(k.control)) {
        for (const sid of list) this.push(sid, { date: k.date, faction, pivot: k.pivot });
      }
      for (const faction of k.suppress) this.suppress.push({ date: k.date, faction });
    }
  }

  private push(sid: string, o: SystemOverride): void {
    if (!this.overrides.has(sid)) this.overrides.set(sid, []);
    const list = this.overrides.get(sid)!;
    // Same date: later pivot in the list wins (caller sorts pivots deterministically).
    const i = list.findIndex((x) => x.date === o.date);
    if (i >= 0) list[i] = o;
    else list.push(o);
  }

  get hasOverrides(): boolean {
    return this.overrides.size > 0 || this.suppress.length > 0;
  }

  snapshotIndexAt(t: number): number {
    let lo = 0;
    let hi = this.snaps.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.snaps[mid].date <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  snapshotAt(t: number): Snapshot | null {
    const i = this.snapshotIndexAt(t);
    return i < 0 ? null : this.snaps[i];
  }

  /** Date of the next base keyframe after t, or null. */
  nextKeyframe(t: number): number | null {
    const i = this.snapshotIndexAt(t);
    return i + 1 < this.snaps.length ? this.snaps[i + 1].date : null;
  }

  private overrideFor(sid: string, t: number): SystemOverride | null {
    const list = this.overrides.get(sid);
    if (!list) return null;
    let best: SystemOverride | null = null;
    for (const o of list) if (o.date <= t) best = o;
    return best;
  }

  controlOf(sid: string, t: number): ControlState {
    const o = this.overrideFor(sid, t);
    if (o) return { faction: o.faction, since: o.date };
    const i = this.snapshotIndexAt(t);
    if (i < 0) return { faction: null, since: -Infinity };
    let faction = this.baseControl[i].get(sid) ?? null;
    let since = this.baseSince[i].get(sid) ?? this.snaps[i].date;
    if (faction && this.suppress.length) {
      for (const s of this.suppress) {
        if (s.faction === faction && s.date <= t) {
          faction = null;
          since = s.date;
          break;
        }
      }
    }
    return { faction, since };
  }

  /** Full control map at t: system -> state (systems with no holder are included with faction null). */
  controlAt(t: number): Map<string, ControlState> {
    const out = new Map<string, ControlState>();
    for (const sid of this.systems) out.set(sid, this.controlOf(sid, t));
    return out;
  }

  /** Faction -> systems held at t (for legends and diffs). */
  holdingsAt(t: number): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [sid, st] of this.controlAt(t)) {
      if (!st.faction) continue;
      if (!out.has(st.faction)) out.set(st.faction, []);
      out.get(st.faction)!.push(sid);
    }
    for (const list of out.values()) list.sort();
    return out;
  }
}

/** Systems whose holder differs between two control maps. */
export function diffControl(a: Map<string, ControlState>, b: Map<string, ControlState>): { system: string; from: string | null; to: string | null }[] {
  const out: { system: string; from: string | null; to: string | null }[] = [];
  for (const [sid, sa] of a) {
    const sb = b.get(sid);
    const to = sb ? sb.faction : null;
    if (sa.faction !== to) out.push({ system: sid, from: sa.faction, to });
  }
  return out.sort((x, y) => x.system.localeCompare(y.system));
}
