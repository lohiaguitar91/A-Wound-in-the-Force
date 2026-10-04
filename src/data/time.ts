import type { DateRange, Era, ScaleSegment } from './types';

const nf = new Intl.NumberFormat('en-US');

/** "3,959 BBY", "4 ABY", "0 BBY". */
export function formatYear(y: number): string {
  const r = Math.trunc(y); // fractional years only order events within a year
  if (r < 0) return `${nf.format(-r)} BBY`;
  if (r > 0) return `${nf.format(r)} ABY`;
  return '0 BBY';
}

/** Compact form used in dense lists: "3,959", "4 ABY". */
export function formatYearShort(y: number): string {
  const r = Math.trunc(y);
  if (r < 0) return nf.format(-r);
  if (r > 0) return `${nf.format(r)} ABY`;
  return '0';
}

/** Human date for an event: handles ranges, approximation and ± uncertainty. */
export function formatDate(d: DateRange): string {
  const c = d.approx ? 'c. ' : '';
  if (d.start === d.end) {
    const base = `${c}${formatYear(d.start)}`;
    return d.uncertainty ? `${base} (±${nf.format(d.uncertainty)} yrs)` : base;
  }
  const sameSide = Math.sign(d.start) === Math.sign(d.end) || d.start === 0 || d.end === 0;
  if (sameSide && d.start < 0) return `${c}${nf.format(-d.start)}–${nf.format(-d.end)} BBY`;
  if (sameSide && d.start >= 0) return `${c}${nf.format(d.start)}–${nf.format(d.end)} ABY`;
  return `${c}${formatYear(d.start)} – ${formatYear(d.end)}`;
}

export function eraAt(eras: Era[], year: number): Era {
  for (const e of eras) if (year >= e.start && year < e.end) return e;
  return year < eras[0].start ? eras[0] : eras[eras.length - 1];
}

/**
 * Piecewise-linear mapping between years and a 0..1 scrubber fraction so dense
 * stretches (the Old Republic) get more thumb travel than empty millennia.
 */
export class TimeScale {
  private readonly segs: { start: number; end: number; f0: number; f1: number }[] = [];
  readonly min: number;
  readonly max: number;

  constructor(scale: ScaleSegment[]) {
    const total = scale.reduce((n, s) => n + s.weight, 0);
    let f = 0;
    for (const s of scale) {
      const w = s.weight / total;
      this.segs.push({ start: s.start, end: s.end, f0: f, f1: f + w });
      f += w;
    }
    this.segs[this.segs.length - 1].f1 = 1;
    this.min = this.segs[0].start;
    this.max = this.segs[this.segs.length - 1].end;
  }

  clamp(year: number): number {
    return Math.min(this.max, Math.max(this.min, year));
  }

  toFraction(year: number): number {
    const y = this.clamp(year);
    for (const s of this.segs) {
      if (y >= s.start && y <= s.end) {
        const t = s.end === s.start ? 0 : (y - s.start) / (s.end - s.start);
        return s.f0 + t * (s.f1 - s.f0);
      }
    }
    return 1;
  }

  fromFraction(f: number): number {
    const x = Math.min(1, Math.max(0, f));
    for (const s of this.segs) {
      if (x >= s.f0 && x <= s.f1) {
        const t = s.f1 === s.f0 ? 0 : (x - s.f0) / (s.f1 - s.f0);
        return s.start + t * (s.end - s.start);
      }
    }
    return this.max;
  }

  /** Years per unit fraction at a given year — how "zoomed in" the scrubber is there. */
  yearsPerFraction(year: number): number {
    const y = this.clamp(year);
    for (const s of this.segs) if (y >= s.start && y <= s.end) return (s.end - s.start) / (s.f1 - s.f0);
    return 1;
  }
}
