// End-to-end pipeline on recorded Qloo data (skipped when the demo cache is not present).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.OFFLINE = "1";
process.env.CACHE_PATH = "fixtures/demo.sqlite";
delete process.env.NEBIUS_API_KEY;
const have = fs.existsSync("fixtures/demo.sqlite");

test("Paral·lel 40 seafood: Hard (loved and well served), Puertecillo at 26 m, a better busy block nearby", { skip: !have }, async () => {
  const { analyze } = await import("../src/agent.js");
  const r = await analyze({ concept: "seafood restaurant", address: "Avinguda del Paral·lel 40, Barcelona", radius: 1500 });
  assert.equal(r.verdict.level, "AMBER");
  assert.equal(r.verdict.rule_code, "well-served");
  assert.ok(r.heatmap.demand > 0.9, "the area likes seafood a lot");
  assert.equal(r.competitors.length, 7);
  assert.equal(r.competitors[0].name, "Puertecillo Paral·lel");
  assert.equal(r.share[0].places, 13);
  assert.ok(r.heatmap.best && r.heatmap.best.c700 < r.verdict.offer.c700 && r.heatmap.best.places_200m >= 15, "better block is busy and less served");
  assert.ok(r.trace.length >= 5, "every signal leaves a trace entry");
  assert.ok(r.trace.every((t) => !/X-Api-Key|hack_/.test(t.url)), "the key never appears in the trace");
  assert.doesNotMatch(r.report.headline, /\d\.\d\d/, "no decimals in the headline");
});

test("Gran Via 400 waffles & ice cream: Hard on ice cream; waffles not measured, not called a gap", { skip: !have }, async () => {
  const { analyze } = await import("../src/agent.js");
  const r = await analyze({ concept: "waffles and ice cream", address: "Gran Via de les Corts Catalanes 400, Barcelona", radius: 1500 });
  assert.equal(r.verdict.level, "AMBER");
  assert.deepEqual(r.measured, ["ice cream"]);
  assert.deepEqual(r.unmeasured, ["waffles"]);
  assert.deepEqual(r.gap, [], "Qloo has no waffle-tagged places within 5 km: that is missing data, not a gap");
  assert.match(r.report.headline, /no data on "waffles"/);
  assert.ok(!r.profile.who.some((w) => /lgbt/i.test(w.name)), "sensitive identities are filtered");
});

test("Spanish template report has no English sentences", { skip: !have }, async () => {
  const { analyze } = await import("../src/agent.js");
  const r = await analyze({ concept: "seafood restaurant", address: "Avinguda del Paral·lel 40, Barcelona", lang: "es", radius: 1500 });
  assert.match(r.report.headline, /A la zona le gusta/);
  assert.match(r.report.why[0], /La zona lo quiere/);
  assert.match(r.report.unknowns[0], /Tráfico/);
});
