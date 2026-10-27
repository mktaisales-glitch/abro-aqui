# Abro Aquí: *should I open here?*

![Abro Aquí: seafood restaurant at Av. del Paral·lel 40, Barcelona](docs/screenshot-paralel.png)

A small-business owner is about to sign a lease. Abro Aquí shows them, with reasons, what the data says about **this concept** at **this street address** before they spend 50,000–200,000 € finding out: how much the area likes it, how much of it is already there, and a better block nearby if there is one.

Type `seafood restaurant` and `Avinguda del Paral·lel 40, Barcelona`. You get:

- **A verdict**: Not here, Hard, Promising, or No data. The exact rule that produced it is one click away.
- **What the area says**: how much the area likes the concept (Qloo `affinity_rank` around the address) and how much of it is already there (real rivals within 400 and 700 m, and the share of popular places that already serve it), drawn on two gauges with the rule's thresholds.
- **A taste heat map** of the concept around the address, block by block, with a **better spot nearby** when the same rules rate one higher (busy blocks only).
- **The real competitors** within 700 m, with rating, price level and distance.
- **The gap**: parts of your idea nobody nearby offers, and parts Qloo cannot measure there (said as such, never passed off as a gap).
- **The area**: among the 50 most popular places within 500 m, what they serve, who goes and when.
- **What to do**: positioning, opening hours and where to move.
- **What Qloo cannot see**: foot traffic, rent and income. The owner answers these three, and only then does "Promising" become a green light.
- **"What if…?" chat**: "What if I ignore Puertecillo?", "What about Carrer de Blai?". The agent calls the tools again and recomputes the verdict.
- **"Without Qloo"**: the same question answered by the language model alone, so you can see what it makes up.
- **"How I know"**: every Qloo, geocoding and Tavily call behind the report (failed ones too) and every model call with its time, without the key.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) and the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/) (October 2026) by [MarketingAiSales](https://marketingaisales.com).

## Why it only works with Qloo

The verdict is computed from Qloo signals. Without them, a language model guesses the neighbourhood and invents competitors (see the "Without Qloo" tab).

| Qloo call | What we take from it |
| --- | --- |
| `GET /v2/tags` (genre, category and specialty-dish types) | candidate tags for each part of the concept, scored by word overlap |
| `GET /v2/insights?filter.type=urn:heatmap&filter.location=POINT(lon lat)&filter.location.radius=1500&signal.interests.tags=<genre tag>` | affinity, affinity rank and popularity (supply) per block; nearest block and best block with room left |
| `GET /v2/insights?filter.type=urn:entity:place&filter.location=…&filter.location.radius=700&filter.tags=<category or dish tag>` | direct competitors: name, `business_rating`, `price_level`, coordinates, `is_closed` |
| `GET /v2/insights?filter.type=urn:entity:place&filter.location=…&filter.location.radius=500&take=50` | the 50 most popular places nearby; their cuisine, category, customer-identity and time-of-day tags make the area profile |
| `GET /v2/insights?…&filter.location.radius=5000&take=1` | checks whether a tag is actually used nearby before trusting an empty competitor list |

Everything Qloo returns is aggregated and about places. The key stays on the server, and responses are cached for 24 hours.

## How the verdict is decided

The verdict comes from deterministic code (`src/verdict.js`), specified in [`specs/01-verdict.md`](specs/01-verdict.md). The language model explains the verdict; it never decides it.

How we read Qloo's heat map: `affinity` and `popularity` are ranks **inside** the 1.5 km circle (evenly spread from 0 to 1), so they never decide on their own. Demand is `affinity_rank`, averaged over the blocks within 250 m. Offer is counted with real places.

1. fewer than 50 heat-map blocks → **No data**
2. demand < 0.75 → **Not here** (the area's taste leans elsewhere)
3. well served (≥ 3 rivals within 400 m, ≥ 6 within 700 m, or ≥ 20 % of the popular places nearby already serve it) → **Hard**
4. demand ≥ 0.85 and almost no offer (≤ 1 rival within 700 m) → **Promising**
5. otherwise → **Hard**. Two rivals rated 4.5 or more within 400 m turn Promising into Hard.

There is no automatic green, because Qloo measures taste and offer, not foot traffic, rent or income.

### Two real Barcelona cases (recorded 26–27 Oct 2026)

Both businesses below closed. We do not claim the tool would have predicted it: the seafood restaurant lasted ten years, and businesses close for reasons no taste data can see. What we show is what the data says *today* about opening the same concept at the same address.

| Case | What Qloo says | Verdict |
| --- | --- | --- |
| Seafood restaurant, Av. del Paral·lel 40 | the area **loves** seafood (demand 0.93), but it is **well served**: Puertecillo Paral·lel (4.4★) is 26 m away, 7 seafood restaurants within 700 m, and **13 of the 50** most popular places within 500 m already serve seafood. A busy block in Poble-sec, 750 m west, likes it even more (0.99) with 4 rivals | **Hard**, with a better spot nearby |
| Waffles and ice cream, Gran Via 400 (corner of Entença) | demand for ice cream 0.85; **7 ice-cream shops** within 700 m (Gelatomania 4.8★ at 356 m). Waffles **cannot be measured**: Qloo has no waffle-tagged place within 5 km, and the report says so instead of calling it a gap | **Hard** |

## NVIDIA Nemotron on Nebius Token Factory

Three models, one OpenAI-compatible endpoint (`https://api.tokenfactory.nebius.com/v1/`), each picked for its job:

| Task | Model | Why |
| --- | --- | --- |
| Turn a free-text concept in any language into English parts Qloo can match ("gofres y helados" → `["waffles","ice cream"]`) | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, JSON mode | tiny, cheap, 1.5 s |
| "What if…?" chat with **tool calling**: `nearby_competitors`, `analyse_address`, `zone_profile`, `verify_business` | `nvidia/Nemotron-3_5-Lightning` | 0.7 s per tool decision in our tests; a question can trigger several calls |
| Write the report from the structured signals, as JSON validated with zod (with one repair round) | `nvidia/nemotron-3-super-120b-a12b` | better grounded prose over a large context |

No agent framework: the tool loop is a short function in `src/llm.js`. A daily cap on model calls (`LLM_DAILY_CAP`, repair rounds included) and a 25 s timeout per call keep the public demo within its credits. Without `NEBIUS_API_KEY` the app runs in template mode (plain-language report in English or Spanish): the Qloo analysis and the verdict still work.

**Tavily**: every launch partner the writer proposes is searched on the live web before it is shown, and only kept if its name appears in a result title or URL ("✓ found on the web"). In the chat, the model decides when to call `verify_business` itself.

## Run it

```bash
git clone https://github.com/mktaisales-glitch/abro-aqui && cd abro-aqui
npm install
cp .env.example .env      # QLOO_API_KEY, NEBIUS_API_KEY, TAVILY_API_KEY
npm run dev               # http://localhost:3000
npm test                  # verdict rules, pipeline on the two Barcelona cases (recorded in fixtures/demo.sqlite), LLM wiring, PII scrub
```

Deploy: `render.yaml` (Render blueprint) or the `Dockerfile`. API: `POST /api/analyze {concept, address, lang, without_qloo}`, `POST /api/chat {id, question}`, `POST /api/compare {id, address}`, `GET /api/health`.

Offline replay: `OFFLINE=1` serves only recorded responses (`scripts/plan.js` lists every missing call, `scripts/load.js` loads recordings), which is how the tests run without network. If a live call fails, the server falls back to the recorded responses for the demo examples.

## Limits and failure modes

- Qloo measures taste and offer, not foot traffic, rent, income or licences. Every report says so.
- Coverage is dense in large cities (Barcelona and Brooklyn checked: 300–400 blocks within 1.5 km) and thin elsewhere, which gives **No data**.
- `affinity_rank` compares a block with a wide reference that Qloo does not document in detail; dense city centres score high for many concepts, so offer often decides between Hard and Promising.
- Exotic concepts may not map to a Qloo tag. The tool says so and suggests a simpler word. "How I know" shows which tag was used.
- Geocoding uses OpenStreetMap Nominatim. You can also type "lat, lon".
- The demo allows 30 analyses, 30 comparisons and 60 chat questions per IP per day, and 600 model calls per day in total. On the free hosting plan the first visit after a quiet spell can take up to a minute.

## Responsible use

Abro Aquí decides about a **place**, never about a **person**. E-mails and phone numbers typed into the app are removed before any model or search call (`src/safe.js`, tested). Affinities are described as "the area", never as "the people who live here". Some customer-identity labels that touch protected attributes (religion, ethnicity, sexuality, disability, age groups) are filtered out of the audience panel. It must not be used for housing, employment or credit decisions. See [`specs/05-safe-use.md`](specs/05-safe-use.md).

## Layout

```
specs/       spec-driven: verdict rules (v2 after review), tools, agent, UI, safe use
src/         http.js (cache, trace) · qloo.js · tools.js · verdict.js · llm.js · agent.js · server.js
public/      one-page UI (Leaflet and fonts self-hosted, no build step)
tests/       verdict rules on real recorded signals; end-to-end pipeline on recorded data
FEEDBACK.md  notes for Nebius / NVIDIA and for Qloo
```

MIT © 2026 MarketingAiSales
