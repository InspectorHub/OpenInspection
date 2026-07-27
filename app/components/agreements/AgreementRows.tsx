import { Pill } from "@core/shared-ui";
import { formatDate } from "~/lib/format";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/**
 * Library → Agreements table rows.
 *
 * IA-65 — the signing-request row that used to live beside this one moved to
 * the inspection workspace (`inspection-hub/SigningRequests`), where the
 * envelope it describes actually belongs. What remains is the template row.
 */
export function TemplateRow({ t }: { t: { id: string; name?: string; updatedAt?: string; createdAt?: string } }) {
  const locale = useDisplayLocale();
  const timeZone = useDisplayTimeZone();
  const updatedOrCreated = t.updatedAt || t.createdAt;
  return (
    <tr key={t.id} className="hover:bg-ih-bg-muted/50 transition-colors">
      <td className="px-4 py-3 text-[13px] font-semibold text-ih-fg-1">
        {t.name || m.agreement_row_untitled()}
      </td>
      <td className="px-4 py-3 text-[13px] text-ih-fg-3">
        {updatedOrCreated ? formatDate(updatedOrCreated, { locale, timeZone }) : "--"}
      </td>
      <td className="px-4 py-3">
        <Pill tone="sat">{m.agreement_template_status_active()}</Pill>
      </td>
      <td className="px-4 py-3 text-right">
        <button className="text-[13px] text-ih-primary hover:opacity-80 font-semibold">{m.common_edit()}</button>
      </td>
    </tr>
  );
}
