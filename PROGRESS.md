# Progress log (internal, for resuming work)

Deadline: Nebius submit **Fri 30-Oct 18:00 CET**, Qloo **Sat 31-Oct 04:45 CET**. Freeze Thu 29-Oct 14:00.

## Done (26-Oct night)
- Repo public, MIT. Specs 01–05. Verdict engine + 7 tests.
- Keys: Qloo (in .env), Tavily (in .env), Nebius key created in Token Factory (name `abro-aqui`) — the browser extension blocks copying it out; it must be pasted by Víctor into the deploy env (or a new one created there). Promo 25 $ applied (balance 30.25 $). Post-trial = Stop usage (card never charged). Reminders: 31-Oct (prepaid card, then switch to paid usage so demo survives Nebius judging 1–15 Dec), 16-Dec (close billing).
- Verified in browser: model ids exist (`nvidia/Nemotron-3_5-Lightning`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/nemotron-3-super-120b-a12b`, Ultra, Super-VL); Lightning tool-calling OK (0.7 s); Nano json_object OK ("gofres y helados" → ["waffles","ice cream"]).
- Qloo findings: heatmap needs `urn:tag:genre:place:restaurant:*` tags and returns all cells in one call (no paging); zone taste via tags returns 1.00 for everything → replaced by zone profile from the 50 most popular places (cuisine / category / customer_identity / time_of_day_fit counts).

## Next
1. [ ] Record demo fixtures through Chrome (scripts/plan.js → browser __rec → __dump → get_page_text → fixtures/rec-*.json → scripts/load.js). Cases in fixtures/cases.json.
2. [x] Full pipeline offline: Paral·lel RED (aff 0.29, 13/50 serve seafood), Entença AMBER (aff 0.52, gap waffles, better cell 275 m away aff 0.92). Brands dropped (noise). Tag fallbacks added.
3. [ ] UI pass: new fields (supply_by_part, share, profile who/when, best cell distance), Playwright screenshots desktop+mobile, polish.
4. [ ] /api/compare endpoint + UI.
5. [ ] Global LLM budget cap (max N LLM calls/day) so spend can never exceed credits.
6. [ ] Dockerfile + render.yaml; deploy instructions for Víctor (needs account creation by him).
7. [ ] FEEDBACK.md (Nebius), Devpost texts (both), video script (Nebius ≤3 min).
8. [ ] Update the plan doc ("Abro Aquí — Plan de hackatón").
