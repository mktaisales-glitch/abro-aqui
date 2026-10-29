# Spec 08 — Downloadable report (PDF) (28-Oct-2026)

**Question:** "Give me the analysis of this address on paper, so I can keep it or show it to my partner, my bank or the landlord."

After an analysis, **Download report (PDF)** (`GET /api/report.pdf?id=<analysis id>&lang=en|es`) returns an A4 PDF built from what the session already holds: no new call to Qloo or the model. The only outside request is the OpenStreetMap tiles under the map (cached, 4 s timeout; a plain box if they do not answer), credited "© OpenStreetMap contributors" under the map.

| Section | Source |
| --- | --- |
| Idea, full geocoded address, analysed area, coordinates | the analysis |
| Verdict in its colour, headline, the rule that fired | spec 01 verdict + report |
| Three facts: taste in words and number, rivals within 700 m (and 400 m), distance to a better spot | same numbers as the screen |
| Map | drawn from the heat-map cells (five classes inside the circle, as on screen), the address, rivals, the better spot, over faded OpenStreetMap streets with their attribution |
| Direct competitors (top 8: distance, rating, price) | the analysis |
| Why, what to do, who goes out, what the data cannot see | the report (model or template) |
| The agent's recommendation and its model line | only if "Find a better spot" was run in this session |
| Opening plan (music, neighbours, brands, posters, four weeks) | only if "Plan the opening" was run |
| How we know + the use limits | trace counts, model name, the footer text of the app |

Labels follow `lang`; the analysis text stays in the language it was written in. The fonts are the app's own (Montserrat, Michroma); characters they lack fall back to plain letters. File name: `open-here-<concept>-<street>.pdf`, ASCII only. Analyses expire after 2 hours, then the route answers 404 with a clear message; 60 reports per visitor per day.

`scripts/report-from-json.js` renders the same PDF from a saved `/api/analyze` response.

Acceptance: tests/report.test.js (a PDF with the address, optional sections, Spanish labels, safe file name and text) and tests/server.test.js (unknown id → 404).


v2 (28-Oct): the address is shown short (`shortAddress`: "Rambla del Poblenou 100, el Poblenou, Barcelona", the geocoder's full name below it in grey); the better spot says exactly why (`betterSpotWhy`); verdict codes in model-written text are replaced by the page's words; the closing line says the verdict, facts, map and competitors come from code and Qloo, and the text from the model.
