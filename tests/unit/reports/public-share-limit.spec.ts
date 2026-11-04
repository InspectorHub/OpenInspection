/**
 * The share button mints a stored token with a 30-day lifetime, so minting is limited per inspection. The limit is taken after the access
 * proof: a caller with no proof is told the inspection does not exist and costs nothing. Every refusal sits beside a request that goes through.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { createHarness, TENANT_ID, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';

const INSPECTION_ID = '44444444-0000-4000-8000-000000000c01';

describe('POST /api/public/inspections/:id/share-token', () => {
    let h: Harness;
    let token: string;
    let limiterKeys: string[];
    let allow: boolean;
    let minted: number;

    const post = async (query = ''): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'public-share-limit' });
        const res = await app.request(`/api/public/inspections/${INSPECTION_ID}/share-token${query}`, { method: 'POST' }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };

    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.insert(schema.inspections).values({
            id: INSPECTION_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '12 Lighthouse Road', date: '2026-06-01', status: 'completed',
            reportStatus: 'published', paymentStatus: 'paid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        token = await new PortalAccessService(h.env.DB, { jwtSecret: h.env.JWT_SECRET }).issueToken({ tenantId: TENANT_ID, inspectionId: INSPECTION_ID, recipientEmail: 'client@example.test' });
        limiterKeys = [];
        allow = true;
        minted = 0;
        (h.env as unknown as { RATE_LIMITER: unknown }).RATE_LIMITER = { limit: async ({ key }: { key: string }) => { limiterKeys.push(key); return { success: allow }; } };
        const kv = h.env.TENANT_CACHE as unknown as { put: (k: string, ...rest: unknown[]) => Promise<void> };
        const put = kv.put.bind(kv);
        kv.put = async (k, ...rest) => { if (k.startsWith('agent_view_token:')) minted += 1; return put(k, ...rest); };
    });
    afterEach(() => h.close());

    it('mints a token for a caller who holds the report link, asking the limiter per inspection', async () => {
        const res = await post(`?token=${token}`);
        expect(res.status).toBe(200);
        expect(limiterKeys).toContain(`share-token:${INSPECTION_ID}`);
        expect(minted).toBe(1);
    });

    it('refuses with 429 and mints nothing when the limiter says stop', async () => {
        allow = false;
        const res = await post(`?token=${token}`);
        expect(res.status).toBe(429);
        expect(minted).toBe(0);
    });

    it('answers a caller with no proof as not found, before the limiter is asked', async () => {
        const res = await post();
        expect(res.status).toBe(404);
        expect(limiterKeys.filter((k) => k.startsWith('share-token:'))).toEqual([]);
        expect(minted).toBe(0);
    });
});
