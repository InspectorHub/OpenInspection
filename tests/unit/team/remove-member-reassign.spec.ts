/**
 * TeamService.removeMember -- what happens to the member's inspections.
 *
 * Removal soft-deletes the user, which used to leave every inspection they
 * were assigned to pointing at a person who can no longer sign in. Removal now
 * has to say what becomes of the OPEN ones (reassign, or explicitly unassign),
 * and must never touch finished work: a completed or published inspection keeps
 * the inspector it was done by, because that is the record.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { TeamService } from '../../../server/services/team.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { AppError } from '../../../server/lib/errors';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER_TENANT = '22222222-2222-2222-2222-2222222222b2';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const LEAVER = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const HEIR = 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
const GONE = 'cccccccc-cccc-cccc-cccc-ccccccccccc3';
const AGENT = 'cccccccc-cccc-cccc-cccc-ccccccccccc4';
const STRANGER = 'dddddddd-dddd-dddd-dddd-ddddddddddd1';

type Db = BetterSQLite3Database<typeof schema>;

const user = (id: string, role: 'owner' | 'inspector' | 'agent', tenantId = TENANT, deletedAt?: Date) =>
    ({ id, tenantId, email: `${id}@t.test`, name: id, role, passwordHash: 'x', createdAt: new Date(), ...(deletedAt ? { deletedAt } : {}) });

const insp = (id: string, inspectorId: string | null, status: 'scheduled' | 'completed' | 'cancelled', reportStatus: 'in_progress' | 'published' = 'in_progress') =>
    ({ id, tenantId: TENANT, inspectorId, propertyAddress: id, date: '2026-11-01', status, reportStatus, createdAt: new Date() });

const link = (inspectionId: string, userId: string, role: 'lead' | 'helper') =>
    ({ inspectionId, userId, tenantId: TENANT, role, createdAt: new Date() });

async function seed(db: Db) {
    await db.insert(schema.tenants).values([
        { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: OTHER_TENANT, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await db.insert(schema.users).values([
        user(OWNER, 'owner'), user(LEAVER, 'inspector'), user(HEIR, 'inspector'),
        user(GONE, 'inspector', TENANT, new Date()), user(AGENT, 'agent'), user(STRANGER, 'inspector', OTHER_TENANT),
    ]);
    await db.insert(schema.inspections).values([
        insp('open-lead', LEAVER, 'scheduled'),
        insp('open-helper', OWNER, 'scheduled'),
        insp('open-both', LEAVER, 'scheduled'),
        insp('done', LEAVER, 'completed', 'published'),
        insp('cancelled', LEAVER, 'cancelled'),
        insp('theirs', OWNER, 'scheduled'),
    ]);
    await db.insert(schema.inspectionInspectors).values([
        link('open-lead', LEAVER, 'lead'),
        link('open-helper', OWNER, 'lead'), link('open-helper', LEAVER, 'helper'),
        link('open-both', LEAVER, 'lead'), link('open-both', HEIR, 'helper'),
        link('theirs', OWNER, 'lead'),
    ]);
}

const lead = async (db: Db, id: string) =>
    (await db.select({ u: schema.inspectionInspectors.userId }).from(schema.inspectionInspectors)
        .where(and(eq(schema.inspectionInspectors.inspectionId, id), eq(schema.inspectionInspectors.role, 'lead'))).get())?.u ?? null;
const helpers = async (db: Db, id: string) =>
    (await db.select({ u: schema.inspectionInspectors.userId }).from(schema.inspectionInspectors)
        .where(and(eq(schema.inspectionInspectors.inspectionId, id), eq(schema.inspectionInspectors.role, 'helper'))).all()).map(r => r.u).sort();
const column = async (db: Db, id: string) =>
    (await db.select({ i: schema.inspections.inspectorId }).from(schema.inspections).where(eq(schema.inspections.id, id)).get())?.i;
const removed = async (db: Db, id: string) =>
    (await db.select({ d: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, id)).get())?.d != null;

describe('TeamService.removeMember and the removed member\'s inspections', () => {
    let db: Db;
    let svc: TeamService;
    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seed(db);
        svc = new TeamService({} as D1Database);
    });

    it('refuses with a typed 409 carrying the count, and changes nothing', async () => {
        const err = await svc.removeMember(TENANT, LEAVER, OWNER, 'owner').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(409);
        expect((err as AppError).code).toBe('MEMBER_HAS_OPEN_INSPECTIONS');
        expect((err as AppError).details).toEqual({ openInspections: 3 });
        expect(await removed(db, LEAVER)).toBe(false);
        expect(await column(db, 'open-lead')).toBe(LEAVER);
    });

    it('reassigns open inspections to the chosen member and soft-deletes the leaver', async () => {
        const out = await svc.removeMember(TENANT, LEAVER, OWNER, 'owner', { reassignTo: HEIR });
        expect(out).toMatchObject({ reassigned: 3, unassigned: 0 });
        expect(await removed(db, LEAVER)).toBe(true);
        expect(await lead(db, 'open-lead')).toBe(HEIR);
        expect(await column(db, 'open-lead')).toBe(HEIR);
        // The leaver was a helper: the heir takes the helper seat, the lead is untouched.
        expect(await lead(db, 'open-helper')).toBe(OWNER);
        expect(await helpers(db, 'open-helper')).toEqual([HEIR]);
        // The heir was already a helper: promoted to lead, no duplicate seat.
        expect(await lead(db, 'open-both')).toBe(HEIR);
        expect(await helpers(db, 'open-both')).toEqual([]);
    });

    it('unassigns explicitly when asked', async () => {
        const out = await svc.removeMember(TENANT, LEAVER, OWNER, 'owner', { unassign: true });
        expect(out).toMatchObject({ reassigned: 0, unassigned: 3 });
        expect(await lead(db, 'open-lead')).toBeNull();
        expect(await column(db, 'open-lead')).toBeNull();
        expect(await helpers(db, 'open-helper')).toEqual([]);
        expect(await lead(db, 'open-helper')).toBe(OWNER);
    });

    it('leaves completed, published and cancelled inspections with their historical inspector', async () => {
        await svc.removeMember(TENANT, LEAVER, OWNER, 'owner', { reassignTo: HEIR });
        expect(await column(db, 'done')).toBe(LEAVER);
        expect(await column(db, 'cancelled')).toBe(LEAVER);
        const rows = await db.select().from(schema.inspections).all();
        expect(rows).toHaveLength(6);
    });

    it('does not touch inspections that never involved the leaver (control)', async () => {
        await svc.removeMember(TENANT, LEAVER, OWNER, 'owner', { reassignTo: HEIR });
        expect(await lead(db, 'theirs')).toBe(OWNER);
        expect(await column(db, 'theirs')).toBe(OWNER);
    });

    it('removes a member with no open inspections without any choice (control)', async () => {
        await svc.removeMember(TENANT, HEIR, OWNER, 'owner').catch(() => {});
        // HEIR is a helper on an open inspection, so that one needs a choice too.
        expect(await removed(db, HEIR)).toBe(false);
        await db.delete(schema.inspectionInspectors).where(eq(schema.inspectionInspectors.userId, HEIR));
        await svc.removeMember(TENANT, HEIR, OWNER, 'owner');
        expect(await removed(db, HEIR)).toBe(true);
    });

    it.each([
        ['a member of another company', STRANGER],
        ['an already removed member', GONE],
        ['an agent', AGENT],
        ['the member being removed', LEAVER],
        ['an id that does not exist', 'nope'],
    ])('refuses to reassign to %s and writes nothing', async (_label, target) => {
        const err = await svc.removeMember(TENANT, LEAVER, OWNER, 'owner', { reassignTo: target }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).status).toBe(400);
        expect(await removed(db, LEAVER)).toBe(false);
        expect(await column(db, 'open-lead')).toBe(LEAVER);
    });

    it('refuses reassignTo together with unassign', async () => {
        const err = await svc.removeMember(TENANT, LEAVER, OWNER, 'owner', { reassignTo: HEIR, unassign: true }).catch((e: unknown) => e);
        expect((err as AppError).status).toBe(400);
        expect(await removed(db, LEAVER)).toBe(false);
    });

    it('keeps the last-owner and self-removal protections', async () => {
        await expect(svc.removeMember(TENANT, OWNER, OWNER, 'owner', { unassign: true })).rejects.toThrow(/yourself/i);
        await db.insert(schema.users).values(user('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'owner'));
        await db.update(schema.users).set({ role: 'inspector' }).where(eq(schema.users.id, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'));
        // OWNER cannot be removed by a second owner-less caller: the last-owner rule still fires.
        await expect(svc.removeMember(TENANT, OWNER, LEAVER, 'owner', { unassign: true })).rejects.toThrow(/last owner/i);
    });
});
