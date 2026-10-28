// Pipeline for one analysis + the "what if…?" chat — see specs/03-agent.md.
import { makeTrace } from "./http.js";
import * as T from "./tools.js";
import { verdict } from "./verdict.js";
import { llmEnabled, normalizeConcept, writeReport, writeReportWithoutQloo, templateReport, chatWithTools } from "./llm.js";

function dedupeByName(list) {
  const seen = new Map();
  for (const p of list) if (!seen.has(p.name)) seen.set(p.name, p);
  return [...seen.values()].sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9));
}

/** Everything Qloo says about one concept at one point. Reused by the chat and the comparison. */
/** Heat map with fallback: if Qloo has no cells for the best tag, try the next candidate. Fixes the chosen tag on `part`. */
async function heatWithFallback(geo, resolved, trace) {
  for (const p of resolved) {
    for (const tag of p.heat_candidates?.length ? p.heat_candidates : [p.heatmap_tag].filter(Boolean)) {
      const h = await T.heatmap({ lat: geo.lat, lon: geo.lon, tag }, trace);
      if (h.coverage > 0) {
        p.heatmap_tag = tag;
        return { heat: h, main: p };
      }
    }
  }
  const main = resolved.find((p) => p.heatmap_tag) ?? resolved[0];
  return { heat: { cells: [], nearest: null, coverage: 0, demand: null, local: null, cells_used: 0 }, main };
}

/** Competitors with fallback: an empty list only counts if the tag is used for places within 5 km; otherwise try the next candidate. */
async function competitorsWithFallback(geo, p, trace, radius = 700) {
  const cands = p.comp_candidates?.length ? p.comp_candidates : [p.competitor_tag].filter(Boolean);
  for (const tag of cands) {
    const list = await T.nearbyCompetitors({ lat: geo.lat, lon: geo.lon, radius, tag }, trace);
    if (list.length || (await T.tagInUse({ lat: geo.lat, lon: geo.lon, tag }, trace).catch(() => false))) {
      p.competitor_tag = tag;
      return list;
    }
  }
  // no candidate tag is used for places around here: we cannot measure this part's offer
  p.competitor_tag = null;
  p.offer_unmeasured = true;
  return [];
}

/** The concept's share among the area's popular places = the highest share of any of its parts. */
const shareOf = (share) => (share.length && share[0].of ? Math.max(...share.map((x) => x.places)) / share[0].of : null);

/**
 * Best block within 800 m that the same rules rate higher than the address (offer counted from rivals only).
 * Returns the blocks that beat the address, best first.
 */
function bestSpot(geo, heat, rivals, here) {
  const cand = [];
  for (const c of heat.cells) {
    const d = T.haversine(geo.lat, geo.lon, c.lat, c.lon);
    if (d < 150 || d > 800 || c.popularity < 0.5) continue; // busy blocks only (popularity = activity, ranked in the circle) // rivals are fetched within 1.5 km, so judge blocks whose 700 m ring fits inside
    const dm = T.demandAround(heat.cells, c.lat, c.lon, 150);
    const comps = rivals.map((r) => ({ ...r, distance_m: T.haversine(c.lat, c.lon, r.lat, r.lon) }));
    const v = verdict({ demand: dm.demand, competitors: comps, coverage: heat.coverage });
    cand.push({ lat: c.lat, lon: c.lon, distance_m: d, level: v.level, score: v.score ?? -1, demand: dm.demand, c400: v.offer.c400, c700: v.offer.c700, offer: v.offer.level, rule: v.rule_fired,
      nearest_rivals: comps.filter((x) => x.distance_m <= 400).sort((x, y) => x.distance_m - y.distance_m).slice(0, 3).map(({ name, rating, distance_m }) => ({ name, rating, distance_m })) });
  }
  cand.sort((x, y) => y.score - x.score || y.demand - x.demand || x.c700 - y.c700 || x.distance_m - y.distance_m);
  if (here.score == null) return [];
  return cand.filter((b) => b.score > here.score || (b.score === here.score && b.demand >= (here.inputs.demand ?? 0) + 0.03 && b.c700 <= here.offer.c700 - 2 && OFFER_RANK[b.offer] < OFFER_RANK[here.offer.level]));
}

