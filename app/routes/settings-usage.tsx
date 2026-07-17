import { Link, useLoaderData } from "react-router";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-usage";
import { createApi } from "~/lib/api-client.server";
import { useSessionContext } from "~/hooks/useSessionContext";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { formatNumber } from "~/lib/format";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.settings_usage_meta_title() }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Free-tier caps mirror server/features/plan-quota/policy.ts (FREE_TIER_CAPS).
 *  Null for every non-free tenant and for standalone deploys — the UI hides
 *  progress bars and falls back to a plain cumulative count. */
interface UsageCaps {
  inspections: number;
  sms: number;
  email: number;
}

interface UsageSummary {
  tier?: string;
  caps?: UsageCaps | null;
  usage?: {
    inspections?: number;
    sms?: number;
    email?: number;
    smsByo?: number;
    emailByo?: number;
    seatsUsed?: number;
    seatsMax?: number | null;
    r2Bytes?: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const res = await api.usage.summary.$get();
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  return { usage: (body.data ?? {}) as UsageSummary };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsUsagePage() {
  const data = useLoaderData<typeof loader>();
  const session = useSessionContext();
  if ("forbidden" in data) return <AccessDenied />;
  const { usage } = data;
  const isSaas = session?.branding?.isSaas ?? false;
  // Viewer display locale (matches useDisplayLocale): user override, else tenant
  // default, else en-US. Derived from the session already in scope rather than
  // the useDisplayLocale hook so counts stay locale-aware without a second hook.
  const locale = session?.user.locale || session?.branding.defaultLocale || "en-US";
  const caps = usage.caps ?? null;
  const u = usage.usage ?? {};

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_settings(), href: "/settings" }, { label: m.settings_usage_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {caps
          ? m.settings_usage_subtitle_free()
          : isSaas
            ? m.settings_usage_subtitle_saas()
            : m.settings_usage_subtitle_standalone()}
      </p>

      {/* Metric cards — inspections (SaaS only) + SMS, email, storage.
          `inspections` is only ever written by the SaaS free-tier consume path
          (see PlanQuotaGuard.consumeInspection) — a standalone deploy never
          populates it, so the meter would otherwise show a permanently-0 card.
          `caps` alone can't distinguish standalone from a paid SaaS tenant
          (both are null), so gate on `isSaas` from session context instead;
          paid SaaS tenants still see the lifetime-analytics count. */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isSaas ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {isSaas && (caps ? (
          <CappedMetricCard label={m.settings_usage_metric_inspections()} used={u.inspections ?? 0} cap={caps.inspections} locale={locale} />
        ) : (
          <MetricCard
            label={m.settings_usage_metric_inspections()}
            value={formatNumber(u.inspections ?? 0, { locale })}
            sub={m.settings_usage_metric_inspections_sub()}
          />
        ))}
        {caps ? (
          <CappedMetricCard label={m.settings_usage_metric_sms()} used={u.sms ?? 0} cap={caps.sms} byo={u.smsByo ?? 0} locale={locale} />
        ) : (
          <MetricCard
            label={m.settings_usage_metric_sms()}
            value={formatNumber(u.sms ?? 0, { locale })}
            sub={m.settings_usage_metric_sms_sub()}
          />
        )}
        {caps ? (
          <CappedMetricCard label={m.settings_usage_metric_email()} used={u.email ?? 0} cap={caps.email} byo={u.emailByo ?? 0} locale={locale} />
        ) : (
          <MetricCard
            label={m.settings_usage_metric_email()}
            value={formatNumber(u.email ?? 0, { locale })}
            sub={m.settings_usage_metric_email_sub()}
          />
        )}
        <MetricCard
          label={m.settings_usage_metric_storage()}
          value={fmtBytes(u.r2Bytes ?? 0)}
          sub={m.settings_usage_metric_storage_sub()}
        />
      </div>

      {/* Back to billing (SaaS only — billing exists) */}
      {isSaas && (
        <Link
          to="/settings/billing"
          className="inline-flex items-center text-ih-primary text-[13px] font-medium hover:underline"
        >
          {m.settings_usage_back_to_billing()}
        </Link>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Metric card                                                        */
/* ------------------------------------------------------------------ */

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg p-5">
      <div className="text-[12px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{label}</div>
      <div className="text-[28px] font-bold text-ih-fg-1 mt-1 tabular-nums">{value}</div>
      <div className="text-[12px] text-ih-fg-3 mt-1">{sub}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Capped metric card (free tier) — used/cap progress, red at 100%,   */
/*  plus an uncapped BYO line for sms/email when `byo` is passed.      */
/* ------------------------------------------------------------------ */

function CappedMetricCard({
  label,
  used,
  cap,
  byo,
  locale,
}: {
  label: string;
  used: number;
  cap: number;
  /** Bring-your-own volume for this metric (sms_byo/email_byo) — uncapped,
   *  metered separately, does not count against the free-plan limit. */
  byo?: number;
  /** Viewer display locale for number grouping (threaded from the page). */
  locale: string;
}) {
  const atCap = used >= cap;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

  return (
    <div className="bg-ih-bg-card border border-ih-border rounded-lg p-5">
      <div className="text-[12px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">{label}</div>
      <div className="text-[28px] font-bold text-ih-fg-1 mt-1 tabular-nums">
        {formatNumber(used, { locale })}
        <span className="text-[14px] font-medium text-ih-fg-4"> / {formatNumber(cap, { locale })}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-ih-bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${atCap ? "bg-ih-bad" : "bg-ih-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`text-[12px] mt-1 ${atCap ? "text-ih-bad-fg font-semibold" : "text-ih-fg-3"}`}>
        {atCap ? m.settings_usage_cap_reached() : m.settings_usage_cap_remaining({ count: cap - used })}
      </div>
      {byo !== undefined && (
        <div className="text-[11px] text-ih-fg-4 mt-1">{m.settings_usage_byo({ count: formatNumber(byo, { locale }) })}</div>
      )}
    </div>
  );
}
