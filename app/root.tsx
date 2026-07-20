import { useEffect } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteLoaderData,
} from "react-router";
import type { Route } from "./+types/root";
import "./styles/tailwind.css";
import {
  parseUiPrefs,
  resolveSchemeForSSR,
  DEFAULT_UI_PREFS,
  type UiPrefs,
} from "~/lib/ui-prefs";
import {
  bootstrapServiceWorker,
  type SWRegistrarLike,
} from "~/lib/sw-bootstrap";
import { ErrorState } from "~/components/ErrorState";
import { NavProgress } from "~/components/NavProgress";
import { ToastPortal } from "~/components/Toast";
// i18n Phase C — active UI locale for <html lang>. Resolved ONCE in the root
// loader (server-side, inside the request's paraglide ALS scope) and threaded to
// Layout via loader data. It must NOT be called during client render: the first
// client-side getLocale() self-initializes via setLocale() (paraglide #455), and
// running that side effect inside React's render/hydration breaks interactivity
// (RR client router + fetcher actions stop working). Server-side getLocale()
// returns from the ALS store with no side effect.
import { getLocale } from "~/paraglide/runtime";

export function loader({
  request,
  context,
}: Route.LoaderArgs): UiPrefs & { locale: string; mapsApiKey: string | null } {
  // getLocale() here runs on the server inside the paraglide ALS scope
  // (workers/app.ts wraps the whole RR render), so it resolves the request's
  // locale and returns without the client-side setLocale() self-init side effect.
  //
  // mapsApiKey (Spec 5D B4): the Google Maps JS key is browser-side by design
  // (the SDK runs in the browser), so it is surfaced here for GoogleMap to read
  // via useRouteLoaderData("root"). It is an HTTP-referrer-restricted platform
  // key; null when unset → the map fails closed and renders nothing.
  // GOOGLE_MAPS_JS_API_KEY is an optional runtime var not present in the
  // wrangler-generated `Env` type, so read it through a narrow cast (the same
  // approach oauth/authorize.tsx uses for its env subset).
  const env = context.cloudflare.env as unknown as { GOOGLE_MAPS_JS_API_KEY?: string };
  return {
    ...parseUiPrefs(request.headers.get("Cookie")),
    locale: getLocale(),
    mapsApiKey: env.GOOGLE_MAPS_JS_API_KEY ?? null,
  };
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "OpenInspection" },
    { name: "description", content: "Property inspection management" },
  ];
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
];

// The server already renders `data-color-scheme` / `data-sidebar-collapsed` from
// cookies (see the root loader). This boot script only handles the two cases the
// server cannot: (1) one-time migration of legacy localStorage prefs into cookies,
// and (2) resolving "auto"/no-cookie to the OS `prefers-color-scheme` before first
// paint. The <html> attribute mutations are covered by `suppressHydrationWarning`.
const FOUC_SCRIPT = `(function(){
var d=document.documentElement;var C=document.cookie;var Y=31536000;
function setC(k,v){document.cookie=k+'='+v+';path=/;max-age='+Y+';samesite=lax';}
function getC(k){var m=C.match(new RegExp('(?:^|; )'+k+'=([^;]*)'));return m?m[1]:null;}
try{
// migrate legacy localStorage -> cookie (one-time, self-healing)
var ls=localStorage.getItem('oi-color-scheme')||localStorage.getItem('ih-color-scheme');
if(ls&&getC('oi-color-scheme')===null){setC('oi-color-scheme',ls);C=document.cookie;}
var lc=localStorage.getItem('oi-sidebar-collapsed');
if(lc!==null&&getC('oi-sidebar-collapsed')===null){setC('oi-sidebar-collapsed',lc);C=document.cookie;}
}catch(e){}
// resolve the actual paint scheme: explicit cookie wins, else OS preference
var s=getC('oi-color-scheme');
var resolved=s==='dark'||s==='light'||s==='field'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
d.setAttribute('data-color-scheme',resolved);
if(resolved==='dark'||resolved==='field')d.classList.add('dark');else d.classList.remove('dark');
if(getC('oi-sidebar-collapsed')==='1')d.setAttribute('data-sidebar-collapsed','1');
})();`;

const CRITICAL_CSS = `html{background:#f8fafc;color:#0f172a;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}html[data-color-scheme="dark"]{background:#0f172a;color:#f1f5f9}html[data-color-scheme="field"]{background:#020617;color:#ffffff;font-size:18px}body{margin:0;min-height:100vh;background:inherit;color:inherit}`;

export function Layout({ children }: { children: React.ReactNode }) {
  // Root loader data is unavailable while the error boundary renders; fall back
  // to defaults so the document still renders.
  const data = useRouteLoaderData("root") as (UiPrefs & { locale: string }) | undefined;
  const prefs = data ?? DEFAULT_UI_PREFS;
  const ssrScheme = resolveSchemeForSSR(prefs.colorScheme);
  return (
    <html
      lang={data?.locale ?? "en"}
      className={`scroll-smooth${ssrScheme === "dark" || ssrScheme === "field" ? " dark" : ""}`}
      data-color-scheme={ssrScheme}
      data-sidebar-collapsed={prefs.sidebarCollapsed ? "1" : undefined}
      suppressHydrationWarning
    >
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: FOUC_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body className="bg-ih-bg-app text-ih-fg-1 antialiased min-h-screen" suppressHydrationWarning>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  // FE-1 / B-3 — versioned SW bootstrap with kill switch.
  // Normal boots (re)register the current SW (/sw.js, v3-a1); the browser
  // no-ops if the same script is already active and swaps in the new version
  // via its normal update flow when the file changes.
  // Kill switch: set ?no-sw=1 or localStorage 'oi:sw-disable'='1' to
  // immediately unregister all registrations and stop any SW from running
  // (zombie-exorcism behavior is preserved under the kill switch).
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    void bootstrapServiceWorker(
      navigator.serviceWorker as unknown as SWRegistrarLike,
      window.location.search,
      window.localStorage,
    );
  }, []);
  return (
    <>
      <NavProgress />
      <Outlet />
      <ToastPortal />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error)) {
    const is404 = error.status === 404;
    return (
      <ErrorState
        code={error.status}
        title={is404 ? "Page not found" : error.statusText || "Something went wrong"}
        message={
          is404
            ? "The page you're looking for doesn't exist or may have moved."
            : "An unexpected error occurred. Please try again in a moment."
        }
        action={{ label: "Go to homepage", href: "/" }}
      />
    );
  }
  return (
    <ErrorState
      title="Something went wrong"
      message="An unexpected error occurred. Please try again, or head back to the homepage."
      action={{ label: "Go to homepage", href: "/" }}
    />
  );
}
