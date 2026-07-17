---
project: Anki enabler
researched_at: 2026-07-17
recommended_platform: Vercel
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6
  runtime: Node 22 (deployed as Vercel Node serverless functions)
---

## Recommendation

**Deploy on Vercel (free Hobby tier, Node serverless functions).**

Vercel is the lowest-friction fit for this exact stack: `@astrojs/vercel` v10 makes Astro 6 SSR + server endpoints first-class on a real Node runtime, so `@supabase/ssr`, the LLM SDK, and any native image handling "just work" — none of the workerd/edge-runtime quirks that a serverless-edge platform would impose. The decision's make-or-break axis (a flashcard-generation endpoint that awaits an external LLM for tens of seconds) is resolved cleanly: with Fluid Compute on by default, the **free** Hobby tier allows functions to run up to **300 seconds**, and Active-CPU billing pauses CPU charges while the function waits on the LLM's I/O. For a cost-sensitive solo hobbyist at very low traffic this is effectively **$0/mo**, with no usage-based overage to produce a surprise bill.

This was **not** the pre-tilted favorite. The tech-stack hand-off carried `deployment_target: cloudflare-pages` and the developer answered "familiar with Cloudflare," so Cloudflare Workers led the initial scoring. The anti-bias cross-check then surfaced enough genuine, stack-specific friction on Cloudflare — SSR-on-`workerd` footguns, the screenshot/image pipeline missing native libs, a 10 ms free-tier CPU cliff, and local-Node-vs-prod-`workerd` divergence — that the developer consciously swapped to the runner-up. Vercel removes all of that at the same $0. Its own risks (a non-commercial Hobby license and a Fluid-Compute/instance-reuse footgun) are real but designable-around, and are captured in the risk register below.

## Platform Comparison

All facts checked **2026-07-17** via parallel web research against official docs. Every candidate supports Astro 6 SSR; the LLM-await concern turned out to be a non-issue on all six, for different reasons.

| Platform | CLI-first | Managed / serverless | Agent-readable docs | Stable deploy API | MCP / integration | Est. cost (min-cost weight) |
|---|---|---|---|---|---|---|
| **Vercel** ⭐ | Pass | Pass | Pass | Pass | Pass (beta) | **$0** Hobby (non-commercial); $20/mo Pro if monetized |
| **Netlify** | Pass | Pass | Pass | Pass¹ | Pass (GA) | **$0** (300 credits/mo; spike burns quota) |
| **Cloudflare Workers** | Pass | Pass | Pass | Pass² | Pass³ | **$0** free / $5 clean paid |
| **Railway** | Pass | Pass | Pass | Pass | Pass⁴ | $5/mo floor (no free tier) |
| **Render** | Pass | Pass | Pass | Pass | Partial⁵ | $0 w/ ~1-min cold start · $7/mo always-on |
| **Fly.io** | Pass | Partial⁶ | Pass | Pass | Partial⁷ | ~$2–3/mo (no free tier) |

¹ No CLI rollback verb — rollback = republish a prior atomic deploy (UI/API).
² `wrangler deploy` is deterministic, but the `nodejs_compat` / process-v2 config footgun can silently break SSR output until flagged.
³ Multiple official OAuth MCP servers (observability, bindings, builds, docs), but Cloudflare publishes no per-server GA/beta label — treat as live-but-unversioned.
⁴ Official MCP (local + remote OAuth) but Railway's own docs still label it "a work in progress."
⁵ Hosted MCP supports Claude Code but is not labeled GA, blocks destructive/scaling ops, and warns secrets may enter agent context.
⁶ Managed Firecracker VMs, but you own a Dockerfile and pick regions — more infra surface than pure PaaS; cold starts on auto-stop wake.
⁷ flyctl MCP self-registers with Claude but is **experimental** (checked 2026-07-17).

**Why the LLM call isn't a blocker anywhere:**

| Platform | Mechanism |
|---|---|
| Vercel | Fluid Compute (default) → 300s on free Hobby; CPU billing pauses during I/O wait |
| Cloudflare | Bills **CPU time, not wall-clock**; awaiting `fetch()` is explicitly excluded; no duration cap |
| Netlify | 60s synchronous limit, all tiers (tightest margin; verify live value on the account) |
| Fly.io | Long-running container — no function timeout (60s proxy idle cap only) |
| Railway | Long-running container — no function timeout (15-min ceiling; 5-min cutoff only if no data transfers) |
| Render | Persistent Web Service — 100-min request ceiling, no function timeout |

