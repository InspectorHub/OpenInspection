/**
 * A creator who can see only their own assignments stays on the roster of what
 * they create (team mode could otherwise leave them off it, and the inspection
 * would answer "not found" on the next request), and a client-generated id may
 * not take the name of a route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { CreateInspectionFromWizardInput } from '../../../server/lib/validations/wizard.schema';
import { CreateInspectionSchema } from '../../../server/lib/validations/inspection/crud';
import { RESERVED_INSPECTION_SEGMENTS } from '../../../server/lib/middleware/inspection-scope';
import { ALL_INSPECTIONS, type InspectionScope } from '../../../server/lib/inspection/visibility';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000dd';
const U = { me: 'u-me', lead: 'u-lead', other: 'u-other' } as const;
const RESTRICTED: InspectionScope = { kind: 'assigned', userId: U.me };

let db: BetterSQLite3Database<typeof schema>;
let svc: InspectionService;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    vi.mocked(mockDrizzle).mockReturnValue(db as never);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'cv', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values(
        Object.values(U).map((id) => ({
            id, tenantId: TENANT, email: `${id}@x.test`, passwordHash: 'h', role: 'inspector', createdAt: new Date(),
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
        .map((r) => `${r.role}:${r.userId}`).sort();
}

describe('createFromWizard keeps a restricted creator on the roster', () => {
    it('team mode with another lead and no helpers: the creator joins as a helper and can list the inspection', async () => {
        const { id } = await svc.createFromWizard(TENANT, U.me, wizard({ teamMode: true, leadInspectorId: U.lead, helperInspectorIds: [] }), RESTRICTED);
        expect(await rosterOf(id)).toEqual([`helper:${U.me}`, `lead:${U.lead}`].sort());
        const list = await svc.listInspections(TENANT, { limit: 10 }, RESTRICTED);
        expect(list.inspections.map(i => i.id)).toContain(id);
    });
    it('team mode with other helpers: the creator is added without displacing them', async () => {
        const { id } = await svc.createFromWizard(TENANT, U.me, wizard({ teamMode: true, leadInspectorId: U.lead, helperInspectorIds: [U.other] }), RESTRICTED);
        expect(await rosterOf(id)).toEqual([`helper:${U.me}`, `helper:${U.other}`, `lead:${U.lead}`].sort());
    });
    it('control: an unrestricted creator who names someone else is not added (their roster is theirs to choose)', async () => {
        const { id } = await svc.createFromWizard(TENANT, U.me, wizard({ teamMode: true, leadInspectorId: U.lead, helperInspectorIds: [] }), ALL_INSPECTIONS);
        expect(await rosterOf(id)).toEqual([`lead:${U.lead}`]);
    });
    it('control: a restricted creator who leads is not duplicated, and the non-team default is unchanged', async () => {
        const led = await svc.createFromWizard(TENANT, U.me, wizard({ teamMode: true, helperInspectorIds: [U.other] }), RESTRICTED);
        expect(await rosterOf(led.id)).toEqual([`helper:${U.other}`, `lead:${U.me}`].sort());
        const plain = await svc.createFromWizard(TENANT, U.me, wizard(), RESTRICTED);
        const rows = await rosterOf(plain.id);
        expect(rows.filter(r => r.endsWith(U.me)).length).toBeLessThanOrEqual(1);
        const list = await svc.listInspections(TENANT, { limit: 10 }, RESTRICTED);
        expect(list.inspections.map(i => i.id)).toEqual(expect.arrayContaining([led.id, plain.id]));
    });
});

describe('a client-generated id cannot take the name of a route', () => {
    const base = { propertyAddress: '12 Offline Lane, Anytown', templateId: 'tpl-offline', date: '2026-06-01T10:00:00.000Z' };
    const body = (id: string) => ({ id, ...base });
    it('rejects every reserved segment', () => {
        expect(RESERVED_INSPECTION_SEGMENTS.size).toBeGreaterThan(5);
        for (const id of RESERVED_INSPECTION_SEGMENTS) {
            expect(CreateInspectionSchema.safeParse(body(id)).success, id).toBe(false);
        }
    });
    it('accepts an ordinary id and a missing id (control)', () => {
        expect(CreateInspectionSchema.safeParse(body('550e8400-e29b-41d4-a716-446655440000')).success).toBe(true);
        expect(CreateInspectionSchema.safeParse(base).success).toBe(true);
    });
});
