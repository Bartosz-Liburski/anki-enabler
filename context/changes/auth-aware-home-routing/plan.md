# Auth Aware Home Routing Implementation Plan

## Overview

Two symptoms reported from the same root cause: the home page (`/`) does not check auth state, so a logged-in user sees the logged-out marketing hero (Sign In / Sign Up buttons) even though the top bar already shows their email, and the dashboard — the app's actual primary view post-login — reads visually as a small centered popup card rather than the main app surface. Sign-in already redirects to `/` on success (`src/pages/api/auth/signin.ts:19`), so fixing `/` to hand authenticated users straight to `/dashboard`, plus widening that page's layout, closes both complaints in one pass.

## Current State Analysis

- `src/pages/index.astro:1-8` renders `<Welcome />` unconditionally — it never reads `Astro.locals.user`.
- `src/components/Welcome.astro:40-53` always renders the Sign In / Sign Up CTA, regardless of auth state.
- `src/components/Topbar.astro:2,9-22` correctly branches on `Astro.locals.user` (shows email + Dashboard link + sign-out when authenticated) — this is the pattern to follow.
- `src/middleware.ts:9-19` sets `context.locals.user` on every request; `src/middleware.ts:7,21-25` already redirects unauthenticated visitors away from protected routes (`/dashboard`, `/sources`); `src/middleware.ts:30-48` already redirects `/dashboard` visits based on cookie state (pair recall) — an established precedent for route-specific redirect logic living in middleware.
- `src/pages/api/auth/signin.ts:19` redirects to `/` on successful login — this is the entry point that currently lands users back on the unguarded hero.
- `src/pages/dashboard.astro:80-253` is already a real, middleware-protected page (not a modal/dialog — none exists anywhere in the codebase). Its outer wrapper (`dashboard.astro:81-84`) is `flex min-h-screen items-center justify-center p-4` around a `w-full max-w-2xl rounded-2xl ... backdrop-blur-xl` card, which is what makes a real full page visually read as a floating popup.
- `src/pages/dashboard.astro:236-241` has a "Leave dashboard" link to `/` — once `/` redirects authenticated users straight back to `/dashboard`, this link becomes a dead no-op.
- Width convention already established in the codebase: `max-w-4xl` is the "wide section" width (`src/components/Welcome.astro:31,57`); `max-w-2xl` is used for narrower card contexts (`dashboard.astro:83`, `src/pages/sources/[id].astro:64`). No `max-w-5xl`/`6xl` exists anywhere, so widening the dashboard should reuse `max-w-4xl` rather than introduce a new value.

## Desired End State

- Visiting `/` while authenticated redirects (server-side, no flash) to `/dashboard`.
- Visiting `/` while logged out still shows today's marketing hero unchanged.
- `Welcome.astro`'s Sign In / Sign Up CTA is itself guarded on `user` as defense-in-depth, independent of the redirect.
- `/dashboard` reads as the app's main full-page view: content anchored near the top of a wider (`max-w-4xl`) container instead of a narrow card vertically centered on the screen.
- The dead "Leave dashboard" link is removed from `/dashboard`; "Sign out" remains the only exit action.

Verify by: logging in and landing directly on a full-width dashboard with no hero flash; navigating to `/` afterward (e.g. re-typing the URL) and landing back on `/dashboard` instead of the hero; logging out and confirming `/` shows the normal Sign In / Sign Up hero again.

## What We're NOT Doing

- No multi-panel / sidebar app-shell redesign of the dashboard — only widening and top-anchoring the existing single-card layout.
- No changes to the sign-up flow (`/auth/confirm-email` redirect stays as-is).
- No forwarding of query strings on the new `/` → `/dashboard` redirect — `/` carries no meaningful query params today.
- No changes to `/sources` or other protected-route behavior.

## Implementation Approach

Add the `/` → `/dashboard` redirect to `src/middleware.ts`, next to the existing `PROTECTED_ROUTES` check, since that file is already the single place route-specific auth/redirect rules live. Thread `Astro.locals.user` from `index.astro` into `Welcome.astro` as a prop so its CTA can guard on it the same way `Topbar.astro` already does. Widen and top-anchor `dashboard.astro`'s outer wrapper and drop the now-dead "Leave dashboard" link in the same pass, since both are edits to the same markup block.

## Phase 1: Auth-aware home routing and full-page dashboard

### Overview

