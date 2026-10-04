import type { AtlasEvent, Faction, Pivot, System } from '../data/types';
import { formatDate, formatYear } from '../data/time';
import type { Change } from '../engine/branch';
import type { UiContext } from './context';
import { h } from './dom';

const KIND_LABEL: Record<string, string> = {
  removed: 'No longer happens', added: 'Speculative', uncertain: 'Uncertain', kept: 'Kept', territory: 'Territory', fate: 'World', conflict: 'Conflict',
};

function sourceLink(url: string, label = 'Read on Wookieepedia'): HTMLElement {
  return h('p', null, h('a', { class: 'source-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, `${label} ↗`));
}

function factionChip(ctx: UiContext, fid: string): HTMLElement {
  const f = ctx.index.factions.get(fid);
  if (!f) return h('span', { class: 'chip' }, fid);
  return h('button', { type: 'button', class: 'chip', onclick: () => ctx.actions.showFaction(fid), 'aria-label': `Faction: ${f.name}` },
    h('span', { class: 'swatch', style: { background: f.color } }), f.short);
}

function statusChip(ctx: UiContext, id: string): HTMLElement | null {
  const st = ctx.store.branch.status.get(id);
  if (!st) return null;
  if (st.status === 'added') return h('span', { class: 'chip spec' }, '◆ speculation');
  if (st.status === 'uncertain') return h('span', { class: 'chip uncertain' }, '? uncertain');
  if (st.status === 'removed') return h('span', { class: 'chip removed' }, 'no longer happens');
  if (st.status === 'kept' && st.cause) return h('span', { class: 'chip' }, 'kept by branch');
  return null;
}

function eventRow(ctx: UiContext, e: AtlasEvent): HTMLElement {
  const st = ctx.store.branch.status.get(e.id)?.status ?? 'kept';
  const cls = st === 'added' ? 'spec' : st === 'uncertain' ? 'uncertain' : st === 'removed' ? 'removed' : '';
  const sysName = e.location.system ? ctx.index.systems.get(e.location.system)?.name : ctx.index.regions.get(e.location.region ?? '')?.name;
  return h('li', null,
    h('button', { type: 'button', class: `row-btn ${cls}`, onclick: () => ctx.actions.showEvent(e.id) },
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, e.name),
        h('span', { class: 'row-sub' }, `${e.type}${sysName ? ' · ' + sysName : ''}`)),
      h('span', { class: 'row-date' }, formatDate(e.date))));
}

function eventsAtSystem(ctx: UiContext, systemId: string): { visible: AtlasEvent[]; removed: AtlasEvent[] } {
  const b = ctx.store.branch;
  const visible: AtlasEvent[] = [];
  const removed: AtlasEvent[] = [];
  for (const e of b.allEvents.values()) {
    if (e.location.system !== systemId) continue;
    const st = b.status.get(e.id)!.status;
    if (st === 'hidden') continue;
    if (st === 'removed') removed.push(e);
    else visible.push(e);
  }
  const byDate = (a: AtlasEvent, b2: AtlasEvent) => a.date.start - b2.date.start;
  return { visible: visible.sort(byDate), removed: removed.sort(byDate) };
}

export function renderSystem(ctx: UiContext, body: HTMLElement, s: System): void {
  const t = ctx.store.get().time;
  const b = ctx.store.branch;
  const control = b.territory.controlOf(s.id, t);
  const region = ctx.index.regions.get(s.region);
  const dark = ctx.renderer.isDark(s.id, t, b);
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'chip kind' }, `Grid ${s.grid}${s.gridUncertain ? ' (unverified)' : ''}`),
    h('span', { class: 'chip' }, region?.name ?? s.region),
    s.sector ? h('span', { class: 'chip' }, s.sector) : null,
    control.faction ? factionChip(ctx, control.faction) : h('span', { class: 'chip' }, `unclaimed at ${formatYear(t)}`),
    dark ? h('span', { class: 'chip removed', style: { textDecoration: 'none' } }, dark.state) : null,
  );
  body.append(meta);
  if (control.faction) {
    const f = ctx.index.factions.get(control.faction);
    body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal' } }, `Held by ${f?.name ?? control.faction} since ${formatYear(control.since)}${b.isBase ? '' : ' in this timeline'}.`));
  }
  if (s.aliases?.length) body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal' } }, `Also known as ${s.aliases.join(', ')}.`));
  body.append(h('p', { class: 'summary' }, s.summary));
  const fate = b.fates.get(s.id);
  if (fate) {
    const ev = b.allEvents.get(fate.event);
    body.append(h('div', { class: 'callout removed' }, `${fate.state[0].toUpperCase()}${fate.state.slice(1)} ${ev ? 'by “' + ev.name + '” in ' + formatYear(ev.date.start) : ''}${fate.until !== undefined ? ', recovering by ' + formatYear(fate.until) : ''}.`));
  } else if (s.fate && !b.isBase) {
    body.append(h('div', { class: 'callout' }, `Speculation: in this timeline ${s.name} is never ${s.fate.state}.`));
  }
  const { visible, removed } = eventsAtSystem(ctx, s.id);
  if (visible.length) {
    body.append(h('h3', { class: 'section-title' }, `Events here (${visible.length})`));
    body.append(h('ul', { class: 'list' }, visible.map((e) => eventRow(ctx, e))));
  }
  if (removed.length) {
    body.append(h('h3', { class: 'section-title' }, `No longer happen in this timeline (${removed.length})`));
    body.append(h('ul', { class: 'list' }, removed.map((e) => eventRow(ctx, e))));
  }
  body.append(h('div', { class: 'meta', style: { marginTop: '12px' } },
    h('button', { type: 'button', class: 'chip kind', onclick: () => ctx.actions.flyToSystem(s.id) }, '⌖ Centre on map')));
  body.append(sourceLink(s.source));
}

