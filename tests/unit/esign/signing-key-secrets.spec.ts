/**
 * C5 and C22: the private half of a tenant's signing key is wrapped under a deployment secret. Changing that secret must not strand the
 * key, and creating or rotating a key must not leave a tenant without an active one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { SigningKeyService, signingKeySecrets } from '../../../server/services/signing-key.service';
import { logger } from '../../../server/lib/logger';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OLD = 'old-secret-old-secret-old-secret-1234';
const NEW = 'new-secret-new-secret-new-secret-5678';

describe('signing key wrapping and rotation', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    });
    afterEach(() => vi.restoreAllMocks());

    const svc = (secret: string, previous: string[] = []) => new SigningKeyService({} as D1Database, secret, previous);
    const activeRows = () => db.select().from(schema.signingKeys).where(and(eq(schema.signingKeys.tenantId, TENANT), isNull(schema.signingKeys.retiredAt))).all();

    it('C5: a key wrapped under the old secret still signs after the secret changes, when the old one is supplied as previous; it is re-wrapped under the new one', async () => {
        const created = await svc(OLD).ensureKeypair(TENANT);
        const before = (await activeRows())[0]!;

        const rotated = svc(NEW, [OLD]);
        const opened = await rotated.ensureKeypair(TENANT);
        expect(opened.fingerprint).toBe(created.fingerprint);
        // The key still signs, and its public half (the thing signatures are checked with) is the same.
        const sig = await crypto.subtle.sign('Ed25519', opened.privateKey, new Uint8Array([1, 2, 3]));
        expect(await crypto.subtle.verify('Ed25519', created.publicKey, sig, new Uint8Array([1, 2, 3]))).toBe(true);

        // Re-wrapped: the stored ciphertext changed, the public key and fingerprint did not, and the new secret alone now opens it.
        const after = (await activeRows())[0]!;
        expect(after.privateKeyEnc).not.toBe(before.privateKeyEnc);
        expect(after.publicKey).toBe(before.publicKey);
        expect(after.fingerprint).toBe(before.fingerprint);
        expect((await svc(NEW).ensureKeypair(TENANT)).fingerprint).toBe(created.fingerprint);
        expect(await activeRows()).toHaveLength(1);
    });

    it('C5: without the old secret the key is not opened and is not replaced: the error says what to supply, and an alert is logged', async () => {
        await svc(OLD).ensureKeypair(TENANT);
        const alert = vi.spyOn(logger, 'alert').mockImplementation(() => undefined);
        await expect(svc(NEW).ensureKeypair(TENANT)).rejects.toThrow(/JWT_SECRET_PREVIOUS/);
        expect(alert).toHaveBeenCalledTimes(1);
        // Nothing was minted in its place: minting a second key would hide the problem and leave the first one unused.
        expect(await db.select().from(schema.signingKeys).all()).toHaveLength(1);
    });

    it('C5: which secrets are tried is decided in one place from the environment', () => {
        expect(signingKeySecrets({ JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: OLD })).toEqual({ current: NEW, previous: [OLD] });
        // KEY_ENCRYPTION_SECRET added later: the JWT_SECRET it replaced is the previous one.
        expect(signingKeySecrets({ KEY_ENCRYPTION_SECRET: NEW, JWT_SECRET: OLD })).toEqual({ current: NEW, previous: [OLD] });
        expect(signingKeySecrets({ KEY_ENCRYPTION_SECRET: NEW, JWT_SECRET: OLD, JWT_SECRET_PREVIOUS: OLD })).toEqual({ current: NEW, previous: [OLD] });
        // Nothing short or empty, and never the current one twice.
        expect(signingKeySecrets({ JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: 'short' })).toEqual({ current: NEW, previous: [] });
        expect(signingKeySecrets({ JWT_SECRET: NEW, JWT_SECRET_PREVIOUS: NEW })).toEqual({ current: NEW, previous: [] });
    });

    it('C22: two requests that find no key both succeed and end up with the one key that was stored', async () => {
        const [a, b] = await Promise.all([svc(NEW).ensureKeypair(TENANT), svc(NEW).ensureKeypair(TENANT)]);
        expect(a.fingerprint).toBe(b.fingerprint);
        expect(await activeRows()).toHaveLength(1);
    });

    it('C22: a rotation that cannot make its new key leaves the current key active', async () => {
        const first = await svc(NEW).ensureKeypair(TENANT);
        vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('entropy source unavailable'));
        await expect(svc(NEW).rotateKeypair(TENANT)).rejects.toThrow(/entropy/);
        const rows = await activeRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.fingerprint).toBe(first.fingerprint);
    });

    it('C22: a rotation keeps both keys on file, one active, and the retired one still verifies by its fingerprint', async () => {
        const first = await svc(NEW).ensureKeypair(TENANT);
        const result = await svc(NEW).rotateKeypair(TENANT);
        expect(result.retired).toBe(first.fingerprint);
        expect(await activeRows()).toHaveLength(1);
        expect((await db.select().from(schema.signingKeys).all())).toHaveLength(2);
        expect(await svc(NEW).getPublicKeyByFingerprint(TENANT, first.fingerprint)).not.toBeNull();
    });

    it('the re-wrap pass brings a tenant that never signed after the rotation under the new secret, so the old one can be removed', async () => {
        const created = await svc(OLD).ensureKeypair(TENANT);
        const report = await svc(NEW, [OLD]).rewrapAll(1);
        expect(report).toEqual({ rewrapped: 1, alreadyCurrent: 0, remaining: 0, done: true });
        // The previous secret is gone: the tenant still signs, with the same key.
        const after = await svc(NEW).ensureKeypair(TENANT);
        expect(after.fingerprint).toBe(created.fingerprint);
        const sig = await crypto.subtle.sign('Ed25519', after.privateKey, new Uint8Array([9]));
        expect(await crypto.subtle.verify('Ed25519', created.publicKey, sig, new Uint8Array([9]))).toBe(true);
        // Idempotent, and nothing but the wrapping moved.
        expect(await svc(NEW, [OLD]).rewrapAll(1)).toEqual({ rewrapped: 0, alreadyCurrent: 1, remaining: 0, done: true });
    });

    it('the pass reports the keys it could not bring over, in chunks, and leaves them as they were', async () => {
        const other = '00000000-0000-0000-0000-000000000002';
        await db.insert(schema.tenants).values({ id: other, slug: 'beta', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        await svc(OLD).ensureKeypair(TENANT);
        await svc('third-secret-third-secret-9999').ensureKeypair(other);
        const before = await db.select().from(schema.signingKeys).all();
        const report = await svc(NEW, [OLD]).rewrapAll(1);
        expect(report).toEqual({ rewrapped: 1, alreadyCurrent: 0, remaining: 1, done: false });
        const unopened = (await db.select().from(schema.signingKeys).where(eq(schema.signingKeys.tenantId, other)).all())[0]!;
        expect(unopened.privateKeyEnc).toBe(before.find((r) => r.tenantId === other)!.privateKeyEnc);
    });

    it('a call writes at most `limit` keys and says how many are left; running it again finishes, and only then is it done', async () => {
        const ids = ['00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'];
        for (const id of ids) await db.insert(schema.tenants).values({ id, slug: `t-${id.slice(-1)}`, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        for (const id of [TENANT, ...ids]) await svc(OLD).ensureKeypair(id);
        const first = await svc(NEW, [OLD]).rewrapAll(2, 2);
        expect(first).toEqual({ rewrapped: 2, alreadyCurrent: 0, remaining: 1, done: false });
        const second = await svc(NEW, [OLD]).rewrapAll(2, 2);
        expect(second).toEqual({ rewrapped: 1, alreadyCurrent: 2, remaining: 0, done: true });
        for (const id of [TENANT, ...ids]) expect((await svc(NEW).ensureKeypair(id)).fingerprint).toBeTruthy();
    });

    it('a re-wrap that does not open back to the same bytes is not written, and raises an alert', async () => {
        await svc(OLD).ensureKeypair(TENANT);
        const before = (await activeRows())[0]!;
        const alert = vi.spyOn(logger, 'alert').mockImplementation(() => undefined);
        const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const real = crypto.subtle.decrypt.bind(crypto.subtle);
        let calls = 0;
        // Calls: current secret (fails), earlier secret (opens), then the check on the new ciphertext, which is made to return other bytes.
        vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args: Parameters<typeof real>) => {
            calls += 1;
            return calls === 3 ? new Uint8Array([1, 2, 3]).buffer : real(...args);
        });
        await svc(NEW, [OLD]).ensureKeypair(TENANT);
        expect(alert.mock.calls.some((c) => c[0] === 'signing_key_rewrap_mismatch')).toBe(true);
        expect((await activeRows())[0]!.privateKeyEnc).toBe(before.privateKeyEnc);
        expect(info.mock.calls.some((c) => c[0] === 'signing-key.rewrapped')).toBe(false);
    });

    it('the rewrapped line is logged only when the compare-and-set changed a row', async () => {
        await svc(OLD).ensureKeypair(TENANT);
        const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
        const real = crypto.subtle.encrypt.bind(crypto.subtle);
        // Another writer converts the row between the read and the write: the update then matches nothing.
        vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args: Parameters<typeof real>) => {
            const out = await real(...args);
            await db.update(schema.signingKeys).set({ privateKeyEnc: 'changed-by-someone-else' }).where(eq(schema.signingKeys.tenantId, TENANT));
            return out;
        });
        await svc(NEW, [OLD]).ensureKeypair(TENANT);
        expect(info.mock.calls.some((c) => c[0] === 'signing-key.rewrapped')).toBe(false);
        expect((await activeRows())[0]!.privateKeyEnc).toBe('changed-by-someone-else');
    });

});
