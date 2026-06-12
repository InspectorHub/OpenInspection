/**
 * Design System 0520 subsystem C phase 6 — GuestInviteService.
 *
 * mint + claim + over-quota enforcement. Per spec amendment (no
 * per-guest billing), guests count against tenants.max_users on
 * successful claim; the service rejects with `over_quota` when the
 * tenant is already at quota.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { GuestInviteService } from '../../server/services/guest-invite.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { hashToken, deadTokenSentinel } from '../../server/lib/token-hash';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';

async function seedTenant(testDb: BetterSQLite3Database<typeof schema>, maxUsers = 5) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    // Core tenants table doesn't carry max_users (that lives on the portal
    // side — synced to core via M2M). For unit tests the service falls back
    // to a configurable cap; we pass maxUsers as the second arg to claim()
    // via the test fixture.
    return { maxUsers };
}

describe('GuestInviteService (subsystem C P6)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: GuestInviteService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seedTenant(testDb);
        svc = new GuestInviteService({} as D1Database);
    });

    it('mint returns token + future expiry', async () => {
        const out = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        expect(out.token).toMatch(/^[A-Za-z0-9_-]{30,}$/);
        expect(out.url).toContain(out.token);
        expect(out.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('claim returns over_quota when tenant at cap', async () => {
        const minted = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        const out = await svc.claim(minted.token, { name: 'G', email: 'g@x', password: 'pw01234567' }, { maxUsers: 0, enforceSeatQuota: true });
        expect(out.kind).toBe('over_quota');
    });

    it('claim creates user with role + expires_at when under quota', async () => {
        const minted = await svc.mint(TENANT, { role: 'specialist', durationSeconds: 3600, createdBy: 'u-admin' });
        const out = await svc.claim(minted.token, { name: 'G', email: 'g@x', password: 'pw01234567' }, { maxUsers: 10, enforceSeatQuota: true });
        expect(out.kind).toBe('ok');
        if (out.kind === 'ok') {
            const user = await testDb.select().from(schema.users).where(eq(schema.users.id, out.userId)).get();
            expect(user?.role).toBe('specialist');
            expect(user?.expiresAt).toBe(minted.expiresAt);
        }
    });

    it('claim returns not_found for unknown token', async () => {
        const out = await svc.claim('not-a-token', { name: 'G', email: 'g@x', password: 'pw01234567' }, { maxUsers: 10, enforceSeatQuota: true });
        expect(out.kind).toBe('not_found');
    });

    it('claim returns claimed when token already used', async () => {
        const minted = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        await svc.claim(minted.token, { name: 'A', email: 'a@x', password: 'pw01234567' }, { maxUsers: 10, enforceSeatQuota: true });
        const out = await svc.claim(minted.token, { name: 'B', email: 'b@x', password: 'pw01234567' }, { maxUsers: 10, enforceSeatQuota: true });
        expect(out.kind).toBe('claimed');
    });

    it('claim returns expired past expiry', async () => {
        const minted = await svc.mint(TENANT, { role: 'lead', durationSeconds: -1, createdBy: 'u-admin' });
        const out = await svc.claim(minted.token, { name: 'G', email: 'g@x', password: 'pw01234567' }, { maxUsers: 10, enforceSeatQuota: true });
        expect(out.kind).toBe('expired');
    });

    it('claim rejects short passwords (min length enforced)', async () => {
        const minted = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        const out = await svc.claim(minted.token, { name: 'G', email: 'g@x', password: 'short' }, { maxUsers: 10, enforceSeatQuota: true });
        expect(out.kind).toBe('invalid');
    });

    // ─── Track I-a — hash-at-rest (tier-1) ───────────────────────────────────
    it('(a) mint stores hash, NOT plaintext (legacy column is a sentinel)', async () => {
        const minted = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        const row = await testDb.select().from(schema.guestInvites).where(eq(schema.guestInvites.id, minted.id)).get();
        expect(row?.token).toBe(deadTokenSentinel(minted.id));
        expect(row?.token).not.toBe(minted.token);
        expect(row?.tokenHash).toBe(await hashToken(minted.token));
    });

    it('(b) presenting the plaintext resolves via the hash path (getInviteInfo + claim)', async () => {
        const minted = await svc.mint(TENANT, { role: 'specialist', durationSeconds: 3600, createdBy: 'u-admin' });
        const info = await svc.getInviteInfo(minted.token);
        expect(info?.role).toBe('specialist');
        const out = await svc.claim(minted.token, { name: 'G', email: 'g@x', password: 'pw01234567' }, { maxUsers: 10, enforceSeatQuota: true });
        expect(out.kind).toBe('ok');
    });

    it('(c) legacy plaintext row resolves AND is upgraded in place', async () => {
        const legacyToken = 'legacy-guest-plaintext-token-1234567890';
        const id = crypto.randomUUID();
        await testDb.insert(schema.guestInvites).values({
            id, tenantId: TENANT, token: legacyToken, role: 'office',
            durationSeconds: 86_400, expiresAt: Math.floor(Date.now() / 1000) + 3600,
            createdBy: 'u-admin', createdAt: new Date().toISOString(),
        });
        const info = await svc.getInviteInfo(legacyToken);
        expect(info?.role).toBe('office');
        const row = await testDb.select().from(schema.guestInvites).where(eq(schema.guestInvites.id, id)).get();
        expect(row?.tokenHash).toBe(await hashToken(legacyToken));
        expect(row?.token).toBe(deadTokenSentinel(id));
    });

    it('resolveTenantForToken resolves a hashed token to tenant + cap', async () => {
        const minted = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        const resolved = await svc.resolveTenantForToken(minted.token);
        expect(resolved?.tenantId).toBe(TENANT);
        expect(typeof resolved?.maxUsers).toBe('number');
    });
});
