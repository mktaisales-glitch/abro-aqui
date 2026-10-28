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
