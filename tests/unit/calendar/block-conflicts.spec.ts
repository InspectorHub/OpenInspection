/**
 * Adding time off over an already-booked inspection.
 *
 * Neither a calendar block nor a date override used to say anything when it
 * covered a booked inspection. The API now returns the affected inspections as a
 * non-blocking `conflicts` field (the server never requires consent: the page
 * asks before saving), and a preview endpoint answers the same question before
 * anything is written. A conflict is an id, a civil date and a time window -
 * never an address, a name or any contact detail.
 *
 * Run through the REAL app and middleware (in-memory SQLite, real JWT).
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, TENANT_ID, OWNER_ID, INSPECTOR_ID } from '../helpers/tenant-email-harness';

const OTHER_INSPECTOR = '22222222-0000-4000-8000-000000000004';
const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff';
const FOREIGN_USER = '22222222-0000-4000-8000-0000000000ff';
const DAY = '2027-03-10';
const I = {
    morning: '77777777-0000-4000-8000-000000000001',   // 09:00, 120 min
    afternoon: '77777777-0000-4000-8000-000000000002', // 14:00, 60 min
    cancelled: '77777777-0000-4000-8000-000000000003', // 09:30, cancelled
    otherDay: '77777777-0000-4000-8000-000000000004',
    colleague: '77777777-0000-4000-8000-000000000005', // someone else's 09:00
    foreign: '77777777-0000-4000-8000-000000000006',   // other company, same day
    untimed: '77777777-0000-4000-8000-000000000007',   // date only, no time of day
};

async function setup(opts: { withUntimed?: boolean } = {}) {
    const h = await createHarness('standalone');
    const now = new Date();
    await h.db.insert(schema.users).values({ id: OTHER_INSPECTOR, tenantId: TENANT_ID, email: 'ines@x.test', passwordHash: 'h', role: 'inspector', name: 'Ines', createdAt: now });
    await h.db.insert(schema.tenants).values({ id: OTHER_TENANT, slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now } as never);
    await h.db.insert(schema.users).values({ id: FOREIGN_USER, tenantId: OTHER_TENANT, email: 'o@other.test', passwordHash: 'h', role: 'inspector', name: 'Oto', createdAt: now });
    const insp = (id: string, tenantId: string, lead: string, date: string, status: string, durationMin: number | null) => ({
        id, tenantId, inspectorId: lead, propertyAddress: '12 Secret Lane', date, status, paymentStatus: 'unpaid', price: 0,
        agreementRequired: false, paymentRequired: false, durationMin, createdAt: now,
    });
    const rows = [
        insp(I.morning, TENANT_ID, INSPECTOR_ID, `${DAY}T09:00:00Z`, 'scheduled', 120),
        insp(I.afternoon, TENANT_ID, INSPECTOR_ID, `${DAY}T14:00:00Z`, 'scheduled', 60),
        insp(I.cancelled, TENANT_ID, INSPECTOR_ID, `${DAY}T09:30:00Z`, 'cancelled', 60),
        insp(I.otherDay, TENANT_ID, INSPECTOR_ID, '2027-03-11T09:00:00Z', 'scheduled', 60),
        insp(I.colleague, TENANT_ID, OTHER_INSPECTOR, `${DAY}T09:00:00Z`, 'scheduled', 60),
        insp(I.foreign, OTHER_TENANT, FOREIGN_USER, `${DAY}T09:00:00Z`, 'scheduled', 60),
        ...(opts.withUntimed ? [insp(I.untimed, TENANT_ID, INSPECTOR_ID, DAY, 'scheduled', null)] : []),
    ];
    await h.db.insert(schema.inspections).values(rows as never);
    await h.db.insert(schema.inspectionInspectors).values(rows.map((r) => ({ inspectionId: r.id, userId: r.inspectorId, tenantId: r.tenantId, role: 'lead' as const, createdAt: now })));
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const iat = Math.floor(Date.now() / 1000);
    const token = async (sub: string, role: string) => signJwt({ sub, 'custom:tenantId': TENANT_ID, 'custom:userRole': role, iat, exp: iat + 3600 }, keyring);
    const call = async (as: string, method: string, path: string, body?: unknown) => {
        const exec = makeExecutionContext({ label: path });
        const res = await app.request(path, {
            method,
            headers: { authorization: `Bearer ${as}`, ...(body ? { 'content-type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, token, call };
}

const ids = (json: { data?: { conflicts?: Array<{ id: string }> } }) => (json.data?.conflicts ?? []).map((c) => c.id).sort();

describe('block preview', () => {
    it('lists the inspections a timed block overlaps, and not the ones it misses', async () => {
        const { h, token, call } = await setup();
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            // 10:00-11:00 falls inside the 09:00-11:00 morning visit; the 14:00 one is untouched.
            const res = await call(t, 'GET', `/api/calendar/blocks/conflicts?date=${DAY}&startTime=10:00&endTime=11:00`);
            expect(res.status).toBe(200);
            const json = await res.json() as { data: { conflicts: Array<{ id: string; date: string; startTime: string | null; endTime: string | null }> } };
            expect(ids(json)).toEqual([I.morning]);
            expect(json.data.conflicts[0]).toEqual({ id: I.morning, date: DAY, startTime: '09:00', endTime: '11:00' });
            expect(JSON.stringify(json)).not.toMatch(/Secret|@/);
        } finally { h.close(); }
    });

    it('touching is not overlapping: a block that starts when the visit ends has no conflict', async () => {
        const { h, token, call } = await setup();
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            expect(ids(await (await call(t, 'GET', `/api/calendar/blocks/conflicts?date=${DAY}&startTime=11:00&endTime=12:00`)).json() as never)).toEqual([]);
        } finally { h.close(); }
    });

    it('an all-day block conflicts with every non-cancelled visit that day, never a cancelled one or another day\'s', async () => {
        const { h, token, call } = await setup();
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            expect(ids(await (await call(t, 'GET', `/api/calendar/blocks/conflicts?date=${DAY}&allDay=true`)).json() as never)).toEqual([I.afternoon, I.morning].sort());
        } finally { h.close(); }
    });

    it('a visit with no time of day is reported for any block that day (better to over-warn)', async () => {
        const { h, token, call } = await setup({ withUntimed: true });
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            const json = await (await call(t, 'GET', `/api/calendar/blocks/conflicts?date=${DAY}&startTime=18:00&endTime=19:00`)).json() as { data: { conflicts: Array<{ id: string; startTime: string | null }> } };
            expect(json.data.conflicts).toEqual([{ id: I.untimed, date: DAY, startTime: null, endTime: null }]);
        } finally { h.close(); }
    });

    it('an inspector cannot ask about a colleague (403), an owner can (the colleague\'s own visit shows)', async () => {
        const { h, token, call } = await setup();
        try {
            const inspector = await token(INSPECTOR_ID, 'inspector');
            expect((await call(inspector, 'GET', `/api/calendar/blocks/conflicts?date=${DAY}&allDay=true&userId=${OTHER_INSPECTOR}`)).status).toBe(403);
            const owner = await token(OWNER_ID, 'owner');
            expect(ids(await (await call(owner, 'GET', `/api/calendar/blocks/conflicts?date=${DAY}&allDay=true&userId=${OTHER_INSPECTOR}`)).json() as never)).toEqual([I.colleague]);
        } finally { h.close(); }
    });

    it('another company\'s visits never appear (tenant scoping)', async () => {
        const { h, token, call } = await setup();
        try {
            const owner = await token(OWNER_ID, 'owner');
            const out = ids(await (await call(owner, 'GET', `/api/calendar/blocks/conflicts?date=${DAY}&allDay=true&userId=${FOREIGN_USER}`)).json() as never);
            expect(out).toEqual([]);
        } finally { h.close(); }
    });
});

describe('create responses carry the same conflicts without requiring anything', () => {
    it('creating an overlapping block still succeeds (201) and reports what it overlaps', async () => {
        const { h, token, call } = await setup();
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            const res = await call(t, 'POST', '/api/calendar/blocks', { title: 'Dentist', date: DAY, allDay: false, startTime: '10:00', endTime: '11:00' });
            expect(res.status).toBe(201);
            expect(ids(await res.json() as never)).toEqual([I.morning]);
        } finally { h.close(); }
    });

    it('a block over nothing has an empty list', async () => {
        const { h, token, call } = await setup();
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            const res = await call(t, 'POST', '/api/calendar/blocks', { title: 'Lunch', date: DAY, allDay: false, startTime: '12:00', endTime: '13:00' });
            expect(res.status).toBe(201);
            expect(ids(await res.json() as never)).toEqual([]);
        } finally { h.close(); }
    });

    it('updating a block onto a booked time reports the conflict', async () => {
        const { h, token, call } = await setup();
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            const created = await (await call(t, 'POST', '/api/calendar/blocks', { title: 'Lunch', date: DAY, allDay: false, startTime: '12:00', endTime: '13:00' })).json() as { data: { block: { id: string } } };
            const res = await call(t, 'PATCH', `/api/calendar/blocks/${created.data.block.id}`, { startTime: '13:30', endTime: '14:30' });
            expect(res.status).toBe(200);
            expect(ids(await res.json() as never)).toEqual([I.afternoon]);
        } finally { h.close(); }
    });

    it('a blocking date override reports the day\'s visits; extra hours report none', async () => {
        const { h, token, call } = await setup();
        try {
            const t = await token(INSPECTOR_ID, 'inspector');
            const block = await call(t, 'POST', '/api/availability/overrides', { date: DAY, isAvailable: false });
            expect(block.status).toBe(201);
            expect(ids(await block.json() as never)).toEqual([I.afternoon, I.morning].sort());
            const extra = await call(t, 'POST', '/api/availability/overrides', { date: '2027-03-12', isAvailable: true, startTime: '09:00', endTime: '12:00' });
            expect(extra.status).toBe(201);
            expect(ids(await extra.json() as never)).toEqual([]);
        } finally { h.close(); }
    });
});
