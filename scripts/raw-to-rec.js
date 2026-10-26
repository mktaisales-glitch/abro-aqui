// Turns the compact browser dumps (fixtures/raw/*.json) into cache records keyed by the exact Qloo URLs.
import { qlooUrl, point } from "../src/qloo.js";
import fs from "node:fs";
const TT = { c: "urn:tag:cuisine:qloo", k: "urn:tag:category:place", d: "urn:tag:specialty_dish:place", w: "urn:tag:customer_identity:qloo", t: "urn:tag:time_of_day_fit:qloo" };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const num = (x) => (x === "" || x == null ? null : Number(x));
function places(rows, withTags) {
  return { results: { entities: rows.map((r) => {
    const [name, lat, lon, pop, rating, price, closed, rest] = r.split("|");
    const e = { name, popularity: num(pop), location: { lat: num(lat), lon: num(lon) }, properties: { business_rating: num(rating), price_level: num(price), is_closed: closed === "1" } };
    if (withTags) e.tags = (rest || "").split("~").filter(Boolean).map((t) => { const [k, ...n] = t.split(":"); const nm = n.join(":"); return { id: `${TT[k]}:${slug(nm)}`, name: nm, type: TT[k] }; });
    else e.properties.address = rest || null;
    return e;
  }) } };
}
const heat = (s) => ({ heat: s.slice(1) });
const ins = (o) => qlooUrl("/v2/insights", o);
const cases = [
  { lat: 41.3749859, lon: 2.1724407, heat: "urn:tag:genre:place:restaurant:seafood", comps: ["urn:tag:category:place:seafood_restaurant"], files: ["p0", "p1"] },
  { lat: 41.379, lon: 2.1548, heat: "urn:tag:genre:place:restaurant:ice_cream_shop", comps: ["urn:tag:specialty_dish:place:waffles", "urn:tag:category:place:ice_cream_shop"], files: ["p2", "p3"] },
];
const out = {};
for (const c of cases) {
  const items = c.files.flatMap((f) => JSON.parse(fs.readFileSync(`fixtures/raw/${f}.json`, "utf8")));
  const P = point(c.lat, c.lon);
  let i = 0;
  out[ins({ "filter.type": "urn:heatmap", "filter.location": P, "filter.location.radius": 1500, "signal.interests.tags": c.heat, take: 50 })] = heat(items[i++]);
  for (const t of c.comps) out[ins({ "filter.type": "urn:entity:place", "filter.location": P, "filter.location.radius": 700, "filter.tags": t, take: 20 })] = places(items[i++], false);
  out[ins({ "filter.type": "urn:entity:place", "filter.location": P, "filter.location.radius": 500, take: 50 })] = places(items[i++], true);
}
fs.writeFileSync("fixtures/rec-03-insights.json", JSON.stringify(out));
console.log(Object.keys(out).length, "records");
