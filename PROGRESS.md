# Progress log (internal, for resuming work)

Deadline: Nebius submit **Fri 30-Oct 18:00 CET**, Qloo **Sat 31-Oct 04:45 CET**. Freeze Thu 29-Oct 14:00.

## Done (26-Oct night)
- Repo public, MIT. Specs 01–05. Verdict engine + 7 tests.
- Keys: Qloo (in .env), Tavily (in .env), Nebius key created in Token Factory (name `abro-aqui`) — the browser extension blocks copying it out; it must be pasted by Víctor into the deploy env (or a new one created there). Promo 25 $ applied (balance 30.25 $). Post-trial = Stop usage (card never charged). Reminders: 31-Oct (prepaid card, then switch to paid usage so demo survives Nebius judging 1–15 Dec), 16-Dec (close billing).
- Verified in browser: model ids exist (`nvidia/Nemotron-3_5-Lightning`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/nemotron-3-super-120b-a12b`, Ultra, Super-VL); Lightning tool-calling OK (0.7 s); Nano json_object OK ("gofres y helados" → ["waffles","ice cream"]).
- Qloo findings: heatmap needs `urn:tag:genre:place:restaurant:*` tags and returns all cells in one call (no paging); zone taste via tags returns 1.00 for everything → replaced by zone profile from the 50 most popular places (cuisine / category / customer_identity / time_of_day_fit counts).

## Next (state at 00:05, 27-Oct)
1. [~] Fixtures: Paral·lel + Entença recorded. NYC not recorded (Chrome asleep / approval pending). Live deploy does not need fixtures.
2. [x] Pipeline offline + tests (11 pass: verdict rules, 2 real cases end-to-end, LLM wiring against a Token Factory mock).
3. [x] UI redesigned (verdict as sign, sticky heat map, gauges with thresholds, competitors, area profile, chat, How I know, Without Qloo, Compare). Screenshots in docs/.
4. [x] /api/compare + UI.
5. [x] LLM daily cap.
6. [x] Dockerfile + render.yaml. **Deploy needs Víctor** (Render account via GitHub, or VPS access) and the Nebius key pasted into the env (extension blocks copying it).
7. [x] FEEDBACK.md, docs/SUBMISSION.md, docs/VIDEO-SCRIPT.md.
8. [ ] Update the plan doc with progress (do in the morning summary).
9. [ ] Morning with Víctor: deploy (15 min) → live test with Nemotron + Qloo + Tavily → record NYC fixture/case live → polish from live results → video Thursday.
