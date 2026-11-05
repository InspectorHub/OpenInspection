/**
 * Calendar feeds publish a keyed hash of each inspection id, so a deployment with no secret cannot build one. Every feed answers 404
 * in that case, and the company feed does so before it reads anything.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { createHarness, TENANT_ID, TENANT_SLUG, INSPECTOR_ID, type Harness } from '../helpers/tenant-email-harness';
import { watchDb } from '../helpers/verify-export-kit';

const TOKEN = 'company-feed-token-0123456789';
const DAY = new Date().toISOString().slice(0, 10);

describe('calendar feeds without the deployment secret', () => {
    let h: Harness;
    const get = async (path: string): Promise<Response> => {
        const exec = makeExecutionContext({ label: 'ics-no-secret' });
        const res = await app.request(path, {}, h.env, exec.ctx);
        await exec.settle();
        return res;
    };

    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.update(schema.users).set({ slug: 'ivan' }).where(eq(schema.users.id, INSPECTOR_ID));
        await h.db.insert(schema.inspections).values({
            id: 'ics-insp-1', tenantId: TENANT_ID, propertyAddress: '12 Lighthouse Road', date: DAY, status: 'confirmed', paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        } as never);
        await h.db.insert(schema.inspectionInspectors).values({ tenantId: TENANT_ID, inspectionId: 'ics-insp-1', userId: INSPECTOR_ID, role: 'lead', createdAt: new Date() });
        await h.db.update(schema.tenantConfigs).set({ icsToken: TOKEN }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
    });
    afterEach(() => h.close());

    it('control: with the secret the busy feed and the company feed both answer', async () => {
        expect((await get(`/inspector/${TENANT_SLUG}/ivan/calendar.ics`)).status).toBe(200);
        expect((await get(`/api/ics/${TOKEN}`)).status).toBe(200);
    });

    it('the busy feed answers 404 (not 500) without the secret', async () => {
        (h.env as { JWT_SECRET?: string }).JWT_SECRET = '';
        expect((await get(`/inspector/${TENANT_SLUG}/ivan/calendar.ics`)).status).toBe(404);
    });

    it('the inspector feed answers 404 without the secret', async () => {
        (h.env as { JWT_SECRET?: string }).JWT_SECRET = '';
        expect((await get('/api/ics/inspector/not-a-real-token')).status).toBe(404);
    });

    it('the company feed answers 404 without the secret and reads nothing first', async () => {
        (h.env as { JWT_SECRET?: string }).JWT_SECRET = '';
        const watch = watchDb(h);
        const res = await get(`/api/ics/${TOKEN}`);
        watch.restore();
        expect(res.status).toBe(404);
        expect(watch.log.some((q) => q.includes('ics_token') || q.includes('"inspections"'))).toBe(false);
    });
});
