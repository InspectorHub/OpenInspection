import { Banner } from "@core/shared-ui";

export function HolidayAdvisoryBanner({
  name,
  conciergeReviewRequired = false,
}: {
  name: string;
  conciergeReviewRequired?: boolean;
}) {
  const copy = conciergeReviewRequired
    ? `Office may be closed — ${name}. Request received — office will confirm.`
    : `Office may be closed — ${name}. We'll confirm availability.`;

  return (
    <Banner tone="warn" className="mb-3">
      {copy}
    </Banner>
  );
}
