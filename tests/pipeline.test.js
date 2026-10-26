// End-to-end pipeline on recorded Qloo data (skipped when the demo cache is not present).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.OFFLINE = "1";
process.env.CACHE_PATH = "data/demo.sqlite";
delete process.env.NEBIUS_API_KEY;
const have = fs.existsSync("data/demo.sqlite");

test("Paral·lel 40 seafood: RED, 7 competitors, 13 of 50 popular places already serve seafood", { skip: !have }, async () => {
  const { analyze } = await import("../src/agent.js");
  const r = await analyze({ concept: "seafood restaurant", address: "Avinguda del Paral·lel 40, Barcelona" });
  assert.equal(r.verdict.level, "RED");
  assert.equal(r.competitors.length, 7);
  assert.equal(r.share[0].places, 13);
  assert.ok(r.trace.length >= 5, "every signal leaves a trace entry");
  assert.ok(r.trace.every((t) => !/X-Api-Key|hack_/.test(t.url)), "the key never appears in the trace");
});

test("Gran Via 400 waffles & ice cream: AMBER, gap = waffles, better cell nearby", { skip: !have }, async () => {
  const { analyze } = await import("../src/agent.js");
  const r = await analyze({ concept: "waffles and ice cream", address: "Gran Via de les Corts Catalanes 400, Barcelona" });
  assert.equal(r.verdict.level, "AMBER");
  assert.deepEqual(r.gap, ["waffles"]);
  assert.ok(r.heatmap.best.affinity > r.heatmap.nearest.affinity + 0.2);
  assert.ok(!r.profile.who.some((w) => /lgbt/i.test(w.name)), "sensitive identities are filtered");
});
