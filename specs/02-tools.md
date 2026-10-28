# Spec 02 — Tools (as built, 28-Oct-2026)

Every tool wraps one external call (Qloo, OpenStreetMap or Tavily), returns typed data, and appends a trace entry `{source, url_without_key, ms, cached, error?}` to the request's trace, shown in the "How I know" tab. The Qloo key never leaves the server. Code: `src/tools.js`, `src/launch.js`.

| Tool | Call | Returns |
| --- | --- | --- |
| `geocode(address)` | Nominatim search (or "lat, lon" typed directly) | `{lat, lon, display_name}` |
| `resolveConcept(parts)` | `/v2/tags` with `filter.tag.types` genre / category / specialty dish, per query word | per part: heat-map tag, competitor tag and up to 3 candidates of each, scored by word overlap |
| `tagInUse(lat, lon, tag)` | `/v2/insights` place, 5 km, `take=1` | whether a tag is used for places nearby (an empty competitor list only counts if it is) |
| `heatmap(lat, lon, 1500, tag)` | `/v2/insights?filter.type=urn:heatmap&signal.interests.tags=` | cells `{lat, lon, affinity, affinity_rank, popularity}`, demand around the address |
| `nearbyCompetitors(lat, lon, 700, tag)` | `/v2/insights` place + `filter.tags` | open rivals with id, rating, price level, distance |
| `rivalsAround(lat, lon, 1500, tag)` | same, 1.5 km, `take=50` | rivals used to judge alternative blocks |
| `placesNear(lat, lon, 200)` | `/v2/insights` place, 200 m | count: shopping street or park |
| `zoneProfile(lat, lon, 500)` | `/v2/insights` place, 500 m, `take=50` | what the popular places serve, kind, who goes, when, and their names |
| `priceGap(competitors)` | none (pure) | rivals per price level with the best-rated; a level is open when nobody there is rated 4.5+ |
| `verifyBusiness(name, city)` | Tavily search | `{exists, url, title}`; found only if the name appears in a result title or URL |
| `streetAt(lat, lon)` | Nominatim reverse | street and neighbourhood for poster zones |
| `launchCandidates(ctx)` | `/v2/insights` artist / brand / place (600 m) with `signal.interests.entities` = best-rated rivals | music, brands, non-competing neighbours, poster zones (spec 04) |

Chat and agent tools (`chatTools` in `src/agent.js`): `nearby_competitors` (radius, exclude names → recomputed verdict), `analyse_address` (address or "lat, lon" → verdict there), `zone_profile` (lat/lon, radius), `verify_business`; the scout adds `candidate_spots` (blocks the rules already rate better, computed during the analysis).
