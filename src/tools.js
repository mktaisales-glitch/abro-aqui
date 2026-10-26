// Agent tools — see specs/02-tools.md. Each returns typed data and leaves a trace entry.
import { qloo, point } from "./qloo.js";
import { getJSON } from "./http.js";
import { tavily } from "@tavily/core";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const TAVILY_KEY = process.env.TAVILY_API_KEY;

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export async function geocode(address, trace) {
  const m = address.trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (m) return { lat: +m[1], lon: +m[2], display_name: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}` };
  const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(address.trim())}`;
  const [hit] = await getJSON(url, { headers: { "User-Agent": "abro-aqui/0.1 (hackathon demo; victorsegura@marketingaisales.com)" }, source: "osm", trace });
  if (!hit) throw new Error(`Address not found: ${address}`);
  return { lat: +hit.lat, lon: +hit.lon, display_name: hit.display_name };
}

// ---------- concept → Qloo tags ----------

const STOP = new Set(["and", "y", "i", "e", "with", "con", "de", "the", "a", "shop", "store", "bar", "restaurant", "place", "specialty", "artisan", "premium", "local", "new"]);

/** Heuristic split of a concept into parts: "waffles and ice cream" → ["waffles and ice cream", "waffles", "ice cream"]. */
export function conceptParts(concept) {
  const c = concept.toLowerCase().trim();
  const parts = c.split(/\s+(?:and|y|i|&)\s+|,|\//).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [c];
}

function singular(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Queries tried for one part, in order: as written, singular, then each meaningful word. */
export function conceptQueries(part) {
  const words = part.split(" ").filter((w) => !STOP.has(w) && w.length > 2);
  return [...new Set([part, part.split(" ").map(singular).join(" "), ...words, ...words.map(singular)])];
}

export const TAG_TYPES = ["urn:tag:genre:place", "urn:tag:category:place", "urn:tag:specialty_dish:place"];

async function tagsOfType(query, type, trace, take = 10) {
  const d = await qloo("/v2/tags", { "filter.query": query, "filter.tag.types": type, take }, trace);
  return (d?.results?.tags ?? []).map((t) => ({ id: t.id, name: t.name }));
}

const GENERIC_TOKENS = new Set(["shop", "store", "restaurant", "bar", "stand", "house", "place", "and"]);
const BAD_TAG = /equipment|supplier|wholesal|manufactur|vending|machine|processing|farm|market|:hotel:|donburi/;

/** Score a Qloo tag id against the words of a concept part: all meaningful words must appear in the tag slug; fewer extra words is better. */
export function scoreTag(id, part) {
  if (BAD_TAG.test(id)) return -1;
  const slug = id.split(":").pop().split("_").map(singular);
  const words = part.split(" ").map(singular);
  const core = words.filter((w) => !STOP.has(w) && w.length > 2);
  if (!core.length || !core.every((w) => slug.includes(w))) return -1;
  const extra = slug.filter((w) => !words.includes(w));
  const bonus = words.filter((w) => STOP.has(w) && slug.includes(w)).length * 0.4;
  return 10 - extra.reduce((p, w) => p + (GENERIC_TOKENS.has(w) ? 0.3 : 1), 0) + bonus + (id.includes(":restaurant:") ? 0.2 : 0);
}

function ranked(tags, part) {
  return tags.map((t) => ({ ...t, score: scoreTag(t.id, part) })).filter((t) => t.score >= 0).sort((a, b) => b.score - a.score);
}
function merge(into, more) {
  for (const t of more) if (!into.some((x) => x.id === t.id)) into.push(t);
  return into.sort((a, b) => b.score - a.score);
}

/**
 * For each part of the concept, find:
 *  - heatmap tag: urn:tag:genre:place:* (restaurant genres preferred; the heat map does not answer to category tags)
 *  - competitor tag: urn:tag:category:place:* or, failing that, a specialty dish (e.g. waffles)
 * Candidates are scored by word overlap with the part, not by the order Qloo returns them
 * ("seafood restaurant" must not resolve to "seafood donburi").
 */
export async function resolveConcept(parts, trace) {
  const out = [];
  for (const part of parts) {
    const heat = [];
    const comp = [];
    for (const q of conceptQueries(part)) {
      const [g, c, d] = await Promise.all([
        tagsOfType(q, "urn:tag:genre:place", trace),
        tagsOfType(q, "urn:tag:category:place", trace),
        tagsOfType(q, "urn:tag:specialty_dish:place", trace, 5),
      ]);
      merge(heat, ranked(g, part));
      const rc = ranked(c, part);
      merge(comp, rc.length ? rc : ranked(d, part));
      if (heat[0]?.score >= 10 && comp[0]?.score >= 10) break;
    }
    out.push({
      part,
      heatmap_tag: heat[0]?.id ?? null,
      competitor_tag: comp[0]?.id ?? null,
      heat_candidates: heat.slice(0, 3).map((t) => t.id),
      comp_candidates: comp.slice(0, 3).map((t) => t.id),
      label: comp[0]?.name ?? heat[0]?.name ?? part,
    });
  }
  if (!out.some((p) => p.heatmap_tag)) throw new Error(`Qloo has no place tag for "${parts.join(" / ")}". Try a simpler concept (e.g. "ice cream", "seafood restaurant", "coffee").`);
  return out;
}

/** Is this tag actually used for places around here? (one cheap call in a 5 km radius) */
export async function tagInUse({ lat, lon, tag }, trace) {
  const d = await qloo("/v2/insights", { "filter.type": "urn:entity:place", "filter.location": point(lat, lon), "filter.location.radius": 5000, "filter.tags": tag, take: 1 }, trace);
  return (d?.results?.entities ?? []).length > 0;
}

// ---------- signals ----------

function placeOut(e, lat, lon) {
  const g = e.location ?? {};
  return {
    name: e.name,
    rating: e.properties?.business_rating != null ? Math.round(e.properties.business_rating * 10) / 10 : null,
    price_level: e.properties?.price_level ?? null,
    address: e.properties?.address ?? null,
    is_closed: !!e.properties?.is_closed,
    distance_m: g.lat != null ? haversine(lat, lon, g.lat, g.lon) : null,
    lat: g.lat ?? null,
    lon: g.lon ?? null,
    popularity: e.popularity ?? null,
  };
}

export async function nearbyCompetitors({ lat, lon, radius = 700, tag }, trace) {
  if (!tag) return [];
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:entity:place", "filter.location": point(lat, lon), "filter.location.radius": radius, "filter.tags": tag, take: 20 },
    trace
  );
  return (d?.results?.entities ?? [])
    .map((e) => placeOut(e, lat, lon))
    .filter((p) => !p.is_closed)
    .sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
}

const PROFILE_TYPES = {
  "urn:tag:cuisine:qloo": "serves",
  "urn:tag:category:place": "kind",
  "urn:tag:customer_identity:qloo": "who",
  "urn:tag:time_of_day_fit:qloo": "when",
};
const SHARE_TYPES = /^urn:tag:(cuisine:qloo|category:place|genre:place|specialty_dish:place)$/;
// Customer identities that touch protected attributes are never shown as "who goes" (responsible use).
const SENSITIVE_WHO = /lgbt|gay|lesbian|queer|religio|muslim|jewish|christian|halal|kosher|ethnic|black|latino|hispanic|asian|immigrant|disab|senior citizens|older adults/i;
const GENERIC = /^(place|restaurant|hotel|tourist attraction|point of interest|establishment|food)$/i;

/**
 * What the area around the address is made of: the 50 most popular places within `radius`,
 * and how often each cuisine / kind of place / customer identity / time of day appears among them.
 */
export async function zoneProfile({ lat, lon, radius = 500 }, trace) {
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:entity:place", "filter.location": point(lat, lon), "filter.location.radius": radius, take: 50 },
    trace
  );
  const ents = d?.results?.entities ?? [];
  const counts = { serves: {}, kind: {}, who: {}, when: {} };
  for (const e of ents) {
    const seen = new Set();
    for (const t of e.tags ?? []) {
      const bucket = PROFILE_TYPES[t.type];
      if (!bucket || GENERIC.test(t.name) || (bucket === "who" && SENSITIVE_WHO.test(t.name))) continue;
      const k = `${bucket}|${t.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      counts[bucket][t.name] = (counts[bucket][t.name] ?? 0) + 1;
    }
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
  return {
    places: ents.length,
    radius_m: radius,
    serves: top(counts.serves, 8),
    kind: top(counts.kind, 8),
    who: top(counts.who, 6),
    when: top(counts.when, 5),
    tag_ids: ents.map((e) => (e.tags ?? []).map((t) => t.id)),
    tag_names: ents.map((e) => (e.tags ?? []).filter((t) => SHARE_TYPES.test(t.type)).map((t) => t.name.toLowerCase())),
  };
}

/** How many of the area's popular places already serve each part of the concept. */
export function conceptShare(profile, resolved) {
  return resolved.map((p) => {
    const words = p.part.split(" ").map(singular).filter((w) => w.length > 2 && !STOP.has(w));
    const n = profile.tag_names.filter((names) => names.some((nm) => words.some((w) => nm.includes(w)))).length;
    return { part: p.part, places: n, of: profile.places };
  });
}

/** Taste heat map of a concept around a point. One call returns ~300–400 cells; duplicates removed by geohash. */
export async function heatmap({ lat, lon, radius = 1500, tag }, trace) {
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:heatmap", "filter.location": point(lat, lon), "filter.location.radius": radius, "signal.interests.tags": tag, take: 50 },
    trace
  );
  const seen = new Set();
  const cells = [];
  for (const c of d?.results?.heatmap ?? []) {
    const k = c.location.geohash ?? `${c.location.latitude},${c.location.longitude}`;
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ lat: c.location.latitude, lon: c.location.longitude, affinity: c.query.affinity, affinity_rank: c.query.affinity_rank, popularity: c.query.popularity });
  }
  const dist = (c) => haversine(lat, lon, c.lat, c.lon);
  const nearest = cells.length ? cells.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : null;
  // best alternative: highest affinity with room left (supply < 0.8), within the radius
  const open = cells.filter((c) => c.popularity < 0.8);
  const pool = open.length ? open : cells;
  const best = pool.reduce((a, b) => (b.affinity > a.affinity || (b.affinity === a.affinity && b.popularity < a.popularity) ? b : a), pool[0] ?? null);
  return { cells, nearest: nearest && { ...nearest, distance_m: dist(nearest) }, best: best && { ...best, distance_m: dist(best) }, coverage: cells.length };
}

export async function affineBrands({ lat, lon, tag }, trace) {
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:entity:brand", "signal.location": point(lat, lon), "signal.location.radius": 3000, "signal.interests.tags": tag, take: 10 },
    trace
  );
  return (d?.results?.entities ?? []).map((e) => ({ name: e.name, affinity: e.query?.affinity ?? null }));
}

/** Tavily: does this business exist on the web? The model decides when to call it. */
export async function verifyBusiness({ name, city }, trace) {
  if (!TAVILY_KEY) return { exists: null, note: "Tavily not configured" };
  const t0 = Date.now();
  const client = tavily({ apiKey: TAVILY_KEY });
  const q = `${name} ${city}`;
  const r = await client.search(q, { maxResults: 3, searchDepth: "basic" });
  trace?.add({ source: "tavily", url: `tavily:/search?q=${encodeURIComponent(q)}`, ms: Date.now() - t0, cached: false });
  const hit = r.results?.[0];
  return { exists: !!hit, url: hit?.url ?? null, snippet: hit?.content?.slice(0, 200) ?? null };
}
