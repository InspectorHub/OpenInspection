import { eq, and, inArray, lt, sql, desc, asc } from 'drizzle-orm';
import { agreements, agreementRequests, agreementSigners, inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { mintToken, hashToken } from '../../lib/token-hash';
import { sealToken } from '../../lib/config-crypto';
import { sha256Hex, type Constructor, type SignerInput } from './base';
import type { AgreementServiceBase } from './base';

/** Signer-state methods this tier depends on (cross-mixin call surface). */
interface SignerStateDeps {
    synthesizeDefaultSigner(envelope: typeof agreementRequests.$inferSelect): Promise<typeof agreementSigners.$inferSelect>;
    getSignerLink(requestId: string, signerId: string): Promise<string>;
}

/**
 * Legacy + envelope-level (Spec 2A) request flow: template-bound signing
 * requests, the public token lookups, and the envelope state machine
 * (findOrCreate / markViewed / markSigned / markDeclined / expire / snapshot).
 * Layered ON TOP of the signer-state mixin so `findOrCreate` can reuse the
 * signer helpers (`synthesizeDefaultSigner`, `getSignerLink`).
 */
export function EnvelopeLegacyMixin<TBase extends Constructor<AgreementServiceBase & SignerStateDeps>>(Base: TBase) {
    return class EnvelopeLegacy extends Base {
        protected declare db: D1Database;
        protected declare secrets?: { jwtSecret: string; jwtSecretPrevious?: string };
        protected declare getDrizzle: AgreementServiceBase['getDrizzle'];

        /**
         * Creates a signing request and returns the token.
         */
        async createSigningRequest(tenantId: string, data: {
            agreementId: string;
            clientEmail: string;
            clientName?: string | null;
            inspectionId?: string | null;
        }) {
            const db = this.getDrizzle();
            const agreement = await db.select().from(agreements)
                .where(and(eq(agreements.id, data.agreementId), eq(agreements.tenantId, tenantId))).get();
            if (!agreement) throw Errors.NotFound('Agreement template not found');

            const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
            const request = {
                id: crypto.randomUUID(),
                tenantId,
                agreementId: data.agreementId,
                clientEmail: data.clientEmail,
                clientName: data.clientName ?? null,
                inspectionId: data.inspectionId ?? null,
                token,
                status: 'pending' as const,
                signatureBase64: null,
                signedAt: null,
                viewedAt: null,
                createdAt: new Date(),
            };
            await db.insert(agreementRequests).values(request);
            return { ...request, agreementName: agreement.name };
        }

        /**
         * Looks up a signing request by its public token (no tenant scope — token is the secret).
         */
        async getRequestByToken(token: string) {
            return this.getDrizzle().select().from(agreementRequests).where(eq(agreementRequests.token, token)).get();
        }

        /**
         * iter-2 production bug #9 — given an inspection id, return the most recent
         * non-terminal (pending/sent/viewed) signing request for that inspection
         * within the given tenant. Used by the public `/sign/:id` redirect route
         * so a customer who hits the report-gate "Sign agreement" CTA lands on
         * the live agreement page instead of a 404.
         *
         * Returns `null` when the inspection has no agreement request at all,
         * or when all existing requests are in a terminal state (signed /
         * declined / expired). Tenant-scoped — never crosses workspaces.
         *
         * NOTE: this is a read-only counterpart to `findOrCreate()`. Callers
         * that want to mint a token when none exists should use the latter;
         * the public `/sign/:id` redirect deliberately stays read-only so an
         * unauthenticated customer cannot trigger row inserts.
         */
        async findPendingByInspectionId(tenantId: string, inspectionId: string): Promise<{ token: string; status: string; requestId: string } | null> {
            const row = await this.getDrizzle().select({
                token:  agreementRequests.token,
                status: agreementRequests.status,
                requestId: agreementRequests.id,
            })
                .from(agreementRequests)
                .where(and(
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.inspectionId, inspectionId),
                    inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                ))
                .orderBy(desc(agreementRequests.createdAt))
                .limit(1)
                .get();
            return row ?? null;
        }

        /**
         * Returns the agreement content for a given public token.
         */
        async getAgreementByToken(token: string) {
            const request = await this.getRequestByToken(token);
            if (!request) throw Errors.NotFound('Signing request not found');
            const agreement = await this.getDrizzle().select().from(agreements).where(eq(agreements.id, request.agreementId)).get();
            if (!agreement) throw Errors.NotFound('Agreement not found');
            return { request, agreement };
        }

        /**
         * Records a client signature on a signing request (legacy route handler API).
         * Use markSigned() for state-machine flows with explicit signedAtMs.
         */
        async signRequest(token: string, signatureBase64: string, verificationToken?: string) {
            const request = await this.getRequestByToken(token);
            if (!request) throw Errors.NotFound('Signing request not found');
            if (request.status === 'signed') throw Errors.Conflict('Agreement already signed');

            await this.getDrizzle()
                .update(agreementRequests)
                .set({ status: 'signed', signatureBase64, signedAt: new Date(), verificationToken: verificationToken ?? null })
                .where(eq(agreementRequests.token, token));
            return { ...request, status: 'signed' as const, signatureBase64, signedAt: new Date() };
        }

        /**
         * Lists all signing requests for a tenant (most recent first).
         */
        async listRequests(tenantId: string) {
            return this.getDrizzle().select().from(agreementRequests)
                .where(eq(agreementRequests.tenantId, tenantId))
                .all();
        }

        // -------------------------------------------------------------------------
        // State machine — Spec 2A
        // -------------------------------------------------------------------------

        /**
         * Idempotent — returns existing non-terminal request for the inspection,
         * or creates a new row with status='sent'. Throws if the tenant has no
         * agreement template at all (admin must create one in /agreements first).
         */
        async findOrCreate(
            tenantId: string,
            inspectionId: string,
            opts?: { signers?: SignerInput[]; completionPolicy?: 'all' | 'one' },
        ): Promise<{ token: string; status: string; alreadyExists: boolean; requestId: string }> {
            const db = this.getDrizzle();
            // Look for an existing non-terminal request
            const existing = await db.select().from(agreementRequests)
                .where(and(
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.inspectionId, inspectionId),
                    inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                )).limit(1);
            if (existing.length > 0) {
                // Reuse: hand back the FIRST signer's plaintext link when we can
                // reconstruct it (tier-2 token_enc); otherwise fall back to the
                // legacy envelope token (still satisfies the public lookup path).
                const env = existing[0];
                let token = env.token;
                let firstSigner = (await db.select().from(agreementSigners)
                    .where(eq(agreementSigners.requestId, env.id))
                    .orderBy(asc(agreementSigners.createdAt)).limit(1))[0];
                // Legacy reuse path: an envelope created via `createSigningRequest`
                // has NO signer rows. Synthesize a default client signer (identical
                // shape to the public resolution path) so the on-site sign flow,
                // which enumerates signers, finds one to target instead of 409ing
                // on an empty signer set.
                if (!firstSigner) {
                    firstSigner = await this.synthesizeDefaultSigner(env);
                }
                try {
                    token = await this.getSignerLink(env.id, firstSigner.id);
                } catch (e) {
                    logger.warn('AgreementService.findOrCreate reuse-link failed', { requestId: env.id, error: e instanceof Error ? e.message : String(e) });
                }
                return { token, status: env.status, alreadyExists: true, requestId: env.id };
            }
            // Find inspection + a usable agreement template
            const inspRows = await db.select().from(inspections)
                .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).limit(1);
            if (inspRows.length === 0) throw Errors.NotFound('Inspection not found');
            const insp = inspRows[0];
            // Pick the tenant's first agreement template (simplest MVP)
            const agrRows = await db.select().from(agreements)
                .where(eq(agreements.tenantId, tenantId)).limit(1);
            if (agrRows.length === 0) throw Errors.NotFound('No agreement template configured');
            const agreement = agrRows[0];

            // Resolve the signer set (default = single client signer from the inspection)
            const signerInputs: SignerInput[] = opts?.signers && opts.signers.length > 0
                ? opts.signers
                : [{ name: insp.clientName || insp.clientEmail || 'Client', email: insp.clientEmail || '', role: 'client' }];
            // Validate duplicate emails BEFORE any insert (the UNIQUE index is the backstop)
            const seen = new Set<string>();
            for (const s of signerInputs) {
                const key = s.email.trim().toLowerCase();
                if (seen.has(key)) throw Errors.Conflict('Duplicate signer email');
                seen.add(key);
            }

            const completionPolicy = opts?.completionPolicy ?? 'all';
            const now = new Date();
            const requestId = crypto.randomUUID();
            const contentSnapshot = agreement.content;
            const contentHash = await sha256Hex(contentSnapshot);

            const newRow = {
                id: requestId,
                tenantId,
                inspectionId,
                agreementId: agreement.id,
                clientEmail: insp.clientEmail || '',
                clientName: insp.clientName,
                // Never distributed — satisfies NOT NULL + UNIQUE on the legacy column.
                token: crypto.randomUUID(),
                status: 'sent' as const,
                signatureBase64: null,
                signedAt: null,
                viewedAt: null,
                sentAt: now,
                lastError: null,
                contentSnapshot,
                contentHash,
                completionPolicy,
                createdAt: now,
            };
            await db.insert(agreementRequests).values(newRow);

            // Insert signer rows, minting one tier-2 token per signer.
            let firstPlaintext = '';
            for (let i = 0; i < signerInputs.length; i++) {
                const s = signerInputs[i];
                const plaintext = mintToken();
                if (i === 0) firstPlaintext = plaintext;
                await db.insert(agreementSigners).values({
                    id: crypto.randomUUID(),
                    tenantId,
                    requestId,
                    name: s.name,
                    email: s.email,
                    role: s.role ?? 'client',
                    contactId: s.contactId ?? null,
                    tokenHash: await hashToken(plaintext),
                    tokenEnc: this.secrets ? await sealToken(plaintext, tenantId, this.secrets.jwtSecret) : null,
                    status: 'sent',
                    createdAt: now,
                });
            }

            logger.info('AgreementService.findOrCreate created', { tenantId, inspectionId, requestId, signers: signerInputs.length, completionPolicy });
            return { token: firstPlaintext, status: 'sent', alreadyExists: false, requestId };
        }

        /**
         * Marks a request as viewed. Returns tenantId + inspectionId + agreementId,
         * or null if the token is not found or is expired.
         * Idempotent — calling on an already-viewed/signed/declined row is a no-op.
         *
         * NOTE: Route handler fires 'agreement.viewed' automation event after this
         * returns, avoiding AgreementService <-> AutomationService circular DI.
         */
        async markViewed(token: string): Promise<{ tenantId: string; inspectionId: string | null; agreementId: string } | null> {
            const db = this.getDrizzle();
            const rows = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1);
            if (rows.length === 0) return null;
            const row = rows[0];
            if (row.status === 'expired') return null;
            if (row.status === 'pending' || row.status === 'sent') {
                await db.update(agreementRequests)
                    .set({ status: 'viewed', viewedAt: new Date() })
                    .where(eq(agreementRequests.token, token));
            }
            return { tenantId: row.tenantId, inspectionId: row.inspectionId, agreementId: row.agreementId };
        }

        /**
         * Records a client signature on a signing request.
         * Throws Conflict if the request is declined or expired.
         * Idempotent if already signed.
         *
         * NOTE: Route handler fires 'agreement.signed' automation event after this returns.
         */
        async markSigned(token: string, signatureBase64: string, signedAtMs: number): Promise<{ tenantId: string; inspectionId: string | null }> {
            const db = this.getDrizzle();
            const rows = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1);
            if (rows.length === 0) throw Errors.NotFound('Agreement request not found');
            const row = rows[0];
            if (row.status === 'declined' || row.status === 'expired') {
                throw Errors.Conflict('Agreement is no longer signable');
            }
            if (row.status === 'signed') {
                // Idempotent — already signed
                return { tenantId: row.tenantId, inspectionId: row.inspectionId };
            }
            await db.update(agreementRequests)
                .set({ status: 'signed', signatureBase64, signedAt: new Date(signedAtMs) })
                .where(eq(agreementRequests.token, token));
            return { tenantId: row.tenantId, inspectionId: row.inspectionId };
        }

        /**
         * Marks a signing request as declined with an optional reason stored in lastError.
         * Throws Conflict if the request is already signed or expired.
         * Idempotent if already declined.
         *
         * NOTE: Route handler fires 'agreement.declined' automation event after this returns.
         */
        async markDeclined(token: string, reason?: string): Promise<{ tenantId: string; inspectionId: string | null }> {
            const db = this.getDrizzle();
            const rows = await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1);
            if (rows.length === 0) throw Errors.NotFound('Agreement request not found');
            const row = rows[0];
            if (row.status === 'signed' || row.status === 'expired') {
                throw Errors.Conflict('Agreement cannot be declined');
            }
            if (row.status === 'declined') return { tenantId: row.tenantId, inspectionId: row.inspectionId };
            await db.update(agreementRequests)
                .set({ status: 'declined', lastError: reason ? reason.slice(0, 500) : null })
                .where(eq(agreementRequests.token, token));
            return { tenantId: row.tenantId, inspectionId: row.inspectionId };
        }

        /**
         * Cron handler — marks all non-terminal rows with sentAt older than N days
         * as expired. Returns the count of newly-expired rows.
         * Idempotent — re-running picks up nothing once all old rows are expired.
         */
        async expireOlderThan(days: number): Promise<number> {
            const db = this.getDrizzle();
            // Compare via lt() with a Date so Drizzle encodes the cutoff through the
            // sent_at column's mode mapper. (The previous raw-sql comparison bound a
            // MILLISECOND cutoff against a SECONDS-stored column — always true — so the
            // sweep expired every pending/sent/viewed envelope regardless of age.)
            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            await db.update(agreementRequests)
                .set({ status: 'expired' })
                .where(and(
                    inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                    lt(agreementRequests.sentAt, cutoff),
                ));
            // Track I-a — cascade expiry to signer rows under any expired envelope.
            // Idempotent: only non-terminal signers under an 'expired' envelope are
            // touched, so reruns and already-signed/declined signers are untouched.
            await db.update(agreementSigners)
                .set({ status: 'expired' })
                .where(and(
                    inArray(agreementSigners.status, ['pending', 'sent', 'viewed']),
                    sql`${agreementSigners.requestId} IN (SELECT id FROM ${agreementRequests} WHERE ${agreementRequests.status} = 'expired')`,
                ));
            // D1/Drizzle does not expose rowsAffected; count expired rows within the cutoff window
            const expiredRows = await db.select().from(agreementRequests)
                .where(and(
                    eq(agreementRequests.status, 'expired'),
                    lt(agreementRequests.sentAt, cutoff),
                ));
            const count = expiredRows.length;
            logger.info('AgreementService.expireOlderThan', { days, count });
            return count;
        }

        /**
         * Returns the agreement content + hash for an envelope. Prefers the pinned
         * snapshot; on a pre-0020 NULL snapshot, loads the live template and (when
         * the envelope is still non-terminal) lazily persists it to self-heal.
         */
        async getSnapshotForRequest(request: typeof agreementRequests.$inferSelect): Promise<{ content: string; hash: string | null }> {
            if (request.contentSnapshot != null) {
                return { content: request.contentSnapshot, hash: request.contentHash };
            }
            const db = this.getDrizzle();
            const agr = await db.select().from(agreements).where(eq(agreements.id, request.agreementId)).limit(1);
            if (agr.length === 0) throw Errors.NotFound('Agreement not found');
            const content = agr[0].content;
            const hash = await sha256Hex(content);
            if (['pending', 'sent', 'viewed'].includes(request.status)) {
                await db.update(agreementRequests)
                    .set({ contentSnapshot: content, contentHash: hash })
                    .where(eq(agreementRequests.id, request.id));
            }
            return { content, hash };
        }
    };
}
