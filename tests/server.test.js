// HTTP layer: security headers, input validation, body limit, health without internals.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const PORT = 3000 + Math.floor(Math.random() * 2000) + 4000;
let srv;
before(async () => {
  srv = spawn(process.execPath, ["src/server.js"], { env: { ...process.env, PORT: String(PORT), OFFLINE: "1", CACHE_MEMORY: "1", NEBIUS_API_KEY: "" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/health`); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => srv.kill());
const post = (path, body, raw) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) });

test("security headers on every response; health shows no budget or model internals", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  assert.match(r.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.llm_calls_today, undefined);
  assert.equal(j.models, undefined);
});

test("bad input is rejected with a short message; oversized bodies get 413; malformed JSON 400", async () => {
  assert.equal((await post("/api/analyze", { concept: "", address: "x" })).status, 400);
  assert.equal((await post("/api/analyze", { concept: "a".repeat(200), address: "x" })).status, 400);
  assert.equal((await post("/api/chat", { id: "nope", question: "hi" })).status, 404);
  const pdf = await fetch(`http://127.0.0.1:${PORT}/api/report.pdf?id=nope`);
  assert.equal(pdf.status, 404, "an unknown or expired session has no report");
  assert.match((await pdf.json()).error, /expired/);
  assert.equal((await post("/api/analyze", null, "{bad")).status, 400);
  assert.equal((await post("/api/analyze", { concept: "x", address: "y".repeat(60000) })).status, 413);
});

test("GET /api/concepts lists the 15 concepts with English and Spanish labels; suggestions never fail the page", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/concepts`);
  assert.equal(r.status, 200);
  const { concepts } = await r.json();
  assert.equal(concepts.length, 15);
  const burger = concepts.find((c) => c.id === "burger");
  assert.equal(burger.es, "Hamburguesería");
  assert.ok(burger.synonyms.includes("hamburgueseria"));
  assert.equal(concepts[0].tags, undefined, "tags stay on the server");
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/geocode/suggest?q=ab`)).json();
  assert.deepEqual(s.results, [], "under 4 characters: no lookup");
  const s2 = await fetch(`http://127.0.0.1:${PORT}/api/geocode/suggest?q=${encodeURIComponent("Carrer nowhere 1, Barcelona")}&lang=es`);
  assert.equal(s2.status, 200);
  assert.deepEqual((await s2.json()).results, [], "service not reachable (offline): an empty list, not an error");
});

test("the result card shows what the owner commits before the first customer (rent × months + fit-out), in both languages", async () => {
  const html = (await import("node:fs")).readFileSync("public/index.html", "utf8");
  assert.match(html, /id="stake-total"/);
  for (const id of ["st-rent", "st-months", "st-fit"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /committed before the first customer/);
  assert.match(html, /comprometidos antes del primer cliente/);
  assert.match(html, /"st-rent":"alquiler \/ mes"/);
});
