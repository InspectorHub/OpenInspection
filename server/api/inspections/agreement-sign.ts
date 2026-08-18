/**
 * In-person signing — the inspector hands over the device.
 *
 * Split out of `agreements.ts` when that file crossed the 400-line ceiling. One
 * route, one file, and the seam is real: the routes left behind CREATE and READ
 * an envelope, this one is the moment a person signs.
 *
 * ── Why the presentation is ATTESTED here and OBSERVED on the remote path ────
 * review review requires the audit chain to show the signer was presented
 * this content before a signature is recorded. Remotely that is observed: the
 * signer's own browser fetches the agreement and the fetch is appended.
 *
 * In person there is no such fetch. The inspector is holding the device and the
 * content is already on screen, so requiring one would refuse a signature for
 * the absence of an event that cannot happen — and omitting it would leave the
 * chain silent about the step. What is recorded instead is what actually
 * occurred: an authenticated staff member attests they presented this content,
 * at this hash, on this device. `presentedBy`, `channel: 'in_person'` and
 * `attested: true` keep that distinguishable from an observation forever.
 */
import { z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { eq, and, asc } from 'drizzle-orm';
import { inspections as inspectionTable, agreementRequests, agreementSigners } from '../../lib/db/schema';
import { runEnvelopeCompletionPipeline, runSignerReceiptEffects } from '../../lib/sign-effects';
import { getDrizzle } from '../../lib/route-helpers';
import { resolveAutomationCompanyName } from '../../services/automation/company-name';

const agreementSignRoutes = createApiRouter();

agreementSignRoutes.post('/:id/sign', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);
        const svc = c.var.services.agreement;

        // Verify inspection exists
        const inspection = await db.select({ id: inspectionTable.id }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const raw = await c.req.json();
        const parsed = z.object({
            signatureBase64: z.string().min(1).describe('Base64-encoded signature image (data URL or raw base64) drawn by the signer on-site.'),
            signerId: z.string().optional().describe('Target signer within the envelope; defaults to the first non-terminal signer.'),
            onBehalfOf: z.string().max(200).optional().describe('Name of the party an authorized agent signs for.'),
            onBehalfDisclaimer: z.string().max(2000).optional().describe('Disclaimer the authorized agent attests to when signing on behalf of another.'),
        }).safeParse(raw);
        if (!parsed.success) return c.json({ success: false, error: { message: 'Invalid signature data', code: 'validation_error' } }, 400);
        const body = parsed.data;

        // Idempotency at the inspection level: if a signed envelope already
        // exists for this inspection, short-circuit (don't spin a fresh envelope).
        // Preserves the old `{ alreadySigned: true }` contract.
        const alreadySignedEnv = await db.select({ id: agreementRequests.id, status: agreementRequests.status })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            )).limit(1).get();
        if (alreadySignedEnv) {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, envelopeStatus: 'signed' } }, 200);
        }

        // Track I-a — on-site signing rides the envelope so every signature carries
        // a snapshot + audit chain + receipt. An envelope requires a template; the
        // old flow recorded signatures against nothing (the legal hole we close).
        let env: Awaited<ReturnType<typeof svc.findOrCreate>>;
        try {
            env = await svc.findOrCreate(tenantId, id);
        } catch (e) {
            if (e instanceof Error && /No agreement template configured/.test(e.message)) {
                return c.json({ success: false, error: { code: 'no_agreement_template', message: 'Create an agreement template before collecting signatures' } }, 409);
            }
            throw e;
        }

        // By id alone, and provably safe: `env.requestId` is the primary key
        // `findOrCreate(tenantId, id)` just returned, so the tenant filter was
        // applied by the call that produced it. The tenant-scoping gate lists
        // this exact case ("pk from prior scoped fetch") and the baseline entry
        // moved with the file rather than being granted afresh.
        const envelope = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.id, env.requestId)).get();
        if (!envelope) throw Errors.NotFound('Agreement request not found');

        const signers = await db.select().from(agreementSigners)
            .where(eq(agreementSigners.requestId, env.requestId))
            .orderBy(asc(agreementSigners.createdAt)).all();

        // Pick the target signer: explicit signerId, else first non-terminal.
        let signer;
        if (body.signerId) {
            signer = signers.find((s) => s.id === body.signerId);
            if (!signer) throw Errors.NotFound('Signer not found');
        } else {
            signer = signers.find((s) => !['signed', 'declined', 'expired'].includes(s.status));
            if (!signer) {
                // Every signer is terminal — nothing left to sign.
                throw Errors.Conflict('Agreement is no longer signable');
            }
        }

        // Idempotent — an already-signed signer short-circuits without re-firing effects.
        if (signer.status === 'signed') {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, signerId: signer.id, envelopeStatus: envelope.status } }, 200);
        }

        // Terminal-state guard: declined / expired signers must never reach the audit append.
        if (signer.status === 'declined' || signer.status === 'expired') {
            throw Errors.Conflict('Agreement is no longer signable');
        }

        const plaintext = await svc.getSignerLink(tenantId, env.requestId, signer.id);

        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
        const country = c.req.header('cf-ipcountry') || null;
        const tsMs = Date.now();

        // Spec 5H P0 — audit-before-mutation per-signer append (chain integrity
        // survives a partial failure). Hash the signature image for cert reference.
        const sigBytes = (() => {
            try {
                const b64 = body.signatureBase64.replace(/^data:image\/[a-z]+;base64,/, '');
                const bin = atob(b64);
                const out = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                return out;
            } catch { return new Uint8Array(); }
        })();
        const sigHash = sigBytes.length > 0
            ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes)))
                .map((b) => b.toString(16).padStart(2, '0')).join('')
            : null;
        // THE PRESENTATION, on the in-person path, and it is a different FACT
        // from the remote one rather than the same fact recorded elsewhere.
        //
        // review review requires the chain to show the signer was presented
        // this content before a signature is recorded. Remotely that is observed:
        // the signer's own browser fetches the agreement and the fetch is
        // appended. In person there is no such fetch — the inspector is holding
        // the device and the content is already on screen — so requiring one
        // would refuse a signature for the absence of an event that cannot
        // happen, and omitting it would leave the chain silent about the step.
        //
        // What is recorded instead is what actually occurred: an AUTHENTICATED
        // STAFF MEMBER ATTESTS they presented this content, at this hash, on this
        // device. `presentedBy` and the in_person channel make it distinguishable
        // from a remote presentation forever — nobody reading this chain can
        // mistake an attestation for an observation.
        try {
            await c.var.services.auditLog.append(envelope.tenantId, envelope.id, 'signer.presented', {
                envelopeId: envelope.id,
                signerId: signer.id,
                signerEmail: signer.email,
                contentHash: envelope.contentHash ?? null,
                presentedAt: tsMs,
                channel: 'in_person',
                presentedBy: (c.get('user') as { sub?: string } | undefined)?.sub ?? null,
                attested: true,
            });
        } catch (e) {
            logger.warn('audit.append.signer-presented.failed', { requestId: envelope.id, signerId: signer.id, error: (e as Error).message });
        }
        try {
            await c.var.services.auditLog.append(envelope.tenantId, envelope.id, 'signer.signed', {
                envelopeId: envelope.id,
                signerId: signer.id,
                signerEmail: signer.email,
                signerRole: signer.role,
                channel: 'in_person',
                contentHash: envelope.contentHash ?? null,
                onBehalfOf: body.onBehalfOf ?? null,
                country,
                ip,
                signatureImageHash: sigHash ? `sha256:${sigHash}` : null,
                tsMs,
                ua,
            });
        } catch (e) {
            logger.warn('audit.append.signer-signed.failed', { requestId: envelope.id, signerId: signer.id, error: (e as Error).message });
        }

        const result = await svc.markSignedBySigner(plaintext, body.signatureBase64, {
            signedAtMs: tsMs,
            channel: 'in_person',
            ipAddress: ip,
            userAgent: ua,
            onBehalfOf: body.onBehalfOf ?? null,
            onBehalfDisclaimer: body.onBehalfDisclaimer ?? null,
            // NULL: this is the on-site API surface. `GET /:id/agreement` hands
            // the caller the agreement text and the caller draws its own screen,
            // so we cannot know whether the signer saw the language disclosure.
            // A version here would assert something the platform does not know.
            languageDisclosureVersion: null,
        });

        // Spec 2A — per-signer automation event (fires on EVERY sign).
        if (result.inspectionId) {
            c.var.services.automation.trigger({
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                triggerEvent: 'agreement.signer_signed',
                companyName: await resolveAutomationCompanyName(getDrizzle(c), result.tenantId), reportBaseUrl: c.env.APP_BASE_URL || '',
            }).catch(() => {});
        }

        // Envelope completion side-effects fire EXACTLY ONCE.
        if (result.envelopeCompletedNow) {
            await runEnvelopeCompletionPipeline(c, {
                requestId: result.requestId,
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                clientEmail: envelope.clientEmail ?? null,
                clientName: envelope.clientName ?? null,
                agreementId: envelope.agreementId,
            });
        }

        // Per-signer in-person receipt — every signer gets a receipt at their own
        // email EXCEPT when this same sign completed the envelope and the signer
        // IS the envelope client (the completion pipeline already emailed them).
        const completedSelf = result.envelopeCompletedNow
            && !!envelope.clientEmail
            && signer.email.trim().toLowerCase() === envelope.clientEmail.trim().toLowerCase();
        if (!completedSelf) {
            await runSignerReceiptEffects(c, {
                signerEmail: signer.email,
                signerName: signer.name,
                inspectionId: result.inspectionId,
                requestId: result.requestId,
            });
        }

        return c.json({ success: true, data: { signed: true, signerId: signer.id, envelopeStatus: result.envelopeStatus } }, 200);
    });

export default agreementSignRoutes;
