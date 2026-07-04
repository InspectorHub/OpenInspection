import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { loadVerifyData } from '../../../server/lib/verify-data';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '00000000-0000-0000-0000-000000000010';
const REQ_ID = '00000000-0000-0000-0000-000000000100';
const AGR_ID = '00000000-0000-0000-0000-000000000020';

/**
 * Track I-a — public verifier data loader. Builds a minimal fake Hono context
 * exposing the bits loadVerifyData reads: c.env.DB, c.var.services.auditLog +
 * signingKey. drizzle() is mocked to return the in-memory better-sqlite3 db.
 */
function fakeCtx() {
  return {
    env: { DB: {} as D1Database },
    var: {
      services: {
        auditLog: { verifyChain: vi.fn().mockResolvedValue({ valid: true, reason: null }) },
        signingKey: { getPublicKey: vi.fn().mockResolvedValue({ fingerprint: 'kf-test', pem: '---PEM---' }) },
      },
    },
  } as unknown as Parameters<typeof loadVerifyData>[0];
}

describe('loadVerifyData — Track I-a snapshot + signers', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, name: 'A', slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'Jane',
      clientEmail: 'jane@x', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
      price: 0, createdAt: new Date(),
    } as any);
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: '<p>Body</p>',
      version: 1, createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('returns null when the envelope is unknown', async () => {
    const data = await loadVerifyData(fakeCtx(), 'nope');
    expect(data).toBeNull();
  });

  it('includes contentSnapshot/contentHash + signers (without emails)', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: 'tok-verify-1', status: 'signed',
      signatureBase64: 'data:image/png;base64,sig',
      signedAt: new Date(),
      contentSnapshot: '<p>Pinned snapshot</p>', contentHash: 'abc123',
      createdAt: new Date(),
    });
    await db.insert(schema.agreementSigners).values([
      {
        id: 's1', tenantId: TENANT_A, requestId: REQ_ID,
        name: 'Jane Doe', email: 'jane@x', role: 'client',
        status: 'signed', channel: 'in_person', signedAt: new Date(), createdAt: new Date(1),
      },
      {
        id: 's2', tenantId: TENANT_A, requestId: REQ_ID,
        name: 'Bob Agent', email: 'bob@x', role: 'agent',
        status: 'sent', channel: null, signedAt: null, createdAt: new Date(2),
      },
    ]);
    const data = await loadVerifyData(fakeCtx(), REQ_ID);
    expect(data).not.toBeNull();
    expect(data!.reqRow.contentSnapshot).toBe('<p>Pinned snapshot</p>');
    expect(data!.reqRow.contentHash).toBe('abc123');
    expect(data!.signers).toHaveLength(2);
    expect(data!.signers[0]).toMatchObject({ name: 'Jane Doe', role: 'client', status: 'signed', channel: 'in_person' });
    expect(data!.signers[1]).toMatchObject({ name: 'Bob Agent', role: 'agent', status: 'sent' });
    // Privacy: no email field is selected onto the signer projection.
    for (const s of data!.signers) {
      expect(s).not.toHaveProperty('email');
    }
  });

  it('exposes a NULL snapshot for pre-feature envelopes', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: 'tok-verify-2', status: 'signed',
      signatureBase64: 'data:image/png;base64,sig',
      signedAt: new Date(),
      contentSnapshot: null, contentHash: null,
      createdAt: new Date(),
    });
    const data = await loadVerifyData(fakeCtx(), REQ_ID);
    expect(data).not.toBeNull();
    expect(data!.reqRow.contentSnapshot).toBeNull();
    expect(data!.reqRow.contentHash).toBeNull();
    expect(data!.signers).toEqual([]);
  });
});
