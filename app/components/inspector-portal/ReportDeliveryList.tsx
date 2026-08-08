/**
 * <ReportDeliveryList> — "did the report reach them, and did they open it?"
 * (OI #271, LIA condition 6).
 *
 * Sits at the head of the Outbox, because that is the block an inspector opens
 * when asking the question, and because condition 6 requires "opened" to be
 * PAIRED with delivery status rather than shown on its own. The Outbox rows
 * below carry the reason for anything that failed or was skipped; this list
 * carries the shorter answer.
 *
 * ## Three states, and why the third is not a nicety
 *
 *   queued    → "Scheduled to send <when>" and NO open status, because none is
 *               possible. The automation ledger hides future-dated rows (a
 *               "pending" row dated tomorrow reads as a failure), so without
 *               this state a scheduled notice would render as "not yet opened"
 *               and send the inspector after a client who was never written to.
 *   delivered → "Delivered <when> · not yet opened" — the two facts in one
 *               line, in that order, so neither can be read without the other.
 *   opened    → the counters, as counters.
 *
 * ## Two things this component must never become
 *
 *  1. **Proof.** LIA §3.4(a): the human filter is a heuristic, and a determined
 *     mail-security scanner issuing a plain `GET` is indistinguishable from a
 *     reader. The caveat renders whenever an open does. The remedy for the
 *     false-positive rate is NOT client-side confirmation — that would move the
 *     lawful basis from legitimate interests to consent.
 *  2. **A dashboard.** No chart, no trend, no "engagement", no ranking of
 *     recipients. The LIA's purpose test passes for the delivery question and
 *     explicitly for nothing else, and a visualisation is a different purpose
 *     that would need its own assessment. The co-located test asserts the
 *     absence of an `<svg>` for exactly this reason.
 *
 * ## Scope
 *
 * One line per RECIPIENT, never per deliverable. `report_views` carries no
 * `report_id` on purpose (LIA §3.4(b)): the public renderer has no report
 * identity, so hanging an order-scoped open off "the radon report" would
 * manufacture a false statement about an identified person — the one thing
 * §3.4(b) rejects outright. That is also why this list does not live on
 * <ReportsCard>, which is the per-deliverable surface.
 *
 * lint:ds — only `ih-*` design tokens; raw Tailwind colors are forbidden.
 */
import { m } from "~/paraglide/messages";
import type { ReportLinkRow } from "~/lib/communication-view";

export function ReportDeliveryList({
  rows,
  timeZone,
  locale,
}: {
  rows: ReportLinkRow[];
  timeZone: string;
  locale: string;
}) {
  if (rows.length === 0) return null;

  const when = (ms: number) =>
    new Intl.DateTimeFormat(locale, {
      timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(ms));

  // Rendered once, beneath the list, and only when there is an open to qualify.
  // A caveat attached to every line would be read as boilerplate; a caveat that
  // never appears leaves a number speaking for itself.
  const anyOpened = rows.some((r) => r.state === "opened");

  return (
    <div className="pb-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-ih-fg-4 pt-1 pb-1.5">
        {m.comm_report_delivery_heading()}
      </p>
      <ul className="space-y-1.5" data-testid="report-delivery-list">
        {rows.map((r) => (
          <li key={r.accessTokenId} className="text-[12px]">
            <span className="text-ih-fg-2 font-medium">
              {r.roleLabel ?? r.roleKey ?? m.comm_report_delivery_norole()}
            </span>
            <span className="text-ih-fg-4"> · {r.recipient}</span>
            <span className="block text-ih-fg-3 mt-0.5 tabular-nums">{stateLine(r, when)}</span>
            {r.trackingObjected && (
              // Without this, a zero would read as "they never opened it" about
              // someone who may well have read it — the count is zero because
              // we stopped counting (GDPR Art. 21).
              <span className="block text-ih-fg-4 mt-0.5">{m.comm_report_delivery_objected()}</span>
            )}
          </li>
        ))}
      </ul>
      {anyOpened && (
        <p className="mt-2 text-[11px] leading-relaxed text-ih-fg-4">
          {m.comm_report_delivery_caveat()}
        </p>
      )}
    </div>
  );
}

/** The one line that carries this recipient's state. */
function stateLine(r: ReportLinkRow, when: (ms: number) => string): string {
  if (r.state === "queued") {
    return m.comm_report_delivery_queued({ when: r.scheduledAt == null ? "" : when(r.scheduledAt) });
  }
  if (r.state === "delivered") {
    return m.comm_report_delivery_unopened({ when: r.sentAt == null ? "" : when(r.sentAt) });
  }
  const first = r.firstViewedAt == null ? "" : when(r.firstViewedAt);
  // "Opened 1 times" is the kind of thing a reader stops trusting the rest of
  // the panel over, and a single open has no meaningful "last".
  if (r.viewCount <= 1) return m.comm_report_delivery_opened_one({ first });
  return m.comm_report_delivery_opened_many({
    count: r.viewCount,
    first,
    last: r.lastViewedAt == null ? "" : when(r.lastViewedAt),
  });
}
