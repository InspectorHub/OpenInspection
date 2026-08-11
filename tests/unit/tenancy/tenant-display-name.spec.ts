/**
 * Which company name an agent or a client sees.
 *
 * Two columns hold one, and they are allowed to differ: `tenants.name` is the
 * container's name (written at provisioning, kept current by portal's rename
 * sync) and `tenant_configs.company_name` is what the tenant typed into core's
 * own settings. Display follows the settings value; the container name is the
 * fallback.
 *
 * The fallback is the part worth pinning. Measured against production on
 * 2026-08-11: of 16 tenants, 11 match, 1 has diverged, and FOUR have no
 * company_name at all. Reading company_name without the COALESCE would render
 * those four with a blank name in the agent directory, invite emails and public
 * profiles — a worse bug than the stale name this rule exists to fix.
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

async function seedTenant(id: string, name: string, companyName?: string | null) {
    await db.insert(schema.tenants).values({
        id, name, slug: id, status: 'active',
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
    it('prefers the settings company name over the container name', async () => {
        // The one diverged production tenant has exactly this shape: a container
        // name that is an email local-part, and a real company name beside it.
        await seedTenant('t-diverged', 'important.new', 'OpenInspection');
        expect(readDisplayName('t-diverged')?.name).toBe('OpenInspection');
    });

    it('falls back to the container name when company_name is NULL', async () => {
        await seedTenant('t-null', 'Acme Home Inspections', null);
        expect(readDisplayName('t-null')?.name).toBe('Acme Home Inspections');
    });

    it('falls back when company_name is whitespace, not just when it is NULL', async () => {
        // "set to spaces" and "never set" are the same thing to a reader, and
        // only one of them is NULL — which is why the rule is NULLIF(TRIM(..)).
        await seedTenant('t-blank', 'Acme Home Inspections', '   ');
        expect(readDisplayName('t-blank')?.name).toBe('Acme Home Inspections');
    });

    it('falls back when the tenant has NO tenant_configs row at all', async () => {
        // The LEFT JOIN carries this case: an INNER JOIN would drop the tenant
        // from the result set entirely rather than showing its container name.
        await seedTenant('t-noconfig', 'Acme Home Inspections');
        expect(readDisplayName('t-noconfig')?.name).toBe('Acme Home Inspections');
    });

    it('never yields an empty string for a tenant that has a container name', async () => {
        // The regression this whole rule guards: four production tenants have no
        // company_name, and a bare read would render them blank.
        for (const [id, cfg] of [['a', null], ['b', ''], ['c', '  ']] as const) {
            await seedTenant(`t-${id}`, `Company ${id}`, cfg);
            expect(readDisplayName(`t-${id}`)?.name).toBeTruthy();
        }
    });

    it('sorts on the displayed name, not the container name', async () => {
        // The agent directory orders by this expression. Sorting on the raw
        // column would put "important.new" under I while the row reads
        // "OpenInspection".
        await seedTenant('t1', 'zzz-container', 'Alpha');
        await seedTenant('t2', 'aaa-container', 'Zulu');
        const rows = await db
            .select({ name: tenantDisplayName })
            .from(schema.tenants)
            .leftJoin(schema.tenantConfigs, eq(schema.tenantConfigs.tenantId, schema.tenants.id))
            .orderBy(sql`${tenantDisplayName} ASC`)
            .all();
        expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Zulu']);
    });
});
