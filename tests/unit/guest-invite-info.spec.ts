import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GuestInviteService } from '../../server/services/guest-invite.service';
import { createTestDb, setupSchema } from './db';
import { guestInvites, tenants } from '../../server/lib/db/schema';

// In-memory SQLite for the drizzle d1 adapter (same pattern as auth.service.spec).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

/**
 * C-10 ③-B — GuestInviteService.getInviteInfo backs the /guest-join preview
 * (workspace name + role + expiry). guest_invites carries no email/inspection,
 * so the page shows the workspace + role the invite grants, not inspection info.
 */
describe('GuestInviteService.getInviteInfo — ③-B', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let svc: GuestInviteService; let testDb: any; let sqlite: any;
    const future = Math.floor(Date.now() / 1000) + 100_000;
    const past = Math.floor(Date.now() / 1000) - 100;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(tenants).values({ id: 't1', name: 'Acme Inspections', slug: 'acme', createdAt: new Date() });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new GuestInviteService({} as any);
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('returns {workspaceName, role, expiresAt} for a live invite', async () => {
        await testDb.insert(guestInvites).values({ id: 'g1', tenantId: 't1', token: 'tok', role: 'specialist', durationSeconds: 86400, expiresAt: future, createdBy: 'u1' });
        expect(await svc.getInviteInfo('tok')).toEqual({ workspaceName: 'Acme Inspections', role: 'specialist', expiresAt: future });
    });

    it('returns null for an unknown token', async () => {
        expect(await svc.getInviteInfo('nope')).toBeNull();
    });

    it('returns null for an expired invite', async () => {
        await testDb.insert(guestInvites).values({ id: 'g2', tenantId: 't1', token: 'exp', role: 'lead', durationSeconds: 1, expiresAt: past, createdBy: 'u1' });
        expect(await svc.getInviteInfo('exp')).toBeNull();
    });

    it('returns null for an already-claimed invite', async () => {
        await testDb.insert(guestInvites).values({ id: 'g3', tenantId: 't1', token: 'clm', role: 'lead', durationSeconds: 86400, expiresAt: future, createdBy: 'u1', claimedByUserId: 'u9', claimedAt: past });
        expect(await svc.getInviteInfo('clm')).toBeNull();
    });
});
