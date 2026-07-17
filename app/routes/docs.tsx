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
