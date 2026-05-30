import { useLoaderData } from "react-router";
import type { Route } from "./+types/concierge-confirm";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Booking confirmed - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ConfirmData {
  booking: {
    id: string;
    start: string;
    end: string;
    address: string;
    contactName: string;
    tenant: { name: string };
  };
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return { data: null, error: "no-token" as const };
  }
  try {
    const api = createApi(context);
    const res = await api.concierge["confirm-info"].$get({ query: { token } });
    if (!res.ok) {
      return { data: null, error: "expired" as const };
    }
    const body = (await res.json()) as { success: boolean; data?: ConfirmData };
    if (!body.success || !body.data) {
      return { data: null, error: "expired" as const };
    }
    return { data: body.data, error: null };
  } catch {
    return { data: null, error: "unknown" as const };
  }
}

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return (
    (parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
  ).toUpperCase();
}

function formatSlot(start: string, end: string): string {
  try {
    const s = new Date(start);
    const e = new Date(end);
    const sameDay = s.toDateString() === e.toDateString();
    if (sameDay) {
      return `${s.toLocaleDateString(undefined, { dateStyle: "long" })}, ${s.toLocaleTimeString(undefined, { timeStyle: "short" })} – ${e.toLocaleTimeString(undefined, { timeStyle: "short" })}`;
    }
    return `${s.toLocaleString()} – ${e.toLocaleString()}`;
  } catch {
    return `${start} – ${end}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ConciergeConfirmPage() {
  const { data, error: loaderError } = useLoaderData<typeof loader>();

  // Error / expired states
  if (loaderError || !data) {
    const headline =
      loaderError === "expired"
        ? "This confirmation link has expired"
        : loaderError === "no-token"
          ? "No confirmation link provided"
          : "We couldn't find that confirmation link";
    const body =
      loaderError === "expired"
        ? "Confirmation links are valid for a short window. Reach out to your inspector and they can resend the original."
        : loaderError === "no-token"
          ? "It looks like the link is incomplete. Use the original email and try again, or contact your inspector."
          : "The link may have been mistyped, or the booking was cancelled. Get in touch with your inspector.";
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-9">
          <div className="w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center text-2xl font-bold mb-4">
            !
          </div>
          <h1 className="font-serif text-2xl font-bold mb-2 text-ih-fg-1">
            {headline}
          </h1>
          <p className="text-[15px] text-ih-fg-3 leading-relaxed">
            {body}
          </p>
        </div>
      </div>
    );
  }

  const { booking } = data;
  const slotLabel = formatSlot(booking.start, booking.end);

  return (
    <div className="min-h-screen bg-ih-bg-card">
      <main className="max-w-[640px] mx-auto px-5 py-10">
        {/* Brand */}
        <div className="flex items-center gap-2.5 font-serif text-lg font-bold mb-10 text-ih-fg-1">
          <span className="w-8 h-8 rounded-lg bg-[#F55A1A] text-white flex items-center justify-center font-bold text-sm">
            O
          </span>
          <span>OpenInspection</span>
        </div>

        <h1 className="font-serif text-[2rem] font-bold leading-tight mb-2 text-ih-fg-1">
          Your booking is in
        </h1>
        <p className="text-base text-ih-fg-3 leading-relaxed mb-8">
          Thanks{booking.contactName ? `, ${booking.contactName}` : ""}. Your inspector
          will be in touch shortly to lock in the slot below and walk you through
          the next steps.
        </p>

        {/* Summary card */}
        <article className="bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden mb-6">
          <div className="flex items-center gap-4 p-7 border-b border-ih-border">
            <span className="w-[72px] h-[72px] rounded-full bg-orange-50 dark:bg-orange-900/20 text-[#F55A1A] flex items-center justify-center font-serif font-bold text-2xl shrink-0">
              {initials(booking.tenant.name)}
            </span>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4 mb-1">
                Inspection by
              </div>
              <div className="font-serif text-2xl font-bold text-ih-fg-1 leading-tight">
                {booking.tenant.name}
              </div>
            </div>
          </div>
          <div className="p-6 space-y-3.5">
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">
                Property
              </span>
              <span className="text-base font-semibold text-ih-fg-1">
                {booking.address}
              </span>
            </div>
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">
                Slot
              </span>
              <span className="text-base font-semibold text-ih-fg-1">
                {slotLabel}
              </span>
            </div>
            {booking.contactName && (
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">
                  Booked for
                </span>
                <span className="text-base font-semibold text-ih-fg-1">
                  {booking.contactName}
                </span>
              </div>
            )}
            <div>
              <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4">
                Reference
              </span>
              <span className="text-base font-mono text-ih-fg-3">
                {booking.id}
              </span>
            </div>
          </div>
        </article>

        <p className="text-[14px] text-ih-fg-3 leading-relaxed">
          Watch your email — we'll send the full inspection agreement and a
          calendar invite as soon as your inspector confirms the slot.
        </p>
      </main>
    </div>
  );
}
