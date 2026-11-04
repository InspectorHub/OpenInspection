/**
 * The signed audit export of one envelope, released after a knowledge check.
 *
 *   POST /api/public/verify/:envelopeId/export   body { email, postalCode?, turnstileToken? }
 *   GET  /api/public/verify/:envelopeId/audit-trail   answers 403 verification_required (the export moved to the POST above)
 *
 * The online verification result (chain validity, key fingerprint, signer names and status, the public key, the document redirect) stays
 * public. The export carries the signed events whole, so an offline verifier can recompute each hash; their payloads record signer ids and
 * the emails given at signing. It is therefore released only to a caller who supplies an email recorded on the envelope (see
 * server/lib/verify-export-check.ts), after the bot challenge where the deployment enforces one. The postal code of the inspected property
 * is a second factor and never a first: it is accepted only together with an email, and when one is supplied it has to match as well.
 * A request without an email answers 400 email_required, whatever else it carries, and counts for nothing.
 *
 * Every failure answers the same 403 body whatever was wrong, with the same headers, and nothing the caller supplied is echoed. The
 * success response is the export as it always was, with one header added: Cache-Control: no-store, because the body is released to one
 * caller and must not be kept by a shared cache.
 *
 * Attempts are limited by counters in the database (server/lib/verify-export-attempts.ts; the limits are the exported ATTEMPT_LIMITS, the one
 * place the numbers are written, and docs/integrations/turnstile.md is checked against them), reserved before the comparison so parallel
 * requests cannot exceed a cap. The strict limits are per (envelope, address), where an IPv6 address counts as its /64 and the stored
 * key is a keyed hash, never the address; a third party who fails repeatedly locks only their own network out. Two envelope-wide
 * ceilings bound guessing from many addresses: one for attempts of either kind, one for postal codes. Residual risk: a caller who
 * changes network is stopped only by those ceilings, and while one holds the signer's own answers are refused too until its window
 * ends; a postal code is a weaker factor than a signer's email, so it has the smaller allowances. With no CF-Connecting-IP the
 * per-address counters are skipped and only the envelope-wide ones apply. Residual: after the envelope-wide ceiling of counted attempts,
 * every network is refused until its window ends, the signer's included.
 *
 * Write cost, because D1 on the Workers Free plan allows 100,000 row writes a day for the whole account. Refusals are write-free: the
 * order is body (400), id format, the binding limiter (per network; a no-op when the binding is absent), one read
 * for the envelope (unknown id: the usual 403), the bot token (absent where the challenge is enforced: 403), one read-only lock check
 * (429 with Retry-After), the token verification (403), and only then the reservation. A request writes one row per counter it
 * reserves, and a right answer hands each back (a second write): the table of writes per request class is in
 * docs/integrations/turnstile.md and is pinned by tests/unit/agreements/verify-export-counters.spec.ts. Counters exist only for real
 * envelopes, and each real envelope is capped by its own envelope-wide counter, which bounds what a caller who knows no answer can
 * write per envelope. What bounds the NUMBER of envelopes written to depends on the bot challenge: with a real TURNSTILE_SECRET_KEY,
 * writes are bounded by challenges solved; on saas without the key the always-pass test secret is used (logged as
 * verify.export.turnstile.test_key), so the challenge bounds nothing and the bound is the binding limiter; standalone without a key
 * has no challenge and the same limiter bound. Configure the key. A token the verification service rejects is the usual 403; only a
 * failure to reach the service answers 503 verification_unavailable. A store failure, including a missing table (run db:migrate),
 * refuses with the usual 403 and logs.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { loadVerifyData } from '../../lib/verify-data';
import { checkRateLimit } from '../../lib/rate-limit';
import { logger } from '../../lib/logger';
import { resolveTurnstile, turnstileKeysMismatched, verifyTurnstileOutcome, TURNSTILE_TEST_KEY_WARNING } from '../../lib/middleware/bot-protection';
import { VerifyExportBodySchema } from '../../lib/validations/verify-export.schema';
import { postalOrNull } from '../../lib/validations/postal-code';
import { candidatesFor, envelopeExists, matchesAny, normalizeEmail, normalizePostalCode } from '../../lib/verify-export-check';
import {
    addressDigest, emailBucket, envelopeBucket, envelopePostalBucket, lockedSeconds, normalizeAddress, postalBucket, reserveAttempts,
    type AttemptBucket, type Reservation,
} from '../../lib/verify-export-attempts';

const refuse = (c: Context<HonoConfig>) => c.json({ error: 'verification_failed' }, 403);

/** Envelope ids are UUIDs; anything else cannot name an envelope, and is refused before any lookup. */
const ENVELOPE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function tooManyAttempts(c: Context<HonoConfig>, seconds: number) {
    c.header('Retry-After', String(Math.max(1, seconds)));
    return c.json({ error: 'too_many_attempts' }, 429);
}

