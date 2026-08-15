import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { getCookie } from 'hono/cookie';
import { verifyJwt } from '../lib/jwt-keyring';
import { requireRole } from '../lib/middleware/rbac';
import { logger } from '../lib/logger';
import { QBOLinkCustomerBodySchema } from '../lib/validations/qbo.schema';

const api = new Hono<HonoConfig>();

// These routes serve JSON to the settings page's Alpine controller. The
// global JWT middleware in index.ts only short-circuits when no token is
// present, so we enforce auth here and respond 401 (not redirect) so the
// fetch caller sees a structured failure.
api.use('*', async (c, next) => {
    const token = getCookie(c, '__Host-inspector_token') ?? getCookie(c, 'inspector_token');
    if (!token) return c.json({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    try {
        const keyring = await c.var.keyringPromise!;
        await verifyJwt(token, keyring);
        return next();
    } catch {
        return c.json({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    }
});

/**
 * Authentication above is NOT authorization, and this router needs both.
 *
 * Every route here administers a COMPANY-level finance integration.
 * `/disconnect` in particular revokes the Intuit refresh token and deletes the
 * tenant's whole `qbo_entity_map` — the OI-invoice -> QBO-invoice
 * correspondence table — which reconnecting does not restore, so the next push
 * writes duplicate invoices against the same DocNumbers. Until this line
 * existed, any signed-in inspector could do that, while listing a Stripe
 * webhook log next door (`integrations.ts`) already required owner/manager.
 *
 * Applied router-wide rather than per route: a uniform surface has no per-route
 * reasoning for a future edit to get wrong, and the read (`/status`) exposes the
 * connected realm, company name and sync errors, which is company books state.
 *
 * `requireRole` also refuses a caller with no role, which is what an agent
 * (client/realtor) JWT is — it satisfies the verifier above and deliberately
 * carries no tenant, so it must never reach a handler.
 *
 * The browser-facing half of the integration — `/connect` and `/callback` — is
 * NOT here: it lives in `api/qbo-oauth.ts` under `/api/integrations/qbo`,
 * because this `/settings/**` mount is unreachable from a browser
 * (`workers/app.ts` forwards an allow-list that does not include it). `/connect`
 * kept this same owner/manager guard on the way over; `/callback` is authorized
 * by `state` instead, since Intuit's redirect carries no cookie.
 *
 * Asserted at the HTTP boundary in `tests/unit/qbo/qbo-route-authorization.spec.ts`
 * (and `qbo-oauth-callback.spec.ts` for the pair that moved), because neither
 * authorization gate can see a hand-rolled Hono router.
 */
api.use('*', requireRole('owner', 'manager'));

api.get('/status', async (c) => {
    const status = await c.var.services.qbo.getConnectionStatus(c.get('tenantId'));
    return c.json({ success: true, data: status });
});

api.post('/disconnect', async (c) => {
    await c.var.services.qbo.disconnect(c.get('tenantId'));
    return c.json({ success: true });
});

api.post('/pause', async (c) => {
    const result = await c.var.services.qbo.setSyncEnabled(c.get('tenantId'));
    if (result === null) return c.json({ success: false, error: { code: 'not_connected', message: 'Not connected' } }, 404);
    return c.json({ success: true, data: { syncEnabled: result } });
});

api.post('/sync', async (c) => {
    const tenantId = c.get('tenantId');
    const svc = c.var.services.qbo;
    const invoiceSvc = c.var.services.invoice;
    c.executionCtx.waitUntil(
        svc.runCDCSync(
            tenantId,
            // Inbound: the row appended is dropped on purpose — QuickBooks is
            // where this figure came from, so it must not be pushed back.
            async (invoiceId, tid) => { await invoiceSvc.markPaid(invoiceId, tid, 'qbo'); },
            async (invoiceId, amountPaidCents, tid) => { await invoiceSvc.markPartial(invoiceId, tid, 'qbo', amountPaidCents); },
        // The response has already been sent by the time this settles, so a
        // rejection here has no caller to reach — without this catch it is an
        // unhandled rejection and the sweep fails with no trace at all.
        ).catch((e: unknown) => {
            logger.error('QBO CDC sweep failed', { tenantId }, e instanceof Error ? e : undefined);
        }),
    );
    return c.json({ success: true, data: { message: 'Sync started' } });
});

api.post('/errors/:id/retry', async (c) => {
    await c.var.services.qbo.resolveError(c.get('tenantId'), c.req.param('id'));
    return c.json({ success: true });
});

api.post('/contacts/:contactId/link', async (c) => {
    const parsed = QBOLinkCustomerBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: 'validation_error', message: 'Invalid body' } }, 400);
    await c.var.services.qbo.linkExistingCustomer(c.get('tenantId'), c.req.param('contactId'), parsed.data.qboCustomerId);
    return c.json({ success: true });
});

export default api;
