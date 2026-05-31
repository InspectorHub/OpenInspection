import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../src/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { agreementRenderHandler, certRenderHandler } from '../../src/api/agreements-render';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const REQ_ID   = '00000000-0000-0000-0000-000000000100';
const AGR_ID   = '00000000-0000-0000-0000-000000000020';
const TOKEN_A  = 'live-token-abcdef0123456789';

describe('agreement-render handler', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, name: 'A', subdomain: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: '<p>Agreement body</p>',
      version: 1, createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('returns 404 when token is unknown', async () => {
    const res = await agreementRenderHandler({} as D1Database, 'acme', 'bogus-token');
    expect(res.status).toBe(404);
  });

  it('returns 404 when status !== signed', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane',
      token: TOKEN_A, status: 'sent', signatureBase64: null,
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', TOKEN_A);
    expect(res.status).toBe(404);
  });

  it('renders signed agreement HTML with client signature', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,iVBORw0KGgo=',
      signedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Jane Doe');
    expect(body).toContain('iVBORw0KGgo=');
    expect(body).toContain('Agreement body');
  });

  it('returns 404 when tenant slug does not match', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane',
      token: TOKEN_A, status: 'signed', signatureBase64: 'data:image/png;base64,xyz',
      signedAt: new Date(), createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'wrongslug', TOKEN_A);
    expect(res.status).toBe(404);
  });

  it('renders inspector block when inspector pre-signed', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,clientsig',
      signedAt: new Date(),
      inspectorSignatureBase64: 'data:image/png;base64,inspectorsig',
      inspectorSignedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', TOKEN_A);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('clientsig');
    expect(body).toContain('inspectorsig');
    expect(body).toContain('Inspector');
  });

  it('renders only client block when inspector did NOT pre-sign', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,clientsig',
      signedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', TOKEN_A);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('clientsig');
    expect(body).not.toContain('Inspector');
  });
});

describe('cert-render handler', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, name: 'A', subdomain: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: 'body',
      version: 1, createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('returns 404 when token is unknown', async () => {
    const res = await certRenderHandler({} as D1Database, 'bogus');
    expect(res.status).toBe(404);
  });

  it('returns 404 when envelope status is not signed', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane',
      token: TOKEN_A, status: 'sent', signatureBase64: null,
      createdAt: new Date(),
    });
    const res = await certRenderHandler({} as D1Database, TOKEN_A);
    expect(res.status).toBe(404);
  });

  it('renders certificate HTML with audit chain summary', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,abc',
      signedAt: new Date(),
      createdAt: new Date(),
    });
    const events = ['request.created', 'request.sent', 'agreement.signed'];
    for (let i = 0; i < events.length; i++) {
      await db.insert(schema.esignAuditLogs).values({
        id: '00000000-0000-0000-0000-' + String(i).padStart(12, '0'),
        tenantId: TENANT_A,
        requestId: REQ_ID,
        event: events[i],
        payloadJson: '{}',
        prevHash: i === 0 ? '' : `hash${i-1}aaaaaaaaaaaaaaa`,
        hash: `hash${i}aaaaaaaaaaaaaaa`,
        signature: `sig${i}`,
        keyFingerprint: 'kf-test-fingerprint',
        createdAt: new Date(Date.UTC(2026, 4, 28, 10, 0, i)).getTime(),
      });
    }
    const res = await certRenderHandler({} as D1Database, TOKEN_A);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Certificate of Completion');
    expect(body).toContain('Jane Doe');
    expect(body).toContain('agreement.signed');
    expect(body).toContain('3 events');
    expect(body).toContain('kf-test-fingerprint');
    // First 16 chars of hash should appear; full 17-char hash should NOT
    expect(body).toContain('hash2aaaaaaaaaaa');
  });
});