**Applied weights (from the developer interview):** *No persistent connections* → no hard filter, all six stayed in the pool. *Minimize cost* → knocked Railway (\$5 floor), Fly (no free) and Render-always-on (\$7) down the list. *Single region is fine* → cancelled the edge-global bonus that would otherwise have lifted Cloudflare/Vercel. *Cloudflare familiarity* → initially broke the top-tie in Cloudflare's favour. *Co-location unknown* → neutral; Supabase stays the external data/auth/storage layer.

### Shortlisted Platforms

#### 1. Vercel (Recommended)

Node-serverless runtime means the Astro-SSR + `@supabase/ssr` + LLM-SDK combination runs without runtime-compat workarounds. 300s free duration removes the timeout worry with wide margin; Active-CPU billing makes the long LLM wait nearly free. Complete scriptable CLI (`vercel`, `--prod`, `rollback`, `logs`, `env`), automatic per-branch preview deployments, instant routing-layer rollback, `llms.txt` + markdown docs + OpenAPI/SDK, and an official OAuth MCP (`mcp.vercel.com`, public beta) that lists Claude Code as an approved client. **Gap vs. an ideal:** Hobby is non-commercial-use only, and Fluid-Compute instance reuse demands per-request Supabase client instantiation.

#### 2. Netlify (Runner-up)

The cleanest fallback if Vercel's non-commercial license or credit model becomes a problem — it preserves the property that drove the swap away from Cloudflare (Node Functions, no `workerd` quirks) and has **no** non-commercial restriction. $0 credit-based free tier, **GA** MCP server (`@netlify/mcp`, local or remote), `netlify deploy` is draft-by-default with an explicit `--prod` (a safe agent default), `llms.txt` + `.md`-per-page docs, unlimited Deploy Previews. **Gap vs. the recommendation:** the 60s synchronous Function limit is the tightest of the finalists (adequate for a ≤40s call, but verify the live value — 2026 forum threads still cite legacy 10s/26s numbers); the credit model meters everything continuously, so a traffic/bandwidth spike burns the free 300 credits fast; rollback has no CLI verb.

#### 3. Cloudflare Workers (Third)

The original leader on familiarity + truly-unrestricted cost ($0 free / $5 clean paid, no license strings, no egress fees), and still the strongest on those two axes. Demoted to third by the developer's own decision after the cross-check exposed SSR-on-`workerd` friction specific to this stack. **Gap vs. the recommendation:** `workerd` is not Node — `@supabase/ssr` needs `nodejs_compat`, SSR routes can silently return `[object Object]` until `disable_nodejs_process_v2` is set, the screenshot pipeline has no native image libs, the free tier caps *CPU-time* at 10 ms/request (a heavy render can exceed it), and local dev (Node 22, via the project's Dockerized `make dev`) diverges from prod (`workerd`). Note: the `cloudflare-pages` hand-off is stale — `@astrojs/cloudflare` v14 is **Workers-only**; if Cloudflare is ever reconsidered, the target is Workers with `wrangler deploy`, not Pages.

## Anti-Bias Cross-Check: Vercel

The three lenses were run first on Cloudflare (the pre-tilted leader), which prompted the swap; they were then re-run on Vercel as the new leader. The Vercel findings below are what carry into the risk register.

### Devil's Advocate — Weaknesses

1. **Non-commercial Hobby license is a step-function cost cliff.** Free is personal-use only; the moment the tool takes payments, shows ads, or becomes client work it must move to Pro at $20/dev/mo — a wall, not gradual overage.
2. **Fluid-Compute instance reuse → session-leak footgun.** Vercel reuses function instances. A Supabase client initialized at *module scope* (the naive pattern) leaks auth sessions between users — directly violating the PRD's "no cross-user access" NFR. The client must be instantiated per-request.
3. **The 300s timeout depends on Fluid Compute staying enabled.** Disable it, or let a config regression flip it, and Hobby silently reverts to the legacy 10s cap — the ≤40s LLM call then times out *in production only*.
4. **Stale adapter docs.** `@astrojs/vercel` v10 removed the `/serverless` and `/static` subpath imports (import from package root now), but Vercel's own duration docs still show the old `/serverless` import — an agent copying docs verbatim writes broken config.
5. **Vendor gravity toward Vercel KV / Postgres / Blob.** Staying Supabase-external is correct, but tutorials and agent suggestions constantly pull toward Vercel's own data products — creeping lock-in and a second bill.

