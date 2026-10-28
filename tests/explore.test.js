// "What fits here?": the same rules for several concepts at one address, ranked (recorded data).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.OFFLINE = "1";
process.env.CACHE_PATH = "fixtures/demo.sqlite";
delete process.env.NEBIUS_API_KEY;
const have = fs.existsSync("fixtures/demo.sqlite");

test("explore ranks concepts; a concept without data is No data, never an exception", { skip: !have }, async () => {
  const { explore } = await import("../src/explore.js");
  const r = await explore({ address: "Avinguda del Paral·lel 40, Barcelona", radius: 1500, concepts: ["ice cream", "seafood restaurant"] });
  assert.equal(r.rows[0].concept, "seafood restaurant");
  assert.equal(r.rows[0].level, "AMBER");
  assert.equal(r.rows[0].c700, 7);
  assert.equal(r.rows[1].level, "UNKNOWN");
});
