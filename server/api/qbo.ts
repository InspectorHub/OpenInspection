import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { getCookie } from 'hono/cookie';
import { verifyJwt } from '../lib/jwt-keyring';
import { bearerToken } from '../lib/auth-helpers';
import { requireRole } from '../lib/middleware/rbac';
import { logger } from '../lib/logger';
import { checkRateLimit } from '../lib/rate-limit';
import { fireAndForget } from '../lib/fire-and-forget';
import { resyncInvoicesForContact } from '../services/qbo/resync';
import { describeCredentialSource } from '../services/qbo/credential-source';
import type { QBOConnectionStatus } from '../services/qbo/api-base';
import { QBOCustomerSearchQuerySchema, QBOLinkCustomerBodySchema } from '../lib/validations/qbo.schema';

const api = new Hono<HonoConfig>();

// These routes serve JSON to the settings page's Alpine controller. The
// global JWT middleware in index.ts only short-circuits when no token is
// present, so we enforce auth here and respond 401 (not redirect) so the
// fetch caller sees a structured failure.
api.use('*', async (c, next) => {
    // A Bearer token is honoured as well as the cookie, as the global middleware
    // in front of this router does: the settings page reached through Intuit's
    // cross-site redirect has no usable cookie and sends the token this way.
    const token = bearerToken(c) ?? getCookie(c, '__Host-inspector_token') ?? getCookie(c, 'inspector_token');
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
 * NOT here: it lives in `api/qbo-oauth.ts`. Both routers share the
 * `/api/integrations/qbo` mount, so the two `use('*')` guards above re-register
 * across that whole prefix; `server/index.ts` mounts this router AFTER the pair
 * so they cannot answer Intuit's cookie-less `/callback`. `/connect` carries the
 * same owner/manager guard per route; `/callback` is authorized by `state`.
 *
 * Asserted at the HTTP boundary in `tests/unit/qbo/qbo-route-authorization.spec.ts`
 * (and `qbo-oauth-callback.spec.ts` for the pair that moved), because neither
 * authorization gate can see a hand-rolled Hono router.
 */
api.use('*', requireRole('owner', 'manager'));

api.get('/status', async (c) => {
    const state = await c.var.services.qbo.getConnectionStatus(c.get('tenantId'));
    if (!state) return c.json({ success: true, data: null });
    // Assembled here because only this request knows it: the service is built
    // from the already-merged env, which no longer says which side a value
    // came from. Origins only; the values never leave the server.
    const status: QBOConnectionStatus = {
        ...state,
        credentialSource: describeCredentialSource(c.env, c.get('tenantSecretKeys') ?? []),
    };
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

/**
 * Close an open row: the tenant has looked at it and is done with it.
 *
 * It was `/errors/:id/retry`, and it retried nothing — `resolveError` sets
 * `is_resolved` and stops. Nothing reached it (no surface listed the rows), so
 * the lie was never caught by use; a name that describes an action the handler
 * does not perform is the shape that produced most of this integration's
 * never-worked paths. Re-attempting a push is what "Sync now" is for, and it
 * re-detects anything still broken into a fresh row.
 */
api.post('/errors/:id/dismiss', async (c) => {
    await c.var.services.qbo.resolveError(c.get('tenantId'), c.req.param('id'));
    return c.json({ success: true });
});

/**
 * Find the QuickBooks customer a contact should be matched to. Read-only, but
 * every call is an Intuit API call made under this company's credentials, so it
 * is rate limited per company (not per caller address) and the search text is
 * bounded by the schema before any call is made.
 */
api.get('/customers', async (c) => {
    const parsed = QBOCustomerSearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ success: false, error: { code: 'validation_error', message: 'Invalid query' } }, 400);
    const tenantId = c.get('tenantId');
    await checkRateLimit(c, 'qbo-customer-search', tenantId);
    const found = await c.var.services.qbo.searchCustomers(tenantId, parsed.data.q, parsed.data.startPosition, parsed.data.limit);
    // Spelled out field by field: the browser gets exactly these and nothing a
    // future change to the service row might add.
    const customers = found.customers.map((r) => ({
        id: r.id,
        displayName: r.displayName,
        companyName: r.companyName,
        email: r.email,
        phone: r.phone,
        active: r.active,
        linkedContactId: r.linkedContactId,
        linkedContactName: r.linkedContactName,
    }));
    return c.json({ success: true, data: { customers, nextStartPosition: found.nextStartPosition } });
});

api.get('/contacts/:contactId/link', async (c) => {
    const link = await c.var.services.qbo.getContactLink(c.get('tenantId'), c.req.param('contactId'));
    return c.json({
        success: true,
        data: {
            linked: link.linked,
            qboCustomerId: link.qboCustomerId,
            displayName: link.displayName,
            openErrorCount: link.openErrorCount,
        },
    });
});

// Safe to repeat: matching a contact to the customer it already holds rewrites
// the same row and reports replacedQboCustomerId: null.
api.post('/contacts/:contactId/link', async (c) => {
    const parsed = QBOLinkCustomerBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: 'validation_error', message: 'Invalid body' } }, 400);
    // The actor is recorded in the audit trail, so a request with no verified
    // user behind it is refused rather than written as an anonymous match.
    const actorUserId = c.get('user')?.sub;
    if (!actorUserId) return c.json({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    const tenantId = c.get('tenantId');
    const contactId = c.req.param('contactId');
    const svc = c.var.services.qbo;
    const result = await svc.linkExistingCustomer(tenantId, contactId, parsed.data.qboCustomerId, actorUserId);
    // The match is done and is the answer. Pushing the invoices that were waiting
    // for it is slow (calls to QuickBooks), so it runs after the response, capped
    // at RESYNC_INVOICE_LIMIT; a failure there is logged and never undoes the match.
    fireAndForget(c, resyncInvoicesForContact(svc, tenantId, contactId).then((r) => {
        logger.info('QBO re-sync after match finished', { tenantId, contactId, ...r });
    }), 'QBO re-sync after match', { tenantId, contactId });
    return c.json({
        success: true,
        data: {
            qboCustomerId: result.qboCustomerId,
            displayName: result.displayName,
            replacedQboCustomerId: result.replacedQboCustomerId,
            resolvedErrorCount: result.resolvedErrorCount,
        },
    });
});

// Safe to repeat: removing a match that is already gone answers removed: false.
// Nothing is sent to QuickBooks.
api.delete('/contacts/:contactId/link', async (c) => {
    const actorUserId = c.get('user')?.sub;
    if (!actorUserId) return c.json({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    const result = await c.var.services.qbo.unlinkCustomer(c.get('tenantId'), c.req.param('contactId'), actorUserId);
    return c.json({ success: true, data: { removed: result.removed } });
});

export default api;
