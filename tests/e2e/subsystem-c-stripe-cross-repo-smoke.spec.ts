/**
 * Design System 0520 subsystem C P11.3 — cross-repo Stripe webhook smoke.
 *
 * Documents the manual verification path for the portal → core seat-quota
 * sync.
 *
 * TODO(cross-repo-harness): BLOCKER — this needs a run environment nothing in
 * this repo provides, NOT a data fixture. Three things must be up at once:
 *   1. the PORTAL worker on 127.0.0.1:8787 (a different repo, apps/portal),
 *   2. this core worker on 127.0.0.1:8789 (playwright.config.ts webServer),
 *   3. `stripe listen --forward-to 127.0.0.1:8787/api/billing/webhook`,
 *      because the assertion chain depends on a REAL signed Stripe event
 *      reaching portal and portal then pushing the new quota into core.
 * Playwright's webServer starts one server, and globalSetup seeds one D1.
 *
 * The former note here — "skipped pending the multi-user seed harness in
 * tests/global-setup.ts" — is WRONG and has been since that harness landed:
 * SEED_E2E=1 + tests/seed-fixtures.ts exists and works, and subsystem-D/E now
 * run on it. Do not go looking for that gap; it was closed. What is missing is
 * the dual-server + Stripe-CLI orchestration above.
 *
 * Unit coverage of the underlying logic already lives across the two
 * repos:
 *   apps/portal/tests/unit/stripe-webhook.spec.ts   (6 tests)
 *   apps/core/tests/unit/billing-summary.spec.ts    (4 tests)
 */
import { test, expect } from '@playwright/test';

test.skip('Stripe checkout → webhook → core max_users syncs', async ({ request }) => {
    // 1) Portal POST /api/billing/checkout/seat — hosted-checkout URL.
    const r = await request.post('http://127.0.0.1:8787/api/billing/checkout/seat', {
        data: { billingCycle: 'monthly', seats: 3 },
        headers: { 'cookie': 'inspector_token=admin-seed-jwt' },
    });
    expect(r.ok()).toBe(true);
    const checkout = await r.json();
    expect(checkout?.data?.url).toContain('stripe.com');

    // 2) Simulate the lifecycle webhook (Stripe CLI `stripe trigger
    //    customer.subscription.created --add subscription:items[0][quantity]=3`
    //    forwards real signed events to /api/billing/webhook). For the
    //    test-mode smoke we POST a known fixture and rely on the
    //    NODE_ENV=test signature-skip in portal billing.ts.
    const wh = await request.post('http://127.0.0.1:8787/api/billing/webhook', {
        data: {
            type: 'customer.subscription.created',
            data: { object: { metadata: { tenantId: 'tenant-seed' }, items: { data: [{ quantity: 3 }] } } },
        },
        headers: { 'stripe-signature': 'test-mode-bypass' },
    });
    expect(wh.ok()).toBe(true);

    // 3) Core GET /api/billing/summary — assert maxUsers reflects the new quota.
    const r3 = await request.get('http://127.0.0.1:8789/api/billing/summary', {
        headers: { 'cookie': 'inspector_token=admin-seed-jwt' },
    });
    expect(r3.ok()).toBe(true);
    const summary = await r3.json();
    expect(summary?.data?.maxUsers).toBe(3);
});
