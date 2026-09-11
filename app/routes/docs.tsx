import { useEffect } from "react";
import { m } from "~/paraglide/messages";

// API docs (Swagger UI) — was a hono-rendered HTML page at GET /ui; migrated to a
// React Router route so hono renders no browser pages. The OpenAPI document is
// still served by the API at /doc (routed to the API in workers/app.ts); the
// swagger-ui bundle + css are vendored into public/vendor by scripts/vendor-copy.js.

export function meta() {
  return [{ title: m.docs_meta_title() }];
}

export function links() {
  return [{ rel: "stylesheet", href: "/vendor/swagger-ui.css" }];
}

/**
 * Cacheable, because nothing here is per-request: there is no loader, and the
 * body is one empty mount point the browser fills. An SSR render per visitor
 * buys nobody anything, and this route is anonymous — so every one of them is a
 * render an unauthenticated caller can ask for.
 *
 * That is the same shape as `/doc`, which carries its own limiter and its own
 * cache header, and it is the cheap half: a page render rather than a ~1s
 * OpenAPI build. Capping it here means the edge answers the shell.
 */
export function headers() {
  return { "Cache-Control": "public, max-age=3600" };
}

export default function DocsPage() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "/vendor/swagger-ui-bundle.js";
    script.crossOrigin = "anonymous";
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      if (w.SwaggerUIBundle) {
        w.ui = w.SwaggerUIBundle({ url: "/doc", dom_id: "#swagger-ui" });
      }
    };
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  return <div id="swagger-ui" />;
}
