import type { Atlas, AtlasEvent, Faction, Region, System } from './types';

export interface AtlasIndex {
  atlas: Atlas;
  systems: Map<string, System>;
  factions: Map<string, Faction>;
  regions: Map<string, Region>;
  baseEvents: Map<string, AtlasEvent>;
}

export async function loadAtlas(url = './data/atlas.json'): Promise<AtlasIndex> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load atlas data (${res.status})`);
  const atlas = (await res.json()) as Atlas;
  return indexAtlas(atlas);
}

export function indexAtlas(atlas: Atlas): AtlasIndex {
  return {
    atlas,
    systems: new Map(atlas.systems.map((s) => [s.id, s])),
    factions: new Map(atlas.factions.map((f) => [f.id, f])),
    regions: new Map(atlas.regions.regions.map((r) => [r.id, r])),
    baseEvents: new Map(atlas.events.map((e) => [e.id, e])),
  };
}
