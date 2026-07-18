// Profile / onboarding sub-router.
//
// Behavior-preserving extraction from auth.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
// Covers the authenticated user's self-service surface: account read (/me),
// profile edit (/profile), logout, and the onboarding-flag writes (skip wizard,
// dismiss checklist, generic flag). Logout's cookie deletion keeps its exact
// `__Host-` attributes; no JWT signing happens here.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../../lib/db/schema';
import { deleteCookie } from 'hono/cookie';
import { Errors } from '../../lib/errors';
import { requireRole } from '../../lib/middleware/rbac';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const skipSetupRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/setup/skip',
    operationId: 'skipOnboardingWizard',
    summary: 'Skip the onboarding wizard',
    description: 'Marks the in-app onboarding wizard as skipped for the current user. Does not affect tenant-level setup or any system configuration.',
    tags: ['auth'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Onboarding marked as skipped'
        },
        401: { description: 'Unauthorized' }
    }
}, { scopes: [], tier: 'excluded' }));

const dismissChecklistRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/checklist/dismiss',
    operationId: 'dismissOnboardingChecklist',
    summary: 'Dismiss the onboarding checklist',
    description: 'Marks the dashboard onboarding checklist as dismissed for the current user. Idempotent — safe to call multiple times.',
    tags: ['auth'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema.describe('Checklist dismissed') }
            },
            description: 'Checklist marked as dismissed'
        },
        401: { description: 'Unauthorized' }
    }
}, { scopes: [], tier: 'excluded' }));

// Allowlist of boolean flags that can be set via the generic onboarding-flag endpoint.
// Adding a new flag here is the only server-side change needed for new one-time UI states.
const ONBOARDING_FLAG_ALLOWLIST = ['checklistDismissed', 'spectoraMappingSeen'] as const;
type OnboardingFlag = typeof ONBOARDING_FLAG_ALLOWLIST[number];

const markOnboardingFlagRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/onboarding/flag',
    operationId: 'markOnboardingFlag',
    summary: 'Mark a one-time onboarding flag as seen',
    description: 'Sets a boolean flag in the current user\'s onboardingState. Allowlisted flags only: checklistDismissed, spectoraMappingSeen. Idempotent.',
    tags: ['auth'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        flag: z.enum(ONBOARDING_FLAG_ALLOWLIST).describe('The onboarding flag to mark as true.'),
                    })
                }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema.describe('Flag marked') }
            },
            description: 'Onboarding flag set'
        },
        400: { description: 'Unknown flag' },
        401: { description: 'Unauthorized' }
    }
}, { scopes: [], tier: 'excluded' }));

const meRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/me',
    operationId: 'getMyAccount',
    summary: 'Get the current user account',
    description: 'Returns the authenticated user\'s profile: id, email, role, onboarding state, 2FA status, and remaining recovery code count.',
    tags: ['auth'],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        user: z.object({
                            id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                            email: z.string().optional().describe('TODO describe email field for the OpenInspection MCP integration'),
                            tenantId: z.string().optional().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
                            role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
                            onboardingState: z.record(z.string(), z.boolean()).nullable().optional().describe('TODO describe onboardingState field for the OpenInspection MCP integration'),
                            totpEnabled: z.boolean().optional().describe('TODO describe totpEnabled field for the OpenInspection MCP integration'),
                            recoveryCodesRemaining: z.number().nullable().optional().describe('TODO describe recoveryCodesRemaining field for the OpenInspection MCP integration'),
                        }).describe('TODO describe user field for the OpenInspection MCP integration')
                    }))
                }
            },
            description: 'Success'
        },
        401: { description: 'Unauthorized' }
    }
}, { scopes: [], tier: 'primary' }));

// ── Profile update ──────────────────────────────────────────────────────────
const updateProfileRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/profile',
    operationId: 'updateMyProfile',
    summary: 'Update current user profile fields',
    description: 'Updates the authenticated user\'s display name, phone number, and inspector license number. Empty strings clear the field; missing keys leave existing values unchanged.',
    tags: ['profile'],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().max(100).optional().describe('Display name shown on dashboards, reports, and booking pages.'),
                        phone: z.string().max(30).optional().describe('Contact phone number; included on reports if set.'),
                        licenseNumber: z.string().max(50).optional().describe('Inspector license number; printed on reports as a credential.'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration')
                }
            }
        }
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Profile updated'
        },
        401: { description: 'Unauthorized' }
    }
}, { scopes: ['write'], tier: 'extended' }));

const logoutRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/logout',
    operationId: 'logOutCurrentUser',
    summary: 'Log out the current user',
    description: 'Clears the HttpOnly auth cookie and revokes all outstanding session JWTs for this user via the password-changed KV invalidation channel.',
    tags: ['auth'],
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Logout successful'
        }
    }
}, { scopes: [], tier: 'excluded' }));

