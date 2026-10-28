// Runs the full pipeline with the LLM enabled against a local Token Factory mock (no network, recorded Qloo data).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startMock } from "./mock/token-factory.js";
const have = fs.existsSync("fixtures/demo.sqlite");

test("LLM path: Nano normalises, Super writes, Lightning calls a tool in the chat", { skip: !have }, async () => {
  const { server, calls, port } = await startMock();
  process.env.OFFLINE = "1";
  process.env.CACHE_PATH = "fixtures/demo.sqlite";
  process.env.NEBIUS_API_KEY = "test";
  process.env.NEBIUS_BASE_URL = `http://localhost:${port}/v1/`;
  const { analyze, chat } = await import("../src/agent.js?llm");
  const r = await analyze({ concept: "marisquería", address: "Avinguda del Paral·lel 40, Barcelona", withoutQloo: true, radius: 1500 });
  assert.equal(r.verdict.level, "AMBER");
  assert.equal(r.report.partners.length, 0, "offline: partners cannot be checked on the web, so none is shown");
  assert.equal(r.report_meta.model, "nvidia/nemotron-3-super-120b-a12b");
  assert.ok(r.without_qloo?.headline);
  assert.deepEqual(r.llm.map((l) => l.model).sort(), ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-super-120b-a12b"]);
  const c = await chat({ ctx: r, history: [], question: "What if I ignore Puertecillo?" });
  assert.equal(c.calls[0].name, "nearby_competitors");
  assert.ok(c.calls[0].result.competitors.every((x) => !/Puertecillo/.test(x.name)));
  assert.ok(calls.some((x) => x.model === "nvidia/Nemotron-3_5-Lightning" && x.tools));
  server.close();
});
