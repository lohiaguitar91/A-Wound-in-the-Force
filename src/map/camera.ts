export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * World units are galactic grid squares (x 0..22, y 0..24). The camera maps
 * them to CSS pixels: screen = (world - center) * scale + viewport/2.
 */
export class Camera {
  cx = 11;
  cy = 11.4;
  scale = 30; // px per world unit
  width = 1;
  height = 1;
  minScale = 8;
  maxScale = 420;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [(wx - this.cx) * this.scale + this.width / 2, (wy - this.cy) * this.scale + this.height / 2];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.width / 2) / this.scale + this.cx, (sy - this.height / 2) / this.scale + this.cy];
  }

  panBy(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.scale;
    this.cy -= dyPx / this.scale;
    this.clamp();
  }

  /** Zoom by a factor keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const [nx, ny] = this.worldToScreen(wx, wy);
    this.cx += (nx - sx) / this.scale;
    this.cy += (ny - sy) / this.scale;
    this.clamp();
  }

  setScaleAt(sx: number, sy: number, scale: number): void {
    this.zoomAt(sx, sy, scale / this.scale);
  }

  /** Fit bounds into the viewport minus insets. */
  fitBounds(b: Bounds, insets: Insets, pad = 0.4): void {
    const availW = Math.max(40, this.width - insets.left - insets.right);
    const availH = Math.max(40, this.height - insets.top - insets.bottom);
    const bw = b.maxX - b.minX + pad * 2;
    const bh = b.maxY - b.minY + pad * 2;
    this.scale = Math.min(availW / bw, availH / bh);
    this.minScale = Math.min(this.minScale, this.scale * 0.6);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    // Centre the bounds within the inset area.
    const midX = (b.minX + b.maxX) / 2;
    const midY = (b.minY + b.maxY) / 2;
    const offX = (insets.left - insets.right) / 2;
    const offY = (insets.top - insets.bottom) / 2;
    this.cx = midX - offX / this.scale;
    this.cy = midY - offY / this.scale;
  }

  /** Fit bounds to the full available width (portrait phones), centred vertically in the inset area. */
  fitWidth(b: Bounds, insets: Insets, overflow = 1.0): void {
    const availW = Math.max(40, this.width - insets.left - insets.right);
    const bw = b.maxX - b.minX;
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, (availW / bw) * overflow));
    const midX = (b.minX + b.maxX) / 2;
    const midY = (b.minY + b.maxY) / 2;
    const offX = (insets.left - insets.right) / 2;
    const offY = (insets.top - insets.bottom) / 2;
    this.cx = midX - offX / this.scale;
    this.cy = midY - offY / this.scale;
  }

  centerOn(wx: number, wy: number, insets: Insets): void {
    const offX = (insets.left - insets.right) / 2;
    const offY = (insets.top - insets.bottom) / 2;
    this.cx = wx - offX / this.scale;
    this.cy = wy - offY / this.scale;
    this.clamp();
  }

  private clamp(): void {
    // Keep the galaxy from being panned entirely off screen.
    const margin = 4;
    this.cx = Math.min(22 + margin, Math.max(-margin, this.cx));
    this.cy = Math.min(24 + margin, Math.max(-margin, this.cy));
  }
}
