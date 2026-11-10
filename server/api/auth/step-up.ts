// Step-up re-authentication: POST /api/auth/step-up and POST /api/auth/step-up/email-code.
//
// The signed-in owner re-enters their password (and their TOTP code when the
// account has two-factor on) and receives a single-use, five-minute elevation
// for ONE named action. An owner with no usable password confirms with an emailed
// one-time code instead. See server/lib/auth/step-up.ts for the guarantees and
// for `requireStepUp`, the guard a sensitive route puts in front of itself.
import { createRoute } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { users } from '../../lib/db/schema';
import { AppError, Errors } from '../../lib/errors';
import { checkRateLimit } from '../../lib/rate-limit';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { logger } from '../../lib/logger';
import { auditFromContext } from '../../lib/audit';
import type { HonoConfig } from '../../types/hono';
import {
    hasNoUsablePassword, issueStepUpToken, setStepUpCookie, StepUpCredentialError, STEP_UP_ACTION_LABELS, verifyStepUpCredentials,
    type StepUpAction,
} from '../../lib/auth/step-up';
import {
    discardEmailCode, EMAIL_CODE_TTL_SECONDS, issueEmailCode, releaseEmailCodeSend, reserveEmailCodeSend, verifyEmailCode,
} from '../../lib/auth/step-up-email-code';
import {
    StepUpEmailCodeRequestSchema, StepUpEmailCodeResponseSchema, StepUpRequestSchema, StepUpResponseSchema,
} from '../../lib/validations/step-up.schema';

const stepUpRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/step-up',
    operationId: 'stepUpReauthenticate',
    summary: 'Re-enter credentials to authorise one sensitive action',
    description: 'Verifies the signed-in user\'s password again, and their TOTP or recovery code when two-factor authentication is on. On success, sets an HttpOnly cookie holding a token that is valid for the named action only, for the same user only, once, for five minutes. The token is never returned in the response body. An owner with no password (federated sign-up only) sends the code emailed by POST /api/auth/step-up/email-code as emailCode instead of a password. That is a weaker factor than a password (it proves control of the mailbox), accepted by explicit decision, and it is refused for any account that has a password. An upstream identity provider own two-factor is not re-challenged here; the engine asks for TOTP only when the account has it on in this engine.',
    tags: ['auth'],
    // Owner only: every action in STEP_UP_ACTIONS is an owner action. Widen this together with the action that needs it.
    middleware: [requireRole('owner')],
    request: { body: { content: { 'application/json': { schema: StepUpRequestSchema.describe('The action to elevate for plus the credentials re-entered.') } } } },
    responses: {
        200: { content: { 'application/json': { schema: StepUpResponseSchema } }, description: 'Elevation granted; the token is in the Set-Cookie header' },
        400: { description: 'Invalid input' },
        401: { description: 'Not signed in, or the credentials are wrong' },
        403: { description: 'Only an owner can step up' },
        429: { description: 'Too many attempts' },
    },
}, { scopes: [], tier: 'excluded' }));

const emailCodeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/step-up/email-code',
    operationId: 'sendStepUpEmailCode',
    summary: 'Email a one-time code to confirm one sensitive action',
    description: 'For an owner whose account has no usable password (created through a federated sign-in only). Emails a six-digit code, valid for ten minutes, to the address on the owner\'s own account; no address is read from the request. At most three codes per ten minutes, five wrong tries per code, one live code per action. Refused for an account that has a password. The code is a weaker factor than a password (it proves control of the mailbox), accepted by explicit decision.',
    tags: ['auth'],
    middleware: [requireRole('owner')],
    request: { body: { content: { 'application/json': { schema: StepUpEmailCodeRequestSchema.describe('The action the code is for.') } } } },
    responses: {
        200: { content: { 'application/json': { schema: StepUpEmailCodeResponseSchema } }, description: 'Code emailed' },
        400: { description: 'Invalid input' },
        401: { description: 'Not signed in' },
        403: { description: 'Only an owner can step up' },
        409: { description: 'The account has a password; use it (details.reason STEP_UP_EMAIL_CODE_NOT_AVAILABLE)' },
        429: { description: 'Too many codes requested' },
        503: { description: 'The code could not be sent' },
    },
}, { scopes: [], tier: 'excluded' }));

/**
 * The shared front half of both handlers: the session, the rate limits (per address and per account), and the account row.
 * Tenant and liveness come from the verified session, never the body. The role comes from the row, because the JWT claim
 * is good for 24 hours and a demoted owner must not keep elevating. Refusals here are audited with an enumerated reason.
 */
