# Devpost submissions (drafts)

## Common fields

- **Name:** Abro Aquí: should I open here?
- **Tagline (≤ 200 chars):** Locality intelligence for the small shop owner. Tell it a business and a street address: it reads what the area likes and what it already has before you sign a lease.
- **Demo:** https://abro-aqui.onrender.com (free plan: the first visit after a quiet spell can take up to a minute)
- **Repo:** https://github.com/mktaisales-glitch/abro-aqui (MIT)
- **Built with:** Qloo Insights API, NVIDIA Nemotron (Nano, Lightning, Super), Nebius Token Factory, Tavily, Node.js, Express, Leaflet, OpenStreetMap, SQLite, zod

---

## Qloo Agentic Hackathon: description

### Inspiration
In Barcelona, two businesses we knew closed: a seafood restaurant on Avinguda del Paral·lel and a waffle-and-ice-cream shop at Gran Via and Entença. Both owners chose the address the way most small businesses do: gut feeling, a friend's opinion, a walk around the block. Big chains pay location-intelligence firms for this decision. The owner of one shop can't. Agents can now do the analyst's job, if they know what the neighbourhood actually likes. That's what Qloo knows.

### What it does
You type a concept ("seafood restaurant", "gofres y helados", "hair salon") and an address, and choose the area around it (500 m to 2 km). Or you type only the address of premises you have and ask **"what fits?"**: 14 kinds of business ranked with the same rules, from a ramen bar to a hair salon. For one concept you get:

- **A verdict**: Not here, Hard, Promising or No data. It comes from deterministic rules on Qloo signals, and the rule that fired is shown.
- **Two gauges**: how much the area likes the concept (Qloo `affinity_rank` around the address) and how much of it is already there (real rivals within 400 and 700 m, and the share of popular places that already serve it).
- **A taste heat map** block by block, and a **better spot nearby** when the same rules rate a busy block higher.
- **Direct competitors** within 700 m, with rating, price level and distance.
- **The gap**: parts of your idea nobody nearby offers, and the parts Qloo cannot measure there, said plainly.
- **The area**: among the 50 most popular places within 500 m, what they serve, who goes and when.
- **What Qloo cannot see**: foot traffic, rent and income, asked back to the owner. There is no automatic green.
- **A second-opinion agent**: one goal ("find me a better spot"); Nemotron 3.5 Lightning gets only the goal and the tools, chooses which nearby blocks to re-analyse with the same rules, and recommends moving or staying; the page lists each step with its time after the run.
- **A launch plan: where to announce the opening.** Qloo's taste graph, seeded with the best-rated rivals nearby, answers what *their* customers also like: artists for the opening night, brands to ask for sampling, nearby places that are not competitors to team up with (checked on the web), and the busiest, best-matching blocks for posters, on the map, with a 4-week plan. The model chooses among Qloo's candidates; code drops any name it invents.
- **A "what if…?" chat**: "What if I ignore Puertecillo?", "What if I move 300 m?". It calls the tools again and recomputes.
- **"Without Qloo"**: the same question answered by the LLM alone, so you can see what it invents.
- **"How I know"**: every Qloo, geocoding, Tavily and model call behind the report, failed ones included.

Live on the public demo: **ramen at 200 Schermerhorn Street, Brooklyn** comes out **Promising** (taste rank 0.92, one rival within 700 m: "People here really want ramen but almost no one serves it"), **ramen at Carrer de Sants 100, Barcelona** comes out **Not here** (0.57). On the two real Barcelona cases: the seafood restaurant at Paral·lel 40 gets **Hard**. The area loves seafood (0.93), but it is already full of it: Puertecillo (4.4★) is 26 m away, 7 seafood restaurants within 700 m, 13 of the 50 most popular places nearby serve seafood. A busy block in Poble-sec, 750 m away, likes it even more, with 4 rivals within 700 m instead of 7. The waffle-and-ice-cream shop at Gran Via 400 also gets **Hard**: 7 ice-cream shops within 700 m; and the report says plainly that Qloo has no waffle data there, instead of inventing a gap.

### Who pays
Two buyers, same verdict: the owner about to sign (one report before a lease that will cost 50,000–200,000 €), and the commercial real-estate agency that lists dozens of premises a month and can attach a verdict, a better block nearby and a launch plan to every listing (which is the recurring use). Prices we will test: 49 € / $49 per report, 199 €/month per agency. Not validated with customers yet.

