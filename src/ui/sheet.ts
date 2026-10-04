import { clear } from './dom';

export interface SheetOptions {
  key: string;
  title: string;
  render: (body: HTMLElement) => void;
  onClose?: () => void;
}

/** Accessible bottom sheet: Escape/close/swipe-down dismisses, focus is managed. */
export class Sheet {
  private current: SheetOptions | null = null;
  private opener: Element | null = null;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly handle: HTMLElement;
  private readonly onChangeListeners = new Set<(key: string | null) => void>();

  constructor(private readonly root: HTMLElement) {
    this.title = root.querySelector('#sheet-title')!;
    this.body = root.querySelector('#sheet-body')!;
    this.closeBtn = root.querySelector('#sheet-close')!;
    this.handle = root.querySelector('.sheet-handle')!;
    this.title.tabIndex = -1;
    this.closeBtn.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
    });
    // Swipe down on the handle or title to dismiss (never on the buttons).
    let startY = 0;
    let dragging = false;
    let pointerId = -1;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      startY = e.clientY;
      dragging = true;
      pointerId = e.pointerId;
      this.handle.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const dy = Math.max(0, e.clientY - startY);
      root.style.transform = `translateY(${dy}px)`;
    };
    const up = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      const dy = e.clientY - startY;
      root.style.transform = '';
      if (dy > 70) this.close();
    };
    for (const el of [this.handle, this.title]) el.addEventListener('pointerdown', down);
    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', up);
    this.handle.addEventListener('pointercancel', up);
    this.title.addEventListener('pointerup', up);
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  get key(): string | null {
    return this.current?.key ?? null;
  }

  onChange(fn: (key: string | null) => void): void {
    this.onChangeListeners.add(fn);
  }

  open(opts: SheetOptions): void {
    const wasOpen = this.current !== null;
    if (!wasOpen) this.opener = document.activeElement;
    if (this.current?.onClose && this.current.key !== opts.key) this.current.onClose();
    this.current = opts;
    this.root.hidden = false;
    this.root.classList.remove('closing');
    this.title.textContent = opts.title;
    clear(this.body);
    opts.render(this.body);
    this.body.scrollTop = 0;
    if (!wasOpen) this.title.focus({ preventScroll: true });
    for (const l of this.onChangeListeners) l(opts.key);
  }

  /** Re-render the current content (e.g. when time or pivots change). */
  refresh(): void {
    if (!this.current) return;
    const scroll = this.body.scrollTop;
    clear(this.body);
    this.current.render(this.body);
    this.body.scrollTop = scroll;
  }

  close(): void {
    if (!this.current) return;
    const cur = this.current;
    this.current = null;
    this.root.hidden = true;
    clear(this.body);
    cur.onClose?.();
    const opener = this.opener as HTMLElement | null;
    this.opener = null;
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    for (const l of this.onChangeListeners) l(null);
  }
}
