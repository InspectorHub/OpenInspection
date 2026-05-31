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

export function loader({ request }: Route.LoaderArgs): UiPrefs {
  return parseUiPrefs(request.headers.get("Cookie"));
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
var resolved=s==='dark'||s==='light'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
d.setAttribute('data-color-scheme',resolved);
if(resolved==='dark')d.classList.add('dark');else d.classList.remove('dark');
if(getC('oi-sidebar-collapsed')==='1')d.setAttribute('data-sidebar-collapsed','1');
})();`;

const CRITICAL_CSS = `html{background:#f8fafc;color:#0f172a;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}html[data-color-scheme="dark"]{background:#0f172a;color:#f1f5f9}body{margin:0;min-height:100vh;background:inherit;color:inherit}`;

export function Layout({ children }: { children: React.ReactNode }) {
  // Root loader data is unavailable while the error boundary renders; fall back
  // to defaults so the document still renders.
  const prefs = (useRouteLoaderData("root") as UiPrefs | undefined) ?? DEFAULT_UI_PREFS;
  const ssrScheme = resolveSchemeForSSR(prefs.colorScheme);
  return (
    <html
      lang="en"
      className={`scroll-smooth${ssrScheme === "dark" ? " dark" : ""}`}
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
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold">{error.status}</h1>
          <p className="text-ih-fg-3 mt-2">{error.statusText}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">Error</h1>
        <p className="text-ih-fg-3 mt-2">Something went wrong</p>
      </div>
    </div>
  );
}