export const verifyExportRoutes = new Hono<HonoConfig>()
    .get('/verify/:envelopeId/audit-trail', (c) => c.json({ error: 'verification_required' }, 403))
    .post('/verify/:envelopeId/export', async (c) => {
        const envelopeId = c.req.param('envelopeId');
        // Each field is read on its own: one that is malformed counts as not supplied (and is never echoed), so a wrong-shaped email
        // beside a right postal code does not turn the whole request into a refusal.
        const rawBody: unknown = await c.req.json().catch(() => null);
        const fields = typeof rawBody === 'object' && rawBody !== null && !Array.isArray(rawBody) ? rawBody as Record<string, unknown> : {};
        const readField = <K extends keyof typeof VerifyExportBodySchema.shape>(key: K): string | undefined => {
            const result = VerifyExportBodySchema.shape[key].safeParse(fields[key]);
            return result.success ? (result.data as string | undefined) : undefined;
        };
        const email = (readField('email') ?? '').trim();
        // A value with nothing left once spaces and hyphens are gone is not a value: it must never be compared (a stored '-' would match it).
        // A supplied value that is a placeholder (fewer than two letters or digits) is not a value either.
        const postalSupplied = postalOrNull((readField('postalCode') ?? '').trim()) ?? '';
        const postalCode = normalizePostalCode(postalSupplied) === '' ? '' : postalSupplied;
        if (!email) return c.json({ error: 'email_required' }, 400);
        if (!ENVELOPE_ID.test(envelopeId)) return refuse(c);

        // Cheap gates first, none of which writes. The binding limiter is keyed by the network the counters use (an IPv6 address counts
        // as its /64), so rotating the low bits of an address buys nothing. Without an address there is no network to key on, and a
        // shared 'unknown' key would pool every such caller into one budget, so it is skipped. There is no per-envelope binding limiter:
        // it would share the per-network limiter's budget and never trip first, and the envelope-wide counters are the per-envelope bound.
        const rawAddress = c.req.header('CF-Connecting-IP');
        try {
            if (rawAddress) {
                const network = normalizeAddress(rawAddress);
                await checkRateLimit(c, 'verify-export', network);
            }
        } catch {
            return tooManyAttempts(c, 60);
        }

        // An unknown envelope reserves nothing and writes nothing: counter rows exist only for real envelopes.
        let exists: boolean;
        try {
            exists = await envelopeExists(c.env.DB, envelopeId);
        } catch (err) {
            logger.error('verify.export.lookup.failed', {}, err instanceof Error ? err : undefined);
            return refuse(c);
        }
        if (!exists) return refuse(c);

        // Where the deployment enforces the bot challenge, a request without a token is refused here, before anything is counted.
        const turnstile = resolveTurnstile(c.env);
        const token = readField('turnstileToken');
        if (turnstile.enforced && !token) return refuse(c);
        if (turnstile.usingTestKey) logger.warn('verify.export.turnstile.test_key', { detail: TURNSTILE_TEST_KEY_WARNING });
        if (turnstileKeysMismatched(c.env)) {
            logger.warn('verify.export.turnstile.key_pair', { detail: 'TURNSTILE_SECRET_KEY is a real key but TURNSTILE_SITE_KEY is still the test site key; every challenge will fail.' });
        }

        // Without an address only the envelope-wide counters apply.
        const buckets: AttemptBucket[] = [];
        const postalBuckets: AttemptBucket[] = [];
        try {
            const who = rawAddress ? await addressDigest(rawAddress, c.env.JWT_SECRET) : null;
            if (who && email) buckets.push(emailBucket(envelopeId, who));
            if (who && postalCode) postalBuckets.push(postalBucket(envelopeId, who));
            if (postalCode) postalBuckets.push(envelopePostalBucket(envelopeId));
            buckets.push(envelopeBucket(envelopeId));
            // Read-only: a request that is already locked out answers 429 without a single write. Only the email-side counters are read
            // here. The postal counters are consulted after the email matched a signer (below), so a spent postal allowance changes
            // nothing for a request with a wrong email: anyone who knows one signer email could otherwise exhaust it and turn every
            // request that carries a postal code into a 429, whatever email it carries.
            const wait = await lockedSeconds(c.env.DB, buckets, Date.now());
            if (wait > 0) return tooManyAttempts(c, wait);
        } catch (err) {
            logger.error('verify.export.attempts.unavailable', { hint: 'the attempt counters could not be read or written; run db:migrate if verify_export_attempts is missing' }, err instanceof Error ? err : undefined);
            return refuse(c);
        }

        // The challenge is verified before anything is reserved, so a failed challenge is refused like any other failure with no
        // write and nothing to hand back: anyone without an answer cannot use up the allowance of the people who have one.
        if (turnstile.enforced) {
            // A token the service rejects is the uniform 403. Only a failure to reach the service (timeout, network error, 429 or 5xx
            // from it) is told apart, so a visitor is not told their answer was wrong when it was never checked.
            let outcome: 'yes' | 'no' | 'error' = 'error';
            try {
                outcome = token ? await verifyTurnstileOutcome(token, turnstile.secret, undefined, { ...(rawAddress ? { remoteIp: rawAddress } : {}), timeoutMs: 3000 }) : 'no';
            } catch (err) {
                logger.warn('verify.export.turnstile.failed', { error: err instanceof Error ? err.message : String(err) });
            }
            if (outcome === 'error') return c.json({ error: 'verification_unavailable' }, 503);
            if (outcome !== 'yes') return refuse(c);
        }

        // Reserve the attempt before comparing, strictest counter first. The atomic upsert is what holds the cap when requests race
        // past the read above. Only the email-side counters are reserved here: the postal counters (which include one for the whole
        // envelope) are reserved below, and only for a request whose email matched a signer. Otherwise anyone could send a junk email
        // with a postal code and use up the postal allowance the people who know a real email depend on.
        let reservation: Reservation;
        try {
            reservation = await reserveAttempts(c.env.DB, buckets, Date.now());
        } catch (err) {
            logger.error('verify.export.attempts.unavailable', { hint: 'the attempt counters could not be read or written; run db:migrate if verify_export_attempts is missing' }, err instanceof Error ? err : undefined);
            return refuse(c);
        }
        if (reservation.waitSeconds > 0) return tooManyAttempts(c, reservation.waitSeconds);

        let data: Awaited<ReturnType<typeof loadVerifyData>>;
        let postalReservation: Reservation | null = null;
        try {
            const known = await candidatesFor(c.env.DB, envelopeId);
            // Both comparisons always run, over every candidate.
            const emailOk = matchesAny(normalizeEmail(email), known.emails);
            // The email is the factor; a postal code, when supplied, is an added condition and never a way in on its own.
            const postalOk = postalCode ? matchesAny(normalizePostalCode(postalCode), known.postalCodes) : true;
            if (emailOk && postalCode) {
                // The email matched, so this is an attempt at the second factor and counts against its allowance. Once that allowance is
                // spent the answer is the same uniform refusal as every other one (same status and body, no wait): a distinct answer here
                // would tell someone who spent the allowance with one known email which other guesses are signers. Nothing more is
                // reserved on the postal path; the email alone still works, and a successful request hands its reservations back.
                // Accepted residual: this path costs one extra counter write that a wrong email does not, a small timing difference. It
                // is bounded by the per-address and per-envelope email counters reserved above, and the comparison itself ran over every
                // candidate either way.
                // The email-side reservation is kept, as for any wrong answer: handing it back would make a guess that hits a signer cheaper
                // than one that misses, which the email counters would then reveal.
                if (await lockedSeconds(c.env.DB, postalBuckets, Date.now()) > 0) return refuse(c);
                postalReservation = await reserveAttempts(c.env.DB, postalBuckets, Date.now());
                if (postalReservation.waitSeconds > 0) return refuse(c);
            }
            data = emailOk && postalOk ? await loadVerifyData(c, envelopeId) : null;
        } catch (err) {
            // A store failure after the reservation: hand it back (the caller was not at fault), log without values, refuse uniformly.
            await reservation.release();
            await postalReservation?.release();
            logger.error('verify.export.read.failed', {}, err instanceof Error ? err : undefined);
            return refuse(c);
        }
        // A wrong answer keeps its reservation. A right one hands it back, so a success does not use up the allowance.
        if (!data) return refuse(c);
        await reservation.release();
        await postalReservation?.release();

        const payload = {
            envelopeId,
            algorithm: 'Ed25519',
            // Every key the chain used, so an export that spans a rotation can be checked offline; one key reads as it always did.
            publicKeyPem: data.chainKeys.length > 0 ? data.pubKeyPem : (data.pubKey?.pem ?? null),
            keyFingerprint: data.pubKey?.fingerprint ?? null,
            keys: (data.chainKeys.length > 0 ? data.chainKeys : data.pubKey ? [data.pubKey] : []).map((k) => ({ fingerprint: k.fingerprint, pem: k.pem })),
            events: data.auditRows.map((r) => ({
                id: r.id, event: r.event, createdAt: r.createdAt,
                payloadJson: r.payloadJson, prevHash: r.prevHash,
                hash: r.hash, signature: r.signature, keyFingerprint: r.keyFingerprint,
            })),
            chainValid: data.verify.valid,
            exportedAt: new Date().toISOString(),
        };
        c.header('Content-Type', 'application/json');
        c.header('Content-Disposition', `attachment; filename="audit-${envelopeId.slice(0, 8)}.json"`);
        c.header('Cache-Control', 'no-store');
        return c.body(JSON.stringify(payload, null, 2)); // projection-allow: the signed events of one envelope, whole so an offline verifier can recompute each hash (their payloads record signer ids and the emails given at signing); returned only after the knowledge check
    });
