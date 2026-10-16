/**
 * The new-inspection wizard makes its creator the inspector. An office user
 * (staff) who books a job cannot inspect, so for them the job is left
 * unassigned unless a lead is named, and a named lead or helper must be someone
 * who can inspect. Each refusal is paired with a control that goes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { CreateInspectionFromWizardInput } from '../../../server/lib/validations/wizard.schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000cc';
const U = { inspector: 'u-inspector', lead: 'u-lead', staff: 'u-staff' } as const;

let db: BetterSQLite3Database<typeof schema>;
let svc: InspectionService;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'wiz', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values(
        (Object.entries(U) as Array<[string, string]>).map(([key, id]) => ({
            id, tenantId: TENANT, email: `${id}@x.test`, passwordHash: 'h',
            role: key === 'staff' ? key : 'inspector', createdAt: new Date(),
        })) as never,
    );
    svc = new InspectionService({} as D1Database, undefined, new ScopedDB(db as never, TENANT));
});

const wizard = (extra: Partial<CreateInspectionFromWizardInput> = {}): CreateInspectionFromWizardInput => ({
    property: { address: '1 Main Street' },
    services: ['general'],
    schedule: { date: '2026-09-01', startTime: '09:00', durationMinutes: 120 },
    teamMode: false,
    ...extra,
});

async function rosterOf(id: string) {
    return (await db.select().from(schema.inspectionInspectors).where(eq(schema.inspectionInspectors.inspectionId, id)).all())
        .map((r) => `${r.role}:${r.userId}`);
}
async function inspectorOf(id: string) {
    return (await db.select({ v: schema.inspections.inspectorId }).from(schema.inspections).where(eq(schema.inspections.id, id)).get())?.v ?? null;
}

describe('createFromWizard and who becomes the inspector', () => {
    it('an inspector who books a job is the inspector (control)', async () => {
        const { id } = await svc.createFromWizard(TENANT, U.inspector, wizard());
        expect(await inspectorOf(id)).toBe(U.inspector);
    });

    it('a creator who cannot inspect leaves the job unassigned, with no roster row', async () => {
        const { id } = await svc.createFromWizard(TENANT, null, wizard());
        expect(await inspectorOf(id)).toBeNull();
        expect(await rosterOf(id)).toEqual([]);
    });

    it('a creator who cannot inspect can still name a lead, and the lead is the one on the roster', async () => {
        const { id } = await svc.createFromWizard(TENANT, null, wizard({ teamMode: true, leadInspectorId: U.lead }));
        expect(await rosterOf(id)).toEqual([`lead:${U.lead}`]);
    });

    it('refuses a lead or helper who is staff, and creates nothing', async () => {
        for (const bad of [U.staff]) {
            await expect(svc.createFromWizard(TENANT, U.inspector, wizard({ teamMode: true, leadInspectorId: bad })))
                .rejects.toMatchObject({ status: 400 });
            await expect(svc.createFromWizard(TENANT, U.inspector, wizard({ teamMode: true, helperInspectorIds: [bad] })))
                .rejects.toMatchObject({ status: 400 });
        }
        expect(await db.select().from(schema.inspections).all()).toEqual([]);
    });

    it('accepts field-role helpers (control)', async () => {
        const { id } = await svc.createFromWizard(TENANT, U.inspector, wizard({ teamMode: true, helperInspectorIds: [U.lead] }));
        expect((await rosterOf(id)).sort()).toEqual([`helper:${U.lead}`, `lead:${U.inspector}`]);
    });
});
