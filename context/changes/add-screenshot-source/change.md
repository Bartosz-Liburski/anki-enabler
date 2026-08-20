---
change_id: add-screenshot-source
roadmap_id: S-01
title: Add a screenshot source and set its learning direction
status: implemented
created: 2026-07-25
updated: 2026-07-30
prd_refs:
  - FR-002
  - FR-003
  - NFR (input size cap)
---

# Add a screenshot source and set its learning direction

Roadmap slice S-01. Let a signed-in user upload a screenshot image as a *source* and set
that source's learning direction (the foreign language being learned + the language they
already know), persisting the image to Supabase Storage and the metadata to the `sources`
table — with the input size/format cap enforced before anything is stored. This is the
input that S-02 (generate-and-review-cards) consumes.

Builds on F-01 (per-user-data-isolation), which created `sources`/`flashcards` with
per-user RLS. This slice adds `sources` feature columns via an additive migration, stands
up the project's first Storage bucket and first domain endpoint, and gives the dashboard
its first real interaction.

See `plan.md` for the implementation contract and `plan-brief.md` for the two-page summary.