export function renderEvent(ctx: UiContext, body: HTMLElement, e: AtlasEvent): void {
  const b = ctx.store.branch;
  const st = b.status.get(e.id);
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'chip kind' }, formatDate(e.date)),
    h('span', { class: 'chip' }, e.type),
    statusChip(ctx, e.id),
    e.continuity !== 'legends' ? h('span', { class: 'chip' }, e.continuity.replace('legends-', 'Legends · ')) : null,
  );
  body.append(meta);
  if (st && st.status !== 'kept' && st.reason) {
    const cls = st.status === 'added' ? '' : st.status === 'uncertain' ? 'uncertain' : 'removed';
    const pivot = st.pivot ? ctx.index.atlas.pivots.find((p) => p.id === st.pivot) : null;
    body.append(h('div', { class: `callout ${cls}` },
      h('strong', null, st.status === 'added' ? 'Speculation. ' : st.status === 'uncertain' ? 'Uncertain. ' : 'Does not happen. '),
      st.reason.endsWith('.') ? st.reason : st.reason + '.',
      pivot ? ` (Pivot: ${pivot.name}.)` : ''));
  } else if (st?.status === 'kept' && st.cause) {
    body.append(h('div', { class: 'callout' }, h('strong', null, 'Kept by the branch. '), st.reason));
  }
  if (e.location.system) {
    const s = ctx.index.systems.get(e.location.system);
    if (s) body.append(h('div', { class: 'meta' }, h('button', { type: 'button', class: 'chip kind', onclick: () => ctx.actions.showSystem(s.id, true) }, `⌖ ${s.name}${e.location.note ? ' · ' + e.location.note : ''}`)));
  } else if (e.location.region) {
    const r = ctx.index.regions.get(e.location.region);
    body.append(h('div', { class: 'meta' }, h('span', { class: 'chip kind' }, `${r?.name ?? e.location.region}${e.location.note ? ' · ' + e.location.note : ''}`)));
  }
  if (e.factions.length) body.append(h('div', { class: 'meta' }, e.factions.map((f) => factionChip(ctx, f))));
  body.append(h('p', { class: 'summary' }, e.summary));
  if (e.basis) body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal' } }, h('em', null, 'Basis: '), e.basis));
  const related: [string, string[]][] = [
    ['Requires', e.links.requires],
    ['Made possible', e.links.enables],
    ['Prevented', e.links.prevents],
    ['Required by', [...b.allEvents.values()].filter((o) => o.links.requires.includes(e.id)).map((o) => o.id)],
  ];
  for (const [label, ids] of related) {
    const evs = ids.map((id) => b.allEvents.get(id)).filter((x): x is AtlasEvent => Boolean(x) && b.status.get(x!.id)?.status !== 'hidden');
    if (!evs.length) continue;
    body.append(h('h3', { class: 'section-title' }, label));
    body.append(h('ul', { class: 'list' }, evs.map((o) => eventRow(ctx, o))));
  }
  body.append(h('div', { class: 'meta', style: { marginTop: '12px' } },
    h('button', { type: 'button', class: 'chip kind', onclick: () => ctx.actions.jumpTo(e.date.start, true) }, `⏱ Jump scrubber to ${formatYear(e.date.start)}`)));
  body.append(sourceLink(e.source));
  for (const extra of e.sources ?? []) body.append(sourceLink(extra, 'Additional source'));
}

