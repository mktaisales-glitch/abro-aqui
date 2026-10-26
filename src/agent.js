// Pipeline for one analysis + the "what if…?" chat — see specs/03-agent.md.
import { makeTrace } from "./qloo.js";
import * as T from "./tools.js";
import { verdict } from "./verdict.js";
import { llmEnabled, pickTags, writeReport, writeReportWithoutQloo, templateReport, chatWithTools } from "./llm.js";

const PRESENT_PREFIXES = ["urn:tag:category:place:", "urn:tag:genre:place:"];

/** Categories the area likes (zone taste) that no nearby place offers. Simplified: tags in zone taste not matching competitor tags. */
function computeGap(zoneTaste, competitors) {
  const present = new Set(competitors.flatMap((c) => c.tags ?? []));
  return zoneTaste
    .filter((t) => PRESENT_PREFIXES.some((p) => t.id.startsWith(p)) && !present.has(t.id) && (t.affinity ?? 0) >= 0.9)
    .slice(0, 6);
}

export async function analyze({ concept, address, lang = "en", withoutQloo = false }, { onStep } = {}) {
  const trace = makeTrace();
  const timings = {};
  const t0 = Date.now();

  onStep?.("geocode");
  const geo = await T.geocode(address, trace);

  onStep?.("tags");
  const candidates = await T.tagCandidates(concept, trace);
  let tags;
  if (llmEnabled) {
    try {
      tags = await pickTags(concept, candidates);
      timings.pick_tags_ms = tags.ms;
    } catch {
      tags = T.pickTagsHeuristic(candidates, concept);
    }
  } else tags = T.pickTagsHeuristic(candidates, concept);

  onStep?.("qloo");
  const [heat, competitors, zoneTaste, brands] = await Promise.all([
    T.heatmap({ lat: geo.lat, lon: geo.lon, tag: tags.heatmap_tag }, trace),
    T.nearbyCompetitors({ lat: geo.lat, lon: geo.lon, tag: tags.category_tag }, trace),
    T.zoneTaste({ lat: geo.lat, lon: geo.lon }, trace),
    T.affineBrands({ lat: geo.lat, lon: geo.lon, tag: tags.heatmap_tag }, trace).catch(() => []),
  ]);

  const v = verdict({
    affinity: heat.nearest?.affinity ?? 0,
    affinity_rank: heat.nearest?.affinity_rank ?? 0,
    supply: heat.nearest?.popularity ?? 0,
    competitors: competitors.filter((c) => !c.is_closed),
    coverage: heat.coverage,
  });
  const gap = computeGap(zoneTaste, competitors);

  const signals = {
    concept,
    address: geo.display_name,
    tags,
    verdict: v,
    nearest_cell: heat.nearest,
    best_cell: heat.best,
    competitors: competitors.slice(0, 10),
    zone_taste: zoneTaste.slice(0, 15),
    gap,
    brands: brands.slice(0, 8),
  };

  onStep?.("write");
  let report;
  let reportMeta = { model: "template" };
  if (llmEnabled) {
    try {
      const r = await writeReport(signals, lang);
      report = r.data;
      reportMeta = { model: r.model, ms: r.ms };
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
    } catch {}
  }

  return {
    concept,
    address: geo.display_name,
    geo,
    tags,
    verdict: v,
    report,
    report_meta: reportMeta,
    without_qloo: noQloo,
    heatmap: { cells: heat.cells, nearest: heat.nearest, best: heat.best, coverage: heat.coverage },
    competitors,
    zone_taste: zoneTaste,
    gap,
    brands,
    trace: trace.entries,
    total_ms: Date.now() - t0,
  };
}

