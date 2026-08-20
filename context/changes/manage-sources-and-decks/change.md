---
change_id: manage-sources-and-decks
roadmap_id: S-04
title: Browse and manage sources/decks
status: implementing
created: 2026-08-20
updated: 2026-08-20
prd_refs:
  - FR-005
  - FR-006
  - FR-011
---

# Browse and manage sources/decks

Roadmap slice S-04 — navigation and cleanup over the data S-01 and S-02 already create. The
dashboard becomes the deck view: every source appears as a deck, grouped by learning direction and
labelled by its first card. Each source becomes deletable from its own page, taking its flashcards
and its stored screenshot with it.

This is the slice that removes the app's biggest structural gap. Until now there has been no list
of anything: `/sources/{id}` was reachable only by the post-upload redirect or a bookmark, which is
why S-03 shipped an account-wide export on the dashboard rather than relying on per-source ones.

FR-005 rules out a separate source-browser screen, so the list lives on the dashboard rather than
at a new route. FR-011's grouping is delivered by the pair grouping in that same list rather than
as separate work.

See `plan.md` for the implementation contract and `plan-brief.md` for the two-page summary.
