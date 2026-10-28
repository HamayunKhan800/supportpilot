# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Support teams at software companies that keep a help centre: the agents who answer tickets all day,
and the owner or admin who sets the team up and watches quality and cost. Customers never sign in;
they write in and follow their request on a public tracking page.

The landing page speaks to these teams as a real product would (confirmed 2026-10-28). The project
is also an open-source portfolio piece; that side lives in the README and case study, not in the
landing page's framing.

## Product Purpose

SupportPilot is a multi-tenant help desk where AI does the first pass on every ticket: it labels
the category and priority, finds the help articles that answer it and drafts a reply that cites
them. A person reviews and approves every reply before a customer sees it. Success is an agent
sending a correct, sourced answer faster than writing it, and a team that can see how good the AI
really is.

## Positioning

Two things together, which a neighbouring AI help desk could not truthfully copy without doing the
work (confirmed 2026-10-28):

1. **Cited and approved.** Every draft quotes the exact help-article passages it is based on; each
   citation is checked against what the model was given; nothing reaches a customer until an agent
   approves it. When the knowledge base has no answer, the AI declines instead of guessing.
2. **Measured in public.** The AI is tested on fixed, labelled sets with real Gemini models, and
   the full report is public (docs/eval/m6-baseline.md).

## Operating Context

- Agents work a ticket inbox and a ticket page: conversation, AI draft with numbered citations,
  triage card, "Approve & send". Keyboard shortcuts and a command palette exist for heavy use.
- Owners and admins manage members, the knowledge base (Markdown and PDF uploads), AI settings
  (daily limits, confidence threshold), analytics, the evaluation dashboard and the audit log.
- Customers use a public portal: submit a request, follow its status, reply.
- Used on desktop at work and checked on phones; the theme follows the device setting.
- Demo data is a fictional company, Nimbus Cloud Storage, with a synthetic help centre
  (eval/corpus/nimbus).

## Capabilities and Constraints

- Roles: owner, admin, agent. Multi-tenant workspaces; every query is scoped to a workspace.
- AI: triage (category, priority, confidence; applied automatically above a threshold), retrieval
  over the workspace's articles, cited drafts with refusal, prompt-injection defences. Live demo
  runs real Gemini models with a daily cap; local runs use a built-in offline mock AI.
- Updates arrive by polling, not WebSockets.
- Strict Content Security Policy: no inline styles, no third-party scripts or fonts; fonts are
  self-hosted.
- Terminology: ticket / request (customer side), draft, citation, source, triage, knowledge base,
  help article, workspace, agent.

## Brand Commitments

- Name: SupportPilot. Logo: "Handoff" mark (option C). Palette: Ink only.
- Type: Geist for text; Newsreader for the landing page's large headings only (approved
  2026-10-28).
- Voice: plain, specific and honest; British English spelling ("categorised", "help centre").
  Controls name their action. No hype words, no invented claims.

## Evidence on Hand

- Evaluation on real Gemini models (420 labelled items): right article in the top 5 for 99.1% of
  110 questions; right triage category 94.0% of 150 tickets (priority 91.3%); 100% of 133 citations
  point at a real passage; all 20 prompt-injection attacks resisted; groundedness 99.1%
  (AI-graded, not checked against a human). Report: docs/eval/m6-baseline.md; method:
  docs/eval/README.md.
- Security self-review against OWASP ASVS 5.0 Level 2: 183 pass, 9 partial, 2 accepted risks of
  194 applicable (docs/security/asvs-l2.md).
- Live demo with public demo accounts; 66-second walkthrough recorded on the live demo
  (docs/demo/walkthrough.gif / .mp4); real screenshots (docs/screenshots/app/).
- **Absent, never to be fabricated:** customers, customer logos, testimonials, user counts,
  ratings, press, pricing tiers. The project is free and open source (MIT).

## Product Principles

1. A person decides. The AI prepares; an agent approves every word a customer reads.
2. Show the source. Every AI claim points at the passage it came from, in the product and on the
   page.
3. Say "I don't know". Declining is a correct answer when the knowledge base has none.
4. Prove it with numbers that link to their evidence; never round up or invent.
5. Fast for daily work: keyboard-first, no waiting on motion, nothing hidden behind decoration.

## Accessibility & Inclusion

WCAG 2.2 AA: zero axe violations in both themes, pointer targets at least 24px, visible and
unobscured focus, reduced motion respected, no animation on keyboard or high-frequency actions.
Ticket content can be any language and script (RTL and CJK appear in the demo).
