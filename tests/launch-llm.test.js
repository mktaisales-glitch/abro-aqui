// Launch plan with the LLM enabled: mock Qloo + mock Token Factory (no network).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startQlooMock, ctx } from "./mock/qloo-launch.js";
import { startMock } from "./mock/token-factory.js";

process.env.CACHE_MEMORY = "1";
delete process.env.OFFLINE;
delete process.env.TAVILY_API_KEY;
process.env.NEBIUS_API_KEY = "test";
let q, m;
before(async () => {
  q = await startQlooMock();
  process.env.QLOO_API_URL = `http://127.0.0.1:${q.address().port}`;
  let port;
  ({ server: m, port } = await startMock());
  process.env.NEBIUS_BASE_URL = `http://localhost:${port}/v1/`;
});
after(() => { q.close(); m.close(); });

test("with the model: Super chooses among the candidates; invented names are dropped, empty sections filled", async () => {
  const { launchPlan } = await import("../src/launch.js");
  const r = await launchPlan({ ctx, lang: "en" });
  assert.equal(r.meta.model, "nvidia/nemotron-3-super-120b-a12b");
  assert.deepEqual(r.plan.music.map((x) => x.name), ["Vetusta Morla"]);
  assert.deepEqual(r.plan.co_promo.map((x) => x.name), ["Teatre Apolo"]);
  assert.ok(r.plan.brands.length >= 1, "the model left brands empty: the template fills it from the candidates");
  assert.equal(r.plan.posters.length, 3);
  assert.ok(!r.plan.weeks.join(" ").includes("Inventado"), "the weeks are written by code, never by the model");
  assert.match(r.plan.weeks[0], /Teatre Apolo/);
  assert.match(r.plan.headline, /Marisqueria B/);
});
