import type { Era } from '../data/types';
import { TimeScale, eraAt, formatYear } from '../data/time';

export interface ScrubberOptions {
  input: HTMLInputElement;
  ticks: HTMLElement;
  readout: HTMLElement;
  eraReadout: HTMLElement;
  playBtn: HTMLButtonElement;
  scale: TimeScale;
  eras: Era[];
  onTime: (time: number, final: boolean) => void;
  onPlayToggle: () => void;
}

const MAX = 10000;

/** The thumb-reachable time scrubber: a native range input over a piecewise time scale. */
export class Scrubber {
  private time = 0;
  constructor(private readonly o: ScrubberOptions) {
    o.input.min = '0';
    o.input.max = String(MAX);
    o.input.step = '1';
    o.input.addEventListener('input', () => {
      this.time = o.scale.fromFraction(Number(o.input.value) / MAX);
      this.updateReadout();
      o.onTime(this.time, false);
    });
    o.input.addEventListener('change', () => {
      this.time = o.scale.fromFraction(Number(o.input.value) / MAX);
      this.updateReadout();
      o.onTime(this.time, true);
    });
    o.playBtn.addEventListener('click', () => o.onPlayToggle());
    // Tap an era tick to jump there.
    o.ticks.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.era-tick');
      if (!t) return;
      const year = Number(t.dataset.start);
      this.setTime(year);
      o.onTime(year, true);
    });
  }

  setTime(time: number): void {
    this.time = this.o.scale.clamp(time);
    const v = Math.round(this.o.scale.toFraction(this.time) * MAX);
    if (Number(this.o.input.value) !== v) this.o.input.value = String(v);
    this.updateReadout();
  }

  getTime(): number {
    return this.time;
  }

  setPlaying(playing: boolean): void {
    this.o.playBtn.setAttribute('aria-pressed', String(playing));
    this.o.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play through time');
  }

  private updateReadout(): void {
    const era = eraAt(this.o.eras, this.time);
    this.o.readout.textContent = formatYear(this.time);
    this.o.eraReadout.textContent = `${era.name} era`;
    this.o.input.setAttribute('aria-valuetext', `${formatYear(this.time)}, ${era.name} era`);
    for (const el of this.o.ticks.querySelectorAll<HTMLElement>('.era-tick')) el.classList.toggle('active', el.dataset.id === era.id);
  }

  /** Lay out era ticks for the current track width. */
  renderTicks(): void {
    const { ticks, eras, scale } = this.o;
    ticks.textContent = '';
    const width = ticks.clientWidth || 300;
    for (let i = 0; i < eras.length; i++) {
      const e = eras[i];
      const f0 = scale.toFraction(e.start);
      const f1 = scale.toFraction(e.end);
      const px = (f1 - f0) * width;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'era-tick';
      el.dataset.id = e.id;
      el.dataset.start = String(e.start);
      el.style.left = `${(f0 * 100).toFixed(3)}%`;
      el.style.width = `${Math.max(0, (f1 - f0) * 100).toFixed(3)}%`;
      el.setAttribute('aria-label', `Jump to the ${e.name} era`);
      el.textContent = px >= 70 ? e.name : px >= 34 ? e.short : '';
      el.title = e.name;
      ticks.appendChild(el);
    }
    this.updateReadout();
  }
}
