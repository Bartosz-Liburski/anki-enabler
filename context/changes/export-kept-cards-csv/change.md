---
change_id: export-kept-cards-csv
roadmap_id: S-03
title: Export kept flashcards to CSV
status: implementing
created: 2026-08-11
updated: 2026-08-11
prd_refs:
  - FR-012
---

# Export kept flashcards to CSV

Roadmap slice S-03 — the last step of the core loop. A user downloads their kept flashcards
(those not discarded during review) as a CSV file that imports cleanly into Anki, either for a
single source or for their whole account.

Builds on S-02 (generate-and-review-cards), which established what "kept" means: the complement
of the `discarded` flag, as the flashcards migration itself states while naming this slice as the
consumer. No schema change is needed here — export is a pure read.

The roadmap listed this slice as `blocked` on Open Roadmap Question #1 (exact CSV column layout).
That question was resolved during planning: comma-delimited RFC-4180 with `front,back,tags`
columns behind an Anki directive block. See `plan-brief.md` for the decision table and `plan.md`
for the implementation contract.
