import { useState } from "react";
import type { useFetcher } from "react-router";
import { Modal, Button, Input, Select, Banner } from "@core/shared-ui";
import type { GuardedSubmit } from "~/hooks/useGuardedSubmit";
import { formatCurrency, formatDate } from "~/lib/format";
import { m } from "~/paraglide/messages";

/**
 * The staff payment surface for one invoice.
 *
 * Deliberately the STAFF list, not the client portal or checkout. Recording
 * money is capability-gated on `financial` and attributed to the acting user;
 * the client-facing surfaces have no such actor and must never offer the form.
 * Those two also deliberately quote the full invoice total, which is a settled
 * payment-collection decision this surface does not touch.
 *
 * A form, not a modal chain: amount, method, date and an optional note are all
 * visible at once, because a chain hides the field that matters most.
 */

export type PaymentRow = {
  id: string;
  kind: "deposit" | "balance" | "adjustment" | "refund";
  amountCents: number;
  method: string;
  provider: string | null;
  note: string | null;
  /** ISO-8601 instant the money MOVED, not when the row was written. */
  occurredAt: string;
  recordedBy: string | null;
  recordedByName: string | null;
  refundsId: string | null;
};

/** Only the invoice fields this surface reads; the page passes its own row. */
type PaymentsInvoice = {
  id: string;
  clientName: string | null;
  amountCents: number;
  currency: string;
};

type ActionData = { intent?: unknown; ok?: boolean; error?: string | null } | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fetcher = ReturnType<typeof useFetcher<any>>;

interface Props {
  invoice: PaymentsInvoice | null;
  payments: PaymentRow[];
  loading: boolean;
  /** Read-only here: `data` drives the error banner, `state` the busy affordance. */
  fetcher: Fetcher;
  /**
   * #106 — both writes on this surface move money, so neither may go out as a
   * raw `fetcher.submit`. The owner (`/invoices`) holds the guard; this leaf
   * only fires it.
   */
  submit: GuardedSubmit;
  /** The guard's own in-flight flag — the pending affordance on both buttons. */
  busy: boolean;
  locale: string;
  onClose: () => void;
}

function methodLabel(method: string): string {
  const labels: Record<string, string> = {
    card: m.invoices_method_label_card(),
    check: m.invoices_method_label_check(),
    cash: m.invoices_method_label_cash(),
    offline: m.invoices_method_label_offline(),
    other: m.invoices_method_label_other(),
  };
  return labels[method] ?? method;
}

function payMethodOptions() {
  return [
    { value: "cash", label: m.invoices_pay_method_cash() },
    { value: "check", label: m.invoices_pay_method_check() },
    { value: "offline", label: m.invoices_pay_method_offline() },
    { value: "other", label: m.invoices_pay_method_other() },
  ];
}

/** Today as the browser's own calendar day — the value a date input expects. */
function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The picker gives a calendar DAY; the ledger stores an INSTANT. The conversion
 * has to happen in the browser, because only the browser knows which zone that
 * day belongs to. Local midnight of a day that has already begun is always in
 * the past, so "today" can never trip the endpoint's no-future rule.
 */
function civilDayToInstant(day: string): string {
  return new Date(`${day}T00:00:00`).toISOString();
}

