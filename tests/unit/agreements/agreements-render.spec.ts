import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { agreementRenderHandler, certRenderHandler } from '../../../server/api/agreements-render';
import { AGREEMENT_LANGUAGE_DISCLOSURE } from '../../../server/lib/legal/agreement-language-disclosure';

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
      id: TENANT_A, slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St',
      date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
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
      id: TENANT_A, slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St',
      date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
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
    const events = ['request.created', 'request.sent', 'agreement.signed'] as const;
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
        createdAt: new Date(Date.UTC(2026, 4, 28, 10, 0, i)),
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

// ---------------------------------------------------------------------------
// Language disclosure in the ARCHIVED copy (the document a dispute produces).
//
// The signing screen and this document have to agree. A signer told on screen
// that the agreement is English-only, holding a signed PDF that says nothing of
// the kind, is left worse off than if we had never shown the note: the record
// now contradicts what happened.
//
// Equally, the note must stay OUT of the body box. That div holds the pinned
// content snapshot verbatim, `content_hash` is taken over the stored string, and
// anything added inside it would both rewrite the record of what was signed and
// make us the author of a term in a contract we are not a party to.
//
// And the agreement has to be MUTUAL: the document may only carry the note when
// the signatures on it recorded the version of the copy that is live now. There
// is no archive of superseded copy, so against an older signature the choice is
// between printing nothing and printing words that signer never read.
// ---------------------------------------------------------------------------

const SIGNER_ID = '00000000-0000-0000-0000-000000000200';

/**
 * A signed signer on REQ_ID whose record says which disclosure version it saw.
 * `version` null = the record says nothing (pre-feature signature, or the
 * on-site API surface the platform does not draw).
 */
async function insertSignedSigner(
  db: BetterSQLite3Database<typeof schema>,
  version: number | null,
): Promise<void> {
  await db.insert(schema.agreementSigners).values({
    id: SIGNER_ID, tenantId: TENANT_A, requestId: REQ_ID,
    name: 'Jane Doe', email: 'jane@x', role: 'client', status: 'signed',
    signatureBase64: 'data:image/png;base64,clientsig',
    signedAt: new Date(), createdAt: new Date(),
    languageDisclosureVersion: version,
  });
}

/** The verbatim contents of the `.body` box — the snapshot, and nothing else. */
function bodyBoxOf(html: string): string {
  // escapeHtml() leaves no markup inside the box, so the first closing tag is
  // the box's own. Asserted below rather than assumed.
  const m = html.match(/<div class="body">([\s\S]*?)<\/div>/);
  return m ? m[1] : '';
}

