// The Qloo client never has more than 4 calls in flight and retries a 429.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
process.env.CACHE_MEMORY = "1";
delete process.env.OFFLINE;
let server, inflight = 0, peak = 0, n429 = 0;
before(async () => {
  server = http.createServer((req, res) => {
    inflight++; peak = Math.max(peak, inflight);
    setTimeout(() => {
      inflight--;
      if (req.url.includes("flaky") && n429 < 1) { n429++; res.statusCode = 429; return res.end('{"error_msg":"Rate limit exceeded"}'); }
      res.setHeader("content-type", "application/json"); res.end('{"results":{}}');
    }, 30);
  });
  await new Promise((r) => server.listen(0, r));
  process.env.QLOO_API_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("at most 4 Qloo calls in flight; a 429 is retried", async () => {
  const { qloo } = await import("../src/qloo.js");
  await Promise.all(Array.from({ length: 12 }, (_, i) => qloo("/v2/insights", { i })));
  assert.ok(peak <= 4, `peak ${peak}`);
  const r = await qloo("/v2/insights", { q: "flaky" });
  assert.deepEqual(r, { results: {} });
  assert.equal(n429, 1);
});
