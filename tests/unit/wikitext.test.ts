import { describe, expect, it } from 'vitest';
import { parseGridFromWikitext, parseRegionFromWikitext, titleFromUrl } from '../../scripts/lib/wikitext.mjs';

// Synthetic snippets in the shape of an infobox; not copied from any wiki page.
const sample = `{{Planet
|name=Example
|region=[[Outer Rim Territories]]
|sector=[[Example sector]]
|grid=[[Galactic grid|R-5]]
}}
'''Example''' was a planet.`;

describe('wikitext helpers', () => {
  it('extracts titles from source URLs', () => {
    expect(titleFromUrl('https://starwars.fandom.com/wiki/Coruscant/Legends')).toBe('Coruscant/Legends');
    expect(titleFromUrl('https://starwars.fandom.com/wiki/Yag%27Dhul')).toBe("Yag'Dhul");
    expect(titleFromUrl('https://example.com/x')).toBeNull();
  });
  it('reads the grid square from an infobox', () => {
    expect(parseGridFromWikitext(sample)).toBe('R-5');
    expect(parseGridFromWikitext('|coordinates = L-9\n')).toBe('L-9');
    expect(parseGridFromWikitext('|grid = Z-9\n')).toBeNull();
    expect(parseGridFromWikitext('|grid = K-30\n')).toBeNull();
    expect(parseGridFromWikitext('')).toBeNull();
  });
  it('reads the region name without markup', () => {
    expect(parseRegionFromWikitext(sample)).toBe('Outer Rim Territories');
    expect(parseRegionFromWikitext('|region=[[Core Worlds|Core]]<ref>x</ref>')).toBe('Core');
  });
});
