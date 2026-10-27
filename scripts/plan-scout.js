// Lists the calls the scripted scout needs for the demo cases (OFFLINE=plan), so they can be recorded.
process.env.OFFLINE = process.env.OFFLINE || "plan";
const { analyze, scout } = await import("../src/agent.js");
const { misses } = await import("../src/http.js");
import fs from "node:fs";
const cases = JSON.parse(fs.readFileSync(process.argv[2] || "fixtures/cases.json", "utf8"));
for (const c of cases) {
  try { const r = await analyze({ ...c, withoutQloo: false }); const s = await scout({ ctx: r }); console.error("OK  ", c.concept, s.steps.map((x) => x.tool + ":" + x.summary).join(" | ")); }
  catch (e) { console.error("MISS", c.concept, e.message.slice(0, 120)); }
}
console.log(JSON.stringify([...misses]));
