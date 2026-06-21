import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { agreementRenderHandler, certRenderHandler } from '../../server/api/agreements-render';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const INSP_ID  = '00000000-0000-0000-0000-000000000010';
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
      id: TENANT_A, name: 'A', slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'Jane',
      clientEmail: 'jane@x', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
      price: 0, createdAt: new Date(),
    } as any);
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: '<p>Agreement body</p>',
      version: 1, createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('returns 404 when requestId is unknown', async () => {
    const res = await agreementRenderHandler({} as D1Database, 'acme', '00000000-0000-0000-0000-0000000000ff');
    expect(res.status).toBe(404);
  });

  it('returns 404 when status !== signed', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane',
      token: TOKEN_A, status: 'sent', signatureBase64: null,
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    expect(res.status).toBe(404);
  });

  it('renders signed agreement HTML with client signature', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,iVBORw0KGgo=',
      signedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Jane Doe');
    expect(body).toContain('iVBORw0KGgo=');
    expect(body).toContain('Agreement body');
  });

  // The unguessable envelope requestId IS the credential (same posture as
  // cert-render and the public /verify/:id surface). The tenant slug segment is
  // informational only — it MUST NOT gate the render. Gating on it caused a
  // production incident: the public sign route POSTs to /api/public/agreements/
  // :token/sign (no :tenant segment), so requestedTenantSlug was '', the workflow
  // built /m2m/agreement-render//<id> (empty slug → router 404), and Browser
  // Rendering rasterized that "Not found" page into the emailed signed.pdf.
  it('renders regardless of the slug segment (resolves by requestId, wrong slug)', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane',
      token: TOKEN_A, status: 'signed', signatureBase64: 'data:image/png;base64,xyz',
      signedAt: new Date(), createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'wrongslug', REQ_ID);
    expect(res.status).toBe(200);
  });

  it('renders even when the slug segment is empty (regression: empty requestedTenantSlug)', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane',
      token: TOKEN_A, status: 'signed', signatureBase64: 'data:image/png;base64,xyz',
      signedAt: new Date(), createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, '', REQ_ID);
    expect(res.status).toBe(200);
  });

  it('renders inspector block when inspector pre-signed', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,clientsig',
      signedAt: new Date(),
      inspectorSignatureBase64: 'data:image/png;base64,inspectorsig',
      inspectorSignedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('clientsig');
    expect(body).toContain('inspectorsig');
    expect(body).toContain('Inspector');
  });

  it('renders only client block when inspector did NOT pre-sign', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,clientsig',
      signedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('clientsig');
    expect(body).not.toContain('Inspector');
  });

  // Track I-a — render must use the pinned content snapshot, NEVER the (now
  // mutated) live template.
  it('renders the pinned content snapshot, not the live template', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,clientsig',
      signedAt: new Date(),
      contentSnapshot: '<p>Snapshot at sign time</p>',
      contentHash: 'deadbeef',
      createdAt: new Date(),
    });
    // Mutate the live template AFTER the envelope was created/signed.
    await db.update(schema.agreements)
      .set({ content: '<p>Edited later — must NOT appear</p>' })
      .where(eq(schema.agreements.id, AGR_ID));
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Snapshot at sign time');
    expect(body).not.toContain('Edited later');
  });

  // Track I-a — two signed signers → two signature blocks with names + roles.
  it('renders one signature block per signed signer (name + role)', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,envelopesig',
      signedAt: new Date(),
      contentSnapshot: '<p>Body</p>', contentHash: 'h',
      createdAt: new Date(),
    });
    await db.insert(schema.agreementSigners).values([
      {
        id: 'sig-1', tenantId: TENANT_A, requestId: REQ_ID,
        name: 'Jane Doe', email: 'jane@x', role: 'client',
        status: 'signed', signatureBase64: 'data:image/png;base64,janesig',
        channel: 'remote', signedAt: new Date(), createdAt: new Date(1),
      },
      {
        id: 'sig-2', tenantId: TENANT_A, requestId: REQ_ID,
        name: 'Bob Agent', email: 'bob@x', role: 'agent',
        status: 'signed', signatureBase64: 'data:image/png;base64,bobsig',
        channel: 'remote', signedAt: new Date(), createdAt: new Date(2),
      },
    ]);
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Jane Doe');
    expect(body).toContain('janesig');
    expect(body).toContain('Bob Agent');
    expect(body).toContain('bobsig');
    expect(body).toContain('Agent');
    // Envelope-level signature must not be the rendered source when signers exist.
    expect(body).not.toContain('envelopesig');
  });

  // Track I-a — an in-person signer shows the in-person indicator.
  it('shows the in-person indicator for an in_person signer', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,envelopesig',
      signedAt: new Date(), contentSnapshot: '<p>Body</p>', contentHash: 'h',
      createdAt: new Date(),
    });
    await db.insert(schema.agreementSigners).values({
      id: 'sig-1', tenantId: TENANT_A, requestId: REQ_ID,
      name: 'Jane Doe', email: 'jane@x', role: 'client',
      status: 'signed', signatureBase64: 'data:image/png;base64,janesig',
      channel: 'in_person', signedAt: new Date(), createdAt: new Date(1),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const body = await res.text();
    expect(body).toContain('Signed in person');
  });

  // Track I-a — on-behalf-of line renders when set.
  it('renders the on-behalf-of line when set', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,envelopesig',
      signedAt: new Date(), contentSnapshot: '<p>Body</p>', contentHash: 'h',
      createdAt: new Date(),
    });
    await db.insert(schema.agreementSigners).values({
      id: 'sig-1', tenantId: TENANT_A, requestId: REQ_ID,
      name: 'Agent Smith', email: 'agent@x', role: 'agent',
      status: 'signed', signatureBase64: 'data:image/png;base64,agentsig',
      channel: 'remote', onBehalfOf: 'Jane Doe',
      signedAt: new Date(), createdAt: new Date(1),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const body = await res.text();
    expect(body).toContain('Signed by Agent Smith on behalf of Jane Doe');
  });

  // Track I-a — signatureBase64 is interpolated into <img src="...">; a payload
  // that breaks out of the attribute (`" onerror=...`) must be escaped, not live.
  it('escapes a signature data URL that tries to break out of the img src attribute', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,envelopesig',
      signedAt: new Date(), contentSnapshot: '<p>Body</p>', contentHash: 'h',
      createdAt: new Date(),
    });
    await db.insert(schema.agreementSigners).values({
      id: 'sig-1', tenantId: TENANT_A, requestId: REQ_ID,
      name: 'Jane Doe', email: 'jane@x', role: 'client',
      status: 'signed',
      signatureBase64: 'data:image/png;base64,abc" onerror="x',
      channel: 'remote', signedAt: new Date(), createdAt: new Date(1),
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const body = await res.text();
    // The quote is escaped...
    expect(body).toContain('&quot; onerror=&quot;x');
    // ...and the raw attribute-injection sequence is NOT present as live markup.
    expect(body).not.toContain('" onerror=');
  });

  // Track I-a — zero-signer legacy envelope with an envelope-level signature
  // still renders a single Client block (backward compat).
  it('falls back to a single client block for a zero-signer legacy envelope', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,legacysig',
      signedAt: new Date(), contentSnapshot: '<p>Body</p>', contentHash: 'h',
      createdAt: new Date(),
    });
    // No agreement_signers rows inserted.
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('legacysig');
    expect(body).toContain('Jane Doe');
    expect(body).toContain('Client');
  });
});

describe('cert-render handler', () => {
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
      id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: 'body',
      version: 1, createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('returns 404 when requestId is unknown', async () => {
    const res = await certRenderHandler({} as D1Database, '00000000-0000-0000-0000-0000000000ff');
    expect(res.status).toBe(404);
  });

  it('returns 404 when envelope status is not signed', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane',
      token: TOKEN_A, status: 'sent', signatureBase64: null,
      createdAt: new Date(),
    });
    const res = await certRenderHandler({} as D1Database, REQ_ID);
    expect(res.status).toBe(404);
  });

  it('renders certificate HTML with audit chain summary', async () => {
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
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
    const res = await certRenderHandler({} as D1Database, REQ_ID);
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