const OFFER_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const MIN_PLACES = 15; // a block counts as a shopping street with ≥ 15 places within 200 m (parks and hillsides fail)

export async function signalsAt({ geo, resolved }, trace, { withBest = true } = {}) {
  const [{ heat, main }, compLists, profile] = await Promise.all([
    heatWithFallback(geo, resolved, trace),
    Promise.all(resolved.map((p) => competitorsWithFallback(geo, p, trace))),
    T.zoneProfile({ lat: geo.lat, lon: geo.lon }, trace),
  ]);
  const competitors = dedupeByName(compLists.flat());
  const supply_by_part = resolved.map((p, i) => ({ part: p.part, tag: p.competitor_tag, within_700m: p.offer_unmeasured ? null : compLists[i].length, measured: !p.offer_unmeasured }));
  const share = T.conceptShare(profile, resolved);
  const v = verdict({ demand: heat.demand, local: heat.local, competitors, share: shareOf(share), coverage: heat.coverage });

  // gap: a part with a verified tag and no rival within 700 m, while the concept has real demand here
  const gap = supply_by_part.filter((s, i) => s.within_700m === 0 && s.tag && share[i].places === 0).map((s) => s.part);
  if (gap.length && v.level !== "UNKNOWN" && (heat.demand ?? 0) >= 0.75) {
    v.gap = true;
    v.adjustments.push(`nobody within 700 m offers: ${gap.join(", ")}`);
    v.adjustments_es.push(`nadie a menos de 700 m ofrece: ${gap.join(", ")}`);
  }
  // which parts the taste numbers actually measured (the heat map only answers to some tags)
  const measured = resolved.filter((p) => p.heatmap_tag && p === main).map((p) => p.part);
  const unmeasured = resolved.filter((p) => p !== main && resolved.length > 1).map((p) => p.part);

  let best = null;
  let candidates = [];
  let wide = [];
  if (withBest && v.level !== "UNKNOWN") {
    const tags = [...new Set(resolved.map((p) => p.competitor_tag).filter(Boolean))];
    wide = dedupeByName((await Promise.all(tags.map((tag) => T.rivalsAround({ lat: geo.lat, lon: geo.lon, tag }, trace).catch(() => [])))).flat());
    const better = bestSpot(geo, heat, dedupeByName([...wide, ...competitors]).filter((r) => r.lat != null), v);
    let unknown = null;
    const top4 = better.slice(0, 4);
    const counts = await Promise.all(top4.map((b) => T.placesNear({ lat: b.lat, lon: b.lon }, trace).catch(() => null)));
    for (const [i, b] of top4.entries()) {
      // a failed count is unknown, not zero: use an unchecked block only if none is confirmed
      const n = counts[i];
      b.places_200m = n;
      if (n == null) { unknown ??= b; continue; }
      if (n >= MIN_PLACES && !best) best = b; // keep counting the others: the scout compares them
    }
    if (!best && unknown) best = { ...unknown, density_unchecked: true };
    candidates = better.filter((b) => b.places_200m >= MIN_PLACES || (best && b.lat === best.lat && b.lon === best.lon)).slice(0, 5);
  }
  heat.best = best;
  return { heat, competitors, supply_by_part, share, profile, verdict: v, gap, main, measured, unmeasured, candidates, wide };
}

