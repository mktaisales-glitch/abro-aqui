import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { analyze, chat, compare } from "./agent.js";
import { llmEnabled, MODELS, llmUsage } from "./llm.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.use(express.static("public", { extensions: ["html"] }));
// self-hosted map library and fonts: no third-party CDN at runtime
app.use("/vendor/leaflet", express.static(path.resolve("node_modules/leaflet/dist")));
app.use("/vendor/fonts", express.static(path.resolve("node_modules/@fontsource/montserrat/files")));
app.use("/vendor/fonts", express.static(path.resolve("node_modules/@fontsource/michroma/files")));

// --- demo protection: N analyses per IP per day (in memory)
const quota = new Map();
function allow(ip) {
  const k = `${ip}|${new Date().toISOString().slice(0, 10)}`;
  const n = (quota.get(k) ?? 0) + 1;
  quota.set(k, n);
  return n <= (Number(process.env.DAILY_LIMIT) || 30);
}
const ipOf = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;

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
  if (!allow(ipOf(req))) return res.status(429).json({ error: "You have used today's 30 free analyses on this demo. Try again tomorrow." });
  const { concept, address, lang = "en", without_qloo = false } = req.body ?? {};
  if (!concept?.trim() || !address?.trim()) return res.status(400).json({ error: "Write a business concept and a street address." });
  if (String(concept).length > 120 || String(address).length > 200) return res.status(400).json({ error: "Keep the concept under 120 characters and the address under 200." });
  try {
    const result = await analyze({ concept: String(concept).trim(), address: String(address).trim(), lang, withoutQloo: !!without_qloo });
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
  if (!address?.trim()) return res.status(400).json({ error: "Write the second address." });
  try {
    res.json(await compare({ ctx: s.ctx, address: String(address).trim() }));
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

app.post("/api/chat", async (req, res) => {
  const { id, question, lang = "en" } = req.body ?? {};
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: "Run the analysis again: the chat uses the last one and it expired." });
  if (!question?.trim() || String(question).length > 500) return res.status(400).json({ error: "Ask a question of up to 500 characters." });
  try {
    const r = await chat({ ctx: s.ctx, history: s.history.slice(-8), question: String(question), lang });
    s.history.push({ role: "user", content: String(question) }, { role: "assistant", content: r.text });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Abro Aquí on :${port} — LLM ${llmEnabled ? `on (${MODELS.nano} / ${MODELS.fast} / ${MODELS.writer})` : "OFF (template mode)"}${process.env.OFFLINE === "1" ? " — OFFLINE replay" : ""}`));
