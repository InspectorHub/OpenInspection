/**
 * Free-tier usage quotas — quota banner.
 *
 * Renders a contextual note when a free-tier tenant is approaching or has
 * hit one of the monthly free-plan allowances (inspections/email — see
 * FREE_TIER_CAPS in server/features/plan-quota/policy.ts). Pattern mirrors
 * SeatBanner: the component itself owns the visibility threshold, so callers
 * can render one per capped metric and let each hide itself until it is
 * actually relevant. Thin wrapper over the shared-ui Banner primitive.
 *
 * A reminder, not a sales surface: it says where the allowance stands and
 * when it renews, and offers no upgrade link. At the email cap it points to
 * the bring-your-own-email path, which has no limit.
 */
import { Link } from "react-router";
import { Banner } from "@core/shared-ui";
import { AllowanceResetNote } from "~/components/AllowanceResetNote";
import { m } from "~/paraglide/messages";

export function QuotaBanner({
  metric,
  used,
  cap,
  resetsAt,
}: {
  metric: "inspections" | "email";
  used: number;
  cap: number;
  /** ISO instant the allowance renews (UTC month start). Omitted: no renewal line. */
  resetsAt?: string | null;
}) {
  if (cap <= 0) return null;
  const atCap = used >= cap;
  const nearCap = used / cap >= 0.8;

  if (!nearCap) return null;

  const text = metric === "inspections"
    ? (atCap ? m.quota_banner_inspections_full({ cap }) : m.quota_banner_inspections({ used, cap }))
    : (atCap ? m.quota_banner_email_full({ cap }) : m.quota_banner_email({ used, cap }));

  return (
    <Banner
      tone={atCap ? "danger" : "warn"}
      className="mb-4"
      actions={
        metric === "email" && atCap ? (
          <Link to="/settings/integrations/email" className="text-sm font-bold text-ih-primary-text hover:underline">
            {m.quota_banner_email_own_account()}
          </Link>
        ) : undefined
      }
    >
      {text}
      {resetsAt && (
        <>
          {" "}
          <AllowanceResetNote resetsAt={resetsAt} className="font-normal" />
        </>
      )}
    </Banner>
  );
}
