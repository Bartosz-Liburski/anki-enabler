/// <reference types="vitest/config" />
import { loadEnv } from "vite";
import { getViteConfig } from "astro/config";

// Inherits the project's Astro/Vite config (the `@/*` path alias, env handling) rather than
// duplicating it. Default `test.environment` stays `node` — nothing in this rollout phase
// needs a DOM; the one Astro-page render (Phase 4) uses the Container API directly.
//
// `.env` is loaded into `process.env` explicitly (Vite's default `import.meta.env` exposure
// only covers `VITE_`-prefixed vars) — mirrors the `--env-file-if-exists=.env` flag the
// project's other scripts (`npm run eval`) already use to reach the same file.
export default getViteConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.integration.test.ts"],
    env: loadEnv("test", process.cwd(), ""),
  },
});
