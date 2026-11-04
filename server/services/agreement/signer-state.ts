import { eq, and, inArray, sql, asc } from 'drizzle-orm';
import { agreementRequests, agreementSigners } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { hashToken } from '../../lib/token-hash';
import { isTokenRevokedOrExpired } from '../../lib/token-ttl';
import { computeEnvelopeStatus, type Constructor, type ResolvedSigner, type SignedOpts } from './base';
import type { AgreementServiceBase } from './base';
import { defaultSignerId, defaultSignerView } from './default-signer';

export type { SignedOpts } from './base';
/** How long a `signing` row is treated as a request still in flight. A later claim takes a row older than this over. */
export const STALE_SIGNING_MS = 120_000;
const MAX_CLAIM_ATTEMPTS = 3;
const SIGNING_IN_FLIGHT = 'This signature is still being recorded. Please try again in a moment.';

/** Rows a statement changed, from either driver's result shape (D1: `meta.changes`; the test driver: `changes`). */
function rowsChanged(result: unknown): number {
    const r = result as { changes?: number; meta?: { changes?: number } } | undefined;
    return r?.meta?.changes ?? r?.changes ?? 0;
}

/**
 * Track I-a — signer-level state machine (envelope v2).
 *
 * CRITICAL: the atomic envelope-completion logic (the conditional `WHERE` +
 * affected-row-count check that ensures single-fire completion) in
 * `finishSignedBySigner` / `markDeclinedBySigner` / `recomputeEnvelope`, and the
 * legacy envelope token-upgrade path in `getSignerByPresentedToken`, are a
 * correctness unit and MUST stay co-located in this module.
 */
