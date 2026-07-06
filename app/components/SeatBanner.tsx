/**
 * F3 — Seat quota banner.
 *
 * Renders a contextual alert when the tenant is at or near their seat limit.
 * Shown on dashboard and team pages when seatUsage data is available. Thin
 * wrapper over the shared-ui Banner primitive: this component owns only the
 * visibility threshold and the tone/copy; all chrome comes from Banner.
 */
import { Banner } from "@core/shared-ui";

export function SeatBanner({
  usage,
  billingUrl,
}: {
  usage: { used: number; limit: number };
  billingUrl?: string;
}) {
  const atLimit = usage.used >= usage.limit;
  const nearLimit = usage.used >= usage.limit - 1;

  if (!nearLimit) return null;

  return (
    <Banner
      tone={atLimit ? "danger" : "warn"}
      className="mb-4"
      actions={
        billingUrl ? (
          <a
            href={billingUrl}
            className="text-sm font-bold text-ih-primary hover:underline"
          >
            Upgrade
          </a>
        ) : undefined
      }
    >
      {atLimit
        ? `You've reached your seat limit (${usage.used}/${usage.limit}). Upgrade to add more team members.`
        : `${usage.used} of ${usage.limit} seats used. 1 seat remaining.`}
    </Banner>
  );
}
