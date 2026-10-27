// Prints every external URL a set of demo cases needs that is not in the cache yet.
// Runs with OFFLINE=plan: a missing call is noted and treated as empty, so one run lists them all.
process.env.OFFLINE = process.env.OFFLINE || "plan";
const { analyze } = await import("../src/agent.js");
import { misses } from "../src/http.js";
import fs from "node:fs";
const cases = JSON.parse(fs.readFileSync(process.argv[2] || "fixtures/cases.json", "utf8"));
for (const c of cases) {
  try { await analyze({ ...c, withoutQloo: false }); console.error("OK  ", c.concept, "@", c.address); }
  catch (e) { console.error("MISS", c.concept, "@", c.address, "→", e.message.slice(0, 80)); }
}
console.log(JSON.stringify([...misses]));
