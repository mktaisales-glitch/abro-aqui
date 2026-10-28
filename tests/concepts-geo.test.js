// Concept list and synonyms, geocoding in the city the address names, address suggestions, LLM budget numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.CACHE_MEMORY = "1";
process.env.OFFLINE = "1"; // nothing leaves the machine: every external answer below is put in the cache by the test
delete process.env.LLM_DAILY_CAP;
delete process.env.LLM_DAILY_CAP_PER_IP;

const { matchConcept, knownResolved, publicConcepts, CONCEPT_LIST } = await import("../src/concepts.js");
const T = await import("../src/tools.js");
const { putCache } = await import("../src/http.js");

test("concept synonyms in Spanish, Catalan and English map to the listed concept", () => {
  for (const [typed, id] of [["hamburguesería", "burger"], ["Hamburgueseria", "burger"], ["burgers", "burger"], ["una hamburguesería", "burger"],
    ["Pizzería", "pizza"], ["marisquería", "seafood restaurant"], ["cafetería", "coffee shop"], ["Café", "coffee shop"], ["specialty coffee", "coffee shop"],
    ["heladería", "ice cream"], ["gelats", "ice cream"], ["panadería", "bakery"], ["forn de pa", "bakery"], ["vermut", "wine bar"], ["bodega", "wine bar"],
    ["Coctelería", "cocktail bar"], ["Restaurante vegano", "vegan restaurant"], ["taquería", "mexican restaurant"], ["Bar de tapas", "tapas"]]) {
    assert.equal(matchConcept(typed)?.id, id, typed);
  }
  assert.equal(matchConcept("vietnamita"), null, "a concept that is not in the list is not guessed");
  assert.equal(matchConcept("libanés"), null);
  assert.equal(matchConcept(""), null);
});

test("the list: 15 concepts, every one with both labels; known tags come back in the resolver's shape", () => {
  assert.equal(CONCEPT_LIST.length, 15);
  for (const c of publicConcepts()) assert.ok(c.id && c.en && c.es && c.synonyms.length, c.id);
  assert.equal(publicConcepts(new Set(["sushi"])).length, 14, "a dropped concept leaves the list");
  const r = knownResolved("seafood restaurant");
  assert.equal(r[0].heatmap_tag, "urn:tag:genre:place:restaurant:seafood");
  assert.equal(r[0].competitor_tag, "urn:tag:category:place:seafood_restaurant");
  assert.equal(knownResolved("burger"), null, "tags not written down are resolved with /v2/tags");
});

const NOM = "https://nominatim.openstreetmap.org/search?format=json&limit=5&q=";
const hit = (lat, lon, display_name) => ({ lat: String(lat), lon: String(lon), display_name });

test("geocode prefers the city the address names; Spanish street names for Barcelona fall back to Catalan", async () => {
  const typed = "Avenida del Paralelo 4, Barcelona";
  putCache(NOM + encodeURIComponent(typed), [hit(39.33, -0.41, "Avenida del Paralelo, Almussafes, Ribera Baixa, València, España")]);
  putCache(NOM + encodeURIComponent("Avinguda del Paral·lel 4, Barcelona"), [hit(41.3755, 2.1735, "4, Avinguda del Paral·lel, el Raval, Ciutat Vella, Barcelona, Catalunya, 08001, España")]);
  const g = await T.geocode(typed);
  assert.match(g.display_name, /Barcelona/);
  assert.ok(Math.abs(g.lat - 41.3755) < 1e-6 && !g.mismatch);
  // several candidates: the one in the named city wins even when it is not first
  const t2 = "Calle Mayor 10, Madrid";
  putCache(NOM + encodeURIComponent(t2), [hit(40.1, -3.0, "Calle Mayor, Alcalá de Henares, España"), hit(40.4155, -3.7074, "10, Calle Mayor, Sol, Centro, Madrid, España")]);
  assert.equal((await T.geocode(t2)).lat, 40.4155);
  // nowhere in the named city: best guess, flagged so the page can ask "is this the place?"
  const t3 = "Sesame Street 1, Barcelona";
  putCache(NOM + encodeURIComponent(t3), [hit(40.7, -74.0, "Sesame Street, New York, United States")]);
  const g3 = await T.geocode(t3);
  assert.equal(g3.mismatch, "barcelona");
});

