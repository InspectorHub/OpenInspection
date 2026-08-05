import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { claimKey, completeKey, releaseKey } from '../idempotency/store';
import { fingerprint } from '../idempotency/fingerprint';
import { logger } from '../logger';

/**
 * M1 of the idempotency programme (portal #107): outbound email dedupe.
 *
 * A duplicate send costs real money, reaches the client twice, and cannot be
 * recalled — strictly worse than the duplicate records that triggered this
 * work. So the send path takes the same claim the HTTP middleware takes, from
 * the same table, scoped to the same tenant.
 *
 * Keys are TENANT-SCOPED. Two tenants that mint the same key must both send;
 * a global key namespace would silently swallow one tenant's mail because
 * another tenant sent something unrelated first.
 */
export interface EmailDedupePort {
    /** true ⇒ this send is ours to perform. false ⇒ an identical send already happened, or is happening now. */
    claim(key: string, payload: unknown): Promise<boolean>;
    /** Settle the claim: a delivered send is recorded, a failed one releases the key for a retry. */
    settle(key: string, delivered: boolean): Promise<void>;
}

/** Retries happen in seconds; the same 24h window the HTTP middleware uses. */
const TTL_MS = 24 * 60 * 60 * 1000;

export function buildEmailDedupe(db: DrizzleD1Database, tenantId: string): EmailDedupePort {
    return {
        async claim(key: string, payload: unknown): Promise<boolean> {
            const fp = await fingerprint('EMAIL', 'send', payload);
            const result = await claimKey(db, { tenantId, key, fingerprint: fp, ttlMs: TTL_MS });
            if (result === 'claimed') return true;
            if (result.state === 'fingerprint_mismatch') {
                // One key, two different messages: a caller bug. Every gate on
                // the email path is fail-open toward delivery — nobody reports
                // mail that never arrived — so send, and make the bug visible.
                logger.warn('[email] idempotency key reused with a different payload — sending anyway');
                return true;
            }
            return false;
        },

        async settle(key: string, delivered: boolean): Promise<void> {
            if (delivered) {
                await completeKey(db, { tenantId, key, status: 200, body: '{"delivered":true}' });
            } else {
                await releaseKey(db, { tenantId, key });
            }
        },
    };
}
