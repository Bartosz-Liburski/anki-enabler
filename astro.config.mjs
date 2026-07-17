// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  // Serverless function timeout ceiling (seconds). Astro bundles all SSR routes
  // into one Vercel function, so this covers the long LLM-backed flashcard-generation
  // endpoint. Requires Fluid Compute enabled on the project for the free-tier 300s cap;
  // without it Hobby silently reverts to 10s. See context/foundation/infrastructure.md.
  adapter: vercel({ maxDuration: 60 }),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