export function SignerStateMixin<TBase extends Constructor<AgreementServiceBase>>(Base: TBase) {
    return class SignerState extends Base {
        // Re-declare the protected base members so this separately-compiled
        // mixin class can reference them with full typing.
        public declare db: D1Database;
        public declare secrets?: { jwtSecret: string; jwtSecretPrevious?: string };
        public declare getDrizzle: AgreementServiceBase['getDrizzle'];

        /** Reload all signers of an envelope ordered by creation. */
        public async loadSigners(requestId: string) {
            return this.getDrizzle().select().from(agreementSigners)
                .where(eq(agreementSigners.requestId, requestId))
                .orderBy(asc(agreementSigners.createdAt))
                .all();
        }

        /**
         * Resolve a presented public token to a signer + its envelope. Signer
         * tokens resolve first (tier-2 hash-at-rest); on a miss we try legacy
         * envelope tokens and load that envelope's first signer.
         *
         * Both lookups are hash-only. The envelope path used to carry a plaintext
         * fallback with a lazy hash-upgrade, for envelopes minted before the hash
         * existed. Production held three such rows and every one of them was
         * `expired` — an expired envelope is not signable, so the branch could
         * only ever resolve something the caller must refuse anyway.
         * The column itself is gone now: nothing could present a value that
         * resolved, because `findOrCreate` never wrote the matching `token_hash`.
         */
        async getSignerByPresentedToken(presented: string): Promise<ResolvedSigner | null> {
            const db = this.getDrizzle();
            const hash = await hashToken(presented);
            // 1) Signer-token path
            const signer = (await db.select().from(agreementSigners)
                .where(eq(agreementSigners.tokenHash, hash)).limit(1))[0] ?? null;
            if (signer) {
                // IA-37 — fail closed on a revoked or expired signer link. A dead
                // token must resolve to nothing (NotFound at the route), never to a
                // signable envelope.
                if (isTokenRevokedOrExpired(signer, Date.now())) return null;
                const envRows = await db.select().from(agreementRequests).where(eq(agreementRequests.id, signer.requestId)).limit(1);
                if (envRows.length === 0) return null;
                return { signer, envelope: envRows[0] };
            }

            // 2) Legacy envelope-token path (an envelope token from before signer links). It is held to the same rules as a signer link:
            //    an expired envelope, or a first signer whose link has been revoked or has run out, resolves to nothing. (It used to
            //    apply none of them, so a legacy token outlived every revocation and expiry that bind a signer link.) An envelope with no
            //    signer row still gets its one default signer on first open, as before; an expired one is refused before anything is written.
            const envelope = (await db.select().from(agreementRequests)
                .where(eq(agreementRequests.tokenHash, hash)).limit(1))[0] ?? null;
            if (!envelope || envelope.status === 'expired') return null;

            const signers = await this.loadSigners(envelope.id);
            if (signers.length === 0) {
                // A finished record is never added to by a read: a signed or declined envelope gets an in-memory view of its default signer.
                if (envelope.status === 'signed' || envelope.status === 'declined') return { signer: defaultSignerView(envelope), envelope };
                return { signer: await this.synthesizeDefaultSigner(envelope), envelope };
            }
            const first = signers[0]!;
            if (isTokenRevokedOrExpired(first, Date.now())) return null;
            return { signer: first, envelope };
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
            // A fixed id per envelope: two requests opening the same signer-less envelope together insert the same row, and the second is
            // ignored, so there is never a second signer.
            const synthId = defaultSignerId(envelope.id);
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
            }).onConflictDoNothing();
            return (await db.select().from(agreementSigners).where(eq(agreementSigners.id, synthId)).limit(1))[0];
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
         * Claims the signing for a signer: ONE conditional update that moves the signer from a live status to `signing` (NOT to `signed`)
         * and stores the drawing, time, address and browser. The order of a signing is
         *
         *   claim (live -> signing)  ->  append `signer.signed`  ->  `confirm` (signing -> signed)  ->  `finishSignedBySigner`.
         *
         * `signing` is not terminal and is never counted as signed (not by the envelope aggregate, the progress counters, the renders or the
         * verifier roster), so another signer's finish cannot complete the envelope on the strength of a signature whose audit row does not
         * exist yet. A signer reads as `signed` only after the append succeeded.
         *
         * The claim's WHERE pins the status that was read, so it replaces exactly what it saw. On a miss the row is read again and the
         * answer decided from it: already signed (a confirmed signing: `already_signed`), signing and recent (409, retry in a moment), signing
         * and older than `STALE_SIGNING_MS` (taken over), declined or expired (409), or merely moved on to another live status (claim again).
         *
         * INVARIANT: the newest `signer.signed` audit row of a signer names the drawing that is stored. A lost race never leaves an audit
         * row, because only the winner appends; if the append fails, `release` puts the signer back and the signing is refused.
         *
         * TAKE-OVER: a process that dies between the claim and the confirm leaves a signer in `signing`. After `STALE_SIGNING_MS` the next
         * claim takes the row over. The earlier drawing is overwritten, never recorded: if its append had committed, that row stays in the
         * chain and the new claim's append (deduplicated by drawing hash) writes a newer row naming the drawing now stored.
         *
         * REMAINING WINDOWS, all of them omissions and none a false record: (1) a process that dies after the claim and before the confirm
         * leaves a signer stuck in `signing`, with no `signer.signed` row or with one whose confirm never happened, until the take-over
         * window passes; nothing is ever written afterwards. (2) If the append's INSERT commits but the call reports an error, `release`
         * reverts the signer while an orphan `signer.signed` row exists. A retry with another drawing writes a newer row naming that
         * drawing; a retry with the same drawing finds the orphan and reuses it. If nobody retries, the orphan stays, and it cannot be
         * repaired because a signing record is never rewritten. (3) If `confirm` itself reports an error after the append, the signer may
         * be left in `signing` with its row present; the same take-over resolves it.
         *
         * `release` exists ONLY on a `claimed` result. It is one conditional update that reverts a row only while it still has status
         * `signing` AND this claim's drawing AND this claim's time, and it sets back exactly the eleven columns the claim set (status,
         * signature, signed time, channel, address, browser, on-behalf name and disclaimer, language-disclosure version, attribution basis
         * and time) to the values the row had when claimed, and touches no other column. If the envelope expired meanwhile, a signer put
         * back to pending, sent or viewed is expired with it, as the expiry cron would have done.
         */
        async claimSignedBySigner(presented: string, signatureBase64: string, opts: SignedOpts): Promise<
            | { kind: 'claimed'; signer: typeof agreementSigners.$inferSelect; envelope: typeof agreementRequests.$inferSelect; release: () => Promise<void>; confirm: () => Promise<void> }
            | { kind: 'already_signed'; signer: typeof agreementSigners.$inferSelect; envelope: typeof agreementRequests.$inferSelect }
        > {
            const db = this.getDrizzle();
            const resolved = await this.getSignerByPresentedToken(presented);
            if (!resolved) throw Errors.NotFound('Agreement request not found');
            const { envelope } = resolved;
            let signer = resolved.signer;
            const signedAt = new Date(opts.signedAtMs);

            for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
                if (signer.status === 'declined' || signer.status === 'expired') throw Errors.Conflict('Agreement is no longer signable');
                if (signer.status === 'signed') return { kind: 'already_signed', signer, envelope };
                const takeover = signer.status === 'signing';
                if (takeover && signer.signedAt && Date.now() - signer.signedAt.getTime() < STALE_SIGNING_MS) throw Errors.Conflict(SIGNING_IN_FLIGHT);

                const claimedFrom = signer;
                const res: unknown = await db.update(agreementSigners)
                    .set({
                        status: 'signing',
                        signatureBase64,
                        signedAt,
                        channel: opts.channel,
                        ipAddress: opts.ipAddress ?? null,
                        userAgent: opts.userAgent ?? null,
                        onBehalfOf: opts.onBehalfOf ?? null,
                        onBehalfDisclaimer: opts.onBehalfDisclaimer ?? null,
                        languageDisclosureVersion: opts.languageDisclosureVersion,
                        // This row is the signing event itself: stated, never NULL, so a NULL basis anywhere reads as "not recorded".
                        attributionBasis: 'signing_event',
                        attributedAt: signedAt,
                    })
                    .where(and(
                        eq(agreementSigners.id, claimedFrom.id),
                        eq(agreementSigners.status, claimedFrom.status),
                        // A take-over also pins the claim time it judged stale, so two takers cannot both win.
                        takeover && claimedFrom.signedAt ? eq(agreementSigners.signedAt, claimedFrom.signedAt) : sql`1 = 1`,
                    ));
                if (rowsChanged(res) > 0) {
                    const sameClaim = and(
                        eq(agreementSigners.id, claimedFrom.id),
                        eq(agreementSigners.status, 'signing'),
                        eq(agreementSigners.signatureBase64, signatureBase64),
                        eq(agreementSigners.signedAt, signedAt),
                    );
                    const confirm = async (): Promise<void> => {
                        const flipped: unknown = await db.update(agreementSigners).set({ status: 'signed' }).where(sameClaim);
                        if (rowsChanged(flipped) === 0) throw Errors.Conflict(SIGNING_IN_FLIGHT);
                    };
                    const release = async (): Promise<void> => {
                        await db.update(agreementSigners)
                            .set({
                                status: claimedFrom.status,
                                signatureBase64: claimedFrom.signatureBase64 ?? null,
                                signedAt: claimedFrom.signedAt ?? null,
                                channel: claimedFrom.channel ?? null,
                                ipAddress: claimedFrom.ipAddress ?? null,
                                userAgent: claimedFrom.userAgent ?? null,
                                onBehalfOf: claimedFrom.onBehalfOf ?? null,
                                onBehalfDisclaimer: claimedFrom.onBehalfDisclaimer ?? null,
                                languageDisclosureVersion: claimedFrom.languageDisclosureVersion ?? null,
                                attributionBasis: claimedFrom.attributionBasis ?? null,
                                attributedAt: claimedFrom.attributedAt ?? null,
                            })
                            .where(sameClaim);
                        // The expiry cron skips a `signing` signer; if the envelope expired in the meantime, finish what it would have done.
                        await db.update(agreementSigners).set({ status: 'expired' }).where(and(
                            eq(agreementSigners.id, claimedFrom.id),
                            inArray(agreementSigners.status, ['pending', 'sent', 'viewed']),
                            sql`${agreementSigners.requestId} IN (SELECT id FROM ${agreementRequests} WHERE ${agreementRequests.status} = 'expired')`,
                        ));
                    };
                    return { kind: 'claimed', signer: claimedFrom, envelope, release, confirm };
                }
                // Someone moved the signer first. Decide from the row as it is now.
                const now = (await db.select().from(agreementSigners).where(eq(agreementSigners.id, claimedFrom.id)).limit(1))[0];
                if (!now) throw Errors.NotFound('Agreement request not found');
                signer = now;
            }
            throw Errors.Conflict(SIGNING_IN_FLIGHT);
        }

        /**
         * Rolls the envelope forward for a signer whose signing was confirmed earlier (a retry after a failed finish). The envelope is read
         * again; a terminal one is left alone, and the single-fire completion guard in `finishSignedBySigner` means a second retry does
         * nothing. Null when there was nothing to do.
         */
        async resumeConfirmedSigning(signer: typeof agreementSigners.$inferSelect, envelope: typeof agreementRequests.$inferSelect) {
            const fresh = (await this.getDrizzle().select().from(agreementRequests).where(eq(agreementRequests.id, envelope.id)).limit(1))[0];
            if (!fresh || ['signed', 'declined', 'expired'].includes(fresh.status)) return null;
            return this.finishSignedBySigner(signer, fresh, signer.signedAt?.getTime() ?? Date.now());
        }

        /** Rolls the envelope aggregate forward after a signer's signature was claimed; completion is claimed by one writer only. */
        async finishSignedBySigner(
            signer: typeof agreementSigners.$inferSelect,
            envelope: typeof agreementRequests.$inferSelect,
            signedAtMs: number,
        ): Promise<{ tenantId: string; inspectionId: string; requestId: string; signerId: string; envelopeCompletedNow: boolean; envelopeStatus: string }> {
            const db = this.getDrizzle();
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
                // The envelope records THAT it completed and WHEN — not the
                // signature. Copying one up from a signer row answered a question
                // it could not answer: on a multi-signer envelope it held whichever
                // signature won this race, as if the envelope had an author. Now
                // nothing reads the copy either (the renderer asks the rows).
                // `signedAt` stays; that one IS read.
                const res: unknown = await db.update(agreementRequests)
                    .set({
                        status: 'signed',
                        signedAt: new Date(signedAtMs),
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
        async markDeclinedBySigner(presented: string, reason?: string): Promise<{ tenantId: string; inspectionId: string; requestId: string; signerId: string; envelopeStatus: string; declinedNow: boolean }> {
            const db = this.getDrizzle();
            const resolved = await this.getSignerByPresentedToken(presented);
            if (!resolved) throw Errors.NotFound('Agreement request not found');
            const { signer, envelope } = resolved;
            if (signer.status === 'signed' || signer.status === 'expired') {
                throw Errors.Conflict('Agreement cannot be declined');
            }
            if (signer.status === 'signing') throw Errors.Conflict(SIGNING_IN_FLIGHT);
            if (signer.status === 'declined') {
                return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id, signerId: signer.id, envelopeStatus: envelope.status, declinedNow: false };
            }
            // One conditional update decides it: of a decline and a signature arriving together, exactly one moves the signer.
            const moved: unknown = await db.update(agreementSigners)
                .set({ status: 'declined' })
                .where(and(
                    eq(agreementSigners.id, signer.id),
                    sql`${agreementSigners.status} NOT IN ('signed','signing','declined','expired')`,
                ));
            if (rowsChanged(moved) === 0) {
                const now = (await db.select().from(agreementSigners).where(eq(agreementSigners.id, signer.id)).limit(1))[0];
                if (now?.status === 'declined') {
                    return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id, signerId: signer.id, envelopeStatus: envelope.status, declinedNow: false };
                }
                throw Errors.Conflict('Agreement cannot be declined');
            }

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

            return { tenantId: envelope.tenantId, inspectionId: envelope.inspectionId, requestId: envelope.id, signerId: signer.id, envelopeStatus: aggregate, declinedNow: true };
        }

        /** Recompute + persist the envelope aggregate (never downgrades a terminal envelope). */
        public async recomputeEnvelope(envelope: typeof agreementRequests.$inferSelect): Promise<string> {
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
