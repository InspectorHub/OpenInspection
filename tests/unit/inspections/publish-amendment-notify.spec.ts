/**
 * "Notify the client" at republish. A first publish is decided by the workspace's `report.published` rules, as ever.
 * An AMENDMENT (the report already has a published version) fires the `report.amended` rules only when the publisher
 * asked: `notifyClient` true. Absent or false fires nothing, and a suppressed notice must not stamp `notified_at`.
 *
 * Real in-memory database and the real automation service. Every "does not" has a "does" beside it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { InspectionService } from '../../../server/services/inspection.service';
import { AutomationService } from '../../../server/services/automation.service';
import { PeopleService } from '../../../server/services/people.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-0000000000c0';
const INSPECTION = 'insp-coalesce';
const PRIMARY = 'rpt-primary';
const SEWER = 'rpt-sewer';
const RADON = 'rpt-radon';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const T0 = Date.parse('2026-08-03T15:00:00.000Z');

let db: BetterSQLite3Database<typeof schema>;
let inspections: InspectionService;

const publishOptions = (reportId: string, notifyClient?: boolean) => ({
    theme: 'modern',
    requireSignature: false, requirePayment: false, reportId,
    ...(notifyClient === undefined ? {} : { notifyClient }),
});

async function seedReport(id: string, kind: 'primary' | 'ancillary', title: string, sortOrder: number) {
    await db.insert(schema.reports).values({
        id, tenantId: TENANT, inspectionId: INSPECTION, kind,
        inspectionServiceId: null, templateId: null, title,
        status: 'in_progress', createdAt: new Date(T0), sortOrder,
    } as never);
}

async function notificationCount(): Promise<number> {
    const rows = await db.select().from(schema.automationLogs)
        .where(eq(schema.automationLogs.inspectionId, INSPECTION)).all();
    return rows.length;
}

async function notifiedAt(reportId: string): Promise<Date | null> {
    const row = await db.select({ notifiedAt: schema.reports.notifiedAt })
        .from(schema.reports).where(eq(schema.reports.id, reportId)).get();
    return row?.notifiedAt ?? null;
}

beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(T0));

    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'coalesce-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(T0),
    } as never);
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(T0));
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '9 Coalesce Court',
        date: '2026-08-03', status: 'completed', reportStatus: 'in_progress',
        paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
        createdAt: new Date(T0),
    } as never);
    await db.insert(schema.contacts).values({
        id: 'c-client', tenantId: TENANT, type: 'client', name: 'Jane Client',
        email: 'jane@example.com', createdAt: new Date(T0),
    } as never);
    await new PeopleService({ DB: {} as D1Database })
        .addPerson(TENANT, INSPECTION, 'c-client', `crp_${TENANT}_client`);

    await new AutomationService({} as D1Database).create(TENANT, {
        name: 'Report Ready', trigger: 'report.published', recipientKind: 'all',
        recipientRoleProfileId: null, delayMinutes: 0, channels: ['email'],
    } as never);

    await new AutomationService({} as D1Database).create(TENANT, {
        name: 'Report Updated', trigger: 'report.amended', recipientKind: 'all',
        recipientRoleProfileId: null, delayMinutes: 0, channels: ['email'],
    } as never);

    await seedReport(PRIMARY, 'primary', 'Standard Home Inspection', 0);
    await seedReport(SEWER, 'ancillary', 'Sewer Scope', 1);
    await seedReport(RADON, 'ancillary', 'Radon Testing', 2);

    inspections = new InspectionService(
        {} as D1Database, undefined, new ScopedDB(db as never, TENANT));
});

afterEach(() => {
    vi.useRealTimers();
});


/** The report was published once already (version 1), long enough ago that nothing coalesces. */
async function publishFirstThenAdvance(): Promise<{ stamp: Date | null; logs: number }> {
    await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
    await db.insert(schema.reportVersions).values({
        id: 'v1', tenantId: TENANT, inspectionId: INSPECTION, reportId: PRIMARY, versionNumber: 1,
        snapshotJson: '{}', publishedAt: new Date(T0), publishedBy: 'u1',
    });
    // "Edit and republish": the report is open again (in progress) and keeps `published_at`, so clients still read v1.
    await db.update(schema.reports).set({ status: 'in_progress' }).where(eq(schema.reports.id, PRIMARY));
    vi.setSystemTime(new Date(T0 + 2 * DAY));
    return { stamp: await notifiedAt(PRIMARY), logs: await notificationCount() };
}

