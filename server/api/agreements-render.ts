import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { qrToSvg } from '../lib/qr';
import { AgreementService } from '../services/agreement.service';
import {
  AGREEMENT_LANGUAGE_DISCLOSURE,
  signaturesRecordCurrentDisclosure,
} from '../lib/legal/agreement-language-disclosure';
import { safeISODate } from '../lib/date';
import { logger } from '../lib/logger';
import { agreementRenderAllowed } from '../lib/render-token';

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
    logger.warn(`${logPrefix} QR generation failed`, { error: (e as Error).message });
    return '';
  }
}

/**
 * The `src` for a stored signature, or null when what is stored is not a picture this page will embed. A signature arrives as text from
 * the signer's browser, so it is embedded only if it is a base64 PNG, JPEG, GIF or WebP data URL (or bare base64, which is a PNG): a
 * `data:` URL of any other type, a link, or anything else gets a plain "not available" line in the signature block instead of a source.
 */
const SIGNATURE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const BARE_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
function signatureImageSrc(sig: string): string | null {
  if (SIGNATURE_DATA_URL.test(sig)) return sig;
  if (BARE_BASE64.test(sig)) return `data:image/png;base64,${sig}`;
  return null;
}

/** The signature picture, or a line saying there is none to show. */
function signatureImgHtml(sig: string, alt: string, escapeHtml: (s: string) => string): string {
  const src = signatureImageSrc(sig);
  return src
    ? `<img src="${escapeHtml(src)}" alt="${alt}">`
    : `<div class="meta">[signature image not available]</div>`;
}

/** What stands where a drawn signature would be, for a request that did not carry a valid render token. */
const SIGNATURE_ON_FILE = `<div class="meta">[signature on file]</div>`;
/** Headers for both render pages: they name people and are not for caches or search indexes. */
const RENDER_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
} as const;

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
  withImages: boolean,
): string {
  const sig = signer.signatureBase64 ?? '';
  const at = signer.signedAt ? escapeHtml(utcDisplay(signer.signedAt)) : '';
  // A signer's name, never their email address: a document that is shared and printed should not print an address the signer was
  // never asked to put on it. A signer with no name shows as the role-neutral "Signer".
  const name = escapeHtml(signer.name || 'Signer');
  const inPerson = signer.channel === 'in_person'
    ? `<span class="badge">Signed in person</span>`
    : '';
  const onBehalf = signer.onBehalfOf
    ? `<div class="meta">Signed by ${name} on behalf of ${escapeHtml(signer.onBehalfOf)}</div>`
    : '';
  return `<div class="sig-cell">` +
      `<div class="label">${escapeHtml(roleLabel(signer.role))}${inPerson}</div>` +
      (withImages ? signatureImgHtml(sig, `${name} signature`, escapeHtml) : SIGNATURE_ON_FILE) +
      `<div class="meta">${name} · ${at}</div>` +
      onBehalf +
  `</div>`;
}

const HTML_HEAD = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #0f172a; max-width: 720px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 18px; margin: 0 0 24px 0; }
  .body { white-space: pre-wrap; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; }
  .lang-note { margin-top: 12px; font-size: 12px; color: #475569; }
  .lang-note .label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; }
  .lang-note p { margin: 4px 0 0 0; }
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
 * The platform language disclosure, as it appears in the ARCHIVED copy — the
 * document a dispute produces. Emitted as a sibling of `.body`, after it and
 * outside its border, in the same muted register as the verify block: this is
 * the platform speaking about the document, not a term of it, and the heading
 * says so in words rather than relying on a reader to read a border.
 *
 * It is deliberately not inside `.body`. That div holds the pinned content
 * snapshot verbatim, the snapshot is what `content_hash` is taken over, and
 * anything added to it would both alter the record of what was signed and
 * become a clause we wrote in a contract we are not a party to.
 *
 * Emitted raw rather than escaped because it is a frozen module constant with
 * no interpolation — the markup IS the payload here, and it carries no href,
 * src or event attribute for escaping to protect against. Workers have no DOM,
 * so there is no sanitizer pass available on this path; the guard is that the
 * string is ours and fixed, asserted by
 * `tests/unit/agreements/language-disclosure.spec.ts`.
 *
 * Returns '' unless every signature on this document recorded the version of
 * the copy that is live right now — see `signaturesRecordCurrentDisclosure`.
 * This document is produced in a dispute, and a signing screen's copy printed
 * next to a signature that predates it would read as evidence of what that
 * person was shown. Silence is the accurate answer when the record has none.
 */
