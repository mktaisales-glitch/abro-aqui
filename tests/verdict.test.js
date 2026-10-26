import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict } from "../src/verdict.js";

// Real signals captured from the Qloo hackathon API on 26-Oct-2026 (see specs/01-verdict.md).

// Real signals recorded from the Qloo hackathon API on 26-Oct-2026 (nearest heat-map cell to the address).

test("Paral·lel 40 + seafood restaurant → RED (affinity 0.29: the area does not ask for it)", () => {
  const v = verdict({
    affinity: 0.289,
    affinity_rank: 0.952,
    supply: 0.533,
    competitors: [
      { name: "Puertecillo Paral·lel", rating: 4.4, distance_m: 60 },
      { name: "Can Eusebio", rating: 3.1, distance_m: 380 },
      { name: "Lascar 74", rating: 4.6, distance_m: 630 },
      { name: "Restaurant Can Costa", rating: 3.3, distance_m: 410 },
      { name: "Los Caracoles", rating: 4.3, distance_m: 650 },
      { name: "Colom Restaurant", rating: 4.7, distance_m: 660 },
      { name: "Kubik Restaurant", rating: 1.9, distance_m: 560 },
    ],
    coverage: 316,
  });
  assert.equal(v.level, "RED");
  assert.match(v.rule_fired, /affinity 0.29 < 0.35/);
});

test("Gran Via 400 (Entença) + waffles & ice cream → AMBER (mixed: 0.52 affinity, 0.49 supply, 7 ice-cream shops)", () => {
  const v = verdict({
    affinity: 0.52,
    affinity_rank: 0.86,
    supply: 0.49,
    competitors: [
      { name: "GELATOMANIA", rating: 4.8, distance_m: 370 },
      { name: "Farggi", rating: 3.8, distance_m: 490 },
      { name: "Gelati Dino", rating: 4.6, distance_m: 480 },
      { name: "Gelateria i Cafeteria Bonastre", rating: 3.6, distance_m: 360 },
      { name: "Turín", rating: 4.8, distance_m: 700 },
      { name: "La Merenda", rating: 4.5, distance_m: 520 },
      { name: "Turín Gelato / Empanadas Argentinas", rating: 4.6, distance_m: 690 },
    ],
    coverage: 355,
  });
  assert.equal(v.level, "AMBER");
  assert.equal(v.unknowns.length, 3);
});

test("appetite without offer → AMBER-GREEN", () => {
  const v = verdict({ affinity: 0.73, affinity_rank: 0.89, supply: 0.55, competitors: [{ name: "X", rating: 4.0, distance_m: 600 }], coverage: 355 });
  assert.equal(v.level, "AMBER-GREEN");
});

test("two strong competitors within 400 m step the verdict down", () => {
  const v = verdict({
    affinity: 0.73,
    affinity_rank: 0.89,
    supply: 0.55,
    competitors: [
      { name: "A", rating: 4.8, distance_m: 120 },
      { name: "B", rating: 4.6, distance_m: 300 },
    ],
    coverage: 355,
  });
  assert.equal(v.level, "AMBER");
  assert.equal(v.adjustments.length, 1);
});

test("waffles with zero competitors and affinity ≥ 0.5 flags the gap", () => {
  const v = verdict({ affinity: 0.73, affinity_rank: 0.89, supply: 0.55, competitors: [], coverage: 355 });
  assert.equal(v.level, "AMBER-GREEN");
  assert.equal(v.gap, true);
});

test("saturated area → AMBER", () => {
  const v = verdict({ affinity: 0.99, affinity_rank: 0.99, supply: 0.96, competitors: [], coverage: 400 });
  assert.equal(v.level, "AMBER");
  assert.match(v.rule_fired, /saturated/);
});

test("too few cells → UNKNOWN", () => {
  const v = verdict({ affinity: 0.9, affinity_rank: 0.9, supply: 0.1, competitors: [], coverage: 12 });
  assert.equal(v.level, "UNKNOWN");
});

test("there is never a GREEN", () => {
  for (const a of [0.5, 0.7, 0.9, 1]) for (const s of [0, 0.3, 0.6]) assert.notEqual(verdict({ affinity: a, affinity_rank: 0.9, supply: s, competitors: [], coverage: 100 }).level, "GREEN");
});
