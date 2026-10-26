# Spec 01 — The verdict

**Question the product answers:** "Should I open *this concept* at *this address*?"

The verdict is computed by deterministic code, never by the LLM. The LLM explains it; it does not decide it. The rule that fired is always shown to the user.

## Inputs (all from Qloo, all aggregated, no personal data)

| Signal | Source | Range |
| --- | --- | --- |
| `affinity` — how much the area likes this concept | `/v2/insights` `filter.type=urn:heatmap`, nearest cell to the address | 0–1 |
| `affinity_rank` — percentile of that cell inside the 1.5 km radius | same call | 0–1 |
| `supply` — existing popularity/offer of the concept at the cell | same call, `popularity` | 0–1 |
| `competitors` — same-category places within 700 m | `/v2/insights` `filter.type=urn:entity:place` + category tag + radius | list with rating, price level, distance |
| `gap` — related categories with high affinity and no supply | derived: zone taste tags minus categories present | list |
| `coverage` — number of heatmap cells returned | same call | integer |

## Rules (applied in order; first match wins)

1. `coverage < 50` → **UNKNOWN** ("not enough data here").
2. `affinity < 0.35` → **RED** ("the area does not ask for this").
3. `affinity ≥ 0.35` and `supply ≥ 0.80` → **AMBER** ("saturated: the area likes it and already has it").
4. `affinity ≥ 0.60` and `supply ≤ 0.60` → **AMBER-GREEN** ("appetite without offer").
5. otherwise → **AMBER**.

Adjustments after the base rule:

- Two or more direct competitors with rating ≥ 4.5 within 400 m → one step down (AMBER-GREEN → AMBER, AMBER → RED).
- Zero direct competitors within 700 m and `affinity ≥ 0.5` → flag `gap: true` (shown as "nobody offers this yet").

**There is no GREEN.** The best verdict is AMBER-GREEN, which turns into the owner's green only after they confirm three facts Qloo cannot see: foot traffic, rent, and household income. The report asks those three questions explicitly.

## Calibration (recorded 26-Oct-2026, nearest heat-map block)

- Seafood restaurant, Av. Paral·lel 40 → affinity 0.29, supply 0.53, 7 competitors, 13/50 popular places serve seafood → **RED**. The business closed after 10 years; consistent with the area today, not claimed as a prediction.
- Waffles & ice cream, Gran Via 400 / Entença → affinity 0.52, supply 0.49, 7 ice-cream shops within 700 m, 0 waffle places → **AMBER** + gap "waffles" + best block 275 m away (0.92). The business closed.
- An earlier manual test placed the Entença point 400 m off (near Plaça d'Espanya) and read 0.73; the recorded value at the real corner is 0.52.

## Acceptance

- [x] Paral·lel 40 + seafood returns RED.
- [x] Gran Via 400 + waffles and ice cream returns AMBER with gap = waffles and a better block nearby.
- [ ] The response includes `rule_fired` (string) and `inputs` (the six signals above).
