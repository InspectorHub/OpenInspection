import { m } from "~/paraglide/messages";
import { formatCurrency } from "~/lib/format";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { QBO_VOIDED_IN_QBO } from "../../../server/lib/qbo-discrepancy";
import type { QBOSyncErrorSummary } from "../../../server/services/qbo/api-base";

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
 * How one open row reads.
 *
 * `VOIDED_IN_QBO` gets its own words because it is not a failure: nothing went
 * wrong on the wire, QuickBooks simply zeroed a document and someone has to
 * decide whether to match it here. Rendering it as "error" alongside a refused
 * push is how a flag added precisely so a human would notice would have gone
 * unnoticed anyway.
 *
 * Anything else falls through to a neutral label rather than being hidden. An
 * unknown code is a row the tenant still has to look at, and dropping it would
 * reproduce this component's original defect one level down.
 */
function kindLabel(errorCode: string): string {
  if (errorCode === QBO_VOIDED_IN_QBO) return m.settings_qbo_error_kind_voided();
  if (errorCode === "SYNC_ERROR") return m.settings_qbo_error_kind_sync();
  return m.settings_qbo_error_kind_other();
}

/**
 * The three things on the QuickBooks page that are about the tenant's BOOKS
 * rather than about the connection: pushes that failed, figures the two sides
 * disagree on, and money we deliberately never send.
 *
 * The first of those used to be a NUMBER and one sentence telling the reader to
 * "check the sync error log for details" — a log this product does not have.
 * Every defect the QuickBooks integration produces surfaces here, so a count
 * meant six distinct failures and one bad guess were indistinguishable, and
 * `describeQboError` wrote a message naming what QuickBooks refused that
 * nothing could display. The rows travel whole now.
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
  onDismissError,
  dismissingId,
}: {
  openErrors: QBOSyncErrorSummary[];
  discrepancies: QboDiscrepancy[];
  heldDepositCount: number;
  /** Closes one row. The tenant has dealt with it; nothing is re-sent. */
  onDismissError: (id: string) => void;
  /** The row currently being closed, so only its own button reads as busy. */
  dismissingId: string | null;
}) {
  const locale = useDisplayLocale();

  return (
    <>
      {openErrors.length > 0 && (
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
            {m.settings_qbo_sync_errors({ count: openErrors.length })}
          </h3>
          <p className="text-[12px] text-ih-fg-3 mb-3">{m.settings_qbo_sync_errors_desc()}</p>
          <ul className="space-y-3">
            {openErrors.map((e) => (
              <li
                key={e.id}
                className="flex items-start justify-between gap-4 border-t border-ih-border pt-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-ih-fg-1">{kindLabel(e.errorCode)}</p>
                  {/* The id is truncated for width, never linked: the bootstrap
                      probe writes the sentinel oi_id 'bootstrap', so a link here
                      would be dead for one real row out of the set. */}
                  <p className="text-[12px] text-ih-fg-3">
                    {m.settings_qbo_error_entity({ entity: e.oiType, id: e.oiId.slice(0, 8) })}
                    {" · "}
                    {e.retries > 1
                      ? m.settings_qbo_error_seen_times({ count: e.retries })
                      : m.settings_qbo_error_seen_once()}
                  </p>
                  {/* Whatever QuickBooks actually said. `break-words` because a
                      fault detail is one long unbroken string often enough to
                      push the card wider than the page. */}
                  <p className="text-[12px] text-ih-fg-2 mt-1 break-words">{e.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onDismissError(e.id)}
                  disabled={dismissingId !== null}
                  aria-busy={dismissingId === e.id || undefined}
                  className="shrink-0 px-3 py-1.5 text-[12px] font-bold text-ih-fg-2 bg-ih-bg-muted rounded-md hover:bg-ih-bg-muted transition-colors disabled:opacity-50"
                >
                  {m.settings_qbo_error_dismiss()}
                </button>
              </li>
            ))}
          </ul>
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
