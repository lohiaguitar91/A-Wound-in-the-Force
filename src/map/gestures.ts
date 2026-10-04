import type { Camera } from './camera';

export interface GestureHandlers {
  onChange: () => void; // camera moved
  onTap: (sx: number, sy: number) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
}

interface PointerInfo {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

/** Pointer-based pan, pinch-zoom, wheel zoom, tap and keyboard navigation for the map canvas. */
export function attachGestures(canvas: HTMLCanvasElement, camera: Camera, h: GestureHandlers): () => void {
  const pointers = new Map<number, PointerInfo>();
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let moved = false;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let gestureActive = false;
  // Momentum
  let vx = 0;
  let vy = 0;
  let lastMoveT = 0;
  let momentumRaf = 0;

  const rect = () => canvas.getBoundingClientRect();
  const local = (e: PointerEvent): [number, number] => {
    const r = rect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const startGesture = () => {
    if (!gestureActive) {
      gestureActive = true;
      cancelAnimationFrame(momentumRaf);
      canvas.classList.add('dragging');
      h.onGestureStart?.();
    }
  };
  const endGesture = () => {
    if (gestureActive && pointers.size === 0) {
      gestureActive = false;
      canvas.classList.remove('dragging');
      h.onGestureEnd?.();
    }
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { id: e.pointerId, x, y, startX: x, startY: y, startTime: performance.now() });
    moved = false;
    vx = vy = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      pinchStartScale = camera.scale;
    }
    startGesture();
  };

  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = local(e);
    const now = performance.now();
    if (pointers.size === 1) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (!moved && Math.hypot(x - p.startX, y - p.startY) > 6) moved = true;
      if (moved) {
        camera.panBy(dx, dy);
        const dt = Math.max(1, now - lastMoveT);
        vx = dx / dt;
        vy = dy / dt;
        h.onChange();
      }
    } else if (pointers.size === 2) {
      moved = true;
      const other = [...pointers.values()].find((q) => q.id !== e.pointerId)!;
      const prevMidX = (p.x + other.x) / 2;
      const prevMidY = (p.y + other.y) / 2;
      const midX = (x + other.x) / 2;
      const midY = (y + other.y) / 2;
      // Pan by the midpoint delta, then scale around the midpoint.
      camera.panBy(midX - prevMidX, midY - prevMidY);
      const dist = Math.hypot(x - other.x, y - other.y) || 1;
      camera.setScaleAt(midX, midY, pinchStartScale * (dist / pinchStartDist));
      h.onChange();
    }
    p.x = x;
    p.y = y;
    lastMoveT = now;
  };

  const onUp = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    const [x, y] = local(e);
    const dt = performance.now() - p.startTime;
    if (!moved && pointers.size === 0 && dt < 400 && Math.hypot(x - p.startX, y - p.startY) < 8) {
      const now = performance.now();
      if (now - lastTapTime < 320 && Math.hypot(x - lastTapX, y - lastTapY) < 30) {
        // Double tap: zoom in around the point.
        camera.zoomAt(x, y, 1.8);
        h.onChange();
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = x;
        lastTapY = y;
        h.onTap(x, y);
      }
    } else if (moved && pointers.size === 0 && (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05) && !prefersReducedMotion()) {
      // Momentum glide.
      let lx = vx;
      let ly = vy;
      let last = performance.now();
      const step = () => {
        const t = performance.now();
        const dt = t - last;
        last = t;
        camera.panBy(lx * dt, ly * dt);
        lx *= Math.pow(0.9, dt / 16);
        ly *= Math.pow(0.9, dt / 16);
        h.onChange();
        if (Math.abs(lx) > 0.01 || Math.abs(ly) > 0.01) momentumRaf = requestAnimationFrame(step);
      };
      momentumRaf = requestAnimationFrame(step);
    }
    if (pointers.size === 1) {
      // Reset remaining pointer's anchor so the pan continues smoothly.
      const rest = [...pointers.values()][0];
      rest.startX = rest.x;
      rest.startY = rest.y;
    }
    endGesture();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = rect();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    camera.zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
    h.onChange();
  };

  const onKey = (e: KeyboardEvent) => {
    const step = 40;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': camera.panBy(step, 0); break;
      case 'ArrowRight': camera.panBy(-step, 0); break;
      case 'ArrowUp': camera.panBy(0, step); break;
      case 'ArrowDown': camera.panBy(0, -step); break;
      case '+': case '=': camera.zoomAt(camera.width / 2, camera.height / 2, 1.25); break;
      case '-': case '_': camera.zoomAt(camera.width / 2, camera.height / 2, 0.8); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      h.onChange();
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKey);
  };
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
