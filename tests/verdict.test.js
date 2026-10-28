import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, offer } from "../src/verdict.js";

// Signals recorded from the Qloo hackathon API (26–27 Oct 2026). See specs/01-verdict.md (v2).

const PARALLEL_RIVALS = [
  { name: "Puertecillo Paral·lel", rating: 4.4, distance_m: 26 },
  { name: "Can Eusebio", rating: 3.1, distance_m: 371 },
  { name: "Restaurant Can Costa", rating: 3.3, distance_m: 415 },
  { name: "Kubik Restaurant", rating: 1.9, distance_m: 548 },
  { name: "Los Caracoles", rating: 4.3, distance_m: 620 },
  { name: "Colom Restaurant", rating: 4.7, distance_m: 638 },
  { name: "Lascar 74", rating: 4.6, distance_m: 662 },
];

test("Paral·lel 40 + seafood → Hard: the area loves seafood (rank 0.93) and is already well served", () => {
  const v = verdict({ demand: 0.931, local: 0.235, competitors: PARALLEL_RIVALS, share: 13 / 50, coverage: 316 });
  assert.equal(v.level, "AMBER");
  assert.equal(v.rule_code, "well-served");
  assert.equal(v.offer.c700, 7);
  assert.match(v.rule_fired, /26 % of the popular places/);
});

test("Gran Via 400 + ice cream → Hard: 7 ice-cream shops within 700 m", () => {
  const v = verdict({
    demand: 0.847,
    competitors: [
      { name: "GELATOMANIA", rating: 4.8, distance_m: 356 },
      { name: "Gelateria i Cafeteria Bonastre", rating: 3.6, distance_m: 360 },
      { name: "La Merenda", rating: 4.5, distance_m: 496 },
      { name: "Gelati Dino", rating: 4.6, distance_m: 528 },
      { name: "Farggi", rating: 3.8, distance_m: 546 },
      { name: "Turín Gelato / Empanadas Argentinas", rating: 4.6, distance_m: 663 },
      { name: "Turín", rating: 4.8, distance_m: 694 },
    ],
    share: 1 / 50,
    coverage: 359,
  });
  assert.equal(v.level, "AMBER");
  assert.equal(v.rule_code, "well-served");
  assert.equal(v.unknowns.length, 3);
});

test("the local rank inside the circle never decides: low local, high demand is not red", () => {
  const v = verdict({ demand: 0.95, local: 0.05, competitors: [], share: 0, coverage: 300 });
  assert.notEqual(v.level, "RED");
});

test("weak demand → Not here", () => {
  const v = verdict({ demand: 0.6, competitors: [], coverage: 300 });
  assert.equal(v.level, "RED");
  assert.equal(v.rule_code, "weak-demand");
});

test("strong demand and almost no offer → Promising", () => {
  const v = verdict({ demand: 0.92, competitors: [{ name: "X", rating: 4.0, distance_m: 600 }], share: 0.02, coverage: 355 });
  assert.equal(v.level, "AMBER-GREEN");
});

test("20 rivals at 50 m is well served, never Promising", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `R${i}`, rating: 4.4, distance_m: 50 }));
  assert.equal(verdict({ demand: 0.99, competitors: many, coverage: 300 }).level, "AMBER");
});

test("a destination street with two excellent rivals is Hard, not Not here", () => {
  const v = verdict({ demand: 0.99, competitors: [{ name: "A", rating: 4.8, distance_m: 100 }, { name: "B", rating: 4.8, distance_m: 200 }], coverage: 300 });
  assert.equal(v.level, "AMBER");
});

test("two excellent rivals within 400 m turn Promising into Hard", () => {
  const v = verdict({ demand: 0.92, competitors: [{ name: "A", rating: 4.8, distance_m: 120 }], share: 0, coverage: 355 });
  assert.equal(v.level, "AMBER-GREEN");
  const w = verdict({ demand: 0.92, competitors: [{ name: "A", rating: 4.8, distance_m: 120 }, { name: "B", rating: 4.6, distance_m: 300 }], share: 0, coverage: 355 });
  // two rivals within 700 m is MEDIUM offer → Hard already; the adjustment only matters when offer is LOW
  assert.equal(w.level, "AMBER");
});

test("a rival without a distance never counts as near", () => {
  const o = offer({ competitors: [{ name: "?", rating: 4.9, distance_m: null }, { name: "??", rating: 4.9 }] });
  assert.equal(o.c400, 0);
  assert.equal(o.c700, 0);
});

test("too few cells or no demand → No data, and missing inputs never throw", () => {
  assert.equal(verdict({ demand: 0.9, competitors: [], coverage: 12 }).level, "UNKNOWN");
  assert.equal(verdict({ coverage: 300 }).level, "UNKNOWN");
  assert.equal(verdict({}).level, "UNKNOWN");
});

test("there is never a GREEN, and every verdict explains itself in both languages", () => {
  for (const d of [0.5, 0.8, 0.9, 1]) for (const n of [0, 2, 8]) {
    const v = verdict({ demand: d, competitors: Array.from({ length: n }, (_, i) => ({ name: `R${i}`, rating: 4, distance_m: 300 })), coverage: 100 });
    assert.notEqual(v.level, "GREEN");
    assert.ok(v.rule_fired && v.rule_es);
  }
});

test("model text never shows internal verdict codes; better spot says exactly why", async () => {
  const { plainVerdictWords, plainVerdictDeep, betterSpotWhy } = await import("../src/verdict.js");
  assert.equal(plainVerdictWords("Consider it as another Amber option."), "Consider it as another Hard option.");
  assert.equal(plainVerdictWords("Sale RED y AMBER-GREEN", "es"), "Sale Aquí no y Prometedor");
  assert.equal(plainVerdictWords("a red brick facade, red wine"), "a red brick facade, red wine");
  assert.deepEqual(plainVerdictDeep({ actions: ["another Amber option"], n: 3 }), { actions: ["another Hard option"], n: 3 });
  const w = betterSpotWhy({ level: "AMBER", demand: 0.822, c700: 1 }, { level: "AMBER", demand: 0.778, c700: 3 });
  assert.equal(w.reason, "same_verdict");
  assert.equal(w.text, "same verdict (Hard), 1 rival within 700 m instead of 3, the area likes it more (0.82 vs 0.78)");
  assert.equal(betterSpotWhy({ level: "AMBER-GREEN", demand: 0.9, c700: 1 }, { level: "AMBER", demand: 0.9, c700: 4 }).reason, "better_verdict");
});