export async function analyze({ concept, address, lang = "en", withoutQloo = false }) {
  const trace = makeTrace();
  const llm = [];
  const t0 = Date.now();

  const geo = await T.geocode(address, trace);

  let parts = T.conceptParts(concept);
  if (llmEnabled) {
    try {
      const n = await normalizeConcept(concept);
      // the model may not add parts the concept does not name: never more parts than the concept's own separators allow
      const allowed = Math.max(T.conceptParts(concept).length, /\b(con|with|amb)\b/i.test(concept) ? 2 : 1);
      // too many parts: a single word split in pieces ("seafood","restaurant") is joined back; otherwise keep the first ones
      parts = n.parts.length <= allowed ? n.parts
        : allowed === 1 && n.parts.length <= 3 && n.parts.every((p) => !p.includes(" ")) ? [n.parts.join(" ")]
        : n.parts.slice(0, allowed);
      llm.push({ task: "concept → English parts", model: n.model, ms: n.ms });
    } catch (e) {
      llm.push({ task: "concept → English parts", model: "failed → word split", ms: 0, error: String(e.message).slice(0, 120) });
    }
  }
  const resolved = await T.resolveConcept(parts, trace);
  const s = await signalsAt({ geo, resolved }, trace);

  const { tag_ids, tag_names, ...profile } = s.profile;
  const signals = {
    concept,
    concept_parts: resolved.map(({ part, heatmap_tag, competitor_tag }) => ({ part, heatmap_tag, competitor_tag })),
    address: geo.display_name,
    verdict: s.verdict,
    demand: { rank: s.heat.demand, vs_surroundings: s.heat.local, blocks_used: s.heat.cells_used, measured_for: s.measured, not_measured_for: s.unmeasured },
    offer: s.verdict.offer,
    best_alternative: s.heat.best,
    competitors_within_700m: s.competitors.slice(0, 10).map(({ name, rating, price_level, distance_m }) => ({ name, rating, price_level, distance_m })),
    supply_by_part: s.supply_by_part,
    already_served_by: s.share,
    gap: s.gap,
    price_gap: T.priceGap(s.competitors) && { ...T.priceGap(s.competitors), currency: T.currencyOf(geo.display_name) },
    area_profile: profile,
  };

  // The report and the "without Qloo" answer run in parallel (two Super calls).
  const noQlooP = withoutQloo && llmEnabled
    ? writeReportWithoutQloo({ concept, address }, lang).then((r) => { llm.push({ task: "report without Qloo", model: r.model, ms: r.ms }); return { ...r.data, model: r.model }; }).catch((e) => { llm.push({ task: "report without Qloo", model: "failed", ms: 0, error: String(e.message).slice(0, 120) }); return null; })
    : Promise.resolve(null);

  let report;
  let reportMeta = { model: "template" };
  if (llmEnabled) {
    try {
      const r = await writeReport(signals, lang);
      report = r.data;
      // the verdict word is shown apart; a headline that names a colour or a verdict code is replaced by the plain one
      if (/\b(amber|red|green|ámbar|rojo|verde|AMBER-GREEN|UNKNOWN)\b/i.test(report.headline)) report.headline = templateReport(signals, lang).headline;
      reportMeta = { model: r.model, ms: r.ms };
      llm.push({ task: "write report", model: r.model, ms: r.ms });
    } catch (e) {
      report = templateReport(signals, lang);
      reportMeta = { model: "template", error: String(e.message).slice(0, 200) };
      llm.push({ task: "write report", model: "failed → template", ms: 0, error: String(e.message).slice(0, 120) });
    }
  } else report = templateReport(signals, lang);

  // Partners proposed by the writer are checked on the live web (Tavily) before they are shown.
  if (report.partners?.length) {
    const city = geo.display_name.split(",").map((x) => x.trim()).find((x) => /barcelona|new york|brooklyn|london|san francisco|madrid|paris/i.test(x)) ?? geo.display_name.split(",").slice(-4, -3)[0]?.trim() ?? "";
    const checks = await Promise.all(report.partners.map((p) => T.verifyBusiness({ name: p.name, city }, trace).catch((e) => ({ exists: null, error: String(e.message).slice(0, 80) }))));
    report.partners = report.partners.map((p, i) => ({ ...p, verified: checks[i].exists, source: checks[i].url ?? null })).filter((p) => p.verified !== false);
  }

  const noQloo = await noQlooP;

  return {
    concept,
    lang,
    address: geo.display_name,
    geo,
    resolved,
    verdict: s.verdict,
    report,
    report_meta: reportMeta,
    without_qloo: noQloo,
    heatmap: { cells: s.heat.cells, nearest: s.heat.nearest, best: s.heat.best, coverage: s.heat.coverage, demand: s.heat.demand, local: s.heat.local, cells_used: s.heat.cells_used },
    measured: s.measured,
    unmeasured: s.unmeasured,
    candidates: s.candidates,
    competitors: s.competitors,
    rivals_wide: (s.wide ?? []).map(({ name, id, rating, lat, lon }) => ({ name, id, rating, lat, lon })),
    supply_by_part: s.supply_by_part,
    share: s.share,
    gap: s.gap,
    price_gap: signals.price_gap,
    profile,
    trace: trace.entries,
    llm,
    total_ms: Date.now() - t0,
  };
}

