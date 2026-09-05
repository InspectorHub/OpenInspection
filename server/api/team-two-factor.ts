import { createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';

/**
 * POST /api/team/members/:id/two-factor/reset
 *
 * The only path in the product that clears somebody ELSE's second factor. Its
 * reason for existing, and why it is owner-only, are on
 * `TeamService.resetMemberTwoFactor`.
 */
const resetMemberTwoFactorRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/members/{id}/two-factor/reset',
    tags: ["team"],
    summary: "Clear a member's two-factor enrolment",
    description: "Wipes a member's TOTP secret, enabled flag and recovery codes so they can sign in with their password and enrol again. Owner-only: this is the one action that lowers another person's authentication requirement. Exists because every self-service 2FA endpoint requires a valid code, which leaves someone who has lost both their authenticator and their recovery codes with no path back into the workspace. Does not change the password and does not end the member's existing sessions.",
    middleware: [requireRole('owner')],
    request: {
        params: z.object({ id: z.string().trim().min(1).describe("The member's user id.") }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ reset: z.boolean() })) } },
            description: 'Two-factor enrolment cleared',
        },
        400: { description: 'Yourself, or a member with no two-factor enrolment' },
        404: { description: 'Member not found in this tenant' },
    },
    operationId: "resetTeamMemberTwoFactor",
}, { scopes: ['write'], tier: 'extended' }));

/**
 * Mounted onto the team router at the same path it would have had inline, so
 * the public surface is unchanged. It lives in its own module because
 * `server/api/team.ts` reached the 400-line ceiling, and because this is the
 * one route on that router that is neither seat administration nor an invite —
 * it is account recovery, and it is the only one guarded on `owner` alone.
 */
const teamTwoFactorRoutes = createApiRouter()
    .openapi(resetMemberTwoFactorRoute, async (c) => {

        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const { id: memberId } = c.req.valid('param');

        const { email } = await c.var.services.team.resetMemberTwoFactor(
            tenantId, memberId, user?.sub as string,
        );

        // AUDITED, because it is the one action that lowers somebody else's
        // authentication requirement and leaves no other trace: the member's
        // row afterwards is indistinguishable from one that never enrolled.
        // Recorded AFTER the write, so a refused reset writes nothing.
        auditFromContext(c, 'user.two_factor_reset', 'user', {
            entityId: memberId,
            metadata: { email },
        });

        return c.json({ success: true as const, data: { reset: true as const } }, 200);
    })

export default teamTwoFactorRoutes;
