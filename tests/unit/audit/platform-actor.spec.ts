/**
 * An audit row has to be able to say the platform did it.
 *
 * Until now every row named a subject id and nothing else, so an action taken
 * by somebody at the deployment operator — signed in as one of the workspace's
 * own administrators — produced a row indistinguishable from one that
 * administrator produced themselves. "Who touched this" had no answer.
 *
 * The answer is an ENUM, not a boolean. A boolean asks "was it us" and can say
 * nothing about the third case, which already exists in the data: a cron pass
 * or a queue consumer acting with no person behind it at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { auditFromContext, writeAuditLog } from '../../../server/lib/audit';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Context } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const TENANT_ADMIN = '00000000-0000-0000-0000-000000000010';
const PLATFORM_ADMIN_ID = 'pa-1';

/** The customer's own administrator, acting for themselves. */
function ctxAsTenantUser(): Context<HonoConfig> {
    return fakeContext(undefined);
}

/** Somebody at the platform, reaching the same route through a support session. */
function ctxAsPlatformStaff(platformAdminId: string): Context<HonoConfig> {
    return fakeContext({ platformAdminId, email: 'admin@inspectorhub.io' });
}

function fakeContext(platformActor: { platformAdminId: string; email: string } | undefined) {
    return {
        env: { DB: {} as D1Database },
        get: (key: string) => {
            if (key === 'tenantId') return TENANT;
            if (key === 'platformActor') return platformActor;
            return { sub: TENANT_ADMIN };
        },
        req: { header: () => undefined },
        get executionCtx(): never { throw new Error('no execution context'); },
    } as unknown as Context<HonoConfig>;
}

describe('an audit row records WHICH KIND of actor produced it', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function lastAuditRow() {
        const rows = await testDb.select().from(schema.auditLogs).all();
        return rows[rows.length - 1]!;
    }

    async function settle() {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('records a tenant user by default, unchanged', async () => {
        auditFromContext(ctxAsTenantUser(), 'migration.delivered', 'migration_batch', {});
        await settle();
        const row = await lastAuditRow();
        expect(row.actorKind).toBe('tenant_user');
        expect(row.platformActorId).toBeNull();
        // The subject id keeps meaning what it meant.
        expect(row.userId).toBe(TENANT_ADMIN);
    });

    it('records a platform actor when the seam carried one', async () => {
        auditFromContext(ctxAsPlatformStaff(PLATFORM_ADMIN_ID), 'migration.delivered', 'migration_batch', {});
        await settle();
        const row = await lastAuditRow();
        expect(row.actorKind).toBe('platform_staff');
        expect(row.platformActorId).toBe(PLATFORM_ADMIN_ID);
    });

    it('THE ASSERTION THIS EXISTS FOR — the two rows differ', async () => {
        // Today they do not. The same action by the customer's admin and by a
        // platform employee signed in as that admin produce identical rows, so
        // "who touched this file" has no answer. A test that only checked the
        // platform case would pass for an implementation that stamped every row
        // platform_staff, which is why both halves are asserted here together.
        auditFromContext(ctxAsTenantUser(), 'migration.delivered', 'migration_batch', {});
        await settle();
        const byTenant = await lastAuditRow();

        auditFromContext(ctxAsPlatformStaff(PLATFORM_ADMIN_ID), 'migration.delivered', 'migration_batch', {});
        await settle();
        const byPlatform = await lastAuditRow();

        expect(byPlatform.id).not.toBe(byTenant.id);
        expect(byPlatform.actorKind).not.toBe(byTenant.actorKind);
    });

    it("keeps the third case reachable — 'system' is a value a caller can write", async () => {
        // A cron pass and a queue consumer act with no person behind them. That
        // case is already in the data; a boolean would have had to file it under
        // one of the two human answers.
        writeAuditLog({
            db: {} as D1Database,
            tenantId: TENANT,
            action: 'migration.applied',
            entityType: 'migration_batch',
            actorKind: 'system',
        });
        await settle();
        const row = await lastAuditRow();
        expect(row.actorKind).toBe('system');
        expect(row.userId).toBeNull();
        expect(row.platformActorId).toBeNull();
    });
});
