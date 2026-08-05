/**
 * UI preferences that must be known at SSR time to avoid a flash of the wrong
 * theme (FOUC) AND a React hydration mismatch (#418/#423).
 *
 * Theme + sidebar-collapsed state live in cookies (not just localStorage) so the
 * server can read them in the root loader and render the correct initial markup.
 * localStorage is invisible to the server; reading it in a `useState` initializer
 * makes the client's first render diverge from the server HTML. Cookies are sent
 * with every request, so server and client agree on the first render.
 *
 * The UI language (#269) joined them for exactly that reason, and is read back
 * by `withResolvedUiLocale` in the worker rather than parsed here — Paraglide
 * owns that cookie's contract, so this module only writes it.
 */
import { UI_LOCALE_COOKIE } from "../../server/lib/i18n/ui-locale";

/** Track H (migration step 5) — 'field' is a high-contrast, large-type variant of dark
 *  for outdoor/sunlight use (18px base font + stronger contrast). A first-class
 *  scheme the user picks explicitly: "auto" never resolves to it. */
export type ColorScheme = "light" | "dark" | "auto" | "field";

export interface UiPrefs {
  colorScheme: ColorScheme;
  sidebarCollapsed: boolean;
}

const COLOR_SCHEME_COOKIE = "oi-color-scheme";
const SIDEBAR_COOKIE = "oi-sidebar-collapsed";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export const DEFAULT_UI_PREFS: UiPrefs = {
  colorScheme: "auto",
  sidebarCollapsed: false,
};

function readCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Parse UI prefs from a request `Cookie` header (server-side, in the root loader). */
export function parseUiPrefs(cookieHeader: string | null): UiPrefs {
  const header = cookieHeader ?? "";
  const rawScheme = readCookie(header, COLOR_SCHEME_COOKIE);
  const colorScheme: ColorScheme =
    rawScheme === "light" || rawScheme === "dark" || rawScheme === "auto" || rawScheme === "field"
      ? rawScheme
      : "auto";
  return {
    colorScheme,
    sidebarCollapsed: readCookie(header, SIDEBAR_COOKIE) === "1",
  };
}

/**
 * Resolve the scheme used for the server-rendered `data-color-scheme` attribute.
 * The server cannot know the OS `prefers-color-scheme`, so "auto" falls back to
 * "light"; the inline boot script corrects it before first paint (the attribute
 * change is covered by `suppressHydrationWarning` on <html>).
 */
export function resolveSchemeForSSR(scheme: ColorScheme): "light" | "dark" | "field" {
  return scheme === "dark" || scheme === "field" ? scheme : "light";
}

/** Persist the color scheme client-side so the next SSR render is correct. */
export function writeColorSchemeCookie(scheme: ColorScheme): void {
  document.cookie = `${COLOR_SCHEME_COOKIE}=${scheme}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Persist the UI language client-side so the next SSR render is correct (#269).
 *
 * Sibling of the two above and written the same way for the same reason, but
 * this one is load-bearing rather than cosmetic: the worker resolves the render
 * locale from THIS cookie before the router runs, so writing it is what makes a
 * language change take effect on the very next request instead of after the
 * preference has round-tripped through D1.
 *
 * The name is imported from the resolver rather than restated — the reader and
 * the writer of a cookie drifting apart is a silent, total failure.
 */
export function writeUiLocaleCookie(locale: string): void {
  document.cookie = `${UI_LOCALE_COOKIE}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/** Persist the sidebar-collapsed flag client-side so the next SSR render is correct. */
export function writeSidebarCookie(collapsed: boolean): void {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "1" : "0"}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}
