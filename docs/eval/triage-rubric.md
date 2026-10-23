# Triage labelling rubric

> Version 1.1 · 2026-10-23 (see [changes](#changes)) · Used for every label in the triage test set (`eval/triage/`) and as the basis of triage prompt v2 (M6 plan D1, D6).

The test set is only as good as its labels. Without written rules, "is this high or normal?" is a feeling, and two people (or the same person on two days) answer differently. This rubric turns each label into a decision someone else can check: every ticket in the set records the rule that decided its priority.

**Disclosure:** this version was written after the M5 smoke run, so I had seen which tickets the model got "wrong". To avoid bending labels towards the model, the rules are based on impact (what is at stake, and for how many people) rather than on the M5 results, **all 25 original labels** are re-checked against them (not just the misses), and every change is listed with its reason for the project owner to approve.

## Priority

Go down the list and stop at the **first** rule that matches the facts in the ticket. L2 is listed before N2 so that a question with no time pressure is low, not normal.

| Rule   | Priority   | When                                                                                                                                                                                                                                                                                                                                        |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U1** | **urgent** | **Security:** someone else may have access to the account, sensitive files were exposed (for example through a public link), or files may be spreading malware.                                                                                                                                                                             |
| **U2** | **urgent** | **Data being lost now:** files are disappearing, being overwritten or corrupted right now, or deleted files will be permanently removed within 7 days (the trash period is ending).                                                                                                                                                         |
| **U3** | **urgent** | **Outage for several people:** a whole team, family or several named people cannot sign in, sync or open their files.                                                                                                                                                                                                                       |
| **H1** | **high**   | **One person blocked:** the customer cannot do their core work and has no workaround: can't sign in, nothing syncs at all, can't open files they need, or uploads stopped because storage is full.                                                                                                                                          |
| **H2** | **high**   | **Money wrong:** charged twice, charged the wrong amount, charged after cancelling, or an unexpected charge.                                                                                                                                                                                                                                |
| **H3** | **high**   | **Getting deleted files back** that are still in the trash period: time-sensitive, because the trash is emptied automatically.                                                                                                                                                                                                              |
| **H4** | **high**   | **Deletion requests:** the customer asks Nimbus to delete their account or their personal data. Data-protection law sets a deadline for the answer (GDPR Art. 12(3): "within one month"), so it doesn't wait in the normal queue. Asking _how_ to delete files themselves is N2.                                                            |
| **N1** | **normal** | **A problem with a workaround,** or that affects only part of the product: slow sync, one file that won't sync, a display error, a sync conflict.                                                                                                                                                                                           |
| **L2** | **low**    | **No time pressure** (checked before N2 on purpose): a question or change where the customer says there is no rush, or that is about something they plan to do later; or a question about prices or discounts before buying (what something costs, whether a discount exists) that gives no deadline. Never applies to problems (U, H, N1). |
| **N2** | **normal** | **Questions and changes:** how to do something Nimbus offers (asking for something it doesn't offer is L1); billing questions without a wrong charge (invoices, currency, tax ID, payment method, changing plan); account changes (email, export); other pre-sales questions (security reviews, contracts, how to pay).                     |
| **L1** | **low**    | **Ideas and feedback:** feature requests, suggestions, praise, or complaints that don't ask for anything.                                                                                                                                                                                                                                   |

**Modifiers:**

- **M1 · Facts, not words.** "URGENT!!!", "ASAP" or "this is important" don't change the level by themselves; what is at stake does. A how-to question marked urgent is still normal.
- **M2 · Several issues:** use the highest level that applies.
- **M3 · Don't assume.** Label only what the ticket says. If a sync problem might affect a team but the customer only mentions themselves, it is H1, not U3.

## Category

Classify by **what the customer wants**, not by the words they use.

| Category            | When                                                                                                                                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **billing**         | Charges, refunds, invoices, prices, plans, upgrades and downgrades, payment methods, discounts.                                                                                                                                                                                          |
| **account**         | Signing in, passwords, two-step verification, changing the account email, account recovery, suspicious activity or a possibly compromised account, deleting the account.                                                                                                                 |
| **bug**             | Nimbus behaves differently from what its help articles say: errors, crashes, sync stuck, wrong results.                                                                                                                                                                                  |
| **how-to**          | How to do something (including exporting data and managing team or family members), whether something is possible, settings, and **documented limits and behaviour**, even when they show up as an error (API 429, file too big NC-204, storage full NC-507, Windows file names NC-101). |
| **feature-request** | Asks for something Nimbus doesn't do, or for a change to how it works.                                                                                                                                                                                                                   |
| **other**           | Anything else: security, compliance or legal questionnaires, partnerships, press, praise or feedback with no request, messages with no clear request.                                                                                                                                    |

**Tie-breaks:**

- **T1 · Goal over keywords.** "Is this a bug?" about documented behaviour is how-to. "Refund me, the app crashed" is billing if the request is the money.
- **T2 · Two requests:** the category of the issue that sets the priority (M2); if they have the same priority, the one the customer asks about first.
- **T3 · Complaining that something is missing** is a feature request.
- **T4 · "Can I do X?"** is how-to if the help articles describe X, and a feature request if Nimbus doesn't offer it.

## Sentiment

- **negative:** frustrated, angry, worried, disappointed or sarcastic.
- **positive:** happy or thankful as the main tone ("love the app, one quick question"). Politeness such as "thanks in advance" alone is not positive.
- **neutral:** everything else, including polite, factual requests.

## Language

The ISO 639-1 code of the language most of the message is written in. Urdu written in Latin letters (Roman Urdu) is `ur`. Mostly English with a few words in another language is `en`.

## Changes

**Version 1.1 (2026-10-23), from the project owner's review of the proposed label changes** (`eval/review/label-changes.json`):

- **H4 added.** The owner kept nim-08 ("Please delete my account and all my data") at high instead of the proposed normal. A deletion request has a legal deadline ([GDPR Art. 12(3)](https://gdpr-info.eu/art-12-gdpr/): the controller must act "without undue delay and in any event within one month"), so it now has its own rule. tri-061, the only other deletion request in the set, moved from normal to high.
- **L2 widened.** The owner kept nim-11 (a nonprofit-discount question) at low: "a routine nonprofit discount inquiry with no stated urgency". Price and discount questions before buying are now L2. tri-021 ("URGENT!!! is yearly cheaper?"; M1: the shouting doesn't count) and tri-110 (a reseller-discount enquiry) moved from normal to low. Other pre-sales questions (security reviews, contracts, how to pay) stay normal: the owner's note was about a price question, and stretching it further would be my guess, not their decision.
