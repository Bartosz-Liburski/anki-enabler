---
starter_id: 10x-astro-starter
package_manager: npm
project_name: anki-enabler
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

A solo learner shipping a screenshot-to-flashcard MVP in 3 after-hours weeks needs auth, a database, file storage, and an LLM generation step — and no time to wire any of them by hand. 10x-astro-starter is the recommended default for `(web, js)` and ships exactly that batteries-included combination via Supabase (Postgres + auth + image storage) on a TypeScript-first stack, so FR-001 (accounts), FR-003 (screenshot upload), and per-user data isolation come mostly free. It clears all four agent-friendly gates and is bootstrapper first-class, so scaffolding should be mostly smooth with occasional manual steps. The `has_auth` and `has_ai` flags are set; payments, realtime, and background jobs are out of scope per the PRD. One watch-item carried into implementation: the Cloudflare edge runtime constrains long-running tasks, so flashcard generation must stay within the PRD's input-size/card-count caps or move to an external worker. CI runs on GitHub Actions with auto-deploy-on-merge — the starter's standard shape for a solo project.

## Local development — Dockerized (post-bootstrap addendum, 2026-06-27)

Local development runs entirely in Docker so the host needs no per-project language runtimes (no local Node). **Production is not containerized** — it still deploys to Cloudflare.

The host needs only three tools: **Docker**, the **`supabase` CLI** (a single standalone binary — not a language runtime, shared across all projects), and **make**.

**App runtime — `Dockerfile` + `docker-compose.yml` (`app` service):**
- `node:22-bookworm-slim`, matching `.nvmrc` (v22.14.0) and Astro 6's `>=22.12` engine floor. Host Node version is irrelevant.
- Binds the source for live reload; keeps `node_modules` in a named volume so a host install never shadows the container's.
- Exposes the Astro dev server on `:4321`.
- Reaches the local Supabase stack at `http://host.docker.internal:54321` (via `extra_hosts: host-gateway`); `SUPABASE_URL` / `SUPABASE_KEY` are overridable from a project-root `.env`. Both are `optional: true` in `astro.config.mjs`, so the dev server, type-check, and lint all boot without keys — auth flows just need the key set.

**Supabase backend — managed by the `supabase` CLI, not hand-authored in compose.** Supabase local dev is *already* fully Docker-based: `supabase start` reads the existing `supabase/config.toml` and runs the whole stack (Postgres, Auth/GoTrue, Storage, PostgREST, Studio) as Docker containers (API `:54321`, DB `:54322`, Studio `:54323`). Re-implementing those services in our own compose was deliberately rejected — it duplicates what the CLI maintains for free (versioning, migrations, seeding, key generation) with no benefit to the clean-host goal, since both run in Docker regardless.

**Makefile entry points:**
- `make up` (alias `make dev`) — `supabase start` then the app dev server (foreground) at http://localhost:4321.
- `make test` — automated-test entry point: runs `astro sync` + `astro check` + `eslint` inside the Node 22 container (no local Node, no Supabase needed). Mirrors CI. There is no unit-test runner yet; add Vitest/Playwright later if real unit/E2E tests are wanted.
- `make build` — build the app image.
- `make status` — print local Supabase URLs + keys (copy `ANON_KEY` into `.env` as `SUPABASE_KEY` for auth).
- `make down` / `make clean` — stop the app + Supabase / also drop volumes and local Supabase data.

Known minor caveat: the app container runs as root, so files it writes into the bind mount (e.g. Astro's gitignored `.astro/` types) are root-owned on the host. Acceptable for an MVP; a UID mapping can fix it later if it becomes annoying.
