// Agent tools — see specs/02-tools.md. Each returns typed data and leaves a trace entry.
import { qloo, point } from "./qloo.js";
import { getJSON, isCached } from "./http.js";
import { tavily } from "@tavily/core";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const TAVILY_KEY = process.env.TAVILY_API_KEY?.trim();

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

const UA = { "User-Agent": "abro-aqui/0.1 (+https://github.com/mktaisales-glitch/abro-aqui)" };
// OpenStreetMap Nominatim allows about 1 request per second per host; calls are spaced, and Photon (Komoot,
// also OpenStreetMap data, no key) answers when Nominatim refuses (shared hosting IPs get rate-limited).
let osmNext = 0;
async function osm(url, trace) {
  const wait = osmNext - Date.now();
  osmNext = Math.max(Date.now(), osmNext) + 1100;
  if (wait > 0 && !process.env.OFFLINE) await new Promise((r) => setTimeout(r, wait));
  return getJSON(url, { headers: UA, source: "osm", trace });
}
const photonName = (p) => [p.name, [p.housenumber, p.street].filter(Boolean).join(" "), p.district ?? p.locality, p.city, p.state, p.postcode, p.country].filter(Boolean).join(", ");

// The demo's example addresses, resolved once (28 Oct 2026): the examples never depend on a geocoder being up.
const KNOWN_PLACES = {
  "200 schermerhorn street, brooklyn, new york": { lat: 40.6885016, lon: -73.9854802, display_name: "State Renaissance Court, 200, Schermerhorn Street, Boerum Hill, Brooklyn, Kings County, New York, 11201, United States" },
  "avinguda del paral·lel 40, barcelona": { lat: 41.3749859, lon: 2.1724407, display_name: "40, Avinguda del Paral·lel, el Raval, Ciutat Vella, Barcelona, Barcelonès, Barcelona, Catalunya, 08001, España" },
  "carrer de sants 100, barcelona": { lat: 41.3756587, lon: 2.1229976, display_name: "Carrer de Sants, Sants-Badal, Sants-Montjuïc, Barcelona, Barcelonès, Barcelona, Catalunya, 08028, España" },
  "41.37903, 2.15478": { lat: 41.37903, lon: 2.15478, display_name: "41.37903, 2.15478 (Gran Via de les Corts Catalanes 400, la Nova Esquerra de l'Eixample, l'Eixample, Barcelona, Barcelonès, Barcelona, Catalunya, 08015, España)" },
};