Redirect authenticated visitors away from the logged-out home hero straight to `/dashboard`, guard the hero's CTA as a backstop, and restyle the dashboard container so it reads as the app's main view instead of a centered popup card.

### Changes Required:

#### 1. Middleware redirect

**File**: `src/middleware.ts`

**Intent**: When an authenticated user requests `/`, redirect them to `/dashboard` before any page renders, mirroring the existing protected-route and pair-recall redirect logic already in this file.

**Contract**: Add a check after `context.locals.user` is resolved (after `middleware.ts:19`): if `context.url.pathname === "/"` and `context.locals.user` is set, `return context.redirect("/dashboard")`. No query string is forwarded.

#### 2. Home page passes auth state to Welcome

**File**: `src/pages/index.astro`

**Intent**: Give `Welcome` the auth state it needs to guard its own CTA.

**Contract**: Read `const { user } = Astro.locals;` in the frontmatter and pass `user={user}` to `<Welcome />`.

#### 3. Welcome CTA guarded on auth state

**File**: `src/components/Welcome.astro`

**Intent**: Defense-in-depth — even if reached without the middleware redirect firing, an authenticated user should never see the Sign In / Sign Up CTA.

**Contract**: Accept a `user` prop (typed to match `Astro.locals.user`, i.e. nullable) and wrap the existing Sign In / Sign Up block (`Welcome.astro:40-53`) in `{!user && (...)}`. Everything else in the file (hero copy, feature cards) is unaffected and renders regardless of auth state.

#### 4. Dashboard full-page layout

**File**: `src/pages/dashboard.astro`

**Intent**: Make the dashboard read as the primary full-page app view rather than a floating card.

**Contract**: Change the outer wrapper at `dashboard.astro:81` from `flex min-h-screen items-center justify-center p-4` to a top-anchored equivalent (e.g. `flex min-h-screen justify-center p-4 pt-12`), and widen the inner card at `dashboard.astro:83` from `max-w-2xl` to `max-w-4xl`, matching the codebase's existing wide-section convention.

#### 5. Remove dead "Leave dashboard" link

**File**: `src/pages/dashboard.astro`

**Intent**: Once `/` bounces authenticated users straight back to `/dashboard`, the "Leave dashboard" link (`dashboard.astro:236-241`) has nowhere useful to go.

**Contract**: Remove the "Leave dashboard" `<a>` element; keep the "Sign out" form as the sole action in that footer row.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (includes Astro type checking) passes: `npm run build`

#### Manual Verification:

- Log in via `/auth/signin` and land directly on the full-width `/dashboard`, no hero flash.
- While logged in, navigate directly to `/` (e.g. type it in the address bar) and confirm it redirects to `/dashboard`.
- Log out, then visit `/` and confirm the normal Sign In / Sign Up hero renders (no regression for logged-out visitors).
- On `/dashboard`, confirm the card now spans a wider container and starts near the top of the viewport rather than floating centered — no lingering "popup" feel.
- Confirm the "Leave dashboard" link is gone and "Sign out" still works.

**Implementation Note**: After completing this phase and automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Manual Testing Steps:

1. Fresh incognito session: visit `/`, confirm hero + Sign In/Sign Up renders.
2. Sign in with a real account; confirm landing page is `/dashboard`, full width, top-anchored.
3. With the session still active, visit `/` directly; confirm immediate redirect to `/dashboard`.
4. Sign out from `/dashboard`; confirm redirect/landing back on the logged-out `/` hero.
5. Confirm `/sources/[id]` and other protected routes are unaffected (spot-check one).

## References

- Related bug report: user-reported UI review of the post-MVP home page.
- Existing pattern followed: `src/middleware.ts:30-48` (pair-recall redirect), `src/components/Topbar.astro:2,9-22` (auth-state branching).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth-aware home routing and full-page dashboard

#### Automated

- [x] 1.1 Lint passes: `npm run lint`
- [x] 1.2 Build (includes Astro type checking) passes: `npm run build`

#### Manual

- [x] 1.3 Log in via `/auth/signin` and land directly on the full-width `/dashboard`, no hero flash
- [x] 1.4 While logged in, navigate directly to `/` and confirm redirect to `/dashboard`
- [x] 1.5 Log out, visit `/`, confirm normal Sign In / Sign Up hero renders
- [x] 1.6 Confirm `/dashboard` card spans a wider container and starts near the top of the viewport
- [x] 1.7 Confirm "Leave dashboard" link is gone and "Sign out" still works