const profileRoutes = createApiRouter()
    .openapi(skipSetupRoute, async (c) => {
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized('Not signed in');

        const db = drizzle(c.env.DB);
        const me = await db.select().from(users).where(eq(users.id, user.sub)).get();
        const onboardingState = ((me?.onboardingState ?? {}) as Record<string, boolean>);
        onboardingState.skipped = true;

        await db.update(users).set({ onboardingState }).where(eq(users.id, user.sub));

        return c.json({ success: true, data: { skipped: true } }, 200);
    })
    .openapi(dismissChecklistRoute, async (c) => {
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized('Not signed in');

        const db = drizzle(c.env.DB);
        const me = await db.select().from(users).where(eq(users.id, user.sub)).get();
        const onboardingState = ((me?.onboardingState ?? {}) as Record<string, boolean>);
        onboardingState.checklistDismissed = true;

        await db.update(users).set({ onboardingState }).where(eq(users.id, user.sub));

        return c.json({ success: true, data: { checklistDismissed: true } }, 200);
    })
    .openapi(markOnboardingFlagRoute, async (c) => {
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized('Not signed in');

        const { flag } = c.req.valid('json') as { flag: OnboardingFlag };

        const db = drizzle(c.env.DB);
        const me = await db.select().from(users).where(eq(users.id, user.sub)).get();
        const onboardingState = ((me?.onboardingState ?? {}) as Record<string, boolean>);
        onboardingState[flag] = true;

        await db.update(users).set({ onboardingState }).where(eq(users.id, user.sub));

        return c.json({ success: true, data: { [flag]: true } }, 200);
    })
    .openapi(meRoute, async (c) => {
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized();

        // Email is stored only in the DB, never the JWT.
        const db = drizzle(c.env.DB);
        const row = await db.select({
            email: users.email,
            name: users.name,
            phone: users.phone,
            licenseNumber: users.licenseNumber,
            onboardingState: users.onboardingState,
            totpEnabled: users.totpEnabled,
            totpRecoveryCodes: users.totpRecoveryCodes,
        }).from(users).where(eq(users.id, user.sub)).get();

        let recoveryCodesRemaining: number | null = null;
        if (row?.totpEnabled && row.totpRecoveryCodes) {
            try { recoveryCodesRemaining = (JSON.parse(row.totpRecoveryCodes) as string[]).length; }
            catch { recoveryCodesRemaining = 0; }
        }

        return c.json({
            success: true,
            data: {
                user: {
                    id: user.sub,
                    email: row?.email,
                    name: row?.name || null,
                    phone: row?.phone || null,
                    licenseNumber: row?.licenseNumber || null,
                    onboardingState: row?.onboardingState ?? null,
                    tenantId: c.get('tenantId'),
                    role: c.get('userRole'),
                    totpEnabled: !!row?.totpEnabled,
                    recoveryCodesRemaining,
                }
            }
        }, 200);
    })
    .openapi(updateProfileRoute, async (c) => {
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized();

        const body = c.req.valid('json');
        const updates: Record<string, string | null> = {};
        if (body.name !== undefined) updates.name = body.name || null;
        if (body.phone !== undefined) updates.phone = body.phone || null;
        if (body.licenseNumber !== undefined) updates.licenseNumber = body.licenseNumber || null;

        if (Object.keys(updates).length > 0) {
            const db = drizzle(c.env.DB);
            await db.update(users).set(updates).where(eq(users.id, user.sub)).run();
        }

        return c.json({ success: true, data: { updated: true } }, 200);
    })
    .openapi(logoutRoute, async (c) => {
        // If the request carries a valid token, revoke all of this user's tokens server-side.
        // The JS client can't clear an HttpOnly cookie — we must do it via Set-Cookie.
        const user = c.get('user');
        if (user?.sub) {
            await c.var.services.auth.invalidateUserSessions(user.sub);
        }

        deleteCookie(c, '__Host-inspector_token', {
            path: '/',
            secure: true,
            sameSite: 'Strict',
        });

        // iter-2 production bug #4 — clear the CSRF cookie alongside the auth
        // cookie. Without this, `__Host-csrf_token` outlives the session and
        // becomes a fixation vector: a subsequent login on the same browser
        // inherits the same CSRF token, which an attacker who exfiltrated it
        // pre-logout can replay against the new session. Same `__Host-` prefix
        // rules apply (Secure + Path=/).
        deleteCookie(c, '__Host-csrf_token', {
            path: '/',
            secure: true,
            sameSite: 'Strict',
        });

        return c.json({ success: true }, 200);
    });

export default profileRoutes;
