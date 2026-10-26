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
    putCache(url, json, true); n++;
  }
}
console.log(`loaded ${n} responses`);
