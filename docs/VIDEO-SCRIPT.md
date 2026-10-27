# Demo video script (Nebius, ≤ 3:00, public YouTube)

Rules from the judges: the "aha" in the first 30 seconds; say "Nebius Token Factory" and the model names out loud; show the product working, not slides. Voice: Víctor, in English. Screen: the live demo.

| Time | Screen | Voice |
| --- | --- | --- |
| 0:00–0:12 | Generic Barcelona street at dusk, "Se traspasa" sign on an unbranded shutter (no business name or number visible) → cut to the app | "Every week someone in this city signs a lease on a gut feeling. Before you do, ask one question: should I open here?" |
| 0:12–0:35 | Type "seafood restaurant", "Avinguda del Paral·lel 40". Verdict appears: **Hard**. Headline: "The area likes seafood a lot, but it is already well served: Puertecillo is 26 m away and there are 6 more within 700 m." | "Abro Aquí reads the street with Qloo. The area loves seafood: it ranks 0.93. But it is already full of it: seven seafood restaurants within 700 metres, one of them 26 metres from the door." |
| 0:35–0:55 | Open "Why this colour", hover the two gauges, then the green ring on the map | "The verdict comes from rules on Qloo data, not from the model's mood. And it does not stop at no: 750 metres west, a busy block in Poble-sec likes seafood even more, with half the rivals." |
| 0:55–1:20 | Click "Waffles · Gran Via 400". **Hard**; the headline ends "Qloo has no data on waffles here" | "Here it is honest about what it cannot see. Seven ice-cream shops nearby. And waffles? Qloo has no waffle data in this part of town, so it says so, instead of inventing a gap." |
| 1:20–1:50 | Chat on the seafood case: "Check Carrer de Blai 20 instead" → `analyse_address` call shown with its result. (To be replaced by the autonomous "find me a better spot" agent if it ships on Wednesday.) | "The agent runs on NVIDIA Nemotron 3.5 Lightning on Nebius Token Factory. It decides which tool to call (competitors, another address, the area profile) and recomputes the verdict." |
| 1:50–2:15 | Tab "Without Qloo" side by side | "Without Qloo data, the language model alone invents a neighbourhood. With it, every number is traceable." |
| 2:15–2:35 | Tab "How I know", then README models table | "Three Nemotron models, each for its job: Nano turns 'gofres y helados' into parts Qloo can match, Lightning runs the agent, and Super writes the report as validated JSON. One OpenAI-compatible endpoint on Nebius Token Factory. Every partner the report suggests is checked on the live web with Tavily before you see it." |
| 2:35–2:55 | "What Qloo cannot see" with the three questions | "And it tells you what it cannot see: foot traffic, rent and income. There is no automatic green." |
| 2:55–3:00 | Logo + URL | "Abro Aquí. Open where your idea belongs." |

Recording: OBS at 1920×1080, browser zoom at 110 %, cursor highlight on. Record voice separately. Keep total under 2:58.
