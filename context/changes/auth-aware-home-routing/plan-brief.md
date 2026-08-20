# Auth Aware Home Routing — Plan Brief

> Full plan: `context/changes/auth-aware-home-routing/plan.md`

## What & Why

Two UI complaints from a post-MVP review turned out to be one root cause: `/` never checks auth state. A logged-in user sees the logged-out marketing hero (Sign In / Sign Up) even though the top bar already shows their email, and the dashboard — the app's actual main view — reads as a small centered popup rather than the primary post-login surface.

## Starting Point

Sign-in already redirects to `/` on success (`src/pages/api/auth/signin.ts:19`), landing users on `Welcome.astro`'s unguarded CTA. `Topbar.astro` already branches correctly on `Astro.locals.user`; `Welcome.astro` never reads it. `dashboard.astro` is already a real, middleware-protected full page — not a modal — but its `items-center justify-center` + `max-w-2xl` card wrapper makes it look like a floating popup.

## Desired End State

Authenticated visitors to `/` land straight on a wider, top-anchored `/dashboard` with no hero flash. Logged-out visitors still see today's hero unchanged. The dead "Leave dashboard" link is gone.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Redirect location | `src/middleware.ts` | Matches the existing pair-recall redirect pattern already in that file; fires before render, no flash. |
| Dashboard layout depth | Widen (`max-w-2xl` → `max-w-4xl`) + top-anchor, not full app-shell redesign | Reuses the codebase's existing "wide section" convention (`Welcome.astro`'s `max-w-4xl`); a full redesign risked ballooning scope. |
| Welcome CTA guard | Add `{!user && ...}` guard anyway | One-line defense-in-depth even though the redirect should make it unreachable for authed users. |
| Redirect query string | Drop it | `/` carries no meaningful query params today; nothing is lost. |
| Scope | Both fixes in one change, one phase | Reported together as one review pass; combining avoids a second round-trip. |

## Scope

**In scope:**
- `/` → `/dashboard` redirect for authenticated users (middleware)
- `Welcome.astro` CTA guarded on auth state
- `dashboard.astro` widened, top-anchored layout
- Removing the now-dead "Leave dashboard" link

**Out of scope:**
- Full multi-panel dashboard redesign
- Sign-up flow changes
- `/sources` or other protected-route behavior

## Architecture / Approach

One phase, five small edits across `src/middleware.ts`, `src/pages/index.astro`, `src/components/Welcome.astro`, and `src/pages/dashboard.astro`. No new dependencies, no data model changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Auth-aware home routing and full-page dashboard | Redirect + CTA guard + widened dashboard layout + dead-link cleanup | Layout tweak is a visual judgment call — manual check confirms it no longer "pops up" |

**Prerequisites:** None — builds on existing middleware and auth state already in place.
**Estimated effort:** Single small session, one phase.

## Open Risks & Assumptions

- Assumes no other route relies on `/` rendering `Welcome` for authenticated users (none found).
- Layout widen is a visual judgment call, not a hard metric — manual verification is the real gate here.

## Success Criteria (Summary)

- Logging in lands the user directly on a full-width `/dashboard`, no hero flash.
- Visiting `/` while authenticated always redirects to `/dashboard`; logged-out `/` is unchanged.
- Dashboard no longer reads as a popup; "Leave dashboard" dead link is gone.
