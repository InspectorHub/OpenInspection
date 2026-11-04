import { describe, it, expect, beforeEach } from 'vitest';
import { TeamService } from '../../../server/services/team.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

/**
 * F66 layer 1 — `getMembers` must PROJECT `users.last_active_at`.
 *
 * The /team page has a LAST ACTIVE column; the middleware writes that column on
 * every authenticated request and the compliance manifests call it the
 * seat-accounting signal. The projection omitted it, so the only query feeding
 * that column could not have answered it and every row rendered an em dash.
 *
 * The discriminating assertion is `toEqual(ACTIVE_AT)` on a row whose column is
 * populated. A presence-only check (`'lastActiveAt' in row`) would have passed
 * before the fix for neither the right nor a stable reason, and a null-check
 * would pass on a projection that simply never selected it.
 */
const TENANT = '11111111-1111-1111-1111-1111111111a1';
const ACTIVE_AT = new Date('2026-09-10T06:05:37.000Z');

describe('TeamService.getMembers — last_active_at reaches the response', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: TeamService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        testD1.use(db);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values([
            {
                id: 'u-owner', tenantId: TENANT, email: 'owner@a.test', name: 'Owner',
                role: 'owner', passwordHash: 'x', createdAt: new Date(), lastActiveAt: ACTIVE_AT,
            },
            {
                id: 'u-new', tenantId: TENANT, email: 'new@a.test', name: 'Newcomer',
                role: 'inspector', passwordHash: 'x', createdAt: new Date(),
            },
        ]);
        svc = new TeamService(testD1.binding);
    });

    it('carries the stored timestamp for a member who has been active', async () => {
        const { activeUsers } = await svc.getMembers(TENANT);
        const owner = activeUsers.find((u) => u.id === 'u-owner');
        expect(owner).toBeDefined();
        expect(owner?.lastActiveAt).toEqual(ACTIVE_AT);
    });

    it('carries null — not a missing key — for a member who never made a request', async () => {
        const { activeUsers } = await svc.getMembers(TENANT);
        const newcomer = activeUsers.find((u) => u.id === 'u-new');
        expect(newcomer).toBeDefined();
        // Positive control for the negative case: the key must EXIST and be null,
        // which is what distinguishes "nothing recorded" from "never selected".
        expect(newcomer && 'lastActiveAt' in newcomer).toBe(true);
        expect(newcomer?.lastActiveAt).toBeNull();
    });
});
