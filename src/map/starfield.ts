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
 * Covers world x in [-3, 25], y in [-3, 27].
 */
export function makeGalaxyArt(center: { x: number; y: number }, size = 1400): GalaxyArt {
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

  // Disc glow: layered radial gradients, slightly elliptical.
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

  // Spiral arms: soft dots scattered along logarithmic spirals with jitter.
  const rnd = prng(66);
  const arms = 4;
  for (let arm = 0; arm < arms; arm++) {
    const phase = (arm / arms) * Math.PI * 2 + 0.6;
    for (let i = 0; i < 2600; i++) {
      const t = rnd() * 3.2 + 0.25; // angle along the spiral
      const rr = 1.1 * Math.exp(0.52 * t); // world units
      if (rr > 11.8) continue;
      const ang = t + phase;
      const spread = 0.45 + rr * 0.09;
      const jx = (rnd() - 0.5) * spread * 2;
      const jy = (rnd() - 0.5) * spread * 2;
      const wx = center.x + Math.cos(ang) * rr * 1.04 + jx;
      const wy = center.y + Math.sin(ang) * rr * 0.96 + jy;
      const [px, py] = toPx(wx, wy);
      const size = (0.6 + rnd() * 1.4) * (1.3 - rr / 14);
      const alpha = 0.05 + rnd() * 0.16 * (1.25 - rr / 13);
      const warm = rnd() < 0.35;
      ctx.fillStyle = warm ? `rgba(255,215,170,${alpha})` : `rgba(150,175,235,${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, size * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Dust lanes: darker streaks between arms.
  ctx.globalCompositeOperation = 'multiply';
  for (let arm = 0; arm < arms; arm++) {
    const phase = (arm / arms) * Math.PI * 2 + 0.6 + 0.75;
    for (let i = 0; i < 700; i++) {
      const t = rnd() * 3.0 + 0.5;
      const rr = 1.1 * Math.exp(0.52 * t);
      if (rr > 10.5) continue;
      const ang = t + phase;
      const wx = center.x + Math.cos(ang) * rr * 1.04 + (rnd() - 0.5) * 0.9;
      const wy = center.y + Math.sin(ang) * rr * 0.96 + (rnd() - 0.5) * 0.9;
      const [px, py] = toPx(wx, wy);
      ctx.fillStyle = `rgba(90,95,120,${0.08 + rnd() * 0.1})`;
      ctx.beginPath();
      ctx.arc(px, py, 2 + rnd() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  // Field stars in world space for parallax.
  for (let i = 0; i < 1800; i++) {
    const wx = originX + rnd() * extent;
    const wy = originY + rnd() * extent;
    const d = Math.hypot(wx - center.x, wy - center.y);
    if (d > 13.5 && rnd() < 0.6) continue;
    const [px, py] = toPx(wx, wy);
    ctx.fillStyle = `rgba(220,225,255,${0.15 + rnd() * 0.5})`;
    ctx.beginPath();
    ctx.arc(px, py, 0.6 + rnd() * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  return { canvas: c, originX, originY, unitsPerPx };
}
