import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { buildAnkiCsv, csvDownloadHeaders, exportFilename, type ExportCard } from "@/lib/anki-export";
import type { SourceErrorCode } from "@/lib/source-errors";
import { dashboardUrl, sourceUrl } from "@/lib/source-pair";

/**
 * Download one source's kept flashcards as an Anki-ready CSV (S-03, FR-012).
 *
 * **A `GET` that answers with a body, not a redirect** — the first route in this app shaped that
 * way. Export is a read, so `GET` says what it means, and the control on the page is a bare `<a>`
 * that needs no hydration: the same progressive-enhancement stance `ReviewCardList` documents for
 * the review form. The filename lives in `Content-Disposition`, so the `.csv` in the route path is
 * cosmetic — Astro strips only the final `.ts`, the mechanism that makes `rss.xml.ts` serve
 * `/rss.xml`.
 *
 * Failures still redirect with an outcome code, because a failure has a page to go back to. Only
 * success has a file.
 *
 * Kept is the complement of discarded, straight from the schema's own definition
 * (20260731075155_add_flashcard_fields.sql:29) — this endpoint is the consumer that comment names.
 * Nothing is written: no `exported_at`, no "already exported" flag, so re-exporting is idempotent.
 */
export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const user = context.locals.user;
  // `/api/*` is not covered by the middleware's route guard, so the auth check happens here.
  if (!supabase || !user) {
    return context.redirect("/auth/signin");
  }

  const id = context.params.id;
  if (!id) {
    return context.redirect(dashboardUrl({ error: "source-not-found" }));
  }

  const fail = (code: SourceErrorCode) => context.redirect(sourceUrl(id, { error: code }));

  // The pair comes from the source rather than the request: it decides the tag on every row, and a
  // client-supplied direction would let a forged URL mislabel someone's deck. RLS scopes the
  // lookup to the owner, so "not yours" and "not there" are one outcome — deliberately, per
  // source-errors.ts:42-44.
  const { data: source } = await supabase
    .from("sources")
    .select("learned_language, known_language")
    .eq("id", id)
    .maybeSingle();

  if (!source) {
    return context.redirect(dashboardUrl({ error: "source-not-found" }));
  }

  const { data: cards, error: readError } = await supabase
    .from("flashcards")
    .select("front, back")
    .eq("source_id", id)
    .eq("discarded", false)
    .order("created_at", { ascending: true });

  if (readError) {
    return fail("export-failed");
  }

  // The page hides the link when nothing is kept, so reaching this means a direct or bookmarked
  // URL. Answering with a directives-only file would import as "0 notes" and leave the user to
  // work out why; the banner says it outright instead.
  if (cards.length === 0) {
    return fail("export-empty");
  }

  const exportCards: ExportCard[] = cards.map((card) => ({
    front: card.front,
    back: card.back,
    learnedLanguage: source.learned_language,
    knownLanguage: source.known_language,
  }));

  const filename = exportFilename(new Date(), {
    learnedLanguage: source.learned_language,
    knownLanguage: source.known_language,
  });

  return new Response(buildAnkiCsv(exportCards), { headers: csvDownloadHeaders(filename) });
};
