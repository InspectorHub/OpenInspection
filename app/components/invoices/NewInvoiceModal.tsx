/**
 * The "New invoice" form, lifted out of `routes/invoices.tsx` when that route
 * crossed the 400-line file cap (IA-97). Self-contained: its only inputs are
 * whether it is open and which inspections may be billed, and it posts back to
 * the route's own action.
 */
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Modal } from "@core/shared-ui";
import { MoneyInput } from "~/components/MoneyInput";
import { formatDate } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";
import type { action } from "~/routes/invoices";

export type InspectionOption = {
  id: string;
  propertyAddress: string | null;
  clientName: string | null;
  date: string | null;
};

export function NewInvoiceModal({
  open,
  onClose,
  inspections,
}: {
  open: boolean;
  onClose: () => void;
  inspections: InspectionOption[];
}) {
  const fetcher = useFetcher<typeof action>();
  const locale = useDisplayLocale();
  const busy = fetcher.state !== "idle";
  const [clientName, setClientName] = useState("");
  // Money stays in integer cents; the hidden `amount` field carries dollars to
  // the action (which multiplies by 100), so the wire contract is unchanged.
  const [amountCents, setAmountCents] = useState<number | null>(null);

  // Close on successful create; the action revalidates the list automatically.
  // (onClose is intentionally omitted from deps — parent recreates it per render.)
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.intent === "create-invoice" && fetcher.data.ok) {
      onClose();
    }
  }, [fetcher.state, fetcher.data]);  

  if (!open) return null;
  const inputCls =
    "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all";
  const labelCls = "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1";

  return (
    <Modal open={open} onClose={onClose} title={m.invoices_new_title()} size="md">
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="create-invoice" />
        <div>
          <label htmlFor="ninv-inspection" className={labelCls}>{m.invoices_new_inspection_label()}</label>
          <select
            id="ninv-inspection"
            name="inspectionId"
            className={inputCls}
            defaultValue=""
            onChange={(e) => {
              const insp = inspections.find((i) => i.id === e.target.value);
              if (insp?.clientName && !clientName) setClientName(insp.clientName);
            }}
          >
            <option value="">{m.invoices_new_no_inspection()}</option>
            {inspections.map((i) => (
              <option key={i.id} value={i.id}>
                {(i.propertyAddress || i.id.slice(0, 8)) + (i.date ? ` · ${formatDate(i.date, { locale, timeZone: "UTC" })}` : "")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ninv-client" className={labelCls}>{m.invoices_new_client_label()}</label>
          <input
            id="ninv-client" name="clientName" required className={inputCls}
            value={clientName} onChange={(e) => setClientName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ninv-amount" className={labelCls}>{m.invoices_new_amount_label()}</label>
            <MoneyInput cents={amountCents} onChange={setAmountCents} ariaLabel={m.invoices_new_amount_label()} className={inputCls} />
            <input type="hidden" name="amount" value={amountCents == null ? "" : String(amountCents / 100)} />
          </div>
          <div>
            <label htmlFor="ninv-due" className={labelCls}>{m.invoices_new_due_label()}</label>
            <input id="ninv-due" name="dueDate" type="date" className={inputCls} />
          </div>
        </div>
        <div>
          <label htmlFor="ninv-notes" className={labelCls}>{m.invoices_new_notes_label()}</label>
          <input id="ninv-notes" name="notes" className={inputCls} />
        </div>
        {fetcher.data?.intent === "create-invoice" && fetcher.data.error && (
          <p className="text-[12px] text-ih-bad-fg">{fetcher.data.error}</p>
        )}
        <div className="flex justify-end gap-3 pt-2 border-t border-ih-border">
          <button type="button" onClick={onClose} disabled={busy}
            className="h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors disabled:opacity-60">
            {m.common_cancel()}
          </button>
          <button type="submit" disabled={busy}
            className="h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            {busy ? m.invoices_new_creating() : m.invoices_new_create()}
          </button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
