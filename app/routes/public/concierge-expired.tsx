import { useLoaderData } from "react-router";
import type { Route } from "./+types/concierge-expired";

export function meta() {
  return [{ title: "Confirmation link unavailable - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const reason = (url.searchParams.get("reason") as "expired" | "unknown" | "no-token") || "unknown";
  return { reason };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConciergeExpiredPage() {
  const { reason } = useLoaderData<typeof loader>();

  const headline =
    reason === "expired"
      ? "This confirmation link has expired"
      : reason === "unknown"
        ? "We couldn't find that confirmation link"
        : "No confirmation link provided";

  const body =
    reason === "expired"
      ? "Confirmation links are valid for 7 days. Reach out to your agent or inspector and they can send you a fresh one in a minute."
      : reason === "unknown"
        ? "The link may have been mistyped, or the booking was cancelled. Get in touch with your agent -- they can reissue a new confirmation."
        : "It looks like the link is incomplete. Use the original email and try again, or contact your agent.";

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-card">
      <main className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-9">
        <div className="w-12 h-12 rounded-xl bg-ih-primary-tint text-ih-primary flex items-center justify-center text-2xl font-bold mb-4">
          !
        </div>
        <h1 className="font-serif text-2xl font-bold leading-tight mb-2.5 text-ih-fg-1">
          {headline}
        </h1>
        <p className="text-[15px] text-ih-fg-3 leading-relaxed">
          {body}
        </p>
      </main>
    </div>
  );
}
