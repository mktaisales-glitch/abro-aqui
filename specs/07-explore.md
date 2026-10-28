# Spec 07 — "I have premises: which food business fits?" and the analysed area (28-Oct-2026)

**Question:** "I have (or can rent) premises at this address. Which kind of business fits?"

Abro Aquí is for food and drink: Qloo knows restaurants, bars and cafés well and has too little data on hair salons, gyms or shops to judge them (live test: a hair salon in Sants showed 0 rivals, which is missing data, not missing offer). The same verdict rules as spec 01 run for 15 concepts at one address: seafood restaurant, pizza, ramen, sushi, burger, tapas, vegan, Mexican, Italian, brunch, coffee shop, bakery, ice cream, cocktail bar, wine bar. A concept typed in the single analysis that falls outside food and drink gets a visible note saying so. Per row: verdict, taste rank around the address (mean `affinity_rank` within 250 m), direct rivals within 700 m and the closest one. Rows are ranked Promising → Hard (neither gap nor saturation first, then well served) → Not here → No data, then by taste rank. No report, no better spot and no model call per row: opening a row runs the full analysis.

Tags for 7 concepts are fixed (checked on the live API); the rest are resolved with `/v2/tags` and cached. A concept Qloo has no tag for shows "No data" with the reason, never an error.

## Analysed area

The owner chooses 500 m, 1 km (default), 1.5 km or 2 km. The radius sets the heat map circle, the search for a better spot (within min(800 m, radius)) and the wide rival list (at least 1.5 km). The verdict rings stay at 400 m and 700 m and demand at 250 m, so a verdict does not change its meaning with the zoom; the minimum number of heat-map blocks scales with the circle's area (50 for 1.5 km, 22 for 1 km, 10 at least).

## Map

Blocks are drawn in five classes by where they stand inside the analysed circle (top 20 % … bottom 20 %), with the circle itself, a labelled address, a labelled better spot and competitors in red; each block's tooltip gives its taste rank and activity.

Acceptance: tests/explore.test.js (ranking; a concept without data is No data, not an exception).
