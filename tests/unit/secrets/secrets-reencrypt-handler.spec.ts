/**
 * The platform re-encrypt endpoint also brings the tenants' e-sign signing keys under the current secret, in bounded calls: the operator
 * runs it again until `signingKeys.done`, and only then removes JWT_SECRET_PREVIOUS. The signing-key part runs first so the tenant
 * secrets part (which is not bounded) cannot starve it, and its counts are returned even when that part does not finish.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { secretsReencryptHandler } from '../../../server/portal/secrets-reencrypt-handler';
import { SigningKeyService } from '../../../server/services/signing-key.service';
import type { HonoConfig } from '../../../server/types/hono';

const OLD = 'old-secret-old-secret-old-secret-1234';
const NEW = 'new-secret-new-secret-new-secret-5678';
const tenantId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

describe('POST /secrets/reencrypt and the signing keys', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        for (let n = 1; n <= 27; n += 1) {
            await db.insert(schema.tenants).values({ id: tenantId(n), slug: `t${n}`, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
            await new SigningKeyService({} as D1Database, OLD, []).ensureKeypair(tenantId(n));
        }
    });
    afterEach(() => vi.restoreAllMocks());

    const call = async () => {
        const app = new Hono<HonoConfig>();
        app.post('/secrets/reencrypt', secretsReencryptHandler);
        const res = await app.request('/secrets/reencrypt', { method: 'POST' }, { DB: {}, JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: OLD } as never);
        return { status: res.status, body: await res.json() as { data: { signingKeys: { rewrapped: number; alreadyCurrent: number; remaining: number; done: boolean }; secretsComplete: boolean; secretsError?: string } } };
    };

    it('writes a bounded number of keys per call and reports how many are left until it is done', async () => {
        const first = await call();
        expect(first.status).toBe(200);
        expect(first.body.data.signingKeys).toEqual({ rewrapped: 25, alreadyCurrent: 0, remaining: 2, done: false });
        expect(first.body.data.secretsComplete).toBe(true);
        const second = await call();
        expect(second.body.data.signingKeys).toEqual({ rewrapped: 2, alreadyCurrent: 25, remaining: 0, done: true });
        // With the previous secret gone every tenant still signs.
        for (const n of [1, 14, 27]) expect((await new SigningKeyService({} as D1Database, NEW, []).ensureKeypair(tenantId(n))).fingerprint).toBeTruthy();
    });

    it('returns the signing-key counts even when the tenant secrets part cannot run', async () => {
        sqlite.exec('DROP TABLE tenant_configs');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const out = await call();
        expect(out.status).toBe(200);
        expect(out.body.data.secretsComplete).toBe(false);
        expect(out.body.data.secretsError).toBeTruthy();
        expect(out.body.data.signingKeys.rewrapped).toBe(25);
    });
});
