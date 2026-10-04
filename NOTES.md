# NOTES — decisions, data gaps, lore uncertainties

A running log kept while building the atlas.

## Decisions

- **Scope for this pass.** Depth runs from the Pre-Republic era to Darth Bane's death on Ambria
  (980 BBY), per the owner's request. Later eras get anchor events and territory keyframes so the
  full scrubber works; pivots 8–10 (Order 66, Yavin, Yuuzhan Vong) are deferred.
- **Wookieepedia API blocked in the build environment.** `starwars.fandom.com` is denied by the
  sandbox's network policy (HTTP 403 at the proxy for curl and the fetch tool alike). Data was
  authored from Legends knowledge with a Wookieepedia source URL on every record;
  `scripts/fetch-wookieepedia.mjs` verifies grid squares and URLs once the host is allowed.
  Records whose grid square I could not confirm carry `gridUncertain: true`.
- **Continuity.** Legends throughout. Records drawn from The Old Republic (SWTOR) or the Knights of
  the Old Republic comics are tagged `legends-swtor` / `legends-comics` so they can be filtered or
  flagged later.
- **Dates.** Years are plain numbers, negative for BBY. Several same-year events use fractional
  years purely to order them (3,956.9 BBY is "early in 3,956 BBY"); display truncates toward zero.
- **Time scale.** Piecewise-linear by era weight so the scrubber spends ~36% of its travel on
  5,100–3,500 BBY. Weights live in `data/eras.json`.
- **Territory keyframes are deltas** (what changes at a date) expanded into full snapshots at build
  time. Between keyframes control is a step function; the renderer fades a newly taken system in
  over roughly 0.4% of the scrubber (1–60 years depending on era density) so conquests read as
  spreading rather than popping.
- **Region rings are data-derived** from confident systems rather than hand-drawn, so they stay
  consistent with the systems as the data is corrected. Uncertain squares are ignored when
  deriving them.
- **Canvas 2D over WebGL.** The scene is small; the expensive parts were solved by caching layers
  and reducing raster area, not by shaders.
- **Progressive resolution.** First paint at 1x, full device pixel ratio on first interaction or
  after 3.5 s. Lighthouse's mobile run went from a performance score of 70 to 99 almost entirely
  through this and splitting startup work into sub-50 ms tasks.
- **Pulse animation is time-limited.** Flares pulse for ~2.4 s after a scrub, toggle or pan and
  then settle; a map that animates forever drains phone batteries and showed up as periodic
  long tasks in software-rendered Chrome.
- **Pivot "horizon".** Each branch declares the last date it vouches for. Beyond it, real events
  are shown badged "uncertain" and knock-on removals are grouped under a collapsed heading in
  the What changed list. This is the honest way to show that a 5,000 BBY pivot also erases the
  Sith Emperor's whole timeline without pretending to know what replaces it.
- **Latent events.** `prevents` links only point at events marked `latent: true`, which never show
  in real history; the validator enforces this. There is one per pivot where lore names the
  thing that was averted.

## Lore points I was unsure about (please check against Wookieepedia)

Grid squares flagged `gridUncertain` include: Empress Teta, Kirrek and Primus Goluud (L-10),
Prakith, Had Abbadon, Vulpter, Khomm, Alsakan, Rendili, Corulag, Humbarine, Foerost, Vultar,
Caamas (N-12), Fondor (L-11), Balmorra (L-8), Commenor, Arkania (M-4 — the Colonies region far
north looks odd but matches my memory of the Atlas), Deneba, Carida, Manaan (Q-8), Thyferra,
Yag'Dhul (L-15), Denon (L-12), Bestine IV, Ambria (L-12), Taanab, Hapes, Kuar, Mimban, Serroco,
Dorin, Bothawui (T-11), Malastare (U-9), Ithor (I-7), Lantillies, Ruusan (K-19), Iridonia,
Cerea, Varl, Sleheyron, Ziost (R-4), Khar Delba, Rhelg, Ch'hodos, Ashas Ree, Thule, Nathema
(D-7, placed in the Chorlian sector with Malachor), Ossus (R-7), Nespis VIII, Taris (L-4), Jebble,
Vanquo, Suurja, Telos IV (L-6), Peragus II, Katarr, Rhen Var, Belsavis, Cathar (R-7), Honoghr,
Basilisk, Dathomir, Bandomeer, Bonadan, Quermia, Bastion, Voss, Desevro, Lianna, Raxus Prime,
Corbos, Tund, Makeb, Rodia, Christophsis, Saleucami, Rishi, Sluis Van, Terminus, Apatros,
Lehon (F-9), Csilla, Zakuul, Odessen.

