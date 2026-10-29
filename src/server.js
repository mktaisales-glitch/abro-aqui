import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { analyze, chat, chatFit, compare, scout, withoutQloo, BUDGET_TEXT } from "./agent.js";
import { llmEnabled, MODELS, withClient } from "./llm.js";
import { scrubPII } from "./safe.js";
import { launchPlan } from "./launch.js";
import { exploreOnce, exploreBusy } from "./explore.js";
import { buildReportPdf, reportFileName, mapTiles } from "./report-pdf.js";
import { matchConcept, publicConcepts, CONCEPT_LIST } from "./concepts.js";
import { suggestPlaces, resolveConcept } from "./tools.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 3)); // Render (checked in its logs): client → Cloudflare → Render balancer → app
// Security headers: everything is self-hosted except the OpenStreetMap tiles and the Nominatim lookups the page makes
app.use((_req, res, next) => {
  res.set({
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin", // OpenStreetMap tiles require a referer (their usage policy)
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(express.json({ limit: "50kb" }));
app.use(express.static("public", { extensions: ["html"] }));
// self-hosted map library and fonts: no third-party CDN at runtime
app.use("/vendor/leaflet", express.static(path.resolve("node_modules/leaflet/dist")));
app.use("/vendor/fonts", express.static(path.resolve("node_modules/@fontsource/montserrat/files")));
app.use("/vendor/fonts", express.static(path.resolve("node_modules/@fontsource/michroma/files")));

// --- demo protection: N requests per IP per day (in memory; reset on restart, documented)
const quota = new Map();
const LIMITS = { analyze: Number(process.env.DAILY_LIMIT) || 30, compare: 30, chat: 120, suggest: 400, concepts: 200, scout: 15, launch: 15, explore: 3, noqloo: 20, report: 60 };
const today = () => new Date().toISOString().slice(0, 10);
function allow(ip, kind = "analyze") {
  const k = `${kind}|${ip}|${today()}`;
  const n = (quota.get(k) ?? 0) + 1;
  quota.set(k, n);
  return n <= LIMITS[kind];
}
// IPv6 clients are grouped by /64 so one host cannot rotate addresses inside its own block
const ipOf = (req) => { const ip = String(req.ip ?? ""); return ip.includes(":") && !ip.startsWith("::ffff:") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip; };
const str = (x, max) => (typeof x === "string" && x.trim() && x.length <= max ? x.trim() : null);
let loggedProxy = false;
app.use((req, _res, next) => {
  if (!loggedProxy && req.path.startsWith("/api/") && req.get("x-forwarded-for")) { loggedProxy = true; console.log(`proxy check: ip=${req.ip} ips=${JSON.stringify(req.ips)} xff=${req.get("x-forwarded-for") ?? ""}`); }
  next();
});
// every request runs with its client's IP in context, so the LLM budget can be counted per visitor (src/llm.js)
app.use((req, _res, next) => withClient(ipOf(req), next));

// --- analyses kept for the chat and the comparison (2 h, at most 300: oldest dropped first)
const sessions = new Map();
const MAX_SESSIONS = 300;
function keep(id, value) {
  sessions.set(id, value);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}
setInterval(() => {
  const cutoff = Date.now() - 2 * 3600 * 1000;
  for (const [id, s] of sessions) if (s.t < cutoff) sessions.delete(id);
  const d = today();
  for (const k of quota.keys()) if (!k.endsWith(d)) quota.delete(k);
}, 600000).unref();

/** Every route has a ceiling: a stuck upstream never holds a request (or a judge) for minutes. */
const DEADLINE_MS = Number(process.env.ROUTE_DEADLINE_MS) || 60000;
function withDeadline(p, ms = DEADLINE_MS) {
  let t;
  return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(Object.assign(new Error("took too long"), { code: "DEADLINE" })), ms); })]).finally(() => clearTimeout(t));
}
/** Errors: logged in full on the server, short and safe for the visitor. */
const SAFE = /^(Address not found|The address service did not answer|Qloo has no place tag|daily LLM budget)/;
function fail(res, route, e) {
  console.error(`[${route}]`, e?.stack ?? e);
  if (e?.code === "MISS") return res.status(503).json({ error: "This demo is running on recorded data and this address is not recorded yet. Try one of the examples." });
  if (e?.code === "DEADLINE") return res.status(504).json({ error: "An external service is slow right now. Try again in a minute." });
  res.status(500).json({ error: SAFE.test(String(e?.message)) ? String(e.message).slice(0, 200) : "An external service did not answer. Try again in a minute." });
}

