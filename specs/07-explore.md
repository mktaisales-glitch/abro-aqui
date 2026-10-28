# Spec 07 — "I have premises: what fits?" and the analysed area (28-Oct-2026)

**Question:** "I have (or can rent) premises at this address. Which kind of business fits?"

The same verdict rules as spec 01 run for 14 kinds of business at one address: seafood restaurant, pizza, ramen, sushi, burger, vegan restaurant, coffee shop, bakery, ice cream, cocktail bar, hair salon, gym, bookstore, supermarket. Per row: verdict, taste rank around the address (mean `affinity_rank` within 250 m), direct rivals within 700 m and the closest one. Rows are ranked Promising → Hard (neither gap nor saturation first, then well served) → Not here → No data, then by taste rank. No report, no better spot and no model call per row: opening a row runs the full analysis.

Tags for 7 concepts are fixed (checked on the live API); the rest are resolved with `/v2/tags` and cached. A concept Qloo has no tag for (bookstore, supermarket in our tests) shows "No data" with the reason, never an error. Qloo knows food and drink places best; the page says that rows for hair salons, gyms or shops rest on thinner data.

## Analysed area

The owner chooses 500 m, 1 km (default), 1.5 km or 2 km. The radius sets the heat map circle, the search for a better spot (within min(800 m, radius)) and the wide rival list (at least 1.5 km). The verdict rings stay at 400 m and 700 m and demand at 250 m, so a verdict does not change its meaning with the zoom; the minimum number of heat-map blocks scales with the circle's area (50 for 1.5 km, 22 for 1 km, 10 at least).

## Map

Blocks are drawn in five classes by where they stand inside the analysed circle (top 20 % … bottom 20 %), with the circle itself, a labelled address, a labelled better spot and competitors in red; each block's tooltip gives its taste rank and activity.

Acceptance: tests/explore.test.js (ranking; a concept without data is No data, not an exception).
