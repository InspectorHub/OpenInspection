/**
 * Office staff book, copy and re-inspect jobs, through the real application.
 *
 * Booking by staff leaves the job unassigned (an office user cannot inspect), a
 * named inspector must be someone who can, a retry of the same booking is answered
 * rather than refused, and a copy of a published job starts clean. Every refusal is
 * paired with the request that goes through.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { INSPECTION_STATUSES } from '../../../server/lib/status/inspection-status';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const STAFF_ID = '22222222-0000-4000-8000-000000000003';
const STAFF_TWO_ID = '22222222-0000-4000-8000-000000000004';
const TEMPLATE_ID = 'tpl-staff-create';
const NEW_ID = '33333333-0000-4000-8000-000000000001';
const SOURCE_ID = '44444444-0000-4000-8000-000000000001';

const BOOKING = {
    propertyAddress: '12 Booking Lane, Anytown',
    templateId: TEMPLATE_ID,
    date: '2026-06-01T10:00:00.000Z',
    price: 45000,
    client: { name: 'Pat Buyer', email: 'pat@example.com' },
};

describe('office staff create, copy and re-inspect', () => {
    let h: Harness;

    beforeEach(async () => {
        h = await createHarness('standalone');
        await h.db.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: new Date(),
        } as typeof schema.templates.$inferInsert);
        await h.db.insert(schema.users).values([
            { id: STAFF_ID, tenantId: TENANT_ID, email: 'staff@harbor-light.test', passwordHash: 'h', role: 'staff', name: 'Sam Staff', createdAt: new Date() },
            { id: STAFF_TWO_ID, tenantId: TENANT_ID, email: 'staff2@harbor-light.test', passwordHash: 'h', role: 'staff', name: 'Sue Staff', createdAt: new Date() },
        ]);
    });
    afterEach(() => h.close());

    async function call(role: string, sub: string, method: string, path: string, body?: unknown): Promise<Response> {
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub, role, 'custom:userRole': role, 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600 }, keyring);
        const exec = makeExecutionContext({ label: 'staff-create-clone' });
        const res = await app.request(path, {
            method,
            headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, h.env, exec.ctx);
        await exec.settle();
        return res;
    }

    const row = (id: string) => h.db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();

    describe('POST /api/inspections', () => {
        it('lets staff book a job with a client and a price (staff hold inspectionFees), and leaves it unassigned', async () => {
            const res = await call('staff', STAFF_ID, 'POST', '/api/inspections', { ...BOOKING, id: NEW_ID });
            expect(res.status, await res.clone().text()).toBe(201);
            const stored = await row(NEW_ID);
            expect(stored?.inspectorId).toBeNull();
            expect(stored?.propertyAddress).toBe(BOOKING.propertyAddress);
            expect(stored?.status).toBe('requested');
        });

        it('control: an inspector who books is the lead of the job they book', async () => {
            const res = await call('inspector', INSPECTOR_ID, 'POST', '/api/inspections', { ...BOOKING, id: NEW_ID });
            expect(res.status, await res.clone().text()).toBe(201);
            expect((await row(NEW_ID))?.inspectorId).toBe(INSPECTOR_ID);
        });

        it('answers the creator retry with the existing job, not a conflict', async () => {
            expect((await call('staff', STAFF_ID, 'POST', '/api/inspections', { ...BOOKING, id: NEW_ID })).status).toBe(201);
            const replay = await call('staff', STAFF_ID, 'POST', '/api/inspections', { ...BOOKING, id: NEW_ID });
            expect(replay.status, await replay.clone().text()).toBe(200);
            const body = await replay.json() as { data: { inspection: { id: string } } };
            expect(body.data.inspection.id).toBe(NEW_ID);
            expect(await h.db.select().from(schema.inspections).all()).toHaveLength(1);
        });

        it('control: another office user who did not book it, and is not on it, still gets the conflict', async () => {
            expect((await call('staff', STAFF_ID, 'POST', '/api/inspections', { ...BOOKING, id: NEW_ID })).status).toBe(201);
            const other = await call('inspector', INSPECTOR_ID, 'POST', '/api/inspections', { ...BOOKING, id: NEW_ID });
            expect(other.status, await other.clone().text()).toBe(409);
        });

        it('refuses a named inspector who cannot inspect, and accepts one who can', async () => {
            const office = await call('staff', STAFF_ID, 'POST', '/api/inspections', { ...BOOKING, inspectorId: STAFF_TWO_ID });
            expect(office.status, await office.clone().text()).toBe(400);
            const agentless = await call('staff', STAFF_ID, 'POST', '/api/inspections', { ...BOOKING, inspectorId: '99999999-0000-4000-8000-000000000009' });
            expect(agentless.status).toBe(400);
            expect(await h.db.select().from(schema.inspections).all()).toHaveLength(0);

            const ok = await call('staff', STAFF_ID, 'POST', '/api/inspections', { ...BOOKING, id: NEW_ID, inspectorId: INSPECTOR_ID });
            expect(ok.status, await ok.clone().text()).toBe(201);
            expect((await row(NEW_ID))?.inspectorId).toBe(INSPECTOR_ID);
        });

        it('also holds for an owner naming an office user (the check is not only for staff)', async () => {
            const res = await call('owner', OWNER_ID, 'POST', '/api/inspections', { ...BOOKING, inspectorId: STAFF_TWO_ID });
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/inspections/wizard', () => {
        it('stays closed to staff; an owner reaches validation', async () => {
            expect((await call('staff', STAFF_ID, 'POST', '/api/inspections/wizard', {})).status).toBe(403);
            expect((await call('owner', OWNER_ID, 'POST', '/api/inspections/wizard', {})).status).toBe(400);
        });
    });

    describe('POST /api/inspections/:id/clone', () => {
        const publishedSource = {
            id: SOURCE_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '7 Source Road', date: '2026-05-01',
            templateId: TEMPLATE_ID, status: 'completed' as const, reportStatus: 'published' as const, paymentStatus: 'paid' as const,
            price: 52000, paymentRequired: true, agreementRequired: true, sqft: 1800, yearBuilt: 1975, referenceNumber: 'REF-7',
            autoSignOnPublish: true, profileOverride: 'meridian', badgeLayoutOverride: 'inline' as const, reportPhotoColumns: 3, requireDefectFieldsOverride: 'both' as const, confirmedAt: new Date(1_700_000_000_000), cancelReason: 'client_cancelled' as const, cancelNotes: 'old note',
            unlockedAt: new Date(1_700_000_000_000), unlockedBy: OWNER_ID, unlockReason: 'released',
            coverPhotoId: 'old/cover.jpg', coverImageKey: 'old/cover-key.jpg', scheduledStartMs: new Date(1_700_000_000_000),
            scheduledEndMs: new Date(1_700_003_600_000), reportsGeneratedAt: new Date(1_700_000_000_000),
            sourceInspectionId: 'prior-1', rootInspectionId: 'prior-root', reinspectionRound: 2, conciergeStatus: 'approved',
            propertyFacts: { roof: 'asphalt' }, pcaNarrative: { summary: 'old narrative' },
            deviations: [{ id: 'd1', area: 'roof', baselineRequirement: 'b', deviation: 'd', reason: 'r' }],
            createdAt: new Date(1_700_000_000_000),
        };

        beforeEach(async () => {
            await h.db.insert(schema.inspections).values(publishedSource);
        });

        it('copies the booking of a published job and resets everything that belonged to the old one', async () => {
            const res = await call('staff', STAFF_ID, 'POST', `/api/inspections/${SOURCE_ID}/clone`);
            expect(res.status, await res.clone().text()).toBe(201);
            const { data } = await res.json() as { data: { inspection: { id: string } } };
            const clone = await row(data.inspection.id);
            expect(clone).toBeTruthy();
            expect(clone?.id).not.toBe(SOURCE_ID);

            // Carried: where, what, who, and the booking terms.
            expect([clone?.propertyAddress, clone?.templateId, clone?.inspectorId, clone?.price, clone?.sqft, clone?.yearBuilt, clone?.referenceNumber])
                .toEqual(['7 Source Road', TEMPLATE_ID, INSPECTOR_ID, 52000, 1800, 1975, 'REF-7']);
            expect([clone?.paymentRequired, clone?.agreementRequired]).toEqual([true, true]);

            // Reset: one assertion per column the plan names.
            expect(clone?.reportStatus).toBe('in_progress');
            expect(clone?.autoSignOnPublish).toBe(false);
            expect([clone?.profileOverride, clone?.badgeLayoutOverride, clone?.reportPhotoColumns, clone?.requireDefectFieldsOverride]).toEqual([null, null, null, null]);
            expect(clone?.paymentStatus).toBe('unpaid');
            expect((INSPECTION_STATUSES as readonly string[]).includes(clone?.status ?? '')).toBe(true);
            expect(clone?.status).toBe('requested');
            expect([clone?.unlockedAt, clone?.unlockedBy, clone?.unlockReason]).toEqual([null, null, null]);
            expect(clone?.confirmedAt).toBeNull();
            expect([clone?.cancelReason, clone?.cancelNotes]).toEqual([null, null]);
            expect([clone?.scheduledStartMs, clone?.scheduledEndMs]).toEqual([null, null]);
            expect(clone?.reportsGeneratedAt).toBeNull();
            expect([clone?.coverPhotoId, clone?.coverImageKey]).toEqual([null, null]);
            expect([clone?.sourceInspectionId, clone?.rootInspectionId, clone?.reinspectionRound]).toEqual([null, null, null]);
            expect(clone?.requestId).toBeNull();
            expect(clone?.conciergeStatus).toBeNull();
            expect([clone?.propertyFacts, clone?.pcaNarrative, clone?.deviations]).toEqual([null, null, null]);
            expect(clone?.date).not.toBe('2026-05-01');

            // The source is untouched.
            const source = await row(SOURCE_ID);
            expect([source?.reportStatus, source?.autoSignOnPublish, source?.coverPhotoId]).toEqual(['published', true, 'old/cover.jpg']);
        });

        it('control: an owner gets the same clean copy', async () => {
            const res = await call('owner', OWNER_ID, 'POST', `/api/inspections/${SOURCE_ID}/clone`);
            expect(res.status, await res.clone().text()).toBe(201);
            const { data } = await res.json() as { data: { inspection: { id: string } } };
            const clone = await row(data.inspection.id);
            expect([clone?.reportStatus, clone?.autoSignOnPublish, clone?.status]).toEqual(['in_progress', false, 'requested']);
        });

        it('answers 404 for a missing source, and burns no job', async () => {
            const res = await call('staff', STAFF_ID, 'POST', '/api/inspections/00000000-0000-4000-8000-00000000dead/clone');
            expect(res.status).toBe(404);
            expect(await h.db.select().from(schema.inspections).all()).toHaveLength(1);
        });
    });

    describe('POST /api/inspections/:id/reinspect', () => {
        beforeEach(async () => {
            await h.db.insert(schema.inspections).values({
                id: SOURCE_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '7 Source Road', date: '2026-05-01',
                templateId: TEMPLATE_ID, status: 'completed', reportStatus: 'published', price: 0, createdAt: new Date(),
            });
            await h.db.insert(schema.reportVersions).values({
                id: 'rv-1', tenantId: TENANT_ID, inspectionId: SOURCE_ID, versionNumber: 1,
                snapshotJson: JSON.stringify({ inspection: { id: SOURCE_ID }, data: { 'item-a': { rating: 'defect', notes: 'x', photos: [] } }, units: [] }),
                publishedAt: new Date(), publishedBy: OWNER_ID, createdAt: new Date(),
            });
        });

        const body = (extra: Record<string, unknown> = {}) => ({ selectedItemIds: ['item-a'], scheduledDate: '2026-06-02', ...extra });

        it('is open to staff, who may leave the inspector as the baseline one', async () => {
            const res = await call('staff', STAFF_ID, 'POST', `/api/inspections/${SOURCE_ID}/reinspect`, body());
            expect(res.status, await res.clone().text()).toBe(200);
            const { data } = await res.json() as { data: { id: string } };
            expect((await row(data.id))?.inspectorId).toBe(INSPECTOR_ID);
        });

        it('refuses an office user as the inspector, and accepts a field inspector', async () => {
            const bad = await call('staff', STAFF_ID, 'POST', `/api/inspections/${SOURCE_ID}/reinspect`, body({ inspectorId: STAFF_TWO_ID }));
            expect(bad.status).toBe(400);
            expect(JSON.stringify(await bad.json())).toContain('can inspect');
            expect(await h.db.select().from(schema.inspections).all()).toHaveLength(1);

            const ok = await call('staff', STAFF_ID, 'POST', `/api/inspections/${SOURCE_ID}/reinspect`, body({ inspectorId: INSPECTOR_ID }));
            expect(ok.status, await ok.clone().text()).toBe(200);
        });
    });
});