export async function geocode(address, trace) {
  const known = KNOWN_PLACES[address.trim().toLowerCase()];
  if (known) return { ...known };
  const m = address.trim().match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    // name the place (and its country) when we can; coordinates alone otherwise
    const r = await osm(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, trace).catch(() => null);
    let name = r?.display_name;
    if (!name) {
      const ph = await getJSON(`https://photon.komoot.io/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&limit=1`, { headers: UA, source: "osm", trace }).catch(() => null);
      if (ph?.features?.[0]) name = photonName(ph.features[0].properties);
    }
    return { lat, lon, display_name: name ? `${lat.toFixed(5)}, ${lon.toFixed(5)} (${name})` : `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
  }
  const q = withCity(address.trim());
  const places = namedPlaces(q);
  const ok = (name) => !places.length || placeMatches(name, places);
  // recordings and older cache entries were made with limit=1: use them when they already agree with the city
  const url1 = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(q)}`;
  if (isCached(url1)) {
    const h = (await osm(url1, trace).catch(() => null))?.[0];
    if (h && ok(h.display_name)) return { lat: +h.lat, lon: +h.lon, display_name: h.display_name };
  }
  // a few candidates, and the first one in the city the address names ("Avenida del Paralelo 4, Barcelona" is
  // not in Almussafes); then the Catalan street names for Barcelona; then Photon
  const queries = [q, ...(catalanStreet(q) !== q ? [catalanStreet(q)] : [])];
  let first = null, answered = false;
  for (const qq of queries) {
    const hits = await osm(`${NOMINATIM}?format=json&limit=5&q=${encodeURIComponent(qq)}`, trace).catch(() => null);
    if (hits) answered = true;
    const all = (hits ?? []).map((h) => ({ lat: +h.lat, lon: +h.lon, display_name: h.display_name }));
    first ??= all[0] ?? null;
    const good = all.find((h) => ok(h.display_name));
    if (good) return good;
  }
  for (const qq of queries) {
    const ph = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(qq)}&limit=5`, { headers: UA, source: "osm", trace }).catch(() => null);
    if (ph) answered = true;
    const all = (ph?.features ?? []).map((f) => ({ lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], display_name: photonName(f.properties) }));
    first ??= all[0] ?? null;
    const good = all.find((h) => ok(h.display_name));
    if (good) return good;
  }
  // nothing in the named city: the closest guess, flagged so the page asks "is this the place?"
  if (first) return { ...first, mismatch: places[0] };
  if (!answered) throw new Error("The address service did not answer. Try again in a minute, or type the place as \"lat, lon\".");
  throw new Error(`Address not found: ${address}`);
}

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[·.]/g, "").replace(/\s+/g, " ").trim();
// English (and old Spanish) names → the local name OpenStreetMap uses
const EXONYM = { londres: "london", "nueva york": "new york", seville: "sevilla", lisbon: "lisboa", milan: "milano", rome: "roma", naples: "napoli", florence: "firenze", turin: "torino", venice: "venezia", munich: "munchen", cologne: "koln", vienna: "wien", prague: "praha", brussels: "bruxelles", saragossa: "zaragoza", gerona: "girona", lerida: "lleida", "la coruna": "a coruna", nyc: "new york", "new york city": "new york", ny: "new york", la: "los angeles", sf: "san francisco", athens: "athina", copenhagen: "kobenhavn", warsaw: "warszawa" };
// a city typed without a comma ("avenida paralelo barcelona") is read as "avenida paralelo, barcelona"
const CITY_END = /\s+(barcelona|madrid|valencia|sevilla|seville|bilbao|m[aá]laga|zaragoza|sabadell|terrassa|girona|tarragona|lleida|london|londres|paris|par[ií]s|lisboa|lisbon|berl[ií]n|mil[aá]n|milano|roma|rome|new york|nueva york|brooklyn|manhattan|san francisco|chicago|los angeles|amsterdam|[aá]msterdam|m[uü]nchen|munich)\s*$/i;
export function withCity(q) {
  const s = String(q ?? "").trim();
  if (s.includes(",")) return s;
  const m = s.match(CITY_END);
  return m && m.index > 0 ? `${s.slice(0, m.index)}, ${m[1]}` : s;
}

/** The places an address names after the street ("…, Barcelona" → ["barcelona"]), without postcodes. */
export function namedPlaces(address) {
  const parts = String(address ?? "").split(",").slice(1).map((p) => fold(p.replace(/\b\d[\d-]*\b/g, ""))).filter((p) => p.length >= 2);
  return parts.map((p) => EXONYM[p] ?? p).filter((p) => !COUNTRY.test(p));
}
// countries and regions say too little: "…, Spain" must not accept any street in Spain
const COUNTRY = /^(?:spain|espana|espanya|france|francia|usa|us|united states|estados unidos|uk|united kingdom|reino unido|england|italy|italia|germany|alemania|deutschland|portugal|catalunya|cataluna|catalonia|netherlands|mexico|argentina)$/;
/** Does a geocoded name lie in one of the named places? (accents and case ignored) */
export function placeMatches(displayName, places) {
  const d = ` ${fold(displayName).replace(/[^a-z0-9]+/g, " ")} `;
  return places.some((p) => d.includes(` ${p.replace(/[^a-z0-9]+/g, " ").trim()} `));
}
// Spanish street names typed for Barcelona, where OpenStreetMap has the Catalan ones
const CAT = [
  [/\b(?:avenida|avda\.?|av\.?|avinguda)\s+(?:del?\s+)?(?:paral[·.]?lel|paralelo)\b/i, "Avinguda del Paral·lel"], [/^(?:el\s+)?paralelo\b/i, "Avinguda del Paral·lel"], [/\bavenida (?:de la )?diagonal\b/i, "Avinguda Diagonal"],
  [/\bgran v[ií]a(?! de les)(?: de las cortes catalanas)?\b/i, "Gran Via de les Corts Catalanes"], [/\bpaseo de gracia\b/i, "Passeig de Gràcia"],
  [/\bpaseo de san juan\b/i, "Passeig de Sant Joan"], [/\bplaza (?:de )?catalu[nñ]a\b/i, "Plaça de Catalunya"], [/^diagonal\b/i, "Avinguda Diagonal"],
  [/\bavenida\b/i, "Avinguda"], [/\bcalle\b/i, "Carrer"], [/\bpaseo\b/i, "Passeig"], [/\bplaza\b/i, "Plaça"], [/\bronda de\b/i, "Ronda de"],
];
/** "Avenida del Paralelo 4, Barcelona" → "Avinguda del Paral·lel 4, Barcelona"; other cities are left as typed. */
export function catalanStreet(address) {
  const s = String(address ?? "");
  if (!/barcelona/i.test(s.split(",").slice(1).join(","))) return s;
  const i = s.indexOf(",");
  let street = s.slice(0, i);
  for (const [re, to] of CAT) if (re.test(street)) { street = street.replace(re, to); if (!/^(Avinguda|Carrer|Passeig|Plaça|Ronda)$/.test(to)) break; }
  return street + s.slice(i);
}

/** Only the named Barcelona streets (not the generic Avenida→Avinguda), city not required: for suggestions. */
export function catalanNamedStreet(q) {
  const s = String(q ?? "");
  for (const [re, to] of CAT) {
    if (/^(Avinguda|Carrer|Passeig|Plaça|Ronda de)$/.test(to)) break;
    if (re.test(s)) return s.replace(re, to);
  }
  return null;
}

/** Coordinates the visitor picked from the suggestions: used as they are, with the label they saw. Null if invalid. */
export function geoFromCoords(coords, label) {
  const lat = Number(coords?.lat), lon = Number(coords?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, display_name: String(label ?? "").trim().slice(0, 200) || `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
}

// ---------- address suggestions while typing (Photon: its policy allows autocomplete; Nominatim's does not) ----------
/** A short label for a Photon feature: "Avinguda del Paral·lel 4, el Raval, Barcelona" and its country apart. */
export function photonLabel(p = {}) {
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const head = p.housenumber && p.street ? street : p.name && p.name !== p.street ? (street ? `${p.name}, ${street}` : p.name) : street || p.name;
  const area = p.district ?? p.locality ?? null;
  const city = p.city ?? p.town ?? p.village ?? p.county ?? p.state;
  return { label: [...new Set([head, area, city].filter(Boolean))].join(", "), country: p.country ?? "" };
}
export async function suggestPlaces(q, lang = "en", trace) {
  const query = withCity(String(q ?? "").trim().slice(0, 120));
  if (query.length < 4) return [];
  // Photon speaks en/de/fr; for Spanish the local names (default) read best
  const url = (q) => `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5${lang === "en" ? "&lang=en" : ""}`;
  // a Barcelona street typed in Spanish ("Avenida del Paralelo 4") is also looked up by its Catalan name, first
  const named = catalanNamedStreet(query);
  const alias = named && !/barcelona/i.test(named) ? `${named}, Barcelona` : named;
  const lists = await Promise.all([alias, query].filter(Boolean).map((q) => getJSON(url(q), { headers: UA, source: "osm", trace }).catch(() => null)));
  const ph = { features: lists.flatMap((l) => l?.features ?? []) };
  const seen = new Set();
  const all = (ph?.features ?? []).map((f) => ({ ...photonLabel(f.properties), lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0] }))
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon) && x.label && !seen.has(x.label + x.country) && seen.add(x.label + x.country));
  // when the visitor named a city, only places in it (if there are any): "…, Barcelona" never offers Almussafes
  const places = namedPlaces(query);
  const inCity = places.length ? all.filter((x) => placeMatches(x.label, places)) : [];
  return (inCity.length ? inCity : all).slice(0, 5);
}

