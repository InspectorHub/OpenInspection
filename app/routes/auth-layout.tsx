import { useCallback, useEffect, useMemo, useState } from "react";
import { data, Outlet, useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
import { uiLocaleStampFor } from "../../server/lib/i18n/ui-locale";
import type { Route } from "./+types/auth-layout";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { CommandPalette, CommandPaletteProvider } from "~/components/CommandPalette";
import { Sidebar, MobileHeader } from "~/components/Sidebar";
import { RouteSkeleton } from "~/components/RouteSkeleton";
import { OutboundCoolingBanner } from "~/components/OutboundCoolingBanner";
import type { SessionContext } from "~/hooks/useSessionContext";

/**
 * Returns true only once `active` has stayed true continuously for `delayMs`.
 * Used to suppress the navigation skeleton on fast loads: humans read a sub-
 * ~200ms transition as instant, so flashing a skeleton for it is pure jank.
 * When the navigation finishes before the threshold the skeleton never shows;
 * React Router keeps the previous page mounted during `loading`, so the user
 * simply sees the current page until the new one is ready (or the skeleton
 * appears for genuinely slow loads). Resets immediately when `active` clears.
 */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return shown;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
  let sessionContext: SessionContext | null = null;
  try {
    const api = createApi(context, { token });
    const res = await api.sessionContext.context.$get();
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      sessionContext = body.data as SessionContext;
    }
  } catch {
    // Graceful fallback — layout renders with defaults
  }

  // i18n activation (#269) — the DATABASE half of locale resolution.
  //
  // The worker entry resolves the request-borne rungs (the PARAGLIDE_LOCALE
  // cookie, then Accept-Language) before the paraglide scope opens. It cannot
  // read the other two: `users.locale` and `tenant_configs.default_locale` live
  // in D1, and querying them ahead of the router on every page load — for a
  // value that changes about once per user per career — is not a trade worth
  // making. They arrive here instead, on the one loader that already fetches
  // the session context for every authenticated page, at no extra query.
  //
  // By the time this runs the render has already committed to a locale, so the
  // stored preference is STAMPED INTO THE COOKIE and takes effect from the next
  // request. The cost is one render in the previous language, on the single
  // page load where a stored preference first differs from the cookie. It
  // cannot oscillate: the value written is the same value this chain resolves
  // once the cookie carries it, so the next request finds them equal and writes
  // nothing. The switcher (LocaleSwitcher) is the interactive path and does not
  // pay this lag — it writes the cookie itself and revalidates.
  const headers = new Headers();
  const stamp = sessionContext
    ? uiLocaleStampFor(request, {
        userLocale: sessionContext.user?.locale ?? null,
        tenantDefault: sessionContext.branding?.defaultLocale ?? null,
      })
    : null;
  if (stamp) headers.append("Set-Cookie", stamp);
  return data({ context: sessionContext }, { headers });
}

/**
 * Surfaces the loader's `Set-Cookie` on the document response.
 *
 * Without this the stamp above is silently dropped: React Router does not
 * propagate a nested loader's headers by default — it uses the deepest
 * `headers` export it can find, and if no route on the branch exports one, the
 * loader's headers go nowhere. Verified against a running server rather than
 * assumed: before this existed, `document.cookie` held no PARAGLIDE_LOCALE
 * after any number of authenticated page loads, and the language a viewer had
 * saved in Settings never took effect.
 *
 * Only `Set-Cookie` is forwarded. Passing `loaderHeaders` through wholesale
 * would let any future header set on this loader leak onto every authenticated
 * document response, including caching directives that must not apply to a
 * per-viewer page.
 *
 * No other route on this branch exports `headers` (asserted by
 * `auth-layout-headers.test.ts`) — one that did would win as the deeper export
 * and would have to forward this itself.
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  const out = new Headers();
  const cookie = loaderHeaders.get("Set-Cookie");
  if (cookie) out.append("Set-Cookie", cookie);
  return out;
}

export default function AuthLayout() {
  const { context } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();
  const navigate = useNavigate();

  // Command palette open state lives here so both the Cmd/Ctrl+K listener
  // (inside CommandPalette) and workspace triggers (sidebar search button,
  // MobileHeader) can drive it (IA-38).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const paletteCtx = useMemo(() => ({ openPalette }), [openPalette]);

  // Show a content-pane skeleton only during a *real* page navigation:
  // - navigation.state === "loading" (loader in flight, not a form submission)
  // - navigation.location is set (guards against revalidation, which has no location)
  // - the target path differs from the current path (ignore search-param-only
  //   refetches / replace-in-place updates so we don't flash a skeleton over
  //   the page the user is already on)
  const isNavigatingToNewPage =
    navigation.state === "loading" &&
    navigation.location != null &&
    navigation.location.pathname !== location.pathname;

  // Defer the skeleton ~180ms so fast navigations never flash it (anti-jank).
  const showSkeleton = useDelayedFlag(isNavigatingToNewPage, 180);

  return (
    <CommandPaletteProvider value={paletteCtx}>
      {/* F4 — Suspension banner */}
      {context?.branding?.tenantStatus === "suspended" && (
        <div className="bg-ih-watch-bg border-b border-ih-watch px-4 py-3 flex items-center justify-center gap-3 z-50">
          <p className="text-sm font-semibold text-ih-watch-fg">
            This workspace is suspended. You can view existing content but
            cannot create or edit inspections.
          </p>
        </div>
      )}

      {/* Portal #98 §3.4 — the outbound cooling window, shown while it is OPEN.
          Mounted here, on the layout every authenticated page renders through,
          because the point is that the reader meets it before they press Send.
          `outboundCoolingWindow` is already null once the window closes. */}
      <OutboundCoolingBanner unlockAtMs={context?.outboundCoolingWindow?.unlockAtMs ?? null} />

      <MobileHeader />
      <div className="flex min-h-screen">
        <Sidebar />
        {/* `min-w-0`, and NOT `w-full`. A flex child defaults to
            min-width:auto, so it refuses to shrink below its content — and
            `w-full` on top of `flex-1` asks for 100% of the ROW, which already
            has the sidebar in it. The two together made this element 1080px
            inside a 1245px viewport whose sidebar takes 200px, so every page
            in the workspace scrolled sideways by ~35px on a 1280-wide screen.
            `min-w-0` lets it take the space actually left over. */}
        <main className="flex-1 min-w-0 bg-ih-bg-app">
          {/* ds-allow: page bottom gutter (60px), bespoke page-shell spacing with no token */}
          <div className="max-w-[1080px] mx-auto pt-5 pb-[60px] px-9">
            {showSkeleton ? (
              <RouteSkeleton pathname={navigation.location?.pathname ?? location.pathname} />
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>

      {/* IA-49 — mounted at the workspace layout (not just /inspections) so the
          global Cmd/Ctrl+K command palette works on every authenticated page.
          Controlled here so the sidebar search button can open it too (IA-38). */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewInspection={() => navigate("/inspections/new")}
      />
    </CommandPaletteProvider>
  );
}
