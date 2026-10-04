import type { Faction } from '../data/types';
import { h, clear } from './dom';

/** Faction chips for whoever holds territory at the current time. */
export function renderLegend(el: HTMLElement, holdings: Map<string, string[]>, factions: Map<string, Faction>, speculative: boolean): void {
  clear(el);
  const rows = [...holdings.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  for (const [fid, list] of rows) {
    const f = factions.get(fid);
    if (!f) continue;
    el.appendChild(
      h('span', { class: 'legend-item', role: 'listitem', title: `${f.name}: ${list.length} systems` },
        h('span', { class: 'swatch', style: { background: f.color, color: f.color } }),
        `${f.short} · ${list.length}`),
    );
  }
  if (holdings.size > rows.length) el.appendChild(h('span', { class: 'legend-item', role: 'listitem' }, `+${holdings.size - rows.length} more`));
  if (speculative) {
    el.appendChild(h('span', { class: 'legend-item spec', role: 'listitem' }, h('span', { class: 'swatch' }), 'dashed = speculation; hatched = real history'));
  }
}
