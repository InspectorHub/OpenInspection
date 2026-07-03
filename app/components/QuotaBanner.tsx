/**
 * Free-tier usage quotas — quota banner.
 *
 * Renders a contextual alert when a free-tier tenant is approaching or has
 * hit one of the free-plan caps (inspections/sms/email — see FREE_TIER_CAPS
 * in server/features/plan-quota/policy.ts). Pattern mirrors SeatBanner: the
 * component itself owns the visibility threshold, so callers can render one
 * per capped metric and let each hide itself until it is actually relevant.
 */
const METRIC_LABEL: Record<"inspections" | "sms" | "email", string> = {
  inspections: "free inspections",
  sms: "free SMS messages",
  email: "free emails",
};

export function QuotaBanner({
  metric,
  used,
  cap,
  billingUrl,
}: {
  metric: "inspections" | "sms" | "email";
  used: number;
  cap: number;
  billingUrl?: string;
}) {
  if (cap <= 0) return null;
  const atCap = used >= cap;
  const nearCap = used / cap >= 0.8;

  if (!nearCap) return null;

  const label = METRIC_LABEL[metric];

  return (
    <div
      className={`px-4 py-3 rounded-lg mb-4 flex items-center flex-wrap gap-2 ${
        atCap
          ? "bg-ih-bad-bg border border-ih-bad"
          : "bg-ih-watch-bg border border-ih-watch"
      }`}
    >
      <p
        className={`text-sm font-semibold ${
          atCap ? "text-ih-bad-fg" : "text-ih-watch-fg"
        }`}
      >
        {atCap
          ? `You've used all ${cap} ${label}. Upgrade to keep creating.`
          : `${used} of ${cap} ${label} used.`}
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
