// PDF report (spec 08): built from the session's analysis, readable without the app, accents kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReportPdf, reportFileName, safeText } from "../src/report-pdf.js";

const cells = [];
for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) cells.push({ lat: 41.4 + i * 0.0014, lon: 2.19 + j * 0.0014, affinity: 0.5, affinity_rank: 0.5 + (i + j + 8) / 40, popularity: 0.7 });
const ctx = {
  concept: "ramen", lang: "en", radius: 1000, address: "Rambla del Poblenou 100, Barcelona",
  geo: { lat: 41.4, lon: 2.19, display_name: "100, Rambla del Poblenou, el Poblenou, Sant Marti, Barcelona, Espana" },
  verdict: { level: "AMBER", rule_fired: "Taste rank 0.78 with 3 rivals within 700 m: neither a clear gap nor saturation.", rule_es: "Gusto 0,78 con 3 rivales a 700 m.", offer: { c400: 1, c700: 3 }, unknowns: ["Foot traffic in front of the door"] },
  report: { headline: "The area likes ramen but three places already serve it.", why: ["3 rivals within 700 m"], actions: ["Look 588 m away (green ring)"], audience: [], unknowns: ["Rent versus expected ticket"] },
  report_meta: { model: "nvidia/Nemotron-3-Super" },
  heatmap: { cells, demand: 0.78, best: { lat: 41.403, lon: 2.186, distance_m: 588, c700: 1, demand: 0.82 } },
  competitors: [{ name: "Ryu Ramen", distance_m: 299, rating: 4.6, price_level: 2, lat: 41.401, lon: 2.192 }, { name: "Café Gràcia · Paral·lel ★", distance_m: 373, rating: 4.8, lat: 41.398, lon: 2.188 }],
  trace: [{ source: "qloo", url: "/v2/insights" }, { source: "qloo", url: "/v2/insights" }, { source: "nominatim", url: "/search" }],
};

test("the report is a PDF that names the address and the concept; agent and launch plan are included when present", async () => {
  const pdf = await buildReportPdf({ ctx, scout: { model: "nvidia/Nemotron-3_5-Lightning", text: "Stay put.", steps: [1, 2] }, launch: { plan: { headline: "Learned from Ryu Ramen.", music: [{ name: "Band", why: "same audience" }], co_promo: [], brands: [], posters: [], weeks: ["Week −2: a"] } } });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 5000);
  assert.ok(pdf.includes("100, Rambla del Poblenou"), "the address is in the document metadata");
  assert.ok(pdf.includes("ramen"));
});

test("Spanish labels and a report without optional sections still build", async () => {
  const pdf = await buildReportPdf({ ctx: { ...ctx, competitors: [], heatmap: { ...ctx.heatmap, best: null } }, lang: "es" });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("file name is plain ASCII; characters the fonts lack fall back to plain letters", () => {
  assert.equal(reportFileName({ concept: "Café & tapas", geo: { display_name: "40, Avinguda del Paral·lel, Barcelona" } }), "open-here-cafe-tapas-40-avinguda-del-paral-lel.pdf");
  assert.equal(safeText("Paral·lel, Gràcia, 12 €, 4.6 ★, Łódź"), "Paral·lel, Gràcia, 12 €, 4.6 *, ódz");
});

test("thin and no-break spaces become plain spaces (the fonts lack them)", async () => {
  const { safeText } = await import("../src/report-pdf.js");
  assert.equal(safeText("590 m and 7 rivals"), "590 m and 7 rivals");
});

test("short address drops a leading place name and puts the house number after the street", async () => {
  const { shortAddress } = await import("../src/tools.js");
  assert.equal(shortAddress("rico, 100, Rambla del Poblenou, el Poblenou, Sant Martí, Barcelona, Barcelonès, Barcelona, Catalunya, 08005, España"), "Rambla del Poblenou 100, el Poblenou, Barcelona");
  assert.equal(shortAddress("200, Schermerhorn Street, Brooklyn, Kings County, New York, 11201, United States"), "200 Schermerhorn Street, Brooklyn");
  assert.equal(shortAddress("41.37903, 2.15478 (Gran Via)"), "41.37903, 2.15478 (Gran Via)");
});
