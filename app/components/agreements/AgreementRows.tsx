import { Pill } from "@core/shared-ui";
import { formatDate } from "~/lib/format";
import { useDisplayLocale, useDisplayTimeZone } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

/**
 * Library → Agreements table rows.
 *
 * IA-65 — the signing-request row that used to live beside this one moved to
 * the inspection workspace (`inspector-portal/SigningRequests`), where the
 * envelope it describes actually belongs. What remains is the template row.
 *
 * #67 — the Edit button used to be a `<button>` with no `onClick`, beside a
 * "Last updated" column reading a field the `agreements` table does not have.
 * Both are handled here now: the actions are props (the page owns the editor
 * and the delete dialog), and the date column says which date it is showing.
 */
export function TemplateRow({
  t,
  onEdit,
  onDelete,
}: {
  t: { id: string; name?: string; updatedAt?: string; createdAt?: string };
  onEdit: (id: string) => void;
  onDelete: (t: { id: string; name?: string }) => void;
}) {
  const locale = useDisplayLocale();
  const timeZone = useDisplayTimeZone();
  // ⚠️ `agreements` has `created_at` and NO `updated_at`, and `updateAgreement`
  // does not write one — it bumps `version` instead. `updatedAt` is read first
  // because the API's response schema still declares it; when it is absent (it
  // always is today) the created date shows, labelled as the created date.
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
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => onEdit(t.id)}
            className="text-[13px] text-ih-primary hover:opacity-80 font-semibold"
          >
            {m.common_edit()}
          </button>
          <button
            type="button"
            onClick={() => onDelete(t)}
            className="text-[13px] text-ih-fg-3 hover:text-ih-bad-fg hover:underline font-semibold"
          >
            {m.common_delete()}
          </button>
        </div>
      </td>
    </tr>
  );
}
