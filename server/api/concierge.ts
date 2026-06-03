import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { agreementSignPath } from '../lib/public-urls';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import {
    BookInfoQuerySchema,
    BookInfoResponseSchema,
    BookRequestSchema,
    BookResponseSchema,
    ConfirmInfoQuerySchema,
    ConfirmInfoResponseSchema,
} from '../lib/validations/concierge.schema';
import {
    getBookInfo,
    createBooking,
    getConfirmInfo,
} from '../services/concierge.service';

/**
 * Agent Accounts A3 — POST /api/concierge/confirm
 *
 * Public endpoint (no JWT). Client redeems the magic-link token. Service
 * verifies validity, transitions inspection state, and (when agreementRequired)
 * chains into the standard e-sign flow by minting an agreement_request via
 * AgreementService.findOrCreate. Response carries `redirect` so the
 * client-side script can route to the appropriate next step.
 */
const ConfirmBodySchema = z.object({
    token: z.string().min(8).max(128).describe('TODO describe token field for the OpenInspection MCP integration'),
}).openapi('ConciergeConfirmBody');

const ConfirmResponseSchema = createApiResponseSchema(
    z.object({
        inspectionId: z.string().uuid().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
        redirect:     z.string().describe('TODO describe redirect field for the OpenInspection MCP integration'),
    }),
).openapi('ConciergeConfirmResponse');

const confirmRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/confirm',
    tags: ["bookings"],
    summary: 'Client redeems a concierge magic-link token',
    request: {
        body: { content: { 'application/json': { schema: ConfirmBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ConfirmResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Confirmed — caller redirects to either the agreement signing page or the inspection report',
        },
        400: { description: 'Token expired or already used' },
        404: { description: 'Token not found' },
    },
    operationId: "confirmConcierge",
    description: "Auto-generated placeholder for confirmConcierge (POST /confirm, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: [], tier: 'extended' }));

/* ------------------------------------------------------------------ */
/*  Public booking flow routes (Tasks 15-17 of dead-routes-cleanup)    */
/* ------------------------------------------------------------------ */

// Shared error body for the public concierge 400s so the handlers can return a
// typed { success:false, error } payload without an `as any` cast.
const ConciergeErrorSchema = z.object({
    success: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
});

const bookInfoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/book-info',
    tags: ['bookings'],
    summary: 'Public booking page bootstrap by invite token',
    request: { query: BookInfoQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: BookInfoResponseSchema } },
            description: 'Bootstrap payload — tenant brand, optional inspector, slot stubs, expiry',
        },
        400: { content: { 'application/json': { schema: ConciergeErrorSchema } }, description: 'Invite token missing, invalid, or expired' },
    },
    operationId: 'getConciergeBookInfo',
    description:
        'Public unauthenticated read of tenant brand + (placeholder) slot list for the concierge booking page. The token is an opaque invite secret embedded in the magic-link URL the inspector shared with the customer. Returns empty availableSlots until calendar integration ships.',
}, { scopes: [], tier: 'extended' }));

const bookRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/book',
    tags: ['bookings'],
    summary: 'Create booking from public concierge form',
    request: {
        body: { content: { 'application/json': { schema: BookRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: BookResponseSchema } },
            description: 'Booking row created — returns id + confirmation token',
        },
        400: { content: { 'application/json': { schema: ConciergeErrorSchema } }, description: 'Invite token invalid/expired or form payload rejected' },
    },
    operationId: 'createConciergeBooking',
    description:
        'Public unauthenticated write that inserts a concierge_bookings row keyed by the invite token plus a freshly minted confirmation token the frontend hands to /confirm-info on the next page.',
}, { scopes: [], tier: 'extended' }));

const confirmInfoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/confirm-info',
    tags: ['bookings'],
    summary: 'Read just-booked details by confirmation token',
    request: { query: ConfirmInfoQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: ConfirmInfoResponseSchema } },
            description: 'Booking summary — slot, address, contact, tenant',
        },
        400: { content: { 'application/json': { schema: ConciergeErrorSchema } }, description: 'Confirmation token missing or unknown' },
    },
    operationId: 'getConciergeConfirmInfo',
    description:
        'Public unauthenticated read of a freshly created concierge booking, keyed by the confirmation token returned from POST /book. Used to render the static confirm page after submission.',
}, { scopes: [], tier: 'extended' }));

export const conciergeRoutes = createApiRouter()
    .openapi(confirmRoute, async (c) => {
        const { token } = c.req.valid('json');
        const result = await c.var.services.concierge.confirmByClient(token);

        // Resolve token data again to decide where to send the client. We avoid
        // having confirmByClient itself return the inspection because the service
        // boundary is purely state-machine.
        const view = await c.var.services.concierge.resolveToken(token);

        let redirect = '/';
        if (view) {
            if (view.inspection.agreementRequired) {
                // Chain into the existing e-sign flow: ensure an agreement_request
                // exists for this inspection, then redirect to /agreements/sign/<token>.
                try {
                    const agr = await c.var.services.agreement.findOrCreate(
                        view.inspection.tenantId,
                        view.inspection.id,
                    );
                    redirect = agreementSignPath(view.inspection.tenantSlug, agr.token);
                } catch (err) {
                    // No template configured — surface a generic thank-you page.
                    logger.warn('concierge.findOrCreate.failed', {
                        tenantId: view.inspection.tenantId,
                        inspectionId: view.inspection.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                    redirect = `/report/${view.inspection.tenantSlug}/${view.inspection.id}`;
                }
            } else {
                // Optimistically redirect to the report viewer; the gate will lock
                // it down if the inspection is still pending.
                redirect = `/report/${view.inspection.tenantSlug}/${view.inspection.id}`;
            }
        }

        return c.json({
            success: true as const,
            data: { inspectionId: result.inspectionId, redirect },
        }, 200);
    })
    .openapi(bookInfoRoute, async (c) => {
        const { token } = c.req.valid('query');
        const db = drizzle(c.env.DB);
        try {
            const data = await getBookInfo(db, token);
            return c.json({ success: true as const, data }, 200);
        } catch (e) {
            logger.warn('concierge.bookInfo.failed', {
                error: e instanceof Error ? e.message : String(e),
            });
            return c.json(
                { success: false as const, error: { code: 'INVITE_INVALID', message: e instanceof Error ? e.message : 'invalid' } },
                400,
            );
        }
    })
    .openapi(bookRoute, async (c) => {
        const input = c.req.valid('json');
        const db = drizzle(c.env.DB);
        try {
            const data = await createBooking(db, input);
            return c.json({ success: true as const, data }, 200);
        } catch (e) {
            logger.warn('concierge.book.failed', {
                error: e instanceof Error ? e.message : String(e),
            });
            return c.json(
                { success: false as const, error: { code: 'BOOKING_FAILED', message: e instanceof Error ? e.message : 'failed' } },
                400,
            );
        }
    })
    .openapi(confirmInfoRoute, async (c) => {
        const { token } = c.req.valid('query');
        const db = drizzle(c.env.DB);
        try {
            const data = await getConfirmInfo(db, token);
            return c.json({ success: true as const, data }, 200);
        } catch (e) {
            logger.warn('concierge.confirmInfo.failed', {
                error: e instanceof Error ? e.message : String(e),
            });
            return c.json(
                { success: false as const, error: { code: 'CONFIRMATION_INVALID', message: e instanceof Error ? e.message : 'invalid' } },
                400,
            );
        }
    });

export type ConciergeApi = typeof conciergeRoutes;

export default conciergeRoutes;

// Re-export Errors so callers don't need a separate import.
export { Errors };