export function renderFaction(ctx: UiContext, body: HTMLElement, f: Faction): void {
  const t = ctx.store.get().time;
  const held = ctx.store.branch.territory.holdingsAt(t).get(f.id) ?? [];
  body.append(h('div', { class: 'meta' },
    h('span', { class: 'chip kind' }, h('span', { class: 'swatch', style: { background: f.color } }), f.kind),
    h('span', { class: 'chip' }, `${formatYear(f.era.start)} – ${f.era.end !== undefined ? formatYear(f.era.end) : 'present'}${f.era.approx ? ' (approx.)' : ''}`),
    h('span', { class: 'chip' }, `${held.length} systems at ${formatYear(t)}`)));
  body.append(h('p', { class: 'summary' }, f.summary));
  if (held.length) {
    body.append(h('h3', { class: 'section-title' }, 'Holds'));
    body.append(h('ul', { class: 'list' }, held.map((sid) => {
      const s = ctx.index.systems.get(sid)!;
      return h('li', null, h('button', { type: 'button', class: 'row-btn', onclick: () => ctx.actions.showSystem(sid, true) },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.name), h('span', { class: 'row-sub' }, ctx.index.regions.get(s.region)?.name ?? s.region)),
        h('span', { class: 'row-date' }, s.grid)));
    })));
  }
  body.append(sourceLink(f.source));
}

export function renderSearch(ctx: UiContext, body: HTMLElement): void {
  const input = h('input', { type: 'search', class: 'search-input', placeholder: 'System or event name…', 'aria-label': 'Search systems and events', autocomplete: 'off' });
  const list = h('ul', { class: 'list' });
  const update = () => {
    const q = input.value.trim().toLowerCase();
    list.textContent = '';
    const systems = ctx.index.atlas.systems.filter((s) => !q || s.name.toLowerCase().includes(q) || s.aliases?.some((a) => a.toLowerCase().includes(q)) || s.grid.toLowerCase() === q);
    const events = q.length >= 2 ? ctx.store.branch.events.filter((e) => e.name.toLowerCase().includes(q)) : [];
    for (const s of systems.sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name)).slice(0, q ? 40 : 20)) {
      list.append(h('li', null, h('button', { type: 'button', class: 'row-btn', onclick: () => ctx.actions.showSystem(s.id, true) },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.name), h('span', { class: 'row-sub' }, `${ctx.index.regions.get(s.region)?.name ?? s.region} · ${s.grid}`)),
        h('span', { class: 'row-date' }, 'system'))));
    }
    for (const e of events.slice(0, 30)) list.append(eventRow(ctx, e));
    if (!list.children.length) list.append(h('li', { class: 'row-sub', style: { padding: '12px 6px' } }, 'No matches.'));
  };
  input.addEventListener('input', update);
  body.append(input, list);
  update();
  setTimeout(() => input.focus({ preventScroll: true }), 50);
}

export function renderEventsNow(ctx: UiContext, body: HTMLElement): void {
  const t = ctx.store.get().time;
  const active = ctx.renderer.activeEventsAt(t, ctx.store.branch);
  const w = ctx.renderer.eventWindow(t);
  body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal' } }, `Events within about ${Math.round(w)} year${Math.round(w) === 1 ? '' : 's'} of ${formatYear(t)}, nearest first.`));
  if (!active.length) {
    body.append(h('p', { class: 'summary' }, 'Nothing is flaring on the map right now. Drag the scrubber to find a war.'));
  } else body.append(h('ul', { class: 'list' }, active.map((a) => eventRow(ctx, a.event))));
}

