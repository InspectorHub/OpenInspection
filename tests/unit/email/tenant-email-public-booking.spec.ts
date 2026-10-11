/**
 * Public booking confirmation speaks for the TENANT, in both deployment modes.
 *
 * `POST /api/public/book` names its company in the request body, so in a
 * multi-tenant deployment nothing before the DI middleware knows the tenant:
 * the handler resolves it. The confirmation email must still carry that
 * company's sender name, Reply-To and brand, and be metered against it. In a
 * single-tenant deployment the fixed tenant is known for every request, which
 * is why the two modes are asserted side by side here.
 *
 * Driven through the real app and the real middleware chain; only the
 * provider's HTTP call is intercepted (see helpers/tenant-email-harness.ts).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { nextWeekday } from '../helpers/bookable-date';
import * as schema from '../../../server/lib/db/schema';
import {
    createHarness, observeIdentity, INSPECTOR_ID, OWNER_ID, TENANT_ID, TENANT_SLUG, TENANT_VOICE,
    type Harness, type HarnessMode,
} from '../helpers/tenant-email-harness';

const MONDAY = nextWeekday(1);

async function seedAvailability(h: Harness): Promise<void> {
    await h.db.insert(schema.availability).values([
        { id: 'av-1', tenantId: TENANT_ID, inspectorId: OWNER_ID, dayOfWeek: 1, startTime: '08:00', endTime: '12:00', createdAt: new Date() },
        { id: 'av-2', tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, dayOfWeek: 1, startTime: '08:00', endTime: '12:00', createdAt: new Date() },
    ]);
}

describe.each<HarnessMode>(['saas', 'standalone'])('POST /api/public/book confirmation identity (%s)', (mode) => {
    let h: Harness;
    afterEach(() => h.close());

    it('sends the confirmation with the tenant sender name, Reply-To and brand, metered to the tenant', { timeout: 60_000 }, async () => {
        h = await createHarness(mode);
        await seedAvailability(h);
        const exec = makeExecutionContext({ label: `book-${mode}` });

        const res = await app.request('/api/public/book', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                tenant: TENANT_SLUG,
                address: '12 Lighthouse Road Portland',
                clientName: 'Casey Client',
                clientEmail: 'casey@client.test',
                date: MONDAY,
                timeSlot: 'morning',
                turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
            }),
        }, h.env, exec.ctx);
        expect(res.status, await res.clone().text()).toBe(200);
        await exec.settle();

        const confirmation = h.sent.find((m) => m.to.includes('casey@client.test'));
        expect(observeIdentity(h, confirmation)).toEqual(TENANT_VOICE);
    });
});

describe('POST /api/public/book from a company that signed up an hour ago (saas)', () => {
    let h: Harness;
    afterEach(() => h.close());

    it('is not held by the 24-hour outbound window: the first customer of a new company still gets a confirmation', { timeout: 60_000 }, async () => {
        h = await createHarness('saas', { tenantAgeMs: 60 * 60 * 1000 });
        await seedAvailability(h);
        const exec = makeExecutionContext({ label: 'book-first-day' });

        const res = await app.request('/api/public/book', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                tenant: TENANT_SLUG,
                address: '12 Lighthouse Road Portland',
                clientName: 'Casey Client',
                clientEmail: 'casey@client.test',
                date: MONDAY,
                timeSlot: 'morning',
                turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
            }),
        }, h.env, exec.ctx);
        expect(res.status, await res.clone().text()).toBe(200);
        await exec.settle();

        const confirmation = h.sent.find((m) => m.to.includes('casey@client.test'));
        expect(confirmation, 'the confirmation was not sent').toBeDefined();
        expect(observeIdentity(h, confirmation)).toEqual(TENANT_VOICE);
    });
});