const HOUSE = /^\d+[a-z]?(?:[-–]\d+[a-z]?)?$/i;
const CITY = /barcelona|new york|brooklyn|manhattan|london|san francisco|madrid|paris|chicago|los angeles|valencia|sevilla|seville|lisboa|lisbon|berlin|milano|milan|roma|rome/i;
/**
 * A short, readable address from the geocoder's display name: "Rambla del Poblenou 100, el Poblenou, Barcelona".
 * Nominatim sometimes puts a place name first ("rico, 100, Rambla del Poblenou, …"): it is dropped when the next
 * token is the house number. Coordinates are kept as they are.
 */
export function shortAddress(display) {
  const s = String(display ?? "").trim();
  if (!s || /^-?\d{1,2}\.\d+\s*,\s*-?\d/.test(s)) return s;
  let p = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (p.length > 2 && !HOUSE.test(p[0]) && HOUSE.test(p[1])) p = p.slice(1);
  const numberFirst = /united states|united kingdom|estados unidos|reino unido|australia|canada/i.test(p.at(-1) ?? "");
  let head, rest;
  if (HOUSE.test(p[0]) && p[1]) { head = numberFirst ? `${p[0]} ${p[1]}` : `${p[1]} ${p[0]}`; rest = p.slice(2); }
  else { head = p[0]; rest = p.slice(1); }
  const city = rest.find((x) => CITY.test(x)) ?? rest.filter((x) => !/\d/.test(x))[2] ?? null;
  return [...new Set([head, rest[0], city].filter(Boolean))].join(", ");
}

