# Label spot-check, 2026-10-23

The M6 plan (D2) asks a person to check a mechanically chosen 20% of the AI-assisted test data on the Review page. This page says what was actually checked, by whom, and what changed.

## Who checked what

| Set                              | Items | Checked by                                           | Result                                                                  |
| -------------------------------- | ----- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Proposed label changes           | 7     | **Project owner** (Review page): 4 · AI assistant: 3 | Owner: 3 of 4 approved, 1 rejected, 1 approved only in part (see below) |
| Triage labels (every 5th ticket) | 30    | AI assistant                                         | 26 confirmed, 3 corrected, 1 unclear: **87% (70–95%, n=30)**            |
| Retrieval questions (every 5th)  | 22    | AI assistant                                         | 22 confirmed: **100% (85–100%, n=22)**                                  |

Intervals are 95% Wilson score intervals. Raw records: [`eval/review/label-changes.json`](../../eval/review/label-changes.json) (the owner's answers, exported from the Review page) and [`eval/review/ai-check-2026-10-23.json`](../../eval/review/ai-check-2026-10-23.json) (the AI check).

**Limitation, stated plainly:** the owner started the review on a phone, answered 4 items, then asked the AI assistant to finish. The assistant belongs to the same family of models that wrote the labels, so the 52 AI-checked items are **not** an independent human check. LLM judges agree with humans about as often as humans agree with each other, but they share biases with the model they judge ([Zheng et al., 2023](https://arxiv.org/abs/2306.05685)). To reduce that, the assistant didn't re-read its own reasoning: it re-derived each label from the written rubric and looked up every fact in the help articles. It still found 3 errors in 30 triage labels, which suggests the labels aren't simply rubber-stamped. The Review page still lists these 52 items as unchecked, so a human can check them later; the agreement figures above will then be replaced with human ones.

## The owner's decisions

| Ticket | Proposed                                                      | Owner's decision                                                                                         |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| nim-01 | Rename the non-existent "Pro" plan to "Personal"              | Approved                                                                                                 |
| nim-07 | Upload bug: high → normal (the desktop app handles big files) | Approved                                                                                                 |
| nim-08 | Deletion request: high → normal                               | **Rejected**: stays high                                                                                 |
| nim-11 | "Team" → "Business"; priority low → normal                    | Wording approved; **priority stays low** ("a routine nonprofit discount inquiry with no stated urgency") |

Two of these overruled the rubric, so the rubric changed (version 1.1, see its [changes](triage-rubric.md#changes)): **H4** makes deletion requests high because of the GDPR one-month deadline, and **L2** now covers price and discount questions before buying. Three other tickets of the same kinds were relabelled to match (tri-061, tri-021, tri-110).

nim-15, nim-16 and nim-17 were approved by the AI assistant at the owner's request: each follows the rubric the owner hadn't objected to. All seven decisions are recorded in `eval/triage/demo-labels.json` (`review.decidedBy`) and applied to the demo seed.

## What the AI check changed

- **tri-055** (locked out after too many passwords): high → **normal**. The help articles say the lock lasts 15 minutes and the password can be reset meanwhile, so the customer has a workaround, the same reasoning the owner approved for nim-07.
- **tri-020**, **tri-085**: sentiment positive → **neutral**. Both are friendly but factual; the rubric says politeness alone isn't positive.
- **nim-20** (sync a folder on an external drive) is **unclear**: labelled a feature request, but the desktop article lets you choose where the Nimbus folder goes without mentioning external drives. The label is kept and flagged for a human.

## What the review taught us about the tool

One ✅ answered two questions: nim-11 asked "approve the new labels **and** the new wording?", and the owner had to explain in a note that they meant yes to one and no to the other. Label changes and rewordings are now separate items (finding #101).