app.get("/api/health", (_req, res) => res.json({ ok: true, llm: llmEnabled, qloo: !!process.env.QLOO_API_KEY, tavily: !!process.env.TAVILY_API_KEY }));

app.post("/api/analyze", async (req, res) => {
  const { lang = "en", without_qloo = false } = req.body ?? {};
  const concept = str(req.body?.concept, 120), address = scrubPII(str(req.body?.address, 200) ?? "").trim() || null; // spec 05: no e-mail or phone reaches a prompt
  if (!concept || !address) return res.status(400).json({ error: "Write a business concept (up to 120 characters) and a street address (up to 200)." });
  if (!allow(ipOf(req))) return res.status(429).json({ error: `You have used today's ${LIMITS.analyze} free analyses on this demo. Try again tomorrow.` });
  // a concept from the list, by id, label or synonym ("hamburguesería" → burger); free text still goes to the resolver
  const listed = matchConcept(concept);
  try {
    const result = await withDeadline(analyze({ concept: listed ? listed.id : scrubPII(concept), address, lang: lang === "es" ? "es" : "en", withoutQloo: !!without_qloo, radius: req.body?.radius, coords: req.body?.coords }));
    const id = crypto.randomUUID();
    keep(id, { t: Date.now(), ctx: result, history: [] });
    res.json({ id, ...result });
  } catch (e) {
    fail(res, "analyze", e);
  }
});

// The concepts the dropdown offers (spec 06). Concepts whose tags are not written down are checked once a day
// against Qloo in the background; one Qloo has no tag for is dropped from the list.
const dropped = new Set();
let conceptsChecked = 0;
function checkConcepts() {
  if (process.env.OFFLINE || !process.env.QLOO_API_KEY || Date.now() - conceptsChecked < 24 * 3600 * 1000) return;
  conceptsChecked = Date.now();
  (async () => {
    for (const c of CONCEPT_LIST.filter((x) => !x.tags)) {
      try { await resolveConcept([c.id]); dropped.delete(c.id); } catch (e) { if (/no place tag/.test(String(e.message))) dropped.add(c.id); }
    }
  })().catch(() => {});
}
app.get("/api/concepts", (req, res) => {
  if (!allow(ipOf(req), "concepts")) return res.status(429).json({ error: "Daily limit reached on this demo." });
  checkConcepts();
  res.set("Cache-Control", "public, max-age=3600").json({ concepts: publicConcepts(dropped) });
});

// Address suggestions while typing (Photon; cached a day per query). Empty list when the service is down.
app.get("/api/geocode/suggest", async (req, res) => {
  const q = str(req.query?.q, 120);
  if (!q || q.length < 4) return res.json({ results: [] });
  if (!allow(ipOf(req), "suggest")) return res.status(429).json({ error: "Daily limit for address suggestions reached on this demo.", results: [] });
  try {
    res.json({ results: await withDeadline(suggestPlaces(q, req.query?.lang === "es" ? "es" : "en"), 8000) });
  } catch (e) {
    if (e?.code !== "MISS") console.error("[suggest]", String(e?.message ?? e).slice(0, 200));
    res.json({ results: [] });
  }
});

