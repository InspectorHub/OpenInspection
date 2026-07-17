import { useLoaderData } from "react-router";
import type { Route } from "./+types/report-gate";
import { createApi } from "~/lib/api-client.server";
import { ErrorState } from "~/components/ErrorState";
import { brandTokens } from "~/lib/brand";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.report_gate_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GateData {
  reason: "payment" | "agreement";
  companyName: string;
  primaryColor: string | null;
  actionUrl: string;
  actionLabel: string;
  propertyAddress?: string | null;
  inspectorName?: string | null;
  inspectorEmail?: string | null;
  inspectorPhone?: string | null;
  inspectorLicense?: string | null;
  scheduledDate?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  locale?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params, context }: Route.LoaderArgs) {
  try {
    const api = createApi(context);
    const res = await api.publicReport["report-gate"][":tenant"][":id"].$get({
      param: { tenant: params.tenant ?? "", id: params.id ?? "" },
    });
    const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
    const d = (body.data ?? {}) as Record<string, unknown>;
    return { gate: (Object.keys(d).length > 0 ? d : null) as GateData | null, error: res.ok ? null : "Not found" };
  } catch {
    return { gate: null, error: "Service unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

// Public page: no session context — the locale comes from the tenant default via
// the loader (gate.locale). Varied option sets (weekday, whole-dollar drop) the
// curated formatter can't express, so format with the injected locale directly.
function formatDate(scheduledDate: string | null | undefined, locale: string): string | null {
  if (!scheduledDate) return null;
  try {
    return new Date(scheduledDate).toLocaleDateString(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return scheduledDate;
  }
}

function formatAmount(
  amountCents: number | null | undefined,
  currency: string | null | undefined,
  locale: string,
): string | null {
  if (typeof amountCents !== "number" || amountCents <= 0) return null;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function ReportGatePage() {
  const { gate, error } = useLoaderData<typeof loader>();

  if (error || !gate) {
    return (
      <ErrorState
        title={m.report_gate_notfound_title()}
        message={m.report_gate_notfound_message()}
      />
    );
  }

  const title =
    gate.reason === "payment" ? m.report_gate_status_payment() : m.report_gate_status_agreement();
  const message =
    gate.reason === "payment"
      ? m.report_gate_message_payment()
      : m.report_gate_message_agreement();

  const locale = gate.locale || "en-US";
  const formattedDate = formatDate(gate.scheduledDate, locale);
  const formattedAmount = formatAmount(gate.amountCents, gate.currency, locale);
  const ctaLabel =
    gate.reason === "payment" && formattedAmount
      ? m.report_gate_cta_pay({ amount: formattedAmount })
      : gate.actionLabel;
  const hasContact = !!(gate.inspectorEmail || gate.inspectorPhone || gate.inspectorLicense);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-app" style={brandTokens(gate.primaryColor)}>
      <div className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-8 shadow-ih-card">
        {/* Pill */}
        <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-semibold tracking-wide bg-ih-watch-bg text-ih-watch-fg mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-ih-watch animate-pulse" />
          {title}
        </span>

        <h1 className="font-serif text-[26px] font-semibold tracking-tight leading-tight mb-2 text-ih-fg-1">
          {m.report_gate_heading()}
        </h1>
        <p className="text-sm text-ih-fg-3 leading-relaxed mb-6">
          {message}
        </p>

        {/* Meta card */}
        {(formattedAmount || gate.propertyAddress || gate.inspectorName || formattedDate || hasContact) && (
          <div className="bg-ih-bg-muted border border-ih-border rounded-lg p-4 mb-6 text-[13px] text-ih-fg-3">
            {formattedAmount && (
              <div className="flex justify-between items-baseline pb-3 mb-3 border-b border-ih-border">
                <span className="text-[11px] uppercase tracking-wide text-ih-fg-4">
                  {m.report_gate_meta_amount_due()}
                </span>
                <span className="font-serif text-[22px] font-semibold text-ih-fg-1 tracking-tight">
                  {formattedAmount}
                </span>
              </div>
            )}
            {gate.propertyAddress && (
              <MetaRow label={m.report_gate_meta_property()}>
                <strong className="text-ih-fg-1 font-semibold">
                  {gate.propertyAddress}
                </strong>
              </MetaRow>
            )}
            {formattedDate && <MetaRow label={m.report_gate_meta_scheduled()}>{formattedDate}</MetaRow>}
            {gate.inspectorName && <MetaRow label={m.report_gate_meta_inspector()}>{gate.inspectorName}</MetaRow>}
            {hasContact && (gate.propertyAddress || gate.inspectorName || formattedDate) && (
              <div className="h-px bg-ih-bg-muted my-3" />
            )}
            {gate.inspectorEmail && (
              <MetaRow label={m.report_gate_meta_email()}>
                <a
                  href={`mailto:${gate.inspectorEmail}`}
                  className="text-ih-primary hover:underline"
                >
                  {gate.inspectorEmail}
                </a>
              </MetaRow>
            )}
            {gate.inspectorPhone && (
              <MetaRow label={m.report_gate_meta_phone()}>
                <a
                  href={`tel:${gate.inspectorPhone}`}
                  className="text-ih-primary hover:underline"
                >
                  {gate.inspectorPhone}
                </a>
              </MetaRow>
            )}
            {gate.inspectorLicense && (
              <MetaRow label={m.report_gate_meta_license()}>{gate.inspectorLicense}</MetaRow>
            )}
          </div>
        )}

        {/* CTA */}
        <a
          href={gate.actionUrl}
          className="inline-flex items-center justify-center h-11 px-6 rounded-lg text-sm font-bold text-ih-primary-fg bg-ih-primary hover:opacity-95 hover:-translate-y-px transition-all shadow-ih-card"
        >
          {ctaLabel}
        </a>

        {/* Trust footer */}
        {gate.reason === "payment" ? (
          <div className="flex items-center justify-center gap-1.5 mt-5 text-[11px] text-ih-fg-4">
            <svg
              className="w-3 h-3"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="7" width="10" height="6" rx="1" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            {m.report_gate_secured_by_stripe({ company: gate.companyName })}
          </div>
        ) : (
          <div className="mt-5 text-center text-[11px] text-ih-fg-4">
            {gate.companyName}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MetaRow helper                                                     */
/* ------------------------------------------------------------------ */

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 items-baseline mt-1.5 first:mt-0">
      <span className="flex-none w-[80px] text-[11px] uppercase tracking-wide text-ih-fg-4">
        {label}
      </span>
      <span className="text-ih-fg-1">{children}</span>
    </div>
  );
}
