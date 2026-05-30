import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { AppEnv } from '../types/hono';
import { SigningKeyService } from '../services/signing-key.service';
import { AuditLogService } from '../services/audit-log.service';
import { m2mAgreementRenderUrl } from '../lib/public-urls';
import { buildEvidencePack } from '../services/evidence-pack.service';
import { EmailService } from '../services/email.service';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import * as schema from '../lib/db/schema';

export interface SignCompletionParams {
    requestId: string;
    tenantId: string;
    tenantSlug: string;       // tenant subdomain, required for /m2m/agreement-render/<tenant>/<token>
    token: string;            // public agreement-request token (used for /m2m/* render routes)
}

/**
 * Spec 5H P1 — Sign-completion workflow.
 *
 * Triggered after the synchronous /sign POST writes the 'agreement.signed'
 * audit row + flips DB status. Builds the canonical evidence artifacts
 * asynchronously so the client UX is sub-200ms ("Certificate emailed shortly").
 *
 * Steps (all five ship in P4):
 *   1. render-canonical-pdf      — Browser Rendering -> R2 signed.pdf
 *   2. render-certificate-pdf    — Browser Rendering -> R2 certificate.pdf
 *   3. build-evidence-pack       — zip in worker memory -> R2 evidence.zip
 *   4. append-workflow-complete  — extend audit chain with doc + cert + zip hashes
 *   5. email-parties             — Resend: deliver signed.pdf + evidence.zip to client
 *
 * Failure semantics: each step has its own retry policy. If any step fails
 * permanently, the audit chain remains intact (the prior 'agreement.signed'
 * row is the legally meaningful one). Admin is notified via in-app
 * notification + can manually re-run the workflow with the same requestId.
 */
