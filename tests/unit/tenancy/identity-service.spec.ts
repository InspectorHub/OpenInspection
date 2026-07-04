/**
 * Design System 0520 subsystem E P4.1 — IdentityService TDD.
 *
 * Three behaviours under test (TDD-first):
 *   • list(primary) returns the snapshot rows associated with the
 *     primary user.
 *   • switchTo(primary, linked) issues a fresh ES256 JWT for the
 *     linked user, ONLY when the link row exists.
 *   • link({ primary, targetEmail }) inserts a row using the snapshot
 *     of the target's role + display name at link-time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { IdentityService } from '../../../server/services/identity.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Stub signJwt so the test doesn't need a real ES256 keyring. The
// service module imports it from jwt-keyring; we replace the function
// with a deterministic stub that echoes the payload as base64.
vi.mock('../../../server/lib/jwt-keyring', () => ({
    signJwt: vi.fn(async (payload: Record<string, unknown>) =>
        `eyJ${Buffer.from(JSON.stringify(payload)).toString('base64url')}.test.sig`,
    ),
}));

const TENANT_A   = '11111111-1111-1111-1111-1111111111e1';
const TENANT_B   = '22222222-2222-2222-2222-2222222222e2';
const PRIMARY    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaae0';
const LINKED     = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbe0';
const STRANGER   = 'cccccccc-cccc-cccc-cccc-cccccccccce0';

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'Acme A', slug: 'acme-a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, name: 'Acme B', slug: 'acme-b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.users).values([
        { id: PRIMARY,  tenantId: TENANT_A, email: 'u@a.test', passwordHash: 'x', role: 'admin',     createdAt: new Date() },
        { id: LINKED,   tenantId: TENANT_B, email: 'u@b.test', passwordHash: 'x', role: 'inspector', createdAt: new Date() },
        { id: STRANGER, tenantId: TENANT_B, email: 's@b.test', passwordHash: 'x', role: 'inspector', createdAt: new Date() },
    ]);
}

describe('IdentityService (subsystem E P4.1)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: IdentityService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seed(testDb);
        svc = new IdentityService({} as D1Database);
    });

    it('list returns empty before any link', async () => {
        const out = await svc.list(PRIMARY);
        expect(out).toEqual([]);
    });

    it('link snapshots role + tenantId + display name into the row', async () => {
        const created = await svc.link({ primaryUserId: PRIMARY, targetEmail: 'u@b.test' });
        expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

        const rows = await svc.list(PRIMARY);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            primaryUserId:     PRIMARY,
            linkedUserId:      LINKED,
            linkedTenantId:    TENANT_B,
            linkedRole:        'inspector',
            linkedDisplayName: 'u@b.test',
        });
    });

    it('link throws when target email is unknown', async () => {
        await expect(svc.link({ primaryUserId: PRIMARY, targetEmail: 'no@one' }))
            .rejects.toThrow(/target user not found/i);
    });

    it('switchTo returns ok + new ES256-formatted token when link exists', async () => {
        await svc.link({ primaryUserId: PRIMARY, targetEmail: 'u@b.test' });
        const out = await svc.switchTo(PRIMARY, LINKED, { keyring: {} as never });
        expect(out.kind).toBe('ok');
        if (out.kind === 'ok') {
            expect(out.newToken).toMatch(/^eyJ/);
            expect(out.redirectUrl).toBe('/inspections');
        }
    });

    it('switchTo returns forbidden when no link exists for that target', async () => {
        const out = await svc.switchTo(PRIMARY, STRANGER, { keyring: {} as never });
        expect(out.kind).toBe('forbidden');
    });

    it('switchTo returns forbidden when caller and target are unrelated entirely', async () => {
        const out = await svc.switchTo(PRIMARY, 'no-such-user', { keyring: {} as never });
        expect(out.kind).toBe('forbidden');
    });

    it('list is scoped per primary user (no cross-user leak)', async () => {
        await svc.link({ primaryUserId: PRIMARY, targetEmail: 'u@b.test' });
        const other = await svc.list(STRANGER);
        expect(other).toEqual([]);

        const primaryRows = await testDb.select().from(schema.userIdentityLinks)
            .where(eq(schema.userIdentityLinks.primaryUserId, PRIMARY)).all();
        expect(primaryRows).toHaveLength(1);
    });
});
