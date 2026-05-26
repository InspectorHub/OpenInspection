import { useLoaderData } from "react-router";
import type { Route } from "./+types/inspector-not-found";

export function meta() {
  return [{ title: "Inspector not found - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") || "unknown";
  const companyName = url.searchParams.get("company") || undefined;
  return { slug, companyName };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function InspectorNotFoundPage() {
  const { slug, companyName } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-card">
      <div className="max-w-[420px] text-center">
        <h1 className="font-serif text-[32px] font-semibold mb-4 text-ih-fg-1">
          Inspector not found
        </h1>
        <p className="text-ih-fg-3 text-[15px] leading-relaxed">
          We couldn't find an inspector with the link{" "}
          <code className="bg-ih-bg-muted px-1.5 py-0.5 rounded text-[13px] font-mono">
            /inspector/{slug}
          </code>
          {companyName ? ` at ${companyName}` : ""}. Double-check with whoever
          shared the link.
        </p>
      </div>
    </div>
  );
}
