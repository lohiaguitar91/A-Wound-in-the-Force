import type { Atlas } from '../data/types';
import { applyPivots, type BranchResult } from '../engine/branch';

export type Selection = { type: 'system'; id: string } | { type: 'event'; id: string } | { type: 'faction'; id: string } | null;

export interface State {
  time: number;
  pivots: string[];
  selection: Selection;
  playing: boolean;
  highlightSystems: string[];
}

type Listener = (state: State, prev: State) => void;

/** Tiny observable store; the branch result is derived and memoised by pivot key. */
export class Store {
  private state: State;
  private listeners = new Set<Listener>();
  private branchCache = new Map<string, BranchResult>();

  constructor(private readonly atlas: Atlas, initial: Partial<State> = {}) {
    this.state = { time: -3959, pivots: [], selection: null, playing: false, highlightSystems: [], ...initial };
  }

  get(): State {
    return this.state;
  }

  set(patch: Partial<State>): void {
    const prev = this.state;
    const next = { ...prev, ...patch };
    if (patch.pivots) next.pivots = [...patch.pivots];
    this.state = next;
    for (const l of this.listeners) l(next, prev);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  togglePivot(id: string): void {
    const has = this.state.pivots.includes(id);
    this.set({ pivots: has ? this.state.pivots.filter((p) => p !== id) : [...this.state.pivots, id] });
  }

  get branch(): BranchResult {
    const key = [...this.state.pivots].sort().join(',');
    let r = this.branchCache.get(key);
    if (!r) {
      r = applyPivots(this.atlas, this.state.pivots);
      this.branchCache.set(key, r);
    }
    return r;
  }

  get base(): BranchResult {
    let r = this.branchCache.get('');
    if (!r) {
      r = applyPivots(this.atlas, []);
      this.branchCache.set('', r);
    }
    return r;
  }
}
