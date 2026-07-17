import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

export function HolidayAdvisoryBanner({
  name,
  conciergeReviewRequired = false,
}: {
  name: string;
  conciergeReviewRequired?: boolean;
}) {
  const copy = conciergeReviewRequired
    ? m.booking_holiday_advisory_concierge({ name })
    : m.booking_holiday_advisory_default({ name });

  return (
    <Banner tone="warn" className="mb-3">
      {copy}
    </Banner>
  );
}
