/**
 * Fail-closed edges of the webhook stored-secret resolution.
 *
 * Companion to webhook-tenant-secrets.spec.ts (same real-app harness). Each
 * block names the mutation that would turn it red.
 */
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { logger } from '../../../server/lib/logger';
import { StripeService } from '../../../server/services/stripe.service';
import { integrationSecretsMiddleware } from '../../../server/lib/middleware/integration-secrets';
import type { HonoConfig } from '../../../server/types/hono';
import { TENANT_ID, TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';
import {
    OTHER_TENANT, REALM_A, REALM_B, storeSecrets, webhookHarness, seedOtherCompany, connectQbo, postStripe, postQbo,
    logResults, event, stubQuickBooks, qboHarness,
} from '../helpers/webhook-secrets-fixtures';

const T = { timeout: 60_000 };
const hits = (paths: string[], id: string) => paths.filter((p) => p.endsWith(`/invoice/${id}`)).length;
const logWrites = (h: Harness) =>
    ((h.env.TENANT_CACHE as unknown as { put: Mock }).put.mock.calls as unknown[][])
        .filter((c) => String(c[0]).startsWith('stripe-webhook-log:'));

describe('QuickBooks: an empty or wrong key never verifies', () => {
    let h: Harness;
    afterEach(() => { vi.restoreAllMocks(); h?.close(); });

    // Mutation: drop the empty-secret guard in verifyWebhookSignature -> the empty
    // key reaches importKey (the spy sees a zero-length raw key).
    it('no token anywhere: an empty-key signature and a wrong-key signature are rejected, and no empty key is imported', T, async () => {
        h = await qboHarness('saas');
        const paths = stubQuickBooks();
        const importKey = vi.spyOn(crypto.subtle, 'importKey');
        await postQbo(h, [event(REALM_A, '147')], '');
        await postQbo(h, [event(REALM_A, '147')], 'verifier-wrong');
        expect(paths).toEqual([]);
        const empty = importKey.mock.calls.filter(([fmt, data]) =>
            fmt === 'raw' && (data as Uint8Array).byteLength === 0);
        expect(empty).toHaveLength(0);
    });

    it('control: with a stored token the correct signature is accepted', T, async () => {
        h = await qboHarness('saas');
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-a' });
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147')], '');
        await postQbo(h, [event(REALM_A, '147')], 'verifier-wrong');
        expect(paths).toEqual([]);
        await postQbo(h, [event(REALM_A, '147')], 'verifier-a');
        expect(hits(paths, '147')).toBe(1);
    });

    it('a non-JSON body and a non-base64 signature header fail closed', T, async () => {
        h = await qboHarness('saas');
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-a' });
        const paths = stubQuickBooks();
        expect((await postQbo(h, 'this is not json', 'verifier-a')).status).toBe(200);
        expect((await postQbo(h, [event(REALM_A, '147')], 'x', { sig: '!!!not-base64' })).status).toBe(200);
        expect(paths).toEqual([]);
        await postQbo(h, [event(REALM_A, '147')], 'verifier-a');
        expect(hits(paths, '147')).toBe(1);
    });

    // The schema itself refuses a second claim on a realm, so the ambiguous case the
    // webhook code guards against cannot be stored; this pins that the refusal is
    // still in force (if it were dropped, the lookup's skip-on-ambiguity is the net).
    it('the database refuses a second company claiming the same realm', T, async () => {
        h = await qboHarness('saas');
        await expect(seedOtherCompany(h, REALM_A)).rejects.toThrow(/UNIQUE|realm/i);
    });

    it('only the first 20 distinct claimed realms are looked up', T, async () => {
        h = await qboHarness('saas');
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'verifier-a' });
        const paths = stubQuickBooks();
        const fillers = (n: number) => Array.from({ length: n }, (_, i) => event(`99900000000000${String(i).padStart(2, '0')}`, `f${i}`));
        await postQbo(h, [...fillers(20), event(REALM_A, '147')], 'verifier-a');
        expect(hits(paths, '147')).toBe(0);
        await postQbo(h, [event(REALM_A, '147'), ...fillers(19)], 'verifier-a');
        expect(hits(paths, '147')).toBe(1);
    });

    it('at most 5 candidate companies are tried, and the truncation is logged', T, async () => {
        h = await qboHarness('saas');
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'tok-a' });
        const realms = [REALM_A];
        for (let n = 0; n < 5; n++) {
            const id = `11111111-0000-4000-8000-00000000010${n}`;
            const realm = `91303500000100${n}${n}`;
            realms.push(realm);
            await h.db.insert(schema.tenants).values({
                id, slug: `co-${n}`, status: 'active', tier: 'free', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
            });
            await h.db.insert(schema.tenantConfigs).values({ tenantId: id, companyName: `Co ${n}`, updatedAt: new Date() });
            await connectQbo(h, id, realm);
            await storeSecrets(h, id, { QBO_WEBHOOK_SECRET: `tok-${n}` });
        }
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const paths = stubQuickBooks();
        const events = realms.map((r, i) => event(r, `inv${i}`));
        await postQbo(h, events, 'tok-4'); // sixth company: beyond the cap
        expect(paths).toEqual([]);
        expect(warn.mock.calls.some((c) => String(c[0]).startsWith('QBO webhook: more candidate companies'))).toBe(true);
        await postQbo(h, events, 'tok-a'); // first company: control
        expect(hits(paths, 'inv0')).toBe(1);
        expect(hits(paths, 'inv5')).toBe(0);
    });

    it('two companies sharing one token: the first is served, the other realm is not acted on, and it is logged', T, async () => {
        h = await qboHarness('saas');
        await seedOtherCompany(h, REALM_B);
        await storeSecrets(h, TENANT_ID, { QBO_WEBHOOK_SECRET: 'shared' });
        await storeSecrets(h, OTHER_TENANT, { QBO_WEBHOOK_SECRET: 'shared' });
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const paths = stubQuickBooks();
        await postQbo(h, [event(REALM_A, '147'), event(REALM_B, '999')], 'shared');
        expect(warn.mock.calls.some((c) => String(c[0]).startsWith('QBO webhook: more than one company token'))).toBe(true);
        expect(hits(paths, '147') + hits(paths, '999')).toBe(1);
    });
});