const languageNoteHtml = (
  signerDisclosureVersions: ReadonlyArray<number | null | undefined>,
): string => {
  if (!signaturesRecordCurrentDisclosure(signerDisclosureVersions)) return '';
  return `<div class="lang-note">` +
    `<div class="label">${escapeHtml(AGREEMENT_LANGUAGE_DISCLOSURE.label)}</div>` +
    AGREEMENT_LANGUAGE_DISCLOSURE.html +
  `</div>`;
};

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
  withImages: boolean = false,  // true only for a request that carried a valid render token (see the route below)
): Promise<Response> {
  // Track I-a — resolved by the stable envelope requestId. The unguessable
  // requestId is the URL secret, same posture as /verify/:requestId and the R2
  // object keys.
  const db = drizzle(d1, { schema });
  const reqRow = await db.select().from(schema.agreementRequests)
    .where(eq(schema.agreementRequests.id, requestId)).get();
  if (!reqRow || reqRow.status !== 'signed') {
    return new Response('Not Found', { status: 404 });
  }
  // The unguessable `requestId` (UUIDv4) is the access credential for the document, as for /m2m/cert-render/:id and /verify/:id. PUBLIC
  // (`/m2m/` is unauthenticated); the verify page's document link redirects here and, without a render token, shows no drawn signatures.
  // `tenantSlug` is INFORMATIONAL and MUST NOT gate the render: a slug gate once made the workflow's PDF a rasterized "Not found" page
  // (the public sign route has no :tenant segment, so the slug arrived '').
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
  // in-person badge, on-behalf-of line).
  //
  // The signer rows are the ONLY source. There used to be a second branch here
  // reading an envelope-level copy for pre-signer-model envelopes; the migration
  // that dropped that column moved those signatures onto signer rows first, so
  // the shape this served no longer exists.
  const signers = await db.select().from(schema.agreementSigners)
    .where(eq(schema.agreementSigners.requestId, reqRow.id))
    .orderBy(asc(schema.agreementSigners.createdAt))
    .all();
  const signedSigners = signers.filter((s) => s.status === 'signed' && s.signatureBase64);
  if (signedSigners.length === 0) {
    // Signed, and no signature to show. `synthesizeDefaultSigner` copies an
    // envelope's `status` onto a row it creates without its signature, so this
    // is reachable — and a signed agreement drawn with an empty signature block
    // is worse than one that is not served.
    return new Response('Not Found', { status: 404 });
  }
  const signerCellsHtml = signedSigners.map((s) => signerCellHtml(s, escapeHtml, withImages)).join('');

  const inspectorBlock = reqRow.inspectorSignatureBase64 ? (() => {
      const sig = reqRow.inspectorSignatureBase64!;
      const at = reqRow.inspectorSignedAt
          ? escapeHtml(utcDisplay(reqRow.inspectorSignedAt))
          : '';
      return `<div class="sig-cell">` +
          `<div class="label">Inspector</div>` +
          (withImages ? signatureImgHtml(sig, 'Inspector signature', escapeHtml) : SIGNATURE_ON_FILE) +
          `<div class="meta">${at}</div>` +
      `</div>`;
  })() : '';

  const qrHtml = verifyQrHtml(reqRow.verificationToken, baseUrl, escapeHtml, '[agreement-render]');

  const html = HTML_HEAD +
    `<h1>${escapeHtml(agreement.name)}</h1>` +
    `<div class="body">${escapeHtml(snapshotContent)}</div>` +
    // A backfilled signer row records no disclosure version, which is exactly
    // the "no version on the record" case — the note drops out.
    languageNoteHtml(signedSigners.map((s) => s.languageDisclosureVersion)) +
    `<div class="sig-block">` +
      `<div class="sig-row">` +
        signerCellsHtml +
        inspectorBlock +
      `</div>` +
    `</div>` +
    qrHtml +
    HTML_FOOT;

  return new Response(html, { status: 200, headers: RENDER_HEADERS });
}

