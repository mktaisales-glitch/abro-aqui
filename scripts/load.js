// Loads recorded responses into the cache (pinned, never expire).
// Accepts the compact format produced by the browser recorder: heat maps as "lat,lon,aff,rank,pop;..." strings.
import { putCache } from "../src/http.js";
import fs from "node:fs";
let n = 0;
for (const f of process.argv.slice(2)) {
  const rec = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const [url, v] of Object.entries(rec)) {
    let json = v;
    if (v && typeof v.heat === "string") {
      json = { results: { heatmap: v.heat.split(";").filter(Boolean).map((r) => { const [la, lo, a, k, p] = r.split(",").map(Number); return { location: { latitude: la, longitude: lo, geohash: `${la},${lo}` }, query: { affinity: a, affinity_rank: k, popularity: p } }; }) } };
    }
    if (v && typeof v.count === "number") json = { results: { entities: Array.from({ length: v.count }, (_, i) => ({ name: `place ${i + 1}` })) } };
    if (v && typeof v.rivals === "string") {
      // compact places: "name|lat|lon|rating|price|closed;..."
      json = { results: { entities: v.rivals.split(";").filter(Boolean).map((r) => { const [name, la, lo, ra, pr, cl] = r.split("|"); return { name, location: { lat: +la, lon: +lo }, properties: { business_rating: ra === "" ? null : +ra, price_level: pr === "" ? null : +pr, is_closed: cl === "1" } }; }) } };
    }
    putCache(url, json, true); n++;
  }
}
console.log(`loaded ${n} responses`);
