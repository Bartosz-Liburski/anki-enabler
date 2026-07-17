.PHONY: up dev test build down clean status supabase-up supabase-down check-supabase

# Local dev runs entirely in Docker: the Supabase backend (Postgres/Auth/Storage/Studio)
# via its CLI, and the app dev server in a Node 22 container. The host needs only
# Docker + the `supabase` CLI (a single standalone binary, not a language runtime).
# Production is NOT containerized — it deploys to Cloudflare.

# --- One-command local dev ---

# Bring up the whole stack: Supabase backend, then the app dev server (foreground).
# First `supabase start` pulls ~10 images and runs migrations/seed — slow once, fast after.
up: supabase-up
	docker compose up app

# Alias for `up`.
dev: up

# --- App container ---

# Build the Node 22 image. Run once, or after dependency changes.
build:
	docker compose build

# Run the project's automated checks inside the container (Node 22) — no local Node needed.
# Generates Astro types, type-checks, then lints. Does not require Supabase to be running.
test:
	docker compose run --rm --build app sh -c "npx astro sync && npx astro check && npm run lint"

# --- Supabase backend (CLI-managed Docker stack) ---

supabase-up: check-supabase
	supabase start

supabase-down: check-supabase
	supabase stop

# Print local Supabase URLs + keys. Copy ANON_KEY into .env as SUPABASE_KEY for auth flows.
status: check-supabase
	supabase status

check-supabase:
	@command -v supabase >/dev/null 2>&1 || { \
		echo "The 'supabase' CLI is not installed (standalone binary, no Node required)."; \
		echo "  macOS / Linux (Homebrew):  brew install supabase/tap/supabase"; \
		echo "  Other / details:           https://supabase.com/docs/guides/local-development/cli/getting-started"; \
		exit 1; \
	}

# --- Teardown ---

# Stop the app container and the Supabase stack (lenient: works even if one isn't running).
down:
	-docker compose down
	-command -v supabase >/dev/null 2>&1 && supabase stop || true

# Full reset: drop the app's node_modules volume and Supabase's local data.
clean:
	-docker compose down -v
	-command -v supabase >/dev/null 2>&1 && supabase stop --no-backup || true
