import type { State } from './state';

export interface UrlState {
  time?: number;
  pivots?: string[];
  selection?: { type: 'system' | 'event' | 'faction'; id: string };
}

export function readUrl(): UrlState {
  const out: UrlState = {};
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return out;
  const params = new URLSearchParams(hash);
  const t = params.get('t');
  if (t !== null && Number.isFinite(Number(t))) out.time = Number(t);
  const p = params.get('p');
  if (p) out.pivots = p.split(',').filter(Boolean);
  const s = params.get('s');
  if (s) out.selection = { type: 'system', id: s };
  const e = params.get('e');
  if (e) out.selection = { type: 'event', id: e };
  return out;
}

let pending: number | null = null;
export function writeUrl(state: State): void {
  if (pending !== null) cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    pending = null;
    const params = new URLSearchParams();
    params.set('t', String(Math.round(state.time * 10) / 10));
    if (state.pivots.length) params.set('p', state.pivots.join(','));
    if (state.selection?.type === 'system') params.set('s', state.selection.id);
    if (state.selection?.type === 'event') params.set('e', state.selection.id);
    const next = `#${params.toString()}`;
    if (next !== location.hash) history.replaceState(null, '', next);
  });
}
