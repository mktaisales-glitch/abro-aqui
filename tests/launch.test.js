// Launch plan: pure selection rules + wiring against a local mock of the Qloo API (no network, no key).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seen, startQlooMock, ctx } from "./mock/qloo-launch.js";

process.env.CACHE_MEMORY = "1";
delete process.env.OFFLINE;
delete process.env.NEBIUS_API_KEY;
delete process.env.TAVILY_API_KEY;
const cells = ctx.heatmap.cells;
let server;
before(async () => { server = await startQlooMock(); process.env.QLOO_API_URL = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());

test("seeds are the best-rated rivals that have a Qloo id", async () => {
  const { pickSeeds, signalParams } = await import("../src/launch.js");
  const s = pickSeeds(ctx.competitors);
  assert.deepEqual(s.map((x) => x.name), ["Marisqueria B", "Puertecillo Paral·lel"]);
  assert.deepEqual(signalParams(s, "tag"), { "signal.interests.entities": "id-b,id-puertecillo" });
  assert.deepEqual(signalParams([], "tag"), { "signal.interests.tags": "tag" });
  assert.equal(signalParams([], null), null);
});

test("poster zones: busy, liked, spread out, never the shop's own block", async () => {
  const { posterZones } = await import("../src/launch.js");
  const z = posterZones(cells, ctx.geo);
  assert.equal(z.length, 3);
  assert.ok(z.every((x) => x.distance_m >= 120 && x.activity >= 0.6));
  assert.equal(z[0].demand, 0.97, "highest demand × activity first");
  assert.ok(!z.some((x) => x.lat === 41.378), "a block 25 m from a chosen one is skipped");
});

test("launch plan: neighbours exclude rivals, same-concept places, closed places and care/children/grief settings, never identity; names never invented", async () => {
  const { launchPlan } = await import("../src/launch.js");
  const r = await launchPlan({ ctx });
  const names = r.candidates.neighbours.map((n) => n.name);
  assert.deepEqual(names, ["Teatre Apolo", "Bar Ramon", "Pride Bar"], "a place is never excluded for who its customers are");
  assert.equal(r.candidates.signal, "rivals");
  assert.deepEqual(r.candidates.brands.map((b) => b.name), ["Estrella Damm"], "a rival is never proposed as a brand partner");
  assert.equal(r.meta.model, "template");
  assert.equal(r.plan.weeks.length, 4);
  assert.equal(r.plan.posters.length, 3);
  assert.ok(r.plan.co_promo.every((p) => names.includes(p.name)));
  assert.match(r.plan.headline, /Marisqueria B/);
  const calls = seen.filter((q) => q["filter.type"] && q["filter.location.radius"] !== "150");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((q) => !q["signal.location"]), "no location signal: at street level it pulls generic luxury brands");
  assert.ok(calls.every((q) => q["signal.interests.entities"] === "id-b,id-puertecillo"));
  assert.equal(calls.find((q) => q["filter.type"] === "urn:entity:place")["filter.location.radius"], "600");
});

test("keepKnown drops anything the model invents", async () => {
  const { keepKnown } = await import("../src/launch.js");
  const c = { music: [{ name: "Vetusta Morla" }], neighbours: [{ name: "Bar Ramon" }], brands: [] };
  const p = keepKnown({ music: [{ name: "vetusta morla", why: "" }, { name: "Made Up Band", why: "" }], co_promo: [{ name: "Fake Bar", idea: "" }], brands: [{ name: "X", idea: "" }] }, c);
  assert.equal(p.music.length, 1);
  assert.equal(p.co_promo.length, 0);
  assert.equal(p.brands.length, 0);
});


test("co-promotion ideas fit the kind of neighbour", async () => {
  const { coPromoIdea } = await import("../src/launch.js");
  assert.match(coPromoIdea({ kind: "Performing arts theater", distance_m: 120 }), /pre-show offer/);
  assert.match(coPromoIdea({ kind: "Hotel", distance_m: 80 }, "es"), /recepción/);
  assert.match(coPromoIdea({ kind: null, distance_m: 50 }), /swap flyers/);
});

test("brands: no rivals, no restaurant chains for a restaurant, nothing a shop cannot approach", async () => {
  const { pickBrands } = await import("../src/launch.js");
  const b = [{ name: "Estrella Damm", tags: ["Beer"] }, { name: "Scalpers", tags: ["Fashion"] }, { name: "Goiko", tags: ["Burger restaurant"] }, { name: "Wallapop", tags: ["Software"] }, { name: "Unknown Co", tags: [] }];
  assert.deepEqual(pickBrands(b, { isRestaurant: true }).map((x) => x.name), ["Estrella Damm", "Unknown Co"]);
  assert.deepEqual(pickBrands(b, { rivalNames: ["estrella damm"] }).map((x) => x.name), ["Goiko", "Unknown Co"]);
});

test("at the better spot, the seeds are the rivals around that spot", async () => {
  const { launchCandidates } = await import("../src/launch.js");
  const spot = { lat: 41.3800, lon: 2.1600 };
  const c2 = { ...ctx, rivals_wide: [{ name: "Far Rival", id: "id-far", rating: 4.8, lat: 41.3805, lon: 2.1605 }, ...ctx.competitors.map((c) => ({ ...c, lat: 41.375, lon: 2.169 }))] };
  const r = await launchCandidates(c2, { add() {}, entries: [] }, { at: spot });
  assert.deepEqual(r.seeds.map((s) => s.name), ["Far Rival"]);
});

test("currency from the country in the geocoded name; unknown → no symbol", async () => {
  const { currencyOf } = await import("../src/tools.js");
  assert.equal(currencyOf("200, Schermerhorn Street, Brooklyn, Kings County, New York, 11201, United States"), "$");
  assert.equal(currencyOf("40, Avinguda del Paral·lel, Barcelona, Catalunya, 08001, España"), "€");
  assert.equal(currencyOf("40.68855, -73.98537"), null);
});

test("restaurant concepts: a place tagged only 'Restaurant' (or with a restaurant genre) is a rival trade, not a partner; bars stay", async () => {
  const { pickNeighbours } = await import("../src/launch.js");
  const ex = /restaurant|steakhouse|bistro|diner|eatery|pizza|takeout|take-out|burger|tapas|grill|kitchen|sushi|taco|kebab|food/i;
  const ents = [
    { name: "Chivuo's", tags: [{ id: "urn:tag:category:place:restaurant", name: "Restaurant", type: "urn:tag:category:place" }, { id: "urn:tag:genre:place:restaurant:burger", name: "Burger", type: "urn:tag:genre:place" }], location: { lat: 41.4, lon: 2.2 } },
    { name: "Taller Burger", tags: [], location: { lat: 41.4, lon: 2.2 } },
    { name: "Bar Ramon", tags: [{ id: "urn:tag:category:place:bar", name: "Bar", type: "urn:tag:category:place" }, { id: "urn:tag:category:place:tapas_restaurant", name: "Tapas restaurant", type: "urn:tag:category:place" }], location: { lat: 41.4, lon: 2.2 } },
    { name: "Sala Barts", tags: [{ id: "urn:tag:category:place:concert_hall", name: "Concert hall", type: "urn:tag:category:place" }], location: { lat: 41.4, lon: 2.2 } },
  ];
  const names = pickNeighbours(ents, { lat: 41.4, lon: 2.2, excludeKinds: ex }).map((n) => n.name);
  assert.deepEqual(names, ["Bar Ramon", "Sala Barts"]);
  // without a restaurant concept nothing is excluded for its trade
  assert.equal(pickNeighbours(ents, { lat: 41.4, lon: 2.2 }).length, 4);
});
