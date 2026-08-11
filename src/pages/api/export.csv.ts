import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { buildAnkiCsv, csvDownloadHeaders, exportFilename, type ExportCard } from "@/lib/anki-export";
import type { SourceErrorCode } from "@/lib/source-errors";
import { dashboardUrl } from "@/lib/source-pair";

/**
 * Download every kept flashcard the user owns, across all sources, as one Anki CSV (S-03, FR-012).
 *
 * Exists because there is still no source list — browsing is S-04's job, and `/sources/{id}` is
 * reachable only by the post-upload redirect or a bookmark. Without this route, a user with
 * several sources would have to hunt for URLs to export them one at a time.
 *
 * The file mixes learning directions on purpose, and the per-row tag is what makes that survivable:
 * each row carries its own source's `anki-enabler::xx-yy`, so the user splits the deck by tag
 * inside Anki. A deck column was the alternative and was rejected — sources have no title, only a
 * UUID, and a UUID deck name is worse than none.
 *
 * Same shape as the per-source route: a `GET` answering with a body, failures redirecting with an
 * outcome code, and nothing written.
 */
export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const user = context.locals.user;
  // `/api/*` is not covered by the middleware's route guard, so the auth check happens here.
  if (!supabase || !user) {
    return context.redirect("/auth/signin");
  }

  const fail = (code: SourceErrorCode) => context.redirect(dashboardUrl({ error: code }));

  // The embedded select rides the flashcards -> sources foreign key, so one round trip carries each
  // card and the pair that tags it. `!inner` makes the relation non-nullable in the result type;
  // the FK is NOT NULL, so it excludes nothing.
  //
  // No `user_id` filter: RLS scopes both sides to the owner, the same boundary every other endpoint
  // rests on. Ordering by source first keeps each source's cards contiguous in the file.
  const { data: cards, error: readError } = await supabase
    .from("flashcards")
    .select("front, back, sources!inner(learned_language, known_language)")
    .eq("discarded", false)
    .order("source_id", { ascending: true })
    .order("created_at", { ascending: true });

  if (readError) {
    return fail("export-failed");
  }

  // The dashboard hides the link when nothing is kept, so this is a direct or bookmarked URL.
  if (cards.length === 0) {
    return fail("export-empty");
  }

  const exportCards: ExportCard[] = cards.map((card) => ({
    front: card.front,
    back: card.back,
    learnedLanguage: card.sources.learned_language,
    knownLanguage: card.sources.known_language,
  }));

  return new Response(buildAnkiCsv(exportCards), { headers: csvDownloadHeaders(exportFilename(new Date())) });
};
