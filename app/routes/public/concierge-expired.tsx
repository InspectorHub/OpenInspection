import { useLoaderData } from "react-router";
import type { Route } from "./+types/concierge-expired";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.concierge_expired_meta_title() }];
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
      ? m.concierge_confirm_expired_title()
      : reason === "unknown"
        ? m.concierge_expired_unknown_title()
        : m.concierge_expired_notoken_title();

  const body =
    reason === "expired"
      ? m.concierge_expired_expired_body()
      : reason === "unknown"
        ? m.concierge_expired_unknown_body()
        : m.concierge_expired_notoken_body();

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
