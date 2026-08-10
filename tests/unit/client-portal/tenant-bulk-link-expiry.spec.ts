/**
 * IA-36 ⑥ — acting on the report links that ALREADY exist, tenant-wide.
 *
 * The setting alone is future-only (covered in portal-access-lifecycle.spec).
 * This file covers the separate, explicitly-confirmed verb that reaches the
 * backlog, and the one property the UI depends on being true:
 *
 *   the number rendered into the button == the number of rows changed.
 *
 * The button says "Expire 47 links". If the count and the update ever used
 * different predicates, that sentence becomes a lie about the blast radius of
 * a destructive action — which is the failure mode IA-36 exists to prevent, so
 * it gets a test rather than a comment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000e1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000e2';
const JWT = 'unit-test-jwt-secret';
const DAY = 86_400_000;

let testDb: BetterSQLite3Database<typeof schema>;
let svc: PortalAccessService;

/** Mint a link for a distinct (inspection, recipient) pair. */
async function mint(tenantId: string, n: number): Promise<void> {
    await svc.issueToken({
        tenantId,
        inspectionId: `22222222-2222-2222-2222-2222222222${String(n).padStart(2, '0')}`,
        recipientEmail: `buyer${n}@example.com`,
    });
}

function allRows(tenantId: string) {
    return testDb.select().from(schema.inspectionAccessTokens)
        .where(eq(schema.inspectionAccessTokens.tenantId, tenantId)).all();
}

beforeEach(async () => {
    const fix = createTestDb();
    testDb = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    for (const id of [TENANT, OTHER_TENANT]) {
        await testDb.insert(schema.tenants).values({
            id, name: 'Acme', slug: `acme-${id.slice(-2)}`, status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(testDb), id);
    }
    svc = new PortalAccessService({} as D1Database, { jwtSecret: JWT });
});

describe('the count is the blast radius', () => {
    it('counts every open-ended link', async () => {
        for (let i = 0; i < 3; i++) await mint(TENANT, i);
        expect(await svc.countLiveLinksForTenant(TENANT)).toBe(3);
    });

    it('returns exactly what it changed', async () => {
        for (let i = 0; i < 4; i++) await mint(TENANT, i);
        const affected = await svc.setExpiryForTenant(TENANT, Date.now() + 30 * DAY);
        expect(affected).toBe(4);
        expect(allRows(TENANT).every((r) => r.expiresAt != null)).toBe(true);
    });

    it('never counts another tenant\'s links, and never touches them', async () => {
        await mint(TENANT, 1);
        await mint(OTHER_TENANT, 2);
        expect(await svc.countLiveLinksForTenant(TENANT)).toBe(1);
        await svc.setExpiryForTenant(TENANT, Date.now() + 30 * DAY);
        expect(allRows(OTHER_TENANT)[0].expiresAt).toBeNull();
    });
});

describe('already-dead links stay dead', () => {
    it('excludes revoked links from the count', async () => {
        await mint(TENANT, 1);
        await mint(TENANT, 2);
        await testDb.update(schema.inspectionAccessTokens)
            .set({ revokedAt: new Date() })
            .where(eq(schema.inspectionAccessTokens.recipientEmail, 'buyer1@example.com'));
        expect(await svc.countLiveLinksForTenant(TENANT)).toBe(1);
    });

    it('a bulk lift does not un-revoke a revoked link', async () => {
        await mint(TENANT, 1);
        await testDb.update(schema.inspectionAccessTokens)
            .set({ revokedAt: new Date(), expiresAt: new Date(Date.now() + DAY) })
            .where(eq(schema.inspectionAccessTokens.recipientEmail, 'buyer1@example.com'));

        const affected = await svc.setExpiryForTenant(TENANT, null);

        expect(affected).toBe(0);
        const r = allRows(TENANT)[0];
        expect(r.revokedAt).not.toBeNull();
        // Its expiry was left alone too — the row was outside the predicate,
        // not merely re-dated and then still dead for a second reason.
        expect(r.expiresAt).not.toBeNull();
    });

    it('a bulk lift does not resurrect an already-expired link', async () => {
        await mint(TENANT, 1);
        await mint(TENANT, 2);
        await testDb.update(schema.inspectionAccessTokens)
            .set({ expiresAt: new Date(Date.now() - DAY) })
            .where(eq(schema.inspectionAccessTokens.recipientEmail, 'buyer1@example.com'));

        // "Never expire" applied to the backlog. The dead link must NOT come
        // back: handing a URL that already stopped working back to whoever
        // still has it in an inbox is not something anyone asked for.
        const affected = await svc.setExpiryForTenant(TENANT, null);

        expect(affected).toBe(1);
        const dead = allRows(TENANT).find((r) => r.recipientEmail === 'buyer1@example.com');
        expect(dead?.expiresAt).not.toBeNull();
        const live = allRows(TENANT).find((r) => r.recipientEmail === 'buyer2@example.com');
        expect(live?.expiresAt).toBeNull();
    });

    it('shortening the policy does not re-date an already-expired link either', async () => {
        await mint(TENANT, 1);
        const longAgo = new Date(Date.now() - 10 * DAY);
        await testDb.update(schema.inspectionAccessTokens)
            .set({ expiresAt: longAgo })
            .where(eq(schema.inspectionAccessTokens.recipientEmail, 'buyer1@example.com'));

        expect(await svc.setExpiryForTenant(TENANT, Date.now() + 30 * DAY)).toBe(0);
        expect(allRows(TENANT)[0].expiresAt?.getTime()).toBe(longAgo.getTime());
    });
});
