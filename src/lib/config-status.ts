import { SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/przeprogramowani/10x-astro-starter#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    name: "ANTHROPIC_API_KEY",
    configured: Boolean(ANTHROPIC_API_KEY),
    message: "Brak klucza ANTHROPIC_API_KEY — generowanie fiszek jest wyłączone.",
    docsUrl: "https://platform.claude.com/settings/keys",
    docsLabel: "Utwórz klucz API",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
