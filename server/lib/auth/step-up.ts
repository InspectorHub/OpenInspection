/**
 * Step-up re-authentication.
 *
 * A signed-in session is not enough for a few actions (bulk export, restoring a
 * backup): the person at the keyboard must prove, again, that they are the
 * account holder. This module is that proof, and nothing more general.
 *
 * What it is NOT: a "sudo mode". There is no elevated session and no flag on the
 * session JWT. Each elevation is ONE token for ONE action:
 *
 *   - action-scoped    -- minted for a named action; any other action refuses it
 *   - user-bound       -- only the account that re-entered its credentials can use it
 *   - tenant-bound     -- the tenant comes from the verified session, never the client
 *   - single-use       -- consuming it deletes it, including when the check then fails
 *   - short-lived      -- five minutes, enforced by the KV TTL and again by the stored expiry
 *   - never in a body  -- delivered in a `__Host-` HttpOnly cookie; the JSON reply carries no secret
 *
 * State is one KV entry per token (TENANT_CACHE, the same single-use pattern as
 * the agent sign-in code): the key is the SHA-256 of the token, so reading the
 * namespace never yields a usable token.
 *
 * "Single use" is best effort, NOT a strong guarantee. KV has no compare-and-delete
 * and is eventually consistent: two concurrent redemptions can both read the entry
 * before either delete lands, and after a delete a replay can still be served a
 * stale copy at another location until it propagates (up to about 60 seconds). A
 * protected action must therefore be idempotent or scoped to a job of its own, and
 * must not rely on this module alone to stop a double submit.
 *
 * Further properties:
 *   - a newer elevation for the same user and action supersedes the older one
 *     (a `stepup-latest:` pointer is compared at redemption)
 *   - a token issued before the user's last credential change (the
 *     `pwchanged:{userId}` marker the session check also reads) is refused
 *   - the TOTP code is accepted inside the same window the login accepts (one step
 *     either side), so a code can be reused within that window; only recovery
 *     codes are single-use
 *   - an owner with no usable password (a federated sign-up leaves a placeholder
 *     hash, and an erased credential is a sentinel) confirms with a one-time code
 *     emailed to the address on their user row instead (step-up-email-code.ts).
 *     That is a WEAKER factor than a password: it proves control of a mailbox.
 *     Accepting it is an explicit product decision. It is never offered to an
 *     account that has a password, and the two-factor of an upstream identity provider
 *     is not re-challenged here: the engine asks for TOTP only when the account
 *     has it switched on in this engine, and still asks after the emailed code.
 *     (A failed authenticator code spends the emailed code too: the person asks
 *     for a new one. Accepted, to keep the code single-use.)
 *   - rate limiting rides the RATE_LIMITER binding; with no binding, or with
 *     DISABLE_RATE_LIMIT=1, the issuing route has no brute-force limit (the same as
 *     /2fa/disable). The emailed code's five-attempt and three-send caps are
 *     best effort under KV (see step-up-email-code.ts); a self-hosted deployment
 *     should bind the limiter (docs/operate/deploy.md)
 *   - CSRF defence is SameSite=Strict on the session and elevation cookies, as for
 *     /2fa/disable; the issuing route carries no CSRF-token middleware
 */
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { AppError, ErrorCode, Errors } from '../errors';
import type { HonoConfig } from '../../types/hono';
import { hashToken, mintToken } from '../token-hash';
import { verifyPassword } from '../password';
import { ERASED_SENTINEL } from '../compliance/anonymize-pii';
import type { TotpService } from '../../services/totp.service';