/** Street name for a point (OpenStreetMap, cached): "Carrer de Blai, Poble-sec". Null if not found. */
export async function streetAt({ lat, lon }, trace) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
  const r = await osm(url, trace);
  const a = r?.address ?? {};
  const road = a.road ?? a.pedestrian ?? a.square ?? null;
  const area = a.neighbourhood ?? a.quarter ?? a.suburb ?? null;
  return road ? [road, area].filter(Boolean).join(", ") : area;
}

const EURO = /españa|spain|france|francia|italia|italy|deutschland|germany|alemania|portugal|nederland|netherlands|belgi|österreich|austria|ireland|irlanda|ελλάδα|greece|suomi|finland|eesti|latvija|lietuva|slovensko|slovenija|hrvatska|croatia|luxembourg|malta|κύπρος|cyprus/i;
/** Currency symbol for price levels, from the country at the end of the geocoded name; null when unknown. */
export function currencyOf(display) {
  const country = String(display ?? "").split(",").at(-1).replace(/\)$/, "").trim();
  if (/united states|estados unidos|^usa$/i.test(country)) return "$";
  if (/united kingdom|reino unido/i.test(country)) return "£";
  if (EURO.test(country)) return "€";
  return null;
}

// ---------- concept → Qloo tags ----------

const STOP = new Set(["and", "y", "i", "e", "with", "con", "de", "the", "a", "shop", "store", "bar", "restaurant", "place", "specialty", "artisan", "premium", "local", "new"]);

/** Heuristic split of a concept into parts: "waffles and ice cream" → ["waffles and ice cream", "waffles", "ice cream"]. */
export function conceptParts(concept) {
  const c = concept.toLowerCase().trim();
  const parts = c.split(/\s+(?:and|y|i|&)\s+|,|\//).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [c];
}

export function singular(w) {
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
const BAD_TAG = /equipment|supplier|wholesal|manufactur|vending|machine|processing|farm|(?:^|[:_])market(?:_|$)|:hotel:|donburi/;

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
    id: e.entity_id ?? null,
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
    places_named: ents.slice(0, 25).map((e) => ({ name: e.name, kind: (e.tags ?? []).find((t) => t.type === "urn:tag:category:place" && !GENERIC.test(t.name))?.name ?? null })),
    tag_ids: ents.map((e) => (e.tags ?? []).map((t) => t.id)),
    tag_names: ents.map((e) => (e.tags ?? []).filter((t) => SHARE_TYPES.test(t.type)).map((t) => t.name.toLowerCase())),
  };
}

/** How many of the area's popular places already serve each part of the concept (whole-word match on tag names). */
export function conceptShare(profile, resolved) {
  return resolved.map((p) => {
    const words = p.part.split(" ").map(singular).filter((w) => w.length > 2 && !STOP.has(w));
    const ids = new Set([p.heatmap_tag, p.competitor_tag, ...(p.heat_candidates ?? []), ...(p.comp_candidates ?? [])].filter(Boolean));
    const n = profile.tag_names.filter((names, i) =>
      (profile.tag_ids?.[i] ?? []).some((id) => ids.has(id)) ||
      (words.length && names.some((nm) => { const toks = nm.split(/[^a-z0-9]+/).map(singular); return words.every((w) => toks.includes(w)); }))
    ).length;
    return { part: p.part, places: n, of: profile.places };
  });
}

/**
 * Taste heat map of a concept around a point. One call returns ~300–400 cells; duplicates removed by geohash.
 * Per cell: `affinity` and `popularity` are ranks inside this circle (0–1, evenly spread);
 * `affinity_rank` compares the cell with a wider reference and is what we call demand.
 */
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
  return { cells, nearest: nearest && { ...nearest, distance_m: dist(nearest) }, coverage: cells.length, ...demandAround(cells, lat, lon) };
}