describe('webhook requests see only the webhook keys of the stored secrets', () => {
    let h: Harness;
    afterEach(() => h?.close());

    // Mutation: pass no key filter for /webhooks/ -> the Resend key shows up there.
    it('a stored mail key is merged on /api/ but not on /webhooks/', T, async () => {
        h = await webhookHarness('saas');
        delete (h.env as unknown as Record<string, unknown>).RESEND_API_KEY;
        await storeSecrets(h, TENANT_ID, { RESEND_API_KEY: 're_stored', STRIPE_WEBHOOK_SECRET: 'whsec_stored' });
        const probe = new Hono<HonoConfig>()
            .use('*', async (c, next) => { c.set('tenantId', TENANT_ID); await next(); })
            .use('*', integrationSecretsMiddleware)
            .get('/*', (c) => c.json({ mail: c.env.RESEND_API_KEY ?? null, whsec: c.env.STRIPE_WEBHOOK_SECRET ?? null }));
        const api = await (await probe.request('/api/probe', {}, h.env)).json();
        const hook = await (await probe.request('/webhooks/probe', {}, h.env)).json();
        expect(api).toEqual({ mail: 're_stored', whsec: 'whsec_stored' });
        expect(hook).toEqual({ mail: null, whsec: 'whsec_stored' });
    });
});