describe('republish - the publisher chooses whether the client is told', () => {
    it('a first publish is unaffected: it notifies through the report.published rules, even with notifyClient false', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY, false));
        expect(await notificationCount()).toBeGreaterThan(0);
        expect(await notifiedAt(PRIMARY)).not.toBeNull();
    });

    it('an amendment with notifyClient omitted notifies nobody and leaves notified_at as it was (default is false)', async () => {
        const before = await publishFirstThenAdvance();
        expect(before.logs).toBeGreaterThan(0);
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        expect(await notificationCount()).toBe(before.logs);
        expect((await notifiedAt(PRIMARY))?.getTime()).toBe(before.stamp?.getTime());
    });

    it('an amendment with notifyClient false notifies nobody and leaves notified_at as it was', async () => {
        const before = await publishFirstThenAdvance();
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY, false));
        expect(await notificationCount()).toBe(before.logs);
        expect((await notifiedAt(PRIMARY))?.getTime()).toBe(before.stamp?.getTime());
    });

    it('an amendment with notifyClient true raises the report-updated notice and stamps notified_at', async () => {
        const before = await publishFirstThenAdvance();
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY, true));
        expect(await notificationCount()).toBeGreaterThan(before.logs);
        expect((await notifiedAt(PRIMARY))?.getTime()).toBe(T0 + 2 * DAY);
    });

    it('reports whether the publish was an amendment (the route records it in the audit row)', async () => {
        const first = await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        expect(first.amendment).toBe(false);
        await db.insert(schema.reportVersions).values({
            id: 'v1', tenantId: TENANT, inspectionId: INSPECTION, reportId: PRIMARY, versionNumber: 1,
            snapshotJson: '{}', publishedAt: new Date(T0), publishedBy: 'u1',
        });
        await db.update(schema.reports).set({ status: 'in_progress' }).where(eq(schema.reports.id, PRIMARY));
        expect((await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY))).amendment).toBe(true);
    });

    it('a republish after a RETRACT is a fresh delivery: versions exist but the report is not open for editing, so the rules decide as for a first publish', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        await db.insert(schema.reportVersions).values({
            id: 'v1', tenantId: TENANT, inspectionId: INSPECTION, reportId: PRIMARY, versionNumber: 1,
            snapshotJson: '{}', publishedAt: new Date(T0), publishedBy: 'u1',
        });
        // Retract clears published_at and resets the order and the report.
        await db.update(schema.reports).set({ status: 'in_progress', publishedAt: null, notifiedAt: null }).where(eq(schema.reports.id, PRIMARY));
        await db.update(schema.inspections).set({ reportStatus: 'in_progress' }).where(eq(schema.inspections.id, INSPECTION));
        const logs = await notificationCount();
        vi.setSystemTime(new Date(T0 + 2 * DAY));
        const out = await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        expect(out.amendment).toBe(false);
        expect(await notificationCount()).toBeGreaterThan(logs);
    });

    it('a suppressed amendment does not delay a later sibling announcement (no stamp, so nothing to coalesce into)', async () => {
        await publishFirstThenAdvance();
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY, false));
        const logs = await notificationCount();
        vi.setSystemTime(new Date(T0 + 2 * DAY + MINUTE));
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(RADON));
        expect(await notificationCount()).toBeGreaterThan(logs);
    });
});

describe('republish - older reports and several deliverables', () => {
    const version = (id: string, reportId: string, n: number) => ({
        id, tenantId: TENANT, inspectionId: INSPECTION, reportId, versionNumber: n,
        snapshotJson: '{}', publishedAt: new Date(T0), publishedBy: 'u1',
    });
    const reopen = (reportId: string) =>
        db.update(schema.reports).set({ status: 'in_progress' }).where(eq(schema.reports.id, reportId));

    it('a reopened report with NO version row is still an amendment: notifyClient decides (omitted = nobody told)', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        const stamp = await notifiedAt(PRIMARY);
        const logs = await notificationCount();
        await reopen(PRIMARY);
        vi.setSystemTime(new Date(T0 + 2 * DAY));

        const out = await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        expect(out.amendment).toBe(true);
        expect(await notificationCount()).toBe(logs);
        expect((await notifiedAt(PRIMARY))?.getTime()).toBe(stamp?.getTime());
    });

    it('(control) the same reopened report with notifyClient true notifies and stamps', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        const logs = await notificationCount();
        await reopen(PRIMARY);
        vi.setSystemTime(new Date(T0 + 2 * DAY));

        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY, true));
        expect(await notificationCount()).toBeGreaterThan(logs);
        expect((await notifiedAt(PRIMARY))?.getTime()).toBe(T0 + 2 * DAY);
    });

    it('an amendment on one deliverable leaves the other deliverable and its notified_at alone', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        vi.setSystemTime(new Date(T0 + 2 * DAY));
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(RADON));
        await db.insert(schema.reportVersions).values([version('v-p', PRIMARY, 1), version('v-r', RADON, 2)]);
        const primaryStamp = await notifiedAt(PRIMARY);
        const radonStamp = await notifiedAt(RADON);
        const logs = await notificationCount();

        // Only RADON is reopened; PRIMARY stays published.
        await reopen(RADON);
        vi.setSystemTime(new Date(T0 + 4 * DAY));
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(RADON, false));
        expect(await notificationCount()).toBe(logs);
        expect((await notifiedAt(RADON))?.getTime()).toBe(radonStamp?.getTime());
        expect((await notifiedAt(PRIMARY))?.getTime()).toBe(primaryStamp?.getTime());

        // Ticked: only RADON is stamped, PRIMARY is still untouched.
        await reopen(RADON);
        vi.setSystemTime(new Date(T0 + 6 * DAY));
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(RADON, true));
        expect(await notificationCount()).toBeGreaterThan(logs);
        expect((await notifiedAt(RADON))?.getTime()).toBe(T0 + 6 * DAY);
        expect((await notifiedAt(PRIMARY))?.getTime()).toBe(primaryStamp?.getTime());
    });
});
