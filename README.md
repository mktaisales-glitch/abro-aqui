# Abro Aquí — *Should I open here?*

An AI agent that tells a small-business owner whether a **concept** works at a **street address**, before they sign a lease.

Type `seafood restaurant` + `Av. del Paral·lel 40, Barcelona` and you get, in under 25 seconds:

- a **verdict** (RED / AMBER / AMBER-GREEN / UNKNOWN) with the exact rule that fired,
- a **taste heat map** of the concept around the address (Qloo),
- the **real competitors** within 700 m with rating, price level and distance (Qloo),
- the **gap**: what the area likes that nobody offers,
- the **audience**: aggregated taste of the area and affine brands (ready as ad interests),
- three **actions** and launch **partners** (verified on the web with Tavily),
- the three things **Qloo cannot see** (foot traffic, rent, income) — the owner answers them, and only then AMBER-GREEN becomes green,
- a **"what if…?" chat** that re-runs the tools ("what if I ignore Puertecillo?", "what if I move 300 m north?", "compare with Carrer de Blai 20"),
- a **"Without Qloo"** toggle: the same report written by the LLM alone, hallucinated competitors included.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/) and the [Nebius x NVIDIA Global AI Hackathon](https://nebiusglobalaihackathon.devpost.com/) (October 2026).

## Why this only works with Qloo

The verdict is computed from Qloo signals: the taste **heat map** of the concept (affinity, percentile rank and existing supply at the nearest cell), the **same-category places** nearby, and the **aggregated taste tags** of the area. Without those, an LLM invents competitors and guesses the neighbourhood. The "Without Qloo" tab shows exactly that on the same input.

Qloo endpoints used (all through the hackathon gateway, key server-side only):

| Call | Purpose |
| --- | --- |
| `GET /v2/tags?filter.query=` | candidate tags for the concept; Nemotron picks one category tag and one heatmap tag |
| `GET /v2/insights?filter.type=urn:heatmap&filter.location=POINT()&filter.location.radius=1500&signal.interests.tags=` | affinity / rank / popularity per cell, paged (`take=50`) |
| `GET /v2/insights?filter.type=urn:entity:place&filter.location=POINT()&filter.location.radius=700&filter.tags=` | direct competitors with `business_rating`, `price_level`, coordinates |
| `GET /v2/insights?filter.type=urn:tag&signal.location=POINT()&signal.location.radius=800` | taste profile of the area |
| `GET /v2/insights?filter.type=urn:entity:brand&signal.location=POINT()&signal.interests.tags=` | affine brands (ad interests) |

Every call made for a report is listed in the **"How I know"** tab, without the key, with timing and cache flag.

## How the verdict is decided (and why there is no GREEN)

Deterministic rules, in `src/verdict.js`, specified in [`specs/01-verdict.md`](specs/01-verdict.md):

1. fewer than 50 heat-map cells → **UNKNOWN**
2. affinity < 0.35 → **RED** (the area does not ask for this)
3. supply ≥ 0.80 → **AMBER** (saturated)
4. affinity ≥ 0.60 and supply ≤ 0.60 → **AMBER-GREEN** (appetite without offer)
5. otherwise **AMBER**; two competitors rated ≥ 4.5 within 400 m step the verdict down one level.

The LLM **explains** the verdict; it never decides it. The best verdict is AMBER-GREEN because Qloo measures taste, not foot traffic, rent or income. The report asks those three questions.

### Calibrated on two real closures (Barcelona, 2026)

| Case | Qloo signals | Verdict | What happened |
| --- | --- | --- | --- |
| Seafood restaurant, Av. Paral·lel 40 | affinity 0.19, best seafood zone 900 m away (Sant Antoni), 3 seafood places within 600 m | **RED** | closed after 10 years; the area shifted to tapas and vermouth. Consistent with the data, not claimed as a prediction |
| Waffles & ice cream, Gran Via / Entença | affinity 0.73, supply 0.55, 4 ice-cream shops within 700 m, zero waffle places | **AMBER-GREEN** + 3 open questions | closed. The three questions (traffic, rent, income) were exactly what the data could not see |

## How NVIDIA Nemotron on Nebius Token Factory is used

Two models through the OpenAI-compatible endpoint (`https://api.tokenfactory.nebius.com/v1/`):

| Task | Model | Why this one |
| --- | --- | --- |
| Map the free-text concept to Qloo tag ids; answer the "what if…?" chat with **tool calling** (5 tools) | `nvidia/Nemotron-3_5-Lightning` | fast and cheap; the chat calls Qloo and Tavily several times per question, so latency and cost per call matter |
| Write the report as validated JSON (zod) | `nvidia/nemotron-3-super-120b-a12b` | better at long, grounded prose from a structured context |

Where Token Factory accelerated the work: one `baseURL` swap, native tool calling and `response_format: json_object`, no infra. If `NEBIUS_API_KEY` is missing the server runs in template mode: the Qloo analysis and the verdict still work, only the prose is templated — the demo survives an LLM outage.

Tavily: `verify_business` is a tool the model decides to call when it proposes a partner (one runtime call per partner, basic search).

## Run it

```bash
git clone https://github.com/mktaisales-glitch/abro-aqui && cd abro-aqui
npm install
cp .env.example .env   # fill QLOO_API_KEY, NEBIUS_API_KEY, TAVILY_API_KEY
npm run dev            # http://localhost:3000
npm test               # verdict rules against the two real cases
```

`GET /api/health` shows which providers are configured. `POST /api/analyze {concept, address, lang, without_qloo}` returns the full report; `POST /api/chat {id, question}` runs the tool-calling chat on a previous analysis.

## Limits and failure modes

- Qloo measures **taste and offer**, not foot traffic, rent, income or licences. The report says so on every result.
- Heat-map coverage is dense in large cities (Barcelona, New York, San Francisco and London tested: 290–400 cells in 1.5 km) and thin elsewhere → UNKNOWN.
- Tag mapping can miss exotic concepts; the "How I know" tab shows which tag was used, and the chat accepts another `category_tag`.
- Geocoding uses OpenStreetMap Nominatim (one request per analysis, cached 24 h).
- Demo limit: 30 analyses per IP per day. Cache: 24 h per call.

## Responsible use

Qloo returns **aggregated affinities about places and tags**. Abro Aquí decides about a *place*, never about a *person*: no names, no personal data in any request (a test greps the request log). Not for housing, employment or credit decisions. See [`specs/05-safe-use.md`](specs/05-safe-use.md).

## Project layout

```
specs/      spec-driven: verdict rules, tools, agent, UI, safe use
src/        qloo.js (client+cache+trace) · tools.js · verdict.js · llm.js · agent.js · server.js
public/     one-page UI (Leaflet, no build step)
tests/      verdict rules on the two real cases
FEEDBACK.md notes for Nebius / NVIDIA / Qloo
```

MIT © 2026 MarketingAiSales
