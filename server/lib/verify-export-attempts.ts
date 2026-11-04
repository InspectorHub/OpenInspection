/**
 * The attempt allowance of the signed audit export's knowledge check (see server/api/public/verify-export.ts).
 *
 * An attempt is RESERVED before the answer is compared: one upsert adds one to the counter and returns the new count, so N parallel
 * requests are handed N distinct counts and only the first `limit` of them go on to the comparison. A read followed by a write would let
 * them all read the same number, and a key-value store is eventually consistent besides, which is why the counters live in the
 * database (table verify_export_attempts). A request that turns out right, or that was stopped by the bot challenge, hands its
 * reservation back; a wrong answer keeps it. A window opens at its first attempt and is never extended, and a lockout is not lifted by
 * a success.
 *
 * Counters exist only for envelopes that exist: the route reads the envelope first and answers an unknown id without reserving
 * anything, so a caller inventing ids writes no rows. The counters that apply to one request, strictest first, are the four in
 * ATTEMPT_LIMITS below (the only place their numbers are written): email and postal per (envelope, address), then a postal ceiling and
 * an any-kind ceiling per envelope across every address. A postal code has a small keyspace, so it gets the smaller allowances. The
 * per-address counters are keyed by address on purpose: a third party who fails repeatedly locks only themselves out, not the signer.
 * The address is never stored: the key holds a keyed hash of its network prefix (an IPv6 address counts as its /64).
 *
 * Rows are short-lived. A row whose window has ended is replaced by the next attempt on its key; rows nobody comes back to are removed
 * by the scheduled retention sweep (retention rule for verify_export_attempts, a day after the window ended), not by a request.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './db/schema';
import { hmacSha256, bytesToHex } from './email/webhook-crypto';
import { normalizeAddress } from './network-address';

const FIFTEEN_MINUTES = 15 * 60;
const ONE_HOUR = 60 * 60;

export interface AttemptBucket { key: string; limit: number; windowSeconds: number }

/** Every limit of the audit export's knowledge check: attempts allowed in one window. The single source for code, tests and docs. */
export const ATTEMPT_LIMITS = {
    /** Wrong emails, per (envelope, network). */
    email: { limit: 5, windowSeconds: FIFTEEN_MINUTES },
    /** Wrong postal codes, per (envelope, network): fewer than emails, because a postal code is a weaker factor. */
    postal: { limit: 3, windowSeconds: FIFTEEN_MINUTES },
    /** Postal codes for the envelope, every network together. */
    envelopePostal: { limit: 10, windowSeconds: ONE_HOUR },
    /** Attempts of either kind for the envelope, every network together. */
    envelope: { limit: 50, windowSeconds: ONE_HOUR },
} as const;

export const emailBucket = (envelopeId: string, who: string): AttemptBucket => ({ key: `email:${envelopeId}:${who}`, ...ATTEMPT_LIMITS.email });
export const postalBucket = (envelopeId: string, who: string): AttemptBucket => ({ key: `postal:${envelopeId}:${who}`, ...ATTEMPT_LIMITS.postal });
export const envelopePostalBucket = (envelopeId: string): AttemptBucket => ({ key: `envelope-postal:${envelopeId}`, ...ATTEMPT_LIMITS.envelopePostal });
export const envelopeBucket = (envelopeId: string): AttemptBucket => ({ key: `envelope:${envelopeId}`, ...ATTEMPT_LIMITS.envelope });

export { normalizeAddress };

/** What the counters store in place of an address: a keyed hash of its network, from the deployment's KDF secret. Throws without a secret. */
export async function addressDigest(address: string, secret: string | undefined): Promise<string> {
    if (!secret) throw new Error('verify-export address digest needs JWT_SECRET');
    const mac = await hmacSha256(new TextEncoder().encode(secret), `verify-export-address:${normalizeAddress(address)}`);
    return bytesToHex(mac).slice(0, 32);
}

