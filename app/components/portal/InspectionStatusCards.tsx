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
}

export type CardTone = "ok" | "warn" | "bad" | "neutral";

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

function paymentTone(status: string): CardTone {
  const s = status.toLowerCase();
  if (s === "paid") return "ok";
  // partial / unpaid (and anything else) surface as a warning to nudge action.
  return "warn";
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
      value: ov.agreementSigned ? m.portal_status_agreement_signed() : m.portal_status_agreement_unsigned(),
      tone: ov.agreementSigned ? "ok" : "warn",
    },
    {
      key: "payment",
      label: m.portal_status_payment_label(),
      value: capitalize(ov.paymentStatus),
      tone: paymentTone(ov.paymentStatus),
    },
    {
      key: "report",
      label: m.portal_status_report_label(),
      value: ov.reportPublished ? m.portal_status_report_published() : m.portal_status_report_unpublished(),
      tone: ov.reportPublished ? "ok" : "neutral",
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