/** Every action that may demand a step-up. Adding an action is a code change on purpose. */
export const STEP_UP_ACTIONS = [
    'data-export-start',
    'data-export-download',
    'data-import-apply',
    'data-import-revert',
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const STEP_UP_TTL_SECONDS = 300;
export const STEP_UP_COOKIE_NAME = '__Host-step_up';
export const STEP_UP_KV_PREFIX = 'stepup:';
const STEP_UP_LATEST_KV_PREFIX = 'stepup-latest:';

interface StepUpRecord {
    userId: string;
    tenantId: string;
    action: StepUpAction;
    /** Epoch ms the token was minted; compared with the credential-change marker. */
    issuedAt: number;
    /** Epoch ms. The KV TTL is the first line, this is the second (KV expiry is approximate). */
    expiresAt: number;
}

export interface StepUpBinding {
    userId: string;
    tenantId: string;
    action: StepUpAction;
}

function kvKey(tokenHash: string): string {
    return `${STEP_UP_KV_PREFIX}${tokenHash}`;
}

function latestKey(b: Pick<StepUpBinding, 'userId' | 'action'>): string {
    return `${STEP_UP_LATEST_KV_PREFIX}${b.userId}:${b.action}`;
}

/** Store a fresh single-use elevation and return its token (hand it to the caller once, in a cookie). */
export async function issueStepUpToken(kv: KVNamespace, binding: StepUpBinding): Promise<{ token: string; expiresAt: Date }> {
    const token = mintToken();
    const expiresAt = new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000);
    const record: StepUpRecord = { ...binding, issuedAt: Date.now(), expiresAt: expiresAt.getTime() };
    const tokenHash = await hashToken(token);
    await kv.put(kvKey(tokenHash), JSON.stringify(record), { expirationTtl: STEP_UP_TTL_SECONDS });
    // The newest elevation for this user and action wins; redemption compares against this pointer.
    await kv.put(latestKey(binding), tokenHash, { expirationTtl: STEP_UP_TTL_SECONDS });
    return { token, expiresAt };
}

/**
 * Redeem a token for exactly the binding it was issued for. Resolves on success;
 * throws Forbidden for every failure with ONE message, so a caller cannot tell a
 * forged token from an expired, spent or mis-scoped one. The entry is deleted
 * before it is judged: a token presented for the wrong action or by the wrong
 * user is burned, not merely refused.
 */
async function consumeStepUpToken(kv: KVNamespace, token: string | undefined, expected: StepUpBinding): Promise<void> {
    const refuse = () => Errors.Forbidden('Re-enter your password to continue.', { stepUpRequired: true, action: expected.action });
    if (!token) throw refuse();
    const tokenHash = await hashToken(token);
    const key = kvKey(tokenHash);
    const raw = await kv.get(key);
    await kv.delete(key);
    if (!raw) throw refuse();
    let record: Partial<StepUpRecord>;
    try {
        record = JSON.parse(raw) as Partial<StepUpRecord>;
    } catch {
        throw refuse();
    }
    const ok = record.userId === expected.userId
        && record.tenantId === expected.tenantId
        && record.action === expected.action
        && typeof record.expiresAt === 'number'
        && record.expiresAt > Date.now();
    if (!ok) throw refuse();
    // Superseded: a newer elevation for the same user and action exists (or the pointer is gone: fail closed).
    if (await kv.get(latestKey(expected)) !== tokenHash) throw refuse();
    // Credential change after issue (same marker and unit, seconds, as the session check).
    const changed = await kv.get(`pwchanged:${expected.userId}`);
    if (changed) {
        const changedAt = parseInt(changed, 10);
        if (!Number.isFinite(changedAt) || Math.floor((record.issuedAt ?? 0) / 1000) <= changedAt) throw refuse();
    }
}

/** Cookie attributes for the step-up token: the session cookie's four, with the elevation's own lifetime. */
function stepUpCookieOptions() {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict' as const,
        path: '/',
        maxAge: STEP_UP_TTL_SECONDS,
    };
}

export function setStepUpCookie(c: Context<HonoConfig>, token: string): void {
    setCookie(c, STEP_UP_COOKIE_NAME, token, stepUpCookieOptions());
}

/**
 * Route guard for a sensitive action:
 *
 *   app.post('/exports', requireStepUp('data-export-start'), handler)
 *
 * The guard does NOT check the caller's role. Every route that uses it must carry
 * its own `requireRole(...)`; the elevation proves a recent password, not authority.
 *
 * Needs the JWT middleware to have run (user + tenantId). Without a session it
 * answers 401 even when a valid token cookie is presented. The cookie is
 * cleared on the way out whether the check passes or not.
 */
export function requireStepUp(action: StepUpAction): MiddlewareHandler<HonoConfig> {
    return async (c, next) => {
        const user = c.get('user');
        const tenantId = c.get('tenantId');
        if (!user?.sub || !tenantId) throw Errors.Unauthorized();
        const token = getCookie(c, STEP_UP_COOKIE_NAME);
        deleteCookie(c, STEP_UP_COOKIE_NAME, { path: '/', secure: true });
        await consumeStepUpToken(c.env.TENANT_CACHE, token, { userId: user.sub, tenantId, action });
        await next();
    };
}

