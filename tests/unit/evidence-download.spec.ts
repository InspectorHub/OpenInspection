import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { downloadAgreementPdf, downloadCertPdf, downloadEvidenceZip } from '../../server/api/evidence';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const REQ_ID   = '00000000-0000-0000-0000-000000000100';
const AGR_ID   = '00000000-0000-0000-0000-000000000020';

describe('downloadAgreementPdf', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, name: 'A', slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'A', content: 'x',
      version: 1, createdAt: new Date(),
    });
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', token: 'tk', status: 'signed',
      signatureBase64: 'data:image/png;base64,abc',
      signedAt: new Date(), createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('returns 500 when R2 binding is undefined', async () => {
    const res = await downloadAgreementPdf({} as D1Database, undefined, REQ_ID, TENANT_A);
    expect(res.status).toBe(500);
  });

  it('returns 404 when envelope does not belong to caller tenant', async () => {
    const r2 = { get: vi.fn() } as unknown as R2Bucket;
    const res = await downloadAgreementPdf({} as D1Database, r2, REQ_ID, '00000000-0000-0000-0000-000000000999');
    expect(res.status).toBe(404);
    expect(r2.get).not.toHaveBeenCalled();
  });

  it('returns 404 when envelope is not signed', async () => {
    await db.update(schema.agreementRequests).set({ status: 'sent' });
    const r2 = { get: vi.fn() } as unknown as R2Bucket;
    const res = await downloadAgreementPdf({} as D1Database, r2, REQ_ID, TENANT_A);
    expect(res.status).toBe(404);
    expect(r2.get).not.toHaveBeenCalled();
  });

  it('streams R2 object on tenant + status match', async () => {
    const fakeBody = new TextEncoder().encode('%PDF-fake').buffer;
    const r2 = { get: vi.fn().mockResolvedValue({ body: fakeBody }) } as unknown as R2Bucket;
    const res = await downloadAgreementPdf({} as D1Database, r2, REQ_ID, TENANT_A);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('signed-agreement');
    expect(r2.get).toHaveBeenCalledWith(`tenants/${TENANT_A}/agreements/${REQ_ID}/signed.pdf`);
  });

  it('returns 404 when R2 object is missing', async () => {
    const r2 = { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket;
    const res = await downloadAgreementPdf({} as D1Database, r2, REQ_ID, TENANT_A);
    expect(res.status).toBe(404);
  });
});

describe('downloadCertPdf', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, name: 'A', slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'A', content: 'x',
      version: 1, createdAt: new Date(),
    });
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', token: 'tk', status: 'signed',
      signatureBase64: 'data:image/png;base64,abc',
      signedAt: new Date(), createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('refuses cross-tenant access', async () => {
    const r2 = { get: vi.fn() } as unknown as R2Bucket;
    const res = await downloadCertPdf({} as D1Database, r2, REQ_ID, '00000000-0000-0000-0000-000000000999');
    expect(res.status).toBe(404);
    expect(r2.get).not.toHaveBeenCalled();
  });

  it('streams certificate.pdf on tenant match', async () => {
    const r2 = { get: vi.fn().mockResolvedValue({ body: new Uint8Array(8).buffer }) } as unknown as R2Bucket;
    const res = await downloadCertPdf({} as D1Database, r2, REQ_ID, TENANT_A);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(r2.get).toHaveBeenCalledWith(`tenants/${TENANT_A}/agreements/${REQ_ID}/certificate.pdf`);
  });

  it('returns 404 when cert R2 object missing', async () => {
    const r2 = { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket;
    const res = await downloadCertPdf({} as D1Database, r2, REQ_ID, TENANT_A);
    expect(res.status).toBe(404);
  });
});

describe('downloadEvidenceZip', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, name: 'A', slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'A', content: 'x',
      version: 1, createdAt: new Date(),
    });
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', token: 'tk', status: 'signed',
      signatureBase64: 'data:image/png;base64,abc',
      signedAt: new Date(), createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('refuses cross-tenant access', async () => {
    const r2 = { get: vi.fn() } as unknown as R2Bucket;
    const res = await downloadEvidenceZip({} as D1Database, r2, REQ_ID, '00000000-0000-0000-0000-000000000999');
    expect(res.status).toBe(404);
    expect(r2.get).not.toHaveBeenCalled();
  });

  it('streams evidence.zip from R2 with application/zip content-type', async () => {
    const r2 = { get: vi.fn().mockResolvedValue({ body: new Uint8Array([80, 75]).buffer }) } as unknown as R2Bucket;
    const res = await downloadEvidenceZip({} as D1Database, r2, REQ_ID, TENANT_A);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toContain('evidence');
    expect(r2.get).toHaveBeenCalledWith(`tenants/${TENANT_A}/agreements/${REQ_ID}/evidence.zip`);
  });

  it('returns 404 when evidence.zip is missing from R2', async () => {
    const r2 = { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket;
    const res = await downloadEvidenceZip({} as D1Database, r2, REQ_ID, TENANT_A);
    expect(res.status).toBe(404);
  });
});
