# Spec 05 — Responsible use

- Qloo returns **aggregated affinities for places and tags**. The product decides about a *place*, never about a *person*.
- No names of people, no emails, no phone numbers, no personal data in any request to Qloo, Tavily or the LLM. A test greps the request log for e-mail and phone patterns.
- Affinities are presented as "the area likes…", never as "the people who live here are…".
- Not for housing, employment or credit decisions (footer notice, README).
- Every number in the report links to the call that produced it ("How I know").
- The verdict never claims to predict success. It says what the data supports and what it cannot see.