export function PaymentsModal({ invoice, payments, loading, fetcher, submit, busy, locale, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [occurredOn, setOccurredOn] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctedAmount, setCorrectedAmount] = useState("");
  const [reason, setReason] = useState("");

  if (!invoice) return null;
  const currency = invoice.currency;
  const data = fetcher.data as ActionData;

  // Receipts add, refunds subtract — the same one rule the ledger applies. A
  // correction is a refund-kind row, so it lands here without a special case.
  const receivedCents = payments.reduce(
    (sum, p) => sum + (p.kind === "refund" ? -p.amountCents : p.amountCents),
    0,
  );
  // The inspector's question is "how much is still owed", not "how much has
  // been paid" — so this is the figure that gets the size.
  const remainingCents = invoice.amountCents - receivedCents;

  // The endpoint refuses an overpayment until it is confirmed, because the same
  // input is far more often a decimal-point typo than a client rounding up.
  const overpaymentRefused =
    data?.intent === "record-payment" && data.ok === false && /exceeds/i.test(data.error ?? "");

  function submitPayment(allowOverpayment: boolean) {
    submit(
      {
        intent: "record-payment",
        id: invoice!.id,
        amount,
        method,
        occurredAt: occurredOn ? civilDayToInstant(occurredOn) : "",
        note,
        allowOverpayment: allowOverpayment ? "1" : "",
      },
      { method: "post" },
    );
  }

  function submitCorrection(paymentId: string) {
    // Only clear the form when the guard actually accepted the call. Clearing
    // on a refused second click would wipe the amount and reason the user is
    // still waiting on an answer for.
    const sent = submit(
      { intent: "correct-payment", id: invoice!.id, paymentId, amount: correctedAmount, reason },
      { method: "post" },
    );
    if (!sent) return;
    setCorrecting(null);
    setCorrectedAmount("");
    setReason("");
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${m.invoices_payments_title()} — ${invoice.clientName || "—"}`}
      footer={<Button variant="secondary" onClick={onClose}>{m.common_close()}</Button>}
    >
      <div className="space-y-4">
        {/* Step 3 — the remaining balance is the prominent figure, formatted
            through the shared money formatter with the INVOICE's own currency
            snapshot rather than the tenant's live setting. */}
        <div className="rounded-lg border border-ih-border bg-ih-bg-muted px-4 py-3">
          {/* fg-2, not fg-3: on the MUTED panel rather than the card, fg-3
              measures 4.34:1 in light mode — under AA for text this size. */}
          <div className="text-[11px] font-bold uppercase tracking-wide text-ih-fg-2">
            {m.invoices_payments_remaining()}
          </div>
          <div className="text-2xl font-bold text-ih-fg-1 tabular-nums">
            {formatCurrency(remainingCents, { locale, currency })}
          </div>
          <div className="mt-1 text-[12px] text-ih-fg-2">
            {m.invoices_payments_total_label()} {formatCurrency(invoice.amountCents, { locale, currency })}
            {" · "}
            {m.invoices_payments_received_label()} {formatCurrency(receivedCents, { locale, currency })}
          </div>
        </div>

        {data?.ok === false && data.error && <Banner tone="danger">{data.error}</Banner>}
        {overpaymentRefused && (
          <Button variant="secondary" onClick={() => submitPayment(true)} disabled={busy}>
            {m.invoices_payments_record_anyway()}
          </Button>
        )}

        {/* Step 2 — the rows, not just a total. Once an invoice can hold several
            payments, "paid $250" stops being the whole story, and a disputed
            payment is only answerable if amount, method, date and recorder are
            all on the page. */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wide text-ih-fg-3 mb-2">
            {m.invoices_payments_ledger_title()}
          </h3>
          {loading && payments.length === 0 ? (
            <p className="text-[13px] text-ih-fg-3">{m.common_loading()}</p>
          ) : payments.length === 0 ? (
            <p className="text-[13px] text-ih-fg-3">{m.invoices_payments_empty()}</p>
          ) : (
            <ul className="divide-y divide-ih-border rounded-lg border border-ih-border">
              {payments.map((p) => {
                const isCorrection = p.kind === "refund";
                // A payment can be corrected once. Offering the control on a row
                // that already carries a correction would only earn a 409, and
                // the correction is right there on the page saying so.
                const corrected = payments.some((other) => other.refundsId === p.id);
                return (
                  <li key={p.id} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className={`text-[15px] font-bold tabular-nums ${isCorrection ? "text-ih-bad-fg" : "text-ih-fg-1"}`}>
                        {isCorrection ? "−" : ""}
                        {formatCurrency(p.amountCents, { locale, currency })}
                      </span>
                      <span className="text-[12px] text-ih-fg-3">
                        {methodLabel(p.method)} · {formatDate(p.occurredAt, { locale })}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-[12px] text-ih-fg-3">
                        {p.recordedByName
                          ? m.invoices_payments_recorded_by({ name: p.recordedByName })
                          : m.invoices_payments_recorded_automatically()}
                      </span>
                      {!isCorrection && !p.provider && !corrected && (
                        <button
                          type="button"
                          onClick={() => setCorrecting(correcting === p.id ? null : p.id)}
                          className="text-[12px] font-bold text-ih-fg-2 hover:underline"
                        >
                          {m.invoices_payments_correct()}
                        </button>
                      )}
                    </div>
                    {/* A long note must not break the row — it wraps and the
                        row grows, rather than pushing the amount off the end. */}
                    {p.note && (
                      <p className="mt-1 text-[12px] text-ih-fg-3 break-words whitespace-pre-wrap">{p.note}</p>
                    )}
                    {correcting === p.id && (
                      <div className="mt-2 space-y-2 rounded-md border border-ih-border bg-ih-bg-muted p-3">
                        <p className="text-[12px] text-ih-fg-3">{m.invoices_payments_correct_hint()}</p>
                        <Input
                          label={m.invoices_payments_corrected_amount_label()}
                          type="number" min="0" step="0.01" inputMode="decimal"
                          value={correctedAmount}
                          onChange={(e) => setCorrectedAmount(e.target.value)}
                        />
                        <Input
                          label={m.invoices_payments_reason_label()}
                          placeholder={m.invoices_payments_reason_placeholder()}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => setCorrecting(null)}>{m.common_cancel()}</Button>
                          <Button variant="primary" disabled={busy} onClick={() => submitCorrection(p.id)}>
                            {m.invoices_payments_correct_submit()}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Step 1 — the date is VISIBLE and EDITABLE, pre-filled with today
            rather than assumed to be today. Tuesday's cash is recorded on
            Thursday, and a hidden date makes every reporting period wrong. */}
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ih-fg-3">
            {m.invoices_payments_record_title()}
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              label={m.invoices_payments_amount_label()}
              type="number" min="0" step="0.01" inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Select
              label={m.invoices_payments_method_label()}
              options={payMethodOptions()}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            />
            <Input
              label={m.invoices_payments_date_label()}
              type="date"
              max={todayLocal()}
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
            />
          </div>
          <Input
            label={m.invoices_payments_note_label()}
            placeholder={m.invoices_payments_note_placeholder()}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end">
            <Button variant="primary" disabled={busy} onClick={() => submitPayment(false)}>
              {busy ? m.invoices_payments_submitting() : m.invoices_payments_submit()}
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