/** Tools the chat model can call. Context = the last analysis (so "what if I remove X?" works). */
export function chatTools(ctx, trace) {
  const { geo, resolved } = ctx;
  return {
    nearby_competitors: {
      description: "Direct competitors near the analysed address. Use for another radius, or to ignore competitors the owner names (exclude_names), and get the recomputed verdict.",
      parameters: { type: "object", properties: { radius_m: { type: "number" }, exclude_names: { type: "array", items: { type: "string" } } } },
      run: async ({ radius_m = 700, exclude_names = [] }) => {
        const lists = await Promise.all(resolved.map((p) => competitorsWithFallback(geo, { ...p }, trace, radius_m)));
        const kept = dedupeByName(lists.flat()).filter((c) => !exclude_names.some((n) => c.name.toLowerCase().includes(String(n).toLowerCase())));
        const v = verdict({ demand: ctx.heatmap.demand, local: ctx.heatmap.local, competitors: kept, share: shareOf(ctx.share), coverage: ctx.heatmap.coverage });
        return { competitors: kept.slice(0, 10).map(({ name, rating, distance_m }) => ({ name, rating, distance_m })), verdict: v.level, rule: v.rule_fired, adjustments: v.adjustments };
      },
    },
    analyse_address: {
      description: "Run the same concept at another address or at \"lat, lon\" (for the better spot use the best_alternative coordinates). Returns verdict, demand, offer and competitors there.",
      parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
      run: async ({ address }) => {
        const g = await T.geocode(address, trace);
        const s = await signalsAt({ geo: g, resolved: resolved.map((p) => ({ ...p })) }, trace, { withBest: false });
        return { address: g.display_name, lat: g.lat, lon: g.lon, verdict: s.verdict.level, rule: s.verdict.rule_fired, demand: s.heat.demand, offer: s.verdict.offer, competitors: s.competitors.length, supply_by_part: s.supply_by_part };
      },
    },
    zone_profile: {
      description: "What an area is made of: among the most popular places in the radius, what they serve, who goes, at what time, and their names (to pick complementary partners). Defaults to the analysed address; pass lat/lon for another spot.",
      parameters: { type: "object", properties: { radius_m: { type: "number" }, lat: { type: "number" }, lon: { type: "number" } } },
      run: async ({ radius_m = 500, lat = geo.lat, lon = geo.lon }) => {
        const { tag_ids, tag_names, ...p } = await T.zoneProfile({ lat, lon, radius: Math.min(radius_m, 800) }, trace);
        return p;
      },
    },
    verify_business: {
      description: "Check on the live web whether a business exists before proposing it as a partner.",
      parameters: { type: "object", properties: { name: { type: "string" }, city: { type: "string" } }, required: ["name", "city"] },
      run: ({ name, city }) => {
        const norm = (x) => String(x ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
        const n = norm(name);
        const same = (r) => n.length >= 4 && r.length >= 4 && (` ${r} `.includes(` ${n} `) || ` ${n} `.includes(` ${r} `));
        if ((ctx.competitors ?? []).some((c) => same(norm(c.name)))) return { exists: false, note: "direct competitor: not a partner" };
        return T.verifyBusiness({ name, city }, trace);
      },
    },
  };
}

export async function compare({ ctx, address }) {
  const g = await T.geocode(address);
  const s = await signalsAt({ geo: g, resolved: ctx.resolved.map((p) => ({ ...p })) }, undefined, { withBest: false });
  return {
    address: g.display_name,
    verdict: s.verdict,
    demand: s.heat.demand,
    offer: s.verdict.offer,
    competitors: s.competitors.slice(0, 6),
    competitors_total: s.competitors.length,
    supply_by_part: s.supply_by_part,
  };
}

export async function chat({ ctx, history, question, lang = "en" }) {
  if (!llmEnabled) return { text: lang === "es" ? "El chat necesita el modelo (NEBIUS_API_KEY). El análisis de arriba funciona igualmente." : "The chat needs the LLM (NEBIUS_API_KEY). The analysis above still works.", calls: [] };
  const system = `You are "Abro Aquí", answering follow-up questions about a location analysis for a small-business owner. When the question changes the inputs (another radius, ignoring a competitor, another address) call a tool and answer from its result. Keep answers to 2–4 short sentences, cite the numbers, never invent businesses. Verdict levels: RED / AMBER / AMBER-GREEN / UNKNOWN; there is no GREEN until the owner confirms foot traffic, rent and income. Answer in ${lang === "es" ? "Spanish" : "English"}.

Current analysis: ${JSON.stringify({ concept: ctx.concept, address: ctx.address, verdict: { level: ctx.verdict.level, rule: ctx.verdict.rule_fired, adjustments: ctx.verdict.adjustments }, demand_rank: ctx.heatmap.demand, offer: ctx.verdict.offer, best_alternative: ctx.heatmap.best, competitors: ctx.competitors.slice(0, 8).map(({ name, rating, distance_m }) => ({ name, rating, distance_m })), supply_by_part: ctx.supply_by_part, area: ctx.profile })}`;
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: question }];
  const trace = makeTrace();
  try {
    const r = await chatWithTools({ messages, tools: chatTools(ctx, trace), lang });
    return { ...r, trace: trace.entries };
  } catch (e) {
    trace.add({ source: "nebius", url: "chat: Nemotron 3.5 Lightning", ms: 0, cached: false, error: String(e.message).slice(0, 120) });
    return { text: lang === "es" ? "El modelo no ha podido responder ahora. El análisis de arriba sigue siendo válido; prueba de nuevo en un momento." : "The model could not answer right now. The analysis above still stands; try again in a moment.", calls: [], trace: trace.entries, error: true };
  }
}

