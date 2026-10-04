// Small helpers for reading Wookieepedia infobox fields out of raw wikitext.

/** Page title from a Wookieepedia URL ("https://starwars.fandom.com/wiki/Taris" -> "Taris"). */
export function titleFromUrl(url) {
  const m = /\/wiki\/([^#?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null;
}

/** Extract the galactic grid square (e.g. "L-9") from an infobox field value or whole wikitext. */
export function parseGridFromWikitext(wikitext) {
  if (!wikitext) return null;
  const fieldMatch = /\|\s*(?:grid|coordinates)\s*=\s*([^\n]*)/i.exec(wikitext);
  const candidate = fieldMatch ? fieldMatch[1] : wikitext;
  const m = /\b([A-V])-(\d{1,2})\b/.exec(candidate);
  if (!m) return null;
  const row = Number(m[2]);
  if (row < 1 || row > 24) return null;
  return `${m[1]}-${row}`;
}

/** Extract the region name from an infobox |region= field, stripping links and markup. */
export function parseRegionFromWikitext(wikitext) {
  const m = /\|\s*region\s*=\s*([^\n]*)/i.exec(wikitext ?? '');
  if (!m) return null;
  return m[1].replace(/<ref[^>]*>.*?<\/ref>/g, '').replace(/<ref[^>]*\/>/g, '').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/'''?/g, '').trim() || null;
}
