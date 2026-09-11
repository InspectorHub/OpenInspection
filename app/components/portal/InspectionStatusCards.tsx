import { Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/* Types */
/* ------------------------------------------------------------------ */

export interface StatusOverview {
  inspectionStatus: string;
  agreementSigned: boolean;
  paymentStatus: string;
  reportPublished: boolean;
  progress: { completed: number; total: number };
  unreadMessages: number;
  address: string;
  date: string;
  /** Whether this inspection HAS an agreement gate / a payment gate at all, and
   *  whether a manual unlock has released them. See HubOverview in
   *  server/services/portal.service.ts — these are the server gate's own inputs. */
  agreementRequired: boolean;
  paymentRequired: boolean;
  reportUnlocked: boolean;
  /** A live (non-voided) invoice exists for this inspection. */
  hasInvoice: boolean;
  /** The repair-request builder is enabled for this company. */
  repairRequestEnabled: boolean;
}

type CardTone = "ok" | "warn" | "bad" | "neutral";

export interface StatusCardModel {
  key: string;
  label: string;
  value: string;
  badge?: number;
  tone: CardTone;
}

/* ------------------------------------------------------------------ */
/* Pure model (unit-tested) */
/* ------------------------------------------------------------------ */

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The payment tile answers "do I owe this company money", and it may only say
 * yes when there is a bill.
 *
 * `inspections.payment_status` is 'unpaid' from the moment the inspection is
 * created, invoice or no invoice, so rendering it verbatim in a warning colour
 * told clients they were in arrears on inspections nobody had billed — while the
 * Payment tab one click away said "No invoice yet". Both readings came from the
 * same row; only one of them was true.
 *
 * Paid is paid. With a live invoice, whatever the row says is a real balance and
 * keeps the nudge colour. With no invoice there is nothing to pay, and the tile
 * says so in the Hub's existing words (`label_hub_invoice_none`).
 */
function paymentCardState(ov: StatusOverview): { value: string; tone: CardTone } {
  const s = ov.paymentStatus.toLowerCase();
  if (s === "paid") return { value: capitalize(ov.paymentStatus), tone: "ok" };
  if (!ov.hasInvoice) return { value: m.label_hub_invoice_none(), tone: "neutral" };
  // partial / unpaid (and anything else) surface as a warning to nudge action.
  return { value: capitalize(ov.paymentStatus), tone: "warn" };
}

/**
 * The agreement tile, same rule one column over. "Not signed" in a warning
 * colour reads as an outstanding obligation; on an inspection with
 * `agreementRequired` false there is no agreement to sign, and on 36 of 37
 * production inspections that is the state.
 */
function agreementCardState(ov: StatusOverview): { value: string; tone: CardTone } {
  if (ov.agreementSigned) return { value: m.portal_status_agreement_signed(), tone: "ok" };
  if (!ov.agreementRequired) return { value: m.label_hub_agreement_not_required(), tone: "neutral" };
  return { value: m.portal_status_agreement_unsigned(), tone: "warn" };
}

/**
 * The report tile answers the CLIENT's question — "can I read it yet?" — not
 * the inspector's "has it been published?".
 *
 * Those two answers diverge whenever a published report is still gated behind
 * the agreement or payment, and the Hub renders `reportLockNotice`'s "Your
 * report isn't available yet" banner directly above these cards. A green
 * "Published" tile underneath it stated the opposite in the same viewport.
 *
 * Published-and-open is still plainly "Published"; not-yet-published is still
 * neutral, because that one is pending on the inspector and there is nothing
 * for the client to act on.
 */
function reportCardState(ov: StatusOverview): { value: string; tone: CardTone } {
  if (!ov.reportPublished) {
    return { value: m.portal_status_report_unpublished(), tone: "neutral" };
  }
  const lock = reportLockNotice(ov);
  if (!lock) return { value: m.portal_status_report_published(), tone: "ok" };
  return {
    value:
      lock.reason === "agreement"
        ? m.portal_status_report_locked_agreement()
        : m.portal_status_report_locked_payment(),
    // Same tone as the agreement/payment tiles that name the same gate, so the
    // client sees one consistent "this is on you" colour across the row.
    tone: "warn",
  };
}

/**
 * Build the 6 overview status cards in a fixed key order:
 * appointment, agreement, payment, report, progress, messages.
 *
 * Pure + presentation-agnostic so the default-exported component AND the
 * agent portal can both consume the same model.
 */
export function statusCardModels(ov: StatusOverview): StatusCardModel[] {
  return [
    {
      key: "appointment",
      label: m.portal_status_appointment_label(),
      value: capitalize(ov.inspectionStatus) + (ov.date ? ` · ${ov.date}` : ""),
      tone: "neutral",
    },
    {
      key: "agreement",
      label: m.portal_status_agreement_label(),
      ...agreementCardState(ov),
    },
    {
      key: "payment",
      label: m.portal_status_payment_label(),
      ...paymentCardState(ov),
    },
    {
      key: "report",
      label: m.portal_status_report_label(),
      ...reportCardState(ov),
    },
    {
      key: "progress",
      label: m.portal_status_progress_label(),
      value: `${ov.progress.completed}/${ov.progress.total}`,
      tone: "neutral",
    },
    {
      key: "messages",
      label: m.portal_status_messages_label(),
      value: ov.unreadMessages > 0 ? m.portal_status_messages_unread({ count: ov.unreadMessages }) : m.portal_status_messages_none(),
      badge: ov.unreadMessages || undefined,
      // CardTone has no 'info'; the badge conveys the unread state.
      tone: "neutral",
    },
  ];
}

/**
 * IA-45 — what (if anything) is keeping the client from their report, and which
 * Hub section resolves it. The report is gated behind the agreement first, then
 * payment (same precedence as the server's report-gate context). Returns null
 * when nothing is outstanding — a not-yet-published report with no gate is
 * simply pending on the inspector, not something the client can act on.
 *
 * Pure so the overview can render a "here's why + next step" notice without a
 * second server round-trip; the retired /report-gate page's explanation now
 * lives inline on the Hub the client already reaches.
 *
 * ⚠️ A GATE IS A SWITCH, NOT A STATE. This used to read
 *
 *     if (!ov.agreementSigned) return { reason: "agreement", ... };
 *     if (ov.paymentStatus.toLowerCase() !== "paid") return { reason: "payment", ... };
 *
 * which is the question "is the paperwork done", not "is the report being held
 * back". `is_agreement_required` and `is_payment_required` both default to
 * false, so on an inspection that asks for neither the notice still fired and
 * sent the client to an Agreement section with nothing in it — while the Report
 * tab beside it served the whole report, because the REAL gate
 * (InspectionPublishService.getReportGate) reads these flags and returned "not
 * gated". Three readers, one of them guessing.
 *
 * The inputs below are that server gate's inputs, in its order: a manual unlock
 * releases everything; otherwise each half applies only when its own flag is on.
 * Keep the two in step — this predicate exists so the page can say it without a
 * round trip, not so it can decide it independently.
 */
export type ReportLockReason = "agreement" | "payment";

export function reportLockNotice(
  ov: Pick<
    StatusOverview,
    "agreementSigned" | "paymentStatus" | "agreementRequired" | "paymentRequired" | "reportUnlocked"
  >,
): { reason: ReportLockReason; section: "agreement" | "payment" } | null {
  // A named person released the order-wide gate. Same scope the gate has.
  if (ov.reportUnlocked) return null;
  if (ov.agreementRequired && !ov.agreementSigned) return { reason: "agreement", section: "agreement" };
  if (ov.paymentRequired && ov.paymentStatus.toLowerCase() !== "paid") {
    return { reason: "payment", section: "payment" };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Component */
/* ------------------------------------------------------------------ */

const TONE_CLASSES: Record<CardTone, string> = {
  ok: "bg-ih-ok-bg text-ih-ok-fg",
  warn: "bg-ih-watch-bg text-ih-watch-fg",
  bad: "bg-ih-bad-bg text-ih-bad-fg",
  neutral: "bg-ih-bg-muted text-ih-fg-2",
};

export default function InspectionStatusCards({ overview }: { overview: StatusOverview }) {
  const cards = statusCardModels(overview);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`rounded-lg p-4 ${TONE_CLASSES[c.tone]}`}
        >
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">
              {c.label}
            </div>
            {c.badge != null && (
              <Pill tone="info" className="text-[10px]">
                {c.badge}
              </Pill>
            )}
          </div>
          <div className="mt-1 text-sm font-semibold">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
