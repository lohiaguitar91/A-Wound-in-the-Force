# NOTES — decisions, data gaps, lore uncertainties

A running log kept while building the atlas. Newest entries at the bottom of each section.

## Decisions

- **2026-10-04 · Scope for this pass.** Depth runs from the Pre-Republic era to Darth Bane's death
  on Ambria (980 BBY), per the owner's request. Later eras get sparse anchor events so the full
  scrubber still works; pivots 8–10 (Order 66, Yavin, Yuuzhan Vong) are deferred.
- **2026-10-04 · Wookieepedia API blocked in the build environment.** `starwars.fandom.com` is denied
  by the sandbox's network policy (HTTP 403 at the proxy for curl and the fetch tool). The data was
  therefore authored from Legends lore knowledge with a Wookieepedia source URL on every record,
  and `scripts/fetch-wookieepedia.mjs` exists to verify grid squares and dates against the live
  API once the host is allowed. Records whose grid square I could not confirm carry `gridUncertain: true`.