### Pre-Mortem — How This Could Fail

The MVP shipped fast and worked in testing. The first problem was silent: the Supabase client was initialized at module scope, and under Fluid Compute's instance reuse, authenticated sessions occasionally bled between users — one learner briefly saw another's decks, violating the core privacy guarantee, and surfacing only under concurrent load, so it wasn't caught until a user reported it. Fixing it meant auditing every server endpoint for per-request client instantiation. Then the project gained a few paying supporters, which tripped Vercel's non-commercial Hobby clause; the account was flagged and they scrambled onto Pro at $20/mo mid-launch. Later, a routine dependency bump quietly disabled Fluid Compute in config, reverting functions to the 10s cap — the flashcard-generation endpoint began timing out in production but never locally, costing a day of "works-on-my-machine" debugging. Each fire was individually small, but the combination — a privacy bug, a licensing scramble, and an environment-only timeout — consumed the after-hours budget and eroded the "it just works" promise that had motivated choosing Vercel over Cloudflare in the first place.

### Unknown Unknowns

- **Fluid Compute is a silent load-bearing dependency** — the entire "300s on free" story hinges on one setting; pin it and add a startup/CI assertion, because its failure mode (10s timeout) appears only in production.
- **Module-scope singletons are unsafe here** in a way they aren't on a long-running Node server — instance reuse turns the familiar "initialize once" pattern into a cross-user data-leak vector.
- **"Non-commercial" is enforced, not honorary** — Vercel does flag monetizing Hobby projects; the cost isn't gradual overage, it's a $20/mo wall hit the moment the product's status changes.
- **No usage-based overage cuts both ways** — exceeding a Hobby limit *pauses* the feature (~30 days) rather than billing you. Great for no-surprise-bills, but a spike takes the app *down* instead of costing money — a different failure mode from every other candidate here.
- **Supabase-external latency is per-call and additive** — Vercel functions and Supabase are separate networks; if the function region and the Supabase project region drift apart (easy to misconfigure), every DB round-trip slows. Pin both to the same region.

## Operational Story

How Vercel actually operates day to day for this project. One concrete answer per axis.

- **Preview deploys**: Automatic. Vercel's Git integration builds every branch and pull request into a unique preview URL (`<project>-<hash>.vercel.app`) with no extra config — this *is* the `auto-deploy-on-merge` flow the tech-stack hand-off wanted, so a hand-rolled GitHub Actions deploy job is optional rather than required. Fork-PR previews are gated for safety (secrets aren't exposed to untrusted forks).
- **Secrets**: Environment variables live in Vercel's project settings (or via `vercel env add`), scoped independently to Production / Preview / Development; pull them locally with `vercel env pull .env`. `SUPABASE_URL` / `SUPABASE_KEY` and the LLM API key go here — never committed. Rotation = update the var + redeploy (or re-pull for local). If CI deploys, store a scoped `VERCEL_TOKEN` in GitHub Actions Secrets, not in the repo.
- **Rollback**: `vercel rollback <deployment-url-or-id>` re-points the production alias to a prior deployment at the routing layer — seconds, no rebuild (or the dashboard "Instant Rollback" button). Caveat: rollback reverts *code only* — a Supabase schema migration that already ran does **not** roll back with it; treat DB migrations as forward-only and additive.
- **Approval**: The agent may deploy previews, tail logs, pull/list env vars, and run `vercel --prod` for routine releases unattended. Human-only: promoting a schema-breaking migration, rotating the primary Supabase service key or LLM API key, changing the plan/billing tier, and deleting the project — all done by hand in the dashboard even when the agent suggests them.
- **Logs**: `vercel logs <deployment-url> --follow` streams runtime logs read-only; `vercel deploy --logs` surfaces build output; the Vercel MCP server (`mcp.vercel.com`, public beta) exposes structured deployment/log tools for Claude Code if CLI parsing becomes a bottleneck. Start with the CLI; add the MCP only if a recurring class of live-state queries makes it worth the context cost.

## Risk Register

