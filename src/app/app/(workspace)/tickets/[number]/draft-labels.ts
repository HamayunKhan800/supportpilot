/** Plain-language text for the draft panel (M5 FR-AI3–AI8). */

export const WARNING_TEXT: Record<string, string> = {
  hidden_characters:
    "Hidden characters were removed from the ticket or the sources. Someone may be trying to manipulate the AI, so check this draft carefully.",
  unknown_link:
    "The draft contains a link or email address that is not in the sources or the ticket. Check it before sending.",
  invalid_citations: "The AI cited sources that don't exist. Those numbers were removed.",
  no_citations: "The draft cites no sources. Check it against the knowledge base before sending.",
  truncated: "The draft was cut off at the length limit. Finish it before sending.",
};

export const REFUSAL_TEXT: Record<string, string> = {
  no_passages:
    "The knowledge base has nothing to search yet, so no AI call was made. Write this reply yourself, or add help articles first.",
  below_min_score:
    "No article is close enough to this question, so no AI call was made. Write this reply yourself, or add an article that answers it.",
  model_insufficient_knowledge:
    "The articles found don't answer this question. Write this reply yourself, or add an article that answers it.",
};

export const BLOCKED_TEXT =
  "This draft was blocked for safety: the AI repeated part of its hidden instructions, a sign that the ticket may be trying to manipulate it. Write this reply yourself.";

export const FEEDBACK_REASONS = [
  { value: "incorrect", label: "Wrong or made-up information" },
  { value: "incomplete", label: "Didn't fully answer the question" },
  { value: "wrong_sources", label: "Used the wrong sources" },
  { value: "tone", label: "Tone or language" },
  { value: "other", label: "Something else" },
] as const;
