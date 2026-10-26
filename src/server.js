import express from "express";
import crypto from "node:crypto";
import { analyze, chat } from "./agent.js";
import { llmEnabled, MODELS } from "./llm.js";

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static("public", { extensions: ["html"] }));

// --- demo protection: 30 analyses per IP per day, in memory
const quota = new Map();
function allow(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const k = `${ip}|${day}`;
  const n = (quota.get(k) ?? 0) + 1;
  quota.set(k, n);
  return n <= (Number(process.env.DAILY_LIMIT) || 30);
}

// --- analyses kept in memory for the chat (ids expire after 2 h)
const sessions = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600 * 1000;
  for (const [id, s] of sessions) if (s.t < cutoff) sessions.delete(id);
}, 600000).unref();

app.get("/api/health", (_req, res) => res.json({ ok: true, llm: llmEnabled, models: MODELS, qloo: !!process.env.QLOO_API_KEY, tavily: !!process.env.TAVILY_API_KEY }));

app.post("/api/analyze", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.ip;
  if (!allow(ip)) return res.status(429).json({ error: "Daily demo limit reached for this IP (30 analyses). Try again tomorrow." });
  const { concept, address, lang = "en", without_qloo = false } = req.body ?? {};
  if (!concept || !address) return res.status(400).json({ error: "concept and address are required" });
  if (String(concept).length > 120 || String(address).length > 200) return res.status(400).json({ error: "input too long" });
  try {
    const result = await analyze({ concept: String(concept), address: String(address), lang, withoutQloo: !!without_qloo });
    const id = crypto.randomUUID();
    sessions.set(id, { t: Date.now(), ctx: result, history: [] });
    res.json({ id, ...result });
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

app.post("/api/chat", async (req, res) => {
  const { id, question, lang = "en" } = req.body ?? {};
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: "analysis not found or expired; run it again" });
  if (!question || String(question).length > 500) return res.status(400).json({ error: "question required (max 500 chars)" });
  try {
    const r = await chat({ ctx: s.ctx, history: s.history.slice(-8), question: String(question), lang });
    s.history.push({ role: "user", content: String(question) }, { role: "assistant", content: r.text });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: String(e.message).slice(0, 300) });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Abro Aquí on :${port} — LLM ${llmEnabled ? "on (" + MODELS.fast + " / " + MODELS.writer + ")" : "OFF (template mode)"}`));
