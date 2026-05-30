import { useLoaderData } from "react-router";
import type { Route } from "./+types/report-gate";
import { createApi } from "~/lib/api-client.server";

export function meta() {
  return [{ title: "Report access - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GateData {
  reason: "payment" | "agreement";
  companyName: string;
  primaryColor: string;
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
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ params, request, context }: Route.LoaderArgs) {
  try {
    const api = createApi(context);
    const res = await api.publicShare["report-gate"][":tenant"][":id"].$get({
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

function formatDate(scheduledDate: string | null | undefined): string | null {
  if (!scheduledDate) return null;
  try {
    return new Date(scheduledDate).toLocaleDateString("en-US", {
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
): string | null {
  if (typeof amountCents !== "number" || amountCents <= 0) return null;
  return new Intl.NumberFormat("en-US", {
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
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="text-ih-fg-3">Report not found.</p>
      </div>
    );
  }

  const title =
    gate.reason === "payment" ? "Pending payment" : "Pending agreement signature";
  const message =
    gate.reason === "payment"
      ? "Your inspection report is ready, but the invoice has not been paid yet. Please complete payment to view the report -- your inspector's contact details are listed below."
      : "Your inspection report is ready, but the inspection agreement has not been signed yet. Please sign the agreement to view the report.";

  const formattedDate = formatDate(gate.scheduledDate);
  const formattedAmount = formatAmount(gate.amountCents, gate.currency);
  const ctaLabel =
    gate.reason === "payment" && formattedAmount
      ? `Pay ${formattedAmount} now`
      : gate.actionLabel;
  const hasContact = !!(gate.inspectorEmail || gate.inspectorPhone || gate.inspectorLicense);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-ih-bg-app">
      <div className="max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-8 shadow-sm">
        {/* Pill */}
        <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-semibold tracking-wide bg-ih-watch-bg text-ih-watch-fg mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-ih-watch-bg0 animate-pulse" />
          {title}
        </span>

        <h1 className="font-serif text-[26px] font-semibold tracking-tight leading-tight mb-2 text-ih-fg-1">
          Your report is almost ready.
        </h1>
        <p className="text-sm text-ih-fg-3 leading-relaxed mb-6">
          {message}
        </p>

        {/* Meta card */}
        {(formattedAmount || gate.propertyAddress || gate.inspectorName || formattedDate || hasContact) && (
          <div className="bg-slate-50 dark:bg-slate-700/50 border border-ih-border rounded-lg p-4 mb-6 text-[13px] text-ih-fg-3">
            {formattedAmount && (
              <div className="flex justify-between items-baseline pb-3 mb-3 border-b border-ih-border">
                <span className="text-[11px] uppercase tracking-wide text-ih-fg-4">
                  Amount due
                </span>
                <span className="font-serif text-[22px] font-semibold text-ih-fg-1 tracking-tight">
                  {formattedAmount}
                </span>
              </div>
            )}
            {gate.propertyAddress && (
              <MetaRow label="Property">
                <strong className="text-ih-fg-1 font-semibold">
                  {gate.propertyAddress}
                </strong>
              </MetaRow>
            )}
            {formattedDate && <MetaRow label="Scheduled">{formattedDate}</MetaRow>}
            {gate.inspectorName && <MetaRow label="Inspector">{gate.inspectorName}</MetaRow>}
            {hasContact && (gate.propertyAddress || gate.inspectorName || formattedDate) && (
              <div className="h-px bg-ih-bg-muted my-3" />
            )}
            {gate.inspectorEmail && (
              <MetaRow label="Email">
                <a
                  href={`mailto:${gate.inspectorEmail}`}
                  className="text-ih-primary hover:underline"
                >
                  {gate.inspectorEmail}
                </a>
              </MetaRow>
            )}
            {gate.inspectorPhone && (
              <MetaRow label="Phone">
                <a
                  href={`tel:${gate.inspectorPhone}`}
                  className="text-ih-primary hover:underline"
                >
                  {gate.inspectorPhone}
                </a>
              </MetaRow>
            )}
            {gate.inspectorLicense && (
              <MetaRow label="License">{gate.inspectorLicense}</MetaRow>
            )}
          </div>
        )}

        {/* CTA */}
        <a
          href={gate.actionUrl}
          className="inline-flex items-center justify-center h-11 px-6 rounded-lg text-sm font-bold text-white hover:opacity-95 hover:-translate-y-px transition-all shadow-sm"
          style={{ backgroundColor: gate.primaryColor }}
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
            Secured by Stripe &middot; {gate.companyName}
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
