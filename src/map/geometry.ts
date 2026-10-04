import type { Region, System } from '../data/types';

export interface RegionRing {
  id: string;
  name: string;
  order: number;
  /** Boundary radius per angular bin (outer edge of this region). */
  radii: Float32Array;
  /** Smoothed closed path points in world coordinates. */
  path: [number, number][];
  labelAngle: number;
}

const BINS = 48;

function smoothCircular(values: Float32Array, passes: number): Float32Array {
  let cur = values;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      const a = cur[(i - 2 + cur.length) % cur.length];
      const b = cur[(i - 1 + cur.length) % cur.length];
      const c = cur[i];
      const d = cur[(i + 1) % cur.length];
      const e = cur[(i + 2) % cur.length];
      next[i] = (a + 2 * b + 3 * c + 2 * d + e) / 9;
    }
    cur = next;
  }
  return cur;
}

/**
 * Derive region boundaries from the systems themselves: for each angular bin
 * the outer radius of a region is the furthest system labelled with that
 * region (or an inner one), smoothed around the circle and forced to grow
 * outward region by region. Uncertain grid squares are ignored.
 */
export function computeRegionRings(regions: Region[], systems: System[], center: { x: number; y: number }): RegionRing[] {
  const ring = regions.filter((r) => r.ring).sort((a, b) => a.order - b.order);
  const byOrder = new Map(ring.map((r) => [r.id, r.order]));
  const maxR = new Array<Float32Array>(ring.length).fill(null as unknown as Float32Array).map(() => new Float32Array(BINS));
  for (const s of systems) {
    if (s.gridUncertain) continue;
    const order = byOrder.get(s.region);
    if (order === undefined) continue;
    const dx = s.coordinates.x - center.x;
    const dy = s.coordinates.y - center.y;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const bin = ((Math.round((ang / (Math.PI * 2)) * BINS) % BINS) + BINS) % BINS;
    // A system in region k pushes the boundary of k and of every region inside it is irrelevant;
    // but it does mean regions > k must be at least this far out.
    for (let k = order; k < ring.length; k++) {
      for (const off of [-1, 0, 1]) {
        const b = (bin + off + BINS) % BINS;
        maxR[k][b] = Math.max(maxR[k][b], r + 0.35 - Math.abs(off) * 0.1);
      }
    }
  }
  const baseStep = [1.6, 3.0, 4.0, 5.0, 6.2, 7.8, 10.5];
  const out: RegionRing[] = [];
  let prev: Float32Array | null = null;
  ring.forEach((reg, k) => {
    const raw = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const fallback = baseStep[Math.min(k, baseStep.length - 1)];
      let v = maxR[k][b] > 0 ? maxR[k][b] : 0;
      // Fill empty bins by interpolating from neighbours that have data.
      if (v === 0) {
        let left = 0;
        let right = 0;
        for (let d = 1; d < BINS / 2 && (left === 0 || right === 0); d++) {
          if (left === 0 && maxR[k][(b - d + BINS) % BINS] > 0) left = maxR[k][(b - d + BINS) % BINS];
          if (right === 0 && maxR[k][(b + d) % BINS] > 0) right = maxR[k][(b + d) % BINS];
        }
        v = left && right ? (left + right) / 2 : left || right || fallback;
      }
      const minFromPrev = prev ? prev[b] + 0.7 : 0;
      raw[b] = Math.max(v, minFromPrev, fallback * 0.75);
    }
    const sm = smoothCircular(raw, 3);
    for (let b = 0; b < BINS; b++) if (prev) sm[b] = Math.max(sm[b], prev[b] + 0.6);
    const path: [number, number][] = [];
    for (let b = 0; b < BINS; b++) {
      const a = (b / BINS) * Math.PI * 2;
      path.push([center.x + Math.cos(a) * sm[b], center.y + Math.sin(a) * sm[b]]);
    }
    out.push({ id: reg.id, name: reg.short ?? reg.name, order: reg.order, radii: sm, path, labelAngle: -Math.PI / 2 + 0.35 + k * 0.08 });
    prev = sm;
  });
  return out;
}

/** Catmull-Rom spline through points, returned as a flat list of segment points. */
export function catmullRom(points: [number, number][], segments = 8): [number, number][] {
  if (points.length < 3) return points;
  const out: [number, number][] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  return out;
}

export function pathArea(path: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < path.length; i++) {
    const [x1, y1] = path[i];
    const [x2, y2] = path[(i + 1) % path.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Deterministic pseudo-random generator (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
