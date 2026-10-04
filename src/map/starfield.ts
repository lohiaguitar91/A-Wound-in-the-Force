import { prng } from './geometry';

/** A static screen-space star layer, re-rendered on resize. Original artwork, procedurally drawn. */
export function makeScreenStars(width: number, height: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(width * dpr);
  c.height = Math.ceil(height * dpr);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const rnd = prng(1138);
  const n = Math.round((width * height) / 1400);
  for (let i = 0; i < n; i++) {
    const x = rnd() * width;
    const y = rnd() * height;
    const r = rnd() < 0.08 ? 1.1 : 0.55;
    const a = 0.25 + rnd() * 0.6;
    const warm = rnd() < 0.3;
    ctx.fillStyle = warm ? `rgba(255,230,200,${a})` : `rgba(200,215,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

export interface GalaxyArt {
  canvas: HTMLCanvasElement;
  originX: number; // world coords of canvas (0,0)
  originY: number;
  unitsPerPx: number;
}

/**
 * The galaxy's glow and spiral arms drawn once in world space (original art).
 * Covers world x in [-3, 25], y in [-3, 27]. Built in small steps so the work
 * can be spread across idle callbacks instead of blocking first paint.
 */
export interface GalaxyArtBuilder {
  art: GalaxyArt;
  /** Perform one chunk of drawing; returns true when finished. */
  step(): boolean;
}

export function makeGalaxyArtBuilder(center: { x: number; y: number }, size = 1024): GalaxyArtBuilder {
  const originX = -3;
  const originY = -3;
  const extent = 30; // world units covered
  const unitsPerPx = extent / size;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const toPx = (wx: number, wy: number): [number, number] => [(wx - originX) / unitsPerPx, (wy - originY) / unitsPerPx];
  const [cxp, cyp] = toPx(center.x, center.y);
  const R = 11.5 / unitsPerPx; // disc radius in px
  const rnd = prng(66);
  const arms = 4;
  const groups = new Map<string, number[]>();
  const push = (style: string, x: number, y: number, r: number) => {
    let g = groups.get(style);
    if (!g) groups.set(style, (g = []));
    g.push(x, y, r);
  };
  const q = (a: number) => Math.max(0.03, Math.round(a * 25) / 25);
  const flush = () => {
    for (const [style, arr] of groups) {
      ctx.fillStyle = style;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 3) {
        ctx.moveTo(arr[i] + arr[i + 2], arr[i + 1]);
        ctx.arc(arr[i], arr[i + 1], arr[i + 2], 0, Math.PI * 2);
      }
      ctx.fill();
    }
    groups.clear();
  };
  const steps: (() => void)[] = [
    () => {
      // Disc glow: layered radial gradient, slightly elliptical.
      ctx.save();
      ctx.translate(cxp, cyp);
      ctx.scale(1.04, 0.96);
      const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
      g1.addColorStop(0, 'rgba(255,236,200,0.55)');
      g1.addColorStop(0.08, 'rgba(240,215,180,0.35)');
      g1.addColorStop(0.3, 'rgba(120,140,200,0.18)');
      g1.addColorStop(0.7, 'rgba(60,70,120,0.1)');
      g1.addColorStop(1, 'rgba(20,24,48,0)');
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  ];
  for (let arm = 0; arm < arms; arm++) {
    steps.push(() => {
      const phase = (arm / arms) * Math.PI * 2 + 0.6;
      for (let i = 0; i < 1300; i++) {
        const t = rnd() * 3.2 + 0.25;
        const rr = 1.1 * Math.exp(0.52 * t);
        if (rr > 11.8) continue;
        const ang = t + phase;
        const spread = 0.45 + rr * 0.09;
        const wx = center.x + Math.cos(ang) * rr * 1.04 + (rnd() - 0.5) * spread * 2;
        const wy = center.y + Math.sin(ang) * rr * 0.96 + (rnd() - 0.5) * spread * 2;
        const [px, py] = toPx(wx, wy);
        const sz = (0.6 + rnd() * 1.4) * (1.3 - rr / 14) * 2.2;
        const alpha = q((0.05 + rnd() * 0.16 * (1.25 - rr / 13)) * 1.4);
        push(rnd() < 0.35 ? `rgba(255,215,170,${alpha})` : `rgba(150,175,235,${alpha})`, px, py, sz);
      }
      flush();
    });
  }
  steps.push(() => {
    // Dust lanes: darker streaks between arms.
    ctx.globalCompositeOperation = 'multiply';
    for (let arm = 0; arm < arms; arm++) {
      const phase = (arm / arms) * Math.PI * 2 + 0.6 + 0.75;
      for (let i = 0; i < 350; i++) {
        const t = rnd() * 3.0 + 0.5;
        const rr = 1.1 * Math.exp(0.52 * t);
        if (rr > 10.5) continue;
        const ang = t + phase;
        const wx = center.x + Math.cos(ang) * rr * 1.04 + (rnd() - 0.5) * 0.9;
        const wy = center.y + Math.sin(ang) * rr * 0.96 + (rnd() - 0.5) * 0.9;
        const [px, py] = toPx(wx, wy);
        push(`rgba(90,95,120,${q(0.08 + rnd() * 0.1)})`, px, py, 2 + rnd() * 4);
      }
    }
    flush();
    ctx.globalCompositeOperation = 'source-over';
  });
  steps.push(() => {
    // Field stars in world space for parallax.
    for (let i = 0; i < 1000; i++) {
      const wx = originX + rnd() * extent;
      const wy = originY + rnd() * extent;
      const d = Math.hypot(wx - center.x, wy - center.y);
      if (d > 13.5 && rnd() < 0.6) continue;
      const [px, py] = toPx(wx, wy);
      push(`rgba(220,225,255,${q(0.15 + rnd() * 0.5)})`, px, py, 0.6 + rnd() * 0.9);
    }
    flush();
  });
  let i = 0;
  return {
    art: { canvas: c, originX, originY, unitsPerPx },
    step: () => {
      if (i < steps.length) steps[i++]();
      return i >= steps.length;
    },
  };
}

/** Convenience: build the whole artwork synchronously (tests, screenshots). */
export function makeGalaxyArt(center: { x: number; y: number }, size = 1024): GalaxyArt {
  const b = makeGalaxyArtBuilder(center, size);
  while (!b.step()) { /* run every step */ }
  return b.art;
}