/**
 * Certificate-of-completion renderer (Track I-a).
 *
 * PUBLIC, though it lives under `/m2m/`: that prefix is unauthenticated, so anyone holding the envelope id (part of every verification
 * link) can fetch it. Route `/m2m/cert-render/:id` has no tenant segment. It shows the signer roster (names, roles, channel, time,
 * "on behalf of"), the contracting entity, event names with the first 16 characters of each hash, and the key fingerprint: no signature
 * images, no private material, no email addresses. If it ever shows more, gate it first with the render token the agreement page uses.
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
  // The client's name; never their email address (see signerCellHtml).
  const clientLabel = reqRow.clientName || 'the client';

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
        const name = escapeHtml(s.name || 'Signer');
        const inPerson = s.channel === 'in_person' ? ' · Signed in person' : '';
        const onBehalf = s.onBehalfOf ? ` · on behalf of ${escapeHtml(s.onBehalfOf)}` : '';
        // The certificate states FACTS about the signing event, so unlike the
        // archived copy it can carry a superseded version number honestly: it
        // reports which notice was displayed, it does not reproduce the notice.
        // Omitted entirely when nothing was recorded — an absent line says "no
        // record", which is true, where "v0" or "none" would sound like a finding.
        const langNotice = typeof s.languageDisclosureVersion === 'number'
          ? ` · Language notice v${s.languageDisclosureVersion} displayed`
          : '';
        return `<li>${escapeHtml(roleLabel(s.role))}: ${name}${inPerson}${onBehalf}${langNotice} · ${at}</li>`;
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
    // The whole point of a certificate: the evidence pack must be able to
    // attest WHICH ENTITY the client contracted with. NULL means the envelope
    // predates identity capture, and says so — naming today's entity there
    // would assert something untrue about what was signed. Deliberately NOT a
    // Paraglide message: the certificate renders in English as the
    // authoritative legal artefact.
    `<p><strong>Contracting entity:</strong> ${
      reqRow.signerLegalName
        ? escapeHtml(reqRow.signerLegalName)
        : '<em>not recorded — this envelope predates identity capture</em>'
    }</p>` +
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

  return new Response(html, { status: 200, headers: RENDER_HEADERS });
}

const agreementsRenderRoutes = new Hono<HonoConfig>();
// :id is the stable envelope requestId (Track I-a; the legacy plaintext token
// column is no longer distributed). The path segment is named :id; the
// historical `:token` shape is retired.
agreementsRenderRoutes.get('/agreement-render/:tenant/:id', async (c) => {
  const tenant = c.req.param('tenant');
  const id = c.req.param('id');
  // Drawn signatures only for the workflow's own fetch (a token minted for this envelope); everyone else sees the document without them.
  const withImages = await agreementRenderAllowed(c.req.query('render'), id, c.env.JWT_SECRET);
  return agreementRenderHandler(c.env.DB, tenant, id, c.env.APP_BASE_URL || '', withImages);
});
agreementsRenderRoutes.get('/cert-render/:id', async (c) =>
  certRenderHandler(c.env.DB, c.req.param('id'), c.env.APP_BASE_URL || ''));

export default agreementsRenderRoutes;