### How we built it (what makes it Qloo-powered)
- `/v2/tags` resolves each part of the concept into a **genre tag** (the heat map only answers to `genre:place:restaurant:*`) and a **category or specialty-dish tag** (competitors). Candidates are scored by word overlap, so "seafood restaurant" does not resolve to "seafood donburi". If a tag returns no data and is not used within 5 km, we fall back to the next candidate.
- The `urn:heatmap` insight around the address gives, per block, `affinity_rank` (demand against a wide reference, averaged within 250 m), and `affinity`/`popularity`, which are ranks inside the 1.5 km circle: we use them as context and to keep the better spot on busy blocks, never to decide.
- The `urn:entity:place` insight with the category tag within 700 m gives competitors; within 1.5 km it gives the rivals used to judge every alternative block with the same rules; within 200 m it tells a shopping street from a park.
- Seeded with the entity ids of the best-rated rivals (`signal.interests.entities`), the insights for `urn:entity:artist`, `urn:entity:brand` and `urn:entity:place` (600 m) build the launch plan: cross-domain taste from the customers of the places that already win on that street.
- Without tags, within 500 m, it gives the 50 most popular places, whose cuisine, category, customer-identity and time-of-day tags become the area profile and the share of places that already serve the concept.
- The verdict is deterministic and specified in `specs/01-verdict.md`, which documents how we corrected our first reading of the heat map. The LLM explains; it never decides.
- Spec-driven: seven spec files, 32 tests (verdict rules, the two recorded cases end to end, LLM wiring and JSON extraction, launch-plan selection against a Qloo mock, Qloo rate limiting, the scout's fallback, personal-data scrub; the 6 that replay recorded Qloo responses skip on a public clone because recordings are not published), offline replay of recorded Qloo responses.

### Responsible use
The agent decides about places, never people. E-mails and phone numbers typed by users are removed before any model or search call. Customer-identity labels that touch protected attributes are filtered out of the audience panel. In the launch plan no place is excluded for who its customers are. Thin-data areas get "No data" rather than a guess, and we document that this favours data-rich areas. It is not for housing, employment or credit decisions. It says what it cannot see.

### What's next
A backtest on openings and closures with known outcomes, counted as it comes out; talk to five owners and two agencies in Barcelona before setting prices.

---

## Nebius x NVIDIA Global AI Hackathon: description (track: Best Apps and Agents)

Same "Inspiration" and "What it does" as above, then:

### How we use NVIDIA Nemotron on Nebius Token Factory
One OpenAI-compatible endpoint, three models, each picked for its task:
- **Nemotron 3 Nano 30B** (JSON mode) turns a free-text concept in any language into English parts Qloo can match: "gofres y helados" → `["waffles","ice cream"]` in 1.5 s.
- **Nemotron 3.5 Lightning** runs the "what if…?" agent with native tool calling (`nearby_competitors`, `analyse_address`, `zone_profile`, `verify_business`). It decides which tool to call and with which arguments in about 0.7 s, and one question can chain several calls.
- **Nemotron 3.5 Lightning** also runs the **second-opinion agent**: given only a goal and the tools, it decides which to call and in which order (typically `candidate_spots` → `analyse_address` on two or three blocks → `zone_profile`), listed after the run with think and tool times; if the model fails, a fixed sequence of the same tools runs and the page says so.
- **Nemotron 3 Super 120B** writes the report from the structured signals and chooses the launch plan among Qloo's candidates, as JSON validated with zod, with one repair round; names that did not come from Qloo are dropped by code, and the headline and the week-by-week plan are written by code from the names that survive.

The multi-step workflow is geocode → concept to tags → heat map + competitors + area profile in parallel → deterministic verdict → Nemotron report → tool-calling chat. A daily cap on model calls keeps the public demo within its credits. **Tavily** checks every launch partner the writer proposes before it is shown, and the chat agent calls it on its own when the owner asks about a business.

### Feedback
See `FEEDBACK.md` in the repo: what worked (first-try tool calling, JSON mode, model-per-task) and six concrete onboarding frictions (card wall before the first key, top-up dialog defaulting to card, the post-trial default, model-id casing).
