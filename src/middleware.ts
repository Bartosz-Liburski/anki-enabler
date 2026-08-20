import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { clearPairCookie, dashboardPairUrl, isValidPair, readPairCookie, writePairCookie } from "@/lib/source-pair";

// `/sources` joins the guard for S-02's review screen. The pair-recall block below stays scoped to
// `/dashboard` on purpose: the review screen reads its pair from the source row, not the URL.
const PROTECTED_ROUTES = ["/dashboard", "/sources"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  // Signed-in visitors land back on "/" after sign-in (see /api/auth/signin) — send them straight
  // to the dashboard instead of the logged-out marketing hero.
  if (context.url.pathname === "/" && context.locals.user) {
    return context.redirect("/dashboard");
  }

  // Learning-direction recall (S-01). The dashboard renders purely from its query params; this
  // keeps the pair cookie in sync with them and restores a remembered pair after the tab was
  // closed, so the page itself needs no cookie logic. `?pair=change` opts out.
  if (context.url.pathname === "/dashboard") {
    const params = context.url.searchParams;

    if (params.get("pair") === "change") {
      clearPairCookie(context.cookies);
    } else {
      const learnedLanguage = params.get("learned_language") ?? "";
      const knownLanguage = params.get("known_language") ?? "";

      if (isValidPair(learnedLanguage, knownLanguage)) {
        writePairCookie(context.cookies, { learnedLanguage, knownLanguage });
      } else {
        const remembered = readPairCookie(context.cookies);
        if (remembered) {
          return context.redirect(dashboardPairUrl(remembered, params));
        }
      }
    }
  }

  return next();
});
