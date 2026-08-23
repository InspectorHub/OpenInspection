/**
 * Account export + soft-delete service tests.
 *
 * exportAccount: returns the calling user's row + agent_tenant_links + the
 * inspections they ran. Memberships + inspections may be empty arrays for a
 * fresh account.
 *
 * softDeleteAccount: rejects when confirmEmail does not match, stamps
 * users.deletedAt when it does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { exportAccount, softDeleteAccount } from '../../../server/services/account.service';
import { createTestDb, setupSchema } from '../db';
import { MockKV } from '../mocks';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-0000000000a1';
const AGENT_ID = '00000000-0000-0000-0000-0000000000a2';

// Distinctive sentinels: the negative assertions below search the SERIALIZED
// bundle for these literals, not just for a key name. A secret that survives
// nested inside some other field is still an exported secret, and a key-only
// assertion would call that green.
const PASSWORD_HASH = 'pbkdf2-sha256$100000$SENTINEL-PWHASH-DO-NOT-EXPORT';
const TOTP_SECRET = 'SENTINELTOTPSECRETJBSWY3DPEHPK3PXP';
const TOTP_RECOVERY_CODES = '["SENTINEL-RECOVERY-CODE-HASH-1","SENTINEL-RECOVERY-CODE-HASH-2"]';

describe('exportAccount', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_B, slug: 't2', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'a@x.com', passwordHash: PASSWORD_HASH,
            name: 'Ada Lovelace', phone: '+15550100', role: 'owner', createdAt: new Date(),
            totpSecret: TOTP_SECRET, totpEnabled: true, totpRecoveryCodes: TOTP_RECOVERY_CODES,
        });
    });

    it('returns identity + empty membership/inspection arrays when no data', async () => {
        const result = await exportAccount(testDb as any, USER_ID);
        expect((result.identity as Record<string, unknown>).id).toBe(USER_ID);
        expect(result.memberships).toEqual([]);
        expect(result.inspections).toEqual([]);
        expect(result.exportedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    // The defect this pair was written for: `exportAccount` opened with a star
    // select on `users` and handed the whole row back, so the caller's own
    // download carried their password hash, their TOTP seed and their recovery
    // code hashes. Own-data, so not a cross-user leak — but a TOTP seed is a
    // LIVE second factor, and these blobs travel (Downloads, cloud sync,
    // support tickets).
    it('never exports the caller password hash, TOTP secret or TOTP recovery codes', async () => {
        const result = await exportAccount(testDb as any, USER_ID);
        const identity = result.identity as Record<string, unknown>;

        expect(identity).not.toHaveProperty('passwordHash');
        expect(identity).not.toHaveProperty('totpSecret');
        expect(identity).not.toHaveProperty('totpRecoveryCodes');

        // Whole-bundle sweep: the value must not have escaped through any other
        // field, at any depth.
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(PASSWORD_HASH);
        expect(serialized).not.toContain(TOTP_SECRET);
        expect(serialized).not.toContain('SENTINEL-RECOVERY-CODE-HASH-1');
    });

    // Binds the behaviour to the classification: the three fields are not merely
    // absent, the export SAYS it withheld them and why. Absence alone is also
    // what a bug that dropped the whole row would produce.
    it('names the withheld credentials and the reason for each', () => {
        return exportAccount(testDb as any, USER_ID).then((result) => {
            const fields = result.identityWithheld.map((w) => w.field).sort();
            expect(fields).toEqual(['passwordHash', 'totpRecoveryCodes', 'totpSecret']);
            for (const w of result.identityWithheld) {
                expect(w.reason).toMatch(/credential/i);
            }
        });
    });

    // The positive control for the assertion above. Returning `{}` would satisfy
    // every `not.toContain` on the planet while UNDER-DISCLOSING on a
    // subject-access request, which is its own compliance failure — so the same
    // export has to be shown still carrying the ordinary personal fields, read
    // off what `exportAccount` actually returned rather than off a fixture.
    it('still exports the ordinary personal fields (positive control)', async () => {
        const result = await exportAccount(testDb as any, USER_ID);
        const identity = result.identity as Record<string, unknown>;

        expect(identity.id).toBe(USER_ID);
        expect(identity.email).toBe('a@x.com');
        expect(identity.name).toBe('Ada Lovelace');
        expect(identity.phone).toBe('+15550100');
        expect(identity.role).toBe('owner');
        expect(identity.tenantId).toBe(TENANT);
        expect(identity.createdAt).toBeTruthy();
        // The FACT of 2FA is the subject's own data and stays; only the seed goes.
        expect(identity.totpEnabled).toBe(true);
    });

    it('returns bound-contact memberships scoped to this user', async () => {
        await testDb.insert(schema.users).values({
            id: AGENT_ID, tenantId: TENANT, email: 'agent@x.com', passwordHash: 'x', role: 'agent', createdAt: new Date(),
        });
        await testDb.insert(schema.contacts).values({
            id: 'link-1', tenantId: TENANT_B, type: 'agent', name: 'A', email: 'a@x.test', agentUserId: USER_ID, agentLinkedAt: new Date(), createdAt: new Date(),
        });
        // unrelated link for another agent — must NOT appear
        await testDb.insert(schema.contacts).values({
            id: 'link-2', tenantId: TENANT, type: 'agent', name: 'B', email: 'b@x.test', agentUserId: AGENT_ID, agentLinkedAt: new Date(), createdAt: new Date(),
        });
        const result = await exportAccount(testDb as any, USER_ID);
        expect(result.memberships).toHaveLength(1);
        expect((result.memberships[0] as any).id).toBe('link-1');
    });

    it('returns inspections the user authored as inspector', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'i-1', tenantId: TENANT, inspectorId: USER_ID, propertyAddress: '1 St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        // unrelated inspection — different inspector
        await testDb.insert(schema.inspections).values({
            id: 'i-2', tenantId: TENANT, propertyAddress: '2 St',
            date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        const result = await exportAccount(testDb as any, USER_ID);
        expect(result.inspections).toHaveLength(1);
        expect((result.inspections[0] as any).id).toBe('i-1');
    });
});

describe('softDeleteAccount', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'a@x.com', passwordHash: 'x', role: 'owner', createdAt: new Date(),
        });
    });

    it('marks deletedAt and returns identityId on email match', async () => {
        const result = await softDeleteAccount(testDb as any, USER_ID, 'a@x.com');
        expect(result.identityId).toBe(USER_ID);
        expect(result.deletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, USER_ID)).get();
        expect(row?.deletedAt).toBeTruthy();
    });

    it('throws when confirmEmail does not match', async () => {
        await expect(softDeleteAccount(testDb as any, USER_ID, 'wrong@x.com'))
            .rejects.toThrow(/email/i);
        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, USER_ID)).get();
        expect(row?.deletedAt).toBeFalsy();
    });

    it('throws when identity does not exist', async () => {
        await expect(softDeleteAccount(testDb as any, 'nonexistent-id', 'a@x.com'))
            .rejects.toThrow(/not found/i);
    });

    it('writes a pwchanged:{userId} KV invalidation marker on self-delete (Fix 2)', async () => {
        const kv = new MockKV();
        await softDeleteAccount(testDb as any, USER_ID, 'a@x.com', kv as any);

        expect(kv.put).toHaveBeenCalledWith(
            `pwchanged:${USER_ID}`,
            expect.any(String),
            expect.objectContaining({ expirationTtl: 90000 }),
        );
    });

    it('does not write a KV marker when no kv binding is supplied (standalone-safe)', async () => {
        // Must not throw when kv is omitted — the call is optional-chained.
        await expect(softDeleteAccount(testDb as any, USER_ID, 'a@x.com')).resolves.toBeDefined();
    });

    it('still soft-deletes even when the KV write fails (fail-open, same discipline as team.service)', async () => {
        const throwingKv = {
            put: vi.fn().mockRejectedValue(new Error('KV unavailable')),
        };
        await expect(softDeleteAccount(testDb as any, USER_ID, 'a@x.com', throwingKv as any)).resolves.toBeDefined();
        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, USER_ID)).get();
        expect(row?.deletedAt).toBeTruthy();
    });

    it('does not write the KV marker when confirmEmail mismatches (delete never happened)', async () => {
        const kv = new MockKV();
        await expect(softDeleteAccount(testDb as any, USER_ID, 'wrong@x.com', kv as any)).rejects.toThrow();
        expect(kv.put).not.toHaveBeenCalled();
    });
});