/**
 * "Second opinion" agent: one goal, the model plans the steps. Nemotron 3.5 Lightning decides which blocks to
 * check and analyses them with the same rules; launch partners are not its job (see launch.js).
 * Without the LLM, a scripted version of the same steps runs so the demo still shows the work.
 */
export async function scout({ ctx, lang = "en" }) {
  const trace = makeTrace();
  const tools = {
    ...chatTools(ctx, trace),
    candidate_spots: {
      description: "Busy blocks within 800 m that the verdict rules already rate better than the address, best first (lat, lon, distance_m, level, demand, rivals within 700 m), computed during the analysis.",
      parameters: { type: "object", properties: {} },
      run: async () => ({ address_verdict: ctx.verdict.level, address_rivals_700m: ctx.verdict.offer?.c700, candidates: (ctx.candidates ?? []).map(({ lat, lon, distance_m, level, demand, c700, places_200m }) => ({ lat, lon, distance_m, level, demand, rivals_700m: c700, places_200m })) }),
    },
  };
  const city = ctx.address.split(",").map((x) => x.trim()).find((x) => /barcelona|new york|brooklyn|london|san francisco|madrid/i.test(x)) ?? "";
  const es = lang === "es";
  // the scout looks for the spot; launch partners come from the launch plan (Qloo taste graph + Tavily)
  delete tools.verify_business;
  const goal = `Goal: decide whether there is a better place within about 800 m to open "${ctx.concept}" near ${ctx.address}. The address comes out ${ctx.verdict.level} with ${ctx.verdict.offer?.c700} rivals within 700 m and taste rank ${ctx.heatmap.demand}.
You choose which tools to call, in which order and how many times: compare up to three candidate blocks with analyse_address (pass "lat, lon"), and use zone_profile to say what the recommended block is like.
Then answer in ${es ? "Spanish" : "English"}, plain text without markdown, in at most 4 short sentences: the block you recommend (with its distance, verdict, taste rank and rivals) or staying put, and why. The tools return verdict codes; write them as: RED = ${es ? "Aquí no" : "Not here"}, AMBER = ${es ? "Difícil" : "Hard"}, AMBER-GREEN = ${es ? "Prometedor" : "Promising"}, UNKNOWN = ${es ? "Sin datos" : "No data"}.`;

  if (llmEnabled) {
    try {
      const r = await chatWithTools({ messages: [{ role: "system", content: "You are the scouting agent of Abro Aquí. Plan your own steps with the tools; never invent numbers or businesses." }, { role: "user", content: goal }], tools, maxRounds: 10, maxTokens: 700, lang });
      const steps = r.calls.map((c) => stepOut(c, lang));
      const words = { "AMBER-GREEN": es ? "Prometedor" : "Promising", AMBER: es ? "Difícil" : "Hard", RED: es ? "Aquí no" : "Not here", UNKNOWN: es ? "Sin datos" : "No data" };
      let text = String(r.text ?? "").replace(/\*\*|__|^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "").trim();
      text = text.replace(/\b(?:AMBER-GREEN|AMBER‑GREEN|AMBER|UNKNOWN)\b/g, (m) => `«${words[m.replace("‑", "-")]}»`)
        .replace(/((?:verdict|veredicto|sale|comes out|is)\s*:?\s*)RED\b/gi, (_m, pre) => `${pre}«${words.RED}»`);
      if (es) text = text.replace(/taste[‑ -]rank/gi, "gusto");
      // every number in the answer must come from a tool result or the analysis; sentences with others are dropped
      const checked = groundNumbers(text, [ctx.verdict, ctx.heatmap?.demand, ctx.heatmap?.best, ...r.calls.map((c) => c.result)]);
      if (!checked.text) throw new Error("the answer had no sentence whose numbers came from the tools");
      text = checked.text;
      if (checked.dropped) trace.add({ source: "check", url: `scout: ${checked.dropped} sentence(s) dropped (numbers not in the tool results)`, ms: 0, cached: false });
      return { mode: "model", model: r.model, text, steps, trace: trace.entries };
    } catch (e) {
      trace.add({ source: "nebius", url: `scout: ${MODEL_NOTE}`, ms: 0, cached: false, error: String(e.message).slice(0, 80) });
      // fall through to the scripted steps so the owner still gets an answer
    }
  }

  // scripted fallback (no LLM): same tools, fixed order
  const steps = [];
  const calls = [];
  const run = async (name, args) => { const t0 = Date.now(); let result; try { result = await tools[name].run(args); } catch (e) { result = { error: String(e.message).slice(0, 200) }; } const c = { name, args, result, ms: Date.now() - t0 }; calls.push(c); steps.push(stepOut(c, lang)); return result; };
  const cands = await run("candidate_spots", {});
  const top = cands.candidates?.[0];
  let chosen = null, profile = null;
  if (top) {
    chosen = await run("analyse_address", { address: `${top.lat.toFixed(5)}, ${top.lon.toFixed(5)}` });
    profile = await run("zone_profile", { lat: top.lat, lon: top.lon, radius_m: 300 });
  }
  const V = { RED: es ? "Aquí no" : "Not here", AMBER: es ? "Difícil" : "Hard", "AMBER-GREEN": es ? "Prometedor" : "Promising", UNKNOWN: es ? "Sin datos" : "No data" };
  const lvl = V[chosen?.verdict && !chosen.error ? chosen.verdict : top?.level] ?? "";
  const riv = chosen && !chosen.error ? chosen.competitors : top?.rivals_700m;
  const text = !top
    ? (es ? "Ninguna manzana con vida a menos de 800 m sale mejor con las mismas reglas: la dirección es tan buena como lo que hay alrededor." : "No busy block within 800 m scores better under the same rules: the address is as good as anything around it.")
    : (es ? `Recomiendo mirar ${top.distance_m} m más allá (${top.lat.toFixed(4)}, ${top.lon.toFixed(4)}): sale «${lvl}» con ${riv} rivales a 700 m frente a ${ctx.verdict.offer?.c700} aquí.` : `Look ${top.distance_m} m away (${top.lat.toFixed(4)}, ${top.lon.toFixed(4)}): it comes out ${lvl} with ${riv} rivals within 700 m against ${ctx.verdict.offer?.c700} here.`);
  return { mode: "scripted", model: llmEnabled ? "scripted (model failed)" : "scripted (no LLM)", text, steps, trace: trace.entries };
}

