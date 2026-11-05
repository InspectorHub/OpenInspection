import { eq, and, desc, asc } from 'drizzle-orm';
import { agreementRequests, agreementSigners } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { errorSummary } from '../../lib/error-summary';
import { mintToken, hashToken } from '../../lib/token-hash';
import { sealToken, openToken } from '../../lib/config-crypto';
import type { Constructor, AgreementServiceBase } from './base';

/**
 * Reading signers and their signing links. Split out of the signer-state mixin so that module holds only the claim/confirm/release and
 * envelope roll-forward unit that has to stay together.
 */
export function SignerLinksMixin<TBase extends Constructor<AgreementServiceBase>>(Base: TBase) {
    return class SignerLinks extends Base {
        public declare db: D1Database;
        public declare secrets?: { jwtSecret: string; jwtSecretPrevious?: string };
        public declare getDrizzle: AgreementServiceBase['getDrizzle'];

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
                .where(and(eq(agreementSigners.id, signerId), eq(agreementSigners.tenantId, tenantId)));
            return plaintext;
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
                    tenantId, inspectionId, error: errorSummary(e),
                });
                return null;
            }
        }
    };
}
