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

## Local development — native (post-bootstrap addendum; Dockerized setup dropped 2026-07-17)

Local development runs **natively on the host** — no Docker. The earlier Dockerized setup (app container via `Dockerfile`/`docker-compose.yml` + the `supabase start` local stack + `make` orchestration) was removed after it proved unreliable to run locally. **Production is unaffected** — it still deploys to the platform recorded in `infrastructure.md`.

The host needs **Node 22.14.0** — see `.nvmrc`; it matches Astro 6's `>=22.12` engine floor. Run `nvm use` (or install that Node) before working on the project.

**App runtime — `npm run dev`:**
- `npm install` once, then `npm run dev` (`astro dev`) serves the app at http://localhost:4321 with live reload.
- `SUPABASE_URL` / `SUPABASE_KEY` come from a project-root `.env`. Both are `optional: true` in `astro.config.mjs`, so the dev server, type-check, and lint all boot without keys — only the auth flows need the key set.

**Supabase backend — hosted (cloud) project.** Point `SUPABASE_URL` / `SUPABASE_KEY` at a Supabase cloud project (dashboard → Settings → API). The `supabase` CLI (a devDependency) and `supabase/config.toml` are **kept** in the repo for optional CLI use — migrations, `supabase link` against the cloud project — but running the full Supabase stack locally in Docker (`supabase start`) is no longer part of the dev loop.

**Checks (mirror CI):** run `npx astro sync && npx astro check && npm run lint` natively — no Supabase needed. There is no unit-test runner yet; add Vitest/Playwright later if real unit/E2E tests are wanted.
