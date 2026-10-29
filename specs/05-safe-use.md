# Spec 05 — Responsible use

- Qloo returns **aggregated affinities for places and tags**. The product decides about a *place*, never about a *person*.
- No names of people, no emails, no phone numbers, no personal data in any request to Qloo, Tavily or the LLM. Every address and free-text concept is scrubbed (`scrubPII`) where it enters the API (`/api/analyze`, `/api/compare`, `/api/explore`, `/api/noqloo`), before geocoding, labels or prompts; `tests/safe.test.js` checks the scrubber on addresses with an e-mail and a phone.
- Affinities are presented as "the area likes…", never as "the people who live here are…".
- Not for housing, employment or credit decisions (footer notice, README).
- Every number in the report links to the call that produced it ("How I know").
- The verdict never claims to predict success. It says what the data supports and what it cannot see.
