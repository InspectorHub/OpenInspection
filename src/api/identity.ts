/**
 * Design System 0520 subsystem E phase 4 — IdentitySwitcher routes (M20).
 *
 *   GET  /api/identities         — list linked identities for the caller
 *   POST /api/identities/switch  — issue a new JWT for a linked identity
 *                                   and replace the session cookie
 *   POST /api/identities/link    — admin-only: link the caller to another
 *                                   user (by email) so it appears in the
 *                                   switcher menu
 *
 * Switch and link write to audit_logs via AuditLogService when available.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { Errors } from '../lib/errors';
import type { HonoConfig } from '../types/hono';
import { withMcpMetadata } from '../lib/route-metadata-standards';

const identityRoutes = new OpenAPIHono<HonoConfig>();

function getCallerUserId(c: Context<HonoConfig>): string {
    const sub = (c.get('user') as { sub?: string } | undefined)?.sub;
    if (!sub) throw Errors.Unauthorized('Missing user identity');
    return sub;
}

const listRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/',
    operationId: 'listMyLinkedIdentities',
    tags:    ['identity'],
    summary: 'List linked identities for the caller',
    description: 'Returns all identity seats linked to the caller, including the primary identity. Used by the identity switcher menu in the dashboard.',
    responses: { 200: { description: 'ok' } },
}, { scopes: ['read'], tier: 'extended' }));
identityRoutes.openapi(listRoute, async (c) => {
    const items = await c.var.services.identity.list(getCallerUserId(c));
    return c.json({ success: true as const, data: { identities: items } }, 200);
});

const switchRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/switch',
    operationId: 'switchActiveIdentity',
    tags:    ['identity'],
    summary: 'Switch active identity to linked seat',
    description: 'Issues a new JWT for the specified linked identity and replaces the session cookie. Caller must be linked to the target identity already.',
    request: {
        body: { content: { 'application/json': { schema: z.object({
            linkedUserId: z.string().min(1).describe('UUID of the linked identity to switch into; must be one of the caller\'s linked seats.'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { description: 'ok' },
        403: { description: 'forbidden — not linked' },
        404: { description: 'linked user gone' },
    },
}, { scopes: ['write'], tier: 'extended' }));
identityRoutes.openapi(switchRoute, async (c) => {
    const primaryUserId = getCallerUserId(c);
    const { linkedUserId } = c.req.valid('json');
    const keyring = await c.var.keyringPromise;
    if (!keyring) throw Errors.Internal('JWT keyring not initialised');

    const out = await c.var.services.identity.switchTo(primaryUserId, linkedUserId, { keyring });
    if (out.kind === 'forbidden') throw Errors.Forbidden('Not linked to that identity');
    if (out.kind === 'not_found') throw Errors.NotFound('Linked user no longer exists');

    // Replace the session cookie — same attributes as login per CLAUDE.md
    // JWT/Auth Security Rules: __Host- prefix, httpOnly, secure, Strict.
    setCookie(c, '__Host-inspector_token', out.newToken, {
        httpOnly: true, secure: true, sameSite: 'Strict', path: '/',
    });

    return c.json({ success: true as const, data: { redirectUrl: out.redirectUrl } }, 200);
});

const linkRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/link',
    operationId: 'linkIdentityByEmail',
    tags:    ['identity'],
    summary: 'Link another identity by email',
    description: 'Admin-only: links the caller\'s primary user record to another existing user (looked up by email) so the second seat becomes available in the switcher menu.',
    request: {
        body: { content: { 'application/json': { schema: z.object({
            targetEmail: z.string().email().describe('Email address of the other existing user account to link into the caller\'s identity set.'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { description: 'ok' },
        404: { description: 'target user not found' },
    },
}, { scopes: ['admin'], tier: 'extended' }));
identityRoutes.openapi(linkRoute, async (c) => {
    const primaryUserId = getCallerUserId(c);
    const { targetEmail } = c.req.valid('json');
    try {
        const out = await c.var.services.identity.link({ primaryUserId, targetEmail });
        return c.json({ success: true as const, data: out }, 200);
    } catch (e) {
        if (e instanceof Error && /target user not found/i.test(e.message)) {
            throw Errors.NotFound('Target user not found');
        }
        throw e;
    }
});

export default identityRoutes;
