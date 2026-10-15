/** Shared fixtures for the webhook stored-secret specs (real app, real middleware chain). */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { vi, type Mock } from 'vitest';
import { app } from '../../../server/index';
import * as schema from '../../../server/lib/db/schema';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { encryptToken } from '../../../server/lib/qbo-crypto';
import { stripeWebhookLogKey, type StripeWebhookLogEntry } from '../../../server/lib/stripe-webhook-log';
import { makeExecutionContext } from './exec-ctx';
import { createHarness, TENANT_ID, type Harness, type HarnessMode } from './tenant-email-harness';

/**
 * `createHarness` with a KV that honours `{ type: 'json' }`. The shared mock hands
 * back the stored string whatever `type` is asked for, which makes a second request
 * in one test read a cached tenant as a string and lose its company -- an answer
 * that looks like "ignored" and can pass a status-only assertion by accident.
 */
export async function webhookHarness(mode: HarnessMode): Promise<Harness> {
    const h = await createHarness(mode);
    const kv = h.env.TENANT_CACHE as unknown as { get: Mock };
    const inner = kv.get.getMockImplementation()!;
    kv.get.mockImplementation(async (key: string, opts?: { type?: string }) => {
        const v = await inner(key, opts);
        return opts?.type === 'json' && typeof v === 'string' ? JSON.parse(v) : v;
    });
    return h;
}

export const OTHER_TENANT = '11111111-0000-4000-8000-0000000000bb';
export const OTHER_SLUG = 'other-co';
export const REALM_A = '9130350000000001';
export const REALM_B = '9130350000000002';
export const FUTURE = new Date('2099-01-01T00:00:00Z');

export async function storeSecrets(h: Harness, tenantId: string, data: Record<string, string>): Promise<void> {
    const sealed = await sealSecrets(data, tenantId, h.env.JWT_SECRET);
    await h.db.update(schema.tenantConfigs)
        .set({ secretsEnc: sealed.blob, dekEnc: sealed.dekEnc })
        .where(eq(schema.tenantConfigs.tenantId, tenantId));
}

export async function seedOtherCompany(h: Harness, realmId: string): Promise<void> {
    const now = new Date();
    await h.db.insert(schema.tenants).values({
        id: OTHER_TENANT, slug: OTHER_SLUG, status: 'active', tier: 'free',
        maxUsers: 5, deploymentMode: 'shared', createdAt: now,
    });
    await h.db.insert(schema.tenantConfigs).values({ tenantId: OTHER_TENANT, companyName: 'Other Co', updatedAt: now });
    await connectQbo(h, OTHER_TENANT, realmId);
}

export async function connectQbo(h: Harness, tenantId: string, realmId: string): Promise<void> {
    await h.db.insert(schema.qboConnections).values({
        tenantId, realmId, companyName: `Co ${realmId}`,
        accessToken: await encryptToken('at', h.env.JWT_SECRET),
        refreshToken: await encryptToken('rt', h.env.JWT_SECRET),
        tokenExpiresAt: FUTURE, refreshTokenExpiresAt: FUTURE,
        syncEnabled: true, defaultItemId: '1', createdAt: new Date(),
    });
}

// ---- Stripe ---------------------------------------------------------------

export const stripeBody = JSON.stringify({
    id: 'evt_test_1', object: 'event', type: 'customer.created',
    api_version: '2024-06-20', created: 1_700_000_000, livemode: false,
    data: { object: { id: 'cus_1', object: 'customer' } },
});

export function stripeSignature(secret: string, body = stripeBody): string {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex')}`;
}

export async function postStripe(h: Harness, path: string, secret: string, body = stripeBody): Promise<Response> {
    const exec = makeExecutionContext({ label: 'stripe-webhook' });
    const res = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(secret, body) },
        body,
    }, h.env, exec.ctx);
    await exec.settle();
    return res;
}

// The mock KV hands back the stored string whatever `type` is asked for, so the
// diagnostics log is read raw and parsed here.
export const logResults = async (h: Harness, tenantId = TENANT_ID): Promise<string[]> => {
    const raw = await h.env.TENANT_CACHE.get(stripeWebhookLogKey(tenantId));
    return raw ? (JSON.parse(raw) as StripeWebhookLogEntry[]).map((e) => e.result) : [];
};

// ---- QuickBooks -----------------------------------------------------------

export const event = (realm: string, invoiceId: string) => ({
    specversion: '1.0', id: `evt-${realm}-${invoiceId}`, source: '/services/quickbooks/v3',
    type: 'qbo.invoice.updated.v1', time: '2026-03-05T10:00:00Z',
    intuitentityid: invoiceId, intuitaccountid: realm,
});

/** Records the QuickBooks API paths the processor reached for. */
export function stubQuickBooks(): string[] {
    const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        const id = url.pathname.split('/').pop() ?? '';
        return new Response(JSON.stringify({ Invoice: { Id: id, SyncToken: '1', Balance: 10, TotalAmt: 10 } }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    }));
    return paths;
}

export async function postQbo(
    h: Harness, events: unknown, secret: string, opts: { sig?: string } = {},
): Promise<Response> {
    const raw = typeof events === 'string' ? events : JSON.stringify(events);
    const exec = makeExecutionContext({ label: 'qbo-webhook' });
    const res = await app.request('/webhooks/quickbooks', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'intuit-signature': opts.sig ?? createHmac('sha256', secret).update(raw, 'utf8').digest('base64'),
        },
        body: raw,
    }, h.env, exec.ctx);
    await exec.settle();
    return res;
}

export async function qboHarness(mode: HarnessMode): Promise<Harness> {
    const h = await webhookHarness(mode);
    Object.assign(h.env, { QBO_CLIENT_ID: 'cid', QBO_CLIENT_SECRET: 'csec', QBO_ENV: 'sandbox' });
    await connectQbo(h, TENANT_ID, REALM_A);
    return h;
}

