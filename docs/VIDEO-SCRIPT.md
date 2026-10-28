# Demo video script (2:18)

Screen recording of the live site (ramen at Rambla del Poblenou 100, Barcelona, 28-Oct-2026), edited with zooms, captions, voice-over (synthetic voice, Kokoro TTS) and music. The music is original: generated procedurally in code for this video (no third-party music, no samples). No third-party logos are shown; product names appear as plain text. Sources on screen: Ara (23 Sep 2025) for Barcelona opening costs; Parsa et al., Cornell HRA Quarterly (2005), 2,439 restaurants, for closures.

| Time | Scene | Voice-over |
| --- | --- | --- |
| 0:00 | Hook — premises | Imagine you've found the perfect premises for your restaurant. |
| 0:03 | Hook — Barcelona costs (Ara, 23 Sep 2025) | In Barcelona, a renovation can cost three thousand euros per square metre. A licence can add a hundred thousand more. A hundred-square-metre restaurant in the Eixample needs at least four hundred thousand euros to open. |
| 0:18 | Hook — €400,000 at stake | Four hundred thousand euros... on the line, before your first customer walks in. |
| 0:24 | Hook — 6 in 10 (Parsa et al., 2005) | And in one study of nearly two and a half thousand restaurants, six in ten closed or changed hands within three years. Failure was highest where restaurants crowd together. |
| 0:35 | Open Here: value and three pillars | Open Here helps small business owners choose where to open, before they sign. It reads what a street really likes with Qloo's taste data, counts the rivals already there, and uses NVIDIA Nemotron agents on Nebius to look for a better block nearby. |
| 0:51 | Access: abro-aqui.onrender.com | It's free to try. Go to abro-aqui.onrender.com. No sign-up. |
| 0:56 | Use: concept + street + area | Type your idea, the street, and how far around to look. Then press the button. |
| 1:05 | Verdict | The verdict: Hard. The area likes ramen, but three places already serve it. |
| 1:10 | Map and better spot | The map shows taste block by block. The green ring marks a block nearby that the same rules rate better. And every number has a reason you can open. |
| 1:19 | Agent (Nemotron 3.5 Lightning, Nebius Token Factory) | Find a better spot hands the question to an agent. NVIDIA Nemotron on Nebius Token Factory picks its own steps and calls the tools, then weighs that block against your address and explains its choice. Code drops any number the tools didn't return. |
| 1:35 | Opening plan (Qloo cross-domain) | Plan the opening uses Qloo across domains: what customers of the best ramen places nearby also love. Music, brands, and neighbours to team up with. |
| 1:45 | With / without Qloo | The comparison tab shows what Qloo adds: the real rivals around the corner, by name, rating and distance. Without that data, a model can only guess. |
| 1:55 | What fits here | Already have premises? Switch mode, and it ranks fifteen food and drink ideas for that address. |
| 2:02 | PDF report | And when you're done, download the full report as a PDF: the address, the verdict and every reason behind it. Ready for your partner, or your bank. |
| 2:11 | Close | Open Here. Know before you sign. Try it free at abro-aqui.onrender.com. |

## Corrections for the next cut (the table above is what the current video says)

| Time | Current line | Corrected line |
| --- | --- | --- |
| 0:35 | "…uses NVIDIA Nemotron agents on Nebius to look for a better block nearby." | "…code finds the candidate blocks nearby, and an NVIDIA Nemotron agent on Nebius re-checks them and tells you whether to move." |
| 1:10 | "The green ring marks a block nearby that the same rules rate better." | "The green ring marks a nearby block with the same verdict, more taste and fewer rivals, and the page says exactly that." |
| 1:35 | "Music, brands, and neighbours to team up with." | "Music, neighbours to team up with, and the best blocks for posters." (the recorded plan had no brands) |
| 1:45 | "Without that data, a model can only guess." (the "language model alone" column was still loading) | Show the model-alone answer once it has loaded. |
