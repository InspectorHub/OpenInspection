/**
 * When a monthly allowance renews: the UTC date it is defined by, and the same
 * instant in the viewer's own zone, both visible (a hover-only hint is not
 * reachable on a phone). `resetsAt` is the ISO instant the server sends.
 */
import { formatDate, formatDateTime } from "@core/field-ui/shared/format";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export function AllowanceResetNote({ resetsAt, className }: { resetsAt: string; className?: string }) {
  const locale = useDisplayLocale();
  const timeZone = useDisplayTimeZone();
  const utcDate = formatDate(resetsAt, { locale, timeZone: "UTC", month: "short" });
  if (!utcDate) return null;
  return (
    <span className={className}>
      {m.allowance_resets_utc({ date: utcDate })}
      {timeZone !== "UTC" && (
        <>
          {" · "}
          {m.allowance_resets_local({ when: formatDateTime(resetsAt, { locale, timeZone }) })}
        </>
      )}
    </span>
  );
}
