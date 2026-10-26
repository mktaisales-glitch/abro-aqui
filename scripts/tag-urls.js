// All /v2/tags URLs that resolveConcept may need for the demo cases (so the browser can fetch them in one go).
import { conceptParts, conceptQueries } from "../src/tools.js";
import { qlooUrl } from "../src/qloo.js";
import fs from "node:fs";
const cases = JSON.parse(fs.readFileSync("fixtures/cases.json", "utf8"));
const urls = new Set();
for (const c of cases) for (const part of conceptParts(c.concept)) for (const q of conceptQueries(part)) {
  urls.add(qlooUrl("/v2/tags", { "filter.query": q, "filter.tag.types": "urn:tag:genre:place", take: 10 }));
  urls.add(qlooUrl("/v2/tags", { "filter.query": q, "filter.tag.types": "urn:tag:category:place", take: 10 }));
  urls.add(qlooUrl("/v2/tags", { "filter.query": q, "filter.tag.types": "urn:tag:specialty_dish:place", take: 5 }));
}
console.log(JSON.stringify([...urls]));
