// Downloadable location report (spec 08): the analysis of one address as a PDF the owner can keep or forward.
// Everything comes from the session: the analysis, and the agent's answer and the launch plan if they were run.
// The map: OpenStreetMap streets underneath (fetched when the PDF is built, cached; a plain box if they do not answer),
// and on top the heat-map cells already in the analysis.
import PDFDocument from "pdfkit";
import { plainVerdictDeep, plainVerdictWords, betterSpotWhy } from "./verdict.js";
import { shortAddress } from "./tools.js";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fontDir = (pkg) => { try { return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files"); } catch { return null; } };
const MONT = fontDir("@fontsource/montserrat");
const MICH = fontDir("@fontsource/michroma");

const C = { ink: "#000000", grey: "#5f6368", line: "#dfe1e5", orange: "#EF751F", rival: "#C0392B", green: "#3E9B5F" };
const LEVEL_COLOUR = { RED: "#D4421B", AMBER: "#E8A317", "AMBER-GREEN": "#3E9B5F", UNKNOWN: "#8A8F98" };
const VERD = { en: { RED: "Not here", AMBER: "Hard", "AMBER-GREEN": "Promising", UNKNOWN: "No data" }, es: { RED: "Aquí no", AMBER: "Difícil", "AMBER-GREEN": "Prometedor", UNKNOWN: "Sin datos" } };
const CLS = ["#7a1e08", "#D4421B", "#EF751F", "#f7c9a1", "#fdf1e6"], CLSOP = [0.75, 0.68, 0.58, 0.45, 0.35];

const TXT = {
  en: {
    lang: "en", range: "Qloo taste rank here", title: "Location report", concept: "Idea", address: "Address", area: "Area analysed", verdict: "Verdict",
    facts: ["How much the area likes it", "Direct rivals within 700 m", "Better spot nearby"], within400: (n) => `${n} within 400 m`, noBetter: "no better block nearby",
    map: "Map: taste rank block by block", legend: ["top 20 % of this area", "next 20 %", "middle", "lower 20 %", "bottom 20 %"], you: "your address", rivals: "direct rival", best: "better spot",
    comp: "Direct competitors nearby", cols: ["Name", "Distance", "Rating", "Price"], none: "None found by Qloo within the area.",
    why: "Why this verdict", actions: "What to do next", audience: "Who goes out around here", unknowns: "What the data cannot see (check it before signing)",
    agent: "The agent's recommendation", agentBy: (m, n) => `Steps chosen by ${m} on Nebius Token Factory (${n} tool calls).`,
    launch: "Opening plan", music: "Music for the opening", co: "Neighbours to team up with", brands: "Brands to ask for sampling", posters: "Posters and flyers", weeks: "Four weeks",
    how: "How we know", calls: (q, t) => `${q} calls to Qloo's API (taste rank by block, places nearby, rivals)${t ? ` and ${t} other lookups` : ""}, listed with their URLs in the app under "How I know".`,
    model: (m) => `Text written by ${m} from the structured signals; the verdict, the facts, the map and the competitors on this page come from code and Qloo, not from the model.`, tpl: "Report written by fixed rules (no language model).",
    foot: "Built on aggregated taste data about places (Qloo) and NVIDIA Nemotron on Nebius Token Factory. It decides about places, never about people, and must not be used for housing, employment or credit decisions. It does not predict success: it shows what the data supports and what it cannot see.",
    page: (n) => `Open Here · abro-aqui.onrender.com · page ${n}`,
    taste: (x) => (x == null ? "no data" : x >= 0.9 ? "Very high" : x >= 0.85 ? "High" : x >= 0.75 ? "Medium" : "Low"),
  },
  es: {
    lang: "es", range: "Gusto de Qloo aquí", title: "Informe de ubicación", concept: "Idea", address: "Dirección", area: "Zona analizada", verdict: "Veredicto",
    facts: ["Cuánto le gusta a la zona", "Rivales directos a 700 m", "Sitio mejor cerca"], within400: (n) => `${n} a 400 m`, noBetter: "ninguna manzana mejor cerca",
    map: "Mapa: gusto manzana a manzana", legend: ["el 20 % más alto", "siguiente 20 %", "zona media", "20 % bajo", "el 20 % más bajo"], you: "tu dirección", rivals: "rival directo", best: "sitio mejor",
    comp: "Competidores directos cerca", cols: ["Nombre", "Distancia", "Valoración", "Precio"], none: "Qloo no encontró ninguno en la zona.",
    why: "Por qué este veredicto", actions: "Qué hacer ahora", audience: "Quién sale por aquí", unknowns: "Lo que los datos no ven (compruébalo antes de firmar)",
    agent: "La recomendación del agente", agentBy: (m, n) => `Pasos elegidos por ${m} en Nebius Token Factory (${n} llamadas a herramientas).`,
    launch: "Plan de apertura", music: "Música para la inauguración", co: "Vecinos con los que aliarse", brands: "Marcas a las que pedir degustación", posters: "Carteles y flyers", weeks: "Cuatro semanas",
    how: "Cómo lo sabemos", calls: (q, t) => `${q} llamadas a la API de Qloo (gusto por manzana, locales cerca, rivales)${t ? ` y ${t} consultas más` : ""}, con sus URL en la app, en «Cómo lo sé».`,
    model: (m) => `Texto redactado por ${m} a partir de las señales estructuradas; el veredicto, los datos clave, el mapa y los competidores de esta página salen del código y de Qloo, no del modelo.`, tpl: "Informe redactado con reglas fijas (sin modelo de lenguaje).",
    foot: "Hecho con datos agregados de gusto sobre lugares (Qloo) y NVIDIA Nemotron en Nebius Token Factory. Decide sobre lugares, nunca sobre personas, y no debe usarse para vivienda, empleo o crédito. No predice el éxito: muestra qué apoyan los datos y qué no ven.",
    page: (n) => `Open Here · abro-aqui.onrender.com · página ${n}`,
    taste: (x) => (x == null ? "sin datos" : x >= 0.9 ? "Muy alto" : x >= 0.85 ? "Alto" : x >= 0.75 ? "Medio" : "Bajo"),
  },
};

// The embedded fonts cover Latin-1 plus common punctuation; anything else falls back to its plain letters.
const OK = /[\u0000-ÿıŒœˆ˜ -⁯€™−]/;
const SWAP = { "★": "*", "→": "->", "≥": ">=", "≤": "<=" };
export function safeText(s) {
  // thin and no-break spaces (the app writes "590\u202Fm") are missing from the fonts: plain space
  return [...String(s ?? "").replace(/[\u00a0\u2000-\u200b\u202f\u205f]/g, " ").replace(/[\u2010-\u2012]/g, "-")].map((ch) => (OK.test(ch) ? ch : SWAP[ch] ?? (ch.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\u0000-ÿ]/g, "") || ""))).join("");
}
/** Why the better spot is better, said exactly (stored by the analysis; recomputed for older sessions). */
function bestWhy(best, ctx, L) {
  if (best.why) return { text: L === "es" ? best.why.es : best.why.en, short: L === "es" ? best.why.short_es : best.why.short_en };
  const r = betterSpotWhy(best, { level: ctx.verdict?.level, demand: ctx.heatmap?.demand, c700: ctx.verdict?.offer?.c700 }, L);
  return { text: r.text, short: r.short };
}
const num = (x, lang, d = 2) => (x == null ? "–" : lang === "es" ? x.toFixed(d).replace(".", ",") : x.toFixed(d));
const radiusLabel = (r, lang) => (r >= 1000 ? `${String(r / 1000).replace(".", lang === "es" ? "," : ".")} km` : `${r} m`);

