import type { Api } from "~/lib/api-client.server";
import type { BookingOpenState, BookingClosedReason } from "~/components/settings/BookingClosedNotice";

/**
 * Whether the public booking page this workspace configures is OPEN — read from
 * the surface that DERIVES it (`GET /api/public/book/:tenant`), not recomputed.
 *
 * The settings loader has no "is booking open" fact of its own, and must not
 * grow one: "does a qualified inspector have an hour row" answered in a second
 * place is how an admin page and the page it configures end up disagreeing.
 * This reads the same endpoint the public page reads, in-process.
 *
 * Shaped like `~/lib/schedule-onboarding.server`: it takes the api client and
 * awaits internally, so the caller passes it to its existing `Promise.all`
 * instead of adding another sequential round trip to the loader.
 */
export async function readCompanyBookingOpenState(api: Api): Promise<BookingOpenState> {
  const UNKNOWN: BookingOpenState = { open: null, reason: null };

  // The public profile is keyed by tenant SLUG, which only the session context
  // carries server-side.
  const sessionRes = await api.sessionContext.context.$get().catch(() => null);
  if (!sessionRes?.ok) return UNKNOWN;
  const session = (await sessionRes.json().catch(() => ({}))) as {
    data?: { branding?: { tenantSlug?: string | null } };
  };
  const tenant = session.data?.branding?.tenantSlug?.trim();
  if (!tenant) return UNKNOWN;

  const res = await api.bookings.book[":tenant"].$get({ param: { tenant } }).catch(() => null);
  if (!res?.ok) return UNKNOWN;
  // Read field by field off the body, the same way the public booking loader
  // reads this endpoint — the typed client collapses the response union.
  const body = await res.json().catch(() => ({}));
  const d = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  const open = d.bookingOpen;
  if (typeof open !== "boolean") return UNKNOWN;

  const raw = d.bookingClosedReason;
  const reason: BookingClosedReason | null =
    raw === "no_inspector_hours" || raw === "no_company_timezone" ? raw : null;
  return { open, reason: open ? null : reason };
}
