/**
 * F3 — Seat quota banner.
 *
 * Renders a contextual alert when the tenant is at or near their seat limit.
 * Shown on dashboard and team pages when seatUsage data is available.
 */
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
    <div
      className={`px-4 py-3 rounded-lg mb-4 flex items-center flex-wrap gap-2 ${
        atLimit
          ? "bg-ih-bad-bg border border-ih-bad"
          : "bg-ih-watch-bg border border-ih-watch"
      }`}
    >
      <p
        className={`text-sm font-semibold ${
          atLimit ? "text-ih-bad-fg" : "text-ih-watch-fg"
        }`}
      >
        {atLimit
          ? `You've reached your seat limit (${usage.used}/${usage.limit}). Upgrade to add more team members.`
          : `${usage.used} of ${usage.limit} seats used. 1 seat remaining.`}
      </p>
      {billingUrl && (
        <a
          href={billingUrl}
          className="text-sm font-bold text-ih-primary hover:underline ml-2"
        >
          Upgrade
        </a>
      )}
    </div>
  );
}
