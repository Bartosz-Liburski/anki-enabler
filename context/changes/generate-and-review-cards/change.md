---
change_id: generate-and-review-cards
roadmap_id: S-02
title: Generate flashcards from a source and review them (keep/discard)
status: planned
created: 2026-07-30
updated: 2026-07-30
prd_refs:
  - FR-007
  - FR-008
  - FR-009
  - FR-010
  - US-01
  - NFR (input size cap / cost bound)
---

# Generate flashcards from a source and review them (keep/discard)

Roadmap slice S-02 — the product's north star. Trigger generation for a stored screenshot
source, get capped Q/A flashcards oriented learned → known (reusing a translation present in
the source, producing one when absent), re-generate to replace the set, and review the cards
on a single screen, discarding the weak ones. A source that yields no usable cards shows an
explanatory state rather than a silent empty result.

Builds on S-01 (add-screenshot-source), which stores the image privately and tags it with the
learning direction. This slice stands up the project's entire LLM surface — SDK, API key,
prompt, structured-output schema, timeout budget — and its first multi-record write, then adds
the review screen on top.

Carries the product's riskiest assumption: the ≥ 75%-kept quality bar (`prd.md:36`). Both
research documents conclude that bar is unmeasurable without a labelled eval set, so this plan
builds one as a phase rather than deferring it.

See `plan.md` for the implementation contract and `plan-brief.md` for the two-page summary.
Model-selection research: `research-claude.md` (Anthropic surface) and `research-exa-ai.md`
(cross-vendor comparison).
