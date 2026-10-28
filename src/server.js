import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { analyze, chat, compare, scout } from "./agent.js";
import { llmEnabled, MODELS, llmUsage } from "./llm.js";
import { scrubPII } from "./safe.js";
import { launchPlan } from "./launch.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1)); // Render / one reverse proxy: req.ip is the real client
app.use(express.json({ limit: "200kb" }));
app.use(express.static("public", { extensions: ["html"] }));
// self-hosted map library and fonts: no third-party CDN at runtime
app.use("/vendor/leaflet", express.static(path.resolve("node_modules/leaflet/dist")));
app.use("/vendor/fonts", express.static(path.resolve("node_modules/@fontsource/montserrat/files")));
app.use("/vendor/fonts", express.static(path.resolve("node_modules/@fontsource/michroma/files")));

// --- demo protection: N analyses per IP per day (in memory)
const quota = new Map();
const LIMITS = { analyze: Number(process.env.DAILY_LIMIT) || 30, compare: 30, chat: 60, scout: 20, launch: 20 };
function allow(ip, kind = "analyze") {
  const k = `${kind}|${ip}|${new Date().toISOString().slice(0, 10)}`;
  const n = (quota.get(k) ?? 0) + 1;
  quota.set(k, n);
  return n <= LIMITS[kind];
}
const ipOf = (req) => req.ip;
const str = (x, max) => (typeof x === "string" && x.trim() && x.length <= max ? x.trim() : null);

// --- analyses kept for the chat and the comparison (2 h)
const sessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600 * 1000;
  for (const [id, s] of sessions) if (s.t < cutoff) sessions.delete(id);
}, 600000).unref();

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, llm: llmEnabled, models: MODELS, llm_calls_today: llmUsage(), qloo: !!process.env.QLOO_API_KEY, tavily: !!process.env.TAVILY_API_KEY, offline: process.env.OFFLINE === "1" })
);

app.post("/api/analyze", async (req, res) => {
  const { lang = "en", without_qloo = false } = req.body ?? {};
  const concept = str(req.body?.concept, 120), address = str(req.body?.address, 200);
  if (!concept || !address) return res.status(400).json({ error: "Write a business concept (up to 120 characters) and a street address (up to 200)." });
  if (!allow(ipOf(req))) return res.status(429).json({ error: `You have used today's ${LIMITS.analyze} free analyses on this demo. Try again tomorrow.` });
  try {
    const result = await analyze({ concept: scrubPII(concept), address, lang: lang === "es" ? "es" : "en", withoutQloo: !!without_qloo });
    const id = crypto.randomUUID();
    sessions.set(id, { t: Date.now(), ctx: result, history: [] });
    res.json({ id, ...result });
  } catch (e) {
    res.status(e.code === "MISS" ? 503 : 500).json({ error: e.code === "MISS" ? "This demo is running on recorded data and this address is not recorded yet. Try one of the examples." : String(e.message).slice(0, 300) });
  }
});

app.post("/api/compare", async (req, res) => {
  const { id, address } = req.body ?? {};
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: "Run the analysis again: comparisons use the last one and it expired." });
  const a2 = str(address, 200);
  if (!a2) return res.status(400).json({ error: "Write the second address (up to 200 characters)." });
  if (!allow(ipOf(req), "compare")) return res.status(429).json({ error: "Daily comparison limit reached on this demo." });
  try {
    res.json(await compare({ ctx: s.ctx, address: a2 }));
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

app.post("/api/chat", async (req, res) => {
  const { id, question, lang = "en" } = req.body ?? {};
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: "Run the analysis again: the chat uses the last one and it expired." });
  const q = str(question, 500);
  if (!q) return res.status(400).json({ error: "Ask a question of up to 500 characters." });
  if (!allow(ipOf(req), "chat")) return res.status(429).json({ error: "Daily chat limit reached on this demo." });
  const clean = scrubPII(q);
  try {
    const r = await chat({ ctx: s.ctx, history: s.history.slice(-8), question: clean, lang: lang === "es" ? "es" : "en" });
    s.history.push({ role: "user", content: clean }, { role: "assistant", content: r.text });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

app.post("/api/scout", async (req, res) => {
  const { id, lang = "en" } = req.body ?? {};
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: "Run the analysis again: the scout uses the last one and it expired." });
  if (!allow(ipOf(req), "scout")) return res.status(429).json({ error: "Daily scouting limit reached on this demo." });
  try {
    res.json(await scout({ ctx: s.ctx, lang: lang === "es" ? "es" : "en" }));
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

app.post("/api/launch", async (req, res) => {
  const { id, lang = "en", at } = req.body ?? {};
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: "Run the analysis again: the launch plan uses the last one and it expired." });
  if (!allow(ipOf(req), "launch")) return res.status(429).json({ error: "Daily launch-plan limit reached on this demo." });
  const best = s.ctx.heatmap?.best;
  const spot = at === "best" && best ? { lat: best.lat, lon: best.lon } : undefined;
  try {
    res.json(await launchPlan({ ctx: s.ctx, lang: lang === "es" ? "es" : "en", at: spot }));
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

// malformed JSON or anything unexpected: a short JSON error, never a stack trace
app.use((err, _req, res, _next) => res.status(err.status === 400 || err.type === "entity.parse.failed" ? 400 : 500).json({ error: err.type === "entity.parse.failed" ? "Malformed JSON." : "Something went wrong." }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Abro Aquí on :${port} — LLM ${llmEnabled ? `on (${MODELS.nano} / ${MODELS.fast} / ${MODELS.writer})` : "OFF (template mode)"}${process.env.OFFLINE === "1" ? " — OFFLINE replay" : ""}`));
