import { Hono } from 'hono';
import { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { qrToSvg } from '../lib/qr';
import { AgreementService } from '../services/agreement.service';

/** Human-readable label for a signer role. */
const roleLabel = (role: string | null | undefined): string => {
  switch (role) {
    case 'co_client': return 'Co-Client';
    case 'agent': return 'Agent';
    case 'other': return 'Signer';
    case 'client':
    default: return 'Client';
  }
};

/**
 * Renders a single signature cell for a signed signer (Track I-a). Includes the
 * role label, signature image, signer name + timestamp, an in-person badge when
 * the signature was captured in person, and an "on behalf of" line for an
 * authorized agent.
 */
function signerCellHtml(
  signer: typeof schema.agreementSigners.$inferSelect,
  escapeHtml: (s: string) => string,
): string {
  const sig = signer.signatureBase64 ?? '';
  const sigData = sig.startsWith('data:') ? sig : `data:image/png;base64,${sig}`;
  const at = signer.signedAt ? escapeHtml(new Date(signer.signedAt).toUTCString()) : '';
  const name = escapeHtml(signer.name || signer.email || 'Signer');
  const inPerson = signer.channel === 'in_person'
    ? `<span class="badge">Signed in person</span>`
    : '';
  const onBehalf = signer.onBehalfOf
    ? `<div class="meta">Signed by ${name} on behalf of ${escapeHtml(signer.onBehalfOf)}</div>`
    : '';
  return `<div class="sig-cell">` +
      `<div class="label">${escapeHtml(roleLabel(signer.role))}${inPerson}</div>` +
      `<img src="${sigData}" alt="${name} signature">` +
      `<div class="meta">${name} · ${at}</div>` +
      onBehalf +
  `</div>`;
}

const HTML_HEAD = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 720px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 18px; margin: 0 0 24px 0; }
  .body { white-space: pre-wrap; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; }
  .sig-block { margin-top: 32px; padding-top: 16px; border-top: 2px solid #0f172a; }
  .sig-row { display: flex; gap: 24px; margin-top: 16px; }
  .sig-cell { flex: 1; }
  .sig-cell img { max-width: 200px; max-height: 80px; background: #fafafa; padding: 4px; border: 1px solid #cbd5e1; }
  .sig-cell .meta { margin-top: 4px; font-size: 12px; color: #475569; }
  .sig-cell .label { font-weight: 600; margin-bottom: 8px; }
  .sig-cell .badge { display: inline-block; margin-left: 8px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #1e40af; background: #dbeafe; border-radius: 9999px; padding: 1px 8px; vertical-align: middle; }
  @media print { body { margin: 0; padding: 0; } }
</style></head><body>`;
const HTML_FOOT = `</body></html>`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Pure render handler exported for unit testing. Takes a D1Database and the
 * URL path params; the live route in index.ts wraps this with tenant routing
 * resolution.
 *
 * NOTE: Inspector pre-sign signature rendering is deferred to Phase 2 once
 * the schema columns (inspector_signature_base64, inspector_signed_at,
 * inspector_user_id) exist on agreement_requests. This handler currently
 * renders the client signature only.
 */
export async function agreementRenderHandler(
  d1: D1Database,
  tenantSlug: string,
  requestId: string,
  baseUrl: string = '',  // pass from route wrapper; tests pass '' which omits QR
): Promise<Response> {
  // Track I-a — resolved by the stable envelope requestId (NOT the legacy
  // plaintext `token` column, which is now a never-distributed UUID
  // placeholder). The unguessable requestId is the URL secret, same posture
  // as /verify/:requestId and the R2 object keys.
  const db = drizzle(d1, { schema });
  const reqRow = await db.select().from(schema.agreementRequests)
    .where(eq(schema.agreementRequests.id, requestId)).get();
  if (!reqRow || reqRow.status !== 'signed' || !reqRow.signatureBase64) {
    return new Response('Not Found', { status: 404 });
  }
  const tenant = await db.select({ slug: schema.tenants.slug })
    .from(schema.tenants).where(eq(schema.tenants.id, reqRow.tenantId)).get();
  if (!tenant || tenant.slug !== tenantSlug) {
    return new Response('Not Found', { status: 404 });
  }
  const agreement = await db.select().from(schema.agreements)
    .where(eq(schema.agreements.id, reqRow.agreementId)).get();
  if (!agreement) return new Response('Not Found', { status: 404 });

  // Track I-a — "what was signed" comes from the pinned content snapshot, never
  // the live template. The service handles snapshot ?? live-template fallback
  // (with self-heal) so the render path never drifts from the rest of the app.
  const svc = new AgreementService(d1);
  const { content: snapshotContent } = await svc.getSnapshotForRequest(reqRow);

  // Track I-a — one signature block PER SIGNED SIGNER (name, role, timestamp,
  // in-person badge, on-behalf-of line). Backward-compat: an envelope with zero
  // signer rows but a legacy envelope-level signature falls back to a single
  // Client block built from the envelope columns.
  const signers = await db.select().from(schema.agreementSigners)
    .where(eq(schema.agreementSigners.requestId, reqRow.id))
    .orderBy(asc(schema.agreementSigners.createdAt))
    .all();
  const signedSigners = signers.filter((s) => s.status === 'signed' && s.signatureBase64);

  let signerCellsHtml: string;
  if (signedSigners.length > 0) {
    signerCellsHtml = signedSigners.map((s) => signerCellHtml(s, escapeHtml)).join('');
  } else {
    // Legacy single-block fallback (pre-backfill envelopes with no signer rows).
    const clientName = reqRow.clientName ? escapeHtml(reqRow.clientName) : escapeHtml(reqRow.clientEmail);
    const signedAt = reqRow.signedAt ? new Date(reqRow.signedAt).toUTCString() : '';
    const sigData = reqRow.signatureBase64.startsWith('data:')
      ? reqRow.signatureBase64
      : `data:image/png;base64,${reqRow.signatureBase64}`;
    signerCellsHtml = `<div class="sig-cell">` +
        `<div class="label">Client</div>` +
        `<img src="${sigData}" alt="Client signature">` +
        `<div class="meta">${clientName} · ${escapeHtml(signedAt)}</div>` +
    `</div>`;
  }

  const inspectorBlock = reqRow.inspectorSignatureBase64 ? (() => {
      const sig = reqRow.inspectorSignatureBase64!;
      const sigData = sig.startsWith('data:') ? sig : `data:image/png;base64,${sig}`;
      const at = reqRow.inspectorSignedAt
          ? escapeHtml(new Date(reqRow.inspectorSignedAt).toUTCString())
          : '';
      return `<div class="sig-cell">` +
          `<div class="label">Inspector</div>` +
          `<img src="${sigData}" alt="Inspector signature">` +
          `<div class="meta">${at}</div>` +
      `</div>`;
  })() : '';

  let qrHtml = '';
  if (reqRow.verificationToken && baseUrl) {
      const verifyUrl = `${baseUrl}/v/${reqRow.verificationToken}`;
      try {
          const qrSvg = qrToSvg(verifyUrl, { margin: 1, width: 120 });
          qrHtml = `<div style="margin-top:32px;display:flex;align-items:center;gap:16px">` +
              qrSvg +
              `<div style="font-size:11px;color:#475569">Verify this document at<br><code>${escapeHtml(verifyUrl)}</code></div>` +
          `</div>`;
      } catch (e) {
          // QR generation failure is non-fatal; render without it
          console.warn('[agreement-render] QR generation failed', { error: (e as Error).message });
      }
  }

  const html = HTML_HEAD +
    `<h1>${escapeHtml(agreement.name)}</h1>` +
    `<div class="body">${escapeHtml(snapshotContent)}</div>` +
    `<div class="sig-block">` +
      `<div class="sig-row">` +
        signerCellsHtml +
        inspectorBlock +
      `</div>` +
    `</div>` +
    qrHtml +
    HTML_FOOT;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function certRenderHandler(
  d1: D1Database,
  requestId: string,
  baseUrl: string = '',  // pass from route wrapper; tests pass '' which omits QR
): Promise<Response> {
  // Track I-a — resolved by the stable envelope requestId (see
  // agreementRenderHandler note on the dead `token` column).
  const db = drizzle(d1, { schema });
  const reqRow = await db.select().from(schema.agreementRequests)
    .where(eq(schema.agreementRequests.id, requestId)).get();
  if (!reqRow || reqRow.status !== 'signed') {
    return new Response('Not Found', { status: 404 });
  }
  const auditRows = await db.select().from(schema.esignAuditLogs)
    .where(and(
      eq(schema.esignAuditLogs.tenantId, reqRow.tenantId),
      eq(schema.esignAuditLogs.requestId, reqRow.id),
    ))
    .orderBy(asc(schema.esignAuditLogs.createdAt))
    .all();
  const keyFingerprint = auditRows[0]?.keyFingerprint ?? 'unknown';
  const clientLabel = reqRow.clientName ?? reqRow.clientEmail;

  // Track I-a — per-signer roster: who signed, in what role/channel, when, and
  // on whose behalf. Falls back to the envelope-level client when no signer rows
  // exist (legacy pre-backfill envelope).
  const signers = await db.select().from(schema.agreementSigners)
    .where(eq(schema.agreementSigners.requestId, reqRow.id))
    .orderBy(asc(schema.agreementSigners.createdAt))
    .all();
  const signedSigners = signers.filter((s) => s.status === 'signed');
  const signersHtml = signedSigners.length > 0
    ? signedSigners.map((s) => {
        const at = s.signedAt ? escapeHtml(new Date(s.signedAt).toUTCString()) : '';
        const name = escapeHtml(s.name || s.email || 'Signer');
        const inPerson = s.channel === 'in_person' ? ' · Signed in person' : '';
        const onBehalf = s.onBehalfOf ? ` · on behalf of ${escapeHtml(s.onBehalfOf)}` : '';
        return `<li>${escapeHtml(roleLabel(s.role))}: ${name}${inPerson}${onBehalf} · ${at}</li>`;
      }).join('')
    : `<li>Client: ${escapeHtml(clientLabel)}${reqRow.signedAt ? ` · ${escapeHtml(new Date(reqRow.signedAt).toUTCString())}` : ''}</li>`;

  const rowsHtml = auditRows.map((r) => `
    <tr>
      <td style="padding:4px 8px">${escapeHtml(new Date(r.createdAt).toUTCString())}</td>
      <td style="padding:4px 8px">${escapeHtml(r.event)}</td>
      <td style="padding:4px 8px"><code>${escapeHtml(r.hash.slice(0, 16))}…</code></td>
    </tr>`).join('');

  let qrHtml = '';
  if (reqRow.verificationToken && baseUrl) {
      const verifyUrl = `${baseUrl}/v/${reqRow.verificationToken}`;
      try {
          const qrSvg = qrToSvg(verifyUrl, { margin: 1, width: 120 });
          qrHtml = `<div style="margin-top:32px;display:flex;align-items:center;gap:16px">` +
              qrSvg +
              `<div style="font-size:11px;color:#475569">Verify this document at<br><code>${escapeHtml(verifyUrl)}</code></div>` +
          `</div>`;
      } catch (e) {
          // QR generation failure is non-fatal; render without it
          console.warn('[cert-render] QR generation failed', { error: (e as Error).message });
      }
  }

  const html = HTML_HEAD +
    `<h1>Certificate of Completion</h1>` +
    `<p><strong>Document:</strong> Signed agreement for ${escapeHtml(clientLabel)}</p>` +
    `<p><strong>Envelope ID:</strong> <code>${escapeHtml(reqRow.id)}</code></p>` +
    `<p><strong>Signed by:</strong></p>` +
    `<ul style="margin:4px 0 0 0;padding-left:20px">${signersHtml}</ul>` +
    `<p style="margin-top:16px"><strong>Audit chain:</strong> ${auditRows.length} events · key <code>${escapeHtml(keyFingerprint)}</code></p>` +
    `<table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:12px">` +
    `<thead><tr style="border-bottom:1px solid #cbd5e1;text-align:left">` +
      `<th style="padding:4px 8px">Time (UTC)</th>` +
      `<th style="padding:4px 8px">Event</th>` +
      `<th style="padding:4px 8px">Hash</th>` +
    `</tr></thead>` +
    `<tbody>${rowsHtml}</tbody></table>` +
    `<p style="margin-top:32px;font-size:11px;color:#64748b">` +
      `All chain events were signed with Ed25519 and chained via SHA-256.` +
    `</p>` +
    qrHtml +
    HTML_FOOT;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

const agreementsRenderRoutes = new Hono<HonoConfig>();
// :id is the stable envelope requestId (Track I-a; the legacy plaintext token
// column is no longer distributed). The path segment is named :id; the
// historical `:token` shape is retired.
agreementsRenderRoutes.get('/agreement-render/:tenant/:id', async (c) => {
  const tenant = c.req.param('tenant');
  const id = c.req.param('id');
  return agreementRenderHandler(c.env.DB, tenant, id, c.env.APP_BASE_URL || '');
});
agreementsRenderRoutes.get('/cert-render/:id', async (c) =>
  certRenderHandler(c.env.DB, c.req.param('id'), c.env.APP_BASE_URL || ''));

export default agreementsRenderRoutes;
