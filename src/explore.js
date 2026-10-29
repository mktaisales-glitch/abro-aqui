// "I have a place: which food business fits here?" — the same rules run for a list of concepts at one address, ranked.
// No report and no better-spot search per concept (that is what the full analysis is for): taste rank, offer, verdict.
import { makeTrace } from "./http.js";
import * as T from "./tools.js";
import { signalsAt } from "./agent.js";
import { CONCEPT_LIST, knownResolved } from "./concepts.js";

// Food and drink only: Qloo knows these places well (hair salons, gyms and shops have too little data to judge).
export const CONCEPTS = CONCEPT_LIST.map((c) => c.id);

const RANK = { "AMBER-GREEN": 3, AMBER: 2, RED: 1, UNKNOWN: 0 };

async function resolveOne(concept, trace) {
  return knownResolved(concept) ?? T.resolveConcept([concept], trace);
}

export async function explore({ address, radius = 1000, concepts = CONCEPTS, coords = null }) {
  const trace = makeTrace();
  const t0 = Date.now();
  const geo = T.geoFromCoords(coords, address) ?? await T.geocode(address, trace);
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
      return { concept, level: "UNKNOWN", rule_code: "no-tag", rule: /no place tag/.test(String(e.message)) ? "Qloo has no tag for this concept." : "No data for this concept here right now.", rule_es: /no place tag/.test(String(e.message)) ? "Qloo no tiene una etiqueta para este concepto." : "Ahora mismo no hay datos de este concepto aquí.", demand: null };
    }
  }));
  rows.sort((a, b) => RANK[b.level] - RANK[a.level] || (a.rule_code === "mixed" ? -1 : 0) - (b.rule_code === "mixed" ? -1 : 0) || (b.demand ?? -1) - (a.demand ?? -1) || (a.c700 ?? 99) - (b.c700 ?? 99));
  return { address: geo.display_name, place: T.shortAddress(geo.display_name), geo, radius, rows, trace: trace.entries, total_ms: Date.now() - t0 };
}


/** One "what fits" run at a time on the whole server, for the page and the chat tool alike.
 *  The lock is released when the run really ends (not when a route deadline answers 504). */
let running = null; // { key, p }
const keyOf = ({ address, radius = 1000, coords = null }) => `${coords ? `${(+coords.lat).toFixed(4)},${(+coords.lon).toFixed(4)}` : String(address).toLowerCase()}|${radius}`;
export const exploreBusy = () => !!running;
export function exploreOnce(args) {
  const key = keyOf(args);
  if (running?.key === key) return running.p;                       // the same table already being built
  if (running) return running.p.catch(() => {}).then(() => exploreOnce(args)); // another address: wait for its turn
  const p = explore(args).finally(() => { if (running?.p === p) running = null; });
  running = { key, p };
  return p;
}
