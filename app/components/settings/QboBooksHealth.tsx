import { m } from "~/paraglide/messages";
import { formatCurrency } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";

export interface QboDiscrepancy {
  id: string;
  invoiceId: string;
  currency: string;
  /** What our payment ledger records as received. */
  ledgerCents: number;
  /** QuickBooks' implied paid amount (TotalAmt − Balance). */
  qboCents: number;
}

/**
 * The three things on the QuickBooks page that are about the tenant's BOOKS
 * rather than about the connection: pushes that failed, figures the two sides
 * disagree on, and money we deliberately never send.
 *
 * A discrepancy is shown with BOTH figures and never as one reconciled number.
 * Spec 2026-08-01 payment/deposit flow §6 — our ledger is authoritative for what
 * we collected, QuickBooks reports a balance and cannot reconstruct our rows, so
 * a human reconciles. Auto-adjusting either side would record money movement
 * nobody performed, and showing a single "corrected" figure would hide that the
 * question was ever open.
 */
export function QboBooksHealth({
  openErrors,
  discrepancies,
  heldDepositCount,
}: {
  openErrors: number;
  discrepancies: QboDiscrepancy[];
  heldDepositCount: number;
}) {
  const locale = useDisplayLocale();

  return (
    <>
      {openErrors > 0 && (
        <div className="bg-ih-bg-card border border-ih-bad rounded-lg p-6">
          <h3 className="font-bold text-[14px] text-ih-fg-1 mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-ih-bad-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {m.settings_qbo_sync_errors({ count: openErrors })}
          </h3>
          <p className="text-[12px] text-ih-fg-3">{m.settings_qbo_sync_errors_desc()}</p>
        </div>
      )}

      {/* Surfaced, never auto-corrected. */}
      {discrepancies.length > 0 && (
        <div className="bg-ih-bg-card border border-ih-watch-fg/40 rounded-lg p-6">
          <h3 className="font-bold text-[14px] text-ih-fg-1 mb-2">
            {m.settings_qbo_discrepancy_heading({ count: discrepancies.length })}
          </h3>
          <p className="text-[12px] text-ih-fg-3 mb-3">{m.settings_qbo_discrepancy_desc()}</p>
          <ul className="space-y-1.5">
            {discrepancies.map((d) => (
              <li key={d.id} className="text-[12px] text-ih-fg-2">
                {m.settings_qbo_discrepancy_row({
                  invoice: d.invoiceId.slice(0, 8),
                  ours: formatCurrency(d.ledgerCents, { locale, currency: d.currency }),
                  theirs: formatCurrency(d.qboCents, { locale, currency: d.currency }),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What deliberately does not reach QuickBooks, said where they would look
          for it — silence here reads as "everything synced". */}
      {heldDepositCount > 0 && (
        <div className="bg-ih-bg-card border border-ih-border rounded-lg p-6">
          <h3 className="font-bold text-[14px] text-ih-fg-1 mb-2">
            {m.settings_qbo_not_synced_heading()}
          </h3>
          <p className="text-[12px] text-ih-fg-3">
            {m.settings_qbo_not_synced_deposits({ count: heldDepositCount })}
          </p>
        </div>
      )}
    </>
  );
}
