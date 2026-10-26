// Agent tools — see specs/02-tools.md. Each returns typed data and leaves a trace entry.
import { qloo, point } from "./qloo.js";
import { tavily } from "@tavily/core";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const TAVILY_KEY = process.env.TAVILY_API_KEY;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

export async function geocode(address, trace) {
  const t0 = Date.now();
  const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { "User-Agent": "abro-aqui/0.1 (hackathon demo)" } });
  const [hit] = await res.json();
  trace?.add({ source: "osm", url, ms: Date.now() - t0, cached: false });
  if (!hit) throw new Error(`Address not found: ${address}`);
  return { lat: +hit.lat, lon: +hit.lon, display_name: hit.display_name };
}

/** Candidate Qloo tags for a free-text concept. The LLM (or a heuristic) picks one category tag and one heatmap tag. */
export async function tagCandidates(concept, trace) {
  const d = await qloo("/v2/tags", { "filter.query": concept, take: 30 }, trace);
  const tags = d?.results?.tags ?? [];
  return tags.map((t) => ({ id: t.id, name: t.name, type: t.type }));
}

/** Heuristic pick when no LLM: category tag for places, restaurant-genre tag for heatmaps. */
export function pickTagsHeuristic(candidates, concept) {
  const cat = candidates.find((t) => t.id.startsWith("urn:tag:category:place:")) ?? candidates.find((t) => t.id.includes(":place:"));
  const heat =
    candidates.find((t) => t.id.startsWith("urn:tag:genre:place:restaurant:")) ??
    candidates.find((t) => t.id.startsWith("urn:tag:genre:place:")) ??
    cat;
  if (!cat || !heat) throw new Error(`No Qloo tag for concept "${concept}"`);
  return { category_tag: cat.id, heatmap_tag: heat.id, label: cat.name };
}

export async function nearbyCompetitors({ lat, lon, radius = 700, tag }, trace) {
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:entity:place", "filter.location": point(lat, lon), "filter.location.radius": radius, "filter.tags": tag, take: 20 },
    trace
  );
  return (d?.results?.entities ?? []).map((e) => {
    const g = e.location ?? {};
    return {
      name: e.name,
      rating: e.properties?.business_rating ?? null,
      price_level: e.properties?.price_level ?? null,
      address: e.properties?.address ?? null,
      distance_m: g.lat && g.lon ? haversine(lat, lon, g.lat, g.lon) : null,
      popularity: e.popularity ?? null,
      entity_id: e.entity_id,
    };
  });
}

export async function zoneTaste({ lat, lon, radius = 800 }, trace) {
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:tag", "signal.location": point(lat, lon), "signal.location.radius": radius, "filter.tag.types": "urn:tag:genre:place,urn:tag:cuisine:qloo,urn:tag:category:place", take: 25 },
    trace
  );
  return (d?.results?.tags ?? []).map((t) => ({ id: t.id, name: t.name, affinity: t.query?.affinity ?? null }));
}

export async function heatmap({ lat, lon, radius = 1500, tag }, trace) {
  const cells = [];
  for (let page = 1; page <= 6; page++) {
    const d = await qloo(
      "/v2/insights",
      { "filter.type": "urn:heatmap", "filter.location": point(lat, lon), "filter.location.radius": radius, "signal.interests.tags": tag, take: 50, page },
      trace
    );
    const h = d?.results?.heatmap ?? [];
    for (const c of h)
      cells.push({ lat: c.location.latitude, lon: c.location.longitude, affinity: c.query.affinity, affinity_rank: c.query.affinity_rank, popularity: c.query.popularity });
    if (h.length < 50) break;
  }
  const byDist = [...cells].sort((a, b) => haversine(lat, lon, a.lat, a.lon) - haversine(lat, lon, b.lat, b.lon));
  const nearest = byDist[0] ?? null;
  const best = [...cells].sort((a, b) => b.affinity_rank - a.affinity_rank || a.popularity - b.popularity)[0] ?? null;
  return { cells, nearest, best, coverage: cells.length };
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