describe('Stripe: nothing is verified or written when no company is established', () => {
    let h: Harness;
    afterEach(() => { vi.restoreAllMocks(); h?.close(); });

    // Mutation: resolve the bare saas URL to a company (or run with an empty secret)
    // -> verifyWebhook is called and a diagnostics row is written.
    it('bare saas URL with stored secrets on two companies: no verification, no log write for anyone', T, async () => {
        h = await webhookHarness('saas');
        await seedOtherCompany(h, REALM_B);
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_a' });
        await storeSecrets(h, OTHER_TENANT, { STRIPE_SECRET_KEY: 'sk_test_b', STRIPE_WEBHOOK_SECRET: 'whsec_b' });
        const verify = vi.spyOn(StripeService.prototype, 'verifyWebhook');
        for (const s of ['whsec_a', 'whsec_b']) expect((await postStripe(h, '/webhooks/stripe', s)).status).toBe(200);
        expect(verify).not.toHaveBeenCalled();
        expect(logWrites(h)).toEqual([]);
    });

    it('control: the slug URL does verify and write', T, async () => {
        h = await webhookHarness('saas');
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_a' });
        const verify = vi.spyOn(StripeService.prototype, 'verifyWebhook');
        await postStripe(h, `/webhooks/stripe/${TENANT_SLUG}`, 'whsec_a');
        expect(verify).toHaveBeenCalledTimes(1);
        expect(logWrites(h).length).toBeGreaterThan(0);
    });

    it.each(['saas', 'standalone'] as const)('no secret anywhere (%s): verification is never attempted', T, async (mode) => {
        h = await webhookHarness(mode);
        const verify = vi.spyOn(StripeService.prototype, 'verifyWebhook');
        await postStripe(h, mode === 'saas' ? `/webhooks/stripe/${TENANT_SLUG}` : '/webhooks/stripe', 'whsec_anything');
        expect(verify).not.toHaveBeenCalled();
        expect(logWrites(h)).toEqual([]);
    });
});

describe('Stripe: a verified payment naming another company is discarded', () => {
    let h: Harness;
    afterEach(() => h?.close());
    const INSPECTION = '44444444-0000-4000-8000-000000000001';
    const INVOICE = '44444444-0000-4000-8000-000000000002';

    const intent = (tenantId: string) => JSON.stringify({
        id: 'evt_pi', object: 'event', type: 'payment_intent.succeeded', api_version: '2024-06-20',
        created: 1_700_000_000, livemode: false,
        data: { object: { id: 'pi_1', object: 'payment_intent', amount: 1000, amount_received: 1000,
            metadata: { tenantId, kind: 'invoice', invoiceId: INVOICE, inspectionId: INSPECTION } } },
    });
    const invoiceRow = () => h.db.select().from(schema.invoices).where(eq(schema.invoices.id, INVOICE)).get();

    it('metadata naming company B is logged tenant_mismatch and changes no invoice; matching metadata is processed', T, async () => {
        h = await webhookHarness('saas');
        const now = new Date();
        await h.db.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT_ID, propertyAddress: '1 Oak St', date: '2026-03-01', createdAt: now,
        });
        await h.db.insert(schema.invoices).values({
            id: INVOICE, tenantId: TENANT_ID, inspectionId: INSPECTION, amountCents: 1000,
            lineItems: [{ description: 'Inspection', amountCents: 1000 }], sentAt: now, createdAt: now, currency: 'USD',
        });
        await storeSecrets(h, TENANT_ID, { STRIPE_SECRET_KEY: 'sk_test_a', STRIPE_WEBHOOK_SECRET: 'whsec_a' });
        const before = await invoiceRow();

        const crossed = await postStripe(h, `/webhooks/stripe/${TENANT_SLUG}`, 'whsec_a', intent(OTHER_TENANT));
        expect(crossed.status).toBe(200);
        expect(await logResults(h)).toEqual(['tenant_mismatch']);
        expect(await invoiceRow()).toEqual(before);

        const ok = await postStripe(h, `/webhooks/stripe/${TENANT_SLUG}`, 'whsec_a', intent(TENANT_ID));
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(await logResults(h)).toContain('processed');
        expect(await invoiceRow()).not.toEqual(before);
    });
});
