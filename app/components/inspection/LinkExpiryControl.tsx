import { Select, Input } from "@core/shared-ui";
import {
  reportLinkExpiresAt,
  REPORT_LINK_TTL_MAX_COUNT,
  type ReportLinkTtl,
  type ReportLinkTtlUnit,
} from "../../../server/lib/report-link-ttl";
import { formatDate } from "~/lib/format";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/**
 * How long a report link stays usable — the one control, used in two places
 * (IA-36 ⑦): Settings → Inspection sets the company default for links minted
 * from then on, and the inspection's People card applies a value to the links
 * this inspection has already sent.
 *
 * It expresses a DURATION, never a date. A date picker would let someone choose
 * a moment in the past, which means min-validation, an error state, and a note
 * explaining that to kill a link now they want a different button. Expressing
 * the same intent as "never / n days / n months / n years" deletes that whole
 * branch: the value cannot be in the past, so none of it has to exist. The
 * absolute date is still SHOWN — as a consequence, computed from the duration.
 */
export function LinkExpiryControl({
  value,
  onChange,
  from,
  idPrefix = "link-expiry",
}: {
  value: ReportLinkTtl;
  onChange: (next: ReportLinkTtl) => void;
  /** Anchor the previewed date. Defaults to now; pass a fixed value in tests. */
  from?: number;
  idPrefix?: string;
}) {
  const locale = useDisplayLocale();
  const timeZone = useDisplayTimeZone();
  const isNever = value === "never";
  const count = isNever ? 90 : value.count;
  const unit: ReportLinkTtlUnit = isNever ? "days" : value.unit;
  const expiresAt = reportLinkExpiresAt(value, from ?? Date.now());

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          bare
          aria-label={m.link_expiry_mode_label()}
          id={`${idPrefix}-mode`}
          data-testid={`${idPrefix}-mode`}
          className="w-40"
          value={isNever ? "never" : "after"}
          onChange={(e) =>
            onChange(e.target.value === "never" ? "never" : { count, unit })
          }
          options={[
            { value: "never", label: m.link_expiry_never() },
            { value: "after", label: m.link_expiry_after() },
          ]}
        />
        {!isNever && (
          <>
            <Input
              type="number"
              min={1}
              max={REPORT_LINK_TTL_MAX_COUNT}
              aria-label={m.link_expiry_count_label()}
              id={`${idPrefix}-count`}
              data-testid={`${idPrefix}-count`}
              className="w-24"
              value={count}
              onChange={(e) => {
                // An empty or nonsense field must not silently become "never" —
                // hold the last valid number until the operator types a real one.
                const next = Number.parseInt(e.target.value, 10);
                if (!Number.isFinite(next)) return;
                onChange({ count: Math.min(Math.max(next, 1), REPORT_LINK_TTL_MAX_COUNT), unit });
              }}
            />
            <Select
              bare
              aria-label={m.link_expiry_unit_label()}
              id={`${idPrefix}-unit`}
              data-testid={`${idPrefix}-unit`}
              className="w-36"
              value={unit}
              onChange={(e) => onChange({ count, unit: e.target.value as ReportLinkTtlUnit })}
              options={[
                { value: "days", label: m.link_expiry_unit_days() },
                { value: "months", label: m.link_expiry_unit_months() },
                { value: "years", label: m.link_expiry_unit_years() },
              ]}
            />
          </>
        )}
      </div>
      <p className="text-[12px] text-ih-fg-3 mt-2" data-testid={`${idPrefix}-preview`}>
        {expiresAt == null
          ? m.link_expiry_preview_never()
          : m.link_expiry_preview_date({ date: formatDate(expiresAt, { locale, timeZone }) })}
      </p>
    </div>
  );
}
