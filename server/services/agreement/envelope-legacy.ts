import { eq, and, inArray, lt, sql, desc, asc } from 'drizzle-orm';
import { agreements, agreementRequests, agreementSigners, inspections } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { mintToken, hashToken } from '../../lib/token-hash';
import { SIGNER_TOKEN_TTL_MS } from '../../lib/token-ttl';
import { sealToken } from '../../lib/config-crypto';
import { PeopleService } from '../people.service';
import { BrandingService } from '../branding.service';
import { sha256Hex, type Constructor, type SignerInput } from './base';
import type { AgreementServiceBase } from './base';

/** Signer-state methods this tier depends on (cross-mixin call surface). */
interface SignerStateDeps {
    synthesizeDefaultSigner(envelope: typeof agreementRequests.$inferSelect): Promise<typeof agreementSigners.$inferSelect>;
    getSignerLink(tenantId: string, requestId: string, signerId: string): Promise<string>;
}

/**
 * Envelope-level (Spec 2A) request flow: template-bound signing requests and
 * the envelope state machine (findOrCreate / expire / snapshot).
 * Layered ON TOP of the signer-state mixin so `findOrCreate` can reuse the
 * signer helpers (`synthesizeDefaultSigner`, `getSignerLink`).
 */
export function EnvelopeLegacyMixin<TBase extends Constructor<AgreementServiceBase & SignerStateDeps>>(Base: TBase) {
    return class EnvelopeLegacy extends Base {
        public declare db: D1Database;
        public declare secrets?: { jwtSecret: string; jwtSecretPrevious?: string };
        public declare getDrizzle: AgreementServiceBase['getDrizzle'];

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
        async findPendingByInspectionId(tenantId: string, inspectionId: string): Promise<{ status: string; requestId: string } | null> {
            // No `token`: the caller used to redirect to it as a last resort, and
            // envelope tokens now resolve by hash only, so the column could only
            // have produced a link that 404s. Returning it invited that.
            const row = await this.getDrizzle().select({
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

        // -------------------------------------------------------------------------
        // State machine — Spec 2A
        // -------------------------------------------------------------------------

        /**
         * Idempotent — returns existing non-terminal request for the inspection,
         * or creates a new row with status='sent'. Throws if the tenant has no
         * agreement template at all (admin must create one in /agreements first).
         *
         * IA-65 — when an envelope already exists, explicitly-supplied `signers`
         * are MERGED into it rather than discarded. Before this, a send that
         * named three signers against an inspection whose envelope was already
         * out returned that envelope untouched: the operator got a success
         * response, the two people they had just added were never created, and
         * nothing said so. One inspection holds one live envelope, so "send this
         * agreement to these people" has to converge on that envelope's signer
         * set — the alternative is a caller-visible refusal, never a silent drop.
         */
        async findOrCreate(
            tenantId: string,
            inspectionId: string,
            opts?: { signers?: SignerInput[]; completionPolicy?: 'all' | 'one'; agreementId?: string },
        ): Promise<{ token: string; status: string; alreadyExists: boolean; requestId: string; addedSignerIds: string[] }> {
            const db = this.getDrizzle();
            // Look for an existing non-terminal request
            const existing = await db.select().from(agreementRequests)
                .where(and(
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.inspectionId, inspectionId),
                    inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                )).limit(1);
            if (existing.length > 0) {
                // Reuse: hand back the FIRST signer's plaintext link, reconstructed
                // from its sealed copy (tier-2 token_enc). There is no second
                // source — the envelope has no distributable token of its own.
                const env = existing[0];
                let firstSigner = (await db.select().from(agreementSigners)
                    .where(eq(agreementSigners.requestId, env.id))
                    .orderBy(asc(agreementSigners.createdAt)).limit(1))[0];
                // Legacy reuse path: a pre-envelope-v2 row has NO signer rows.
                // Synthesize a default client signer (identical shape to the public
                // resolution path) so the on-site sign flow, which enumerates signers,
                // finds one to target instead of 409ing on an empty signer set.
                if (!firstSigner) {
                    firstSigner = await this.synthesizeDefaultSigner(env);
                }
                const addedSignerIds = await this.mergeSignersIntoEnvelope(env, opts?.signers ?? [], opts?.completionPolicy);
                // A failure here is a failure, and it has to read as one. This used
                // to swallow the error and hand back the envelope-level `token`
                // instead — a value the public lookup path stopped resolving when
                // envelope tokens went hash-only, so the caller built a sign link
                // that could only 404. `getFirstOutstandingSignerLink` in this same
                // service already gets this right by returning null rather than a
                // token nothing can redeem; the one caller that reads this token
                // (the concierge confirm route) has a catch that lands the customer
                // on their report instead of a dead signing page.
                let token: string;
                try {
                    token = await this.getSignerLink(env.tenantId, env.id, firstSigner.id);
                } catch (e) {
                    logger.warn('AgreementService.findOrCreate reuse-link failed', { requestId: env.id, error: e instanceof Error ? e.message : String(e) });
                    throw e;
                }
                return { token, status: env.status, alreadyExists: true, requestId: env.id, addedSignerIds };
            }
            // Verify the inspection exists in this tenant.
            const inspRows = await db.select({ id: inspections.id }).from(inspections)
                .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).limit(1);
            if (inspRows.length === 0) throw Errors.NotFound('Inspection not found');
            // Pick the agreement template: explicit id (tenant-scoped) or the tenant's first template.
            let agrRows;
            if (opts?.agreementId) {
                agrRows = await db.select().from(agreements)
                    .where(and(eq(agreements.id, opts.agreementId), eq(agreements.tenantId, tenantId))).limit(1);
                if (agrRows.length === 0) throw Errors.NotFound('No agreement template configured');
            } else {
                agrRows = await db.select().from(agreements)
                    .where(eq(agreements.tenantId, tenantId)).limit(1);
                if (agrRows.length === 0) throw Errors.NotFound('No agreement template configured');
            }
            const agreement = agrRows[0];

            // Task 9b (people-role-profiles) — the default signer (no explicit
            // opts.signers) resolves via the inspection_people primary-client
            // join instead of the legacy insp.clientName/.clientEmail columns
            // (dropped, Task 13). An explicit opts.signers[0] still wins.
            const primaryClient = await new PeopleService({ DB: this.db }).getPrimaryClient(tenantId, inspectionId);

            // Resolve the signer set (default = single client signer from the inspection)
            const signerInputs: SignerInput[] = opts?.signers && opts.signers.length > 0
                ? opts.signers
                : [{ name: primaryClient?.name || primaryClient?.email || 'Client', email: primaryClient?.email || '', role: 'client' }];
            // Validate duplicate emails BEFORE any insert (the UNIQUE index is the backstop)
            const seen = new Set<string>();
            for (const s of signerInputs) {
                const key = s.email.trim().toLowerCase();
                if (seen.has(key)) throw Errors.Conflict('Duplicate signer email');
                seen.add(key);
            }

            // Use the first explicit signer's email as the envelope clientEmail when provided,
            // so callers that pass opts.signers[0].email see it reflected in the envelope row.
            const resolvedClientEmail = opts?.signers?.[0]?.email || primaryClient?.email || '';
            const resolvedClientName = opts?.signers?.[0]?.name ?? primaryClient?.name;

            const completionPolicy = opts?.completionPolicy ?? 'all';
            const now = new Date();
            const requestId = crypto.randomUUID();
            const contentSnapshot = agreement.content;
            const contentHash = await sha256Hex(contentSnapshot);
            // Spec 2026-08-04 section 3 — freeze the contracting identity onto
            // the envelope. Renaming the company must not retroactively rewrite
            // which entity a past agreement was signed with. `legalName` arrives
            // ALREADY resolved from getBrand; no fallback is re-applied here.
            const brand = await new BrandingService(this.db).getBrand(tenantId);

            const newRow = {
                id: requestId,
                tenantId,
                inspectionId,
                agreementId: agreement.id,
                clientEmail: resolvedClientEmail,
                clientName: resolvedClientName,
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
                signerLegalName:   brand.legalName || null,
                signerCompanyName: brand.companyName || null,
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
                    // IA-37 — issue the signer link with a default TTL so a stale
                    // signing email can't be reused indefinitely.
                    expiresAt: new Date(now.getTime() + SIGNER_TOKEN_TTL_MS),
                });
            }

            logger.info('AgreementService.findOrCreate created', { tenantId, inspectionId, requestId, signers: signerInputs.length, completionPolicy });
            return { token: firstPlaintext, status: 'sent', alreadyExists: false, requestId, addedSignerIds: [] };
        }

        /**
         * IA-65 — reconcile an explicit signer set against an envelope that is
         * already out. Inserts the signers this envelope does not have yet
         * (matched case-insensitively on email, the same key the UNIQUE index
         * enforces) and returns their ids so the caller can email exactly the
         * people who were just added.
         *
         * Completion policy: only applied when NOTHING has been signed yet.
         * Relaxing 'all' to 'one' after a signature would complete the envelope
         * on the spot — firing the completion pipeline for parties who never
         * signed — so a partially-signed envelope keeps the policy it was sent
         * under and the new signer simply joins it.
         */
        public async mergeSignersIntoEnvelope(
            envelope: typeof agreementRequests.$inferSelect,
            signers: SignerInput[],
            completionPolicy?: 'all' | 'one',
        ): Promise<string[]> {
            if (signers.length === 0) return [];
            const db = this.getDrizzle();
            const current = await db.select().from(agreementSigners)
                .where(eq(agreementSigners.requestId, envelope.id)).all();
            const have = new Set(current.map((s) => s.email.trim().toLowerCase()));

            const now = new Date();
            const added: string[] = [];
            for (const s of signers) {
                const key = s.email.trim().toLowerCase();
                if (!key || have.has(key)) continue;
                have.add(key);
                const id = crypto.randomUUID();
                const plaintext = mintToken();
                await db.insert(agreementSigners).values({
                    id,
                    tenantId: envelope.tenantId,
                    requestId: envelope.id,
                    name: s.name,
                    email: s.email,
                    role: s.role ?? 'client',
                    contactId: s.contactId ?? null,
                    tokenHash: await hashToken(plaintext),
                    tokenEnc: this.secrets ? await sealToken(plaintext, envelope.tenantId, this.secrets.jwtSecret) : null,
                    status: 'sent',
                    createdAt: now,
                    expiresAt: new Date(now.getTime() + SIGNER_TOKEN_TTL_MS),
                });
                added.push(id);
            }

            const nothingSigned = current.every((s) => s.status !== 'signed');
            if (completionPolicy && completionPolicy !== envelope.completionPolicy && nothingSigned) {
                await db.update(agreementRequests)
                    .set({ completionPolicy })
                    .where(and(
                        eq(agreementRequests.id, envelope.id),
                        eq(agreementRequests.tenantId, envelope.tenantId),
                    ));
            }

            if (added.length > 0) {
                logger.info('AgreementService.findOrCreate merged signers', {
                    requestId: envelope.id, tenantId: envelope.tenantId, added: added.length,
                });
            }
            return added;
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
         * snapshot; on a pre-snapshot NULL value, loads the live template and (when
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
