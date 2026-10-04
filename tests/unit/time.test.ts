import { describe, expect, it } from 'vitest';
import { TimeScale, eraAt, formatDate, formatYear } from '../../src/data/time';
import eras from '../../data/eras.json';

describe('formatYear', () => {
  it('formats BBY, ABY and zero', () => {
    expect(formatYear(-3959)).toBe('3,959 BBY');
    expect(formatYear(4)).toBe('4 ABY');
    expect(formatYear(0)).toBe('0 BBY');
    expect(formatYear(-3956.9)).toBe('3,956 BBY');
  });
  it('formats ranges and approximations', () => {
    expect(formatDate({ start: -3976, end: -3960, approx: false, uncertainty: 0 })).toBe('3,976–3,960 BBY');
    expect(formatDate({ start: -7000, end: -7000, approx: true, uncertainty: 0 })).toBe('c. 7,000 BBY');
    expect(formatDate({ start: -6000, end: -6000, approx: true, uncertainty: 500 })).toBe('c. 6,000 BBY (±500 yrs)');
    expect(formatDate({ start: 25, end: 29, approx: false, uncertainty: 0 })).toBe('25–29 ABY');
  });
});

describe('TimeScale', () => {
  const scale = new TimeScale(eras.scale);
  it('covers the full range', () => {
    expect(scale.min).toBe(eras.range.start);
    expect(scale.max).toBe(eras.range.end);
    expect(scale.toFraction(scale.min)).toBe(0);
    expect(scale.toFraction(scale.max)).toBe(1);
  });
  it('round-trips years through fractions', () => {
    for (const y of [-36000, -25053, -5000, -3996, -3959, -3951, -1000, -19, 0, 4, 25, 40, 137]) {
      expect(scale.fromFraction(scale.toFraction(y))).toBeCloseTo(y, 3);
    }
  });
  it('is monotonic', () => {
    let last = -1;
    for (let y = scale.min; y <= scale.max; y += 97) {
      const f = scale.toFraction(y);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
  it('gives the Old Republic the most thumb travel', () => {
    const oldRep = scale.toFraction(-1000) - scale.toFraction(-25053);
    const rest = 1 - oldRep;
    expect(oldRep).toBeGreaterThan(rest);
    const kotor = scale.toFraction(-3500) - scale.toFraction(-5100);
    expect(kotor).toBeGreaterThan(0.3);
  });
  it('reports eras', () => {
    expect(eraAt(eras.eras, -3959).id).toBe('old-republic');
    expect(eraAt(eras.eras, -500).id).toBe('rise-of-the-empire');
    expect(eraAt(eras.eras, 2).id).toBe('rebellion');
    expect(eraAt(eras.eras, 137).id).toBe('legacy');
    expect(eraAt(eras.eras, -30000).id).toBe('pre-republic');
  });
});