app.post("/api/noqloo", async (req, res) => {
  const { id, lang = "en" } = req.body ?? {};
  const s = sessions.get(id);
  if (!s?.ctx) return res.status(404).json({ error: "Run the analysis again: it expired." });
  const L = lang === "es" ? "es" : "en";
  s.noqloo ??= {}; s.noqlooP ??= {};
  if (s.noqloo[L]) return res.json(s.noqloo[L]);
  // two clicks at once share one model call (one answer per language)
  if (!s.noqlooP[L]) {
    if (!allow(ipOf(req), "noqloo")) return res.status(429).json({ error: "Daily limit reached on this demo." });
    s.noqlooP[L] = withDeadline(withoutQloo({ concept: s.ctx.concept, address: scrubPII(s.ctx.address), lang: L }))
      .then((v) => (s.noqloo[L] = v)).finally(() => { s.noqlooP[L] = null; });
  }
  try {
    res.json(await s.noqlooP[L]);
  } catch (e) {
    fail(res, "noqloo", e);
  }
});

app.post("/api/compare", async (req, res) => {
  const { id, address } = req.body ?? {};
  const s = sessions.get(id);
  if (!s?.ctx) return res.status(404).json({ error: "Run the analysis again: comparisons use the last one and it expired." });
  const a2 = scrubPII(str(address, 200) ?? "").trim() || null;
  if (!a2) return res.status(400).json({ error: "Write the second address (up to 200 characters)." });
  if (!allow(ipOf(req), "compare")) return res.status(429).json({ error: "Daily comparison limit reached on this demo." });
  try {
    res.json(await withDeadline(compare({ ctx: s.ctx, address: a2 })));
  } catch (e) {
    fail(res, "compare", e);
  }
});

app.post("/api/chat", async (req, res) => {
  const { id, question, lang = "en" } = req.body ?? {};
  const s = sessions.get(id);
  if (!s) return res.status(404).json({ error: "Run the analysis again: the chat uses the last one and it expired." });
  const q = str(question, 500);
  if (!q) return res.status(400).json({ error: "Ask a question of up to 500 characters." });
  if (!allow(ipOf(req), "chat")) return res.json({ text: lang === "es" ? BUDGET_TEXT.es : BUDGET_TEXT.en, calls: [], error: true, limit: true });
  const clean = scrubPII(q);
  try {
    const L = lang === "es" ? "es" : "en";
    const r = await withDeadline(s.fit ? chatFit({ fit: s.fit, history: s.history.slice(-8), question: clean, lang: L }) : chat({ ctx: s.ctx, history: s.history.slice(-8), question: clean, lang: L }));
    s.history.push({ role: "user", content: clean }, { role: "assistant", content: r.text });
    s.history = s.history.slice(-16);
    res.json(r);
  } catch (e) {
    fail(res, "chat", e);
  }
});

app.post("/api/scout", async (req, res) => {
  const { id, lang = "en" } = req.body ?? {};
  const s = sessions.get(id);
  if (!s?.ctx) return res.status(404).json({ error: "Run the analysis again: the scout uses the last one and it expired." });
  if (!allow(ipOf(req), "scout")) return res.status(429).json({ error: "Daily scouting limit reached on this demo." });
  try {
    const r = await withDeadline(scout({ ctx: s.ctx, lang: lang === "es" ? "es" : "en" }));
    s.scout = r; // kept for the PDF report
    res.json(r);
  } catch (e) {
    fail(res, "scout", e);
  }
});

app.post("/api/launch", async (req, res) => {
  const { id, lang = "en", at } = req.body ?? {};
  const s = sessions.get(id);
  if (!s?.ctx) return res.status(404).json({ error: "Run the analysis again: the launch plan uses the last one and it expired." });
  if (!allow(ipOf(req), "launch")) return res.status(429).json({ error: "Daily launch-plan limit reached on this demo." });
  const best = s.ctx.heatmap?.best;
  const spot = at === "best" && best ? { lat: best.lat, lon: best.lon } : undefined;
  try {
    const r = await withDeadline(launchPlan({ ctx: s.ctx, lang: lang === "es" ? "es" : "en", at: spot }));
    s.launch = r; // kept for the PDF report
    res.json(r);
  } catch (e) {
    fail(res, "launch", e);
  }
});

