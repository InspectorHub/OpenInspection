import { Link, useLoaderData } from "react-router";
import { Icon } from "@core/shared-ui";
import { SettingsCrumb } from "~/components/SettingsCrumb";
import type { Route } from "./+types/settings-billing";
import { createApi } from "~/lib/api-client.server";
import { requireAdminLoader } from "~/lib/access.server";
import { AccessDenied } from "~/components/AccessDenied";
import { m } from "~/paraglide/messages";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BillingSummary {
  hasBilling?: boolean;
  hasSeatQuota?: boolean;
  tier?: string | null;
  portalUrl?: string | null;
  seatsUsed?: number;
  maxUsers?: number | null;
  permanent?: number;
}

/* ------------------------------------------------------------------ */
/*  Loader                                                             */
/* ------------------------------------------------------------------ */

export async function loader({ request, context }: Route.LoaderArgs) {
  const { forbidden, token } = await requireAdminLoader(context, request);
  if (forbidden) return { forbidden: true as const };
  const api = createApi(context, { token });
  const res = await api.billing.summary.$get();
  const body = res.ok ? ((await res.json()) as Record<string, unknown>) : {};
  return { billing: (body.data ?? {}) as BillingSummary };
}

/* ------------------------------------------------------------------ */
/*  No action -- billing changes go through Stripe portal              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsBillingPage() {
  const data = useLoaderData<typeof loader>();
  if ("forbidden" in data) return <AccessDenied />;
  const { billing } = data;
  const {
    hasBilling = false,
    hasSeatQuota = false,
    tier = "free",
    portalUrl,
    seatsUsed = 0,
    maxUsers,
    permanent = 0,
  } = billing;

  return (
    <div className="space-y-ih-list">
      <SettingsCrumb items={[{ label: m.settings_crumb_root(), href: "/settings" }, { label: m.settings_billing_crumb() }]} />
      <p className="text-[13px] text-ih-fg-3">
        {hasBilling
          ? m.settings_billing_intro_hosted()
          : m.settings_billing_intro_selfhost()}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Left column */}
        <div className="space-y-4">
          {/* Standalone banner */}
          {!hasBilling && (
            <section className="bg-ih-ok-bg border border-ih-ok-fg/20 rounded-md p-6">
              <div className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-ih-ok text-white flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                </span>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-ih-fg-1">{m.settings_billing_selfhost_heading()}</h3>
                  <p className="text-[13px] text-ih-fg-2 mt-1.5 leading-relaxed">
                    {m.settings_billing_selfhost_desc()}
                  </p>
                  <a href="https://github.com/InspectorHub/OpenInspection" target="_blank" rel="noopener"
                    className="mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-ih-ok-fg hover:underline">
                    {m.settings_billing_github_link()}
                    <ArrowIcon />
                  </a>
                </div>
              </div>
            </section>
          )}

          {/* Plan card (Stripe-backed) */}
          {hasBilling && (
            <section className="bg-ih-bg-card border border-ih-border rounded-md p-6">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4">{m.settings_billing_current_plan()}</div>
                  <div className="text-2xl font-bold capitalize text-ih-fg-1 mt-1">{tier}</div>
                </div>
                {portalUrl && (
                  <a href={portalUrl} target="_blank" rel="noopener"
                    className="px-4 py-2 rounded-md bg-ih-primary hover:bg-ih-primary-600 text-white text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors">
                    {m.settings_billing_open_portal()}
                    <ArrowIcon />
                  </a>
                )}
              </div>

              {/* Seat breakdown */}
              <div className="grid grid-cols-2 gap-4 pt-5 border-t border-ih-border">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">
                    {hasSeatQuota ? m.settings_billing_seats_used() : m.settings_billing_active_members()}
                  </div>
                  <div className="text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums">
                    {seatsUsed}
                    {hasSeatQuota && maxUsers != null && (
                      <span className="text-ih-fg-4 text-base font-normal"> / <span className="text-ih-fg-3 text-lg">{maxUsers}</span></span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">{m.settings_billing_permanent()}</div>
                  <div className="text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums">{permanent}</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-ih-border">
                <Link to="/settings/usage" className="inline-flex items-center gap-1 text-ih-primary text-[13px] font-medium hover:underline">
                  {m.settings_billing_view_usage()} <Icon name="arrowR" size={13} />
                </Link>
              </div>
            </section>
          )}

          {/* Standalone capacity */}
          {!hasBilling && (
            <section className="bg-ih-bg-card border border-ih-border rounded-md p-6">
              <header className="mb-4">
                <h3 className="text-lg font-bold text-ih-fg-1">{m.settings_billing_capacity_heading()}</h3>
                <p className="text-[11px] text-ih-fg-3 mt-0.5">{m.settings_billing_capacity_desc()}</p>
              </header>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">{m.settings_billing_active_members()}</div>
                  <div className="text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums">{seatsUsed}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4">{m.settings_billing_permanent()}</div>
                  <div className="text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums">{permanent}</div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-ih-border">
                <Link to="/settings/usage" className="inline-flex items-center gap-1 text-ih-primary text-[13px] font-medium hover:underline">
                  {m.settings_billing_view_usage()} <Icon name="arrowR" size={13} />
                </Link>
              </div>
            </section>
          )}

          {/* Cost estimate (SaaS shared only) */}
          {hasBilling && hasSeatQuota && tier !== "free" && (
            <section className="bg-ih-bg-card border border-ih-border rounded-md p-6">
              <header className="mb-4">
                <h3 className="text-lg font-bold text-ih-fg-1">{m.settings_billing_cost_heading()}</h3>
                <p className="text-[11px] text-ih-fg-3 mt-0.5">
                  {m.settings_billing_cost_desc()}
                </p>
              </header>
              <dl className="divide-y divide-ih-border">
                <div className="py-2 flex items-center justify-between text-[13px]">
                  <dt className="text-ih-fg-3">{m.settings_billing_seat_line({ count: permanent, plural: permanent !== 1 ? "s" : "" })}</dt>
                  <dd className="font-mono font-semibold text-ih-fg-1">{fmtMoney(permanent * 29.99)}</dd>
                </div>

                <div className="py-3 flex items-center justify-between">
                  <dt className="text-[13px] font-bold text-ih-fg-1">{m.settings_billing_seat_charges()}</dt>
                  <dd className="font-mono font-bold text-lg text-ih-fg-1">{fmtMoney(permanent * 29.99)}</dd>
                </div>
              </dl>
            </section>
          )}

          {/* Invoices pointer */}
          {hasBilling && (
            <section className="bg-ih-bg-card border border-ih-border rounded-md p-6">
              <header className="mb-3">
                <h3 className="text-lg font-bold text-ih-fg-1">{m.settings_billing_invoices_heading()}</h3>
              </header>
              <p className="text-[13px] text-ih-fg-3 leading-relaxed">
                {m.settings_billing_invoices_desc({ kind: hasSeatQuota ? m.settings_billing_seat_cycle() : m.settings_billing_plan_tier() })}
              </p>
              {portalUrl ? (
                <a href={portalUrl} target="_blank" rel="noopener"
                  className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-ih-primary hover:underline">
                  {m.settings_billing_manage_portal()}
                  <ArrowIcon />
                </a>
              ) : (
                <p className="mt-4 text-[11px] text-ih-fg-3 italic">
                  {m.settings_billing_no_portal()}
                </p>
              )}
            </section>
          )}
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          {!hasBilling && (
            <section className="bg-ih-primary-tint border border-ih-primary rounded-md p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary">{m.settings_billing_need_hosted()}</div>
              <p className="text-[12px] text-ih-fg-2 mt-2 leading-relaxed">
                {m.settings_billing_hosted_pitch()}
              </p>
              <a href="https://inspectorhub.io/" target="_blank" rel="noopener"
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-ih-primary hover:underline">
                {m.settings_billing_try_hosted()} <ArrowIcon />
              </a>
            </section>
          )}
          {hasBilling && hasSeatQuota && (
            <section className="bg-ih-primary-tint border border-ih-primary rounded-md p-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary">{m.settings_billing_want_selfhost()}</div>
              <p className="text-[12px] text-ih-fg-2 mt-2 leading-relaxed">
                {m.settings_billing_selfhost_pitch()}
              </p>
              <a href="https://github.com/InspectorHub/OpenInspection" target="_blank" rel="noopener"
                className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-ih-primary hover:underline">
                {m.settings_billing_selfhost_docs()} <ArrowIcon />
              </a>
            </section>
          )}
          <section className="bg-ih-bg-card border border-ih-border rounded-md p-5 text-[12px] text-ih-fg-3 leading-relaxed">
            <div className="font-bold text-ih-fg-1 mb-1.5 text-[13px]">{m.settings_billing_add_seat_heading()}</div>
            {m.settings_billing_add_seat_before()}{" "}
            <Link to="/settings/team" className="font-semibold text-ih-primary hover:underline">{m.settings_billing_team_link()}</Link>.
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function ArrowIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}
