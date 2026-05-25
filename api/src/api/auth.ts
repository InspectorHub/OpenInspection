import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { users } from '../lib/db/schema';
import { setCookie, deleteCookie } from 'hono/cookie';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { getBaseUrl } from '../lib/url';
import { checkRateLimit } from '../lib/rate-limit';
import { requireCsrfToken } from '../lib/middleware/csrf';
import { requireRole } from '../lib/middleware/rbac';
import { verifyPassword } from '../lib/password';
import { signJwt, verifyJwt } from '../lib/jwt-keyring';
import {
    LoginSchema,
    ChangePasswordSchema,
    JoinTeamSchema,
    ForgotPasswordSchema,
    ResetPasswordSchema,
    AuthResponseSchema,
    SetupSchema,
    TotpVerifySchema,
    TotpDisableSchema,
    TotpRegenerateSchema,
    TotpLoginSchema,
    TotpSetupResponseSchema,
    Login2faResponseSchema
} from '../lib/validations/auth.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';

/**
 * Cookie attributes for the auth token. `__Host-` prefix demands Secure + path=/ + no Domain,
 * which this helper already satisfies. SameSite=Strict blocks all cross-site cookie sending —
 * including top-level navigation — so a malicious link can never drag a logged-in session
 * into a mutation or a sensitive GET.
 */
function authCookieOptions() {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'Strict' as const,
        path: '/',
        maxAge: 60 * 60 * 24,
    };
}

/**
 * Interface for the decoded JWT payload. Intentionally does not carry email or any other
 * PII — JWTs are signed, not encrypted.
 */
export interface AuthPayload {
    sub: string;
    'custom:tenantId': string;
    'custom:userRole': string;
    role: string;
    exp: number;
    iat?: number;
}

const coreAuthRoutes = new OpenAPIHono<HonoConfig>();

// --- Routes ---

const loginRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/login',
    operationId: 'loginWithPassword',
    summary: 'Log in with email and password',
    description: 'Validates email + password credentials and sets a JWT session cookie. Returns a short-lived 2FA challenge token instead of a session when the account has TOTP enabled.',
    tags: ['auth', 'public'],
    middleware: [requireCsrfToken],
    request: {
        body: {
            content: {
                'application/json': { schema: LoginSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: AuthResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Login successful'
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' }
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(loginRoute, async (c) => {
    // Shared-SaaS deploys disable the local password form — see the
    // matching guard on GET /login. Returning Gone (410) + a redirect
    // hint lets stale clients (cached SPA build, scripted callers) bail
    // out cleanly instead of attempting credential validation against
    // a per-(tenant_id,email) row they can't disambiguate.
    const profile = c.var.profile;
    if (profile?.mode === 'saas' && profile?.saasTopology === 'shared') {
        const portal = c.env.PORTAL_API_URL?.replace(/\/$/, '') ?? null;
        return c.json({
            success: false,
            error: {
                code: 'LOGIN_MOVED_TO_PORTAL',
                message: 'Sign in via the workspace portal; this tenant runs in shared-SaaS mode.',
                ...(portal ? { details: { redirect: `${portal}/login` } } : {}),
            },
        }, 410);
    }

    await checkRateLimit(c, 'login');

    const body = c.req.valid('json');
    const user = await c.var.services.auth.validateCredentials(body.email, body.password);

    const keyring = await c.var.keyringPromise!;
    const now = Math.floor(Date.now() / 1000);

    // Spec 4A — If the user has 2FA enabled, return a short-lived challenge token instead of
    // the session JWT. The client must POST it back along with a TOTP code to /api/auth/login/2fa
    // before any session is granted.
    if (user.totpEnabled) {
        const challengeToken = await signJwt({
            sub: user.id,
            t: 'challenge',
            iat: now,
            exp: now + 60 * 5,
        }, keyring);
        // Intentionally NOT a Set-Cookie — challenge tokens travel JSON-only so a stolen
        // session cookie alone never permits 2FA bypass.
        return c.json({
            success: true,
            data: { requires2fa: true, challengeToken }
        }, 200);
    }

    // Email is intentionally NOT in the payload — JWTs are signed but not encrypted, and the
    // token travels through logs / intermediaries. PII belongs in the DB, not in the bearer.
    const token = await signJwt({
        sub: user.id,
        'custom:tenantId': user.tenantId,
        'custom:userRole': user.role,
        role: user.role,
        iat: now,
        exp: now + 60 * 60 * 24,
    }, keyring);

    setCookie(c, '__Host-inspector_token', token, authCookieOptions());

    // Intentionally do NOT return the token in the body. Browser clients authenticate via the
    // HttpOnly cookie. Exposing the raw JWT in JSON invites clients to persist it in localStorage
    // or a JS-readable cookie, which defeats HttpOnly and widens the XSS blast radius.
    return c.json({
        success: true,
        data: { redirect: '/dashboard' }
    }, 200);
});

const changePasswordRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/change-password',
    operationId: 'changeMyPassword',
    summary: 'Change current user password',
    description: 'Updates the authenticated user\'s password after verifying the current one. Invalidates all outstanding session JWTs for this user on success.',
    tags: ['auth'],
    request: {
        body: {
            content: {
                'application/json': { schema: ChangePasswordSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Password updated'
        },
        401: { description: 'Unauthorized' }
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(changePasswordRoute, async (c) => {
    // The global JWT middleware has already verified the token and populated c.var.user.
    const user = c.get('user');
    if (!user?.sub) throw Errors.Unauthorized();

    const body = c.req.valid('json');
    await c.var.services.auth.updatePassword(user.sub, body.currentPassword, body.newPassword);

    return c.json({
        success: true,
        data: { success: true }
    }, 200);
});

const joinTeamRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/join',
    operationId: 'joinTeamFromInvite',
    summary: 'Join a team via invitation token',
    description: 'Finalizes a team invitation: validates the invite token, sets the new user\'s password, creates the account, and issues a session cookie.',
    tags: ['auth', 'public'],
    request: {
        body: {
            content: {
                'application/json': { schema: JoinTeamSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: AuthResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Team joined successfully'
        }
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(joinTeamRoute, async (c) => {
    const body = c.req.valid('json');
    const user = await c.var.services.auth.joinTeam(body.token, body.password);

    const keyring = await c.var.keyringPromise!;
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({
        sub: user.id,
        'custom:tenantId': user.tenantId,
        'custom:userRole': user.role,
        role: user.role,
        iat: now,
        exp: now + 60 * 60 * 24,
    }, keyring);

    setCookie(c, '__Host-inspector_token', token, authCookieOptions());

    return c.json({
        success: true,
        data: { redirect: '/dashboard' }
    }, 200);
});

/**
 * GET /sso?code=<uuid>
 *
 * SSO consume endpoint — the receiving half of the portal-issued
 * handoff token minted at POST /api/integration/sso-handoff. Reads
 * `sso:<code>` from KV (single-use, short TTL), looks up the user,
 * issues a workspace-scoped session cookie, and redirects into the
 * inspector dashboard.
 *
 * Public route (no auth middleware) — the code IS the credential.
 * Code is deleted from KV on success so a leaked URL can't be replayed.
 *
 * This endpoint is what makes multi-workspace switching feel
 * frictionless from portal: user clicks a workspace card → portal
 * calls /api/integration/sso-handoff to get a code → portal 302s the
 * browser to this URL → core sets the right cookie → user lands on
 * the right tenant's dashboard.
 */
const ssoConsumeRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/sso',
    operationId: 'ssoConsume',
    summary: 'Consume a portal-issued SSO handoff code',
    description: 'Reads sso:<code> from KV, issues a session cookie, redirects to /dashboard.',
    tags: ['auth', 'public'],
    request: {
        query: z.object({
            code: z.string().min(8).describe('One-time SSO handoff code minted by the portal at POST /api/integration/sso-handoff. Single-use, expires after 60 seconds, deleted from KV on successful consume.'),
        }),
    },
    responses: {
        302: { description: 'Redirect to /dashboard on success or /login on failure' },
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(ssoConsumeRoute, async (c) => {
    const { code } = c.req.valid('query');
    if (!c.env.TENANT_CACHE) return c.redirect('/login?sso=unavailable', 302);

    const raw = await c.env.TENANT_CACHE.get(`sso:${code}`);
    if (!raw) return c.redirect('/login?sso=expired', 302);
    // Single-use: delete BEFORE issuing the cookie so a parallel replay
    // can't piggyback on a still-resolving call.
    await c.env.TENANT_CACHE.delete(`sso:${code}`);

    let parsed: { userId?: string; tenantId?: string };
    try { parsed = JSON.parse(raw); } catch { return c.redirect('/login?sso=invalid', 302); }
    if (!parsed.userId || !parsed.tenantId) return c.redirect('/login?sso=invalid', 302);

    const { drizzle } = await import('drizzle-orm/d1');
    const { eq, and } = await import('drizzle-orm');
    const { users } = await import('../lib/db/schema');
    const d = drizzle(c.env.DB);
    const user = await d.select().from(users)
        .where(and(eq(users.id, parsed.userId), eq(users.tenantId, parsed.tenantId)))
        .get();
    if (!user) return c.redirect('/login?sso=invalid', 302);

    const keyring = await c.var.keyringPromise!;
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({
        sub: user.id,
        'custom:tenantId': user.tenantId,
        'custom:userRole': user.role,
        role: user.role,
        iat: now,
        exp: now + 60 * 60 * 24,
        // Marker so audit logs / downstream middleware can detect that
        // this session was minted via portal handoff rather than direct
        // password login.
        'custom:sso': true,
    }, keyring);

    setCookie(c, '__Host-inspector_token', token, authCookieOptions());
    return c.redirect('/dashboard', 302);
});

const forgotPasswordRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/forgot-password',
    operationId: 'requestPasswordReset',
    summary: 'Request a password reset email',
    description: 'Triggers a password reset email if the account exists. Always returns 200 even for unknown emails to avoid account enumeration.',
    tags: ['auth', 'public'],
    request: {
        body: {
            content: {
                'application/json': { schema: ForgotPasswordSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Reset email sent (if user exists)'
        }
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(forgotPasswordRoute, async (c) => {
    await checkRateLimit(c, 'forgot');

    const body = c.req.valid('json');
    const resetToken = await c.var.services.auth.createPasswordResetToken(body.email);
    
    if (!resetToken) return c.json({ success: true, data: { success: true } }, 200);

    const baseUrl = getBaseUrl(c);
    const resetLink = `${baseUrl}/login?reset_token=${resetToken}`;

    await c.var.services.email.sendPasswordReset(body.email, resetLink)
        .catch(() => { /* email delivery is best-effort */ });

    return c.json({ success: true, data: { success: true } }, 200);
});

const resetPasswordRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/reset-password',
    operationId: 'resetPasswordWithToken',
    summary: 'Reset password using a token',
    description: 'Completes a password reset flow: validates the one-time reset token and updates the account password to the new value supplied.',
    tags: ['auth', 'public'],
    request: {
        body: {
            content: {
                'application/json': { schema: ResetPasswordSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Password reset successful'
        }
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(resetPasswordRoute, async (c) => {
    const body = c.req.valid('json');
    await c.var.services.auth.resetPassword(body.token, body.newPassword);
    return c.json({ success: true, data: { success: true } }, 200);
});

const setupRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/setup',
    operationId: 'initializeFirstTenant',
    summary: 'Initialize first tenant and admin',
    description: 'Creates the initial tenant and the first admin user account. Only callable when no tenant-scoped users yet exist (system is uninitialized).',
    tags: ['auth', 'public'],
    request: {
        body: {
            content: {
                'application/json': { schema: SetupSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: AuthResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') }
            },
            description: 'Success'
        },
        403: { description: 'Forbidden: System already initialized' }
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(setupRoute, async (c) => {
    // 1. Safety Check: Only allow if no tenant-scoped users exist.
    // Agent Accounts A1 — global agents (tenant_id IS NULL) are unrelated to
    // first-time tenant initialization, so they must not block setup.
    const db = drizzle(c.env.DB);
    const existingTenantUser = await db.select().from(users).where(sql`${users.tenantId} IS NOT NULL`).limit(1).get();
    if (existingTenantUser) {
        return c.json({ success: false, message: 'System already initialized' }, 409);
    }


    const body = c.req.valid('json');

    // 2. Verification Code Check
    const storedCode = c.env.SETUP_CODE || await c.env.TENANT_CACHE?.get('setup_verification_code');
    if (storedCode && body.verificationCode !== storedCode) {
        return c.json({ success: false, message: 'Invalid verification code' }, 400);
    }


    // 3. Initialize Workspace
    const passwordHash = await c.var.services.auth.hashPassword(body.password);
    const tenantId = c.env.SINGLE_TENANT_ID || '00000000-0000-0000-0000-000000000000';
    const subdomain = body.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    await c.var.services.admin.updateTenantStatus({
        id: tenantId,
        name: body.companyName,
        subdomain,
        status: 'active',
        adminEmail: body.email,
        adminPasswordHash: passwordHash,
        adminName: body.adminName,
    });

    // Cleanup code
    if (c.env.TENANT_CACHE) await c.env.TENANT_CACHE.delete('setup_verification_code');

    // Auto-seed default recommendations library for the new tenant
    try {
        const { RECOMMENDATION_SEEDS } = await import('../data/recommendation-seeds');
        await c.var.services.recommendation.bulkSeed(tenantId, RECOMMENDATION_SEEDS);
    } catch (seedErr) {
        // Don't block setup if seed fails — log and continue
        logger.error('Auto-seed recommendations failed during setup', { tenantId }, seedErr instanceof Error ? seedErr : undefined);
    }

    // Spec 4D — Auto-seed default event types (5 defaults: radon, mold, water, sewer scope, etc.)
    try {
        await c.var.services.event.bulkSeed(tenantId);
    } catch (seedErr) {
        logger.error('Auto-seed event types failed during setup', { tenantId }, seedErr instanceof Error ? seedErr : undefined);
    }

    // Spec 4F — Auto-seed default 6 templates (residential, pre-listing, new-construction, sewer-scope, radon, mold)
    try {
        await c.var.services.templateSeed.bulkSeed(tenantId);
    } catch (seedErr) {
        logger.error('Auto-seed templates failed during setup', { tenantId }, seedErr instanceof Error ? seedErr : undefined);
    }

    // 4. Issue a JWT for the new admin so the caller can authenticate immediately
    const newUser = await db.select().from(users).where(eq(users.email, body.email)).get().catch(() => null);
    if (newUser) {
        const keyring = await c.var.keyringPromise!;
        const now = Math.floor(Date.now() / 1000);
        const token = await signJwt({
            sub: newUser.id,
            'custom:tenantId': newUser.tenantId,
            'custom:userRole': newUser.role,
            role: newUser.role,
            iat: now,
            exp: now + 60 * 60 * 24,
        }, keyring);
        setCookie(c, '__Host-inspector_token', token, authCookieOptions());
    }

    return c.json({
        success: true,
        data: { redirect: '/dashboard' }
    }, 200);
});

const skipSetupRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/setup/skip',
    operationId: 'skipOnboardingWizard',
    summary: 'Skip the onboarding wizard',
    description: 'Marks the in-app onboarding wizard as skipped for the current user. Does not affect tenant-level setup or any system configuration.',
    tags: ['auth'],
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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

coreAuthRoutes.openapi(skipSetupRoute, async (c) => {
    const user = c.get('user');
    if (!user?.sub) throw Errors.Unauthorized('Not signed in');

    const db = drizzle(c.env.DB);
    const me = await db.select().from(users).where(eq(users.id, user.sub)).get();
    const onboardingState = ((me?.onboardingState ?? {}) as Record<string, boolean>);
    onboardingState.skipped = true;

    await db.update(users).set({ onboardingState }).where(eq(users.id, user.sub));

    return c.json({ success: true, data: { skipped: true } }, 200);
});

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

coreAuthRoutes.openapi(meRoute, async (c) => {
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
});

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

coreAuthRoutes.openapi(updateProfileRoute, async (c) => {
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
});

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

coreAuthRoutes.openapi(logoutRoute, async (c) => {
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

    return c.json({ success: true, data: { success: true } }, 200);
});

// ─── Spec 4A — TOTP 2FA endpoints ──────────────────────────────────────────
// All 5 endpoints below were added by Spec 4A. They are additive — no existing
// behaviour was altered beyond the requires2fa branch in the login handler above.

const TOTP_ISSUER = 'OpenInspection';

/** Look up the current user row or 401 if the JWT is missing/stale. */
async function loadCurrentUser(c: Parameters<Parameters<typeof coreAuthRoutes.openapi>[1]>[0]) {
    const userPayload = c.get('user');
    if (!userPayload?.sub) throw Errors.Unauthorized();
    const db = drizzle(c.env.DB);
    const row = await db.select().from(users).where(eq(users.id, userPayload.sub)).get();
    if (!row) throw Errors.Unauthorized();
    return row;
}

const totpSetupRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/2fa/setup',
    operationId: 'beginTotpEnrollment',
    summary: 'Begin TOTP 2FA enrollment',
    description: 'Generates a fresh TOTP secret plus recovery codes and returns the QR data URI. Caller must POST /2fa/verify before 2FA is actually enabled.',
    tags: ['auth'],
    responses: {
        200: { content: { 'application/json': { schema: TotpSetupResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Setup payload' },
        401: { description: 'Unauthorized' },
    }
}, { scopes: [], tier: 'extended' }));

coreAuthRoutes.openapi(totpSetupRoute, async (c) => {
    const me = await loadCurrentUser(c);
    const totpSvc = c.var.services.totp;

    const secret = totpSvc.generateSecret();
    const recoveryCodes = totpSvc.generateRecoveryCodes(8);
    const recoveryHashes = await Promise.all(recoveryCodes.map(rc => totpSvc.hashCode(rc)));
    const otpAuthUrl = totpSvc.buildOtpAuthUrl({ accountName: me.email, issuer: TOTP_ISSUER, secret });
    const qrCodeDataUri = await totpSvc.qrCodeDataUri(otpAuthUrl);

    // Persist the secret + recovery hashes immediately, but keep totpEnabled=false until
    // the user proves they can produce a valid code via /2fa/verify. This way an abandoned
    // setup never locks anyone out.
    const db = drizzle(c.env.DB);
    await db.update(users).set({
        totpSecret: secret,
        totpRecoveryCodes: JSON.stringify(recoveryHashes),
        totpEnabled: false,
        totpVerifiedAt: null,
    }).where(eq(users.id, me.id));

    return c.json({
        success: true,
        data: { secret, qrCodeDataUri, recoveryCodes }
    }, 200);
});

const totpVerifyRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/2fa/verify',
    operationId: 'activateTotp',
    summary: 'Activate TOTP two-factor authentication',
    description: 'Verifies the supplied TOTP code against the pending secret generated by /2fa/setup. On success, flips totpEnabled to true on the user record.',
    tags: ['auth'],
    request: { body: { content: { 'application/json': { schema: TotpVerifySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: '2FA enabled' },
        400: { description: 'Invalid code or no pending secret' },
        401: { description: 'Unauthorized' },
    }
}, { scopes: [], tier: 'extended' }));

coreAuthRoutes.openapi(totpVerifyRoute, async (c) => {
    const me = await loadCurrentUser(c);
    if (!me.totpSecret) throw Errors.BadRequest('No pending 2FA setup. Call /2fa/setup first.');

    const { code } = c.req.valid('json');
    const ok = c.var.services.totp.verifyCode(me.totpSecret, code);
    if (!ok) throw Errors.BadRequest('Invalid verification code');

    const db = drizzle(c.env.DB);
    await db.update(users).set({
        totpEnabled: true,
        totpVerifiedAt: new Date(),
    }).where(eq(users.id, me.id));

    return c.json({ success: true, data: { success: true } }, 200);
});

const totpDisableRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/2fa/disable',
    operationId: 'disableTotp',
    summary: 'Disable TOTP two-factor authentication',
    description: 'Requires both the current password and a valid TOTP or recovery code to disable 2FA. Wipes all 2FA state (secret, enabled flag, recovery codes).',
    tags: ['auth'],
    request: { body: { content: { 'application/json': { schema: TotpDisableSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: '2FA disabled' },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized — wrong password or code' },
    }
}, { scopes: [], tier: 'extended' }));

coreAuthRoutes.openapi(totpDisableRoute, async (c) => {
    const me = await loadCurrentUser(c);
    const { password, code } = c.req.valid('json');

    const [pwOk] = await verifyPassword(password, me.passwordHash);
    if (!pwOk) throw Errors.Unauthorized('Invalid credentials');

    if (!me.totpEnabled || !me.totpSecret) throw Errors.BadRequest('2FA is not enabled');

    const totpSvc = c.var.services.totp;
    let codeOk = totpSvc.verifyCode(me.totpSecret, code);
    let updatedHashes: string[] | null = null;
    if (!codeOk && me.totpRecoveryCodes) {
        const hashes = JSON.parse(me.totpRecoveryCodes) as string[];
        const result = await totpSvc.consumeRecoveryCode(code, hashes);
        codeOk = result.matched;
        if (result.matched) updatedHashes = result.remainingHashes;
    }
    if (!codeOk) throw Errors.Unauthorized('Invalid verification code');

    const db = drizzle(c.env.DB);
    await db.update(users).set({
        totpSecret: null,
        totpEnabled: false,
        totpRecoveryCodes: null,
        totpVerifiedAt: null,
    }).where(eq(users.id, me.id));

    // updatedHashes intentionally discarded — we are wiping all 2FA state anyway.
    void updatedHashes;
    return c.json({ success: true, data: { success: true } }, 200);
});

const totpRegenRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/2fa/recovery-codes/regenerate',
    operationId: 'regenerateTotpRecoveryCodes',
    summary: 'Regenerate 2FA recovery codes',
    description: 'Invalidates all existing 2FA recovery codes and returns a fresh set of eight. Requires the current password plus a valid TOTP or recovery code.',
    tags: ['auth'],
    request: { body: { content: { 'application/json': { schema: TotpRegenerateSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: TotpSetupResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'New recovery codes' },
        401: { description: 'Unauthorized' },
    }
}, { scopes: [], tier: 'extended' }));

coreAuthRoutes.openapi(totpRegenRoute, async (c) => {
    const me = await loadCurrentUser(c);
    const { password, code } = c.req.valid('json');

    const [pwOk] = await verifyPassword(password, me.passwordHash);
    if (!pwOk) throw Errors.Unauthorized('Invalid credentials');

    if (!me.totpEnabled || !me.totpSecret) throw Errors.BadRequest('2FA is not enabled');

    const totpSvc = c.var.services.totp;
    let codeOk = totpSvc.verifyCode(me.totpSecret, code);
    if (!codeOk && me.totpRecoveryCodes) {
        const hashes = JSON.parse(me.totpRecoveryCodes) as string[];
        const result = await totpSvc.consumeRecoveryCode(code, hashes);
        codeOk = result.matched;
        // We are about to overwrite recovery codes wholesale, so consuming the matched code
        // here doesn't need to be persisted separately.
    }
    if (!codeOk) throw Errors.Unauthorized('Invalid verification code');

    const recoveryCodes = totpSvc.generateRecoveryCodes(8);
    const recoveryHashes = await Promise.all(recoveryCodes.map(rc => totpSvc.hashCode(rc)));

    const db = drizzle(c.env.DB);
    await db.update(users).set({
        totpRecoveryCodes: JSON.stringify(recoveryHashes),
    }).where(eq(users.id, me.id));

    // QR code is irrelevant on regenerate; surface an empty string to keep the schema stable.
    return c.json({
        success: true,
        data: { secret: me.totpSecret, qrCodeDataUri: '', recoveryCodes }
    }, 200);
});

const login2faRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/login/2fa',
    operationId: 'completeTwoFactorLogin',
    summary: 'Complete two-factor authentication login',
    description: 'Exchanges a short-lived 2FA challenge token plus TOTP or recovery code for a full session cookie. The challenge token is issued by /login when 2FA is enabled.',
    tags: ['auth', 'public'],
    middleware: [requireCsrfToken],
    request: { body: { content: { 'application/json': { schema: TotpLoginSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: Login2faResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Login complete' },
        401: { description: 'Invalid or expired challenge / code' },
    }
}, { scopes: [], tier: 'excluded' }));

coreAuthRoutes.openapi(login2faRoute, async (c) => {
    await checkRateLimit(c, 'login');

    const { challengeToken, code } = c.req.valid('json');
    const keyring = await c.var.keyringPromise!;

    let payload: Record<string, unknown>;
    try {
        payload = await verifyJwt(challengeToken, keyring);
    } catch {
        throw Errors.Unauthorized('Invalid or expired challenge');
    }
    if (payload['t'] !== 'challenge' || typeof payload['sub'] !== 'string') {
        throw Errors.Unauthorized('Invalid challenge token');
    }
    const userId = payload['sub'] as string;

    const db = drizzle(c.env.DB);
    const me = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!me || !me.totpEnabled || !me.totpSecret) {
        throw Errors.Unauthorized('Invalid challenge token');
    }

    const totpSvc = c.var.services.totp;
    let codeOk = totpSvc.verifyCode(me.totpSecret, code);
    if (!codeOk && me.totpRecoveryCodes) {
        const hashes = JSON.parse(me.totpRecoveryCodes) as string[];
        const result = await totpSvc.consumeRecoveryCode(code, hashes);
        if (result.matched) {
            codeOk = true;
            // Single-use semantics: persist remaining hashes immediately, before we issue
            // the session cookie. If the DB write fails we don't want to grant a session.
            await db.update(users).set({
                totpRecoveryCodes: JSON.stringify(result.remainingHashes),
            }).where(eq(users.id, me.id));
        }
    }
    if (!codeOk) throw Errors.Unauthorized('Invalid verification code');

    const now = Math.floor(Date.now() / 1000);
    const sessionToken = await signJwt({
        sub: me.id,
        'custom:tenantId': me.tenantId,
        'custom:userRole': me.role,
        role: me.role,
        iat: now,
        exp: now + 60 * 60 * 24,
    }, keyring);

    setCookie(c, '__Host-inspector_token', sessionToken, authCookieOptions());
    return c.json({ success: true, data: { redirect: '/dashboard' } }, 200);
});

export default coreAuthRoutes;
