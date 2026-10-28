// Shared fixture for the launch-plan tests: a local mock of the Qloo API and an analysis context.
import http from "node:http";

export const seen = [];
const ent = (name, extra = {}) => ({ name, entity_id: `id-${name}`, query: { affinity: 0.9 }, ...extra });
export function startQlooMock(port) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    seen.push(Object.fromEntries(u.searchParams));
    const type = u.searchParams.get("filter.type");
    let entities = [];
    if (type === "urn:entity:artist") entities = [ent("Vetusta Morla"), ent("Love of Lesbian")];
    if (type === "urn:entity:brand") entities = [ent("Estrella Damm"), ent("Puertecillo Paral·lel")];
    if (type === "urn:entity:place")
      entities = [
        ent("Puertecillo Paral·lel", { location: { lat: 41.3752, lon: 2.1695 } }),
        ent("La Gamba Feliz", { tags: [{ id: "urn:tag:category:place:seafood_restaurant", name: "Seafood restaurant", type: "urn:tag:category:place" }], location: { lat: 41.3753, lon: 2.1697 } }),
        ent("Teatre Apolo", { tags: [{ id: "urn:tag:category:place:theater", name: "Theater", type: "urn:tag:category:place" }], location: { lat: 41.3746, lon: 2.1689 } }),
        ent("Bar Ramon", { tags: [{ id: "urn:tag:category:place:bar", name: "Bar", type: "urn:tag:category:place" }], location: { lat: 41.3761, lon: 2.1666 } }),
        ent("Closed Bar", { properties: { is_closed: true }, location: { lat: 41.375, lon: 2.169 } }),
        ent("Church of X", { tags: [{ id: "urn:tag:category:place:church", name: "Church", type: "urn:tag:category:place" }], location: { lat: 41.375, lon: 2.169 } }),
      ];
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ results: { entities } }));
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

export const cells = [
  { lat: 41.3750, lon: 2.1690, affinity_rank: 0.99, popularity: 0.99 }, // the shop's own block: excluded (< 120 m)
  { lat: 41.3780, lon: 2.1690, affinity_rank: 0.98, popularity: 0.9 },
  { lat: 41.3782, lon: 2.1692, affinity_rank: 0.97, popularity: 0.95 }, // too close to the previous one
  { lat: 41.3720, lon: 2.1650, affinity_rank: 0.95, popularity: 0.8 },
  { lat: 41.3800, lon: 2.1600, affinity_rank: 0.99, popularity: 0.3 }, // quiet block: excluded
  { lat: 41.3700, lon: 2.1750, affinity_rank: 0.90, popularity: 0.7 },
];
export const ctx = {
  concept: "seafood restaurant",
  address: "Avinguda del Paral·lel 40, Sant Antoni, Eixample, Barcelona, Catalunya, 08001, España",
  geo: { lat: 41.375, lon: 2.169 },
  resolved: [{ part: "seafood restaurant", heatmap_tag: "urn:tag:genre:place:restaurant:seafood", competitor_tag: "urn:tag:category:place:seafood_restaurant", comp_candidates: [] }],
  competitors: [
    { name: "Puertecillo Paral·lel", id: "id-puertecillo", rating: 4.4, distance_m: 26 },
    { name: "Marisqueria B", id: "id-b", rating: 4.6, distance_m: 500 },
    { name: "No id", id: null, rating: 4.9, distance_m: 100 },
  ],
  verdict: { level: "AMBER" },
  heatmap: { cells },
};

