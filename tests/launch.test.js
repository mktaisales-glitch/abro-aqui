// Launch plan: pure selection rules + wiring against a local mock of the Qloo API (no network, no key).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seen, startQlooMock, ctx } from "./mock/qloo-launch.js";

process.env.CACHE_MEMORY = "1";
process.env.QLOO_API_URL = "http://127.0.0.1:3198";
delete process.env.OFFLINE;
delete process.env.NEBIUS_API_KEY;
delete process.env.TAVILY_API_KEY;
const cells = ctx.heatmap.cells;
let server;
before(async () => { server = await startQlooMock(3198); });
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

test("launch plan: neighbours exclude rivals, same-concept places, closed and sensitive places; names never invented", async () => {
  const { launchPlan } = await import("../src/launch.js");
  const r = await launchPlan({ ctx });
  const names = r.candidates.neighbours.map((n) => n.name);
  assert.deepEqual(names, ["Teatre Apolo", "Bar Ramon"]);
  assert.equal(r.candidates.signal, "rivals");
  assert.deepEqual(r.candidates.brands.map((b) => b.name), ["Estrella Damm"], "a rival is never proposed as a brand partner");
  assert.equal(r.meta.model, "template");
  assert.equal(r.plan.weeks.length, 4);
  assert.equal(r.plan.posters.length, 3);
  assert.ok(r.plan.co_promo.every((p) => names.includes(p.name)));
  assert.match(r.plan.headline, /Marisqueria B/);
  const calls = seen.filter((q) => q["filter.type"]);
  assert.equal(calls.length, 3);
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