/** Tools the chat model can call. Context = the last analysis (so "what if I remove X?" works). */
export function chatTools(ctx) {
  const { geo } = ctx;
  return {
    nearby_competitors: {
      description: "Same-category places near the address. Use to re-check competition with another radius or category, or to exclude a competitor the owner wants to ignore.",
      parameters: { type: "object", properties: { radius_m: { type: "number" }, category_tag: { type: "string" }, exclude_names: { type: "array", items: { type: "string" } } } },
      run: async ({ radius_m = 700, category_tag = ctx.tags.category_tag, exclude_names = [] }) => {
        const list = await T.nearbyCompetitors({ lat: geo.lat, lon: geo.lon, radius: radius_m, tag: category_tag });
        const kept = list.filter((c) => !exclude_names.some((n) => c.name.toLowerCase().includes(n.toLowerCase())));
        return { competitors: kept.slice(0, 10), verdict: verdict({ affinity: ctx.heatmap.nearest?.affinity ?? 0, affinity_rank: ctx.heatmap.nearest?.affinity_rank ?? 0, supply: ctx.heatmap.nearest?.popularity ?? 0, competitors: kept, coverage: ctx.heatmap.coverage }) };
      },
    },
    heatmap_at: {
      description: "Taste affinity for the concept at another address or offset. Use for 'what if 300 m further' or another street.",
      parameters: { type: "object", properties: { address: { type: "string" }, heatmap_tag: { type: "string" } }, required: ["address"] },
      run: async ({ address, heatmap_tag = ctx.tags.heatmap_tag }) => {
        const g = await T.geocode(address);
        const h = await T.heatmap({ lat: g.lat, lon: g.lon, tag: heatmap_tag });
        return { address: g.display_name, nearest: h.nearest, best: h.best, coverage: h.coverage };
      },
    },
    zone_taste: {
      description: "What the area around the address likes (aggregated taste tags).",
      parameters: { type: "object", properties: { radius_m: { type: "number" } } },
      run: async ({ radius_m = 800 }) => ({ tags: (await T.zoneTaste({ lat: geo.lat, lon: geo.lon, radius: radius_m })).slice(0, 15) }),
    },
    verify_business: {
      description: "Check on the live web whether a business exists (use before proposing it as a partner).",
      parameters: { type: "object", properties: { name: { type: "string" }, city: { type: "string" } }, required: ["name", "city"] },
      run: ({ name, city }) => T.verifyBusiness({ name, city }),
    },
    compare_locations: {
      description: "Compare the concept at two addresses: affinity, supply and competitors side by side.",
      parameters: { type: "object", properties: { address_a: { type: "string" }, address_b: { type: "string" } }, required: ["address_a", "address_b"] },
      run: async ({ address_a, address_b }) => {
        const one = async (addr) => {
          const g = await T.geocode(addr);
          const [h, c] = await Promise.all([T.heatmap({ lat: g.lat, lon: g.lon, tag: ctx.tags.heatmap_tag }), T.nearbyCompetitors({ lat: g.lat, lon: g.lon, tag: ctx.tags.category_tag })]);
          return { address: g.display_name, affinity: h.nearest?.affinity, supply: h.nearest?.popularity, competitors: c.length, verdict: verdict({ affinity: h.nearest?.affinity ?? 0, affinity_rank: h.nearest?.affinity_rank ?? 0, supply: h.nearest?.popularity ?? 0, competitors: c, coverage: h.coverage }).level };
        };
        const [a, b] = await Promise.all([one(address_a), one(address_b)]);
        return { a, b };
      },
    },
  };
}

export async function chat({ ctx, history, question, lang = "en" }) {
  if (!llmEnabled) return { text: "The chat needs the LLM (NEBIUS_API_KEY). The analysis above still works.", calls: [] };
  const system = `You are "Abro Aquí", answering follow-up questions about an analysis. Use the tools when the question changes the inputs (another radius, excluding a competitor, another address). Keep answers short and concrete, cite numbers from tool results, and never invent businesses. The verdict levels are RED / AMBER / AMBER-GREEN / UNKNOWN; there is no GREEN until the owner confirms foot traffic, rent and income. Respond in ${lang === "es" ? "Spanish" : "English"}.\n\nCurrent analysis (JSON): ${JSON.stringify({ concept: ctx.concept, address: ctx.address, tags: ctx.tags, verdict: ctx.verdict, nearest: ctx.heatmap.nearest, best: ctx.heatmap.best, competitors: ctx.competitors.slice(0, 10), zone_taste: ctx.zone_taste.slice(0, 10) })}`;
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: question }];
  return chatWithTools({ messages, tools: chatTools(ctx) });
}
