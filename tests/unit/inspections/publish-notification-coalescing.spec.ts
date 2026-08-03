/**
 * One order, several reports — but not several "your report is ready" emails.
 *
 * Two things had to change together here, and each is invisible on its own. The
 * `report.published` dedup key used to name only the INSPECTION, so the radon
 * report's first publish looked like a retry of the standard report's and was
 * silently dropped — for ever, not for a window. Making the key per-report fixes
 * that and immediately creates the opposite problem: two documents finished in
 * one sitting now cost the client two emails. The coalescing window is what
 * separates "same delivery" from "genuinely later".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import {
    REPORT_NOTIFY_COALESCE_WINDOW_MS,
    shouldCoalesceNotification,
} from '../../../server/lib/inspection/report-notifications';

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

const publishOptions = (reportId: string) => ({
    theme: 'modern', notifyClient: true, notifyAgent: true,
    requireSignature: false, requirePayment: false, reportId,
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
        id: TENANT, name: 'Coalesce Co', slug: 'coalesce-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(T0),
    } as never);
    await seedRoleProfiles(db, TENANT, new Date(T0));
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

    await seedReport(PRIMARY, 'primary', 'Standard Home Inspection', 0);
    await seedReport(SEWER, 'ancillary', 'Sewer Scope', 1);
    await seedReport(RADON, 'ancillary', 'Radon Testing', 2);

    inspections = new InspectionService(
        {} as D1Database, undefined, new ScopedDB(db as never, TENANT));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('publish — one notification per delivery, not per document', () => {
    it('sends one notification for two reports published in the same minute', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        const afterFirst = await notificationCount();
        expect(afterFirst, 'the first publish must actually notify someone').toBeGreaterThan(0);

        vi.setSystemTime(new Date(T0 + MINUTE));
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(SEWER));

        // A standard inspection and a sewer scope finished the same afternoon
        // must not cost the client two emails.
        expect(await notificationCount()).toBe(afterFirst);
        expect(await notifiedAt(PRIMARY)).not.toBeNull();
        expect(await notifiedAt(SEWER)).toBeNull();
        // Coalescing suppresses the ANNOUNCEMENT, never the delivery.
        const sewer = await db.select().from(schema.reports)
            .where(eq(schema.reports.id, SEWER)).get();
        expect(sewer!.status).toBe('published');
        expect(sewer!.publishedAt).not.toBeNull();
    });

    it('sends a separate notification for a report published two days later', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(PRIMARY));
        const afterFirst = await notificationCount();

        vi.setSystemTime(new Date(T0 + 2 * DAY));
        await inspections.publishInspection(INSPECTION, TENANT, publishOptions(RADON));

        // Radon is genuinely later, and announcing itself is the whole reason
        // the client waited.
        expect(await notificationCount()).toBeGreaterThan(afterFirst);
        expect(await notifiedAt(RADON)).not.toBeNull();
    });

    it('publishing the primary with no reportId still stamps the primary', async () => {
        await inspections.publishInspection(INSPECTION, TENANT, {
            theme: 'modern', notifyClient: true, notifyAgent: true,
            requireSignature: false, requirePayment: false,
        });

        expect(await notifiedAt(PRIMARY)).not.toBeNull();
        expect(await notifiedAt(SEWER)).toBeNull();
    });

    it('refuses a report id belonging to another order', async () => {
        await db.insert(schema.inspections).values({
            id: 'insp-other', tenantId: TENANT, propertyAddress: '1 Elsewhere',
            date: '2026-08-03', status: 'completed', reportStatus: 'in_progress',
            paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false,
            createdAt: new Date(T0),
        } as never);
        await db.insert(schema.reports).values({
            id: 'rpt-elsewhere', tenantId: TENANT, inspectionId: 'insp-other', kind: 'primary',
            inspectionServiceId: null, templateId: null, title: 'Someone Else',
            status: 'in_progress', createdAt: new Date(T0), sortOrder: 0,
        } as never);

        await expect(inspections.publishInspection(
            INSPECTION, TENANT, publishOptions('rpt-elsewhere'))).rejects.toThrow();
    });
});

describe('the coalescing window itself', () => {
    it('treats a first-ever delivery as not coalesced', () => {
        expect(shouldCoalesceNotification(null, T0)).toBe(false);
    });

    it('coalesces inside the window and announces outside it', () => {
        expect(shouldCoalesceNotification(T0, T0 + REPORT_NOTIFY_COALESCE_WINDOW_MS)).toBe(true);
        expect(shouldCoalesceNotification(T0, T0 + REPORT_NOTIFY_COALESCE_WINDOW_MS + 1)).toBe(false);
    });

    it('does not coalesce on a stamp from the future', () => {
        // Clock skew is not evidence of a recent delivery, and treating it as
        // such drops a real announcement silently.
        expect(shouldCoalesceNotification(T0 + MINUTE, T0)).toBe(false);
    });
});