const MODEL_NOTE = "Nemotron 3.5 Lightning";

/** Numbers in free text that the tool results back up (decimals within ±0.006, integers exactly). */
export function groundNumbers(text, sources) {
  const known = [150, 200, 250, 300, 400, 500, 700, 800, 1500, 0.75, 0.85, 4.5, 50]; // the rules' own radii and thresholds
  JSON.stringify(sources, (_k, v) => { if (typeof v === "number") known.push(v); return v; });
  const ok = (raw) => {
    const x = Number(raw.replace(",", "."));
    if (!Number.isFinite(x)) return true;
    if (/[.,]/.test(raw)) return known.some((k) => Math.abs(k - x) < 0.006);
    return known.some((k) => Math.round(k) === x || Math.abs(k * 100 - x) < 0.6); // integers, or percentages of a share
  };
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sn) => (sn.match(/\d+(?:[.,]\d+)?/g) ?? []).every(ok));
  return { text: kept.join(" ").trim(), dropped: sentences.length - kept.length };
}

/** A compact, display-ready step for the timeline. */
function stepOut({ name, args, result, ms, round, think_ms }, lang = "en") {
  const r = result ?? {};
  const L = (en, sp) => (lang === "es" ? sp : en);
  const V = { RED: L("Not here", "Aquí no"), AMBER: L("Hard", "Difícil"), "AMBER-GREEN": L("Promising", "Prometedor"), UNKNOWN: L("No data", "Sin datos") };
  let summary;
  if (r.error) summary = `error: ${r.error}`;
  else if (name === "candidate_spots") summary = L(`${r.candidates?.length ?? 0} candidate blocks (computed during the analysis)`, `${r.candidates?.length ?? 0} manzanas candidatas (calculadas en el análisis)`);
  else if (name === "analyse_address") summary = L(`${V[r.verdict] ?? r.verdict} · demand ${r.demand?.toFixed?.(2) ?? "–"} · ${r.competitors} rivals within 700 m`, `${V[r.verdict] ?? r.verdict} · gusto ${r.demand?.toFixed?.(2).replace(".", ",") ?? "–"} · ${r.competitors} rivales a 700 m`);
  else if (name === "zone_profile") summary = L(`${r.places} places · `, `${r.places} locales · `) + (r.places_named ?? []).slice(0, 3).map((p) => p.name).join(", ");
  else if (name === "verify_business" && r.note === "direct competitor: not a partner") summary = L("refused: a direct competitor is not a partner", "rechazado: un competidor directo no es un socio");
  else if (name === "verify_business") summary = r.exists === true ? L(`found: ${r.title ?? r.url}`, `encontrado: ${r.title ?? r.url}`) : r.exists === false ? L("not found on the web", "no aparece en la web") : r.note ?? L("not checked", "sin comprobar");
  else if (name === "nearby_competitors") summary = L(`${r.competitors?.length ?? 0} rivals → ${V[r.verdict] ?? r.verdict}`, `${r.competitors?.length ?? 0} rivales → ${V[r.verdict] ?? r.verdict}`);
  else summary = JSON.stringify(r).slice(0, 120);
  return { tool: name, args, summary, ms, round: round ?? null, think_ms: think_ms ?? null };
}
