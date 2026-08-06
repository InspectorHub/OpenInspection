// Per-tenant AI-cap delivery over the portal→core command queue (managed-AI
// provider tier, Task 5 Step 4) under real workerd.
//
// There is no producer yet — portal ships the tier console, the storage and
// the audit trail, and delivery was deferred to this side precisely so the
// receiver would exist before the first envelope was emitted (an unknown type
// parks, which looks like success from the producer). The contract is
// therefore pinned CONSUMER-FIRST, from fixture envelopes: type name,
// dataschema version, payload shape, and the dedup/stale semantics it
// inherits from the shared per-tenant sequence.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import { readTenantAiCaps } from '../../server/features/plan-quota/ai-caps';
import { TENANT_CONFIGS_TEST_DDL } from '../helpers/inline-ddl';

const b = env as unknown as { DB: D1Database };

const T = 'ct-caps';

function envelope(
    over: Partial<{ id: string; type: string; dataschema: string; tenantseq: number; data: Record<string, unknown> }> = {},
) {
    return {
        specversion: '1.0',
        id: over.id ?? crypto.randomUUID(),
        type: over.type ?? 'io.inspectorhub.cmd.tenant.ai_caps',
        source: 'portal',
        time: '2026-08-06T00:00:00.000Z',
        dataschema: over.dataschema ?? 'cmd-tenant-ai-caps/v1',
        tenantseq: over.tenantseq ?? 1,
        data: over.data ?? { tenantId: T, tier: 'pro', caps: { ai_translate: 500 } },
    };
}

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_connect_account_id TEXT, status TEXT NOT NULL DEFAULT 'pending', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', applied_cmd_seq INTEGER NOT NULL DEFAULT 0, applied_cred_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
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
        "INSERT INTO tenants (id, name, slug, tier, status, max_users, deployment_mode, applied_cmd_seq, applied_cred_seq, created_at) VALUES (?1, 'Caps Co', 'caps-co', 'pro', 'active', 5, 'shared', 0, 0, ?2)",
    ).bind(T, Date.now()).run();
}

async function integrationConfigOf(tenantId: string): Promise<Record<string, unknown> | null> {
    const row = await b.DB.prepare('SELECT integration_config AS c FROM tenant_configs WHERE tenant_id = ?1')
        .bind(tenantId).first<{ c: string | null }>();
    return row?.c ? (JSON.parse(row.c) as Record<string, unknown>) : null;
}

describe('cmd.tenant.ai_caps — per-tenant AI cap delivery (real D1)', () => {
    beforeAll(seedSchema);
    beforeEach(reset);

    it('stores the delivered caps where the guard reads them, and advances applied_cmd_seq', async () => {
        const res = await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 4 }));
        expect(res).toBe('applied');
        // Keyed by TIER, because that is the shape the guard looks up
        // (`aiCaps[tier][metric]`) — a per-tenant row carrying the tier it was
        // computed for, not a bare number whose tier nobody recorded.
        expect(await readTenantAiCaps(b.DB, T)).toEqual({ pro: { ai_translate: 500 } });
        const seq = await b.DB.prepare('SELECT applied_cmd_seq AS s FROM tenants WHERE id = ?1')
            .bind(T).first<{ s: number }>();
        expect(seq?.s).toBe(4);
    });

    it('leaves the rest of the tenant config untouched (read-modify-write, not overwrite)', async () => {
        await b.DB.prepare(
            'INSERT INTO tenant_configs (tenant_id, integration_config, updated_at) VALUES (?1, ?2, ?3)',
        ).bind(T, JSON.stringify({ appBaseUrl: 'https://tenant.example' }), Date.now()).run();

        await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 2 }));

        const cfg = await integrationConfigOf(T);
        expect(cfg?.['appBaseUrl']).toBe('https://tenant.example');
        expect(await readTenantAiCaps(b.DB, T)).toEqual({ pro: { ai_translate: 500 } });
    });

    it('replaces the whole cap set — an empty payload clears back to unenforced', async () => {
        await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 1 }));
        expect(await readTenantAiCaps(b.DB, T)).toEqual({ pro: { ai_translate: 500 } });

        // Clearing is not a tombstone: the command carries the COMPLETE set the
        // tenant should have, so "no caps" is an empty set. Absence has to read
        // back as absence, or a cleared cap would keep enforcing.
        const res = await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 2, data: { tenantId: T, tier: 'pro', caps: {} },
        }));
        expect(res).toBe('applied');
        expect(await readTenantAiCaps(b.DB, T)).toBeUndefined();
    });

    it('drops a metric this build does not cap rather than storing it', async () => {
        // Tolerant reader: a newer portal may name a metric this core has never
        // heard of. Storing it would put an unenforceable number in the config
        // that later reads would have to guess about.
        const res = await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1, data: { tenantId: T, tier: 'pro', caps: { ai_translate: 300, ai_hologram: 7 } },
        }));
        expect(res).toBe('applied');
        expect(await readTenantAiCaps(b.DB, T)).toEqual({ pro: { ai_translate: 300 } });
    });

    it('a redelivered envelope id is a duplicate and changes nothing', async () => {
        const id = 'cap-env-1';
        await applyCmdEnvelope(b.DB, undefined, envelope({ id, tenantseq: 3 }));
        const res = await applyCmdEnvelope(b.DB, undefined, envelope({
            id, tenantseq: 9, data: { tenantId: T, tier: 'pro', caps: { ai_translate: 999 } },
        }));
        expect(res).toBe('duplicate');
        expect(await readTenantAiCaps(b.DB, T)).toEqual({ pro: { ai_translate: 500 } });
    });

    it('a stale tenantseq is dropped — an old cap cannot overwrite a newer one', async () => {
        await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 5 }));
        const res = await applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 4, data: { tenantId: T, tier: 'pro', caps: { ai_translate: 900 } },
        }));
        expect(res).toBe('stale');
        expect(await readTenantAiCaps(b.DB, T)).toEqual({ pro: { ai_translate: 500 } });
    });

    it('parks an unknown dataschema version instead of applying it', async () => {
        const res = await applyCmdEnvelope(b.DB, undefined, envelope({
            dataschema: 'cmd-tenant-ai-caps/v2', tenantseq: 1,
        }));
        expect(res).toBe('parked');
        const parked = await b.DB.prepare('SELECT reason FROM parked_cmd_events').first<{ reason: string }>();
        expect(parked?.reason).toBe('unknown-type-or-version');
        expect(await readTenantAiCaps(b.DB, T)).toBeUndefined();
    });

    it('throws for an unknown tenant so the queue retries rather than inventing a config row', async () => {
        await expect(applyCmdEnvelope(b.DB, undefined, envelope({
            tenantseq: 1, data: { tenantId: 'no-such-tenant', tier: 'pro', caps: { ai_translate: 1 } },
        }))).rejects.toThrow(/tenant not found/);
    });
});
