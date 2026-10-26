# Spec 02 — Agent tools

Every tool wraps one Qloo (or Tavily) call, returns typed data, and appends a trace entry `{tool, url_without_key, ms, cached}` to the request's trace. The trace is shown to the user in the "How I know" tab. The Qloo key never leaves the server.

| Tool | Qloo / Tavily call | Returns |
| --- | --- | --- |
| `geocode(address)` | Nominatim (OpenStreetMap) | `{lat, lon, display_name}` |
| `concept_to_tags(concept)` | `/v2/tags?filter.query=` (+ LLM pick) | `{category_tag, heatmap_tag, label}` |
| `nearby_competitors(lat, lon, radius, tag)` | `/v2/insights?filter.type=urn:entity:place&filter.location=POINT()&filter.location.radius=&filter.tags=` | places with name, rating, price_level, distance_m, address |
| `zone_taste(lat, lon, radius)` | `/v2/insights?filter.type=urn:tag&signal.location=POINT()&signal.location.radius=` | top tags with affinity |
| `heatmap(lat, lon, radius, tag)` | `/v2/insights?filter.type=urn:heatmap&filter.location=POINT()&filter.location.radius=&signal.interests.tags=` (paged, take=50) | cells `{lat, lon, affinity, affinity_rank, popularity}` |
| `affine_brands(lat, lon, tag)` | `/v2/insights?filter.type=urn:entity:brand&signal.location=POINT()&signal.interests.tags=` | brands with affinity (ad interests) |
| `verify_business(name, city)` | Tavily `/search` | `{exists, url, snippet}` |
| `compare_locations(a, b)` | runs heatmap + competitors for both | side-by-side signals |

## Constraints

- Cache: SQLite, key = normalized URL, TTL 24 h. Cached responses are marked `cached: true` in the trace.
- Rate limit: 30 full analyses per IP per day (demo protection; credits are finite).
- Heatmap `take` max is 50; page until fewer than 50 are returned or 6 pages.
- Tag ids that work (verified 26-Oct-2026): places use `urn:tag:category:place:*`; heatmaps use `urn:tag:genre:place:restaurant:*` for restaurant-type concepts. `concept_to_tags` must return one of each.
- Never send names of people or any personal data in any request.
