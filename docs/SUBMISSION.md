# Devpost submissions (drafts)

## Common fields

- **Name:** Abro Aquí: should I open here?
- **Tagline (≤ 200 chars):** Tell it a business and a street address. It reads what the area likes and what it already has, and tells you whether to open there, before you sign a lease.
- **Demo:** https://abro-aqui.onrender.com (to confirm after deploy)
- **Repo:** https://github.com/mktaisales-glitch/abro-aqui (MIT)
- **Built with:** Qloo Insights API, NVIDIA Nemotron (Nano, Lightning, Super), Nebius Token Factory, Tavily, Node.js, Express, Leaflet, OpenStreetMap, SQLite, zod

---

## Qloo Agentic Hackathon: description

### Inspiration
In Barcelona, two businesses we knew closed: a seafood restaurant on Avinguda del Paral·lel and a waffle-and-ice-cream shop at Gran Via and Entença. Both owners chose the address the way most small businesses do: gut feeling, a friend's opinion, a walk around the block. Big chains pay location-intelligence firms for this decision. The owner of one shop can't. Agents can now do the analyst's job, if they know what the neighbourhood actually likes. That's what Qloo knows.

### What it does
You type a concept ("seafood restaurant", "gofres y helados", "specialty coffee") and an address. In about 20 seconds you get:

- **A verdict**: Not here, Hard, Promising or No data. It comes from deterministic rules on Qloo signals, and the rule that fired is shown.
- **Two gauges**: how much the area likes the concept (Qloo heat-map affinity at the nearest block) and how much of it is already on offer (popularity).
- **A taste heat map** block by block, with the best nearby spot that still has room.
- **Direct competitors** within 700 m, with rating, price level and distance.
- **The gap**: parts of your idea nobody nearby offers.
- **The area**: among the 50 most popular places within 500 m, what they serve, who goes and when.
- **What Qloo cannot see**: foot traffic, rent and income, asked back to the owner. There is no automatic green.
- **A "what if…?" agent**: "What if I ignore Puertecillo?", "What if I move 300 m?". It calls the tools again and recomputes.
- **"Without Qloo"**: the same question answered by the LLM alone, so you can see what it invents.
- **"How I know"**: every Qloo call behind the report.

On the two real cases, the seafood restaurant at Paral·lel 40 gets **Not here**: affinity 0.29, and 13 of the 50 most popular places nearby already serve seafood. The waffle shop at Gran Via 400 gets **Hard**: 7 ice-cream shops within 700 m, nobody selling waffles, and a block 275 m away scoring 0.92 instead of 0.52.

### How we built it (what makes it Qloo-powered)
- `/v2/tags` resolves each part of the concept into a **genre tag** (the heat map only answers to `genre:place:restaurant:*`) and a **category or specialty-dish tag** (competitors). Candidates are scored by word overlap, so "seafood restaurant" does not resolve to "seafood donburi". If a tag returns no data and is not used within 5 km, we fall back to the next candidate.
- The `urn:heatmap` insight around the address gives affinity, rank and popularity per block. That drives the verdict and the best-alternative block.
- The `urn:entity:place` insight with the category tag within 700 m gives competitors. Without tags, within 500 m, it gives the 50 most popular places, whose cuisine, category, customer-identity and time-of-day tags become the area profile.
- The verdict is deterministic and specified before the code (`specs/01-verdict.md`). The LLM explains; it never decides.
- Spec-driven: five spec files, tests on the two real recorded cases, offline replay of recorded Qloo responses.

### Responsible use
The agent decides about places, never people. No personal data goes into any request. Customer-identity labels that touch protected attributes are filtered out. It is not for housing, employment or credit decisions. It says what it cannot see.

### What's next
We run a sales and AI consultancy for small businesses (MarketingAiSales). This is the first diagnostic we'll put in front of clients: 49 € per report for an owner, 199 €/month for commercial real-estate agencies that want a verdict on every listing.

---

## Nebius x NVIDIA Global AI Hackathon: description (track: Best Apps and Agents)

Same "Inspiration" and "What it does" as above, then:

### How we use NVIDIA Nemotron on Nebius Token Factory
One OpenAI-compatible endpoint, three models, each picked for its task:
- **Nemotron 3 Nano 30B** (JSON mode) turns a free-text concept in any language into English parts Qloo can match: "gofres y helados" → `["waffles","ice cream"]` in 1.5 s.
- **Nemotron 3.5 Lightning** runs the "what if…?" agent with native tool calling (`nearby_competitors`, `analyse_address`, `zone_profile`, `verify_business`). It decides which tool to call and with which arguments in about 0.7 s, and one question can chain several calls.
- **Nemotron 3 Super 120B** writes the report from the structured signals, as JSON validated with zod, with one repair round.

The multi-step workflow is geocode → concept to tags → heat map + competitors + area profile in parallel → deterministic verdict → Nemotron report → tool-calling chat. A daily cap on model calls keeps the public demo within its credits. **Tavily** is the tool the agent calls to verify a proposed partner on the live web.

### Feedback
See `FEEDBACK.md` in the repo: what worked (first-try tool calling, JSON mode, model-per-task) and six concrete onboarding frictions (card wall before the first key, top-up dialog defaulting to card, the post-trial default, model-id casing).
