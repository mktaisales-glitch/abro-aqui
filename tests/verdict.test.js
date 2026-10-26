import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict } from "../src/verdict.js";

// Real signals captured from the Qloo hackathon API on 26-Oct-2026 (see specs/01-verdict.md).

test("Paral·lel 40 + seafood → RED (area does not ask for it)", () => {
  const v = verdict({
    affinity: 0.19,
    affinity_rank: 0.92,
    supply: 0.29,
    competitors: [
      { name: "Puertecillo Paral·lel", rating: 4.4, distance_m: 350 },
      { name: "Lascar 74", rating: 4.6, distance_m: 520 },
      { name: "Can Eusebio", rating: 3.1, distance_m: 600 },
    ],
    coverage: 180,
  });
  assert.equal(v.level, "RED");
  assert.match(v.rule_fired, /affinity 0.19 < 0.35/);
  assert.equal(v.gap, false);
});

test("Gran Via / Entença + ice cream → AMBER-GREEN (appetite without offer), then stays because strong competitors are > 400 m", () => {
  const v = verdict({
    affinity: 0.73,
    affinity_rank: 0.89,
    supply: 0.55,
    competitors: [
      { name: "GELATOMANIA", rating: 4.8, distance_m: 650 },
      { name: "Turín Gelato", rating: 4.6, distance_m: 480 },
      { name: "Gelati Dino", rating: 4.6, distance_m: 690 },
      { name: "Farggi", rating: 3.8, distance_m: 300 },
    ],
    coverage: 355,
  });
  assert.equal(v.level, "AMBER-GREEN");
  assert.equal(v.unknowns.length, 3);
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