test("street aliases and named places", () => {
  assert.equal(T.catalanStreet("Avenida del Paralelo 4, Barcelona"), "Avinguda del Paral·lel 4, Barcelona");
  assert.equal(T.catalanStreet("Calle de Sants 100, Barcelona"), "Carrer de Sants 100, Barcelona");
  assert.equal(T.catalanStreet("Gran Vía 400, Barcelona"), "Gran Via de les Corts Catalanes 400, Barcelona");
  assert.equal(T.catalanStreet("Paseo de Gracia 10, Barcelona"), "Passeig de Gràcia 10, Barcelona");
  assert.equal(T.catalanStreet("Diagonal 500, Barcelona"), "Avinguda Diagonal 500, Barcelona");
  assert.equal(T.catalanStreet("Calle de Fuencarral 100, Madrid"), "Calle de Fuencarral 100, Madrid", "only Barcelona");
  assert.deepEqual(T.namedPlaces("Calle Mayor 3, 28013 Madrid, Spain"), ["madrid"]);
  assert.deepEqual(T.namedPlaces("50 Rue Oberkampf, Paris"), ["paris"]);
  assert.ok(T.placeMatches("Via Roma, Milano, Italia", T.namedPlaces("Via Roma 1, Milan")), "English city names match the local one");
});

test("address suggestions: short labels from Photon (mocked), country apart, at most 5, picked coordinates kept", async () => {
  const f = (props, lon, lat) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: props });
  const q = "Paral·lel 4";
  putCache(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`, {
    features: [
      f({ street: "Avinguda del Paral·lel", housenumber: "4", district: "el Raval", city: "Barcelona", country: "España" }, 2.1735, 41.3755),
      f({ street: "Avinguda del Paral·lel", housenumber: "4", district: "el Raval", city: "Barcelona", country: "España" }, 2.1735, 41.3755),
      f({ name: "Paral·lel", city: "Barcelona", country: "España" }, 2.169, 41.375),
      ...Array.from({ length: 4 }, (_, i) => f({ street: `Calle ${i}`, city: "Almussafes", country: "España" }, -0.41, 39.33)),
    ],
  });
  const r = await T.suggestPlaces(q, "es");
  assert.equal(r.length, 5);
  assert.deepEqual(r[0], { label: "Avinguda del Paral·lel 4, el Raval, Barcelona", country: "España", lat: 41.3755, lon: 2.1735 });
  assert.equal(r[1].label, "Paral·lel, Barcelona", "duplicates dropped");
  assert.deepEqual(await T.suggestPlaces("abc"), [], "under 4 characters: nothing asked");
  const g = T.geoFromCoords({ lat: 41.3755, lon: 2.1735 }, "Avinguda del Paral·lel 4, el Raval, Barcelona, España");
  assert.equal(g.lat, 41.3755);
  assert.match(g.display_name, /Paral·lel 4/);
  assert.equal(T.geoFromCoords({ lat: 200, lon: 0 }, "x"), null);
});

test("LLM budget: 250 calls per visitor and 2500 in total per day; the chat says the free limit is used up", async () => {
  const { llmCaps, LLM_DAILY_CAP_DEFAULT, LLM_DAILY_CAP_PER_IP_DEFAULT } = await import("../src/llm.js");
  assert.equal(LLM_DAILY_CAP_DEFAULT, 2500);
  assert.equal(LLM_DAILY_CAP_PER_IP_DEFAULT, 250);
  assert.deepEqual(llmCaps(), { total: 2500, per_visitor: 250 });
  const { BUDGET_TEXT } = await import("../src/agent.js");
  assert.match(BUDGET_TEXT.en, /today's free limit for the assistant is used up on this demo/i);
  assert.match(BUDGET_TEXT.es, /límite gratuito de hoy del asistente/);
});
