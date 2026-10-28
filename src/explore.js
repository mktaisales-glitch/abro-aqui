// "I have premises: which food business fits here?" — the same rules run for a list of concepts at one address, ranked.
// No report and no better-spot search per concept (that is what the full analysis is for): taste rank, offer, verdict.
import { makeTrace } from "./http.js";
import * as T from "./tools.js";
import { signalsAt } from "./agent.js";

// Tags already checked on the live API; the rest are resolved with /v2/tags (and cached).
const KNOWN = {
  "seafood restaurant": ["urn:tag:genre:place:restaurant:seafood", "urn:tag:category:place:seafood_restaurant"],
  pizza: ["urn:tag:genre:place:restaurant:pizza", "urn:tag:category:place:pizza"],
  ramen: ["urn:tag:genre:place:restaurant:ramen", "urn:tag:category:place:ramen_restaurant"],
  "coffee shop": ["urn:tag:genre:place:restaurant:coffee_shop", "urn:tag:category:place:coffee_shop"],
  bakery: ["urn:tag:genre:place:restaurant:bakery", "urn:tag:category:place:bakery"],
  "ice cream": ["urn:tag:genre:place:restaurant:ice_cream_shop", "urn:tag:category:place:ice_cream_shop"],
};
// Food and drink only: Qloo knows these places well (hair salons, gyms and shops have too little data to judge).
export const CONCEPTS = ["seafood restaurant", "pizza", "ramen", "sushi", "burger", "tapas", "vegan restaurant", "mexican restaurant", "italian restaurant", "brunch", "coffee shop", "bakery", "ice cream", "cocktail bar", "wine bar"];

const RANK = { "AMBER-GREEN": 3, AMBER: 2, RED: 1, UNKNOWN: 0 };

async function resolveOne(concept, trace) {
  const k = KNOWN[concept];
  if (k) return [{ part: concept, heatmap_tag: k[0], competitor_tag: k[1], heat_candidates: [k[0]], comp_candidates: [k[1]], label: concept }];
  return T.resolveConcept([concept], trace);
}

export async function explore({ address, radius = 1000, concepts = CONCEPTS }) {
  const trace = makeTrace();
  const t0 = Date.now();
  const geo = await T.geocode(address, trace);
  const rows = await Promise.all(concepts.map(async (concept) => {
    try {
      const resolved = await resolveOne(concept, trace);
      const s = await signalsAt({ geo, resolved, radius }, trace, { withBest: false });
      const v = s.verdict;
      const top = s.competitors[0];
      return {
        concept,
        level: v.level,
        rule_code: v.rule_code,
        rule: v.rule_fired,
        rule_es: v.rule_es,
        demand: s.heat.demand,
        c400: v.offer?.c400 ?? null,
        c700: v.offer?.c700 ?? null,
        share: v.offer?.share ?? null,
        nearest_rival: top ? { name: top.name, distance_m: top.distance_m, rating: top.rating } : null,
        offer_measured: s.supply_by_part.every((p) => p.measured),
      };
    } catch (e) {
      return { concept, level: "UNKNOWN", rule_code: "no-tag", rule: String(e.message).slice(0, 160), rule_es: "Qloo no tiene una etiqueta para este concepto.", demand: null };
    }
  }));
  rows.sort((a, b) => RANK[b.level] - RANK[a.level] || (a.rule_code === "mixed" ? -1 : 0) - (b.rule_code === "mixed" ? -1 : 0) || (b.demand ?? -1) - (a.demand ?? -1) || (a.c700 ?? 99) - (b.c700 ?? 99));
  return { address: geo.display_name, place: T.shortAddress(geo.display_name), geo, radius, rows, trace: trace.entries, total_ms: Date.now() - t0 };
}

