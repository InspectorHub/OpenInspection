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
import { setCookie } from 'hono/cookie';
import { Errors } from '../lib/errors';
import type { HonoConfig } from '../types/hono';

const identityRoutes = new OpenAPIHono<HonoConfig>();

const listRoute = createRoute({
    method:  'get',
    path:    '/',
    tags:    ['Identity'],
    summary: 'List linked identities for the caller',
    responses: { 200: { description: 'ok' } },
});
identityRoutes.openapi(listRoute, async (c) => {
    const user = c.get('user') as { sub?: string } | undefined;
    if (!user?.sub) throw Errors.Unauthorized('Missing user identity');
    const items = await c.var.services.identity.list(user.sub);
    return c.json({ success: true as const, data: { identities: items } }, 200);
});

const switchRoute = createRoute({
    method:  'post',
    path:    '/switch',
    tags:    ['Identity'],
    summary: 'Switch active identity to a linked seat',
    request: {
        body: { content: { 'application/json': { schema: z.object({
            linkedUserId: z.string().min(1),
        }) } } },
    },
    responses: {
        200: { description: 'ok' },
        403: { description: 'forbidden — not linked' },
        404: { description: 'linked user gone' },
    },
});
identityRoutes.openapi(switchRoute, async (c) => {
    const user = c.get('user') as { sub?: string } | undefined;
    if (!user?.sub) throw Errors.Unauthorized('Missing user identity');

    const { linkedUserId } = c.req.valid('json');
    const keyring = await c.var.keyringPromise;
    if (!keyring) throw Errors.Internal('JWT keyring not initialised');

    const out = await c.var.services.identity.switchTo(user.sub, linkedUserId, { keyring });
    if (out.kind === 'forbidden') throw Errors.Forbidden('Not linked to that identity');
    if (out.kind === 'not_found') throw Errors.NotFound('Linked user no longer exists');

    // Replace the session cookie — same attributes as login per CLAUDE.md
    // JWT/Auth Security Rules: __Host- prefix, httpOnly, secure, Strict.
    setCookie(c, '__Host-inspector_token', out.newToken, {
        httpOnly: true, secure: true, sameSite: 'Strict', path: '/',
    });

    return c.json({ success: true as const, data: { redirectUrl: out.redirectUrl } }, 200);
});

const linkRoute = createRoute({
    method:  'post',
    path:    '/link',
    tags:    ['Identity'],
    summary: 'Link another identity by email',
    request: {
        body: { content: { 'application/json': { schema: z.object({
            targetEmail: z.string().email(),
        }) } } },
    },
    responses: {
        200: { description: 'ok' },
        404: { description: 'target user not found' },
    },
});
identityRoutes.openapi(linkRoute, async (c) => {
    const user = c.get('user') as { sub?: string } | undefined;
    if (!user?.sub) throw Errors.Unauthorized('Missing user identity');

    const { targetEmail } = c.req.valid('json');
    try {
        const out = await c.var.services.identity.link({
            primaryUserId: user.sub,
            targetEmail,
        });
        return c.json({ success: true as const, data: out }, 200);
    } catch (e) {
        if (e instanceof Error && /target user not found/i.test(e.message)) {
            throw Errors.NotFound('Target user not found');
        }
        throw e;
    }
});

export default identityRoutes;
