import { loadAtlas, type AtlasIndex } from '../data/load';
import { eraAt, formatYear } from '../data/time';
import { Renderer } from '../map/renderer';
import { attachGestures, prefersReducedMotion } from '../map/gestures';
import { Store, type Selection } from './state';
import { readUrl, writeUrl } from './url';
import { Sheet } from '../ui/sheet';
import { Scrubber } from '../ui/scrubber';
import { renderLegend } from '../ui/legend';
import type { Actions, UiContext } from '../ui/context';
import { renderAbout, renderEvent, renderEventsNow, renderFaction, renderSearch, renderSystem, renderWhatIf } from '../ui/content';
import { h } from '../ui/dom';

declare global {
  interface Window {
    __atlas?: AtlasHooks;
  }
}

/** Hooks used by the Playwright tests and the screenshot script. */
export interface AtlasHooks {
  ready: boolean;
  getView(): { cx: number; cy: number; scale: number; width: number; height: number };
  getTime(): number;
  setTime(t: number): void;
  getPivots(): string[];
  setPivots(ids: string[]): void;
  getState(): { time: number; pivots: string[]; selection: Selection };
  screenPosOf(id: string): [number, number] | null;
  galaxyScreenBounds(): { x: number; y: number; w: number; h: number };
  pivotIds(): string[];
  eraIds(): string[];
  activeEventIds(): string[];
  holdings(): Record<string, number>;
  benchFrame(n?: number, invalidateCaches?: boolean): number;
  profile(): Record<string, number>;
  counters(): Record<string, number>;
  fullRes(): void;
  timings(): Record<string, number>;
}

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