export interface Reservation {
    /** Seconds until the window that stopped this request ends; 0 when the request may go on to the comparison. */
    waitSeconds: number;
    /** Hands the reserved attempts back (a right answer, or a request stopped before it was compared). Never throws. */
    release: () => Promise<void>;
}

interface Held { key: string; endsAt: number }

async function reserveOne(orm: ReturnType<typeof drizzle<typeof schema>>, bucket: AttemptBucket, now: number): Promise<{ attempts: number; endsAt: number }> {
    const t = schema.verifyExportAttempts;
    const fresh = now + bucket.windowSeconds * 1000;
    const rows = await orm.insert(t)
        .values({ key: bucket.key, attempts: 1, windowEndsAt: new Date(fresh) })
        .onConflictDoUpdate({
            target: t.key,
            set: {
                attempts: sql`CASE WHEN ${t.windowEndsAt} <= ${now} THEN 1 ELSE ${t.attempts} + 1 END`,
                windowEndsAt: sql`CASE WHEN ${t.windowEndsAt} <= ${now} THEN ${fresh} ELSE ${t.windowEndsAt} END`,
            },
        })
        .returning({ attempts: t.attempts, endsAt: t.windowEndsAt });
    const row = rows[0];
    if (!row) throw new Error('verify-export attempt counter returned no row');
    return { attempts: row.attempts, endsAt: row.endsAt.getTime() };
}

/**
 * Reserves one attempt on each bucket, in the order given, and stops at the first one that is over its limit. When any is over, every
 * reservation made so far is handed back (so a caller already locked out does not use up the shared counters) and `waitSeconds` says
 * when that window ends. Throws when the store fails: the caller must refuse.
 */
export async function reserveAttempts(db: D1Database, buckets: readonly AttemptBucket[], now: number): Promise<Reservation> {
    const orm = drizzle(db, { schema });
    const held: Held[] = [];
    const release = async (): Promise<void> => {
        for (const h of held.splice(0)) {
            try {
                // Only the window this request counted in: a window that has rolled over since is somebody else's count.
                await orm.update(schema.verifyExportAttempts)
                    .set({ attempts: sql`MAX(${schema.verifyExportAttempts.attempts} - 1, 0)` })
                    .where(and(eq(schema.verifyExportAttempts.key, h.key), eq(schema.verifyExportAttempts.windowEndsAt, new Date(h.endsAt))));
            } catch {
                // A reservation that cannot be handed back stays counted: the allowance errs on the side of fewer attempts.
            }
        }
    };
    let waitSeconds = 0;
    for (const bucket of buckets) {
        const { attempts, endsAt } = await reserveOne(orm, bucket, now);
        held.push({ key: bucket.key, endsAt });
        if (attempts > bucket.limit) {
            waitSeconds = Math.max(1, Math.ceil((endsAt - now) / 1000));
            break;
        }
    }
    if (waitSeconds > 0) await release();
    return { waitSeconds, release };
}

/**
 * READ-ONLY lock check: one select over the counters this request would reserve. Returns the seconds left in the window of the
 * first counter already at its limit inside its open window, or 0. It writes nothing, so a request that is already locked out costs
 * no write. The atomic reserve remains the authority for the race between this read and the reservation.
 */
export async function lockedSeconds(db: D1Database, buckets: readonly AttemptBucket[], now: number): Promise<number> {
    if (buckets.length === 0) return 0;
    const orm = drizzle(db, { schema });
    const rows = await orm.select({ key: schema.verifyExportAttempts.key, attempts: schema.verifyExportAttempts.attempts, endsAt: schema.verifyExportAttempts.windowEndsAt })
        .from(schema.verifyExportAttempts).where(inArray(schema.verifyExportAttempts.key, buckets.map((b) => b.key))).all();
    let wait = 0;
    for (const bucket of buckets) {
        const row = rows.find((r) => r.key === bucket.key);
        if (row && row.endsAt.getTime() > now && row.attempts >= bucket.limit) {
            wait = Math.max(wait, Math.max(1, Math.ceil((row.endsAt.getTime() - now) / 1000)));
        }
    }
    return wait;
}
