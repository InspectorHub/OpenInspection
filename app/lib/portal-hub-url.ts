/**
 * IA-44 — the single place the token-track payment surfaces (`/checkout`,
 * `/invoice/:id`) build their hand-off target.
 *
 * Both used to end their flow on a page of their own: `/checkout` linked at
 * `/report/:tenant/:id` with NO token, and `/invoice/:id` reloaded itself. The
 * client arriving there holds a signer/portal token, not necessarily a
 * `__Host-portal_session` cookie, so the token-less report link was an auth
 * failure landing on the highest-trust moment of the journey.
 *
 * Every completed payment track now returns to the unified Hub carrying the
 * recipient's PORTAL token, which the Hub loader exchanges for the session
 * (app/lib/portal-exchange.ts `resolvePortalSession`).
 *
 * Kept framework-free (no React, no router) so route loaders can import it
 * without pulling component modules in, and so it is unit-testable directly.
 */

export interface PortalHubUrlOptions {
  /** Tenant slug (the Hub route's `:tenant` segment). */
  tenant: string;
  inspectionId: string;
  /** Per-recipient portal token; omitted/empty means "rely on an existing session". */
  token?: string | null;
  /** Hub section to land on; defaults to the Hub overview when omitted. */
  section?: "report" | "payment";
  /**
   * Carry Stripe's post-redirect marker through the hand-off. The webhook
   * settles the invoice asynchronously, so the Hub shows the same optimistic
   * "payment received" state the originating page would have shown.
   */
  justPaid?: boolean;
}

export function portalHubUrl({
  tenant,
  inspectionId,
  token,
  section,
  justPaid,
}: PortalHubUrlOptions): string {
  const params = new URLSearchParams();
  if (section) params.set("section", section);
  if (token) params.set("token", token);
  if (justPaid) params.set("redirect_status", "succeeded");
  const qs = params.toString();
  return `/portal/${tenant}/i/${inspectionId}${qs ? `?${qs}` : ""}`;
}