Every row names the lens that surfaced it, so a future reader can audit *why* it's on the list.

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Module-scope Supabase client leaks sessions between users under Fluid Compute instance reuse (violates "no cross-user access" NFR) | Devil's advocate / Pre-mortem | M | H | Instantiate the Supabase client **per request** inside each handler; use cookie-based `@supabase/ssr` with PKCE; add a review checklist item and, if feasible, a lint rule against module-scope client creation |
| Fluid Compute disabled by config regression → Hobby silently reverts to 10s cap → LLM endpoint times out in prod only | Unknown unknowns / Pre-mortem | M | H | Keep Fluid Compute explicitly on; assert it in CI or a startup check; set an explicit `maxDuration` in function config; test the generation endpoint against a slow-LLM case in a preview deploy |
| Non-commercial Hobby license tripped if the project ever monetizes → forced $20/mo Pro mid-flight | Devil's advocate / Unknown unknowns | L (MVP) / M (later) | M | Stay non-commercial for the MVP; budget $20/mo Pro as the known first paid step; revisit the platform choice (Cloudflare = truly unrestricted $0/$5) if a paid model is planned |
| Hobby limit exceeded → feature *pauses* (~30 days) instead of billing → app goes down on a spike | Unknown unknowns | L | M | Monitor usage in the dashboard; know that the failure mode is downtime, not cost; upgrade to Pro proactively if traffic grows |
| Supabase region drifts from Vercel function region → per-call DB latency on every request | Unknown unknowns | M | M | Pin the Vercel project and the Supabase project to the same region at setup; keep DB round-trips per request minimal |
| Agent copies stale `/serverless` import or old adapter config from platform docs → broken build | Devil's advocate / Research finding | M | L | Use `@astrojs/vercel` v10 root import; run `npx astro add vercel` rather than hand-writing config; verify against the Astro adapter docs, not Vercel's duration page |
| CDN caches `Set-Cookie` token-refresh responses → broken/leaked sessions | Research finding | L | H | Use `@supabase/ssr` ≥ 0.10 and honour the cache headers it passes to `setAll`; never cache authenticated responses |
| Screenshot upload latency / cost if processed server-side (FR-003) | Research finding | L | M | Upload images straight to Supabase Storage; keep the Vercel function to orchestration + the LLM call, not heavy image processing |
| Vendor gravity pulls toward Vercel KV/Postgres/Blob → creeping lock-in + second bill | Devil's advocate | L | L | Keep the data/auth/storage layer on Supabase by convention; document Supabase as the single source of truth in AGENTS.md |

## Getting Started

Version-accurate for `@astrojs/vercel` v10 on Astro 6 with the project's Dockerized local-dev setup — **not** copied from platform marketing.

1. **Add the adapter** (sets `output: 'server'` and wires the adapter for you):
   ```bash
   npx astro add vercel
   ```
   Import from the package root — `import vercel from '@astrojs/vercel'` — **not** the removed `@astrojs/vercel/serverless` subpath.
2. **Keep local dev as-is.** The Astro dev server already renders SSR routes and server endpoints faithfully, so `make dev` (the project's Dockerized `astro dev` on Node 22) stays the local loop — you do **not** need `vercel dev` for Astro. Local (Node 22) ≈ prod (Vercel Node functions), so behaviour matches, unlike the Cloudflare `workerd` path that was rejected.
3. **Instantiate Supabase per-request.** In every server endpoint / middleware, create the `@supabase/ssr` client *inside* the handler (cookie-based, PKCE) — never at module scope. This is the single most important correctness step (see risk register).
4. **Set the generation endpoint's duration and confirm Fluid Compute.** Give the flashcard-generation route an explicit `maxDuration` (e.g. 60) via Astro's Vercel adapter config, and confirm Fluid Compute is enabled on the project so the free tier's 300s ceiling applies.
5. **Wire deploys via Git integration** (simplest, matches `auto-deploy-on-merge`): import the repo in Vercel, set `SUPABASE_URL`, `SUPABASE_KEY`, and the LLM API key as environment variables (Production + Preview), and pin the project region to match the Supabase project region. Pushes to `main` deploy to production; PRs get preview URLs automatically. For CLI-driven deploys instead, use `vercel` (preview) / `vercel --prod` with a scoped `VERCEL_TOKEN`.

## Out of Scope

The following were not evaluated in this research:
- Docker **image** configuration and Dockerfiles (the project's Docker setup is local-dev only; production is Vercel serverless, not containerized).
- CI/CD pipeline authoring (Vercel's Git integration covers auto-deploy; a bespoke GitHub Actions deploy job is optional).
- Production-scale architecture — multi-region, high-availability, disaster recovery.
- The Supabase data/auth/storage layer's own hosting and scaling (external managed service; billed separately).
