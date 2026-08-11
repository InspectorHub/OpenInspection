// A company admin renamed their own company — delivery over the portal→core
// command queue, under real workerd.
//
// Pinned CONSUMER-FIRST: the receiver must exist and be contractually fixed
// before portal emits the first envelope, because an unknown type PARKS and
// parking looks like success from the producer's side.
//
// The reason this command exists at all is the interesting part. A rename used
// to ride `cmd.tenant.update`, whose name write is deliberately initialize-only
// — correct for a provisioning sync, wrong for a rename. While `tenants.name`
// existed the rename landed there instead, so the mismatch never showed. When
// that column was dropped the rename had nowhere to go and became a silent
// no-op: portal's endpoint treated the dispatch as load-bearing ("silent
// divergence between the two stores is the whole bug") while core quietly
// dropped it. Hence a command per INTENT.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import { TENANT_CONFIGS_TEST_DDL } from '../helpers/inline-ddl';

const b = env as unknown as { DB: D1Database };

const T = 'ct-rename';

function envelope(
    over: Partial<{ id: string; type: string; dataschema: string; tenantseq: number; data: Record<string, unknown> }> = {},
) {
    return {
        specversion: '1.0',
        id: over.id ?? crypto.randomUUID(),
        type: over.type ?? 'io.inspectorhub.cmd.tenant.rename',
        source: 'portal',
        time: '2026-08-11T00:00:00.000Z',
        dataschema: over.dataschema ?? 'cmd-tenant-rename/v1',
        tenantseq: over.tenantseq ?? 1,
        data: over.data ?? { tenantId: T, companyName: 'Renamed Inspections' },
    };
}

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_connect_account_id TEXT, status TEXT NOT NULL DEFAULT 'pending', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', applied_cmd_seq INTEGER NOT NULL DEFAULT 0, applied_cred_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);',
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);',
    );
    await b.DB.exec(TENANT_CONFIGS_TEST_DDL);
}

async function reset(): Promise<void> {
    for (const t of ['processed_cmd_events', 'parked_cmd_events', 'tenant_configs', 'tenants']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
    await b.DB.prepare(
        "INSERT INTO tenants (id, slug, tier, status, max_users, deployment_mode, applied_cmd_seq, applied_cred_seq, created_at) VALUES (?1, 'rename-co', 'free', 'active', 5, 'shared', 0, 0, ?2)",
    ).bind(T, Date.now()).run();
}

const nameOf = async (tenantId: string) =>
    (await b.DB.prepare('SELECT company_name AS n FROM tenant_configs WHERE tenant_id = ?1')
        .bind(tenantId).first<{ n: string | null }>())?.n ?? null;

describe('cmd.tenant.rename — a company renaming itself (real D1)', () => {
    beforeAll(seedSchema);
    beforeEach(reset);

    it('writes the name for a tenant that has no config row yet', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 3 }))).toBe('applied');
        expect(await nameOf(T)).toBe('Renamed Inspections');
        const seq = await b.DB.prepare('SELECT applied_cmd_seq AS s FROM tenants WHERE id = ?1')
            .bind(T).first<{ s: number }>();
        expect(seq?.s).toBe(3);
    });

    it('OVERWRITES a name the tenant already had — the whole point of the command', async () => {
        // `cmd.tenant.update` would leave this alone (initialize-only), which is
        // exactly why a rename cannot be a field on it. If this assertion ever
        // goes green against an initialize-only applier, the rename is silently
        // dead again.
        await b.DB.prepare('INSERT INTO tenant_configs (tenant_id, company_name, updated_at) VALUES (?1, ?2, ?3)')
            .bind(T, 'The Old Name', Date.now()).run();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope())).toBe('applied');
        expect(await nameOf(T)).toBe('Renamed Inspections');
    });

    it('leaves legal_name alone — the brand and the signing entity are different columns', async () => {
        await b.DB.prepare('INSERT INTO tenant_configs (tenant_id, company_name, legal_name, updated_at) VALUES (?1, ?2, ?3, ?4)')
            .bind(T, 'Old Brand', 'Old Legal Entity LLC', Date.now()).run();
        await applyCmdEnvelope(b.DB, undefined, envelope());
        const row = await b.DB.prepare('SELECT company_name AS c, legal_name AS l FROM tenant_configs WHERE tenant_id = ?1')
            .bind(T).first<{ c: string; l: string }>();
        expect(row?.c).toBe('Renamed Inspections');
        expect(row?.l, 'a rename must not rewrite the entity that signed something').toBe('Old Legal Entity LLC');
    });

    it('drops a rename the queue delivered late — a newer one already won', async () => {
        await b.DB.prepare('UPDATE tenants SET applied_cmd_seq = 9 WHERE id = ?1').bind(T).run();
        await b.DB.prepare('INSERT INTO tenant_configs (tenant_id, company_name, updated_at) VALUES (?1, ?2, ?3)')
            .bind(T, 'The Newer Name', Date.now()).run();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 4 }))).toBe('stale');
        expect(await nameOf(T)).toBe('The Newer Name');
    });

    it('is deduped by envelope id, so a redelivery cannot resurrect an old name', async () => {
        const e = envelope({ tenantseq: 2 });
        expect(await applyCmdEnvelope(b.DB, undefined, e)).toBe('applied');
        await b.DB.prepare('UPDATE tenant_configs SET company_name = ?2 WHERE tenant_id = ?1')
            .bind(T, 'Set In Core Afterwards').run();
        expect(await applyCmdEnvelope(b.DB, undefined, e)).toBe('duplicate');
        expect(await nameOf(T)).toBe('Set In Core Afterwards');
    });

    it('parks an unknown dataschema version rather than guessing at the payload', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ dataschema: 'cmd-tenant-rename/v2' })))
            .toBe('parked');
        expect(await nameOf(T)).toBeNull();
    });

    it('rejects a blank name instead of erasing the company from every report', async () => {
        // `.strict()` + a trimmed min(1): an empty rename is not a rename, and
        // storing it would blank the name on every report, invite and public
        // profile at once.
        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ data: { tenantId: T, companyName: '   ' } })))
            .rejects.toThrow();
        expect(await nameOf(T)).toBeNull();
    });

    it('rejects an unrecognised field rather than applying half of what portal meant', async () => {
        await expect(applyCmdEnvelope(b.DB, undefined, envelope({
            data: { tenantId: T, companyName: 'Fine', legalName: 'Sneaky Legal Entity' },
        }))).rejects.toThrow();
    });
});
