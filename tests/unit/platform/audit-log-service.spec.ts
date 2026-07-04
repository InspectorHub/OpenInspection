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
      id: TENANT_A, name: 'A', slug: 'acme', status: 'active',
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
});