// The analysis of this session as a PDF to keep or forward (spec 08): built from what is already in memory, no new API calls
app.get("/api/report.pdf", async (req, res) => {
  const id = str(req.query?.id, 100);
  const s = id && sessions.get(id);
  if (!s?.ctx) return res.status(404).json({ error: "This report has expired (analyses are kept for 2 hours). Run the analysis again and download it." });
  if (!allow(ipOf(req), "report")) return res.status(429).json({ error: "Daily report limit reached on this demo." });
  try {
    const tiles = await mapTiles(s.ctx).catch(() => []);
    const pdf = await buildReportPdf({ ctx: s.ctx, scout: s.scout, launch: s.launch, lang: req.query?.lang === "es" ? "es" : "en", tiles });
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${reportFileName(s.ctx)}"`, "Cache-Control": "no-store" });
    res.send(pdf);
  } catch (e) {
    fail(res, "report", e);
  }
});

// "what fits here" runs 15 concepts: one run at a time on the whole server (exploreOnce, shared with the chat tool), results cached for a day per address and radius
const exploreCache = new Map();
app.post("/api/explore", async (req, res) => {
  const address = scrubPII(str(req.body?.address, 200) ?? "").trim() || null;
  if (!address) return res.status(400).json({ error: "Write a street address (up to 200 characters)." });
  const radius = [500, 1000, 1500, 2000].includes(Number(req.body?.radius)) ? Number(req.body.radius) : 1000;
  const coords = req.body?.coords && Number.isFinite(+req.body.coords.lat) && Number.isFinite(+req.body.coords.lon) ? { lat: +req.body.coords.lat, lon: +req.body.coords.lon } : null;
  const key = `${coords ? `${coords.lat.toFixed(5)},${coords.lon.toFixed(5)}` : address.toLowerCase()}|${radius}`;
  const hit = exploreCache.get(key);
  // every "what fits" answer gets a chat session of its own (the assistant reads the table)
  // one chat session per cached table (repeating the same request reuses it instead of filling the session store)
  const withChat = (entry) => {
    if (!entry.sid || !sessions.has(entry.sid)) { entry.sid = crypto.randomUUID(); keep(entry.sid, { t: Date.now(), fit: entry.v, history: [] }); }
    return { id: entry.sid, ...entry.v };
  };
  if (hit && Date.now() - hit.t < 24 * 3600 * 1000) return res.json(withChat(hit));
  if (exploreBusy()) return res.status(429).json({ error: "Another \"what fits here\" is running. Try again in a few seconds." });
  if (!allow(ipOf(req), "explore")) return res.status(429).json({ error: "Daily limit for \"what fits here\" reached on this demo." });
  try {
    const v = await withDeadline(exploreOnce({ address, radius, coords }), 90000);
    const entry = { t: Date.now(), v };
    exploreCache.set(key, entry);
    while (exploreCache.size > 100) exploreCache.delete(exploreCache.keys().next().value);
    res.json(withChat(entry));
  } catch (e) {
    fail(res, "explore", e);
  }
});

// malformed JSON or anything unexpected: a short JSON error, never a stack trace
app.use((err, _req, res, _next) => {
  if (err.type !== "entity.parse.failed") console.error("[express]", err?.stack ?? err);
  res.status(err.status === 400 || err.type === "entity.parse.failed" ? 400 : err.status === 413 ? 413 : 500).json({ error: err.type === "entity.parse.failed" ? "Malformed JSON." : err.status === 413 ? "Request too large." : "Something went wrong." });
});
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Open Here on :${port} — LLM ${llmEnabled ? `on (${MODELS.nano} / ${MODELS.fast} / ${MODELS.writer})` : "OFF (template mode)"}${process.env.OFFLINE === "1" ? " — OFFLINE replay" : ""}`));
