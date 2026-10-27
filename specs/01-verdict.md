# Spec 01 — The verdict (v2, 27-Oct-2026)

**Question the product answers:** "Should I open *this concept* at *this address*?"

The verdict is computed by deterministic code (`src/verdict.js`), never by the LLM. The LLM explains it; it does not decide it. The rule that fired is always shown, in English and Spanish.

## What changed from v1, and why

v1 used the heat map's `affinity` as "how much the area likes it" and `popularity` as "how much is already on offer". A review of the recorded data showed both are **ranks inside the 1.5 km circle**, spread evenly from 0 to 1 (quartiles exactly 0 / 0.25 / 0.5 / 0.75 / 1 for seafood and for ice cream). Used as thresholds, ~35 % of any area would be red by construction, and the verdict depended on where the circle was centred. Paral·lel 40 came out "Not here" for seafood while its `affinity_rank` at the nearest block was 0.95 (0.93 averaged over the blocks within 250 m, the figure v2 uses) and a seafood restaurant with 4.4★ stands 26 m away.

v2 reads the signals as follows:

| Signal | Source | Meaning in v2 |
| --- | --- | --- |
| `demand` | heat map `affinity_rank`, **mean of the cells within 250 m** (nearest cell if none) | how much the area likes the concept against a wide reference; decides |
| `local` | heat map `affinity`, same cells | rank inside the 1.5 km circle; shown as context ("beats 24 % of blocks around"), never decides |
| block activity | heat map `popularity` | rank of how busy a block is inside the circle; used only to keep the "better spot" on busy blocks |
| `offer` | direct competitors (`urn:entity:place` + category/dish tag) within 400 m and 700 m, and the share of the 50 most popular places within 500 m that already serve the concept | how much of it is already there; decides |
| `coverage` | number of heat-map cells | data sufficiency |

## Offer level

- **HIGH (well served)** if any: ≥ 3 rivals within 400 m, ≥ 6 rivals within 700 m, or ≥ 20 % of the popular places nearby already serve it.
- **LOW** if ≤ 1 rival within 700 m and < 8 % share.
- **MEDIUM** otherwise. A rival without a distance never counts as near.

## Rules (in order; first match wins)

1. `coverage < 50` or no demand value → **UNKNOWN** ("No data").
2. `demand < 0.75` → **RED** ("Not here": the area's taste leans elsewhere).
3. offer HIGH → **AMBER** ("Hard": wanted, but already well served).
4. offer LOW and `demand ≥ 0.85` → **AMBER-GREEN** ("Promising": appetite without offer).
5. otherwise → **AMBER** ("Hard": neither a clear gap nor saturation).

Adjustment: two rivals rated ≥ 4.5 within 400 m turn AMBER-GREEN into AMBER. They never push a verdict to RED: a street with excellent rivals is hard, not undesirable.

**There is no GREEN.** AMBER-GREEN becomes the owner's green only after they confirm what Qloo cannot see: foot traffic, rent and household income.

## Parts of the concept that cannot be measured

A concept can have several parts ("waffles and ice cream"). The heat map only answers to some tags, and a competitor tag only counts if it is used for places within 5 km. When a part has no usable tag, the report says so ("Qloo has no data on waffles here") and the part is **not** called a gap: missing data is not missing offer.

## Better spot nearby

Among heat-map cells 150–800 m away (so their 700 m ring fits inside the 1.5 km of rivals fetched), on busy blocks (activity ≥ 0.5) with ≥ 15 places within 200 m (parks and hillsides fail), the same rules are applied with demand = mean `affinity_rank` within 150 m and offer = rivals counted around that cell. A cell is shown only if its verdict is higher than the address's, or the same verdict with demand ≥ +0.03, at least 2 fewer rivals within 700 m and a lower offer level.

## Calibration (recorded 26–27 Oct 2026)

| Case | Demand | Offer | Verdict | Better spot |
| --- | --- | --- | --- | --- |
| Seafood restaurant, Av. Paral·lel 40 | 0.93 (beats 24 % of blocks in the circle) | HIGH: 7 rivals within 700 m, Puertecillo 4.4★ at 26 m, 13 of 50 popular places serve seafood | **Hard** (well served) | 747 m west, Poble-sec: demand 0.99, 4 rivals within 700 m |
| Waffles and ice cream, Gran Via 400 | 0.85 for ice cream; waffles not measurable (no waffle-tagged places within 5 km) | HIGH: 7 ice-cream shops within 700 m | **Hard** (well served) | 744 m east, Sant Antoni: demand 0.91, 5 rivals within 700 m |

Both businesses closed. The seafood restaurant lasted ten years; we do not claim the tool predicts closures. What the data says today: the area loves seafood and is already full of it.

## Acceptance (tests/verdict.test.js, tests/pipeline.test.js)

- [x] Paral·lel 40 + seafood → AMBER, rule `well-served`, Puertecillo first, a busier and less-served block nearby.
- [x] Gran Via 400 + waffles and ice cream → AMBER; waffles reported as not measured, not as a gap.
- [x] Low local rank with high demand is never RED; 20 rivals at 50 m is never Promising; two excellent rivals never make RED.
- [x] Missing inputs give UNKNOWN, never an exception. Every verdict has `rule_fired` and `rule_es`.

## Note on dense city centres (28-Oct-2026)
In central Barcelona the generic tag "restaurant" ranks ~0.997 on every block (it saturates: it reflects how much data an area has), while a specific concept still discriminates between neighbourhoods: seafood Barceloneta 0.996 · Poble-sec 0.993 · Gràcia 0.968 · Entença 0.956 · Paral·lel 0.952; ice cream Barceloneta 0.964 · Poble-sec 0.922 · Gràcia 0.913 · Paral·lel 0.890 · Entença 0.856. So in dense centres the RED threshold (0.75) rarely fires and the decision is carried by offer and by the better-spot comparison; the report also shows where the address stands inside its 1.5 km circle ("beats N % of blocks").
