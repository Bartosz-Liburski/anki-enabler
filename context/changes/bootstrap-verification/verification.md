---
bootstrapped_at: 2026-06-27T15:40:42Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: anki-enabler
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of `context/foundation/tech-stack.md`.

```yaml
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
```

### Why this stack

A solo learner shipping a screenshot-to-flashcard MVP in 3 after-hours weeks needs auth, a database, file storage, and an LLM generation step — and no time to wire any of them by hand. 10x-astro-starter is the recommended default for `(web, js)` and ships exactly that batteries-included combination via Supabase (Postgres + auth + image storage) on a TypeScript-first stack, so FR-001 (accounts), FR-003 (screenshot upload), and per-user data isolation come mostly free. It clears all four agent-friendly gates and is bootstrapper first-class, so scaffolding should be mostly smooth with occasional manual steps. The `has_auth` and `has_ai` flags are set; payments, realtime, and background jobs are out of scope per the PRD. One watch-item carried into implementation: the Cloudflare edge runtime constrains long-running tasks, so flashcard generation must stay within the PRD's input-size/card-count caps or move to an external worker. CI runs on GitHub Actions with auto-deploy-on-merge — the starter's standard shape for a solo project.

## Pre-scaffold verification

| Signal      | Value                                                        | Severity | Notes                                                            |
| ----------- | ------------------------------------------------------------ | -------- | ---------------------------------------------------------------- |
| npm package | not run                                                      | —        | `cmd_template` starts with `git clone`; no `create-*` CLI to version-check |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17    | fresh    | from card `docs_url`; `gh api ... --jq .pushed_at` → `2026-05-17T10:33:39Z` |

Recency: przeprogramowani/10x-astro-starter last pushed 2026-05-17 (fresh, ~6 weeks before this run). Proceeded.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (clone the starter repo, drop its history, move files up)
**Exit code**: 0
**Files moved**: 18 (top-level entries)
**Conflicts (.scaffold siblings)**: CLAUDE.md → CLAUDE.md.scaffold (existing cwd CLAUDE.md preserved; starter's copy sidelined)
**.gitignore handling**: append-merged (cwd's `# Claude Code` / `.claude/` kept in order; starter's 18 lines de-duped and appended after a `# from 10x-astro-starter` separator)
**.bootstrap-scaffold cleanup**: deleted (cloned `.git/` removed before move-up so upstream history did not leak; cwd's own `.git/` untouched)

**Top-level entries moved**: astro.config.mjs, components.json, .env.example, eslint.config.js, .github, .husky, node_modules, .nvmrc, package.json, package-lock.json, .prettierrc.json, public, README.md, src, supabase, tsconfig.json, .vscode, wrangler.jsonc

**context/ preservation**: scaffold shipped no `context/` directory, so nothing to drop; cwd `context/` (prd.md, shape-notes.md, tech-stack.md, README.md) untouched.

**Toolchain note (not gating)**: `npm install` emitted EBADENGINE warnings — the starter pins Node ≥22.12 (`.nvmrc` → v22.14.0; astro@6.3.1, wrangler@4.90.0, miniflare require Node 22) but this environment ran Node v20.20.2. Install completed (exit 0), but switch to Node 22 (`nvm use`) before `npm run dev` / `npm run build`.

## Post-scaffold audit

**Tool**: `npm audit --json` (exit code 1 — non-zero because advisories exist; informational only, not a halt)
**Summary**: 0 CRITICAL, 6 HIGH, 10 MODERATE, 2 LOW (18 total)
**Direct vs transitive**: direct 0/1/3/0 of total 0/6/10/2 (CRITICAL/HIGH/MODERATE/LOW). Dependency tree: 895 total (449 prod, 316 dev, 131 optional).

#### CRITICAL findings

None.

#### HIGH findings (6 — 1 direct, 5 transitive)

- **astro** _(direct)_ — Reflected XSS via unescaped slot name; XSS via unescaped attribute names in spread props; Host header SSRF in prerendered error-page fetch; pulls vulnerable esbuild. Directly actionable: bump `astro` to a patched release.
- **devalue** _(transitive)_ — DoS via sparse-array deserialization (Svelte devalue).
- **miniflare** _(transitive)_ — via undici; ws.
- **undici** _(transitive)_ — TLS certificate validation bypass via SOCKS5 ProxyAgent; HTTP header injection via Set-Cookie percent-decoding; WebSocket DoS via fragment-count bypass; cross-origin request routing via SOCKS5 proxy pool reuse; HTTP response queue poisoning via keep-alive socket reuse; Set-Cookie SameSite downgrade; cross-user info disclosure via shared cache.
- **vite** _(transitive)_ — launch-editor NTLMv2 hash disclosure via UNC path on Windows; `server.fs.deny` bypass on Windows alternate paths.
- **ws** _(transitive)_ — uninitialized memory disclosure; memory-exhaustion DoS from tiny fragments/data chunks.

#### MODERATE findings (10 — 3 direct, 7 transitive) — log only

- **@astrojs/check** _(direct)_ — via @astrojs/language-server.
- **supabase** _(direct)_ — via tar.
- **wrangler** _(direct)_ — via esbuild; miniflare.
- **@astrojs/language-server** _(transitive)_ — via volar-service-yaml.
- **@cloudflare/vite-plugin** _(transitive)_ — via miniflare; wrangler; ws.
- **js-yaml** _(transitive)_ — quadratic-complexity DoS in merge-key handling via repeated aliases.
- **tar** _(transitive)_ — node-tar PAX size-override parser interpretation differential (file smuggling).
- **volar-service-yaml** _(transitive)_ — via yaml-language-server.
- **yaml** _(transitive)_ — stack overflow via deeply nested YAML collections.
- **yaml-language-server** _(transitive)_ — via yaml.

#### LOW / INFO findings (2 — transitive) — log only

- **@babel/core** _(transitive)_ — arbitrary file read via sourceMappingURL comment.
- **esbuild** _(transitive)_ — arbitrary file read when running the dev server on Windows.

Bootstrapper does not auto-patch. `npm audit fix` addresses the non-breaking subset; `npm audit fix --force` includes breaking changes. Decide per your project's risk tolerance.

## Hints recorded but not acted on

| Hint                    | Value                 |
| ----------------------- | --------------------- |
| bootstrapper_confidence | first-class           |
| quality_override        | false                 |
| path_taken              | standard              |
| self_check_answers      | null                  |
| team_size               | solo                  |
| deployment_target       | cloudflare-pages      |
| ci_provider             | github-actions        |
| ci_default_flow         | auto-deploy-on-merge  |
| has_auth                | true                  |
| has_payments            | false                 |
| has_realtime            | false                 |
| has_ai                  | true                  |
| has_background_jobs     | false                 |

v1 surfaces these for the audit trail but takes no automated action on them. `deployment_target`, `ci_provider`, and `ci_default_flow` are recorded but no CI/CD files were scaffolded. The `has_*` flags drove no scaffold modification. A future Memory-Architecture skill (M1L4) is the intended consumer.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Switch to Node 22 before running the dev server or build (`.nvmrc` pins v22.14.0; this run installed under Node v20.20.2 with engine warnings).
- Review `CLAUDE.md.scaffold` — the starter shipped its own AI-agent guide; diff it against your existing `CLAUDE.md` and decide which guidance to keep (`diff CLAUDE.md CLAUDE.md.scaffold`).
- Copy `.env.example` to `.env` (Node) or `.dev.vars` (Cloudflare local dev) and fill in `SUPABASE_URL` / `SUPABASE_KEY`.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The one direct HIGH (`astro`) is the most actionable.
