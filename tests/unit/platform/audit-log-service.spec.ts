import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { AuditLogService } from '../../../server/services/audit-log.service';
import { SigningKeyService } from '../../../server/services/signing-key.service';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const REQ_ID = '00000000-0000-0000-0000-000000000100';
const KEY_SECRET = 'unit-test-key-encryption-secret-32b';

/**
 * Track I-a — the dedup index is PARTIAL (`event NOT LIKE 'signer.%'`). These
 * tests exercise the REAL append() path against the in-memory DB built from the
 * actual migration SQL, so they assert the index semantics end-to-end:
 *  - per-signer events may be appended N times (one row per signer)
 *  - envelope-level events keep the one-per-envelope idempotency guarantee
 *  - the hash chain stays valid across duplicate-type events
 */
describe('AuditLogService.append — partial dedup index', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let svc: AuditLogService;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    // The real DB is the in-memory better-sqlite3 instance, accessed through the
    // mocked d1 drizzle() above. The D1Database arg is therefore irrelevant.
    const signingKeys = new SigningKeyService({} as D1Database, KEY_SECRET);
    svc = new AuditLogService({} as D1Database, signingKeys);
  });

  it('allows the SAME per-signer event twice (one evidence row per signer)', async () => {
    await svc.append(TENANT_A, REQ_ID, 'signer.signed', { signerId: 's1', name: 'Jane' });
    // Second signer's evidence — must NOT be silently dropped by the dedup index.
    await svc.append(TENANT_A, REQ_ID, 'signer.signed', { signerId: 's2', name: 'Bob' });

    const rows = await db.select().from(schema.esignAuditLogs)
      .where(and(
        eq(schema.esignAuditLogs.tenantId, TENANT_A),
        eq(schema.esignAuditLogs.requestId, REQ_ID),
        eq(schema.esignAuditLogs.event, 'signer.signed'),
      )).all();
    expect(rows).toHaveLength(2);
    const payloads = rows.map((r) => JSON.parse(r.payloadJson).signerId).sort();
    expect(payloads).toEqual(['s1', 's2']);
  });

  it('keeps envelope-level events idempotent (one-per-envelope dedup)', async () => {
    const first = await svc.append(TENANT_A, REQ_ID, 'agreement.signed', { v: 1 });
    const second = await svc.append(TENANT_A, REQ_ID, 'agreement.signed', { v: 2 });
    // Idempotent: the duplicate returns the existing row, not a new one.
    expect(second.id).toBe(first.id);

    const rows = await db.select().from(schema.esignAuditLogs)
      .where(and(
        eq(schema.esignAuditLogs.tenantId, TENANT_A),
        eq(schema.esignAuditLogs.requestId, REQ_ID),
        eq(schema.esignAuditLogs.event, 'agreement.signed'),
      )).all();
    expect(rows).toHaveLength(1);
  });

  it('keeps the hash chain valid across duplicate per-signer events', async () => {
    await svc.append(TENANT_A, REQ_ID, 'request.created', { at: 1 });
    await svc.append(TENANT_A, REQ_ID, 'signer.signed', { signerId: 's1' });
    await svc.append(TENANT_A, REQ_ID, 'signer.signed', { signerId: 's2' });
    await svc.append(TENANT_A, REQ_ID, 'workflow.complete', { done: true });

    const result = await svc.verifyChain(TENANT_A, REQ_ID);
    expect(result).toEqual({ valid: true, events: 4 });
  });

  /**
   * Key rotation, and the property that makes it safe: **rotating a tenant's
   * e-sign key must not invalidate anything already signed under the old one.**
   *
   * It holds because two things line up. `signing_keys` is a history — retiring
   * a key keeps its public half on file — and `verifyChain` resolves the key for
   * each row from the `key_fingerprint` that row recorded, rather than asking
   * what the tenant's key is today. Break either half and every pre-rotation
   * envelope starts reporting as failed on the PUBLIC verifier page, about
   * documents real people really signed.
   */
  it('keeps pre-rotation chains verifying after the key is rotated', async () => {
    await svc.append(TENANT_A, REQ_ID, 'request.created', { at: 1 });
    await svc.append(TENANT_A, REQ_ID, 'agreement.signed', { at: 2 });

    const keys = new SigningKeyService({} as D1Database, KEY_SECRET);
    const before = (await keys.getPublicKey(TENANT_A))!.fingerprint;
    const rotation = await keys.rotateKeypair(TENANT_A);
    expect(rotation.retired).toBe(before);
    expect(rotation.fingerprint).not.toBe(before);

    // The whole point of the exercise.
    expect(await svc.verifyChain(TENANT_A, REQ_ID)).toEqual({ valid: true, events: 2 });
    // And the reason it holds: the retired key was kept, not overwritten.
    expect(await keys.getPublicKeyByFingerprint(TENANT_A, before)).not.toBeNull();
  });

  it('signs new events with the new key and verifies a chain spanning the rotation', async () => {
    await svc.append(TENANT_A, REQ_ID, 'request.created', { at: 1 });
    const keys = new SigningKeyService({} as D1Database, KEY_SECRET);
    await keys.rotateKeypair(TENANT_A);
    await svc.append(TENANT_A, REQ_ID, 'agreement.signed', { at: 2 });

    const rows = await db.select().from(schema.esignAuditLogs)
      .where(and(
        eq(schema.esignAuditLogs.tenantId, TENANT_A),
        eq(schema.esignAuditLogs.requestId, REQ_ID),
      )).all();
    // An envelope open across a rotation really does carry two keys — this is
    // the case a single-key verifier gets wrong.
    expect(new Set(rows.map((r) => r.keyFingerprint)).size).toBe(2);
    expect(await svc.verifyChain(TENANT_A, REQ_ID)).toEqual({ valid: true, events: 2 });
  });

  /**
   * If the key a row names cannot be produced, the honest answer is "we cannot
   * check this", not "this signature is bad". A verification
   * surface may report what its check established and no more, and this result
   * reaches a public page where the second phrasing would be a statement against
   * the signer's interest.
   */
  it('reports an unresolvable key as key_mismatch, never as a bad signature', async () => {
    await svc.append(TENANT_A, REQ_ID, 'request.created', { at: 1 });
    // The key that sealed the row is gone from the history — the state the
    // history exists to prevent, asserted here so its handling stays honest.
    await db.delete(schema.signingKeys).where(eq(schema.signingKeys.tenantId, TENANT_A));
    await new SigningKeyService({} as D1Database, KEY_SECRET).ensureKeypair(TENANT_A);

    const result = await svc.verifyChain(TENANT_A, REQ_ID);
    expect(result.valid).toBe(false);
    expect((result as { reason: string }).reason).toBe('key_mismatch');
  });

  it('allows at most one active key per tenant', async () => {
    const keys = new SigningKeyService({} as D1Database, KEY_SECRET);
    await keys.ensureKeypair(TENANT_A);
    // A second un-retired row for the same tenant must be refused by the PARTIAL
    // unique index. Without the `WHERE retired_at IS NULL` predicate this insert
    // succeeds, because SQLite treats each NULL as distinct — and the tenant
    // then has two "current" keys with nothing to say which one signs.
    await expect(db.insert(schema.signingKeys).values({
      id: 'second-active', tenantId: TENANT_A,
      publicKey: 'x', privateKeyEnc: 'x', privateKeyIv: 'x',
      fingerprint: 'ffff', algorithm: 'Ed25519',
      createdAt: new Date(), retiredAt: null,
    })).rejects.toThrow();
  });
});
