# ADR-0017 · An AI grader for groundedness, not checked against a human

Status: Accepted · Date: 2026-10-23 · Extends: [ADR-0015](0015-text-generation-gateway.md) · Code: `src/server/modules/eval/grader.ts`, `eval/grader-mock-responder.ts`, `scripts/lib/ai-smoke.ts` (`gradeDraft`)

## Context

The evaluation plan (docs/04, M6 plan D5) needs a groundedness number: do the drafts stick to the help articles they cite? A draft can cite valid passages and still add a fact that is in none of them, such as an invented price, a refund promise or a step that doesn't exist. Citation validity can't catch that. Checking 140 drafts by hand on every run isn't practical, so the usual answer is a model acting as a judge. Model judges agree with people more than 80% of the time on general chat, but they have known biases: they favour the first answer shown, longer answers, and their own writing (Zheng et al. 2023, "Judging LLM-as-a-Judge").

The plan was to check the grader against 30 drafts rated by the project owner. On 2026-10-23 the owner decided not to rate drafts, and asked for the grader's numbers to be reported as **"AI-graded, not checked against a human"**.

## Decision

- **Claim by claim, yes or no.** The grader lists the factual claims in a ready draft (at most 12) and marks each one supported or unsupported, naming the sources that support it. A draft is grounded when every claim is supported. A yes/no per claim doesn't reward length the way an overall 1–10 score would, and each "unsupported" verdict can be checked by hand.
- **Against the passages the draft cites.** Those are what an agent opens to check a draft. A claim backed only by something the agent can't see counts as unsupported. Groundedness measures where claims come from, not whether the reply answers the question; that is "cites the right article" and refusal recall.
- **Evidence or it doesn't count.** A "supported" verdict that names no real source is counted as unsupported by code, and the number of times this happens is reported, so the grader can't approve without pointing at evidence.
- **A different model from the drafter.** It is `gemini-3.5-flash-lite`, the cheapest; drafts are written by `gemini-3.8-flash`. It isn't grading its own writing, but it is a smaller model, and the report names both. When drafts fall back to Flash-Lite (ADR-0016), those drafts are graded by the same model, and the report's model counts show how many.
- **Untrusted input.** The draft and passages are data inside `<reply>` and `<source>` tags; tags are neutralised and hidden characters removed, the same as for triage and drafts.
- **Evaluation only.** It is the AI feature `grade` in the gateway, with its own usage rows, pacing, call budget and 429 stop. The app never calls it. Settings, the API and the monthly budget count only the app's features (triage, drafts and, for display, embeddings).
- **Labelled every time.** The number appears only as "Groundedness (AI-graded, not checked against a human)", with the claim counts, the "supported" verdicts that named no source, and grader failures. There is no target and no CI floor for the Gemini number. The mock floor checks only the plumbing.
- **Grader failures are kept apart.** A grading with no usable answer (after one retry for invalid output) is left out of the rate and counted; the draft's own results still count. A grading cut off by the call budget or a 429 isn't saved, so on resume the draft is written and graded again.

## Consequences

- Groundedness is an indicator, not a validated measure: nobody has checked how often the grader agrees with a person on these drafts. Anyone reading the report is told so, and can check every verdict, because the claims and verdicts are stored with each item.
- The Gemini evaluation makes about 140 more calls (one per ready draft): about 450 instead of 309, so it needs more of the free tier's daily sessions.
- The mock grader (word overlap: a sentence is supported when one source contains 60% of its meaningful words) passes everything the mock drafter writes, since that drafter quotes its sources. It tests the plumbing; unit and integration tests cover unsupported claims, verdicts with no source, failures and budget stops.
- Human ratings can still be added later: the Review page (`/app/review`) already has a "drafts" set, and what remains is loading 30 graded drafts into it and comparing the verdicts. The grader and its stored verdicts wouldn't change.
