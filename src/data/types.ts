// Types for the normalized atlas document produced by scripts/build-data.mjs.

export interface DateRange {
  start: number; // negative = BBY, positive = ABY
  end: number;
  approx: boolean;
  uncertainty: number;
}

export interface Region {
  id: string;
  name: string;
  short?: string;
  order: number;
  ring: boolean;
}

export interface Era {
  id: string;
  name: string;
  short: string;
  start: number;
  end: number;
}

export interface ScaleSegment {
  start: number;
  end: number;
  weight: number;
}

export interface Faction {
  id: string;
  name: string;
  short: string;
  color: string;
  era: { start: number; end?: number; approx?: boolean };
  kind: string;
  territorial?: boolean;
  summary: string;
  source: string;
  sources?: string[];
  continuity: string;
}

export interface Fate {
  event: string;
  state: 'destroyed' | 'devastated' | 'abandoned' | 'dead';
  until?: number;
}

export interface System {
  id: string;
  name: string;
  aliases?: string[];
  grid: string;
  region: string;
  sector?: string;
  coordinates: { x: number; y: number };
  importance: number;
  summary: string;
  source: string;
  sources?: string[];
  continuity: string;
  fate?: Fate;
  gridUncertain?: boolean;
  tags?: string[];
}

export interface Hyperlane {
  id: string;
  name: string;
  short?: string;
  systems: string[];
  summary: string;
  source: string;
  major?: boolean;
}

export interface CausalLinks {
  requires: string[];
  enables: string[];
  prevents: string[];
}

export interface AtlasEvent {
  id: string;
  name: string;
  type: string;
  date: DateRange;
  location: { system?: string; region?: string; note?: string };
  factions: string[];
  summary: string;
  source: string;
  sources?: string[];
  continuity: string;
  importance: number;
  links: CausalLinks;
  latent?: boolean;
  speculative?: boolean;
  basis?: string;
  tags?: string[];
  era: string;
}

export interface Snapshot {
  date: number;
  note: string;
  source: string;
  control: Record<string, string[]>; // faction -> systems
}

export interface OverrideKeyframe {
  date: number;
  note: string;
  source: string;
  control: Record<string, string[]>; // faction -> systems (already expanded)
  release: string[];
  suppress: string[];
}

export interface EventRef {
  event: string;
  reason: string;
}

export interface FateOverride {
  system: string;
  fate?: Fate | null;
  reason: string;
}

export interface Pivot {
  id: string;
  number: number;
  name: string;
  question: string;
  divergence: { date: number; event: string };
  premise: string;
  basis: { text: string; source: string }[];
  source: string;
  horizon: number;
  branch: {
    remove: EventRef[];
    keep: EventRef[];
    uncertain: EventRef[];
    add: AtlasEvent[];
    territory: OverrideKeyframe[];
    fates: FateOverride[];
  };
  conflicts: { pivot: string; reason: string }[];
}

export interface Atlas {
  meta: { generatedAt: string; continuity: string; counts: Record<string, number> };
  eras: { range: { start: number; end: number }; eras: Era[]; scale: ScaleSegment[] };
  regions: { center: { x: number; y: number }; regions: Region[] };
  factions: Faction[];
  systems: System[];
  hyperlanes: Hyperlane[];
  events: AtlasEvent[];
  territory: Snapshot[];
  pivots: Pivot[];
}
