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

## 27-Oct (evening): after the simulated judges review
Review doc: "Abro Aquí — Jurado simulado" (Claude Docs). Consensus: we misread the heat map (affinity/popularity are ranks inside the circle).
- [x] Verdict v2 (spec 01 rewritten): demand = affinity_rank within 250 m; offer = rivals 400/700 m + share; unmeasured parts reported; better spot judged with the same rules on busy blocks (≥ 15 places within 200 m).
- [x] Cases now: Paral·lel 40 seafood → Hard (well served; Poble-sec 747 m better). Gran Via 400 → Hard; waffles not measurable (no waffle tag within 5 km).
- [x] Tavily checks writer partners in the pipeline; partners can come from the 50 popular places.
- [x] Bilingual plain template; hardening (trust proxy, limits, JSON errors, PII scrub + test, LLM timeout, failed calls traced, recorded fallback in fixtures/demo.sqlite). 16 tests.
- [x] README, SUBMISSION, VIDEO-SCRIPT updated to v2 numbers and honest claims.
- [ ] Deploy (Víctor: Render sign-up with GitHub) + keep-alive + live test with Nemotron.
- [ ] Wed AM: autonomous "second opinion" agent (Lightning plans: better spot + verified partners), shown as a timeline.
- [ ] Wed PM (if time): "¿Qué abro aquí?" reverse mode (address → ranked concepts). Waiting for Víctor's yes.
- [ ] Thu AM: screenshots with base map, NYC case recorded, measured latency, specs 02–05 refresh.

## 28-Oct (night): search for a "9" idea
- 3 rounds (~25 ideas), critic filters, real-API probes, 4 jury passes (8 profiles). Results: Abro Aquí v2 avg 7.0 (best); Host-Read (podcast ads) 6.2; Who's Missing (theme nights) 6.0. Details in the Claude Docs doc "Abro Aquí — Jurado simulado" (last section) and scratchpad files (ideas-r1..r3, learnings-r3, *-spec.md, backtest-*).
- Recommendation to Víctor: stay with Abro Aquí and spend the remaining time on: (1) real customer 15 s video, (2) deployed demo with Nemotron live and the scout agent deciding, (3) outcome backtest (known openings/closures), (4) consistent numbers + disclaimer (done).
- Qloo API facts learned: place→taste weak; entity→entity strong; demographics indices noisy; generic tag saturates in dense centres while concept tags discriminate; rate limit ~12 parallel → go serial; multi-entity demographics in one call works; signal.demographics.age takes one value.
- Recorded Qloo responses removed from the public repo history (rules). fixtures/demo.sqlite and fixtures/raw are local only.
- Render: blueprint form ready (public repo URL), waiting for Víctor to paste the 3 keys and click Deploy.