Dates and facts I am least sure of:

- Saul Karath's bombardment of Telos IV: placed in 3,958 BBY.
- The Jedi Order's centre moving from Ossus to Coruscant: placed c. 3,990 BBY and modelled as
  requiring the Cron supernova, which is my inference.
- Kreia's expulsion (3,959) and her arrival at Trayus (3,958); Canderous taking the mask (3,952);
  Revan leaving for the Unknown Regions (3,954): approximate.
- The reconstituted Sith Empire has no canonical end; the territory data fades it in 3,300 BBY
  as a labelled placeholder.
- The Republic's extent at 4,000 BBY and in the Dark Age (1,100–1,000 BBY) is a sketch: the
  Dark Age keyframe hands the Inner Rim through Mid Rim to the Sith and leaves the Core and
  Colonies to the Republic.
- Hutt Space is recorded as Mid Rim for Nal Hutta, Nar Shaddaa, Varl and Sleheyron.
- Hyperlane waypoints are a simplified selection of atlas systems; the Trade Spine's Bespin leg
  follows the Ison Corridor.
- The Great Hunt (c. 3,993–3,990 BBY) and the Kanz Disorders are included at low importance.

## Speculation design notes (per pivot)

1. **Sadow wins (5,000 BBY).** Removes the Republic holding Coruscant; the latent Sith occupation
   appears; territory override gives the Sith the Deep Core and Core except a Republic rump at
   Alsakan, Corellia, Duro, Kuat and Abregado-rae. The Nathema ritual and the Sith Emperor
   never happen, which erases SWTOR's timeline; horizon 4,800 BBY. Declared conflict with pivot 2.
2. **Kun never falls (3,997 BBY).** The Krath war still happens and is won by the Jedi; Ossus is
   never devastated. The Mandalorian Wars become uncertain because Mandalore the Indomitable's
   death on Dxun depended on the Sith war.
3. **Revan stays home (3,963 BBY).** The Mandalorians win the north; negotiated peace in 3,957;
   the Sith Emperor invades early (novel *Revan*). Removes Malachor, the Jedi Civil War and the
   Dark Wars.
4. **No Mass Shadow Generator (3,960 BBY).** Nihilus never exists; the Exile never leaves; the
   clans keep a fleet; Malachor V is intact; the Triumvirate and the First Jedi Purge are uncertain.
5. **Malak's betrayal fails (3,957 BBY).** Revan executes Malak, turns Bastila, takes Coruscant
   intact; Taris and Dantooine are never bombed. Declared conflict with pivot 6.
6. **Revan unredeemed (3,956 BBY).** The game's dark ending: Revan kills Malak on the Star Forge,
   the Republic fleet dies at Lehon, Revan conquers the Core by 3,953.
7. **Bane dies on Ruusan (1,000 BBY).** The Sith truly end; the Banite chain through Sidious is
   removed and with it Naboo, the Clone Wars, Order 66 and the Empire. The Vong invasion is
   marked uncertain. Horizon 20 ABY.

## Known gaps / next steps

- Run `npm run fetch:wiki -- --all` from a network that can reach Wookieepedia and reconcile
  `docs/verification-report.json` with the data (expect several grid corrections).
- Author pivots 8–10 and deepen the later eras (more Clone Wars, Rebellion and Vong events).
- A WebKit Playwright project once a WebKit build is available.
- A faction filter (tap a legend chip to isolate one faction) and an "events here" list grouped
  by era in long system sheets.
