# Spec 03 — Models and agents (as built, 28-Oct-2026)

Three NVIDIA Nemotron models on Nebius Token Factory, through the OpenAI SDK (`baseURL = NEBIUS_BASE_URL`), each for one job. Code: `src/llm.js`, `src/agent.js`, `src/launch.js`.

| Job | Model | Output |
| --- | --- | --- |
| Concept in any language → English parts Qloo can match | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (JSON mode) | `{parts: [...]}`; fallback: split on "and / y / ," |
| "What if…?" chat and the second-opinion agent (tool calling) | `nvidia/Nemotron-3_5-Lightning` | tool calls, then a short answer |
| Report; choices for the launch plan | `nvidia/nemotron-3-super-120b-a12b` (JSON, zod, one repair round) | report JSON; launch picks `{music, co_promo, brands}` |

## One analysis

1. `geocode` → 2. Nano: concept → parts → 3. `resolveConcept` (tags) → 4. in parallel: heat map (with tag fallback), competitors per part (with fallback and `tagInUse`), area profile → 5. `verdict` (deterministic, spec 01) → 6. better spot: rivals within 1.5 km, every busy block judged with the same rules, `placesNear` to drop parks → 7. Super writes the report while, in parallel, Lightning answers the same question without Qloo (fast model: the comparison must come back inside the request deadline) → 8. partners in the report: only names Qloo returned for the area survive, and only those Tavily confirms on the web are kept (not found or not checked → dropped); verdict codes in the model's text are replaced by the words the page shows.

## Second-opinion agent (`scout`)

Code computes the candidate blocks (the green ring is code, not the model). Lightning receives the goal (is there a better spot within ~800 m?), the current verdict, taste rank and rival count, and the tools (`candidate_spots`, `analyse_address`, `nearby_competitors`, `zone_profile`); the prompt suggests comparing up to three candidate blocks; the model chooses which tools to call, in which order and how many times (at most 7 rounds and 6 tool calls; the last round has no tools and asks for the answer), and answers in plain text. Sentences with numbers that no tool returned are dropped by code (`groundNumbers`); verdict codes in its text are replaced by the words the page shows. Partners are not its job: they come from the launch plan, where Qloo proposes them and Tavily checks them (in a live test the model named seafood restaurants as "partners", so we moved that decision out of the free-text agent). The steps are listed after the run with think time and tool time. If the model fails or is not configured, a fixed sequence of the same tools runs and the page says so.

## Launch plan

See spec 04. Super only chooses among Qloo's candidates and writes a one-line idea for each; code drops any name that is not a candidate and writes the headline, poster zones and the four weeks.

## Limits

A daily cap on model calls (`LLM_DAILY_CAP`, repair rounds included), 25 s timeout per call and no automatic retries (`maxRetries: 0`; a circuit breaker pauses the model for 5 minutes after 3 failures). Without `NEBIUS_API_KEY` the app runs in template mode: verdict, numbers, map and launch candidates still work; texts come from templates in English or Spanish.