/** Demand around a point: mean affinity_rank (and local affinity) of the cells within `r` metres; the nearest cell if none. */
export function demandAround(cells, lat, lon, r = 250) {
  if (!cells.length) return { demand: null, local: null, cells_used: 0 };
  let used = cells.filter((c) => haversine(lat, lon, c.lat, c.lon) <= r);
  if (!used.length) used = [cells.reduce((a, b) => (haversine(lat, lon, b.lat, b.lon) < haversine(lat, lon, a.lat, a.lon) ? b : a))];
  const mean = (f) => Math.round((used.reduce((s, c) => s + c[f], 0) / used.length) * 1000) / 1000;
  return { demand: mean("affinity_rank"), local: mean("affinity"), cells_used: used.length };
}

/** How many places Qloo knows within `radius` of a point (is this a shopping street or a park?). */
export async function placesNear({ lat, lon, radius = 200 }, trace) {
  const d = await qloo("/v2/insights", { "filter.type": "urn:entity:place", "filter.location": point(lat, lon), "filter.location.radius": radius, take: 30 }, trace);
  return (d?.results?.entities ?? []).length;
}

/** Rivals in a wide radius (the 50 most popular with the tag), used to judge alternative blocks. */
export async function rivalsAround({ lat, lon, radius = 1500, tag }, trace) {
  if (!tag) return [];
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:entity:place", "filter.location": point(lat, lon), "filter.location.radius": radius, "filter.tags": tag, take: 50 },
    trace
  );
  return (d?.results?.entities ?? []).map((e) => placeOut(e, lat, lon)).filter((p) => !p.is_closed && p.lat != null);
}

export async function affineBrands({ lat, lon, tag }, trace) {
  const d = await qloo(
    "/v2/insights",
    { "filter.type": "urn:entity:brand", "signal.location": point(lat, lon), "signal.location.radius": 3000, "signal.interests.tags": tag, take: 10 },
    trace
  );
  return (d?.results?.entities ?? []).map((e) => ({ name: e.name, affinity: e.query?.affinity ?? null }));
}

/** Tavily: does this business exist on the web? It counts as found only if the name appears in a result title or URL. */
export async function verifyBusiness({ name, city }, trace) {
  if (!TAVILY_KEY) return { exists: null, note: "Tavily not configured" };
  if (process.env.OFFLINE) return { exists: null, note: "offline replay: not checked" };
  const t0 = Date.now();
  const client = tavily({ apiKey: TAVILY_KEY });
  const q = `"${name}" ${city}`;
  const r = await Promise.race([
    client.search(q, { maxResults: 5, searchDepth: "basic" }),
    new Promise((_, no) => setTimeout(() => no(new Error("Tavily timeout (8 s)")), 8000)),
  ]).catch((e) => { trace?.add({ source: "tavily", url: `tavily:/search?q=${encodeURIComponent(q)}`, ms: Date.now() - t0, cached: false, error: String(e.message).slice(0, 80) }); throw e; });
  trace?.add({ source: "tavily", url: `tavily:/search?q=${encodeURIComponent(q)}`, ms: Date.now() - t0, cached: false });
  const norm = (x) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const key = norm(name).split(" ").filter((w) => w.length > 2);
  const hit = (r.results ?? []).find((x) => { const t = norm(`${x.title} ${x.url}`); return key.length && key.every((w) => t.includes(w)); });
  return { exists: !!hit, url: hit?.url ?? null, title: hit?.title ?? null, snippet: hit?.content?.slice(0, 200) ?? null, checked: (r.results ?? []).length };
}

/**
 * Price positions among the direct rivals within 700 m: for each price level (€, €€, €€€), how many rivals and the best rating.
 * A level is "open" when no rival there is rated 4.5 or more; "crowded" when one is.
 */
export function priceGap(competitors, strong = 4.5) {
  const levels = [1, 2, 3, 4].map((lvl) => {
    const at = competitors.filter((c) => c.price_level === lvl && (c.distance_m ?? 1e9) <= 700);
    const best = at.filter((c) => c.rating != null).sort((a, b) => b.rating - a.rating)[0] ?? null;
    return { level: lvl, rivals: at.length, best: best && { name: best.name, rating: best.rating }, open: !best || best.rating < strong };
  });
  const priced = competitors.filter((c) => c.price_level != null).length;
  if (!priced) return null;
  return { levels: levels.filter((l) => l.level <= 3 || l.rivals), priced, unpriced: competitors.length - priced };
}
