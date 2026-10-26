// Prints the external URLs a set of demo cases needs that are not in the cache yet (OFFLINE=1).
import { analyze } from "../src/agent.js";
import { misses } from "../src/http.js";
import fs from "node:fs";
const cases = JSON.parse(fs.readFileSync(process.argv[2] || "fixtures/cases.json", "utf8"));
for (const c of cases) {
  try { await analyze({ ...c, withoutQloo: false }); console.error("OK  ", c.concept, "@", c.address); }
  catch (e) { console.error("MISS", c.concept, "@", c.address, "→", e.message.slice(0, 80)); }
}
console.log(JSON.stringify([...misses]));
