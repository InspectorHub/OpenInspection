/**
 * Design System 0520 subsystem C P9 T9.2 — billing page.
 *
 * The view branches on the deployment profile (resolved server-side and
 * passed in as props) — three distinct surfaces correspond to the three
 * supported deployment modes:
 *
 *   1. STANDALONE (self-hosted OSS) — `hasBilling: false`
 *      No charges, no Stripe, no seat math. Page shows a
 *      "self-hosted · unlimited" banner + a pointer back to the OSS
 *      repo. Seat counts still render (informational) but framed as
 *      capacity, not as billing.
 *
 *   2. SAAS · SILO (per-tenant dedicated worker) — `hasBilling: true`
 *      but `hasSeatQuota: false`. Tenant has a Stripe subscription
 *      (typically a flat tier price) but seats inside the silo are
 *      unlimited. Page shows current plan + portal link but skips
 *      the per-seat cost estimate.
 *
 *   3. SAAS · SHARED (multi-tenant hosted) — both flags true.
 *      Full per-seat subscription: permanent inspectors at $29.99/mo
 *      + guest-days at $1.49/day. Page shows the cost-estimate panel,
 *      the seats-used / cap counter, and the portal link.
 *
 * The Stripe Customer Portal owns invoice history + payment-method
 * changes in modes 2 + 3; PCI compliance lives outside the worker.
 */
import { MainLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';
import type { SaasTopology } from '../../lib/deployment-profile';

interface Props {
    branding?:    BrandingConfig | undefined;
    /** True when a Stripe subscription is wired up (any SaaS topology). */
    hasBilling:   boolean;
    /** True only on saas-shared — where seats are sold individually. */
    hasSeatQuota: boolean;
    saasTopology: SaasTopology | null;
}

export const SettingsBillingPage = (
    props: Props,
): JSX.Element => {
    const { branding, hasBilling, hasSeatQuota, saasTopology } = props;
    return (
    <MainLayout title="Billing" {...(branding ? { branding } : {})}>
        <div
            x-data={`settingsBilling(${JSON.stringify({ hasBilling, hasSeatQuota, saasTopology })})`}
            {...{ 'x-init': 'init()' }}
            class="max-w-5xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6"
        >
            {/* ── Left column ──────────────────────────────────────── */}
            <div class="space-y-4">
                <header class="space-y-1">
                    <h1 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Billing</h1>
                    <p class="text-sm text-slate-500 dark:text-slate-400" x-text="headerSubtitle"></p>
                </header>

                {/* Mode 1 (standalone) — no billing, capacity card only */}
                {!hasBilling && (
                    <section class="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-md p-6">
                        <div class="flex items-start gap-3">
                            <span class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-emerald-500 text-white flex-shrink-0">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M4.5 12.75l6 6 9-13.5" /></svg>
                            </span>
                            <div class="flex-1">
                                <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Self-hosted · no subscription</h2>
                                <p class="text-sm text-slate-700 dark:text-slate-300 mt-1.5 leading-relaxed">
                                    This deployment runs in standalone mode — your own Cloudflare Workers, your own D1, your own data. No per-seat charge, no Stripe round-trip. Add as many inspectors, apprentices, and guests as you need.
                                </p>
                                <a
                                    href="https://github.com/InspectorHub/OpenInspection"
                                    target="_blank"
                                    rel="noopener"
                                    class="mt-3 inline-flex items-center gap-1 text-sm font-bold text-emerald-700 dark:text-emerald-300 hover:underline"
                                >
                                    OpenInspection on GitHub
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                </a>
                            </div>
                        </div>
                    </section>
                )}

                {/* Mode 2 + 3 — Stripe-backed plan card */}
                {hasBilling && (
                <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-6">
                    <div class="flex items-start justify-between gap-4 mb-5">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Current plan</div>
                            <div class="text-2xl font-bold capitalize text-slate-900 dark:text-slate-100 mt-1" x-text="tier"></div>
                            {saasTopology === 'silo' && (
                                <div class="mt-1 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-indigo-700 dark:text-indigo-300">
                                    <span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                                    Silo deployment · unlimited seats
                                </div>
                            )}
                        </div>
                        <a
                            x-show="portalUrl"
                            x-cloak
                            {...{ ':href': 'portalUrl' }}
                            target="_blank"
                            rel="noopener"
                            class="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors"
                        >
                            Open Stripe portal
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                        </a>
                    </div>

                    {/* Seat breakdown */}
                    <div class="grid grid-cols-3 gap-4 pt-5 border-t border-slate-100 dark:border-slate-700">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500" x-text="hasSeatQuota ? 'Seats used' : 'Active members'"></div>
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                                <span x-text="seatsUsed"></span>
                                <template x-if="hasSeatQuota">
                                    <span class="text-slate-400 dark:text-slate-500 text-base font-normal"> / <span class="text-slate-500 dark:text-slate-400 text-lg" x-text="maxUsers"></span></span>
                                </template>
                            </div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Permanent</div>
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums" x-text="permanent"></div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Active guests</div>
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums" x-text="guests"></div>
                        </div>
                    </div>

                    <div x-show="loading" aria-busy="true" class="mt-4 space-y-2">
                        <span class="sr-only">Loading billing summary…</span>
                        <div class="ih-skeleton ih-skeleton--text" style="width: 50%;"></div>
                        <div class="ih-skeleton ih-skeleton--text" style="width: 70%;"></div>
                    </div>
                    <p x-show="error" x-text="error" class="mt-4 text-sm text-rose-600 dark:text-rose-400"></p>
                </section>
                )}

                {/* Standalone capacity card (informational only) */}
                {!hasBilling && (
                <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-6">
                    <header class="mb-4">
                        <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Workspace capacity</h2>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">No quotas in standalone mode — these are informational.</p>
                    </header>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Active members</div>
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums" x-text="seatsUsed"></div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Permanent</div>
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums" x-text="permanent"></div>
                        </div>
                        <div>
                            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Active guests</div>
                            <div class="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums" x-text="guests"></div>
                        </div>
                    </div>
                    <div x-show="loading" aria-busy="true" class="mt-4">
                        <div class="ih-skeleton ih-skeleton--text" style="width: 40%;"></div>
                    </div>
                </section>
                )}

                {/* Cost estimate — SaaS-shared only (silo and standalone skip).
                    silo charges a flat tier price billed by Stripe; standalone
                    charges nothing. */}
                {hasBilling && hasSeatQuota && (
                <section x-show="!loading && tier !== 'free'" x-cloak class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-6">
                    <header class="mb-4">
                        <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Estimated monthly cost</h2>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Stripe issues the canonical invoice — these figures are an estimate based on the per-seat rate.
                        </p>
                    </header>
                    <dl class="divide-y divide-slate-100 dark:divide-slate-700">
                        <div class="py-2 flex items-center justify-between text-sm">
                            <dt class="text-slate-600 dark:text-slate-300"><span x-text="permanent"></span> permanent inspector seat<span x-show="permanent !== 1">s</span> · $29.99 each</dt>
                            <dd class="font-mono font-semibold text-slate-900 dark:text-slate-100" x-text="fmtMoney(permanent * 29.99)"></dd>
                        </div>
                        <div x-show="guests > 0" class="py-2 flex items-center justify-between text-sm">
                            <dt class="text-slate-600 dark:text-slate-300"><span x-text="guests"></span> active guest<span x-show="guests !== 1">s</span> · $1.49 / day each</dt>
                            <dd class="font-mono font-semibold text-slate-900 dark:text-slate-100">— billed on use</dd>
                        </div>
                        <div class="py-3 flex items-center justify-between">
                            <dt class="text-sm font-bold text-slate-900 dark:text-slate-100">Approximate seat charges this month</dt>
                            <dd class="font-mono font-bold text-lg text-slate-900 dark:text-slate-100" x-text="fmtMoney(permanent * 29.99)"></dd>
                        </div>
                    </dl>
                </section>
                )}

                {/* Invoices pointer — only on Stripe-backed deployments */}
                {hasBilling && (
                <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-6">
                    <header class="mb-3">
                        <h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Invoices &amp; payment method</h2>
                    </header>
                    <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                        Invoice history, card-on-file updates, and {hasSeatQuota ? 'seat-cycle changes' : 'plan tier changes'} happen in the Stripe-hosted billing portal so PCI compliance lives outside OpenInspection.
                    </p>
                    <a
                        x-show="portalUrl"
                        x-cloak
                        {...{ ':href': 'portalUrl' }}
                        target="_blank"
                        rel="noopener"
                        class="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                        Manage in Stripe portal
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </a>
                    <p x-show="!portalUrl && !loading" x-cloak class="mt-4 text-xs text-slate-500 dark:text-slate-400 italic">
                        Billing portal is not configured on this deployment.
                    </p>
                </section>
                )}
            </div>

            {/* ── Right rail ───────────────────────────────────────── */}
            <aside class="space-y-4">
                {/* Saas-shared: the "thinking of self-hosting?" pitch.
                    Standalone + silo already self-host so this card stays
                    out of their way. */}
                {hasBilling && hasSeatQuota && (
                <section class="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md p-5">
                    <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-700 dark:text-indigo-300">Want to self-host?</div>
                    <p class="text-xs text-slate-700 dark:text-slate-300 mt-2 leading-relaxed">
                        Every collaboration feature — multi-inspector, presence, conflict resolution, apprentice review — is free on the open-source build. The per-seat subscription only exists on the hosted shared plan.
                    </p>
                    <a
                        href="https://github.com/InspectorHub/OpenInspection"
                        target="_blank"
                        rel="noopener"
                        class="mt-3 inline-flex items-center gap-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:underline"
                    >
                        Self-host docs
                        <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </a>
                </section>
                )}

                {/* Standalone: where to upgrade to hosted if they ever want
                    seat-quota / billing surface. */}
                {!hasBilling && (
                <section class="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md p-5">
                    <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-700 dark:text-indigo-300">Need hosted instead?</div>
                    <p class="text-xs text-slate-700 dark:text-slate-300 mt-2 leading-relaxed">
                        InspectorHub.io offers the same OpenInspection codebase as a managed service — no Cloudflare account, no D1 quota worries. Per-seat pricing kicks in there.
                    </p>
                    <a
                        href="https://inspectorhub.io/"
                        target="_blank"
                        rel="noopener"
                        class="mt-3 inline-flex items-center gap-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:underline"
                    >
                        Try the hosted version
                        <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </a>
                </section>
                )}

                {/* Silo: explain why they get unlimited seats even though
                    they see Stripe. */}
                {hasBilling && !hasSeatQuota && (
                <section class="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md p-5">
                    <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-700 dark:text-indigo-300">Silo deployment</div>
                    <p class="text-xs text-slate-700 dark:text-slate-300 mt-2 leading-relaxed">
                        Your workspace runs on its own isolated worker + D1 — Stripe handles the flat-tier subscription, but seats inside the silo aren't metered. Add as many inspectors as you need.
                    </p>
                </section>
                )}

                <section class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md p-5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    <div class="font-bold text-slate-900 dark:text-slate-100 mb-1.5 text-[13px]">Add a seat</div>
                    Add a permanent inspector or generate a guest invite link in <a href="/settings/team" class="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">Team settings</a>.
                </section>
            </aside>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/settings-billing.js"></script>
    </MainLayout>
    );
};
