/**
 * The emailed one-time code that stands in for a password during step-up, for an
 * owner whose account has no usable password (it was created through a federated
 * sign-in only).
 *
 * This is a WEAKER factor than a password: it proves control of the account's
 * mailbox, nothing more. Accepting it is an explicit product decision, and it is
 * offered only to an account that truly has no password, so it can never be used
 * to get around one.
 *
 * State, all in KV (TENANT_CACHE), best effort under KV's lack of atomic updates:
 *   - `stepup-code:<userId>:<action>`  {hash, attempts, expiresAt}; ten minute TTL.
 *     `hash` is sha256(code|userId|tenantId|action); the code itself is never
 *     stored. One live code per user and action: a new one overwrites the old.
 *   - `stepup-code-sent:<userId>`      {count, windowEnds}; at most three sends
 *     per ten minutes per user. This counter works with no RATE_LIMITER binding,
 *     unlike the per-address limiter the route also applies.
 * The attempt counter and the send counter are read-modify-write, so concurrent
 * guesses or sends can slip past the five-attempt and three-send caps: they are
 * best effort under KV. A hosted production deployment is held by its RATE_LIMITER
 * binding. A self-hosted one with no bound limiter, or with DISABLE_RATE_LIMIT=1,
 * has weaker protection against brute-forcing the code and should bind the limiter
 * (docs/operate/deploy.md).
 *
 * The stored digest is a plain SHA-256 of the code with its scope, not a keyed one.
 * Anyone who can read this KV namespace is already trusted with the whole
 * deployment, and a six-digit code expires in ten minutes, so a server-side key
 * would add nothing against that reader.
 */
import { Errors } from '../errors';
import { sha256Hex } from '../sha256';
import { timingSafeEqual } from '../password';
import type { StepUpBinding } from './step-up';

export const EMAIL_CODE_TTL_SECONDS = 600;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_SENDS_PER_WINDOW = 3;
const EMAIL_CODE_KV_PREFIX = 'stepup-code:';
const EMAIL_CODE_SENT_KV_PREFIX = 'stepup-code-sent:';

interface CodeRecord { hash: string; attempts: number; expiresAt: number }
interface SentRecord { count: number; windowEnds: number }

export type EmailCodeResult = 'ok' | 'bad' | 'expired';

function codeKey(b: Pick<StepUpBinding, 'userId' | 'action'>): string {
    return `${EMAIL_CODE_KV_PREFIX}${b.userId}:${b.action}`;
}

/** Six digits from the platform CSPRNG, without modulo bias. */
function generateEmailCode(): string {
    const limit = 4_294_000_000; // the largest multiple of 1,000,000 that fits in 32 bits
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0]! >= limit);
    return String(buf[0]! % 1_000_000).padStart(6, '0');
}

function digest(code: string, b: StepUpBinding): Promise<string> {
    return sha256Hex(`${code}|${b.userId}|${b.tenantId}|${b.action}`);
}

/** Count a send against the user's window; throws RateLimited when the window is full. */
export async function reserveEmailCodeSend(kv: KVNamespace, userId: string): Promise<void> {
    const key = `${EMAIL_CODE_SENT_KV_PREFIX}${userId}`;
    const now = Date.now();
    const raw = await kv.get(key);
    let rec: SentRecord = { count: 0, windowEnds: now + EMAIL_CODE_TTL_SECONDS * 1000 };
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Partial<SentRecord>;
            if (typeof parsed.count === 'number' && typeof parsed.windowEnds === 'number' && parsed.windowEnds > now) rec = { count: parsed.count, windowEnds: parsed.windowEnds };
        } catch { /* a corrupt counter starts a fresh window */ }
    }
    if (rec.count >= EMAIL_CODE_SENDS_PER_WINDOW) throw Errors.RateLimited('Too many codes requested. Please try again later.');
    rec.count += 1;
    await kv.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, Math.ceil((rec.windowEnds - now) / 1000)) });
}

/** Give back a send that never reached the provider (the mail service skipped it), so it does not use the allowance. */
export async function releaseEmailCodeSend(kv: KVNamespace, userId: string): Promise<void> {
    const key = `${EMAIL_CODE_SENT_KV_PREFIX}${userId}`;
    const raw = await kv.get(key);
    if (!raw) return;
    try {
        const rec = JSON.parse(raw) as Partial<SentRecord>;
        if (typeof rec.count !== 'number' || typeof rec.windowEnds !== 'number' || rec.windowEnds <= Date.now()) return;
        if (rec.count <= 1) { await kv.delete(key); return; }
        await kv.put(key, JSON.stringify({ count: rec.count - 1, windowEnds: rec.windowEnds }), { expirationTtl: Math.max(60, Math.ceil((rec.windowEnds - Date.now()) / 1000)) });
    } catch { /* a damaged counter is left alone */ }
}

/** Mint a code, store its hash (replacing any live code for this user and action), and return the plaintext once. */
export async function issueEmailCode(kv: KVNamespace, binding: StepUpBinding): Promise<string> {
    const code = generateEmailCode();
    const record: CodeRecord = { hash: await digest(code, binding), attempts: 0, expiresAt: Date.now() + EMAIL_CODE_TTL_SECONDS * 1000 };
    await kv.put(codeKey(binding), JSON.stringify(record), { expirationTtl: EMAIL_CODE_TTL_SECONDS });
    return code;
}

/** Drop the live code (a failed send must not leave one behind). */
export async function discardEmailCode(kv: KVNamespace, binding: Pick<StepUpBinding, 'userId' | 'action'>): Promise<void> {
    await kv.delete(codeKey(binding));
}

/**
 * Check a presented code. 'ok' spends it. 'bad' counts an attempt and voids the
 * code at the fifth. 'expired' covers no code, a lapsed one and a voided one:
 * the caller turns all three into the same answer.
 */
export async function verifyEmailCode(kv: KVNamespace, binding: StepUpBinding, presented: string): Promise<EmailCodeResult> {
    const key = codeKey(binding);
    const raw = await kv.get(key);
    if (!raw) return 'expired';
    let rec: CodeRecord;
    try { rec = JSON.parse(raw) as CodeRecord; } catch { await kv.delete(key); return 'expired'; }
    const now = Date.now();
    if (typeof rec.expiresAt !== 'number' || rec.expiresAt <= now || typeof rec.hash !== 'string') { await kv.delete(key); return 'expired'; }
    if (timingSafeEqual(await digest(presented, binding), rec.hash)) {
        await kv.delete(key);
        return 'ok';
    }
    rec.attempts += 1;
    if (rec.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
        await kv.delete(key);
    } else {
        await kv.put(key, JSON.stringify(rec), { expirationTtl: Math.max(60, Math.ceil((rec.expiresAt - now) / 1000)) });
    }
    return 'bad';
}