async function loadOwner(c: Context<HonoConfig>, action: StepUpAction, limiterPrefix: string) {
    const session = c.get('user');
    const tenantId = c.get('tenantId');
    if (!session?.sub || !tenantId) throw Errors.Unauthorized();
    try {
        // Per address and per account: the address limit slows a guesser, the account limit holds when guesses are spread across addresses.
        // Both ride the RATE_LIMITER binding: with none bound, or DISABLE_RATE_LIMIT=1, there is no limit here (as for /2fa/disable).
        await checkRateLimit(c, limiterPrefix);
        await checkRateLimit(c, `${limiterPrefix}-user`, session.sub);
    } catch (e) {
        if (e instanceof AppError && e.status === 429) auditFromContext(c, 'auth.step_up_denied', 'user', { entityId: session.sub, metadata: { action, reason: 'rate_limited' } });
        throw e;
    }
    const db = getDrizzle(c);
    const me = await db.select().from(users)
        .where(and(eq(users.id, session.sub), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
        .get();
    if (!me) throw Errors.Unauthorized();
    if (me.role !== 'owner') {
        auditFromContext(c, 'auth.step_up_denied', 'user', { entityId: me.id, metadata: { action, reason: 'not_owner' } });
        throw Errors.Forbidden('Only an owner can step up');
    }
    return { me, tenantId, db };
}

const app = createApiRouter();
app.openapi(stepUpRoute, async (c) => {
    const { action, password, emailCode, code } = c.req.valid('json');
    const { me, tenantId, db } = await loadOwner(c, action, 'step-up');
    const binding = { userId: me.id, tenantId, action };

    let method;
    try {
        method = await verifyStepUpCredentials({
            user: me,
            password,
            emailCode,
            checkEmailCode: (presented) => verifyEmailCode(c.env.TENANT_CACHE, binding, presented),
            code,
            totp: c.var.services.totp,
            // Compare and set on the list that was read: a concurrent spend changes it, this write then matches no row, and the attempt fails.
            spendRecoveryCode: async (previousList, remaining) => {
                const updated = await db.update(users).set({ totpRecoveryCodes: JSON.stringify(remaining) })
                    .where(and(eq(users.id, me.id), eq(users.totpRecoveryCodes, previousList)))
                    .returning({ id: users.id });
                return updated.length === 1;
            },
        });
    } catch (e) {
        if (e instanceof StepUpCredentialError) auditFromContext(c, 'auth.step_up_denied', 'user', { entityId: me.id, metadata: { action, reason: e.reason } });
        throw e;
    }

    const { token, expiresAt } = await issueStepUpToken(c.env.TENANT_CACHE, binding);
    setStepUpCookie(c, token);
    auditFromContext(c, 'auth.step_up_granted', 'user', { entityId: me.id, metadata: { action, method } });
    return c.json({ success: true, data: { action, expiresAt: expiresAt.toISOString() } }, 200);
});
app.openapi(emailCodeRoute, async (c) => {
    const { action } = c.req.valid('json');
    const { me, tenantId } = await loadOwner(c, action, 'step-up-code');
    // Only an account with no password may use the emailed code; for any other it would be a way around the password.
    if (!hasNoUsablePassword(me.passwordHash)) {
        throw Errors.Conflict('An emailed code is not available for this account. Use your password.', { reason: 'STEP_UP_EMAIL_CODE_NOT_AVAILABLE' });
    }
    const binding = { userId: me.id, tenantId, action };
    await reserveEmailCodeSend(c.env.TENANT_CACHE, me.id);
    const code = await issueEmailCode(c.env.TENANT_CACHE, binding);
    const notSent = () => Errors.ServiceUnavailable('The confirmation code could not be sent. Please try again later.');
    let delivered: boolean;
    try {
        // The recipient is the address on the account row; nothing in the request names one.
        // The company's own mail service, resolved from the verified session's tenant.
        const email = await c.var.services.emailFor(tenantId);
        delivered = (await email.sendStepUpCode(me.email, code, STEP_UP_ACTION_LABELS[action])).delivered;
    } catch (e) {
        await discardEmailCode(c.env.TENANT_CACHE, binding);
        // Neither the address nor the code is logged. A send that reached the provider and failed stays counted.
        logger.warn('[step-up] confirmation code delivery failed', { error: e instanceof Error ? e.name : 'unknown' });
        throw notSent();
    }
    if (!delivered) {
        // The mail service skipped the message (no provider key, suppressed address): nothing was sent, so the code is
        // discarded, no code_sent is recorded and the allowance is given back. The answer is the same as a failed send.
        await discardEmailCode(c.env.TENANT_CACHE, binding);
        await releaseEmailCodeSend(c.env.TENANT_CACHE, me.id);
        throw notSent();
    }
    auditFromContext(c, 'auth.step_up_code_sent', 'user', { entityId: me.id, metadata: { action } });
    return c.json({ success: true, data: { action, expiresInSeconds: EMAIL_CODE_TTL_SECONDS } }, 200);
});

/** Registration order. Drives the typed client; a test pins it to what `app` really registered. */
export const stepUpRouteConfigs = [stepUpRoute, emailCodeRoute] as const;

export default app;