function changeRow(ctx: UiContext, c: Change): HTMLElement {
  const cls = c.kind === 'removed' ? 'removed' : c.kind === 'uncertain' ? 'uncertain' : c.kind === 'conflict' ? 'removed' : 'spec';
  const go = () => {
    ctx.actions.jumpTo(c.date, true);
    if (c.eventId) ctx.actions.showEvent(c.eventId, true);
    else if (c.systemId) ctx.actions.showSystem(c.systemId, true);
    else if (c.systems?.length) {
      ctx.actions.highlight(c.systems);
      ctx.actions.flyToSystem(c.systems[0]);
    }
  };
  return h('li', { class: 'change' },
    h('button', { type: 'button', class: `row-btn ${cls}`, style: { borderBottom: '0', padding: '4px 0' }, onclick: go },
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title', style: { whiteSpace: 'normal' } }, c.title),
        h('span', { class: 'row-sub', style: { whiteSpace: 'normal' } }, `${KIND_LABEL[c.kind]} · ${c.detail}`)),
      h('span', { class: 'row-date' }, formatYear(c.date))));
}

export function renderWhatIf(ctx: UiContext, body: HTMLElement, tab: 'pivots' | 'changes', setTab: (t: 'pivots' | 'changes') => void): void {
  const state = ctx.store.get();
  const b = ctx.store.branch;
  const tabs = h('div', { class: 'tabs', role: 'tablist' },
    h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(tab === 'pivots'), onclick: () => setTab('pivots') }, `Pivots (${state.pivots.length}/${ctx.index.atlas.pivots.length})`),
    h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(tab === 'changes'), onclick: () => setTab('changes') }, `What changed (${b.changes.length})`));
  body.append(tabs);
  if (tab === 'pivots') {
    body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal', margin: '0 0 6px' } }, 'Flip a pivot and the map re-forms from that date on. Everything a branch adds is speculation, drawn dashed in violet; real history stays as hatched ghost outlines.'));
    for (const c of b.conflicts) {
      const pa = ctx.index.atlas.pivots.find((p) => p.id === c.a)!;
      const pb = ctx.index.atlas.pivots.find((p) => p.id === c.b)!;
      body.append(h('div', { class: 'pivot-conflict', style: { margin: '6px 0' } }, h('strong', null, `Conflict: ${pa.name} × ${pb.name}. `), c.reason));
    }
    for (const p of ctx.index.atlas.pivots) body.append(pivotRow(ctx, p, state.pivots.includes(p.id)));
  } else {
    if (!state.pivots.length) body.append(h('p', { class: 'summary' }, 'No pivots are active. Toggle one on the Pivots tab to see what changes.'));
    else {
      body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal', margin: '0 0 6px' } }, `${b.changes.length} differences from real history, in date order. Tap one to jump the scrubber there.${b.horizon !== null ? ` This branch makes no claims after ${formatYear(b.horizon)}.` : ''}`));
      const within = b.horizon === null ? b.changes : b.changes.filter((c) => c.date <= b.horizon!);
      const beyond = b.horizon === null ? [] : b.changes.filter((c) => c.date > b.horizon!);
      body.append(h('ul', { class: 'list' }, within.map((c) => changeRow(ctx, c))));
      if (beyond.length) {
        body.append(h('details', { class: 'beyond' },
          h('summary', { class: 'row-btn' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `Beyond ${formatYear(b.horizon!)}: ${beyond.length} knock-on changes`), h('span', { class: 'row-sub' }, 'Follow from the causal links, but the branch does not vouch for them'))),
          h('ul', { class: 'list' }, beyond.map((c) => changeRow(ctx, c)))));
      }
    }
  }
}

function pivotRow(ctx: UiContext, p: Pivot, on: boolean): HTMLElement {
  const sw = h('button', {
    type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': `${p.name}`, dataset: { pivot: p.id },
    onclick: () => ctx.actions.togglePivot(p.id),
  });
  return h('div', { class: 'pivot', dataset: { pivotRow: p.id } },
    h('div', null, h('div', { class: 'pivot-name' }, `${p.number}. ${p.name}`), h('div', { class: 'pivot-date' }, `Diverges ${formatYear(p.divergence.date)} · claims end ${formatYear(p.horizon)}`)),
    sw,
    h('p', { class: 'pivot-desc' }, p.question, ' ',
      h('button', { type: 'button', class: 'chip', style: { minHeight: '28px' }, onclick: () => showPivotDetail(ctx, p) }, 'details')));
}

