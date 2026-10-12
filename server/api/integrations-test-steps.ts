import { createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { requireRole } from '../lib/middleware/rbac';
import { checkRateLimit } from '../lib/rate-limit';
import { getDrizzle, createDrizzle } from '../lib/route-helpers';
import { tenantConfigs } from '../lib/db/schema';
import { coerceEmailByoProvider, resolveEmailProvider } from '../lib/email/resolve-provider';
import { recordIntegrationTest, type IntegrationTarget } from '../lib/integration-test-results';
import { EmailTestStepBodySchema, StripeTestStepBodySchema, TestStepResultSchema } from '../lib/validations/integrations.schema';
import { runEmailStep, type StepResult } from '../lib/integration/email-test-steps';
import { runStripeStep } from '../lib/integration/stripe-test-steps';
import { clearLastSend, lookupResendDelivery, readLastSend, readSessionEmail, writeLastSend } from '../lib/integration/email-test-store';
import { readWebhookLog } from '../lib/stripe-webhook-log';

/**
 * Stepwise "Test connection": the caller runs ONE step per request and the server
 * re-derives whatever that step depends on. Mounted on its own base path (see
 * `server/index.ts`) for the same typed-client reason as the AI routes.
 *
 * The single-shot probes in `integrations.ts` stay as they are; these routes add
 * the checks that prove a real send / a real payment account, one at a time.
 */

const StepResponse = z.object({ success: z.literal(true), data: TestStepResultSchema });

const emailStepRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/email',
    tags: ['integrations'],
    summary: 'Run one step of the stepwise email connection test',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: EmailTestStepBodySchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: StepResponse.openapi('EmailTestStepResponse') } }, description: 'The step ran; `data.status` says how it went' },
        429: { description: 'Too many test steps for this workspace' },
    },
    operationId: 'runEmailTestStep',
    description: 'Runs one step against the stored email provider credentials. The test email goes to the signed-in user\'s own address only; the request carries no recipient. Non-Resend providers support only key_valid.',
}, { scopes: ['admin'], tier: 'extended' }));

const stripeStepRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/stripe',
    tags: ['integrations'],
    summary: 'Run one step of the stepwise Stripe connection test',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: StripeTestStepBodySchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: StepResponse.openapi('StripeTestStepResponse') } }, description: 'The step ran; `data.status` says how it went' },
        429: { description: 'Too many test steps for this workspace' },
    },
    operationId: 'runStripeTestStep',
    description: 'Read-only checks against the stored Stripe key: account reachable, charges/payouts enabled, and a verified webhook delivery seen. Creates nothing in the Stripe account.',
}, { scopes: ['admin'], tier: 'extended' }));

/** Persist a decided step (pass/fail only). Best effort: never changes the response. */
async function logStep(
    env: { DB: D1Database }, tenantId: string, userId: string | null,
    target: IntegrationTarget, provider: string | null, r: StepResult,
): Promise<void> {
    if (r.status !== 'pass' && r.status !== 'fail') return;
    await recordIntegrationTest(createDrizzle(env.DB), {
        tenantId, target, provider, ok: r.status === 'pass', detail: r.detail, testedByUserId: userId, step: r.step,
    }).catch(() => {});
}

const integrationsTestStepsRoutes = createApiRouter()
    .openapi(emailStepRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        if (!tenantId || !user?.sub) throw Errors.Unauthorized('Missing tenant scope');
        await checkRateLimit(c, 'integration-test-step', tenantId);
        const { step } = c.req.valid('json');
        const db = getDrizzle(c);
        const cfg = await db.select({ p: tenantConfigs.emailByoProvider }).from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId)).get();
        const provider = coerceEmailByoProvider(cfg?.p);

        let result: StepResult;
        if (provider === 'resend') {
            const apiKey = c.env.RESEND_API_KEY;
            if (!apiKey) {
                result = { step, status: 'fail', detail: 'No Resend API key is saved.' };
            } else {
                const identity = await c.var.services.branding.getEmailIdentity(tenantId);
                result = await runEmailStep(step, {
                    apiKey,
                    senderEmail: identity.senderEmail,
                    senderDisplayName: identity.senderDisplayName ?? identity.companyName,
                    replyTo: identity.replyTo,
                    // Session user only. The body schema has no recipient field.
                    sessionEmail: await readSessionEmail(db, tenantId, user.sub),
                    lastSend: await readLastSend(c.env.TENANT_CACHE, tenantId, user.sub),
                    saveLastSend: (s) => writeLastSend(c.env.TENANT_CACHE, tenantId, user.sub, s),
                    clearLastSend: () => clearLastSend(c.env.TENANT_CACHE, tenantId, user.sub),
                    lookupDelivery: (id) => lookupResendDelivery(db, tenantId, id),
                });
            }
        } else if (step !== 'key_valid') {
            result = { step, status: 'skipped', detail: 'Only the key check is available for this provider.' };
        } else {
            const env = c.env;
            const apiKey = provider === 'sendgrid' ? env.SENDGRID_API_KEY
                : provider === 'postmark' ? env.POSTMARK_SERVER_TOKEN
                : env.MAILGUN_API_KEY;
            const domain = env.MAILGUN_DOMAIN;
            if (!apiKey || (provider === 'mailgun' && !domain)) {
                result = { step, status: 'fail', detail: 'The credentials for this provider are not fully saved.' };
            } else {
                const adapter = resolveEmailProvider(provider, provider === 'mailgun' ? { apiKey, domain: domain! } : { apiKey });
                const v = adapter.validateCredentials ? await adapter.validateCredentials().catch(() => null) : { ok: true as const };
                result = v?.ok
                    ? { step, status: 'pass', detail: `${provider} accepted the credentials.` }
                    : { step, status: 'fail', detail: v ? `${provider} rejected the credentials.` : 'The credential check failed unexpectedly.' };
            }
        }
        await logStep(c.env, tenantId, user.sub, 'email', provider, result);
        return c.json({ success: true as const, data: { ...result, provider } }, 200);
    })
    .openapi(stripeStepRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        if (!tenantId || !user?.sub) throw Errors.Unauthorized('Missing tenant scope');
        await checkRateLimit(c, 'integration-test-step', tenantId);
        const { step } = c.req.valid('json');
        const secretKey = c.env.STRIPE_SECRET_KEY;
        const result = await runStripeStep(step, {
            fetchAccount: secretKey
                ? async () => ({
                    ...(await new (await import('../services/stripe.service')).StripeService(secretKey).getAccountStatus()),
                    livemode: secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_'),
                })
                : null,
            webhookSecretConfigured: !!c.env.STRIPE_WEBHOOK_SECRET,
            readDeliveries: () => readWebhookLog(c.env.TENANT_CACHE, tenantId),
        });
        await logStep(c.env, tenantId, user.sub, 'stripe', null, result);
        return c.json({ success: true as const, data: { ...result, provider: null } }, 200);
    });

export type IntegrationsTestStepsApi = typeof integrationsTestStepsRoutes;
export default integrationsTestStepsRoutes;
