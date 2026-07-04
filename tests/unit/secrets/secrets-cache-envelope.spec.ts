/**
 * Task 3 — `loadTenantSecrets` is THE single envelope-aware decrypt entry
 * point for tenant integration secrets. The KV cache holds ciphertext ONLY
 * (a JSON envelope `{blob, dekEnc}`); plaintext never lands in KV. A stale
 * pre-envelope cache entry (raw blob string) is treated as a miss.
 *
 * Real crypto roundtrip: sealSecrets (v2 envelope) → D1 row → loadTenantSecrets.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { tenantConfigs, tenants } from '../../../server/lib/db/schema';
import { sealSecrets } from '../../../server/lib/config-crypto';
import { loadTenantSecrets, secretsCacheKey } from '../../../server/lib/secrets-cache';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

// Minimal KV stub (string store, get/put/delete)
function makeKv() {
    const store = new Map<string, string>();
    return {
        store,
        get: async (k: string, opts?: unknown) => {
            void opts; return store.get(k) ?? null;
        },
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async (k: string) => { store.delete(k); },
    } as unknown as KVNamespace & { store: Map<string, string> };
}

const TENANT = 't-1';
const SECRET = 'cur-secret';

/**
 * Builds a real in-memory D1-shaped drizzle backed by better-sqlite3, with a
 * single tenant_configs row when `row` is provided. `drizzle(c.env.DB)` is
 * mocked to return this instance, so the function-under-test's one query runs
 * against the real table.
 */
async function makeDb(row?: { secretsEnc: string; dekEnc: string | null }) {
    const fix = createTestDb();
    await setupSchema(fix.sqlite);
    vi.mocked(drizzle).mockReturnValue(fix.db as never);
    if (row) {
        await fix.db.insert(tenants).values({
            id: TENANT, name: 'Test Tenant', slug: 't-1', createdAt: new Date(),
        } as never);
        await fix.db.insert(tenantConfigs).values({
            tenantId: TENANT,
            secretsEnc: row.secretsEnc,
            dekEnc: row.dekEnc,
            updatedAt: new Date(),
        } as never);
    }
    return {} as unknown as D1Database;
}

describe('loadTenantSecrets (envelope-aware, KV-cached)', () => {
    let kv: ReturnType<typeof makeKv>;
    beforeEach(() => { kv = makeKv(); });

    it('decrypts a v2 row and caches ciphertext JSON', async () => {
        const sealed = await sealSecrets({ A: '1' }, TENANT, SECRET);
        const db = await makeDb({ secretsEnc: sealed.blob, dekEnc: sealed.dekEnc });
        const out = await loadTenantSecrets(db, kv, TENANT, SECRET);
        expect(out).toEqual({ A: '1' });
        const cached = kv.store.get(secretsCacheKey(TENANT))!;
        expect(cached).toContain('"blob"');        // ciphertext JSON envelope
        expect(cached).not.toContain('"A":"1"');   // never plaintext in KV
    });

    it('returns null for a tenant with no secrets and caches NONE', async () => {
        const db = await makeDb(undefined);
        expect(await loadTenantSecrets(db, kv, TENANT, SECRET)).toBeNull();
        expect(kv.store.get(secretsCacheKey(TENANT))).toBe('NONE');
    });

    it('treats a stale pre-envelope cache entry (raw blob string) as a miss', async () => {
        const sealed = await sealSecrets({ A: '1' }, TENANT, SECRET);
        kv.store.set(secretsCacheKey(TENANT), sealed.blob); // old cache format
        const db = await makeDb({ secretsEnc: sealed.blob, dekEnc: sealed.dekEnc });
        expect(await loadTenantSecrets(db, kv, TENANT, SECRET)).toEqual({ A: '1' });
    });
});
