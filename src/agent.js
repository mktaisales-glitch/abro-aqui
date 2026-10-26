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
  return { heat: { cells: [], nearest: null, best: null, coverage: 0 }, main };
}

/** Competitors with fallback: an empty list only counts if the tag is used for places within 5 km; otherwise try the next candidate. */
async function competitorsWithFallback(geo, p, trace, radius = 700) {
  const cands = p.comp_candidates?.length ? p.comp_candidates : [p.competitor_tag].filter(Boolean);
  for (const tag of cands) {
    const list = await T.nearbyCompetitors({ lat: geo.lat, lon: geo.lon, radius, tag }, trace);
    if (list.length || (await T.tagInUse({ lat: geo.lat, lon: geo.lon, tag }, trace).catch(() => true))) {
      p.competitor_tag = tag;
      return list;
    }
  }
  return [];
}

export async function signalsAt({ geo, resolved }, trace) {
  const [{ heat, main }, compLists, profile] = await Promise.all([
    heatWithFallback(geo, resolved, trace),
    Promise.all(resolved.map((p) => competitorsWithFallback(geo, p, trace))),
    T.zoneProfile({ lat: geo.lat, lon: geo.lon }, trace),
  ]);
  const competitors = dedupeByName(compLists.flat());
  const supply_by_part = resolved.map((p, i) => ({ part: p.part, tag: p.competitor_tag, within_700m: compLists[i].length }));
  const share = T.conceptShare(profile, resolved);
  const v = verdict({
    affinity: heat.nearest?.affinity ?? 0,
    affinity_rank: heat.nearest?.affinity_rank ?? 0,
    supply: heat.nearest?.popularity ?? 0,
    competitors,
    coverage: heat.coverage,
  });
  const gap = supply_by_part.filter((s) => s.within_700m === 0 && s.tag).map((s) => s.part);
  if (gap.length && v.level !== "UNKNOWN" && (heat.nearest?.affinity ?? 0) >= 0.5 && !v.gap) {
    v.gap = true;
    v.adjustments.push(`nobody within 700 m offers: ${gap.join(", ")}`);
  }
  return { heat, competitors, supply_by_part, share, profile, verdict: v, gap, main };
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
    } catch {}
  }
  const resolved = await T.resolveConcept(parts, trace);
  const s = await signalsAt({ geo, resolved }, trace);

  const { tag_ids, tag_names, ...profile } = s.profile;
  const signals = {
    concept,
    concept_parts: resolved.map(({ part, heatmap_tag, competitor_tag }) => ({ part, heatmap_tag, competitor_tag })),
    address: geo.display_name,
    verdict: s.verdict,
    nearest_cell: s.heat.nearest,
    best_alternative_cell: s.heat.best,
    competitors_within_700m: s.competitors.slice(0, 10).map(({ name, rating, price_level, distance_m }) => ({ name, rating, price_level, distance_m })),
    supply_by_part: s.supply_by_part,
    already_served_by: s.share,
    gap: s.gap,
    area_profile: profile,
  };

  let report;
  let reportMeta = { model: "template" };
  if (llmEnabled) {
    try {
      const r = await writeReport(signals, lang);
      report = r.data;
      reportMeta = { model: r.model, ms: r.ms };
      llm.push({ task: "write report", model: r.model, ms: r.ms });
    } catch (e) {
      report = templateReport(signals);
      reportMeta = { model: "template", error: String(e.message).slice(0, 200) };
    }
  } else report = templateReport(signals);

  let noQloo = null;
  if (withoutQloo && llmEnabled) {
    try {
      const r = await writeReportWithoutQloo({ concept, address }, lang);
      noQloo = { ...r.data, model: r.model };
      llm.push({ task: "report without Qloo", model: r.model, ms: r.ms });
    } catch {}
  }

  return {
    concept,
    address: geo.display_name,
    geo,
    resolved,
    verdict: s.verdict,
    report,
    report_meta: reportMeta,
    without_qloo: noQloo,
    heatmap: { cells: s.heat.cells, nearest: s.heat.nearest, best: s.heat.best, coverage: s.heat.coverage },
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
        const v = verdict({ affinity: ctx.heatmap.nearest?.affinity ?? 0, affinity_rank: ctx.heatmap.nearest?.affinity_rank ?? 0, supply: ctx.heatmap.nearest?.popularity ?? 0, competitors: kept, coverage: ctx.heatmap.coverage });
        return { competitors: kept.slice(0, 10).map(({ name, rating, distance_m }) => ({ name, rating, distance_m })), verdict: v.level, rule: v.rule_fired, adjustments: v.adjustments };
      },
    },
    analyse_address: {
      description: "Run the same concept at another address (e.g. '300 m north', another street). Returns verdict, affinity, supply and competitors there.",
      parameters: { type: "object", properties: { address: { type: "string" } }, required: ["address"] },
      run: async ({ address }) => {
        const g = await T.geocode(address);
        const s = await signalsAt({ geo: g, resolved: resolved.map((p) => ({ ...p })) });
        return { address: g.display_name, verdict: s.verdict.level, rule: s.verdict.rule_fired, affinity: s.heat.nearest?.affinity, supply: s.heat.nearest?.popularity, competitors: s.competitors.length, supply_by_part: s.supply_by_part };
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
    affinity: s.heat.nearest?.affinity ?? null,
    supply: s.heat.nearest?.popularity ?? null,
    competitors: s.competitors.slice(0, 6),
    supply_by_part: s.supply_by_part,
  };
}

export async function chat({ ctx, history, question, lang = "en" }) {
  if (!llmEnabled) return { text: lang === "es" ? "El chat necesita el modelo (NEBIUS_API_KEY). El análisis de arriba funciona igualmente." : "The chat needs the LLM (NEBIUS_API_KEY). The analysis above still works.", calls: [] };
  const system = `You are "Abro Aquí", answering follow-up questions about a location analysis for a small-business owner. When the question changes the inputs (another radius, ignoring a competitor, another address) call a tool and answer from its result. Keep answers to 2–4 short sentences, cite the numbers, never invent businesses. Verdict levels: RED / AMBER / AMBER-GREEN / UNKNOWN; there is no GREEN until the owner confirms foot traffic, rent and income. Answer in ${lang === "es" ? "Spanish" : "English"}.

Current analysis: ${JSON.stringify({ concept: ctx.concept, address: ctx.address, verdict: { level: ctx.verdict.level, rule: ctx.verdict.rule_fired, adjustments: ctx.verdict.adjustments }, nearest: ctx.heatmap.nearest, best: ctx.heatmap.best, competitors: ctx.competitors.slice(0, 8).map(({ name, rating, distance_m }) => ({ name, rating, distance_m })), supply_by_part: ctx.supply_by_part, area: ctx.profile })}`;
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: question }];
  return chatWithTools({ messages, tools: chatTools(ctx) });
}