/** What the person is being asked to confirm, in words, for the emailed code. */
export const STEP_UP_ACTION_LABELS: Record<StepUpAction, string> = {
    'data-export-start': 'start a company data export',
    'data-export-download': 'download a company data export',
    'data-import-apply': 'apply a company data import',
    'data-import-revert': 'undo a company data import',
};

export type StepUpMethod = 'password' | 'email_code';
export type StepUpDeniedReason = 'bad_credentials' | 'bad_email_code' | 'code_expired';

/**
 * The one refusal for any wrong or missing credential: a plain 401 "Invalid
 * credentials" whose body never says which factor failed. `reason` is for the
 * audit row only and is not serialised.
 */
export class StepUpCredentialError extends AppError {
    constructor(readonly reason: StepUpDeniedReason) {
        super(401, ErrorCode.UNAUTHORIZED, 'Invalid credentials');
    }
}

/** A placeholder (`unset:<uuid>`) or erased (`[erased]`) credential: nothing a typed password could ever match. */
export function hasNoUsablePassword(stored: string): boolean {
    return stored.startsWith('unset:') || stored === ERASED_SENTINEL;
}

/** The stored recovery-code hashes, or null when the column is empty or damaged (a damaged list means no recovery code can match: fail closed). */
function parseRecoveryHashes(raw: string | null): string[] | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every((h): h is string => typeof h === 'string') ? parsed : null;
    } catch {
        return null;
    }
}

/** The user row fields the credential check needs. */
export interface StepUpUser {
    passwordHash: string;
    totpEnabled: boolean | null;
    totpSecret: string | null;
    totpRecoveryCodes: string | null;
}

/**
 * Check the re-entered credentials against the account, with the repo's own
 * verifiers: PBKDF2 `verifyPassword` (constant-time compare, runs on every call)
 * and, only when the account has two-factor on, the TOTP service. A matching
 * recovery code is spent: `spendRecoveryCode` must persist the remaining hashes as
 * a compare-and-set against the list that was read and return whether it applied;
 * `false` (a concurrent spend) is a failure.
 * Every failure is the same 401, so the reply does not say which factor was wrong.
 */
export async function verifyStepUpCredentials(params: {
    user: StepUpUser;
    password: string | undefined;
    /** The emailed code, when the caller sent one. Only consulted for an account with no usable password. */
    emailCode: string | undefined;
    checkEmailCode: (code: string) => Promise<'ok' | 'bad' | 'expired'>;
    code: string | undefined;
    totp: Pick<TotpService, 'verifyCode' | 'consumeRecoveryCode'>;
    spendRecoveryCode: (previousList: string, remainingHashes: string[]) => Promise<boolean>;
}): Promise<StepUpMethod> {
    const { user, password, emailCode, checkEmailCode, code, totp, spendRecoveryCode } = params;
    let method: StepUpMethod;
    if (hasNoUsablePassword(user.passwordHash)) {
        // No password exists, so none is compared (a placeholder can only fail). The emailed code is the
        // factor instead. The 401 is identical to a wrong password, so this does not say which applies.
        // Anything that is not exactly six digits (after trimming) is refused here, before it can count as an attempt.
        const presented = emailCode?.trim();
        if (!presented || !/^\d{6}$/.test(presented)) throw new StepUpCredentialError('bad_email_code');
        const result = await checkEmailCode(presented);
        if (result === 'bad') throw new StepUpCredentialError('bad_email_code');
        if (result === 'expired') throw new StepUpCredentialError('code_expired');
        method = 'email_code';
    } else {
        // `emailCode` is deliberately not read here: a mailbox must never stand in for an existing password.
        const [passwordOk] = await verifyPassword(password ?? '', user.passwordHash);
        if (!passwordOk) throw new StepUpCredentialError('bad_credentials');
        method = 'password';
    }
    if (!user.totpEnabled) return method;
    // Two-factor is on but its secret is gone: fail closed rather than waving the caller through.
    if (!user.totpSecret || !code) throw new StepUpCredentialError('bad_credentials');
    if (totp.verifyCode(user.totpSecret, code)) return method;
    const hashes = parseRecoveryHashes(user.totpRecoveryCodes);
    if (user.totpRecoveryCodes && hashes) {
        const result = await totp.consumeRecoveryCode(code, hashes);
        if (result.matched && await spendRecoveryCode(user.totpRecoveryCodes, result.remainingHashes)) return method;
    }
    throw new StepUpCredentialError('bad_credentials');
}