export class SignCompletionWorkflow extends WorkflowEntrypoint<AppEnv, SignCompletionParams> {
    async run(event: WorkflowEvent<SignCompletionParams>, step: WorkflowStep) {
        const { requestId, tenantId, tenantSlug, token } = event.payload;
        const env = this.env;

        // Step 1 — render canonical signed PDF (best-effort; if BR is not
        // provisioned at the account level, returns null + chain still extends)
        const signedPdfMeta = await step.do('render-canonical-pdf', {
            retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
            timeout: '2 minutes',
        }, async () => {
            try {
                return await renderPdfToR2(env, {
                    renderUrl: m2mAgreementRenderUrl(baseHost(env), tenantSlug, token),
                    r2Key: `tenants/${tenantId}/agreements/${requestId}/signed.pdf`,
                });
            } catch (e) {
                console.warn('[sign-workflow] render-canonical-pdf failed (BR may not be provisioned)', { error: (e as Error).message });
                return null;
            }
        });

        // Step 2 — render Certificate of Completion PDF (also best-effort)
        const certPdfMeta = await step.do('render-certificate-pdf', {
            retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
            timeout: '2 minutes',
        }, async () => {
            try {
                return await renderPdfToR2(env, {
                    renderUrl: `${baseUrl(env)}/m2m/cert-render/${token}`,
                    r2Key: `tenants/${tenantId}/agreements/${requestId}/certificate.pdf`,
                });
            } catch (e) {
                console.warn('[sign-workflow] render-certificate-pdf failed (BR may not be provisioned)', { error: (e as Error).message });
                return null;
            }
        });

        // Step 3 — assemble evidence.zip (best-effort; gracefully tolerated)
        const evidenceZipMeta = await step.do('build-evidence-pack', async () => {
            try {
                if (!env.REPORTS) return null;
                const signing = new SigningKeyService(env.DB, env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET);
                const pubKey = await signing.getPublicKey(tenantId);
                if (!pubKey) return null;
                const db = drizzle(env.DB, { schema });
                const auditRows = await db.select().from(schema.esignAuditLogs)
                    .where(and(
                        eq(schema.esignAuditLogs.tenantId, tenantId),
                        eq(schema.esignAuditLogs.requestId, requestId),
                    ))
                    .all();
                const auditPayload = {
                    envelopeId: requestId,
                    algorithm: 'Ed25519',
                    publicKeyPem: pubKey.pem,
                    keyFingerprint: pubKey.fingerprint,
                    events: auditRows.map((r) => ({
                        id: r.id,
                        event: r.event,
                        createdAt: r.createdAt,
                        payloadJson: r.payloadJson,
                        prevHash: r.prevHash,
                        hash: r.hash,
                        signature: r.signature,
                        keyFingerprint: r.keyFingerprint,
                    })),
                };
                const zipBuf = await buildEvidencePack({
                    r2: env.REPORTS,
                    auditTrailJson: JSON.stringify(auditPayload, null, 2),
                    publicKeyPem: pubKey.pem,
                    tenantId,
                    envelopeId: requestId,
                });
                const r2Key = `tenants/${tenantId}/agreements/${requestId}/evidence.zip`;
                const bytes = new Uint8Array(zipBuf);
                const hashBuf = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
                const sha256 = Array.from(hashBuf).map((b) => b.toString(16).padStart(2, '0')).join('');
                await env.REPORTS.put(r2Key, bytes, {
                    httpMetadata: { contentType: 'application/zip' },
                    customMetadata: { sha256 },
                });
                return { r2Key, sha256, sizeBytes: bytes.byteLength };
            } catch (e) {
                console.warn('[sign-workflow] build-evidence-pack failed', { error: (e as Error).message });
                return null;
            }
        });

        // Step 4 — append workflow.complete to the audit chain regardless of
        // PDF render success. The legally-meaningful 'agreement.signed' row is
        // already in the chain; this row records the post-sign workflow status.
        await step.do('append-workflow-complete', async () => {
            const signing = new SigningKeyService(env.DB, env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET);
            const auditLog = new AuditLogService(env.DB, signing);
            await auditLog.append(tenantId, requestId, 'workflow.complete', {
                certPdfHash: certPdfMeta ? `sha256:${certPdfMeta.sha256}` : null,
                envelopeId: requestId,
                evidenceZipHash: evidenceZipMeta ? `sha256:${evidenceZipMeta.sha256}` : null,
                pdfRenderStatus: signedPdfMeta && certPdfMeta ? 'ok' : 'failed_pdf_render',
                signedPdfHash: signedPdfMeta ? `sha256:${signedPdfMeta.sha256}` : null,
                tsMs: Date.now(),
                workflowId: event.instanceId,
            });
        });

        // Step 5 — email the client with signed.pdf + evidence.zip attachments.
        // Best-effort: skip cleanly if Resend not configured or any artifact is missing.
        await step.do('email-parties', async () => {
            try {
                if (!evidenceZipMeta || !signedPdfMeta) return;
                if (!env.RESEND_API_KEY) return;
                if (!env.REPORTS) return;
                const db = drizzle(env.DB, { schema });
                const req = await db.select().from(schema.agreementRequests)
                    .where(eq(schema.agreementRequests.id, requestId)).get();
                if (!req) return;
                const [signedObj, evidenceObj] = await Promise.all([
                    env.REPORTS.get(signedPdfMeta.r2Key),
                    env.REPORTS.get(evidenceZipMeta.r2Key),
                ]);
                if (!signedObj || !evidenceObj) return;
                const signedBytes = new Uint8Array(await new Response(signedObj.body).arrayBuffer());
                const evidenceBytes = new Uint8Array(await new Response(evidenceObj.body).arrayBuffer());
                const verifyUrl = req.verificationToken
                    ? `${baseUrl(env)}/v/${req.verificationToken}`
                    : `${baseUrl(env)}/api/public/verify/${requestId}`;
                const email = new EmailService(env.RESEND_API_KEY, env.SENDER_EMAIL || 'noreply@openinspection.io', env.APP_NAME || 'OpenInspection');
                await email.sendEvidencePack({
                    to: req.clientEmail,
                    clientName: req.clientName ?? 'Customer',
                    envelopeId: requestId,
                    verifyUrl,
                    signedPdfBytes: signedBytes,
                    evidenceZipBytes: evidenceBytes,
                });
            } catch (e) {
                console.warn('[sign-workflow] email-parties failed', { error: (e as Error).message });
            }
        });

        return { signedPdfMeta, certPdfMeta };
    }
}

/**
 * Use Browser Run Quick Actions to capture a URL as PDF, write to R2,
 * return key + sha256. The internal render URLs
 * (/m2m/agreement-render/{tenant}/{token}, /m2m/cert-render/{token}) are
 * gated by the token-in-URL secret (no Authorization header needed —
 * Browser Run does not reliably forward custom headers).
 */
async function renderPdfToR2(env: AppEnv, opts: { renderUrl: string; r2Key: string }): Promise<{ r2Key: string; sha256: string; sizeBytes: number }> {
    if (!env.REPORTS) throw new Error('REPORTS R2 bucket not configured');
    if (!env.BROWSER) throw new Error('BROWSER binding not configured');

    console.info('[sign-workflow] BR quickAction("pdf")', { renderUrl: opts.renderUrl });
    const res = await env.BROWSER.quickAction('pdf', { url: opts.renderUrl });
    if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable>');
        console.error('[sign-workflow] BR error', { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: body.slice(0, 1000) });
        throw new Error(`BR ${res.status}: ${body.slice(0, 500)}`);
    }
    const pdfBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(pdfBuffer);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
    const sha256 = Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.REPORTS.put(opts.r2Key, bytes, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: { sha256 },
    });
    return { r2Key: opts.r2Key, sha256, sizeBytes: bytes.byteLength };
}

function baseUrl(env: AppEnv): string {
    return env.APP_BASE_URL || 'https://openinspection-api.important-new.workers.dev';
}

function baseHost(env: AppEnv): string {
    const raw = baseUrl(env);
    try { return new URL(raw).host; } catch { return raw.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
}
