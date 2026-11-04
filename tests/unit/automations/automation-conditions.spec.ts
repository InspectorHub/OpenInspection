import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
import { AutomationService } from '../../../server/services/automation.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const TENANT = '00000000-0000-0000-0000-000000000001';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;
let db: BetterSQLite3Database<typeof schema>;
let svc: AutomationService;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    testD1.use(db);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
    svc = new AutomationService(testD1.binding);
});

describe('AutomationService create/update — conditions + channels (Track J/L)', () => {
    it('serializes conditions to JSON and defaults channels to email-only', async () => {
        const row = await svc.create(TENANT, {
            name: 'Follow-up', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 1440,
            conditions: { requirePaid: true, serviceIds: ['svc-1'] },
        });
        // Track L (Part A) — channels parsed on output; conditions stays a JSON string.
        expect(row.channels).toEqual(['email']);
        expect(JSON.parse(row.conditions!)).toEqual({ requirePaid: true, serviceIds: ['svc-1'] });
    });

    it('update can clear conditions and change channels', async () => {
        const created = await svc.create(TENANT, {
            name: 'R', trigger: 'report.published', recipientKind: 'role', recipientRoleProfileId: roleProfileId('client'),
            delayMinutes: 0,
            conditions: { requireSigned: true },
        });
        const updated = await svc.update(TENANT, created.id, {
            conditions: null, channels: ['email', 'sms'],
        });
        expect(updated.conditions).toBeNull();
        expect(updated.channels).toEqual(['email', 'sms']);
    });
});

