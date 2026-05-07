import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { AppEnv } from '../types/hono';
import { SigningKeyService } from '../services/signing-key.service';
import { AuditLogService } from '../services/audit-log.service';

export interface SignCompletionParams {
    requestId: string;
    tenantId: string;
}

/**
 * Spec 5H P1 — Sign-completion workflow.
 *
 * Triggered after the synchronous /sign POST writes the 'agreement.signed'
 * audit row + flips DB status. Builds the canonical evidence artifacts
 * asynchronously so the client UX is sub-200ms ("Certificate emailed shortly").
 *
 * Steps (P1 ships steps 1-2 + 4; steps 3 + 5 land in P2):
 *   1. render-canonical-pdf      — Browser Rendering -> R2 signed.pdf
 *   2. render-certificate-pdf    — Browser Rendering -> R2 certificate.pdf
 *   3. build-evidence-pack       [P2] zip in worker memory -> R2 evidence.zip
 *   4. append-workflow-complete  — extend audit chain with doc + cert hashes
 *   5. email-parties             [P2] Resend send to client + admin
 *
 * Failure semantics: each step has its own retry policy. If any step fails
 * permanently, the audit chain remains intact (the prior 'agreement.signed'
 * row is the legally meaningful one). Admin is notified via in-app
 * notification + can manually re-run the workflow with the same requestId.
 */
export class SignCompletionWorkflow extends WorkflowEntrypoint<AppEnv, SignCompletionParams> {
    async run(event: WorkflowEvent<SignCompletionParams>, step: WorkflowStep) {
        const { requestId, tenantId } = event.payload;
        const env = this.env;

        // Step 1 — render canonical signed PDF
        const signedPdfMeta = await step.do('render-canonical-pdf', {
            retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
            timeout: '2 minutes',
        }, async () => {
            return renderPdfToR2(env, {
                renderUrl: `${baseUrl(env)}/internal/agreement-render/${requestId}`,
                r2Key: `tenants/${tenantId}/agreements/${requestId}/signed.pdf`,
            });
        });

        // Step 2 — render Certificate of Completion PDF
        const certPdfMeta = await step.do('render-certificate-pdf', {
            retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
            timeout: '2 minutes',
        }, async () => {
            return renderPdfToR2(env, {
                renderUrl: `${baseUrl(env)}/internal/cert-render/${requestId}`,
                r2Key: `tenants/${tenantId}/agreements/${requestId}/certificate.pdf`,
            });
        });

        // Step 4 (P1) — append workflow.complete to the audit chain
        // Step 3 + 5 (evidence pack + email) ship in P2.
        await step.do('append-workflow-complete', async () => {
            const signing = new SigningKeyService(env.DB, env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET);
            const auditLog = new AuditLogService(env.DB, signing);
            await auditLog.append(tenantId, requestId, 'workflow.complete', {
                certPdfHash: `sha256:${certPdfMeta.sha256}`,
                envelopeId: requestId,
                evidenceZipHash: null, // filled in P2
                signedPdfHash: `sha256:${signedPdfMeta.sha256}`,
                tsMs: Date.now(),
                workflowId: event.instanceId,
            });
        });

        return { signedPdfMeta, certPdfMeta };
    }
}

/**
 * Use Browser Rendering to capture a URL as PDF, write to R2, return key + sha256.
 * The internal render URLs (/internal/agreement-render/{token}, /internal/cert-render/{token})
 * are gated by M2M auth (Bearer JWT_SECRET) — see src/index.ts. Browser Rendering
 * fetches them with the Authorization header set via the launch options.
 */
async function renderPdfToR2(env: AppEnv, opts: { renderUrl: string; r2Key: string }): Promise<{ r2Key: string; sha256: string; sizeBytes: number }> {
    if (!env.BROWSER) throw new Error('Browser Rendering binding (BROWSER) not configured');
    if (!env.REPORTS) throw new Error('REPORTS R2 bucket not configured');

    const m2mSecret = env.JWT_SECRET;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const browser = await (env.BROWSER as any).launch();
    try {
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({ Authorization: `Bearer ${m2mSecret}` });
        await page.goto(opts.renderUrl, { waitUntil: 'networkidle0', timeout: 90_000 });
        const pdfBuffer: ArrayBuffer = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
        });
        const bytes = new Uint8Array(pdfBuffer);
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
        const sha256 = Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('');
        await env.REPORTS.put(opts.r2Key, bytes, {
            httpMetadata: { contentType: 'application/pdf' },
            customMetadata: { sha256 },
        });
        return { r2Key: opts.r2Key, sha256, sizeBytes: bytes.byteLength };
    } finally {
        await browser.close();
    }
}

function baseUrl(env: AppEnv): string {
    return env.APP_BASE_URL || 'https://openinspection-standalone.important-new.workers.dev';
}
