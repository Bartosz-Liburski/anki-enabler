import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { buildAnkiCsv, csvDownloadHeaders, exportFilename, type ExportCard } from "@/lib/anki-export";
import type { SourceErrorCode } from "@/lib/source-errors";
import { dashboardUrl, isValidPair } from "@/lib/source-pair";

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

/** Matches PostgREST's `max_rows` (supabase/config.toml:18) — the point at which it truncates. */
const PAGE_SIZE = 1000;

export const GET: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const user = context.locals.user;
  // `/api/*` is not covered by the middleware's route guard, so the auth check happens here.
  if (!supabase || !user) {
    return context.redirect("/auth/signin");
  }

  const fail = (code: SourceErrorCode) => context.redirect(dashboardUrl({ error: code }));

  // Optional pair scoping (S-05): the dashboard's per-pair "Download CSV" link hits this same
  // route with these params. Absent or invalid params fall back to the account-wide export
  // unchanged — this endpoint still works exactly as before when hit with no params.
  const learnedLanguage = context.url.searchParams.get("learned_language") ?? "";
  const knownLanguage = context.url.searchParams.get("known_language") ?? "";
  const pairFilter = isValidPair(learnedLanguage, knownLanguage) ? { learnedLanguage, knownLanguage } : null;

  // The embedded select rides the flashcards -> sources foreign key, so one round trip carries each
  // card and the pair that tags it. `!inner` makes the relation non-nullable in the result type;
  // the FK is NOT NULL, so it excludes nothing.
  //
  // No `user_id` filter: RLS scopes both sides to the owner, the same boundary every other endpoint
  // rests on. Ordering by source first keeps each source's cards contiguous in the file; `id` is a
  // tiebreaker, not decoration — a generation inserts all of its cards in ONE statement
  // (generate.ts:123), so they share a `created_at` to the microsecond and Postgres is free to
  // order them differently between two runs. Without it, paging below could also skip or repeat a
  // row across page boundaries.
  //
  // **Paged deliberately.** PostgREST caps a response at `max_rows` (1000, supabase/config.toml:18)
  // and reports no error when it truncates — a single unbounded read would hand a user with 1400
  // kept cards a file with 400 missing, which Anki would import as a clean success. The dashboard's
  // `count: "exact"` is NOT capped the same way, so the page would even name the right total while
  // the file was short.
  const exportCards: ExportCard[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("flashcards")
      .select("front, back, sources!inner(learned_language, known_language)")
      .eq("discarded", false);

    if (pairFilter) {
      query = query
        .eq("sources.learned_language", pairFilter.learnedLanguage)
        .eq("sources.known_language", pairFilter.knownLanguage);
    }

    const { data: page, error: readError } = await query
      .order("source_id", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (readError) {
      return fail("export-failed");
    }

    exportCards.push(
      ...page.map((card) => ({
        front: card.front,
        back: card.back,
        learnedLanguage: card.sources.learned_language,
        knownLanguage: card.sources.known_language,
      })),
    );

    if (page.length < PAGE_SIZE) break;
  }

  // The dashboard hides the link when nothing is kept, so this is a direct or bookmarked URL.
  if (exportCards.length === 0) {
    return fail("export-empty");
  }

  const filename = exportFilename(new Date(), pairFilter ?? undefined);
  return new Response(buildAnkiCsv(exportCards), { headers: csvDownloadHeaders(filename) });
};
