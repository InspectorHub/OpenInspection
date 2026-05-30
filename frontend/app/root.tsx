import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import "./styles/tailwind.css";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "OpenInspection" },
    { name: "description", content: "Property inspection management" },
  ];
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
];

const FOUC_SCRIPT = `(function(){
var d=document.documentElement;
if(d.hasAttribute('data-theme')){d.setAttribute('data-color-scheme','light');return;}
try{var L=localStorage.getItem('ih-color-scheme');
if(L&&!localStorage.getItem('oi-color-scheme'))localStorage.setItem('oi-color-scheme',L);
if(L)localStorage.removeItem('ih-color-scheme');}catch(e){}
var s=localStorage.getItem('oi-color-scheme');
var p=window.matchMedia('(prefers-color-scheme: dark)').matches;
var scheme=s==='dark'||(s===null&&p)?'dark':'light';
d.setAttribute('data-color-scheme',scheme);
if(scheme==='dark')d.classList.add('dark');
})();
(function(){try{if(localStorage.getItem('oi-sidebar-collapsed')==='1')document.documentElement.setAttribute('data-sidebar-collapsed','1');}catch(e){}})();`;

const CRITICAL_CSS = `html{background:#f8fafc;color:#0f172a;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}html[data-color-scheme="dark"]{background:#0f172a;color:#f1f5f9}body{margin:0;min-height:100vh;background:inherit;color:inherit}`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
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
