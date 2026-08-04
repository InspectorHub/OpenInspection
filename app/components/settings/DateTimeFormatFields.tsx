import { Select } from "@core/shared-ui";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { dateFormatOptions, timeFormatOptions } from "~/lib/date-format-options";

/**
 * #270 — the date-order + clock pair, shared by the company default
 * (settings-workspace) and the personal override (settings-profile).
 *
 * One component rather than two copies because the two surfaces must offer the
 * SAME three shapes with the SAME worked examples. A parallel pair drifts, and
 * a company whose picker disagrees with its inspectors' picker is worse than
 * having no picker: the setting exists to make one vocabulary out of three
 * people, and it cannot do that if the two screens name the options differently.
 *
 * The only real difference is whether "inherit" is offered, which is a prop:
 * the tenant value is the bottom of the resolution chain and has nothing to
 * inherit from.
 */
export function DateTimeFormatFields({
  dateLabel,
  timeLabel,
  dateValue,
  timeValue,
  inheritLabel,
}: {
  dateLabel: string;
  timeLabel: string;
  /** Stored value; `null`/`""` selects the inherit option when one is offered. */
  dateValue: string | null | undefined;
  timeValue: string | null | undefined;
  /** Omit to render the tenant-level picker, which has no inherit state. */
  inheritLabel?: string;
}) {
  // Worked examples ("11 Sep 2026"), so the month word has to be written in the
  // language this reader is actually looking at.
  const locale = useDisplayLocale();
  const inherit = inheritLabel ? [{ value: "", label: inheritLabel }] : [];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-2xl">
      <Select
        label={dateLabel}
        name="dateFormat"
        defaultValue={dateValue ?? (inheritLabel ? "" : "us")}
        options={[...inherit, ...dateFormatOptions(locale)]}
      />
      <Select
        label={timeLabel}
        name="timeFormat"
        defaultValue={timeValue ?? (inheritLabel ? "" : "12h")}
        options={[...inherit, ...timeFormatOptions(locale)]}
      />
    </div>
  );
}
