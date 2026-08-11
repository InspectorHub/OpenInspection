/**
 * Which company name an agent or a client sees.
 *
 * There is ONE name now. `tenants.name` — the container name — was dropped
 * after a backfill gave every tenant its own `tenant_configs.company_name`.
 * What survives is the property that column was really providing:
 * **this expression can never render empty.**
 *
 * That is why the fallback moved to `slug` rather than disappearing. `slug` is
 * NOT NULL and unique, so there is always something to show. A slug is a poor
 * name to put in front of a client; it is a far better one than a blank line in
 * an invite email, which is what a plain `company_name` read would produce for
 * a tenant whose config row is missing or blank.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { tenantDisplayName } from '../../../server/lib/tenant-display-name';

let db: BetterSQLite3Database<typeof schema>;

/** Read the display name the way every consumer does: LEFT JOIN + the rule. */
function readDisplayName(tenantId: string) {
    return db
        .select({ name: tenantDisplayName })
        .from(schema.tenants)
        .leftJoin(schema.tenantConfigs, eq(schema.tenantConfigs.tenantId, schema.tenants.id))
        .where(eq(schema.tenants.id, tenantId))
        .get();
}

async function seedTenant(id: string, slug: string, companyName?: string | null) {
    await db.insert(schema.tenants).values({
        id, slug, status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    if (companyName !== undefined) {
        await db.insert(schema.tenantConfigs).values({
            tenantId: id, companyName, updatedAt: new Date(),
        });
    }
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (vi.mocked(await import('drizzle-orm/d1')).drizzle as unknown as ReturnType<typeof vi.fn>)
        .mockReturnValue(db);
});

describe('tenantDisplayName', () => {
    it('shows the name the tenant set in its own settings', async () => {
        await seedTenant('t-set', 'important-new', 'OpenInspection');
        expect(readDisplayName('t-set')?.name).toBe('OpenInspection');
    });

    it('falls back to the slug when company_name is NULL', async () => {
        await seedTenant('t-null', 'acme-home-inspections', null);
        expect(readDisplayName('t-null')?.name).toBe('acme-home-inspections');
    });

    it('falls back when company_name is whitespace, not just when it is NULL', async () => {
        // "set to spaces" and "never set" are the same thing to a reader, and
        // only one of them is NULL — which is why the rule is NULLIF(TRIM(..)).
        await seedTenant('t-blank', 'acme-home-inspections', '   ');
        expect(readDisplayName('t-blank')?.name).toBe('acme-home-inspections');
    });

    it('falls back when the tenant has NO tenant_configs row at all', async () => {
        // The LEFT JOIN carries this case: an INNER JOIN would drop the tenant
        // from the result set entirely rather than showing anything.
        await seedTenant('t-noconfig', 'acme-home-inspections');
        expect(readDisplayName('t-noconfig')?.name).toBe('acme-home-inspections');
    });

    it('never yields an empty string, whatever the config row looks like', async () => {
        // The regression the whole expression exists to prevent. With
        // `tenants.name` gone there is no second name column to save a blank
        // read, so this property has to come from the slug or not at all.
        for (const [id, cfg] of [['a', null], ['b', ''], ['c', '  ']] as const) {
            await seedTenant(`t-${id}`, `company-${id}`, cfg);
            expect(readDisplayName(`t-${id}`)?.name).toBeTruthy();
        }
        await seedTenant('t-none', 'company-none');
        expect(readDisplayName('t-none')?.name).toBeTruthy();
    });

    it('sorts on the displayed name, not on the slug', async () => {
        // The agent directory orders by this expression. Sorting on the raw
        // slug would file "zzz-co" under Z while the row on screen reads
        // "Alpha".
        await seedTenant('t1', 'zzz-co', 'Alpha');
        await seedTenant('t2', 'aaa-co', 'Zulu');
        const rows = await db
            .select({ name: tenantDisplayName })
            .from(schema.tenants)
            .leftJoin(schema.tenantConfigs, eq(schema.tenantConfigs.tenantId, schema.tenants.id))
            .orderBy(sql`${tenantDisplayName} ASC`)
            .all();
        expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zulu']);
    });
});
