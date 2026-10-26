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

## Calibration

Calibrated on two real closures in Barcelona (October 2026):

- Seafood restaurant, Av. Paral·lel 40 → affinity 0.19 → RED. Closed after 10 years (the closure is consistent with the area's shift to tapas/vermouth; it is not claimed as a prediction).
- Waffles & ice cream, Gran Via / Entença → affinity 0.73, supply 0.55, 4 ice-cream shops within 700 m → AMBER-GREEN with the three open questions. Closed. The three questions (traffic, rent, income) are exactly what the data did not cover.

## Acceptance

- [ ] Paral·lel 40 + seafood returns RED and names the best alternative zone within 2 km.
- [ ] Gran Via/Entença + waffles returns AMBER-GREEN with `gap: true` for waffles and the three open questions.
- [ ] The response includes `rule_fired` (string) and `inputs` (the six signals above).
