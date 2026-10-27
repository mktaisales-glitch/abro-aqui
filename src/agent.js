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
  if (withBest && v.level !== "UNKNOWN") {
    const tags = [...new Set(resolved.map((p) => p.competitor_tag).filter(Boolean))];
    const wide = dedupeByName((await Promise.all(tags.map((tag) => T.rivalsAround({ lat: geo.lat, lon: geo.lon, tag }, trace).catch(() => [])))).flat());
    const better = bestSpot(geo, heat, dedupeByName([...wide, ...competitors]).filter((r) => r.lat != null), v);
    for (const b of better.slice(0, 4)) {
      const n = await T.placesNear({ lat: b.lat, lon: b.lon }, trace).catch(() => 0);
      b.places_200m = n;
      if (n >= MIN_PLACES) { best = b; break; }
    }
    candidates = better.filter((b) => b.places_200m == null || b.places_200m >= MIN_PLACES).slice(0, 5);
  }
  heat.best = best;
  return { heat, competitors, supply_by_part, share, profile, verdict: v, gap, main, measured, unmeasured, candidates };
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
      parts = n.parts;
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
    supply_by_part: s.supply_by_part,
    share: s.share,
    gap: s.gap,
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
      run: ({ name, city }) => T.verifyBusiness({ name, city }, trace),
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
  const r = await chatWithTools({ messages, tools: chatTools(ctx, trace) });
  return { ...r, trace: trace.entries };
}

/**
 * "Second opinion" agent: one goal, the model plans the steps. Nemotron 3.5 Lightning decides which blocks to
 * check, analyses them with the same rules, looks for complementary places there and verifies partners with Tavily.
 * Without the LLM, a scripted version of the same steps runs so the demo still shows the work.
 */
export async function scout({ ctx, lang = "en" }) {
  const trace = makeTrace();
  const tools = {
    ...chatTools(ctx, trace),
    candidate_spots: {
      description: "Busy blocks within 800 m that the verdict rules already rate better than the address, best first (lat, lon, distance_m, level, demand, rivals within 700 m). Start here.",
      parameters: { type: "object", properties: {} },
      run: async () => ({ address_verdict: ctx.verdict.level, address_rivals_700m: ctx.verdict.offer?.c700, candidates: (ctx.candidates ?? []).map(({ lat, lon, distance_m, level, demand, c700, places_200m }) => ({ lat, lon, distance_m, level, demand, rivals_700m: c700, places_200m })) }),
    },
  };
  const city = ctx.address.split(",").map((x) => x.trim()).find((x) => /barcelona|new york|brooklyn|london|san francisco|madrid/i.test(x)) ?? "";
  const goal = `Goal: find the best place within about 800 m to open "${ctx.concept}" near ${ctx.address}, and up to 3 complementary launch partners that really exist.
Plan it yourself with the tools: 1) candidate_spots; 2) analyse_address on the one or two most promising candidates, passing "lat, lon"; 3) zone_profile with the lat/lon of the spot you prefer, to find complementary places (not competitors) among places_named; 4) verify_business for each partner (city: "${city}") before naming it.
Then answer in ${lang === "es" ? "Spanish" : "English"} in at most 5 short sentences: the spot you recommend (or staying put) with its verdict and numbers, and the partners that verify_business confirmed. Never name a partner that was not confirmed. Verdict levels: RED = Not here, AMBER = Hard, AMBER-GREEN = Promising.`;

  if (llmEnabled) {
    const r = await chatWithTools({ messages: [{ role: "system", content: "You are the scouting agent of Abro Aquí. Use the tools; never invent numbers or businesses." }, { role: "user", content: goal }], tools, maxRounds: 10, maxTokens: 700 });
    return { mode: "model", model: r.model, text: r.text, steps: r.calls.map(stepOut), trace: trace.entries };
  }

  // scripted fallback (no LLM): same tools, fixed order
  const steps = [];
  const run = async (name, args) => { const t0 = Date.now(); let result; try { result = await tools[name].run(args); } catch (e) { result = { error: String(e.message).slice(0, 200) }; } steps.push(stepOut({ name, args, result, ms: Date.now() - t0 })); return result; };
  const cands = await run("candidate_spots", {});
  const top = cands.candidates?.[0];
  let chosen = null, profile = null;
  if (top) {
    chosen = await run("analyse_address", { address: `${top.lat.toFixed(5)}, ${top.lon.toFixed(5)}` });
    profile = await run("zone_profile", { lat: top.lat, lon: top.lon, radius_m: 300 });
  }
  const kinds = /bar|pub|theater|theatre|cinema|hotel|hostel|museum|music|club|market|gallery|book/i;
  const picks = (profile?.places_named ?? []).filter((p) => p.kind && kinds.test(p.kind)).slice(0, 2);
  const verified = [];
  for (const p of picks) { const v = await run("verify_business", { name: p.name, city }); if (v.exists) verified.push(p.name); }
  const es = lang === "es";
  const V = { RED: es ? "Aquí no" : "Not here", AMBER: es ? "Difícil" : "Hard", "AMBER-GREEN": es ? "Prometedor" : "Promising", UNKNOWN: es ? "Sin datos" : "No data" };
  const lvl = V[chosen?.verdict && !chosen.error ? chosen.verdict : top?.level] ?? "";
  const riv = chosen && !chosen.error ? chosen.competitors : top?.rivals_700m;
  const text = !top
    ? (es ? "Ninguna manzana con vida a menos de 800 m sale mejor con las mismas reglas: la dirección es tan buena como lo que hay alrededor." : "No busy block within 800 m scores better under the same rules: the address is as good as anything around it.")
    : (es ? `Recomiendo mirar ${top.distance_m} m más allá (${top.lat.toFixed(4)}, ${top.lon.toFixed(4)}): sale «${lvl}» con ${riv} rivales a 700 m frente a ${ctx.verdict.offer?.c700} aquí.` : `Look ${top.distance_m} m away (${top.lat.toFixed(4)}, ${top.lon.toFixed(4)}): it comes out ${lvl} with ${riv} rivals within 700 m against ${ctx.verdict.offer?.c700} here.`) +
      (verified.length ? (es ? ` Socios verificados en la web: ${verified.join(", ")}.` : ` Partners verified on the web: ${verified.join(", ")}.`) : (es ? " Los socios no se han podido verificar en este modo." : " Partners could not be verified in this mode."));
  return { mode: "scripted", model: "scripted (no LLM)", text, steps, trace: trace.entries };
}

/** A compact, display-ready step for the timeline. */
function stepOut({ name, args, result, ms, round, think_ms }) {
  const r = result ?? {};
  let summary;
  if (r.error) summary = `error: ${r.error}`;
  else if (name === "candidate_spots") summary = `${r.candidates?.length ?? 0} candidate blocks`;
  else if (name === "analyse_address") summary = `${r.verdict} · demand ${r.demand?.toFixed?.(2) ?? "–"} · ${r.competitors} rivals within 700 m`;
  else if (name === "zone_profile") summary = `${r.places} places · ${(r.places_named ?? []).slice(0, 3).map((p) => p.name).join(", ")}`;
  else if (name === "verify_business") summary = r.exists === true ? `found: ${r.title ?? r.url}` : r.exists === false ? "not found on the web" : r.note ?? "not checked";
  else if (name === "nearby_competitors") summary = `${r.competitors?.length ?? 0} rivals → ${r.verdict}`;
  else summary = JSON.stringify(r).slice(0, 120);
  return { tool: name, args, summary, ms, round: round ?? null, think_ms: think_ms ?? null };
}
