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

export async function signalsAt({ geo, resolved }, trace) {
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
  if (v.level !== "UNKNOWN") {
    const tags = [...new Set(resolved.map((p) => p.competitor_tag).filter(Boolean))];
    const wide = dedupeByName((await Promise.all(tags.map((tag) => T.rivalsAround({ lat: geo.lat, lon: geo.lon, tag }, trace).catch(() => [])))).flat());
    const better = bestSpot(geo, heat, dedupeByName([...wide, ...competitors]).filter((r) => r.lat != null), v);
    for (const b of better.slice(0, 4)) {
      const n = await T.placesNear({ lat: b.lat, lon: b.lon }, trace).catch(() => 0);
      if (n >= MIN_PLACES) { best = { ...b, places_200m: n }; break; }
    }
  }
  heat.best = best;
  return { heat, competitors, supply_by_part, share, profile, verdict: v, gap, main, measured, unmeasured };
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
export function chatTools(ctx) {
  const { geo, resolved } = ctx;
  return {
    nearby_competitors: {
      description: "Direct competitors near the analysed address. Use for another radius, or to ignore competitors the owner names (exclude_names), and get the recomputed verdict.",
      parameters: { type: "object", properties: { radius_m: { type: "number" }, exclude_names: { type: "array", items: { type: "string" } } } },
      run: async ({ radius_m = 700, exclude_names = [] }) => {
        const lists = await Promise.all(resolved.map((p) => competitorsWithFallback(geo, { ...p }, undefined, radius_m)));
        const kept = dedupeByName(lists.flat()).filter((c) => !exclude_names.some((n) => c.name.toLowerCase().includes(String(n).toLowerCase())));
        const v = verdict({ demand: ctx.heatmap.demand, local: ctx.heatmap.local, competitors: kept, share: shareOf(ctx.share), coverage: ctx.heatmap.coverage });
        return { competitors: kept.slice(0, 10).map(({ name, rating, distance_m }) => ({ name, rating, distance_m })), verdict: v.level, rule: v.rule_fired, adjustments: v.adjustments };
      },
    },
    analyse_address: {
      description: "Run the same concept at another address (e.g. '300 m north', another street). Returns verdict, demand, offer and competitors there.",
      parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
      run: async ({ address }) => {
        const g = await T.geocode(address);
        const s = await signalsAt({ geo: g, resolved: resolved.map((p) => ({ ...p })) });
        return { address: g.display_name, verdict: s.verdict.level, rule: s.verdict.rule_fired, demand: s.heat.demand, offer: s.verdict.offer, competitors: s.competitors.length, supply_by_part: s.supply_by_part };
      },
    },
    zone_profile: {
      description: "What the area around the address is made of: among the most popular places in the radius, what they serve, who goes, at what time.",
      parameters: { type: "object", properties: { radius_m: { type: "number" } } },
      run: async ({ radius_m = 500 }) => {
        const { tag_ids, tag_names, ...p } = await T.zoneProfile({ lat: geo.lat, lon: geo.lon, radius: radius_m });
        return p;
      },
    },
    verify_business: {
      description: "Check on the live web whether a business exists before proposing it as a partner.",
      parameters: { type: "object", properties: { name: { type: "string" }, city: { type: "string" } }, required: ["name", "city"] },
      run: ({ name, city }) => T.verifyBusiness({ name, city }),
    },
  };
}

export async function compare({ ctx, address }) {
  const g = await T.geocode(address);
  const s = await signalsAt({ geo: g, resolved: ctx.resolved.map((p) => ({ ...p })) });
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
  return chatWithTools({ messages, tools: chatTools(ctx) });
}