describe('agreement-render handler — language disclosure', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St',
      date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
      price: 0, createdAt: new Date(),
    } as never);
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: '<p>Agreement body</p>',
      version: 1, createdAt: new Date(),
    });
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
    await insertSignedSigner(db, AGREEMENT_LANGUAGE_DISCLOSURE.version);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('carries the disclosure into the signed document', async () => {
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const html = await res.text();
    expect(html).toMatch(/provided in English/i);
    expect(html).toContain('Not part of this agreement');
    // The wrapper travels with it: the shape is what marks it as a note.
    expect(html).toContain('role="note"');
  });

  it('places it OUTSIDE the body box', async () => {
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const html = await res.text();
    const box = bodyBoxOf(html);
    // Prove the extractor sees the box before trusting what it does not see.
    expect(box).toContain('Snapshot at sign time');
    expect(box).not.toMatch(/provided in English/i);
    expect(box).not.toContain('Not part of this agreement');
    // …and it lands after the box, before the signatures — a note about the
    // document, read in the order a person reads the page.
    expect(html.indexOf('Not part of this agreement')).toBeGreaterThan(html.indexOf('Snapshot at sign time'));
    const sigBlock = html.indexOf('<div class="sig-block">');
    expect(sigBlock).toBeGreaterThan(-1);
    expect(html.indexOf('Not part of this agreement')).toBeLessThan(sigBlock);
  });

  it('writes nothing — the snapshot and its hash survive the render', async () => {
    await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const row = await db.select().from(schema.agreementRequests)
      .where(eq(schema.agreementRequests.id, REQ_ID)).get();
    expect(row!.contentSnapshot).toBe('<p>Snapshot at sign time</p>');
    expect(row!.contentSnapshot).not.toMatch(/provided in English/i);
    // contentHash is SHA-256 of the stored string. Because the disclosure never
    // enters that string, no existing signature is invalidated by shipping this.
    expect(row!.contentHash).toBe('deadbeef');
    const agreement = await db.select().from(schema.agreements)
      .where(eq(schema.agreements.id, AGR_ID)).get();
    expect(agreement!.content).toBe('<p>Agreement body</p>');
  });

  // The three cases below are the whole reason the version is on the signature.
  // Each replaces the signer seeded in beforeEach, so the ONLY difference
  // between them and the passing case above is what the record says.

  it('omits it when the signature recorded no version at all', async () => {
    await db.delete(schema.agreementSigners).where(eq(schema.agreementSigners.id, SIGNER_ID));
    await insertSignedSigner(db, null);
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const html = await res.text();
    // The document still renders — it is only the claim that is withheld.
    expect(html).toContain('Snapshot at sign time');
    expect(html).not.toMatch(/provided in English/i);
    expect(html).not.toContain('Not part of this agreement');
  });

  it('omits it when the signature recorded a SUPERSEDED version', async () => {
    await db.delete(schema.agreementSigners).where(eq(schema.agreementSigners.id, SIGNER_ID));
    await insertSignedSigner(db, AGREEMENT_LANGUAGE_DISCLOSURE.version - 1);
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const html = await res.text();
    expect(html).toContain('Snapshot at sign time');
    // Superseded copy is not archived. Printing today's words here would put a
    // sentence in front of a judge that this signer demonstrably did not read.
    expect(html).not.toMatch(/provided in English/i);
  });

  it('omits it when ONE of several signers has no version — the document is one record', async () => {
    await db.insert(schema.agreementSigners).values({
      id: '00000000-0000-0000-0000-000000000201', tenantId: TENANT_A, requestId: REQ_ID,
      name: 'John Doe', email: 'john@x', role: 'co_client', status: 'signed',
      signatureBase64: 'data:image/png;base64,cosig',
      signedAt: new Date(), createdAt: new Date(),
      languageDisclosureVersion: null,
    });
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const html = await res.text();
    expect(html).not.toMatch(/provided in English/i);
  });

  it('the legacy envelope-level signature (no signer rows) carries no claim', async () => {
    await db.delete(schema.agreementSigners).where(eq(schema.agreementSigners.requestId, REQ_ID));
    const res = await agreementRenderHandler({} as D1Database, 'acme', REQ_ID);
    const html = await res.text();
    // Fallback block still renders the signature…
    expect(html).toContain('Jane Doe');
    // …and says nothing about a notice nobody recorded.
    expect(html).not.toMatch(/provided in English/i);
  });
});

// ---------------------------------------------------------------------------
// The certificate of completion is a different kind of document: it states
// FACTS ABOUT the signing event rather than reproducing what was signed. So it
// can report a superseded version number honestly — "notice v1 was displayed"
// is true forever — where the archived copy above cannot reproduce v1's words.
// ---------------------------------------------------------------------------
describe('cert-render handler — language disclosure version', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT_A, slug: 'acme', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
      id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St',
      date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
      price: 0, createdAt: new Date(),
    } as never);
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: '<p>Agreement body</p>',
      version: 1, createdAt: new Date(),
    });
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
      clientEmail: 'jane@x', clientName: 'Jane Doe',
      token: TOKEN_A, status: 'signed',
      signatureBase64: 'data:image/png;base64,clientsig',
      signedAt: new Date(), createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('reports the version the signer was shown', async () => {
    await insertSignedSigner(db, AGREEMENT_LANGUAGE_DISCLOSURE.version);
    const res = await certRenderHandler({} as D1Database, REQ_ID);
    const html = await res.text();
    expect(html).toContain(`Language notice v${AGREEMENT_LANGUAGE_DISCLOSURE.version} displayed`);
  });

  it('reports a version that is NOT the current one rather than suppressing it', async () => {
    const superseded = AGREEMENT_LANGUAGE_DISCLOSURE.version - 1;
    await insertSignedSigner(db, superseded);
    const res = await certRenderHandler({} as D1Database, REQ_ID);
    const html = await res.text();
    expect(html).toContain(`Language notice v${superseded} displayed`);
  });

  it('says nothing when nothing was recorded — no "v0", no "none"', async () => {
    await insertSignedSigner(db, null);
    const res = await certRenderHandler({} as D1Database, REQ_ID);
    const html = await res.text();
    // Prove the roster rendered before trusting the absence.
    expect(html).toContain('Jane Doe');
    expect(html).not.toMatch(/Language notice/i);
  });
});
