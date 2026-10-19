/**
 * The public slot list and the booking's admission must judge a slot over the same
 * window, for every time-slot value, also when no chosen service has a duration.
 *
 * Without a duration the booking occupies its window: 240 minutes for morning or
 * afternoon, 540 for all-day. The list used to assume 180 whatever the customer
 * would choose, so on a day with an afternoon inspection it offered 08:00 and the
 * customer who then picked All Day was refused on every submit. Now the list takes
 * the chosen time slot (and, when none is named, offers only starts that fit every
 * selectable window). Driven through the real app, real middleware, real arbitration.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { nextWeekday } from '../helpers/bookable-date';
import * as schema from '../../../server/lib/db/schema';
import { createHarness, INSPECTOR_ID, TENANT_ID, TENANT_SLUG, type Harness } from '../helpers/tenant-email-harness';

const MONDAY = nextWeekday(1);
type TimeSlot = 'morning' | 'afternoon' | 'all-day';

async function seed(h: Harness, withAfternoonInspection: boolean): Promise<void> {
    await h.db.insert(schema.availability).values([
        { id: 'av-1', tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, dayOfWeek: 1, startTime: '08:00', endTime: '17:00', createdAt: new Date() },
    ]);
    if (!withAfternoonInspection) return;
    const iso = `${MONDAY}T14:00:00Z`;
    const t0 = new Date('2027-01-01T00:00:00Z');
    await h.db.insert(schema.inspectionRequests).values({ id: 'req-ex', tenantId: TENANT_ID, clientName: 'C', propertyAddress: '1 St', scheduledAt: new Date(iso), status: 'pending', createdAt: t0, updatedAt: t0 } as never);
    await h.db.insert(schema.inspections).values({ id: 'ex-1', tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '1 St', date: iso, status: 'scheduled', paymentStatus: 'unpaid', price: 0, requestId: 'req-ex', createdAt: t0, durationMin: 120 } as never);
    await h.db.insert(schema.inspectionInspectors).values({ inspectionId: 'ex-1', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'lead', createdAt: t0 });
}

async function slots(h: Harness, timeSlot?: TimeSlot): Promise<string[]> {
    const exec = makeExecutionContext({ label: 'slots' });
    const q = new URLSearchParams({ tenant: TENANT_SLUG, date: MONDAY, ...(timeSlot ? { timeSlot } : {}) });
    const res = await app.request(`/api/public/slots?${q}`, {}, h.env, exec.ctx);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as { data: { slots: Array<{ time: string; available: boolean }> } };
    return body.data.slots.filter((s) => s.available).map((s) => s.time);
}

async function book(h: Harness, timeSlot: TimeSlot | 'custom', customTime?: string): Promise<number> {
    const exec = makeExecutionContext({ label: 'book' });
    const res = await app.request('/api/public/book', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            tenant: TENANT_SLUG, address: '12 Lighthouse Road Portland', clientName: 'Casey Client', clientEmail: 'casey@client.test',
            date: MONDAY, timeSlot, ...(customTime ? { customTime } : {}), turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
        }),
    }, h.env, exec.ctx);
    await exec.settle();
    return res.status;
}

describe('slot list and admission agree on the window (no service durations)', () => {
    let h: Harness;
    afterEach(() => h.close());

    it.each<TimeSlot>(['morning', 'afternoon', 'all-day'])('%s: when the list offers a start the booking is accepted, and when it offers none the booking is refused', { timeout: 60_000 }, async (timeSlot) => {
        h = await createHarness('standalone');
        await seed(h, true);
        const offered = await slots(h, timeSlot);
        expect(await book(h, timeSlot), `offered: ${offered.join(',') || 'none'}`).toBe(offered.length > 0 ? 200 : 409);
    });

    it('all-day on a day with a 14:00-16:00 inspection offers no start that overlaps it (the 540-minute window), while morning still offers 08:00', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        await seed(h, true);
        const allDay = await slots(h, 'all-day');
        expect(allDay.every((t) => t >= '16:00'), allDay.join(',')).toBe(true);
        const morning = await slots(h, 'morning');
        expect(morning).toContain('08:00');
        // The list also keeps to the window: nothing from noon on is offered for Morning.
        expect(morning.every((t) => t < '12:00')).toBe(true);
    });

    it('with no time slot named the list offers only starts that fit every selectable window', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        await seed(h, true);
        // The widest window (all-day, 540) overlaps the afternoon inspection from every start before 16:00.
        const offered = await slots(h);
        expect(offered.every((t) => t >= '16:00'), offered.join(',')).toBe(true);
    });

    it('with no time slot named, an empty day still offers its starts, and each of them books at exactly that time', { timeout: 60_000 }, async () => {
        h = await createHarness('standalone');
        await seed(h, false);
        const offered = await slots(h);
        expect(offered).toContain('08:00');
        expect(await book(h, 'custom', offered[0]!)).toBe(200);
    });
});

describe('GET /api/public/slots is never cached', () => {
    let h: Harness;
    afterEach(() => h.close());

    it.each([
        ['a 200', `tenant=${TENANT_SLUG}&date=${MONDAY}`, 200],
        ['an unknown tenant (404)', `tenant=nobody&date=${MONDAY}`, 404],
        ['a malformed date (400)', `tenant=${TENANT_SLUG}&date=soon`, 400],
        ['an unknown time slot (400)', `tenant=${TENANT_SLUG}&date=${MONDAY}&timeSlot=evening`, 400],
    ])('answers %s with Cache-Control: no-store and keeps Vary: Origin', { timeout: 60_000 }, async (_n, query, status) => {
        h = await createHarness('standalone');
        await seed(h, false);
        const exec = makeExecutionContext({ label: 'slots-cache' });
        const res = await app.request(`/api/public/slots?${query}`, { headers: { origin: 'https://example.test' } }, h.env, exec.ctx);
        expect(res.status).toBe(status);
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(res.headers.get('vary') ?? '').toMatch(/Origin/i);
    });
});

