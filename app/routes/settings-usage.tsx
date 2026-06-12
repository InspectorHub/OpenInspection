import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/settings-usage";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { useSessionContext } from "~/hooks/useSessionContext";

export function meta() {
  return [{ title: "Usage - Settings - OpenInspection" }];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UsageSummary {
  tenantId?: string;
  sms?: number;
  email?: number;
  r2Bytes?: number;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = await requireToken(context, request);
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
  const { usage } = useLoaderData<typeof loader>();
  const session = useSessionContext();
  const isSaas = session?.branding?.isSaas ?? false;

  return (
    <div className="space-y-[18px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-ih-fg-3">
        <Link to="/settings" className="hover:text-ih-primary transition-colors">Settings</Link>
        <span>&rsaquo;</span>
        <span className="text-ih-fg-1">Usage</span>
      </div>

      <h2 className="text-[19px] font-bold text-ih-fg-1">Usage</h2>
      <p className="text-[13px] text-ih-fg-3">
        What this account has consumed. SMS and email are cumulative totals; storage is measured once a day.
      </p>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="SMS sent"
          value={(usage.sms ?? 0).toLocaleString()}
          sub="Text messages sent — cumulative"
        />
        <MetricCard
          label="Emails sent"
          value={(usage.email ?? 0).toLocaleString()}
          sub="Emails delivered — cumulative"
        />
        <MetricCard
          label="Storage used"
          value={fmtBytes(usage.r2Bytes ?? 0)}
          sub="Photos & documents — measured daily"
        />
      </div>

      {/* Back to billing (SaaS only — billing exists) */}
      {isSaas && (
        <Link
          to="/settings/billing"
          className="inline-flex items-center text-ih-primary text-[13px] font-medium hover:underline"
        >
          ← Back to billing &amp; plan
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
