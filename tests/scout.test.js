// The scout's fixed sequence (used when the model is missing or fails) runs end to end on recorded data.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.OFFLINE = "1";
process.env.CACHE_PATH = "fixtures/demo.sqlite";
delete process.env.NEBIUS_API_KEY;
const have = fs.existsSync("fixtures/demo.sqlite");

test("scripted scout answers without the model and never mentions partners", { skip: !have }, async () => {
  const { analyze, scout } = await import("../src/agent.js");
  const ctx = await analyze({ concept: "seafood restaurant", address: "Avinguda del Paral·lel 40, Barcelona" });
  for (const lang of ["en", "es"]) {
    const r = await scout({ ctx, lang });
    assert.equal(r.mode, "scripted");
    assert.ok(r.text.length > 20);
    assert.doesNotMatch(r.text, /partner|socio/i);
    assert.equal(r.steps[0].tool, "candidate_spots");
  }
});

test("scout numbers must come from the tools: sentences with invented numbers are dropped", async () => {
  const { groundNumbers } = await import("../src/agent.js");
  const r = groundNumbers("Move 393 m east: demand 0,97 and 3 rivals within 700 m. It has 12 rivals at 0.55.", [{ distance_m: 393, demand: 0.971, competitors: 3 }]);
  assert.equal(r.text, "Move 393 m east: demand 0,97 and 3 rivals within 700 m.");
  assert.equal(r.dropped, 1);
});
