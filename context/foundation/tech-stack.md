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
