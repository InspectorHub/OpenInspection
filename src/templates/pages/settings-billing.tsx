/**
 * Design System 0520 subsystem C P9 T9.2 — read-only billing page.
 *
 * Mounted on `GET /settings/billing` (htmlAuthGuard'd) — surfaces the
 * seat-quota breakdown from `/api/billing/summary` and a CTA to the
 * Stripe Customer Portal (when the portal is configured). Invoice
 * history is intentionally deferred to a follow-up PR: the portal
 * already exposes a hosted invoice list inside the Customer Portal.
 */
import { MainLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

export const SettingsBillingPage = (
    { branding }: { branding?: BrandingConfig | undefined } = {},
): JSX.Element => (
    <MainLayout title="Billing" {...(branding ? { branding } : {})}>
        <div x-data="settingsBilling()" {...{ 'x-init': 'init()' }} class="max-w-3xl mx-auto p-6">
            <h1 class="ih-h1 mb-4">Billing</h1>

            <div class="ih-card p-6 mb-4 bg-white rounded-md border border-slate-200 shadow-sm">
                <div class="flex items-center justify-between mb-4 gap-4">
                    <div>
                        <div class="ih-eyebrow">Current plan</div>
                        <div class="text-xl font-bold capitalize" x-text="tier" />
                    </div>
                    <a class="ih-btn ih-btn--primary"
                       x-show="portalUrl"
                       {...{ ':href': 'portalUrl' }}
                       target="_blank" rel="noopener">Open Stripe portal</a>
                </div>

                <div class="grid grid-cols-3 gap-4">
                    <div>
                        <div class="ih-eyebrow">Seats used</div>
                        <div class="text-2xl font-bold" x-text="`${seatsUsed} / ${maxUsers}`" />
                    </div>
                    <div>
                        <div class="ih-eyebrow">Permanent</div>
                        <div class="text-2xl font-bold" x-text="permanent" />
                    </div>
                    <div>
                        <div class="ih-eyebrow">Active guests</div>
                        <div class="text-2xl font-bold" x-text="guests" />
                    </div>
                </div>

                <span x-show="loading" aria-busy="true" class="inline-block ih-skeleton ih-skeleton--text" style="width: 4rem; height: 0.875rem; vertical-align: middle;"><span class="sr-only">Loading…</span></span>
                <p class="ih-meta text-rose-600 mt-4" x-show="error" x-text="error" />
            </div>

            <div class="ih-card p-6 bg-white rounded-md border border-slate-200 shadow-sm">
                <h2 class="ih-h2 mb-2">Manage subscription</h2>
                <p class="ih-meta mb-3">
                    Invoices, payment method updates, and seat adjustments are managed in the Stripe-hosted billing portal.
                </p>
                <p class="ih-meta" x-show="!portalUrl">
                    The billing portal is not configured for this deployment.
                </p>
            </div>
        </div>

        <script src="/js/auth.js"></script>
        <script src="/js/settings-billing.js"></script>
    </MainLayout>
);
