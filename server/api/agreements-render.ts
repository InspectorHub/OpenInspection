import { Hono } from 'hono';
import { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { qrToSvg } from '../lib/qr';

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
  token: string,
  baseUrl: string = '',  // pass from route wrapper; tests pass '' which omits QR
): Promise<Response> {
  const db = drizzle(d1, { schema });
  const reqRow = await db.select().from(schema.agreementRequests)
    .where(eq(schema.agreementRequests.token, token)).get();
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

  const clientName = reqRow.clientName ? escapeHtml(reqRow.clientName) : escapeHtml(reqRow.clientEmail);
  const signedAt = reqRow.signedAt ? new Date(reqRow.signedAt).toUTCString() : '';
  const sigData = reqRow.signatureBase64.startsWith('data:')
    ? reqRow.signatureBase64
    : `data:image/png;base64,${reqRow.signatureBase64}`;

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
    `<div class="body">${escapeHtml(agreement.content)}</div>` +
    `<div class="sig-block">` +
      `<div class="sig-row">` +
        `<div class="sig-cell">` +
          `<div class="label">Client</div>` +
          `<img src="${sigData}" alt="Client signature">` +
          `<div class="meta">${clientName} · ${escapeHtml(signedAt)}</div>` +
        `</div>` +
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
  token: string,
  baseUrl: string = '',  // pass from route wrapper; tests pass '' which omits QR
): Promise<Response> {
  const db = drizzle(d1, { schema });
  const reqRow = await db.select().from(schema.agreementRequests)
    .where(eq(schema.agreementRequests.token, token)).get();
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
    `<p><strong>Audit chain:</strong> ${auditRows.length} events · key <code>${escapeHtml(keyFingerprint)}</code></p>` +
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
agreementsRenderRoutes.get('/agreement-render/:tenant/:token', async (c) => {
  const tenant = c.req.param('tenant');
  const token = c.req.param('token');
  return agreementRenderHandler(c.env.DB, tenant, token, c.env.APP_BASE_URL || '');
});
agreementsRenderRoutes.get('/cert-render/:token', async (c) =>
  certRenderHandler(c.env.DB, c.req.param('token'), c.env.APP_BASE_URL || ''));

export default agreementsRenderRoutes;
