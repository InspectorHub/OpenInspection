/**
 * GDPR/CCPA account export + soft-delete routes.
 *
 *   POST /api/identities/account/export — export the caller's account data
 *   POST /api/identities/account/delete — soft-delete the caller's account
 *
 * The mount is `/api/identities` (PLURAL, `server/index.ts`) and these two lines
 * are the full paths, not the route-relative ones. The export line said
 * `/api/identity/…` until 2026-08-21, which mattered more than a stale comment
 * usually does: `server/lib/middleware/agent-terms-gate.ts` exempts both of
 * these by EXACT string, and a reader who trusted this header would have written
 * an exemption that matched nothing.
 */
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import type { HonoConfig } from '../types/hono';
import type { Context } from 'hono';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    AccountExportResponseSchema,
    AccountDeleteRequestSchema,
    AccountDeleteResponseSchema,
} from '../lib/validations/identity.schema';
import { exportAccount, softDeleteAccount } from '../services/account.service';
import { getDrizzle } from '../lib/route-helpers';

function getCallerUserId(c: Context<HonoConfig>): string {
    const sub = (c.get('user') as { sub?: string } | undefined)?.sub;
    if (!sub) throw Errors.Unauthorized('Missing user identity');
    return sub;
}

// ─── Account export + soft delete ───────────────────────────────────────────
const accountExportRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/account/export',
    operationId: 'exportMyAccount',
    tags:    ['identity'],
    summary: 'Export the caller account as a JSON blob',
    description: 'Returns the caller\'s user record plus their agent-tenant memberships and the inspections they ran, for GDPR/CCPA portability.',
    responses: {
        200: {
            content: { 'application/json': { schema: AccountExportResponseSchema } },
            description: 'Account export blob',
        },
    },
}, { scopes: ['read'], tier: 'extended' }));

const accountDeleteRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/account/delete',
    operationId: 'softDeleteMyAccount',
    tags:    ['identity'],
    summary: 'Soft-delete the caller account after email confirmation',
    description: 'Marks the caller\'s users.deleted_at after they retype their email to confirm. Rows are kept so audit-linked references stay intact; subsequent logins fail because auth checks the column.',
    request: {
        body: { content: { 'application/json': { schema: AccountDeleteRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AccountDeleteResponseSchema } },
            description: 'Soft-deleted',
        },
        400: { description: 'confirmEmail mismatch' },
    },
}, { scopes: ['write'], tier: 'extended' }));

const identityRoutes = createApiRouter()
    .openapi(accountExportRoute, async (c) => {
        const userId = getCallerUserId(c);
        const db = getDrizzle(c);
        const data = await exportAccount(db, userId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(accountDeleteRoute, async (c) => {
        const userId = getCallerUserId(c);
        const { confirmEmail } = c.req.valid('json');
        const db = getDrizzle(c);
        try {
            const data = await softDeleteAccount(db, userId, confirmEmail, c.env.TENANT_CACHE);
            return c.json({ success: true as const, data }, 200);
        } catch (e) {
            if (e instanceof Error && /not found/i.test(e.message)) {
                throw Errors.NotFound(e.message);
            }
            throw Errors.BadRequest(e instanceof Error ? e.message : 'delete failed');
        }
    });

export type IdentityApi = typeof identityRoutes;

export default identityRoutes;
