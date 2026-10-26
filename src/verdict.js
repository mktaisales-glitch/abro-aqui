// Deterministic verdict engine — see specs/01-verdict.md.
// The LLM never decides; it explains. Every verdict carries the rule that fired.

export const LEVELS = ["RED", "AMBER", "AMBER-GREEN", "UNKNOWN"];

const ORDER = { RED: 0, AMBER: 1, "AMBER-GREEN": 2 };

function stepDown(level) {
  if (level === "AMBER-GREEN") return "AMBER";
  if (level === "AMBER") return "RED";
  return level;
}

/**
 * @param {object} inputs
 * @param {number} inputs.affinity        0–1, nearest heatmap cell
 * @param {number} inputs.affinity_rank   0–1, percentile inside the radius
 * @param {number} inputs.supply          0–1, popularity (existing offer) at the cell
 * @param {Array<{name:string,rating?:number,distance_m:number}>} inputs.competitors  same-category places within 700 m
 * @param {number} inputs.coverage        number of heatmap cells returned
 */
export function verdict(inputs) {
  const { affinity, affinity_rank, supply, competitors = [], coverage = 0 } = inputs;
  let level;
  let rule;

  if (coverage < 50) {
    level = "UNKNOWN";
    rule = `coverage ${coverage} < 50 cells: not enough Qloo data around this address`;
  } else if (affinity < 0.35) {
    level = "RED";
    rule = `affinity ${affinity.toFixed(2)} < 0.35: the area does not ask for this concept`;
  } else if (supply >= 0.8) {
    level = "AMBER";
    rule = `affinity ${affinity.toFixed(2)} but supply ${supply.toFixed(2)} ≥ 0.80: the area likes it and already has it (saturated)`;
  } else if (affinity >= 0.6 && supply <= 0.6) {
    level = "AMBER-GREEN";
    rule = `affinity ${affinity.toFixed(2)} ≥ 0.60 and supply ${supply.toFixed(2)} ≤ 0.60: appetite without offer`;
  } else {
    level = "AMBER";
    rule = `affinity ${affinity.toFixed(2)}, supply ${supply.toFixed(2)}: mixed signals`;
  }

  const adjustments = [];
  const strongNear = competitors.filter((c) => (c.rating ?? 0) >= 4.5 && c.distance_m <= 400);
  if (level !== "UNKNOWN" && strongNear.length >= 2) {
    const before = level;
    level = stepDown(level);
    adjustments.push(
      `${strongNear.length} competitors rated ≥ 4.5 within 400 m (${strongNear.map((c) => c.name).join(", ")}): ${before} → ${level}`
    );
  }

  const gap = level !== "UNKNOWN" && competitors.length === 0 && affinity >= 0.5;
  if (gap) adjustments.push("no direct competitor within 700 m and affinity ≥ 0.50: nobody offers this yet");

  return {
    level,
    rule_fired: rule,
    adjustments,
    gap,
    score: ORDER[level] ?? null,
    inputs: { affinity, affinity_rank, supply, competitors: competitors.length, coverage },
    unknowns: [
      "Foot traffic in front of the door (count it: weekday 13:00 and Saturday 18:00)",
      "Rent and licence cost versus your expected ticket",
      "Household income of the area (Qloo measures taste, not spending power)",
    ],
  };
}