/** ASCII file name: open-here-<concept>-<street>.pdf */
export function reportFileName(ctx) {
  const slug = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const parts = shortAddress(String(ctx?.geo?.display_name ?? ctx?.address ?? "")).split(",").map((p) => p.trim()).filter(Boolean);
  const street = parts.slice(0, 1).join(" ");
  const name = ["open-here", slug(ctx?.concept).slice(0, 30), slug(street).slice(0, 40)].filter(Boolean).join("-");
  return `${name || "open-here-report"}.pdf`;
}

/** Builds the PDF and resolves with a Buffer. */
export function buildReportPdf({ ctx, scout = null, launch = null, lang = "en", date = new Date(), tiles = [] }) {
  const t = TXT[lang === "es" ? "es" : "en"];
  const L = lang === "es" ? "es" : "en";
  // model-written text never shows internal codes ("Amber", "RED"); older sessions may still carry them
  ctx = { ...ctx, report: plainVerdictDeep(ctx.report, L) };
  if (scout?.text) scout = { ...scout, text: plainVerdictWords(scout.text, L) };
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 56, left: 48, right: 48 }, info: { Title: `Open Here — ${t.title}`, Author: "Open Here", Subject: safeText(`${ctx.concept} - ${ctx.geo?.display_name ?? ctx.address}`) }, bufferPages: true });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((ok, no) => { doc.on("end", () => ok(Buffer.concat(chunks))); doc.on("error", no); });

  const F = { r: "Helvetica", s: "Helvetica-Bold", b: "Helvetica-Bold", sign: "Helvetica" };
  if (MONT) {
    doc.registerFont("r", path.join(MONT, "montserrat-latin-400-normal.woff"));
    doc.registerFont("s", path.join(MONT, "montserrat-latin-600-normal.woff"));
    doc.registerFont("b", path.join(MONT, "montserrat-latin-700-normal.woff"));
    Object.assign(F, { r: "r", s: "s", b: "b", sign: "s" });
  }
  if (MICH) { doc.registerFont("sign", path.join(MICH, "michroma-latin-400-normal.woff")); F.sign = "sign"; }

  const W = doc.page.width - 96, X0 = 48;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const need = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const h2 = (s) => { need(48); doc.moveDown(0.6).font(F.b).fontSize(12.5).fillColor(C.ink).text(safeText(s), X0, doc.y, { width: W }); doc.moveDown(0.25); };
  const para = (s, opts = {}) => { need(20); doc.font(opts.font ?? F.r).fontSize(opts.size ?? 9.8).fillColor(opts.color ?? C.ink).text(safeText(s), opts.x ?? X0, doc.y, { width: opts.w ?? W, lineGap: 1.5 }); };
  const bullets = (items) => { for (const it of items ?? []) { if (!it) continue; need(22); const y = doc.y; doc.font(F.r).fontSize(9.8).fillColor(C.orange).text("•", X0, y); doc.fillColor(C.ink).text(safeText(typeof it === "string" ? it : [it.name, it.why ?? it.idea].filter(Boolean).join(": ")), X0 + 12, y, { width: W - 12, lineGap: 1.5 }); doc.moveDown(0.2); } };

  // --- header
  doc.font(F.sign).fontSize(20).fillColor(C.ink).text("OPEN ", X0, 44, { continued: true }).fillColor(C.orange).text("HERE");
  doc.font(F.r).fontSize(9).fillColor(C.grey).text(`${t.title} · ${date.toISOString().slice(0, 10)}`, X0, 52, { width: W, align: "right" });
  doc.moveTo(X0, 76).lineTo(X0 + W, 76).lineWidth(0.8).strokeColor(C.line).stroke();
  doc.y = 88;

  // --- what was asked
  const kv = (k, v) => { const y = doc.y; doc.font(F.s).fontSize(9).fillColor(C.grey).text(k, X0, y, { width: 92 }); doc.font(F.r).fontSize(10).fillColor(C.ink).text(safeText(v), X0 + 96, y, { width: W - 96 }); doc.moveDown(0.25); };
  kv(t.concept, ctx.concept);
  const full = ctx.geo?.display_name ?? ctx.address;
  kv(t.address, ctx.place ?? shortAddress(full));
  if ((ctx.place ?? shortAddress(full)) !== full) { doc.font(F.r).fontSize(8).fillColor(C.grey).text(safeText(full), X0 + 96, doc.y - 2, { width: W - 96 }); doc.moveDown(0.25); }
  kv(t.area, `${radiusLabel(ctx.radius ?? 1000, L)} · ${num(ctx.geo?.lat, L, 5)}, ${num(ctx.geo?.lon, L, 5)}`);

  // --- verdict
  const v = ctx.verdict ?? {};
  doc.moveDown(0.6);
  doc.font(F.b).fontSize(30).fillColor(LEVEL_COLOUR[v.level] ?? C.grey).text(VERD[L][v.level] ?? v.level ?? "–", X0, doc.y);
  if (ctx.report?.headline) para(ctx.report.headline, { font: F.s, size: 12.5 });
  doc.moveDown(0.3);
  para(L === "es" ? v.rule_es ?? v.rule_fired : v.rule_fired, { size: 9, color: C.grey });

  // --- three facts
  doc.moveDown(0.7);
  const of = v.offer ?? { c400: 0, c700: 0 }, best = ctx.heatmap?.best;
  const facts = [
    [t.taste(ctx.heatmap?.demand), `${t.facts[0]} (${num(ctx.heatmap?.demand, L)})`],
    [String(of.c700 ?? "–"), `${t.facts[1]} · ${t.within400(of.c400 ?? 0)}`],
    [best ? `${best.distance_m} m` : "—", best ? bestWhy(best, ctx, L).short : t.noBetter],
  ];
  const fw = (W - 16) / 3, fy = doc.y;
  facts.forEach(([big, small], i) => {
    const x = X0 + i * (fw + 8);
    doc.roundedRect(x, fy, fw, 58, 6).fillColor("#f6f7f8").fill();
    doc.font(F.b).fontSize(16).fillColor(C.ink).text(safeText(big), x + 10, fy + 8, { width: fw - 20 });
    doc.font(F.r).fontSize(7.8).fillColor(C.grey).text(safeText(small), x + 10, fy + 30, { width: fw - 20, height: 26, ellipsis: true });
  });
  doc.y = fy + 70;
  if (best) { para(`${L === "es" ? `Mejor punto a ${best.distance_m} m` : `Better spot ${best.distance_m} m away`}: ${bestWhy(best, ctx, L).text}.`, { size: 9, color: C.grey }); doc.moveDown(0.3); }

  // --- map
  drawMap(doc, ctx, t, F, X0, W, tiles);

  // --- competitors
  h2(t.comp);
  const comp = (ctx.competitors ?? []).slice(0, 8);
  if (!comp.length) para(t.none, { color: C.grey });
  else {
    const cw = [W - 210, 70, 70, 70];
    const row = (cells, bold) => {
      need(18); const y = doc.y; let x = X0;
      cells.forEach((c, i) => { doc.font(bold ? F.s : F.r).fontSize(9).fillColor(bold ? C.grey : C.ink).text(safeText(c), x, y, { width: cw[i] - 6, lineBreak: false, ellipsis: true }); x += cw[i]; });
      doc.y = y + 15; doc.moveTo(X0, doc.y - 3).lineTo(X0 + W, doc.y - 3).lineWidth(0.4).strokeColor(C.line).stroke();
    };
    row(t.cols, true);
    for (const c of comp) row([c.name, `${c.distance_m} m`, c.rating != null ? `${num(c.rating, L, 1)} / 5` : "–", c.price_level ? "€".repeat(Math.min(4, c.price_level)) : "–"]);
  }

  // --- the report the writer model (or the template) produced
  const r = ctx.report ?? {};
  if (r.why?.length) { h2(t.why); bullets(r.why); }
  if (r.actions?.length) { h2(t.actions); bullets(r.actions); }
  if (r.audience?.length) { h2(t.audience); bullets(r.audience.slice(0, 5)); }
  const unk = r.unknowns?.length ? r.unknowns : v.unknowns;
  if (unk?.length) { h2(t.unknowns); bullets(unk); }

  // --- agent and launch plan, when they were run in this session
  if (scout?.text) {
    h2(t.agent);
    para(scout.text);
    doc.moveDown(0.2);
    para(t.agentBy(scout.model ?? "Nemotron", scout.steps?.length ?? 0), { size: 8.5, color: C.grey });
  }
  const p = launch?.plan;
  if (p) {
    h2(t.launch);
    if (p.headline) para(p.headline, { size: 9.5, color: C.grey });
    const sub = (title, items) => { if (!items?.length) return; need(40); doc.moveDown(0.3).font(F.s).fontSize(10.5).fillColor(C.ink).text(title, X0, doc.y); doc.moveDown(0.15); bullets(items); };
    sub(t.music, p.music); sub(t.co, p.co_promo); sub(t.brands, p.brands);
    sub(t.posters, (p.posters ?? []).map((z) => z.why ?? z.where)); sub(t.weeks, p.weeks);
  }

  // --- provenance and limits
  h2(t.how);
  const tr = ctx.trace ?? [];
  const q = tr.filter((e) => /qloo/i.test(`${e.source ?? ""} ${e.url ?? ""}`)).length;
  bullets([t.calls(q, tr.length - q), ctx.report_meta?.model && ctx.report_meta.model !== "template" ? t.model(ctx.report_meta.model) : t.tpl]);
  doc.moveDown(0.5);
  para(t.foot, { size: 8.3, color: C.grey });

  // --- page footers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing below the margin must not open a new page
    doc.font(F.r).fontSize(7.5).fillColor(C.grey).text(t.page(i + 1), X0, doc.page.height - 34, { width: W, align: "center", lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return done;
}

// ---------- OpenStreetMap tiles under the PDF map (same box: MAP_W x MAP_H points) ----------
const MAP_W = 300, MAP_H = 250, tileCache = new Map();
const OSM_UA = { "User-Agent": "abro-aqui/0.1 (+https://github.com/mktaisales-glitch/abro-aqui)" };
async function tile(z, x, y) {
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  if (tileCache.has(url)) return tileCache.get(url);
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(url, { headers: OSM_UA, signal: ac.signal });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    tileCache.set(url, buf); while (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
    return buf;
  } catch { return null; } finally { clearTimeout(timer); }
}
/** The tiles that cover the PDF map box, placed in points relative to its top-left corner. Empty if they cannot be fetched. */
export async function mapTiles(ctx) {
  if (!ctx?.geo || process.env.OFFLINE) return [];
  const { lat, lon } = ctx.geo, R = (ctx.radius ?? 1000) * 1.08, s = Math.min(MAP_W, MAP_H) / (2 * R); // points per metre
  const mppAt = (z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  let z = 12; while (z < 17 && mppAt(z + 1) * s > 0.38) z++;               // about 2.5 tile pixels per point
  const k = mppAt(z) * s, n = 256 * 2 ** z;                                  // points per world pixel
  const wx = ((lon + 180) / 360) * n, sl = Math.sin((lat * Math.PI) / 180), wy = (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * n;
  const x0 = Math.floor((wx - MAP_W / 2 / k) / 256), x1 = Math.floor((wx + MAP_W / 2 / k) / 256);
  const y0 = Math.floor((wy - MAP_H / 2 / k) / 256), y1 = Math.floor((wy + MAP_H / 2 / k) / 256);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16) return [];
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
    jobs.push(tile(z, x, y).then((buf) => buf && { buf, x: MAP_W / 2 + (x * 256 - wx) * k, y: MAP_H / 2 + (y * 256 - wy) * k, size: 256 * k }));
  const out = (await Promise.all(jobs)).filter(Boolean);
  return out.length === jobs.length ? out : []; // a map with holes reads worse than the plain box
}

/** Vector map from the heat-map cells: five classes by rank inside the circle, the address, rivals and the better spot. */
function drawMap(doc, ctx, t, F, X0, W, tiles = []) {
  const cells = (ctx.heatmap?.cells ?? []).filter((c) => c.affinity_rank != null);
  if (!ctx.geo || !cells.length) return;
  const H = MAP_H, MW = MAP_W;
  if (doc.y + H + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc.font(F.b).fontSize(12.5).fillColor(C.ink).text(t.map, X0, doc.y);
  doc.moveDown(0.3);
  const top = doc.y, left = X0;
  const { lat: lat0, lon: lon0 } = ctx.geo;
  const R = (ctx.radius ?? 1000) * 1.08; // metres from the centre to the box edge
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const s = Math.min(MW, H) / (2 * R);
  const px = (lat, lon) => [left + MW / 2 + (lon - lon0) * kx * s, top + H / 2 - (lat - lat0) * ky * s];
  const inBox = ([x, y]) => x >= left && x <= left + MW && y >= top && y <= top + H;

  doc.save();
  doc.rect(left, top, MW, H).fillColor("#f3f4f6").fill();
  doc.rect(left, top, MW, H).clip();
  // streets underneath, faded so the taste cells read first
  for (const tl of tiles) { try { doc.image(tl.buf, left + tl.x, top + tl.y, { width: tl.size, height: tl.size }); } catch {} }
  if (tiles.length) doc.rect(left, top, MW, H).fillColor("#ffffff").fillOpacity(0.35).fill().fillOpacity(1);
  const sorted = cells.map((c) => c.affinity_rank).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const cuts = [q(0.8), q(0.6), q(0.4), q(0.2)];
  const cls = (x) => (x >= cuts[0] ? 0 : x >= cuts[1] ? 1 : x >= cuts[2] ? 2 : x >= cuts[3] ? 3 : 4);
  const h = 0.0007;
  for (const c of cells) {
    const [x1, y1] = px(c.lat + h, c.lon - h), [x2, y2] = px(c.lat - h, c.lon + h);
    doc.rect(x1, y1, x2 - x1, y2 - y1).fillColor(CLS[cls(c.affinity_rank)]).fillOpacity(CLSOP[cls(c.affinity_rank)]).fill();
  }
  doc.fillOpacity(1);
  // the analysed circle
  const [cx, cy] = px(lat0, lon0);
  doc.circle(cx, cy, (ctx.radius ?? 1000) * s).dash(3, { space: 3 }).lineWidth(0.8).strokeColor("#555555").stroke().undash();
  for (const c of ctx.competitors ?? []) {
    if (c.lat == null) continue;
    const p = px(c.lat, c.lon);
    if (inBox(p)) doc.circle(p[0], p[1], 3.2).lineWidth(1.4).fillAndStroke("#ffffff", C.rival);
  }
  const b = ctx.heatmap?.best;
  if (b?.lat != null) {
    const p = px(b.lat, b.lon);
    if (inBox(p)) {
      doc.circle(p[0], p[1], 9).lineWidth(2.2).strokeColor(C.green).stroke();
      doc.font(F.s).fontSize(7.5);
      const lbl = `${b.distance_m} m`, lw = doc.widthOfString(lbl) + 6;
      doc.roundedRect(p[0] + 11, p[1] - 6, lw, 11, 2).fillColor("#ffffff").fill();
      doc.fillColor(C.green).text(lbl, p[0] + 14, p[1] - 4, { lineBreak: false });
    }
  }
  doc.rect(cx - 4, cy - 4, 8, 8).lineWidth(1.5).fillAndStroke("#000000", "#ffffff");
  doc.restore();
  doc.rect(left, top, MW, H).lineWidth(0.6).strokeColor(C.line).stroke();

  // legend to the right of the map
  let ly = top + 4;
  const lx = left + MW + 18;
  t.legend.forEach((label, k) => {
    doc.rect(lx, ly, 12, 10).fillColor(CLS[k]).fillOpacity(Math.min(1, CLSOP[k] + 0.2)).fill().fillOpacity(1);
    doc.font(F.r).fontSize(8.5).fillColor(C.ink).text(label, lx + 18, ly + 1, { lineBreak: false });
    ly += 16;
  });
  ly += 6;
  doc.rect(lx + 2, ly, 8, 8).fillColor("#000000").fill();
  doc.font(F.r).fontSize(8.5).fillColor(C.ink).text(t.you, lx + 18, ly, { lineBreak: false });
  ly += 16;
  doc.circle(lx + 6, ly + 4, 3.2).lineWidth(1.4).fillAndStroke("#ffffff", C.rival);
  doc.fillColor(C.ink).text(t.rivals, lx + 18, ly, { lineBreak: false });
  ly += 16;
  doc.circle(lx + 6, ly + 4, 5).lineWidth(1.8).strokeColor(C.green).stroke();
  doc.fillColor(C.ink).text(t.best, lx + 18, ly, { lineBreak: false });
  ly += 22;
  doc.font(F.r).fontSize(7.8).fillColor(C.grey).text(`${t.range}: ${num(sorted[0], t.lang)}–${num(sorted.at(-1), t.lang)}`, lx, ly, { width: W - MW - 18 });
  doc.y = top + H + 8;
  doc.x = X0;
}
