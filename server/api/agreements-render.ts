import { Hono } from 'hono';
import { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { qrToSvg } from '../lib/qr';
import { AgreementService } from '../services/agreement.service';
import { safeISODate } from '../lib/date';

/**
 * Human-readable UTC string from a Drizzle-hydrated date value (Date object, or
 * the textual/ISO forms `safeISODate` understands). Use for the agreement /
 * signer timestamp columns, which are declared `mode: 'timestamp'` so Drizzle
 * returns Date instances.
 */
const utcDisplay = (v: unknown): string => new Date(safeISODate(v)).toUTCString();

/**
 * Human-readable UTC string from a raw unix-MILLISECOND integer. The
 * `esign_audit_logs.created_at` column is a plain `integer` (no Drizzle date
 * mode) holding `Date.now()`, so it arrives as a raw ms number — `safeISODate`
 * must NOT be used here because it treats numbers as SECONDS (×1000) and would
 * project the timestamp ~56000 years into the future.
 */
const utcDisplayMs = (ms: unknown): string => {
  const n = typeof ms === 'number' ? ms : Number(ms);
  return Number.isFinite(n) ? new Date(n).toUTCString() : '';
};

/**
 * Shared verify-QR block (Track I-a). Both render handlers emit the identical
 * markup; kept in one place so styling/escaping stay in lockstep. Returns ''
 * when there is no verification token or no baseUrl (tests pass '').
 */
function verifyQrHtml(
  verificationToken: string | null | undefined,
  baseUrl: string,
  escapeHtml: (s: string) => string,
  logPrefix: string,
): string {
  if (!verificationToken || !baseUrl) return '';
  const verifyUrl = `${baseUrl}/v/${verificationToken}`;
  try {
    const qrSvg = qrToSvg(verifyUrl, { margin: 1, width: 120 });
    return `<div style="margin-top:32px;display:flex;align-items:center;gap:16px">` +
        qrSvg +
        `<div style="font-size:11px;color:#475569">Verify this document at<br><code>${escapeHtml(verifyUrl)}</code></div>` +
    `</div>`;
  } catch (e) {
    // QR generation failure is non-fatal; render without it.
    console.warn(`${logPrefix} QR generation failed`, { error: (e as Error).message });
    return '';
  }
}

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
  const at = signer.signedAt ? escapeHtml(utcDisplay(signer.signedAt)) : '';
  const name = escapeHtml(signer.name || signer.email || 'Signer');
  const inPerson = signer.channel === 'in_person'
    ? `<span class="badge">Signed in person</span>`
    : '';
  const onBehalf = signer.onBehalfOf
    ? `<div class="meta">Signed by ${name} on behalf of ${escapeHtml(signer.onBehalfOf)}</div>`
    : '';
  return `<div class="sig-cell">` +
      `<div class="label">${escapeHtml(roleLabel(signer.role))}${inPerson}</div>` +
      `<img src="${escapeHtml(sigData)}" alt="${name} signature">` +
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
  // The unguessable envelope `requestId` (UUIDv4) IS the access credential —
  // identical posture to /m2m/cert-render/:id and the public /verify/:id surface
  // (both resolve by id alone). The `tenantSlug` path segment is INFORMATIONAL
  // only and MUST NOT gate the render. A slug gate here caused a production
  // incident: the public sign route POSTs to /api/public/agreements/:token/sign
  // (no :tenant segment) so requestedTenantSlug was '', the sign-completion
  // workflow built /m2m/agreement-render//<id> (empty slug → router 404), and
  // Browser Rendering rasterized that "Not found" page straight into the emailed
  // signed.pdf. The public tenant slug adds no real entropy over the requestId,
  // so gating on it bought nothing but this failure mode.
  void tenantSlug;
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
    const signedAt = reqRow.signedAt ? utcDisplay(reqRow.signedAt) : '';
    const sigData = reqRow.signatureBase64.startsWith('data:')
      ? reqRow.signatureBase64
      : `data:image/png;base64,${reqRow.signatureBase64}`;
    signerCellsHtml = `<div class="sig-cell">` +
        `<div class="label">Client</div>` +
        `<img src="${escapeHtml(sigData)}" alt="Client signature">` +
        `<div class="meta">${clientName} · ${escapeHtml(signedAt)}</div>` +
    `</div>`;
  }

  const inspectorBlock = reqRow.inspectorSignatureBase64 ? (() => {
      const sig = reqRow.inspectorSignatureBase64!;
      const sigData = sig.startsWith('data:') ? sig : `data:image/png;base64,${sig}`;
      const at = reqRow.inspectorSignedAt
          ? escapeHtml(utcDisplay(reqRow.inspectorSignedAt))
          : '';
      return `<div class="sig-cell">` +
          `<div class="label">Inspector</div>` +
          `<img src="${escapeHtml(sigData)}" alt="Inspector signature">` +
          `<div class="meta">${at}</div>` +
      `</div>`;
  })() : '';

  const qrHtml = verifyQrHtml(reqRow.verificationToken, baseUrl, escapeHtml, '[agreement-render]');

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

/**
 * Certificate-of-completion renderer (Track I-a).
 *
 * INTERNAL M2M SURFACE. Its route is `/m2m/cert-render/:id` — note there is NO
 * tenant segment (unlike agreementRenderHandler's `/agreement-render/:tenant/:id`,
 * which additionally asserts the slug matches). Here the unguessable
 * envelope `requestId` (a UUIDv4) IS the access credential, the same security
 * posture as the public `/verify/:envelopeId` surface. By design this renders
 * nothing beyond what `/verify` already exposes (signer roster without raw
 * emails-by-preference, audit event names + truncated hashes + key fingerprint
 * — no signatures, no secrets, no private keys), so no tenant-slug gate is
 * required or possible. If this handler is ever extended to render materially
 * more than `/verify`, add a tenant check by threading a tenant segment through
 * the route first.
 */
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
        const at = s.signedAt ? escapeHtml(utcDisplay(s.signedAt)) : '';
        const name = escapeHtml(s.name || s.email || 'Signer');
        const inPerson = s.channel === 'in_person' ? ' · Signed in person' : '';
        const onBehalf = s.onBehalfOf ? ` · on behalf of ${escapeHtml(s.onBehalfOf)}` : '';
        return `<li>${escapeHtml(roleLabel(s.role))}: ${name}${inPerson}${onBehalf} · ${at}</li>`;
      }).join('')
    : `<li>Client: ${escapeHtml(clientLabel)}${reqRow.signedAt ? ` · ${escapeHtml(utcDisplay(reqRow.signedAt))}` : ''}</li>`;

  const rowsHtml = auditRows.map((r) => `
    <tr>
      <td style="padding:4px 8px">${escapeHtml(utcDisplayMs(r.createdAt))}</td>
      <td style="padding:4px 8px">${escapeHtml(r.event)}</td>
      <td style="padding:4px 8px"><code>${escapeHtml(r.hash.slice(0, 16))}…</code></td>
    </tr>`).join('');

  const qrHtml = verifyQrHtml(reqRow.verificationToken, baseUrl, escapeHtml, '[cert-render]');

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
