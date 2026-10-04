import type { AtlasIndex } from '../data/load';
import type { AtlasEvent, Faction, System } from '../data/types';
import { TimeScale } from '../data/time';
import type { BranchResult } from '../engine/branch';
import type { Selection } from '../app/state';
import { Camera, type Bounds, type Insets } from './camera';
import { catmullRom, computeRegionRings, rgba, type RegionRing } from './geometry';
import { makeGalaxyArtBuilder, makeScreenStars, type GalaxyArt } from './starfield';
import { prefersReducedMotion } from './gestures';

export interface FrameInput {
  time: number;
  branch: BranchResult;
  base: BranchResult;
  selection: Selection;
  highlight: Set<string>;
}

export interface ActiveEvent {
  event: AtlasEvent;
  x: number; // world
  y: number;
  proximity: number; // 1 = exactly now, 0 = edge of window
  status: 'kept' | 'added' | 'uncertain';
}

export type Pick = { type: 'system'; id: string } | { type: 'event'; id: string } | null;

const SPEC = '#c678dd';
const UNCERTAIN = '#e5c07b';
const ACCENT = '#e9d8a6';

const TYPE_COLORS: Record<string, string> = {
  battle: '#ff7a59', siege: '#ff7a59', massacre: '#ff5c5c', destruction: '#ff5c5c', war: '#ff9a62', campaign: '#ff9a62', duel: '#ffb199', assassination: '#ff5c5c',
  political: '#7aa2f7', treaty: '#7aa2f7', founding: '#8fd3ff', schism: '#b48ead', exile: '#b48ead',
  discovery: '#e9d8a6', exploration: '#e9d8a6', cultural: '#e9d8a6', religious: '#e9d8a6', disaster: '#e5c07b',
};

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Renderer {
  readonly camera = new Camera();
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 1;
  private cssH = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private dirty = true;
  private raf = 0;
  private input: FrameInput | null = null;
  private screenStars: HTMLCanvasElement | null = null;
  private galaxy: GalaxyArt | null = null;
  private bgLayer: HTMLCanvasElement;
  private bgKey = '';
  private rings: RegionRing[];
  private lanes: { id: string; name: string; path: [number, number][] }[];
  private regionAnchors = new Map<string, [number, number]>();
  private systems: System[];
  private factions: Map<string, Faction>;
  private territoryLayer: HTMLCanvasElement;
  private prevTerritoryLayer: HTMLCanvasElement;
  private staticKey = '';
  private staticLabelBoxes: LabelBox[] = [];
  private scratchA: HTMLCanvasElement;
  private scratchB: HTMLCanvasElement;
  private territoryKey = '';
  private territoryWarm = false; // the very first render is drawn without outlines
  private fadeStart = -1e9;
  private lastBranchKey = '';
  private gestureActive = false;
  private flyRaf = 0;
  private reduced = prefersReducedMotion();
  private activeEvents: ActiveEvent[] = [];
  private labelBoxes: LabelBox[] = [];
  readonly timeScale: TimeScale;
  readonly bounds: Bounds;

  private fx: CanvasRenderingContext2D;
  private fxTimer = 0;
  private lastFxDraw = 0;
  private fxUntil = 0; // pulses run only for a short while after something changes

  constructor(private readonly canvas: HTMLCanvasElement, private readonly fxCanvas: HTMLCanvasElement, private readonly index: AtlasIndex) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const fx = fxCanvas.getContext('2d');
    if (!ctx || !fx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.fx = fx;
    this.systems = index.atlas.systems;
    this.factions = index.factions;
    this.timeScale = new TimeScale(index.atlas.eras.scale);
    const center = index.atlas.regions.center;
    // The galaxy artwork is generated after first paint, one small step per idle
    // callback, so it never produces a long task.
    const builder = makeGalaxyArtBuilder(center);
    const idle = (cb: () => void) => {
      if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback(cb, { timeout: 250 });
      else setTimeout(cb, 16);
    };
    const stepArt = () => {
      if (builder.step()) {
        this.galaxy = builder.art;
        this.bgKey = '';
        this.invalidate();
      } else idle(stepArt);
    };
    idle(stepArt);
    this.rings = computeRegionRings(index.atlas.regions.regions, this.systems, center);
    this.lanes = index.atlas.hyperlanes.map((l) => ({
      id: l.id,
      name: l.short ?? l.name,
      path: catmullRom(l.systems.map((sid) => {
        const s = index.systems.get(sid)!;
        return [s.coordinates.x, s.coordinates.y] as [number, number];
      })),
    }));
    // Region anchors: where region-located events flare.
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const inner = i === 0 ? 0 : this.rings[i - 1].radii[0];
      const bin = 7; // lower-right
      const rad = (inner + r.radii[bin]) / 2 || r.radii[bin] * 0.6;
      const a = (bin / r.radii.length) * Math.PI * 2;
      this.regionAnchors.set(r.id, [center.x + Math.cos(a) * rad, center.y + Math.sin(a) * rad]);
    }
    this.regionAnchors.set('unknown-regions', [3.0, 8.3]);
    this.regionAnchors.set('wild-space', [3.6, 20.3]);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of this.systems) {
      minX = Math.min(minX, s.coordinates.x); minY = Math.min(minY, s.coordinates.y);
      maxX = Math.max(maxX, s.coordinates.x); maxY = Math.max(maxY, s.coordinates.y);
    }
    this.bounds = { minX: minX - 0.6, minY: minY - 0.6, maxX: maxX + 0.6, maxY: maxY + 0.6 };
    this.territoryLayer = document.createElement('canvas');
    this.prevTerritoryLayer = document.createElement('canvas');
    this.bgLayer = document.createElement('canvas');
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.invalidate(); });
    this.scratchA = document.createElement('canvas');
    this.scratchB = document.createElement('canvas');
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => { this.reduced = e.matches; this.invalidate(); });
    }
  }

  // ---- public API -------------------------------------------------------

  private fullRes = false;

  /** Rendering resolution: 1x until the reader interacts (or a few seconds pass), then the device's. */
  private targetDpr(): number {
    const forced = Number(new URLSearchParams(location.search).get('dpr'));
    if (forced > 0) return forced;
    return this.fullRes ? Math.min(window.devicePixelRatio || 1, 3) : 1;
  }

  /** Switch to full device resolution (idempotent). The first paint stays at 1x so it is cheap. */
  enableFullResolution(): void {
    if (this.fullRes) return;
    this.fullRes = true;
    if (this.targetDpr() !== this.dpr) this.resize(this.cssW, this.cssH, this.insets);
  }

  get isFullResolution(): boolean {
    return this.fullRes;
  }

  resize(cssW: number, cssH: number, insets: Insets): void {
    this.cssW = Math.max(1, Math.round(cssW));
    this.cssH = Math.max(1, Math.round(cssH));
    this.insets = insets;
    this.dpr = this.targetDpr();
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    // The animation overlay runs at 1x: it only holds soft pulse rings, and
    // re-rasterising a full-resolution canvas 10 times a second is what hurts phones.
    this.fxCanvas.width = this.cssW;
    this.fxCanvas.height = this.cssH;
    for (const c of [this.canvas, this.fxCanvas]) {
      c.style.width = `${this.cssW}px`;
      c.style.height = `${this.cssH}px`;
    }
    this.camera.resize(this.cssW, this.cssH);
    this.screenStars = makeScreenStars(this.cssW, this.cssH, Math.min(this.dpr, 2));
    const layerDpr = this.layerDpr();
    for (const c of [this.territoryLayer, this.prevTerritoryLayer, this.scratchA, this.scratchB]) {
      c.width = Math.round(this.cssW * layerDpr);
      c.height = Math.round(this.cssH * layerDpr);
    }
    const bgDpr = this.bgDpr();
    this.bgLayer.width = Math.round(this.cssW * bgDpr);
    this.bgLayer.height = Math.round(this.cssH * bgDpr);
    // (re)sizing a canvas clears it, so the scratch canvases start clean
    this.territoryKey = '';
    this.staticKey = '';
    this.bgKey = '';
    this.invalidate();
  }

  /** Initial view: on portrait phones fill the width with the galaxy; otherwise fit it. */
  fitInitial(): void {
    const portrait = this.cssH > this.cssW * 1.1;
    if (portrait) this.camera.fitWidth(this.bounds, this.insets, 1.0);
    else this.camera.fitBounds(this.bounds, this.insets, 0.3);
    this.camera.minScale = Math.min(this.camera.minScale, this.camera.scale * 0.75);
    this.invalidate();
  }

  fitAll(): void {
    this.flyToView(undefined, undefined, undefined, true);
  }

  setInput(input: FrameInput): void {
    const branchKey = input.branch.pivots.join(',');
    if (this.input && branchKey !== this.lastBranchKey && !this.reduced) {
      // Crossfade territory on branch change: keep the old layer around.
      const pctx = this.prevTerritoryLayer.getContext('2d')!;
      pctx.clearRect(0, 0, this.prevTerritoryLayer.width, this.prevTerritoryLayer.height);
      pctx.drawImage(this.territoryLayer, 0, 0);
      this.fadeStart = performance.now();
    }
    const first = this.input === null;
    this.lastBranchKey = branchKey;
    this.input = input;
    this.invalidate();
    // The first frame stays still; flares start pulsing once the reader does something.
    if (!first) this.wake();
  }

  setGestureActive(active: boolean): void {
    this.gestureActive = active;
    this.invalidate();
    if (!active) this.wake(1500);
  }

  invalidate(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** Let the event flares pulse for a moment (after a scrub, toggle or pan), then go quiet. */
  wake(ms = 2400): void {
    this.fxUntil = Math.max(this.fxUntil, performance.now() + ms);
    this.scheduleFx();
  }

  worldToScreen(x: number, y: number): [number, number] {
    return this.camera.worldToScreen(x, y);
  }

  screenPosOf(systemId: string): [number, number] | null {
    const s = this.index.systems.get(systemId);
    if (!s) return null;
    return this.camera.worldToScreen(s.coordinates.x, s.coordinates.y);
  }

  /** Screen-space bounding box of the galaxy disc (outer region ring). */
  galaxyScreenBounds(): { x: number; y: number; w: number; h: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [wx, wy] of this.rings[this.rings.length - 1].path) {
      const [x, y] = this.camera.worldToScreen(wx, wy);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  getView(): { cx: number; cy: number; scale: number; width: number; height: number } {
    const c = this.camera;
    return { cx: c.cx, cy: c.cy, scale: c.scale, width: c.width, height: c.height };
  }

  pick(sx: number, sy: number): Pick {
    const radius = 22;
    let best: Pick = null;
    let bestD = radius;
    for (const s of this.systems) {
      const [x, y] = this.camera.worldToScreen(s.coordinates.x, s.coordinates.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bestD) {
        bestD = d;
        best = { type: 'system', id: s.id };
      }
    }
    if (best) return best;
    for (const a of this.activeEvents) {
      if (a.event.location.system) continue;
      const [x, y] = this.camera.worldToScreen(a.x, a.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bestD) {
        bestD = d;
        best = { type: 'event', id: a.event.id };
      }
    }
    return best;
  }

  /** Animate the camera to centre a world point (optionally at a minimum zoom). */
  flyToView(wx?: number, wy?: number, minScale?: number, fitAll = false): void {
    cancelAnimationFrame(this.flyRaf);
    const from = { cx: this.camera.cx, cy: this.camera.cy, scale: this.camera.scale };
    const target = new Camera();
    target.resize(this.cssW, this.cssH);
    target.cx = from.cx; target.cy = from.cy; target.scale = from.scale;
    target.minScale = this.camera.minScale; target.maxScale = this.camera.maxScale;
    if (fitAll) {
      const portrait = this.cssH > this.cssW * 1.1;
      if (portrait) target.fitWidth(this.bounds, this.insets, 1.0);
      else target.fitBounds(this.bounds, this.insets, 0.3);
    } else if (wx !== undefined && wy !== undefined) {
      if (minScale !== undefined) target.scale = Math.max(from.scale, Math.min(this.camera.maxScale, minScale));
      target.centerOn(wx, wy, this.insets);
    }
    const to = { cx: target.cx, cy: target.cy, scale: target.scale };
    if (this.reduced) {
      Object.assign(this.camera, to);
      this.invalidate();
      return;
    }
    const start = performance.now();
    const dur = 480;
    const step = () => {
      const k = easeOutCubic(Math.min(1, (performance.now() - start) / dur));
      const ls = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * k);
      this.camera.scale = ls;
      this.camera.cx = from.cx + (to.cx - from.cx) * k;
      this.camera.cy = from.cy + (to.cy - from.cy) * k;
      this.invalidate();
      if (k < 1) this.flyRaf = requestAnimationFrame(step);
    };
    this.flyRaf = requestAnimationFrame(step);
  }

  flyToSystem(id: string, minScale = 70): void {
    const s = this.index.systems.get(id);
    if (!s) return;
    this.flyToView(s.coordinates.x, s.coordinates.y, minScale);
  }

  flyToRegion(id: string): void {
    const a = this.regionAnchors.get(id);
    if (a) this.flyToView(a[0], a[1], 30);
  }

  eventWorldPos(e: AtlasEvent): [number, number] | null {
    if (e.location.system) {
      const s = this.index.systems.get(e.location.system);
      return s ? [s.coordinates.x, s.coordinates.y] : null;
    }
    if (e.location.region) return this.regionAnchors.get(e.location.region) ?? null;
    return null;
  }

  /** Events "happening" around time t in the given branch (sorted by proximity). */
  activeEventsAt(t: number, branch: BranchResult): ActiveEvent[] {
    const w = this.eventWindow(t);
    const out: ActiveEvent[] = [];
    for (const e of branch.events) {
      const d = t < e.date.start ? e.date.start - t : t > e.date.end ? t - e.date.end : 0;
      if (d > w) continue;
      const pos = this.eventWorldPos(e);
      if (!pos) continue;
      const st = branch.status.get(e.id)!.status as 'kept' | 'added' | 'uncertain';
      out.push({ event: e, x: pos[0], y: pos[1], proximity: 1 - d / w, status: st });
    }
    return out.sort((a, b) => b.proximity - a.proximity || b.event.importance - a.event.importance);
  }

  eventWindow(t: number): number {
    return Math.min(150, Math.max(0.6, this.timeScale.yearsPerFraction(t) * 0.0015));
  }

  isDark(systemId: string, t: number, branch: BranchResult): { state: string } | null {
    const fate = branch.fates.get(systemId);
    if (!fate) return null;
    const ev = branch.allEvents.get(fate.event);
    if (!ev) return null;
    if (t < ev.date.start) return null;
    if (fate.until !== undefined && t >= fate.until) return null;
    return { state: fate.state };
  }

  // ---- frame ------------------------------------------------------------

  private layerDpr(): number {
    return Math.min(this.dpr, 1);
  }

  private bgDpr(): number {
    return Math.min(this.dpr, 1);
  }

  private frame(): void {
    this.raf = 0;
    if (!this.dirty || !this.input) return;
    this.dirty = false;
    this.counters.frames++;
    const now = performance.now();
    this.draw(now);
    const fading = now - this.fadeStart < 520 && !this.reduced;
    if (fading) this.invalidate();
    this.drawFx(now);
    this.scheduleFx();
  }

  /** The overlay animation loop: cheap pulse rings only, ~15 fps, never while hidden or reduced-motion. */
  private scheduleFx(): void {
    const now = performance.now();
    const wants = this.activeEvents.length > 0 && !this.reduced && !this.gestureActive && !document.hidden && now < this.fxUntil;
    if (!wants || this.fxTimer) {
      if (!wants && !this.fxTimer && this.lastFxDraw > 0 && now >= this.fxUntil) this.drawFx(now, true);
      return;
    }
    this.fxTimer = window.setTimeout(() => {
      this.fxTimer = 0;
      this.counters.fxTimers++;
      if (this.dirty) return; // the main frame will draw fx itself
      this.drawFx(performance.now());
      this.scheduleFx();
    }, 100);
  }

  /** Measure average main-frame draw time over n frames (used by the perf check). */
  benchFrame(n = 20, invalidateCaches = true): number {
    if (!this.input) return 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      if (invalidateCaches) {
        this.bgKey = '';
        this.territoryKey = '';
      }
      this.draw(t0 + i);
    }
    return (performance.now() - t0) / n;
  }

  lastProfile: Record<string, number> = {};
  counters = { frames: 0, fx: 0, territory: 0, bg: 0, fxTimers: 0 };

  private drawFx(now: number, settle = false): void {
    const { fx, camera } = this;
    if (!this.input) return;
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.clearRect(0, 0, this.cssW, this.cssH);
    this.counters.fx++;
    this.lastFxDraw = settle ? 0 : now;
    if (this.reduced || settle) return;
    fx.lineWidth = 1.5;
    for (const a of this.activeEvents) {
      const [x, y] = camera.worldToScreen(a.x, a.y);
      if (x < -40 || x > this.cssW + 40 || y < -40 || y > this.cssH + 40) continue;
      const base = a.status === 'added' ? SPEC : a.status === 'uncertain' ? UNCERTAIN : (TYPE_COLORS[a.event.type] ?? '#ff9a62');
      const ph = (now / 1100 + hash(a.event.id) * 0.1) % 1;
      const r0 = 5 + a.event.importance * 1.6 + a.proximity * 6;
      fx.strokeStyle = rgba(base, (1 - ph) * 0.45 * (0.4 + a.proximity * 0.6));
      fx.setLineDash(a.status === 'added' ? [4, 3] : a.status === 'uncertain' ? [1.5, 3] : []);
      fx.beginPath();
      fx.arc(x, y, r0 + ph * 14, 0, Math.PI * 2);
      fx.stroke();
    }
    fx.setLineDash([]);
    for (const id of this.input.highlight) {
      const s = this.index.systems.get(id);
      if (!s) continue;
      const [x, y] = camera.worldToScreen(s.coordinates.x, s.coordinates.y);
      const ph = (now / 700) % 1;
      fx.strokeStyle = rgba(SPEC, 1 - ph * 0.7);
      fx.lineWidth = 2;
      fx.beginPath();
      fx.arc(x, y, 10 + ph * 8, 0, Math.PI * 2);
      fx.stroke();
    }
  }

  private draw(now: number): void {
    const { ctx, camera } = this;
    const input = this.input!;
    const t = input.time;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#06070d';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (this.screenStars) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.screenStars, 0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
    // The galaxy artwork (the only expensive raster) is cached at low resolution per camera state.
    const sKey = `${camera.cx.toFixed(4)}|${camera.cy.toFixed(4)}|${camera.scale.toFixed(3)}|${this.cssW}x${this.cssH}`;
    const prof = this.lastProfile;
    let p0 = performance.now();
    const lap = (k: string) => { const p1 = performance.now(); prof[k] = p1 - p0; p0 = p1; };
    if (this.galaxy) {
      if (sKey !== this.bgKey) {
        this.bgKey = sKey;
        this.counters.bg++;
        const bctx = this.bgLayer.getContext('2d')!;
        const bd = this.bgDpr();
        bctx.setTransform(bd, 0, 0, bd, 0, 0);
        bctx.clearRect(0, 0, this.cssW, this.cssH);
        const [sx, sy] = camera.worldToScreen(this.galaxy.originX, this.galaxy.originY);
        const size = (this.galaxy.canvas.width * this.galaxy.unitsPerPx) * camera.scale;
        bctx.drawImage(this.galaxy.canvas, sx, sy, size, size);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.bgLayer, 0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
    lap('static');
    this.labelBoxes = [];
    this.drawGrid(ctx);
    this.drawRegions(ctx);
    this.drawLanes(ctx);
    this.staticLabelBoxes = this.labelBoxes;
    lap('staticBlit');
    this.drawTerritory(ctx, t, input, now);
    lap('territory');
    this.activeEvents = this.activeEventsAt(t, input.branch);
    this.labelBoxes = [...this.staticLabelBoxes];
    this.drawEvents(ctx);
    lap('events');
    this.drawSystems(ctx, t, input);
    lap('systems');
    this.drawRegionLabels(ctx);
    this.drawGridLabels(ctx);
    lap('labels');
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const { camera } = this;
    if (camera.scale < 22) return;
    const alpha = Math.min(0.09, (camera.scale - 22) / 400 + 0.03);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= 22; c++) {
      const [x] = camera.worldToScreen(c, 0);
      if (x < -1 || x > this.cssW + 1) continue;
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.cssH);
    }
    for (let r = 0; r <= 24; r++) {
      const [, y] = camera.worldToScreen(0, r);
      if (y < -1 || y > this.cssH + 1) continue;
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.cssW, Math.round(y) + 0.5);
    }
    ctx.stroke();
  }

  private drawGridLabels(ctx: CanvasRenderingContext2D): void {
    const { camera } = this;
    if (camera.scale < 22) return;
    const alpha = Math.min(0.6, (camera.scale - 22) / 60 + 0.25);
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = `rgba(233,216,166,${alpha})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const topY = this.insets.top + 6;
    for (let c = 0; c < 22; c++) {
      const [x] = camera.worldToScreen(c + 0.5, 0);
      if (x < 20 || x > this.cssW - 20) continue;
      ctx.fillText(String.fromCharCode(65 + c), x, topY);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const leftX = this.insets.left + 6;
    for (let r = 0; r < 24; r++) {
      const [, y] = camera.worldToScreen(0, r + 0.5);
      if (y < this.insets.top + 20 || y > this.cssH - this.insets.bottom - 10) continue;
      ctx.fillText(String(r + 1), leftX, y);
    }
  }

  private drawRegions(ctx: CanvasRenderingContext2D): void {
    const { camera } = this;
    const zoomFade = Math.max(0, Math.min(1, (120 - camera.scale) / 80));
    if (zoomFade <= 0) return;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const pts = catmullRom([...r.path, r.path[0], r.path[1]], 4);
      ctx.strokeStyle = `rgba(160,175,220,${0.16 * zoomFade})`;
      ctx.setLineDash([]);
      ctx.beginPath();
      pts.forEach(([wx, wy], k) => {
        const [x, y] = camera.worldToScreen(wx, wy);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }

  private drawRegionLabels(ctx: CanvasRenderingContext2D): void {
    const { camera } = this;
    const labelAlpha = Math.max(0, Math.min(1, (70 - camera.scale) / 40)) * 0.6;
    if (labelAlpha > 0.02) {
      ctx.font = `600 ${camera.scale < 20 ? 10 : 11}px ${this.font()}`;
      ctx.fillStyle = `rgba(190,200,235,${labelAlpha})`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const center = this.index.atlas.regions.center;
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i];
        const inner = i === 0 ? 0 : this.rings[i - 1].radii;
        const bin = Math.round(((r.labelAngle / (Math.PI * 2)) % 1 + 1) * r.radii.length) % r.radii.length;
        const ro = r.radii[bin];
        const ri = inner === 0 ? 0 : (inner as Float32Array)[bin];
        const rad = i === 0 ? ro * 0.55 : (ro + ri) / 2;
        const a = (bin / r.radii.length) * Math.PI * 2;
        const [x, y] = camera.worldToScreen(center.x + Math.cos(a) * rad, center.y + Math.sin(a) * rad);
        if ((ro - ri) * camera.scale < 18 && i > 0) continue;
        this.placeLabel(ctx, r.name.toUpperCase(), x, y, { spacing: 1.5, skipCollision: false });
      }
      for (const [id, pos] of this.regionAnchors) {
        if (id !== 'unknown-regions' && id !== 'wild-space') continue;
        const name = this.index.regions.get(id)?.name ?? id;
        const [x, y] = camera.worldToScreen(pos[0], pos[1]);
        this.placeLabel(ctx, name.toUpperCase(), x, y, { spacing: 1.5, skipCollision: false, align: 'left' });
      }
    }
  }

  private font(): string {
    return 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  }

  private drawLanes(ctx: CanvasRenderingContext2D): void {
    const { camera } = this;
    ctx.lineWidth = camera.scale < 30 ? 1 : 1.5;
    ctx.strokeStyle = 'rgba(233,216,166,0.22)';
    ctx.setLineDash([]);
    for (const lane of this.lanes) {
      ctx.beginPath();
      lane.path.forEach(([wx, wy], k) => {
        const [x, y] = camera.worldToScreen(wx, wy);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    if (camera.scale >= 26) {
      const alpha = Math.min(0.7, (camera.scale - 26) / 30 + 0.3);
      ctx.font = `italic 10px ${this.font()}`;
      ctx.fillStyle = `rgba(233,216,166,${alpha})`;
      for (const lane of this.lanes) {
        const mid = lane.path[Math.floor(lane.path.length * 0.42)];
        const [x, y] = camera.worldToScreen(mid[0], mid[1]);
        this.placeLabel(ctx, lane.name, x, y - 8, { spacing: 0.5, skipCollision: false });
      }
    }
  }

  // ---- territory --------------------------------------------------------

  private territoryRadius(s: System): number {
    return 0.36 + s.importance * 0.05 + 7 / this.camera.scale;
  }

  private drawTerritory(ctx: CanvasRenderingContext2D, t: number, input: FrameInput, now: number): void {
    const { camera } = this;
    const key = `${t}|${input.branch.pivots.join(',')}|${camera.cx.toFixed(3)}|${camera.cy.toFixed(3)}|${camera.scale.toFixed(2)}|${this.gestureActive ? 'g' : 's'}`;
    if (key !== this.territoryKey) {
      this.territoryKey = key;
      this.counters.territory++;
      this.renderTerritoryLayer(t, input);
      if (!this.territoryWarm) {
        // The first render skips outlines; they arrive with the galaxy artwork's frame.
        this.territoryWarm = true;
        this.territoryKey = '';
      }
    }
    const fade = this.reduced ? 1 : Math.min(1, (now - this.fadeStart) / 500);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (fade < 1) {
      ctx.globalAlpha = 1 - fade;
      ctx.drawImage(this.prevTerritoryLayer, 0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.globalAlpha = fade;
    ctx.drawImage(this.territoryLayer, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  private renderTerritoryLayer(t: number, input: FrameInput): void {
    const layer = this.territoryLayer;
    const lctx = layer.getContext('2d')!;
    const d = this.layerDpr();
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, layer.width, layer.height);
    const span = Math.min(60, Math.max(1, this.timeScale.yearsPerFraction(t) * 0.004));
    const control = input.branch.territory.controlAt(t);
    const groups = new Map<string, { s: System; w: number }[]>();
    for (const s of this.systems) {
      const st = control.get(s.id);
      if (!st?.faction) continue;
      const w = Math.min(1, Math.max(0.15, (t - st.since) / span));
      if (!groups.has(st.faction)) groups.set(st.faction, []);
      groups.get(st.faction)!.push({ s, w });
    }
    const detailed = !this.gestureActive && this.territoryWarm;
    if (!this.territoryWarm) this.territoryWarm = false;
    for (const [fid, list] of groups) {
      const f = this.factions.get(fid);
      if (!f) continue;
      this.blob(lctx, d, list, f.color, 0.2, detailed ? 0.6 : 0, false);
    }
    // Ghost outlines of real history where the branch differs.
    if (!input.branch.isBase) {
      const baseControl = input.base.territory.controlAt(t);
      const differing = new Set<string>();
      for (const [sid, st] of baseControl) {
        const b = control.get(sid);
        if (st.faction && st.faction !== (b?.faction ?? null)) differing.add(st.faction);
        if (!st.faction && b?.faction) differing.add(b.faction);
      }
      for (const fid of differing) {
        const f = this.factions.get(fid);
        if (!f) continue;
        const list: { s: System; w: number }[] = [];
        for (const s of this.systems) if (baseControl.get(s.id)?.faction === fid) list.push({ s, w: 1 });
        if (list.length) this.blob(lctx, d, list, f.color, 0, 0.75, true);
      }
    }
  }

  /**
   * Draw a union-of-circles blob for a faction: optional translucent fill
   * plus an outline band computed as (dilated union minus union). Ghost
   * outlines are hatched so speculation is visually distinct from lore.
   */
  private blob(lctx: CanvasRenderingContext2D, d: number, list: { s: System; w: number }[], color: string, fillAlpha: number, lineAlpha: number, ghost: boolean): void {
    const { camera } = this;
    const a = this.scratchA.getContext('2d')!;
    const b = this.scratchB.getContext('2d')!;
    a.setTransform(d, 0, 0, d, 0, 0);
    a.globalCompositeOperation = 'source-over';
    a.fillStyle = color;
    const bandPx = ghost ? 3 : 1.6;
    let any = false;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const { s, w } of list) {
      const [x, y] = camera.worldToScreen(s.coordinates.x, s.coordinates.y);
      const r = this.territoryRadius(s) * camera.scale;
      if (x < -r || x > this.cssW + r || y < -r || y > this.cssH + r) continue;
      any = true;
      bx0 = Math.min(bx0, x - r - bandPx - 2); by0 = Math.min(by0, y - r - bandPx - 2);
      bx1 = Math.max(bx1, x + r + bandPx + 2); by1 = Math.max(by1, y + r + bandPx + 2);
      a.globalAlpha = w;
      a.beginPath();
      a.arc(x, y, r, 0, Math.PI * 2);
      a.fill();
    }
    if (!any) return;
    // Only touch the pixels this faction covers: full-canvas composites are the expensive part.
    const sx = Math.max(0, Math.floor(bx0 * d)), sy = Math.max(0, Math.floor(by0 * d));
    const ex = Math.min(this.scratchA.width, Math.ceil(bx1 * d)), ey = Math.min(this.scratchA.height, Math.ceil(by1 * d));
    const sw = ex - sx, sh = ey - sy;
    if (sw <= 0 || sh <= 0) return;
    a.globalAlpha = 1;
    if (fillAlpha > 0) {
      lctx.globalAlpha = fillAlpha;
      lctx.drawImage(this.scratchA, sx, sy, sw, sh, sx, sy, sw, sh);
    }
    if (lineAlpha > 0) {
      b.setTransform(d, 0, 0, d, 0, 0);
      b.globalCompositeOperation = 'source-over';
      b.fillStyle = color;
      for (const { s, w } of list) {
        const [x, y] = camera.worldToScreen(s.coordinates.x, s.coordinates.y);
        const r = this.territoryRadius(s) * camera.scale + bandPx;
        if (x < -r || x > this.cssW + r || y < -r || y > this.cssH + r) continue;
        b.globalAlpha = Math.min(1, w + 0.25);
        b.beginPath();
        b.arc(x, y, r, 0, Math.PI * 2);
        b.fill();
      }
      b.globalAlpha = 1;
      b.globalCompositeOperation = 'destination-out';
      b.setTransform(1, 0, 0, 1, 0, 0);
      b.drawImage(this.scratchA, sx, sy, sw, sh, sx, sy, sw, sh);
      if (ghost) {
        b.globalCompositeOperation = 'destination-in';
        b.fillStyle = this.hatchPattern(b, color, d);
        b.fillRect(sx, sy, sw, sh);
      }
      b.globalCompositeOperation = 'source-over';
      lctx.globalAlpha = lineAlpha;
      lctx.drawImage(this.scratchB, sx, sy, sw, sh, sx, sy, sw, sh);
      b.setTransform(d, 0, 0, d, 0, 0);
      b.clearRect(bx0 - 2, by0 - 2, bx1 - bx0 + 4, by1 - by0 + 4);
    }
    a.clearRect(bx0 - 2, by0 - 2, bx1 - bx0 + 4, by1 - by0 + 4);
    lctx.globalAlpha = 1;
  }

  /** Soft glow drawn as two translucent discs: far cheaper than a gradient per node. */
  private drawGlow(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number, alpha: number): void {
    ctx.fillStyle = rgba(color, alpha * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(color, alpha * 0.45);
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  private hatchCache = new Map<string, CanvasPattern>();
  private hatchPattern(ctx: CanvasRenderingContext2D, color: string, d: number): CanvasPattern {
    const key = `${color}|${d}`;
    let p = this.hatchCache.get(key);
    if (p) return p;
    const size = Math.round(6 * d);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const x = c.getContext('2d')!;
    x.strokeStyle = color;
    x.lineWidth = Math.max(1, 1.4 * d);
    x.beginPath();
    x.moveTo(0, size);
    x.lineTo(size, 0);
    x.moveTo(-size / 2, size / 2);
    x.lineTo(size / 2, -size / 2);
    x.moveTo(size / 2, size * 1.5);
    x.lineTo(size * 1.5, size / 2);
    x.stroke();
    p = ctx.createPattern(c, 'repeat')!;
    this.hatchCache.set(key, p);
    return p;
  }

  // ---- events & systems -------------------------------------------------

  private drawEvents(ctx: CanvasRenderingContext2D): void {
    const { camera } = this;
    for (const a of this.activeEvents) {
      const [x, y] = camera.worldToScreen(a.x, a.y);
      if (x < -40 || x > this.cssW + 40 || y < -40 || y > this.cssH + 40) continue;
      const base = a.status === 'added' ? SPEC : a.status === 'uncertain' ? UNCERTAIN : (TYPE_COLORS[a.event.type] ?? '#ff9a62');
      const imp = a.event.importance;
      const r0 = 5 + imp * 1.6 + a.proximity * 6;
      // Glow core.
      this.drawGlow(ctx, x, y, base, r0 * 1.6, 0.55 * (0.5 + a.proximity * 0.5));
      // Static ring so reduced-motion users still see the flare.
      ctx.strokeStyle = rgba(base, 0.5 + a.proximity * 0.4);
      ctx.lineWidth = a.status === 'kept' ? 1.2 : 1.6;
      ctx.setLineDash(a.status === 'added' ? [4, 3] : a.status === 'uncertain' ? [1.5, 3] : []);
      ctx.beginPath();
      ctx.arc(x, y, r0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (a.status === 'added') {
        // Diamond marker: speculation.
        ctx.fillStyle = SPEC;
        ctx.beginPath();
        ctx.moveTo(x, y - r0 - 7);
        ctx.lineTo(x + 4, y - r0 - 3);
        ctx.lineTo(x, y - r0 + 1);
        ctx.lineTo(x - 4, y - r0 - 3);
        ctx.closePath();
        ctx.fill();
      } else if (a.status === 'uncertain') {
        ctx.fillStyle = UNCERTAIN;
        ctx.font = `bold 11px ${this.font()}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y - r0 - 6);
      }
      if (!a.event.location.system && camera.scale >= 12) {
        ctx.font = `${camera.scale < 40 ? 10 : 11}px ${this.font()}`;
        ctx.fillStyle = rgba(base, 0.9);
        this.placeLabel(ctx, a.event.name, x, y + r0 + 10, { spacing: 0, skipCollision: false, maxWidth: 150 });
      }
    }
  }

  private drawSystems(ctx: CanvasRenderingContext2D, t: number, input: FrameInput): void {
    const { camera } = this;
    const control = input.branch.territory.controlAt(t);
    const selectedId = input.selection?.type === 'system' ? input.selection.id : input.selection?.type === 'event' ? (input.branch.allEvents.get(input.selection.id)?.location.system ?? null) : null;
    const activeSystems = new Set(this.activeEvents.filter((a) => a.event.location.system).map((a) => a.event.location.system!));
    const minImportance = camera.scale < 18 ? 5 : camera.scale < 34 ? 4 : camera.scale < 70 ? 3 : camera.scale < 140 ? 2 : 1;
    const ordered = [...this.systems].sort((a, b) => {
      const pa = (a.id === selectedId ? 100 : 0) + (input.highlight.has(a.id) ? 50 : 0) + (activeSystems.has(a.id) ? 20 : 0) + a.importance;
      const pb = (b.id === selectedId ? 100 : 0) + (input.highlight.has(b.id) ? 50 : 0) + (activeSystems.has(b.id) ? 20 : 0) + b.importance;
      return pb - pa;
    });
    const fontPx = Math.max(10.5, Math.min(14, 9 + camera.scale * 0.04));
    for (const s of ordered) {
      const [x, y] = camera.worldToScreen(s.coordinates.x, s.coordinates.y);
      if (x < -30 || x > this.cssW + 30 || y < -30 || y > this.cssH + 30) continue;
      const dark = this.isDark(s.id, t, input.branch);
      const holder = control.get(s.id)?.faction ?? null;
      const fcolor = holder ? this.factions.get(holder)?.color ?? null : null;
      const r = Math.max(2.2, Math.min(7, 1.8 + s.importance * 0.55 + camera.scale * 0.012));
      const selected = s.id === selectedId;
      const highlighted = input.highlight.has(s.id);
      if (dark) {
        ctx.fillStyle = '#2b2b33';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = dark.state === 'destroyed' ? 'rgba(224,108,117,0.7)' : 'rgba(150,140,170,0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash(dark.state === 'destroyed' ? [2, 2] : []);
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (dark.state === 'destroyed') {
          ctx.strokeStyle = 'rgba(224,108,117,0.8)';
          ctx.beginPath();
          ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
          ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
          ctx.stroke();
        }
      } else {
        // Glow + core.
        this.drawGlow(ctx, x, y, fcolor ?? ACCENT, r * 2.6, fcolor ? 0.5 : 0.35);
        ctx.fillStyle = '#f4f1e8';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (fcolor) {
          ctx.strokeStyle = fcolor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, r + 1.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (selected || highlighted) {
        ctx.strokeStyle = selected ? ACCENT : SPEC;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      const wantLabel = selected || highlighted || activeSystems.has(s.id) || s.importance >= minImportance;
      if (wantLabel && camera.scale >= 9) {
        ctx.font = `${selected ? '600 ' : ''}${fontPx}px ${this.font()}`;
        ctx.fillStyle = dark ? 'rgba(170,165,180,0.75)' : selected ? ACCENT : 'rgba(236,233,224,0.92)';
        const label = s.gridUncertain && camera.scale > 60 ? `${s.name} ·` : s.name;
        this.placeLabel(ctx, label, x + r + 4, y, { spacing: 0, skipCollision: false, align: 'left', shadow: true });
      }
    }
  }

  private placeLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, opts: { spacing: number; skipCollision: boolean; align?: CanvasTextAlign; maxWidth?: number; shadow?: boolean }): boolean {
    const prevSpacing = (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing;
    if (opts.spacing && 'letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${opts.spacing}px`;
    const m = ctx.measureText(text);
    const w = Math.min(opts.maxWidth ?? 1e9, m.width) + 4;
    const h = 14;
    const align = opts.align ?? 'center';
    const bx = align === 'left' ? x - 2 : x - w / 2;
    const box = { x: bx, y: y - h / 2, w, h };
    if (!opts.skipCollision) {
      for (const o of this.labelBoxes) {
        if (box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y) {
          if (prevSpacing !== undefined) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = prevSpacing;
          return false;
        }
      }
    }
    this.labelBoxes.push(box);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (opts.shadow) {
      ctx.save();
      ctx.strokeStyle = 'rgba(6,7,13,0.85)';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y, opts.maxWidth);
      ctx.restore();
      ctx.fillText(text, x, y, opts.maxWidth);
    } else {
      ctx.fillText(text, x, y, opts.maxWidth);
    }
    if (prevSpacing !== undefined) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = prevSpacing;
    return true;
  }
}
