# Feedback

Written while building Open Here (26–30 October 2026). Everything below happened to us; nothing is hypothetical.

## Nebius Token Factory + NVIDIA Nemotron

**What we used:** Token Factory through the OpenAI SDK (`baseURL=https://api.tokenfactory.nebius.com/v1/`), three Nemotron models:
`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (concept → English parts, JSON mode), `nvidia/Nemotron-3_5-Lightning` (chat with tool calling), `nvidia/nemotron-3-super-120b-a12b` (report writer, JSON validated with zod).

**What worked well**

- OpenAI compatibility is real: changing `baseURL` was the whole migration. `GET /v1/models` listed every Nemotron model we needed.
- Tool calling on Lightning worked first try: "What if I ignore Puertecillo?" became `nearby_competitors({"radius_m":700,"exclude_names":["Puertecillo"]})` in 0.7 s.
- `response_format: {type: "json_object"}` on Nano: "gofres y helados" → `{"parts":["waffles","ice cream"]}` in 1.5 s, 137 tokens. Translation and normalisation in one cheap call.
- Choosing the model per task (Nano / Lightning / Super) kept the cost per analysis at a fraction of a cent.

**Zero to hello world: what slowed us down (≈ 40 minutes)**

1. **A card is required before you can create an API key**, even with a promo code in hand. The promo e-mail explains it, but the console only shows a "Billing details" wall. A line on that screen ("promo users: your card is only verified with a 0 $ authorisation") would remove the doubt.
2. **The top-up dialog opens on "By card"**, with the promo code in the second tab. A user who came to redeem credits is one click away from charging their card. Suggest: open on "With promo code" when the account has never been topped up, or show both inputs.
3. **The post-trial preference defaults to "Continue with paid usage" (Recommended).** Hackathon users usually want the opposite. It was not obvious that "Stop usage" also stops API keys at the end of the 30-day trial, which falls *before* the hackathon judging window (1–15 December). A note in the hackathon resources would save people from either an unexpected charge or a dead demo during judging.
4. **"30-day trial with a 1 $ usage limit"** shown next to a 30.25 $ balance: it is unclear whether trial usage is capped at 1 $ or the promo balance is usable during the trial.
5. **Model id casing is inconsistent**: `nvidia/Nemotron-3_5-Lightning`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. Underscore versus dot in versions, mixed case. We copied them from `/v1/models` to be safe; a typo returns a generic 404.
6. Several tutorials still reference ids deprecated on 31-Aug-2026 (`Llama-3_1-Nemotron-Ultra-253B-v1`). A redirect or a clearer error ("deprecated, use …") would help.

**Would we use it again?** Yes, for production agents where we want open models, EU data residency and per-task model choice. The API was the easy part; the billing onboarding was the hard part.

## Qloo Insights API: notes from building on it

Shared because they shaped the product and may help other builders.

- **Heat maps answer to genre tags, not category tags.** `signal.interests.tags=urn:tag:category:place:ice_cream_shop` returns 0 cells; `urn:tag:genre:place:restaurant:ice_cream_shop` returns ~350. We resolve both families per concept.
- **The heat map ignores `take` and `page`**: one call returns the full radius (300–400 cells at 1.5 km), sorted by affinity. Paging returns duplicates; we dedupe by geohash.
- **The "most exact" tag is not always the populated one.** For coffee in Williamsburg, `category:place:coffee` and `genre:place:restaurant:coffee` return nothing while `coffee_shop` does. We keep three ranked candidates per concept and fall back when a tag returns no data and is not used within 5 km.
- **Area taste via `filter.type=urn:tag` + `signal.location` gave affinity 1.00 for every tag**, so it cannot rank. Counting the tags of the 50 most popular places in the radius (cuisine, category, customer identity, time of day) gave a concrete, explainable profile instead: "13 of the 50 most popular places within 500 m already serve seafood".
- **Brands with `signal.location` at street level returned generic luxury fashion** for every concept we tried (a seafood place in the Raval → Gucci, Louis Vuitton). We dropped the location signal: brands now come from the entity signal of the best-rated rival places (whose audience is local already), and code drops categories a small shop cannot approach (fashion, software, travel…) and restaurant chains for a restaurant.
- **Tag search ranks by text, not meaning**: "seafood restaurant" lists `restaurant:seafood_donburi` before `restaurant:seafood`. We score candidates by word overlap with the concept.
- `customer_identity` tags include protected attributes; we filter them out of the "who goes" panel by design.
