// Deterministic verdict engine — see specs/01-verdict.md (v2).
// The LLM never decides; it explains. Every verdict carries the rule that fired.
//
// How we read Qloo's heat map (checked on recorded data, 27-Oct-2026):
//   - `affinity` and `popularity` are ranks INSIDE the 1.5 km circle, spread evenly from 0 to 1.
//     Used alone, they would mark ~35 % of any area red by construction, so they never decide.
//   - `affinity_rank` compares the block with a much wider reference. That is the demand signal.
//   - Offer is measured with real places: direct competitors around the point and the share of the
//     area's most popular places that already serve the concept.

export const LEVELS = ["RED", "AMBER", "AMBER-GREEN", "UNKNOWN"];
const ORDER = { RED: 0, AMBER: 1, "AMBER-GREEN": 2 };

export const T = {
  coverage: 50, // fewer heat-map cells → UNKNOWN
  demandWeak: 0.75, // affinity_rank below → RED
  demandStrong: 0.85, // affinity_rank at or above (with little offer) → AMBER-GREEN
  near: 400, // metres
  far: 700,
  highNear: 3, // ≥ 3 rivals within 400 m → well served
  highFar: 6, // ≥ 6 rivals within 700 m → well served
  highShare: 0.2, // ≥ 20 % of the popular places nearby already serve it → well served
  lowShare: 0.08,
  strongRating: 4.5,
};

const near = (c, m) => typeof c.distance_m === "number" && c.distance_m <= m;

/** How much of the concept is already on offer around a point. */
export function offer({ competitors = [], share = null }) {
  const c400 = competitors.filter((c) => near(c, T.near)).length;
  const c700 = competitors.filter((c) => near(c, T.far)).length;
  const strong = competitors.filter((c) => near(c, T.near) && (c.rating ?? 0) >= T.strongRating);
  const why = [], why_es = [];
  if (c400 >= T.highNear) { why.push(`${c400} rivals within ${T.near} m`); why_es.push(`${c400} rivales a menos de ${T.near} m`); }
  if (c700 >= T.highFar) { why.push(`${c700} rivals within ${T.far} m`); why_es.push(`${c700} rivales a menos de ${T.far} m`); }
  if (share != null && share >= T.highShare) { why.push(`${Math.round(share * 100)} % of the popular places nearby already serve it`); why_es.push(`el ${Math.round(share * 100)} % de los locales populares cercanos ya lo sirven`); }
  let level = "MEDIUM";
  if (why.length) level = "HIGH";
  else if (c700 <= 1 && (share == null || share < T.lowShare)) level = "LOW";
  return { level, c400, c700, strong_near: strong.map((c) => c.name), share, why, why_es };
}

/**
 * @param {object} i
 * @param {number} i.demand        Qloo affinity_rank around the address (mean of cells within 250 m), 0–1
 * @param {number} [i.local]       Qloo affinity around the address, relative to the 1.5 km circle (context only)
 * @param {Array<{name:string,rating?:number,distance_m:number}>} i.competitors  direct rivals
 * @param {number|null} [i.share]  fraction of the 50 most popular places within 500 m that already serve it
 * @param {number} i.coverage      heat-map cells returned
 */
export function verdict(i) {
  const demand = Number.isFinite(i.demand) ? i.demand : null;
  const coverage = i.coverage ?? 0;
  const o = offer({ competitors: i.competitors ?? [], share: i.share ?? null });
  const d2 = demand?.toFixed(2);
  const dec = (x) => String(x).replace(".", ","); // Spanish decimal comma
  let level, rule, code, es;

  if (coverage < T.coverage || demand == null) {
    level = "UNKNOWN";
    code = "no-data";
    rule = `Only ${coverage} heat-map blocks around this address (minimum ${T.coverage}): not enough Qloo data to judge.`;
    es = `Solo hay ${coverage} manzanas en el mapa de calor (mínimo ${T.coverage}): no hay datos de Qloo suficientes.`;
  } else if (demand < T.demandWeak) {
    level = "RED";
    code = "weak-demand";
    rule = `Taste for this concept here ranks ${d2} on Qloo's scale, below ${T.demandWeak}: the area leans elsewhere.`;
    es = `El gusto por este concepto aquí puntúa ${dec(d2)} en la escala de Qloo, por debajo de ${dec(T.demandWeak)}: la zona va por otro lado.`;
  } else if (o.level === "HIGH") {
    level = "AMBER";
    code = "well-served";
    rule = `The area wants it (rank ${d2}) but is already well served: ${o.why.join("; ")}.`;
    es = `La zona lo quiere (${dec(d2)}) pero ya está bien servida: ${o.why_es.join("; ")}.`;
  } else if (o.level === "LOW" && demand >= T.demandStrong) {
    level = "AMBER-GREEN";
    code = "appetite-without-offer";
    rule = `Strong taste for it (rank ${d2} ≥ ${T.demandStrong}) and little offer (${o.c700} rivals within ${T.far} m): appetite without offer.`;
    es = `Mucho gusto por ello (${dec(d2)} ≥ ${dec(T.demandStrong)}) y poca oferta (${o.c700} rivales a ${T.far} m): apetito sin oferta.`;
  } else {
    level = "AMBER";
    code = "mixed";
    rule = `Taste rank ${d2} with ${o.c700} rivals within ${T.far} m: neither a clear gap nor saturation.`;
    es = `Gusto ${dec(d2)} con ${o.c700} rivales a ${T.far} m: ni hueco claro ni saturación.`;
  }

  const adjustments = [], adjustments_es = [];
  if (level === "AMBER-GREEN" && o.strong_near.length >= 2) {
    level = "AMBER";
    adjustments.push(`${o.strong_near.length} rivals rated ≥ ${T.strongRating} within ${T.near} m (${o.strong_near.join(", ")}): Promising → Hard`);
    adjustments_es.push(`${o.strong_near.length} rivales con ≥ ${dec(T.strongRating)} a menos de ${T.near} m (${o.strong_near.join(", ")}): Prometedor → Difícil`);
  }

  return {
    level,
    rule_code: code,
    rule_fired: rule,
    rule_es: es,
    adjustments,
    adjustments_es,
    gap: false,
    score: ORDER[level] ?? null,
    offer: o,
    inputs: { demand, local: i.local ?? null, competitors: (i.competitors ?? []).length, share: i.share ?? null, coverage },
    thresholds: T,
    unknowns: [
      "Foot traffic in front of the door (count it: weekday 13:00 and Saturday 18:00)",
      "Rent and licence cost versus your expected ticket",
      "Household income of the area (Qloo measures taste, not spending power)",
    ],
  };
}
