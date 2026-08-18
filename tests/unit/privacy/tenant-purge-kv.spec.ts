/**
 * A share token that outlives the tenant it belongs to.
 *
 * `agent_view_token:{token}` grants read-only access to a report for thirty
 * days and is keyed by the token alone. The purge deletes three KV keys it can
 * NAME — `tenant:{slug}`, `setup_code:{slug}` and one `pwchanged:{userId}` per
 * user — and there is no way to name these, so a destroyed workspace left live
 * credentials to its own reports in KV until each expired on its own.
 *
 * ── Why the token carries the tenant, rather than the key ────────────────────
 * The obvious fix is `agent_view_token:{tenantId}:{token}`. It does not work:
 * `resolveAgentViewToken` is handed a token and nothing else — the public
 * viewer has no tenant context, and the token IS the credential, so looking the
 * tenant up first would mean trusting something other than the token to find
 * it. A prefixed key would be unlookupable.
 *
 * So the TENANT rides in the token: 32 hex characters of tenant id followed by
 * 32 random. The KV key is unchanged, resolution is unchanged, the token is the
 * same length and the same shape — and `kv.list({ prefix })` can now enumerate
 * exactly one tenant's tokens, because a tenant id in hex is fixed-length and
 * cannot be a prefix of another.
 *
 * Tokens minted before this expire on their own inside their own thirty-day
 * TTL. There is no sweep for them and there cannot be one: they carry nothing
 * that says whose they are. That is a bounded, stated residue rather than a
 * silent one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantPurgeService } from '../../../server/services/tenant-purge.service';
import { agentViewTokenPrefix, mintAgentViewToken } from '../../../server/lib/agent-view-token';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000ff';

const makeR2 = () => ({
    list: vi.fn(async () => ({ objects: [], truncated: false, cursor: undefined })),
    delete: vi.fn(async () => {}),
} as unknown as R2Bucket);

/** A KV stub with real prefix semantics — a `list` that ignored prefix would make the test vacuous. */
function makeKv(seed: Record<string, string> = {}) {
    const store = new Map(Object.entries(seed));
    return {
        store,
        ns: {
            put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
            get: vi.fn(async (k: string) => store.get(k) ?? null),
            delete: vi.fn(async (k: string) => { store.delete(k); }),
            list: vi.fn(async (opts?: { prefix?: string; cursor?: string }) => ({
                keys: [...store.keys()]
                    .filter(k => !opts?.prefix || k.startsWith(opts.prefix))
                    .map(name => ({ name })),
                list_complete: true,
                cursor: undefined,
            })),
        } as unknown as KVNamespace,
    };
}

describe('tenant purge — KV share tokens', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    it('purges every share token belonging to the tenant', async () => {
        const mine = [mintAgentViewToken(TENANT), mintAgentViewToken(TENANT)];
        const kv = makeKv({
            [`agent_view_token:${mine[0]}`]: `i-1:${TENANT}`,
            [`agent_view_token:${mine[1]}`]: `i-2:${TENANT}`,
        });

        await new TenantPurgeService({} as D1Database, makeR2(), kv.ns).purge(TENANT);

        expect(kv.store.has(`agent_view_token:${mine[0]}`)).toBe(false);
        expect(kv.store.has(`agent_view_token:${mine[1]}`)).toBe(false);
    });

    it('never touches another tenant\'s token', async () => {
        const mine = mintAgentViewToken(TENANT);
        const theirs = mintAgentViewToken(OTHER);
        const kv = makeKv({
            [`agent_view_token:${mine}`]: `i-1:${TENANT}`,
            [`agent_view_token:${theirs}`]: `i-9:${OTHER}`,
        });

        await new TenantPurgeService({} as D1Database, makeR2(), kv.ns).purge(TENANT);

        expect(kv.store.has(`agent_view_token:${mine}`)).toBe(false);
        expect(kv.store.has(`agent_view_token:${theirs}`)).toBe(true);
    });

    it('counts the swept tokens, so the destruction record is not silent about them', async () => {
        const kv = makeKv({
            [`agent_view_token:${mintAgentViewToken(TENANT)}`]: `i-1:${TENANT}`,
            [`agent_view_token:${mintAgentViewToken(TENANT)}`]: `i-2:${TENANT}`,
        });
        const out = await new TenantPurgeService({} as D1Database, makeR2(), kv.ns).purge(TENANT);
        // Two tokens plus `tenant:acme` and `setup_code:acme`.
        expect(out.kv).toBe(4);
    });

    it('a legacy token with no tenant in it survives, and that is stated not hidden', async () => {
        // 64 hex characters, minted the old way, whose first 32 are not any
        // tenant id. Nothing can say whose it is, so nothing can sweep it; it
        // expires inside its own thirty-day TTL. The test exists so that fact is
        // asserted rather than discovered.
        const legacy = 'f'.repeat(64);
        const kv = makeKv({ [`agent_view_token:${legacy}`]: `i-1:${TENANT}` });

        await new TenantPurgeService({} as D1Database, makeR2(), kv.ns).purge(TENANT);

        expect(kv.store.has(`agent_view_token:${legacy}`)).toBe(true);
    });
});

describe('agent view token shape', () => {
    it('starts with the tenant id in hex, so a prefix list finds exactly one tenant', () => {
        const token = mintAgentViewToken(TENANT);
        expect(token.startsWith(TENANT.replace(/-/g, ''))).toBe(true);
        expect(token).toHaveLength(64);
        expect(agentViewTokenPrefix(TENANT)).toBe(`agent_view_token:${TENANT.replace(/-/g, '')}`);
    });

    it('is unguessable past the tenant half', () => {
        // The tenant id is public — it is in R2 keys and URLs. The credential is
        // the other 32 characters, and two mints must not collide.
        const a = mintAgentViewToken(TENANT);
        const b = mintAgentViewToken(TENANT);
        expect(a).not.toBe(b);
        expect(a.slice(32)).not.toBe(b.slice(32));
    });

    it('one tenant id is never a prefix of another', () => {
        // Fixed-length hex is what makes the prefix sweep safe. The R2 sweep
        // needs a trailing slash for exactly the reason this does not.
        expect(agentViewTokenPrefix(TENANT)).not.toBe(agentViewTokenPrefix(OTHER));
        expect(agentViewTokenPrefix(TENANT).startsWith(agentViewTokenPrefix(OTHER))).toBe(false);
    });
});
