# Spec 04 — Launch plan: where to announce the opening (28-Oct-2026)

**Question:** "I am opening here. Where do I announce it, and with whom?"

## Signal

The seeds are the **best-rated direct competitors nearby that Qloo knows by id** (up to 3, from the analysis). They are the places that already win with this concept on this street, so their customers are the audience the new shop wants. Qloo's taste graph is asked what those customers also like in other domains (`signal.interests.entities` = the seeds). If no rated rival has an id, the concept's own tag is the signal (`signal.interests.tags`), and the page says which signal was used.

| Section | Qloo call | Selection (deterministic) |
| --- | --- | --- |
| Music for the opening | `urn:entity:artist`, seeds + `signal.location` (3 km) | top 8 by affinity |
| Brands to ask for sampling | `urn:entity:brand`, seeds + `signal.location` | top 10; rivals never proposed |
| Neighbours to team up with | `urn:entity:place` within 600 m of the spot, seeds | drop rivals, places carrying the concept's tags or words, closed places, and sensitive kinds (places of worship, clinics, schools, banks…); then checked on the web with Tavily (not found → dropped) |
| Posters and flyers | none (the analysis' heat map) | blocks 120–900 m away with activity ≥ 0.6, ranked by taste rank × activity, at least 300 m apart; street name from OpenStreetMap |

## The model chooses, it never invents

Nemotron 3 Super receives the candidates and returns up to 3 per section with a concrete idea each, plus a 4-week plan (week −2, week −1, opening week, week +1 = measure which channel worked). Code keeps only names that are in the candidate lists (`keepKnown`); a section the model leaves empty is filled from the template. Poster coordinates always come from the heat map. Without the model, fixed rules produce the same structure.

## Acceptance (tests/launch.test.js, tests/launch-llm.test.js)

- [x] Seeds = best-rated rivals with a Qloo id; fallback to the concept tag; no signal → no call.
- [x] Neighbours exclude rivals, same-concept places, closed and sensitive places.
- [x] Poster zones are busy, liked, ≥ 300 m apart and never the shop's own block.
- [x] Invented names from the model are dropped; empty sections are filled from the candidates.
- [x] Three Qloo calls per plan, all with the seed signal; the places call is limited to 600 m.

## Limits

Qloo knows audiences of places, not individual people; the plan is a starting point to test in the opening week, which is why the last step is to count which channel brought people.