export async function boot(): Promise<void> {
  const app = $('#app');
  const canvas = $<HTMLCanvasElement>('#map');
  const timeReadout = $('#time-readout');
  let index: AtlasIndex;
  performance.mark('atlas:boot');
  try {
    index = await loadAtlas();
    performance.mark('atlas:loaded');
  } catch (err) {
    timeReadout.textContent = 'Could not load atlas data';
    console.error(err);
    return;
  }
  const atlas = index.atlas;
  const url = readUrl();
  const validPivots = new Set(atlas.pivots.map((p) => p.id));
  const store = new Store(atlas, {
    time: url.time ?? -3959,
    pivots: (url.pivots ?? []).filter((p) => validPivots.has(p)),
    selection: url.selection && ((url.selection.type === 'system' && index.systems.has(url.selection.id)) || (url.selection.type === 'event' && index.baseEvents.has(url.selection.id))) ? url.selection : null,
  });
  const renderer = new Renderer(canvas, $<HTMLCanvasElement>('#map-fx'), index);
  performance.mark('atlas:renderer');
  const sheet = new Sheet($('#sheet'));
  const live = $('#live');
  const legendEl = $('#legend');
  const banner = $<HTMLButtonElement>('#whatif-banner');
  const eventsNow = $('#events-now');
  const topbar = $('.topbar');
  const scrubberEl = $('#scrubber');
  let whatIfTab: 'pivots' | 'changes' = 'pivots';

  // ---- layout -----------------------------------------------------------
  const hud = $('.hud');
  const insets = () => {
    const appTop = app.getBoundingClientRect().top;
    const hudBottom = hud.getBoundingClientRect().bottom - appTop;
    return { top: Math.max(topbar.offsetHeight, hudBottom + 4), right: 0, bottom: scrubberEl.offsetHeight, left: 0 };
  };
  let firstLayout = true;
  let lastSize = '';
  const layout = () => {
    const r = app.getBoundingClientRect();
    const sizeKey = `${Math.round(r.width)}x${Math.round(r.height)}|${JSON.stringify(insets())}`;
    if (sizeKey === lastSize) return; // ResizeObserver fires once on observe; skip the duplicate
    lastSize = sizeKey;
    renderer.resize(r.width, r.height, insets());
    if (firstLayout) {
      firstLayout = false;
      renderer.fitInitial();
      if (store.get().selection?.type === 'system') renderer.flyToSystem(store.get().selection!.id, 60);
    }
    scrubber.renderTicks();
  };

  // ---- scrubber ---------------------------------------------------------
  const scrubber = new Scrubber({
    input: $('#time'),
    ticks: $('#era-ticks'),
    readout: timeReadout,
    eraReadout: $('#era-readout'),
    playBtn: $('#btn-play'),
    scale: renderer.timeScale,
    eras: atlas.eras.eras,
    onTime: (t, final) => {
      store.set({ time: t, highlightSystems: [] });
      if (final) announce();
    },
    onPlayToggle: () => store.set({ playing: !store.get().playing }),
  });

  // ---- actions ----------------------------------------------------------
  const actions: Actions = {
    jumpTo(time, doAnnounce) {
      scrubber.setTime(time);
      store.set({ time: renderer.timeScale.clamp(time), playing: false });
      if (doAnnounce) announce();
    },
    showSystem(id, fly) {
      const s = index.systems.get(id);
      if (!s) return;
      store.set({ selection: { type: 'system', id }, highlightSystems: [] });
      sheet.open({ key: `system:${id}`, title: s.name, render: (body) => renderSystem(ctx, body, s), onClose: () => clearSelection(`system:${id}`) });
      if (fly) renderer.flyToSystem(id, 60);
    },
    showEvent(id, fly) {
      const e = store.branch.allEvents.get(id);
      if (!e) return;
      store.set({ selection: { type: 'event', id }, highlightSystems: [] });
      sheet.open({ key: `event:${id}`, title: e.name, render: (body) => renderEvent(ctx, body, e), onClose: () => clearSelection(`event:${id}`) });
      if (fly) {
        if (e.location.system) renderer.flyToSystem(e.location.system, 50);
        else if (e.location.region) renderer.flyToRegion(e.location.region);
      }
    },
    showFaction(id) {
      const f = index.factions.get(id);
      if (!f) return;
      sheet.open({ key: `faction:${id}`, title: f.name, render: (body) => renderFaction(ctx, body, f) });
    },
    showWhatIf(tab) {
      if (tab) whatIfTab = tab;
      sheet.open({
        key: 'whatif',
        title: 'What if…',
        render: (body) => renderWhatIf(ctx, body, whatIfTab, (t) => { whatIfTab = t; sheet.refresh(); }),
        onClose: () => $('#btn-whatif').setAttribute('aria-pressed', 'false'),
      });
      $('#btn-whatif').setAttribute('aria-pressed', 'true');
    },
    showSearch() {
      sheet.open({ key: 'search', title: 'Find', render: (body) => renderSearch(ctx, body) });
    },
    showEventsNow() {
      sheet.open({ key: 'events-now', title: `Events near ${formatYear(store.get().time)}`, render: (body) => renderEventsNow(ctx, body) });
    },
    showAbout() {
      sheet.open({ key: 'about', title: 'About this atlas', render: (body) => renderAbout(ctx, body) });
    },
    togglePivot(id) {
      store.togglePivot(id);
      const on = store.get().pivots.includes(id);
      const p = atlas.pivots.find((x) => x.id === id);
      live.textContent = `${p?.name ?? id} ${on ? 'on' : 'off'}. ${store.branch.changes.length} changes from real history.`;
    },
    flyToSystem(id) {
      renderer.flyToSystem(id, 60);
    },
    highlight(systems) {
      store.set({ highlightSystems: systems });
    },
  };
  const clearSelection = (key: string) => {
    const sel = store.get().selection;
    if (sel && `${sel.type}:${sel.id}` === key) store.set({ selection: null });
  };
  const ctx: UiContext = { index, store, renderer, sheet, actions };

  // ---- gestures ---------------------------------------------------------
  attachGestures(canvas, renderer.camera, {
    onChange: () => { renderer.invalidate(); renderer.wake(1200); },
    onGestureStart: () => renderer.setGestureActive(true),
    onGestureEnd: () => renderer.setGestureActive(false),
    onTap: (x, y) => {
      const p = renderer.pick(x, y);
      // Defer so the browser's synthetic click (fired after pointerup) cannot land on the sheet that opens.
      setTimeout(() => {
        if (!p) {
          if (sheet.isOpen) sheet.close();
          return;
        }
        if (p.type === 'system') actions.showSystem(p.id, false);
        else actions.showEvent(p.id, false);
      }, 0);
    },
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Open the system nearest the viewport centre.
      e.preventDefault();
      const p = renderer.pick(renderer.camera.width / 2, renderer.camera.height / 2);
      if (p?.type === 'system') actions.showSystem(p.id, false);
      else live.textContent = 'No system at the centre of the view. Pan with the arrow keys or use Find.';
    }
  });

  // ---- buttons ----------------------------------------------------------
  $('#btn-search').addEventListener('click', () => actions.showSearch());
  $('#btn-whatif').addEventListener('click', () => (sheet.key === 'whatif' ? sheet.close() : actions.showWhatIf()));
  $('#btn-about').addEventListener('click', () => actions.showAbout());
  $('#btn-events').addEventListener('click', () => actions.showEventsNow());
  $('#btn-zoom-in').addEventListener('click', () => { renderer.camera.zoomAt(renderer.camera.width / 2, renderer.camera.height / 2, 1.5); renderer.invalidate(); });
  $('#btn-zoom-out').addEventListener('click', () => { renderer.camera.zoomAt(renderer.camera.width / 2, renderer.camera.height / 2, 1 / 1.5); renderer.invalidate(); });
  $('#btn-zoom-fit').addEventListener('click', () => renderer.fitAll());
  banner.addEventListener('click', () => actions.showWhatIf('changes'));

  // ---- derived UI -------------------------------------------------------
  const announce = () => {
    const s = store.get();
    const era = eraAt(atlas.eras.eras, s.time);
    const holdings = store.branch.territory.holdingsAt(s.time);
    const active = renderer.activeEventsAt(s.time, store.branch);
    live.textContent = `${formatYear(s.time)}, ${era.name} era. ${holdings.size} factions hold territory. ${active.length} events nearby${active.length ? ': ' + active.slice(0, 3).map((a) => a.event.name).join('; ') : ''}.`;
  };
  const updateCanvasLabel = () => {
    const s = store.get();
    const holdings = store.branch.territory.holdingsAt(s.time);
    const names = [...holdings.keys()].map((id) => index.factions.get(id)?.short ?? id).slice(0, 5).join(', ');
    canvas.setAttribute('aria-label', `Galaxy map at ${formatYear(s.time)}${s.pivots.length ? ' (what-if mode, ' + s.pivots.length + ' pivots)' : ''}. Factions on the map: ${names || 'none'}. Use arrow keys to pan, plus and minus to zoom, Enter to open the system at the centre.`);
  };
  const pushFrame = () => {
    const s = store.get();
    renderer.setInput({ time: s.time, branch: store.branch, base: store.base, selection: s.selection, highlight: new Set(s.highlightSystems) });
  };
  const updateChrome = () => {
    const s = store.get();
    const b = store.branch;
    const holdings = b.territory.holdingsAt(s.time);
    renderLegend(legendEl, holdings, index.factions, !b.isBase);
    app.dataset.mode = b.isBase ? 'history' : 'whatif';
    if (b.isBase) {
      banner.hidden = true;
    } else {
      banner.hidden = false;
      banner.textContent = '';
      const beyond = b.horizon !== null && s.time > b.horizon;
      banner.append(h('strong', null, `What if · ${s.pivots.length} pivot${s.pivots.length === 1 ? '' : 's'}`), ` · ${b.changes.length} changes`, beyond ? ` · beyond ${formatYear(b.horizon!)}: no claims` : '', ' ›');
    }
    const active = renderer.activeEventsAt(s.time, b);
    eventsNow.textContent = active.length ? `${active.length} event${active.length === 1 ? '' : 's'} nearby · ${active[0].event.name}` : 'no events nearby';
    updateCanvasLabel();
  };

  let storeSets = 0;
  store.subscribe((s, prev) => {
    storeSets++;
    pushFrame();
    if (s.time !== prev.time) scrubber.setTime(s.time);
    if (s.time !== prev.time || s.pivots !== prev.pivots) {
      updateChrome();
      if (sheet.isOpen && (sheet.key === 'whatif' || sheet.key?.startsWith('system:') || sheet.key?.startsWith('event:') || sheet.key?.startsWith('faction:') || sheet.key === 'events-now' || sheet.key?.startsWith('pivot:'))) sheet.refresh();
    }
    if (s.playing !== prev.playing) {
      scrubber.setPlaying(s.playing);
      if (s.playing) play();
    }
    writeUrl(s);
  });

  // ---- play -------------------------------------------------------------
  let playRaf = 0;
  const play = () => {
    cancelAnimationFrame(playRaf);
    let last = performance.now();
    const step = () => {
      if (!store.get().playing) return;
      const now = performance.now();
      const dt = Math.min(100, now - last);
      last = now;
      const f = renderer.timeScale.toFraction(store.get().time) + dt * 0.0000125 * (prefersReducedMotion() ? 0.6 : 1);
      if (f >= 1) {
        store.set({ time: renderer.timeScale.max, playing: false });
        return;
      }
      store.set({ time: renderer.timeScale.fromFraction(f) });
      playRaf = requestAnimationFrame(step);
    };
    playRaf = requestAnimationFrame(step);
  };

  // ---- boot -------------------------------------------------------------
  {
    // First paint renders at 1x; go to full device resolution on the first interaction or after a short idle.
    const up = () => renderer.enableFullResolution();
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(type, up, { once: true, passive: true });
    setTimeout(up, 3500);
  }
  {
    // Colour the scrubber track by era using the real time-scale fractions.
    const colors = ['#26304d', '#3b4a7a', '#5b4a3b', '#6a3b3b', '#3b5e4e', '#4d3b6a', '#3b3b3b'];
    const stops = atlas.eras.eras.map((e, i) => `${colors[i % colors.length]} ${(renderer.timeScale.toFraction(e.start) * 100).toFixed(2)}% ${(renderer.timeScale.toFraction(e.end) * 100).toFixed(2)}%`);
    document.documentElement.style.setProperty('--track-bg', `linear-gradient(90deg, ${stops.join(', ')})`);
  }
  new ResizeObserver(() => layout()).observe(app);
  window.addEventListener('orientationchange', () => setTimeout(layout, 60));
  layout();
  performance.mark('atlas:layout');
  scrubber.setTime(store.get().time);
  pushFrame();
  performance.mark('atlas:frame-queued');
  setTimeout(() => { updateChrome(); performance.mark('atlas:chrome'); }, 0);
  if (store.get().selection) {
    const sel = store.get().selection!;
    if (sel.type === 'system') actions.showSystem(sel.id, false);
    else if (sel.type === 'event') actions.showEvent(sel.id, false);
  }

  window.__atlas = {
    ready: true,
    getView: () => renderer.getView(),
    getTime: () => store.get().time,
    setTime: (t) => actions.jumpTo(t, false),
    getPivots: () => [...store.get().pivots],
    setPivots: (ids) => store.set({ pivots: ids.filter((id) => validPivots.has(id)) }),
    getState: () => ({ time: store.get().time, pivots: [...store.get().pivots], selection: store.get().selection }),
    screenPosOf: (id) => renderer.screenPosOf(id),
    galaxyScreenBounds: () => renderer.galaxyScreenBounds(),
    pivotIds: () => atlas.pivots.map((p) => p.id),
    eraIds: () => atlas.eras.eras.map((e) => e.id),
    activeEventIds: () => renderer.activeEventsAt(store.get().time, store.branch).map((a) => a.event.id),
    holdings: () => Object.fromEntries([...store.branch.territory.holdingsAt(store.get().time)].map(([f, l]) => [f, l.length])),
    benchFrame: (n, inv) => renderer.benchFrame(n, inv),
    profile: () => ({ ...renderer.lastProfile }),
    counters: () => ({ ...renderer.counters, storeSets: storeSets }),
    fullRes: () => renderer.enableFullResolution(),
    timings: () => {
      const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('atlas:'));
      const out: Record<string, number> = {};
      for (let i = 1; i < marks.length; i++) out[marks[i].name.slice(6)] = Math.round(marks[i].startTime - marks[i - 1].startTime);
      return out;
    },
  };
  document.dispatchEvent(new CustomEvent('atlas:ready'));
}
