import { useActionLatch } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import { ConfirmDialog } from "~/components/ConfirmDialog";

/**
 * The confirmation in front of Disconnect.
 *
 * It says everything the disconnect actually does, because the shorter
 * wording it replaced left things out: ending a connection also deletes every
 * open item that needs attention and resets the sync state of every invoice,
 * not only the contact and invoice matches. The count of matches comes from the
 * connection status, so the figure is the one that will be cleared.
 *
 * The last paragraph is the consequence people do not expect: matches are not
 * restored by reconnecting, so the first sync afterwards matches contacts by
 * email again and creates a customer in QuickBooks for any it cannot match.
 */
export function QboDisconnectDialog({
  open,
  companyName,
  mappedCustomers,
  mappedInvoices,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  companyName: string | null;
  mappedCustomers: number;
  mappedInvoices: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // The dialog stays mounted for the frame in which the first click closes it,
  // so a second click in that frame would confirm again.
  const latch = useActionLatch(busy);
  return (
    <ConfirmDialog
      open={open}
      title={m.settings_qbo_disconnect_confirm_title()}
      message={m.settings_qbo_disconnect_confirm_body({
        company: companyName ?? m.settings_qbo_company_generic(),
      })}
      confirmLabel={m.settings_qbo_disconnect_confirm_action()}
      cancelLabel={m.settings_qbo_disconnect_keep()}
      busy={busy}
      onConfirm={() => latch(onConfirm)}
      onCancel={onCancel}
    >
      <div className="mt-4 space-y-4">
        <div>
          <h3 className="text-[13px] font-bold text-ih-fg-1">{m.settings_qbo_disconnect_changes_heading()}</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-ih-fg-2">
            <li>{m.settings_qbo_disconnect_stops()}</li>
            <li>
              {m.settings_qbo_disconnect_cleared({ contacts: mappedCustomers, invoices: mappedInvoices })}
            </li>
            <li>{m.settings_qbo_disconnect_errors_cleared()}</li>
          </ul>
        </div>
        <p className="rounded-md bg-ih-watch-bg px-3 py-2.5 text-[13px] text-ih-watch-fg">
          {m.settings_qbo_disconnect_reconnect_note()}
        </p>
      </div>
    </ConfirmDialog>
  );
}