function showPivotDetail(ctx: UiContext, p: Pivot): void {
  ctx.sheet.open({
    key: `pivot:${p.id}`,
    title: p.name,
    render: (body) => {
      const on = ctx.store.get().pivots.includes(p.id);
      body.append(h('div', { class: 'meta' },
        h('span', { class: 'chip kind' }, `Diverges ${formatYear(p.divergence.date)}`),
        h('span', { class: 'chip' }, `Claims end ${formatYear(p.horizon)}`),
        h('button', { type: 'button', class: `chip ${on ? 'spec' : 'kind'}`, onclick: () => { ctx.actions.togglePivot(p.id); } }, on ? 'On — tap to turn off' : 'Off — tap to turn on')));
      body.append(h('div', { class: 'callout' }, h('strong', null, 'Speculation. '), p.premise));
      body.append(h('h3', { class: 'section-title' }, 'What the lore suggests'));
      body.append(h('ul', { class: 'list' }, p.basis.map((b2) => h('li', { style: { padding: '6px 0', fontSize: '13px' } }, b2.text, ' ', h('a', { href: b2.source, target: '_blank', rel: 'noopener noreferrer' }, 'source ↗')))));
      body.append(h('h3', { class: 'section-title' }, 'Branch'));
      body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal' } }, `Removes ${p.branch.remove.length} event${p.branch.remove.length === 1 ? '' : 's'} directly (plus everything that requires them), adds ${p.branch.add.length} speculative, applies ${p.branch.territory.length} territory override${p.branch.territory.length === 1 ? '' : 's'}.`));
      body.append(h('div', { class: 'meta' }, h('button', { type: 'button', class: 'chip kind', onclick: () => ctx.actions.jumpTo(p.divergence.date, true) }, `⏱ Jump to ${formatYear(p.divergence.date)}`)));
      body.append(sourceLink(p.source));
    },
  });
}

export function renderAbout(ctx: UiContext, body: HTMLElement): void {
  const c = ctx.index.atlas.meta.counts;
  body.append(h('p', { class: 'summary' }, 'A fan-made atlas of the Star Wars galaxy in the Legends continuity. Drag the scrubber to move through history, pinch to zoom, tap a system to read about it, and flip a pivot in What-if mode to see the galaxy re-form.'));
  body.append(h('h3', { class: 'section-title' }, 'Reading the map'));
  body.append(h('ul', { class: 'list', style: { fontSize: '13px' } },
    h('li', { style: { padding: '4px 0' } }, 'Coloured blobs are faction territory at the current year; rings fade in over a few years after a conquest.'),
    h('li', { style: { padding: '4px 0' } }, 'Glowing rings are events near the current year; warm for wars, blue for politics, gold for discoveries.'),
    h('li', { style: { padding: '4px 0' } }, 'Dimmed worlds with a ring are devastated; a crossed-out world was destroyed.'),
    h('li', { style: { padding: '4px 0' } }, 'In What-if mode anything violet and dashed is speculation; hatched outlines show real history. A “?” marks events the branch leaves uncertain.'),
    h('li', { style: { padding: '4px 0' } }, 'A dot after a system name at high zoom means its grid square is from memory and still to be verified against Wookieepedia.')));
  body.append(h('h3', { class: 'section-title' }, 'Data'));
  body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal' } }, `${c.systems} systems, ${c.events} events, ${c.factions} factions, ${c.pivots} pivots and ${c.territoryKeyframes} territory keyframes, written in the author's own words from Wookieepedia research. Every record links its source page. Region boundaries and hyperlane paths are approximate and drawn from scratch.`));
  body.append(h('h3', { class: 'section-title' }, 'Factions'));
  body.append(h('ul', { class: 'list' }, ctx.index.atlas.factions.map((f) => h('li', null, h('button', { type: 'button', class: 'row-btn', onclick: () => ctx.actions.showFaction(f.id) },
    h('span', { class: 'swatch', style: { width: '10px', height: '10px', borderRadius: '50%', background: f.color, flex: 'none' } }),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, f.name), h('span', { class: 'row-sub' }, `${formatYear(f.era.start)} – ${f.era.end !== undefined ? formatYear(f.era.end) : 'present'}`)))))));
  body.append(h('h3', { class: 'section-title' }, 'Legal'));
  body.append(h('p', { class: 'row-sub', style: { whiteSpace: 'normal' } }, 'Personal, non-commercial fan project. Not affiliated with, endorsed by or connected to Lucasfilm Ltd., The Walt Disney Company or Fandom, Inc. Star Wars and all related names are trademarks of Lucasfilm Ltd. Text summaries are released under CC BY-SA 3.0 in keeping with Wookieepedia\'s licence; the code is MIT.'));
}
