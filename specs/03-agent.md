# Spec 03 — The agent

Two LLM roles, both NVIDIA Nemotron on Nebius Token Factory, through the OpenAI SDK (`baseURL = NEBIUS_BASE_URL`):

| Role | Model | Why |
| --- | --- | --- |
| Classifier + chat | `nvidia/Nemotron-3_5-Lightning` | fast, cheap; maps a free-text concept to Qloo tags; answers "what if…?" in the chat with tool calling |
| Writer | `nvidia/nemotron-3-super-120b-a12b` | writes the report from structured signals; JSON output validated with zod |

## Pipeline for one analysis

1. `geocode(address)`
2. `concept_to_tags(concept)` — Lightning picks the best category tag and heatmap tag from the `/v2/tags` candidates.
3. In parallel: `heatmap`, `nearby_competitors`, `zone_taste`, `affine_brands`.
4. `verdict(inputs)` — deterministic (spec 01).
5. Writer produces the report JSON: `{headline, why[], gap[], audience[], actions[], unknowns[3], partners[3]}`.
6. Chat loop (Lightning, tool calling, max 8 rounds): the user asks "what if…"; the model may call any tool from spec 02; `verify_business` is a tool the model decides to call when it proposes a partner (Tavily).

## "Without Qloo" mode

Same writer prompt, same concept and address, **no tools, no Qloo data**. Shown side by side so the judge sees what the LLM invents on its own (competitors that do not exist, no ratings, no distances).

## Fallback

If `NEBIUS_API_KEY` is missing, the server starts in `LLM=none` mode: the verdict and all Qloo data still work; the report text is a template. This keeps the Qloo demo alive if the LLM provider is down.
