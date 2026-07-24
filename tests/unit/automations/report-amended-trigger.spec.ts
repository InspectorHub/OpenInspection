import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { resolvePublishTrigger } from '../../../server/services/inspection/shared';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const INSPECTION = 'insp-1';

let db: BetterSQLite3Database<typeof schema>;

async function seedVersion(tenantId: string, inspectionId: string, versionNumber: number) {
    await db.insert(schema.reportVersions).values({
        id:            `rv-${tenantId}-${inspectionId}-${versionNumber}`,
        tenantId,
        inspectionId,
        versionNumber,
        snapshotJson:  '{}',
        publishedAt:   new Date(),
        publishedBy:   'user-1',
    } as never);
}

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
});

describe('resolvePublishTrigger — first publish vs amendment (report.amended)', () => {
    it('fires report.published when no prior version exists (first publish)', async () => {
        const trigger = await resolvePublishTrigger({} as D1Database, TENANT, INSPECTION);
        expect(trigger).toBe('report.published');
    });

    it('fires report.amended once a prior version row exists (re-publish)', async () => {
        await seedVersion(TENANT, INSPECTION, 1);
        const trigger = await resolvePublishTrigger({} as D1Database, TENANT, INSPECTION);
        expect(trigger).toBe('report.amended');
    });

    it('is tenant + inspection scoped — another tenant/inspection version does not flip it', async () => {
        // A version under a different tenant, and one under a different inspection
        // in this tenant, must not make THIS inspection look amended.
        await seedVersion(OTHER_TENANT, INSPECTION, 1);
        await seedVersion(TENANT, 'insp-other', 1);
        const trigger = await resolvePublishTrigger({} as D1Database, TENANT, INSPECTION);
        expect(trigger).toBe('report.published');
    });
});
