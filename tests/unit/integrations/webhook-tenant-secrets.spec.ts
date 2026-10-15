/**
 * Webhook verifier secrets saved in Settings -> Integrations must be honoured.
 *
 * The Stripe signing secret and the QuickBooks verifier token can be stored
 * encrypted per company instead of as Worker env vars. The merge into the
 * request env used to run only for `/api/` paths, while the inbound webhooks
 * live at `/webhooks/{vendor}`, so a secret saved in the UI was never seen and
 * every delivery was ignored (Stripe) or discarded (QuickBooks).
 *
 * Driven through the real app and middleware chain (see
 * helpers/tenant-email-harness.ts). The signature is computed here with node's
 * `crypto`, an implementation independent of the one under test.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TENANT_ID, TENANT_SLUG, type Harness, type HarnessMode } from '../helpers/tenant-email-harness';
import {
    OTHER_TENANT, OTHER_SLUG, REALM_A, REALM_B, storeSecrets, webhookHarness, seedOtherCompany, postStripe, logResults,
    event, stubQuickBooks, postQbo, qboHarness,
} from '../helpers/webhook-secrets-fixtures';


describe.each<HarnessMode>(['saas', 'standalone'])('Stripe webhook secret saved in Settings (%s)', (mode) => {
    let h: Harness;
    afterEach(() => h?.close());
    // saas names the company in the path; standalone also accepts the bare URL.
    const path = (m: HarnessMode) => (m === 'saas' ? `/webhooks/stripe/${TENANT_SLUG}` : '/webhooks/stripe');

    it('accepts a delivery signed with a secret that exists only in the stored secrets', { timeout: 60_000 }, async () => {
        h = await webhookHarness(mode);
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_stored', STRIPE_WEBHOOK_SECRET: 'whsec_stored' });
        const res = await postStripe(h, path(mode), 'whsec_stored');
        expect(res.status).toBe(200);
        expect(await logResults(h)).toEqual(['received']);
    });

    it('rejects a delivery signed with the wrong secret', { timeout: 60_000 }, async () => {
        h = await webhookHarness(mode);
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_stored', STRIPE_WEBHOOK_SECRET: 'whsec_stored' });
        const res = await postStripe(h, path(mode), 'whsec_wrong');
        expect(res.status).toBe(400);
        expect(await logResults(h)).toEqual(['signature_failed']);
    });

    it('ignores the delivery when no secret exists anywhere', { timeout: 60_000 }, async () => {
        h = await webhookHarness(mode);
        const res = await postStripe(h, path(mode), 'whsec_anything');
        expect(res.status).toBe(200);
        expect(await logResults(h)).toEqual([]);
    });

    it('the tenant-owned stored secret wins over a platform env secret', { timeout: 60_000 }, async () => {
        h = await webhookHarness(mode);
        (h.env as unknown as Record<string, string>).STRIPE_SECRET_KEY = 'sk_test_platform';
        (h.env as unknown as Record<string, string>).STRIPE_WEBHOOK_SECRET = 'whsec_platform';
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_stored', STRIPE_WEBHOOK_SECRET: 'whsec_stored' });
        expect((await postStripe(h, path(mode), 'whsec_platform')).status).toBe(400);
        expect(await logResults(h)).toEqual(['signature_failed']);
        expect((await postStripe(h, path(mode), 'whsec_stored')).status).toBe(200);
        expect((await logResults(h))[0]).toBe('received');
    });
});

describe('Stripe webhook secret of another company (saas)', () => {
    let h: Harness;
    afterEach(() => h?.close());

    it("a delivery signed with company B's secret does not verify at company A's URL", { timeout: 60_000 }, async () => {
        h = await webhookHarness('saas');
        await seedOtherCompany(h, REALM_B);
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_a' });
        await storeSecrets(h, OTHER_TENANT, { STRIPE_SECRET_KEY: 'sk_test_b', STRIPE_WEBHOOK_SECRET: 'whsec_b' });

        const crossed = await postStripe(h, `/webhooks/stripe/${TENANT_SLUG}`, 'whsec_b');
        expect(crossed.status).toBe(400);
        expect(await logResults(h)).toEqual(['signature_failed']);
        expect(await logResults(h, OTHER_TENANT)).toEqual([]);

        // Positive control: B's own URL accepts B's secret.
        const own = await postStripe(h, `/webhooks/stripe/${OTHER_SLUG}`, 'whsec_b');
        expect(own.status).toBe(200);
        expect(await logResults(h, OTHER_TENANT)).toEqual(['received']);
    });

    it('the bare URL names no company, so nothing is verified or logged', { timeout: 60_000 }, async () => {
        h = await webhookHarness('saas');
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_a' });
        const res = await postStripe(h, '/webhooks/stripe', 'whsec_a');
        expect(res.status).toBe(200);
        expect(await logResults(h)).toEqual([]);
    });
});

describe.each<HarnessMode>(['saas', 'standalone'])('QuickBooks verifier token saved in Settings (%s)', (mode) => {
    let h: Harness;
    afterEach(() => h?.close());

    it('processes a delivery signed with a token that exists only in the stored secrets', { timeout: 60_000 }, async () => {
        h = await qboHarness(mode);
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-stored' });
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147')], 'verifier-stored');
        expect(paths.filter((p) => p.endsWith('/invoice/147'))).toHaveLength(1);
    });

    it('discards a delivery signed with the wrong token', { timeout: 60_000 }, async () => {
        h = await qboHarness(mode);
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-stored' });
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147')], 'verifier-wrong');
        expect(paths).toEqual([]);
    });

    it('discards the delivery when no token exists anywhere', { timeout: 60_000 }, async () => {
        h = await qboHarness(mode);
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147')], 'verifier-anything');
        expect(paths).toEqual([]);
    });

    it('the env token wins over a stored one', { timeout: 60_000 }, async () => {
        h = await qboHarness(mode);
        (h.env as unknown as Record<string, string>).QBO_WEBHOOK_SECRET = 'verifier-env';
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-stored' });
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147')], 'verifier-stored');
        expect(paths).toEqual([]);
        await postQbo(h, [event(REALM_A, '148')], 'verifier-env');
        expect(paths.filter((p) => p.endsWith('/invoice/148'))).toHaveLength(1);
    });
});

describe('QuickBooks verifier token of another company (saas)', () => {
    let h: Harness;
    afterEach(() => h?.close());

    it("company B's token does not verify a delivery naming company A's realm", { timeout: 60_000 }, async () => {
        h = await qboHarness('saas');
        await seedOtherCompany(h, REALM_B);
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-a' });
        await storeSecrets(h, OTHER_TENANT, { QBO_WEBHOOK_SECRET: 'verifier-b' });
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147')], 'verifier-b');
        expect(paths).toEqual([]);
        // Positive control: A's own token does.
        await postQbo(h, [event(REALM_A, '147')], 'verifier-a');
        expect(paths.filter((p) => p.endsWith('/invoice/147'))).toHaveLength(1);
    });

    it("a delivery verified by A's token cannot act on B's realm", { timeout: 60_000 }, async () => {
        h = await qboHarness('saas');
        await seedOtherCompany(h, REALM_B);
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-a' });
        await storeSecrets(h, OTHER_TENANT, { QBO_WEBHOOK_SECRET: 'verifier-b' });
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147'), event(REALM_B, '999')], 'verifier-a');
        expect(paths.filter((p) => p.endsWith('/invoice/147'))).toHaveLength(1);
        expect(paths.filter((p) => p.endsWith('/invoice/999'))).toHaveLength(0);
    });
});
