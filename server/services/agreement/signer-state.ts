import { eq, and, inArray, sql, desc, asc } from 'drizzle-orm';
import { agreementRequests, agreementSigners } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { mintToken, hashToken, deadTokenSentinel, resolveTokenRow } from '../../lib/token-hash';
import { sealToken, openToken } from '../../lib/config-crypto';
import { computeEnvelopeStatus, type Constructor, type ResolvedSigner } from './base';
import type { AgreementServiceBase } from './base';

/**
 * Track I-a — signer-level state machine (envelope v2).
 *
 * CRITICAL: the atomic envelope-completion logic (the conditional `WHERE` +
 * affected-row-count check that ensures single-fire completion) in
 * `markSignedBySigner` / `markDeclinedBySigner` / `recomputeEnvelope`, and the
 * legacy envelope token-upgrade path in `getSignerByPresentedToken`, are a
 * correctness unit and MUST stay co-located in this module.
 */
export function SignerStateMixin<TBase extends Constructor<AgreementServiceBase>>(Base: TBase) {
    return class SignerState extends Base {
        // Re-declare the protected base members so this separately-compiled
        // mixin class can reference them with full typing.
        protected declare db: D1Database;
        protected declare secrets?: { jwtSecret: string; jwtSecretPrevious?: string };
        protected declare getDrizzle: AgreementServiceBase['getDrizzle'];

        /** Reload all signers of an envelope ordered by creation. */
        protected async loadSigners(requestId: string) {
            return this.getDrizzle().select().from(agreementSigners)
                .where(eq(agreementSigners.requestId, requestId))
                .orderBy(asc(agreementSigners.createdAt))
                .all();
        }

        /**
         * Resolve a presented public token to a signer + its envelope. Signer
         * tokens resolve first (tier-2 hash-at-rest; plaintext is NEVER stored, so
         * the byPlaintext branch is always null). On a miss we fall back to legacy
         * envelope tokens (tokenHash, then permanent plaintext fallback with a lazy
         * hash-upgrade) and load that envelope's first signer.
         */
        async getSignerByPresentedToken(presented: string): Promise<ResolvedSigner | null> {
            const db = this.getDrizzle();
            // 1) Signer-token path
            const signer = await resolveTokenRow<typeof agreementSigners.$inferSelect>({
                presented,
                byHash: async (hash) =>
                    (await db.select().from(agreementSigners).where(eq(agreementSigners.tokenHash, hash)).limit(1))[0] ?? null,
                byPlaintext: async () => null, // signer plaintext is never persisted
                upgrade: async () => { /* nothing to upgrade — hash is the only key */ },
            });
            if (signer) {
                const envRows = await db.select().from(agreementRequests).where(eq(agreementRequests.id, signer.requestId)).limit(1);
                if (envRows.length === 0) return null;
                return { signer, envelope: envRows[0] };
            }

            // 2) Legacy envelope-token path
            const envelope = await resolveTokenRow<typeof agreementRequests.$inferSelect>({
                presented,
                byHash: async (hash) =>
                    (await db.select().from(agreementRequests).where(eq(agreementRequests.tokenHash, hash)).limit(1))[0] ?? null,
                byPlaintext: async (token) =>
                    (await db.select().from(agreementRequests).where(eq(agreementRequests.token, token)).limit(1))[0] ?? null,
                upgrade: async (row, hash) => {
                    await db.update(agreementRequests)
                        .set({ tokenHash: hash, token: deadTokenSentinel(row.id) })
                        .where(eq(agreementRequests.id, row.id));
                },
            });
            if (!envelope) return null;

            // Load the envelope's first signer; synthesize one for weird legacy data.
            const signers = await this.loadSigners(envelope.id);
            if (signers.length > 0) {
                return { signer: signers[0], envelope };
            }
            const created = await this.synthesizeDefaultSigner(envelope);
            return { signer: created, envelope };
        }

        /**
         * Synthesize a single default client signer for a legacy envelope that has
         * none (created via the pre-envelope-v2 `createSigningRequest` path). The
         * signer mirrors the envelope's client + status and carries no link token
         * (tokenHash/tokenEnc NULL) — the legacy plaintext envelope token remains
         * the distributed link. Shared by `getSignerByPresentedToken` (public
         * resolution) and `findOrCreate` (in-app reuse) so the two stay identical.
         */
        async synthesizeDefaultSigner(
            envelope: typeof agreementRequests.$inferSelect,
        ): Promise<typeof agreementSigners.$inferSelect> {
            const db = this.getDrizzle();
            const synthId = crypto.randomUUID();
            const now = new Date();
            await db.insert(agreementSigners).values({
                id: synthId,
                tenantId: envelope.tenantId,
                requestId: envelope.id,
                name: envelope.clientName || envelope.clientEmail || 'Client',
                email: envelope.clientEmail || '',
                role: 'client',
                tokenHash: null,
                tokenEnc: null,
                status: envelope.status,
                createdAt: now,
            });
            return (await db.select().from(agreementSigners).where(eq(agreementSigners.id, synthId)).limit(1))[0];
        }

        /** List all signers of an envelope (tenant-scoped), ordered by creation. */
        async listSigners(tenantId: string, requestId: string): Promise<Array<typeof agreementSigners.$inferSelect>> {
            return this.getDrizzle().select().from(agreementSigners)
                .where(and(eq(agreementSigners.tenantId, tenantId), eq(agreementSigners.requestId, requestId)))
                .orderBy(asc(agreementSigners.createdAt))
                .all();
        }

        /**
         * Returns the plaintext public link token for a signer. Decrypts the sealed
         * token_enc (current → previous secret); on a backfilled row (token_enc
         * NULL) mints a fresh token and persists tokenHash + token_enc.
         */
        async getSignerLink(tenantId: string, requestId: string, signerId: string): Promise<string> {
            const db = this.getDrizzle();
            const rows = await db.select().from(agreementSigners)
                .where(and(eq(agreementSigners.id, signerId), eq(agreementSigners.requestId, requestId), eq(agreementSigners.tenantId, tenantId))).limit(1);
            if (rows.length === 0) throw Errors.NotFound('Signer not found');
            const signer = rows[0];
            if (signer.tokenEnc) {
                if (!this.secrets) throw Errors.Internal('Token sealing key unavailable');
                return openToken(signer.tokenEnc, signer.tenantId, this.secrets.jwtSecret, this.secrets.jwtSecretPrevious);
            }
            // Backfilled row — mint now and persist.
            if (!this.secrets) throw Errors.Internal('Token sealing key unavailable');
            const plaintext = mintToken();
            await db.update(agreementSigners)
                .set({ tokenHash: await hashToken(plaintext), tokenEnc: await sealToken(plaintext, signer.tenantId, this.secrets.jwtSecret) })
                .where(eq(agreementSigners.id, signerId));
            return plaintext;
        }

        /**
         * Track I-a Task 7 — server-side reconstruction of the combined-checkout
         * link for an inspection. Finds the latest non-terminal envelope for the
         * inspection, then its first non-terminal signer (pending / sent / viewed,
         * ordered by creation), and returns that signer's plaintext public token.
         * Returns null when there is no outstanding signer to route to (no envelope,
         * or every signer is already signed / declined / expired). The plaintext is
         * NEVER persisted — only the caller (a server-side link builder) sees it.
         */
        async getFirstOutstandingSignerLink(tenantId: string, inspectionId: string): Promise<string | null> {
            const db = this.getDrizzle();
            const envelope = await db.select().from(agreementRequests)
                .where(and(
                    eq(agreementRequests.tenantId, tenantId),
                    eq(agreementRequests.inspectionId, inspectionId),
                    inArray(agreementRequests.status, ['pending', 'sent', 'viewed']),
                ))
                .orderBy(desc(agreementRequests.createdAt))
                .limit(1)
                .get();
            if (!envelope) return null;

            const outstanding = await db.select().from(agreementSigners)
                .where(and(
                    eq(agreementSigners.requestId, envelope.id),
                    inArray(agreementSigners.status, ['pending', 'sent', 'viewed']),
                ))
                .orderBy(asc(agreementSigners.createdAt))
                .limit(1)
                .get();
            if (!outstanding) return null;

            try {
                return await this.getSignerLink(tenantId, envelope.id, outstanding.id);
            } catch (e) {
                logger.warn('AgreementService.getFirstOutstandingSignerLink failed', {
                    tenantId, inspectionId, requestId: envelope.id, error: e instanceof Error ? e.message : String(e),
                });
                return null;
            }
        }

        /**
         * Returns the plaintext public link token for the signer of the LATEST
         * envelope of (tenantId, inspectionId) whose email matches `email`
         * case-insensitively. Used by the unified client-portal Hub to inline the
         * agreement section for the authenticated recipient.
         *
         * SECURITY: returns ONLY the token of the signer whose email matches the
         * caller's verified email. It NEVER falls back to "the first signer" — handing
         * back a non-matching signer's token would let a recipient sign AS someone
         * else. Returns null when there is no envelope, no email-matched signer, or
         * the token cannot be reconstructed. The matched envelope may be in ANY status
         * (including signed/declined) so a completed agreement is still viewable.
         */
        async getSignerLinkByEmail(tenantId: string, inspectionId: string, email: string): Promise<string | null> {
            const target = (email || '').trim().toLowerCase();
            if (!target) return null;
            const db = this.getDrizzle();
            try {
                const envelope = await db.select().from(agreementRequests)
                    .where(and(
                        eq(agreementRequests.tenantId, tenantId),
                        eq(agreementRequests.inspectionId, inspectionId),
                    ))
                    .orderBy(desc(agreementRequests.createdAt))
                    .limit(1)
                    .get();
                if (!envelope) return null;

                const signers = await db.select().from(agreementSigners)
                    .where(eq(agreementSigners.requestId, envelope.id))
                    .all();
                const signer = signers.find((s) => (s.email || '').trim().toLowerCase() === target);
                if (!signer) return null;

                return await this.getSignerLink(tenantId, envelope.id, signer.id);
            } catch (e) {
                logger.warn('AgreementService.getSignerLinkByEmail failed', {
                    tenantId, inspectionId, error: e instanceof Error ? e.message : String(e),
                });
                return null;
            }
        }

        /**
         * Marks a signer (resolved by presented token) as viewed and recomputes the
         * envelope aggregate (never downgrades). Null on miss / expired signer.
         * Idempotent.
         */
        async markViewedBySigner(presented: string): Promise<{ tenantId: string; inspectionId: string; agreementId: string; signerId: string } | null> {
            const db = this.getDrizzle();
            const resolved = await this.getSignerByPresentedToken(presented);
            if (!resolved) return null;
            const { signer, envelope } = resolved;
            if (signer.status === 'expired') return null;
            if (signer.status === 'pending' || signer.status === 'sent') {
                await db.update(agreementSigners)
                    .set({ status: 'viewed', viewedAt: new Date() })
                    .where(and(eq(agreementSigners.id, signer.id), inArray(agreementSigners.status, ['pending', 'sent'])));
                await this.recomputeEnvelope(envelope);
            }
            return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, agreementId: envelope.agreementId, signerId: signer.id };
        }

        /**
         * Records a signer signature and rolls the envelope aggregate forward.
         * Mirrors legacy guards per SIGNER status: declined/expired → Conflict;
         * already-signed → idempotent (completedNow=false).
         */
        async markSignedBySigner(presented: string, signatureBase64: string, opts: {
            signedAtMs: number; channel: 'remote' | 'in_person'; ipAddress?: string | null; userAgent?: string | null;
            onBehalfOf?: string | null; onBehalfDisclaimer?: string | null;
        }): Promise<{ tenantId: string; inspectionId: string; requestId: string; signerId: string; envelopeCompletedNow: boolean; envelopeStatus: string }> {
            const db = this.getDrizzle();
            const resolved = await this.getSignerByPresentedToken(presented);
            if (!resolved) throw Errors.NotFound('Agreement request not found');
            const { signer, envelope } = resolved;
            if (signer.status === 'declined' || signer.status === 'expired') {
                throw Errors.Conflict('Agreement is no longer signable');
            }
            if (signer.status === 'signed') {
                return {
                    tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id,
                    signerId: signer.id, envelopeCompletedNow: false, envelopeStatus: envelope.status,
                };
            }
            await db.update(agreementSigners)
                .set({
                    status: 'signed',
                    signatureBase64,
                    signedAt: new Date(opts.signedAtMs),
                    channel: opts.channel,
                    ipAddress: opts.ipAddress ?? null,
                    userAgent: opts.userAgent ?? null,
                    onBehalfOf: opts.onBehalfOf ?? null,
                    onBehalfDisclaimer: opts.onBehalfDisclaimer ?? null,
                })
                .where(and(
                    eq(agreementSigners.id, signer.id),
                    sql`${agreementSigners.status} NOT IN ('signed','declined','expired')`,
                ));

            const previousStatus = envelope.status;
            const signers = await this.loadSigners(envelope.id);
            const aggregate = computeEnvelopeStatus(envelope.completionPolicy, signers);

            // Claim envelope completion ATOMICALLY. The in-memory `envelope.status`
            // snapshot is stale under concurrency (two sign calls — same signer
            // twice, or the last two signers of an 'all' envelope landing together —
            // can both compute aggregate==='signed' from the same snapshot). Deriving
            // `envelopeCompletedNow` from that snapshot lets BOTH writers report
            // completion → duplicate downstream notifications/emails (the workflow is
            // id-idempotent, but the other effects are not). Instead, gate completion
            // on the row count of a single conditional UPDATE that only one writer can
            // win: `WHERE status NOT IN (terminal)`.
            let envelopeCompletedNow = false;
            if (aggregate === 'signed') {
                const res: unknown = await db.update(agreementRequests)
                    .set({
                        status: 'signed',
                        signedAt: new Date(opts.signedAtMs),
                        signatureBase64, // legacy reader compat
                    })
                    .where(and(
                        eq(agreementRequests.id, envelope.id),
                        sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
                    ));
                // Driver-tolerant row-count extraction: drizzle/d1 returns
                // `{ meta: { changes } }`; drizzle/better-sqlite3 (unit tests) returns
                // a top-level `{ changes }`. Empirically verified both shapes carry the count.
                const changes = (res as { meta?: { changes?: number } })?.meta?.changes
                    ?? (res as { changes?: number })?.changes
                    ?? 0;
                envelopeCompletedNow = changes > 0;
            } else if (!['signed', 'declined', 'expired'].includes(previousStatus) && aggregate !== previousStatus) {
                // Non-'signed' aggregate transitions (viewed). Also gated on a
                // conditional WHERE so a late writer can't clobber a terminal envelope.
                await db.update(agreementRequests)
                    .set({ status: aggregate })
                    .where(and(
                        eq(agreementRequests.id, envelope.id),
                        sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
                    ));
            }

            return {
                tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id,
                signerId: signer.id, envelopeCompletedNow, envelopeStatus: aggregate,
            };
        }

        /**
         * Marks a signer as declined and rolls the envelope aggregate. signed/expired
         * signer → Conflict; declined → idempotent. When the aggregate flips to
         * 'declined', the reason is stored on the envelope's lastError.
         */
        async markDeclinedBySigner(presented: string, reason?: string): Promise<{ tenantId: string; inspectionId: string; requestId: string; signerId: string; envelopeStatus: string }> {
            const db = this.getDrizzle();
            const resolved = await this.getSignerByPresentedToken(presented);
            if (!resolved) throw Errors.NotFound('Agreement request not found');
            const { signer, envelope } = resolved;
            if (signer.status === 'signed' || signer.status === 'expired') {
                throw Errors.Conflict('Agreement cannot be declined');
            }
            if (signer.status === 'declined') {
                return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id, signerId: signer.id, envelopeStatus: envelope.status };
            }
            await db.update(agreementSigners)
                .set({ status: 'declined' })
                .where(and(
                    eq(agreementSigners.id, signer.id),
                    sql`${agreementSigners.status} NOT IN ('signed','declined','expired')`,
                ));

            const previousStatus = envelope.status;
            const signers = await this.loadSigners(envelope.id);
            const aggregate = computeEnvelopeStatus(envelope.completionPolicy, signers);
            // Conditional WHERE (not just the in-memory `previousStatus` guard) so a
            // late decliner can't clobber an envelope another writer already drove
            // terminal under concurrency.
            if (!['signed', 'declined', 'expired'].includes(previousStatus) && aggregate !== previousStatus) {
                const patch: Partial<typeof agreementRequests.$inferInsert> = { status: aggregate };
                if (aggregate === 'declined' && reason) patch.lastError = reason.slice(0, 500);
                await db.update(agreementRequests).set(patch).where(and(
                    eq(agreementRequests.id, envelope.id),
                    sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
                ));
            }

            return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id, signerId: signer.id, envelopeStatus: aggregate };
        }

        /** Recompute + persist the envelope aggregate (never downgrades a terminal envelope). */
        protected async recomputeEnvelope(envelope: typeof agreementRequests.$inferSelect): Promise<string> {
            const db = this.getDrizzle();
            if (['signed', 'declined', 'expired'].includes(envelope.status)) return envelope.status;
            const signers = await this.loadSigners(envelope.id);
            const aggregate = computeEnvelopeStatus(envelope.completionPolicy, signers);
            if (aggregate !== envelope.status) {
                // Conditional WHERE so a late viewer can't downgrade an envelope that
                // another concurrent writer already drove terminal (the in-memory
                // `envelope.status` snapshot is not authoritative under concurrency).
                await db.update(agreementRequests).set({ status: aggregate }).where(and(
                    eq(agreementRequests.id, envelope.id),
                    sql`${agreementRequests.status} NOT IN ('signed','declined','expired')`,
                ));
            }
            return aggregate;
        }
    };
}
