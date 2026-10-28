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
  const ctx = await analyze({ concept: "seafood restaurant", address: "Avinguda del Paral·lel 40, Barcelona", radius: 1500 });
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

test("Barcelona streets typed in Spanish are also suggested by their Catalan name", async () => {
  const { catalanNamedStreet } = await import("../src/tools.js");
  assert.equal(catalanNamedStreet("Avenida del Paralelo 4"), "Avinguda del Paral·lel 4");
  assert.equal(catalanNamedStreet("Paseo de Gracia 10"), "Passeig de Gràcia 10");
  assert.equal(catalanNamedStreet("Calle Mayor 3"), null, "generic street words are not translated without a city");
});

test("scout answers that name a street missing from the tool results lose that sentence", async () => {
  const { groundStreets } = await import("../src/agent.js");
  const r = groundStreets("Recomiendo la zona entre calle Balmes y calle Tuset. Sigue en la Rambla del Poblenou.", ["Rambla del Poblenou 100, Barcelona", { address: "Carrer de Pujades, Poblenou" }]);
  assert.equal(r.text, "Sigue en la Rambla del Poblenou.");
  assert.equal(r.dropped, 1);
  assert.equal(groundStreets("Mira el Carrer de Pujades, a 300 m.", [{ address: "Carrer de Pujades" }]).dropped, 0);
});

test("an address typed with the city but no comma finds the city, and Spanish names of Barcelona streets", async () => {
  const T = await import("../src/tools.js");
  assert.equal(T.withCity("avenida paralelo barcelona"), "avenida paralelo, barcelona");
  assert.equal(T.catalanStreet(T.withCity("avenida paralelo barcelona")), "Avinguda del Paral·lel, barcelona");
  assert.deepEqual(T.namedPlaces(T.withCity("100 brick lane londres")), ["london"]);
  assert.equal(T.withCity("Rambla del Poblenou 100"), "Rambla del Poblenou 100");
});

test("a Spanish answer that came back in English is spotted", async () => {
  const { looksEnglish } = await import("../src/llm.js");
  assert.equal(looksEnglish("The area has strong appetite for ramen and there are three rivals within 700 m, so it is hard."), true);
  assert.equal(looksEnglish("La zona tiene mucho interés por el ramen y hay tres rivales a 700 m, así que es difícil."), false);
});
