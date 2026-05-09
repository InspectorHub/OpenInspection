import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../lib/db/schema';
import { sign, verify } from 'hono/jwt';
import { setCookie, deleteCookie } from 'hono/cookie';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { getBaseUrl } from '../lib/url';
import { checkRateLimit } from '../lib/rate-limit';
import { requireCsrfToken } from '../lib/middleware/csrf';
import { requireRole } from '../lib/middleware/rbac';
import { verifyPassword } from '../lib/password';
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

/**
 * Require a strong JWT_SECRET (≥32 chars) before signing/verifying anything.
 * Fail-closed if missing or too weak to resist offline brute-force.
 */
function requireJwtSecret(secret: string | undefined): string {
    if (!secret || secret.length < 32) {
        throw Errors.Internal('Server configuration error');
    }
    return secret;
}

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

const loginRoute = createRoute({
    method: 'post',
    path: '/login',
    summary: 'User Login',
    description: 'Validates credentials and sets a JWT cookie.',
    middleware: [requireCsrfToken],
    request: {
        body: {
            content: {
                'application/json': { schema: LoginSchema }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: AuthResponseSchema }
            },
            description: 'Login successful'
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' }
    }
});

coreAuthRoutes.openapi(loginRoute, async (c) => {
    await checkRateLimit(c, 'login');

    const body = c.req.valid('json');
    const user = await c.var.services.auth.validateCredentials(body.email, body.password);

    const secret = requireJwtSecret(c.env.JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);

    // Spec 4A — If the user has 2FA enabled, return a short-lived challenge token instead of
    // the session JWT. The client must POST it back along with a TOTP code to /api/auth/login/2fa
    // before any session is granted.
    if (user.totpEnabled) {
        const challengeToken = await sign({
            sub: user.id,
            t: 'challenge',
            iat: now,
            exp: now + 60 * 5,
        }, secret, 'HS256');
        // Intentionally NOT a Set-Cookie — challenge tokens travel JSON-only so a stolen
        // session cookie alone never permits 2FA bypass.
        return c.json({
            success: true,
            data: { requires2fa: true, challengeToken }
        }, 200);
    }

    // Email is intentionally NOT in the payload — JWTs are signed but not encrypted, and the
    // token travels through logs / intermediaries. PII belongs in the DB, not in the bearer.
    const token = await sign({
        sub: user.id,
        'custom:tenantId': user.tenantId,
        'custom:userRole': user.role,
        role: user.role,
        iat: now,
        exp: now + 60 * 60 * 24,
    }, secret, 'HS256');

    setCookie(c, '__Host-inspector_token', token, authCookieOptions());

    // Intentionally do NOT return the token in the body. Browser clients authenticate via the
    // HttpOnly cookie. Exposing the raw JWT in JSON invites clients to persist it in localStorage
    // or a JS-readable cookie, which defeats HttpOnly and widens the XSS blast radius.
    return c.json({
        success: true,
        data: { redirect: '/dashboard' }
    }, 200);
});

const changePasswordRoute = createRoute({
    method: 'post',
    path: '/change-password',
    summary: 'Change Password',
    description: 'Updates an authenticated user\'s password.',
    request: {
        body: {
            content: {
                'application/json': { schema: ChangePasswordSchema }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema }
            },
            description: 'Password updated'
        },
        401: { description: 'Unauthorized' }
    }
});

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

const joinTeamRoute = createRoute({
    method: 'post',
    path: '/join',
    summary: 'Join Team',
    description: 'Finalizes team invitation and account creation.',
    request: {
        body: {
            content: {
                'application/json': { schema: JoinTeamSchema }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: AuthResponseSchema }
            },
            description: 'Team joined successfully'
        }
    }
});

coreAuthRoutes.openapi(joinTeamRoute, async (c) => {
    const body = c.req.valid('json');
    const user = await c.var.services.auth.joinTeam(body.token, body.password);

    const secret = requireJwtSecret(c.env.JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const token = await sign({
        sub: user.id,
        'custom:tenantId': user.tenantId,
        'custom:userRole': user.role,
        role: user.role,
        iat: now,
        exp: now + 60 * 60 * 24,
    }, secret, 'HS256');

    setCookie(c, '__Host-inspector_token', token, authCookieOptions());

    return c.json({
        success: true,
        data: { redirect: '/dashboard' }
    }, 200);
});

const forgotPasswordRoute = createRoute({
    method: 'post',
    path: '/forgot-password',
    summary: 'Forgot Password',
    description: 'Triggers a password reset email.',
    request: {
        body: {
            content: {
                'application/json': { schema: ForgotPasswordSchema }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema }
            },
            description: 'Reset email sent (if user exists)'
        }
    }
});

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

const resetPasswordRoute = createRoute({
    method: 'post',
    path: '/reset-password',
    summary: 'Reset Password',
    description: 'Processes a password reset request.',
    request: {
        body: {
            content: {
                'application/json': { schema: ResetPasswordSchema }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema }
            },
            description: 'Password reset successful'
        }
    }
});

coreAuthRoutes.openapi(resetPasswordRoute, async (c) => {
    const body = c.req.valid('json');
    await c.var.services.auth.resetPassword(body.token, body.newPassword);
    return c.json({ success: true, data: { success: true } }, 200);
});

const setupRoute = createRoute({
    method: 'post',
    path: '/setup',
    summary: 'System Initialization',
    description: 'Creates the initial tenant and admin account. Only active if no users exist.',
    request: {
        body: {
            content: {
                'application/json': { schema: SetupSchema }
            }
        }
    },
    responses: {
        200: {
            content: {
                'application/json': { schema: AuthResponseSchema }
            },
            description: 'Success'
        },
        403: { description: 'Forbidden: System already initialized' }
    }
});

coreAuthRoutes.openapi(setupRoute, async (c) => {
    // 1. Safety Check: Only allow if no users exist
    const db = drizzle(c.env.DB);
    const existingUser = await db.select().from(users).limit(1).get();
    if (existingUser) {
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
        adminPasswordHash: passwordHash
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
        const secret = requireJwtSecret(c.env.JWT_SECRET);
        const now = Math.floor(Date.now() / 1000);
        const token = await sign({
            sub: newUser.id,
            'custom:tenantId': newUser.tenantId,
            'custom:userRole': newUser.role,
            role: newUser.role,
            iat: now,
            exp: now + 60 * 60 * 24,
        }, secret, 'HS256');
        setCookie(c, '__Host-inspector_token', token, authCookieOptions());
    }

    return c.json({
        success: true,
        data: { redirect: '/dashboard' }
    }, 200);
});

const skipSetupRoute = createRoute({
    method: 'post',
    path: '/setup/skip',
    summary: 'Skip Onboarding Wizard',
    description: 'Marks the onboarding wizard as skipped for the current user.',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema }
            },
            description: 'Onboarding marked as skipped'
        },
        401: { description: 'Unauthorized' }
    }
});

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

const meRoute = createRoute({
    method: 'get',
    path: '/me',
    summary: 'Get Current User Profile',
    description: 'Returns the current user session information.',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        user: z.object({
                            id: z.string(),
                            email: z.string().optional(),
                            tenantId: z.string().optional(),
                            role: z.string(),
                            onboardingState: z.record(z.string(), z.boolean()).nullable().optional(),
                            totpEnabled: z.boolean().optional(),
                            recoveryCodesRemaining: z.number().nullable().optional(),
                        })
                    }))
                }
            },
            description: 'Success'
        },
        401: { description: 'Unauthorized' }
    }
});

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
const updateProfileRoute = createRoute({
    method: 'patch',
    path: '/profile',
    summary: 'Update Profile',
    description: 'Update the current user\'s profile (name, phone, license number).',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().max(100).optional(),
                        phone: z.string().max(30).optional(),
                        licenseNumber: z.string().max(50).optional(),
                    })
                }
            }
        }
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Profile updated'
        },
        401: { description: 'Unauthorized' }
    }
});

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

const logoutRoute = createRoute({
    method: 'post',
    path: '/logout',
    summary: 'Log Out',
    description: 'Clears the auth cookie and revokes outstanding JWTs for this user.',
    responses: {
        200: {
            content: {
                'application/json': { schema: SuccessResponseSchema }
            },
            description: 'Logout successful'
        }
    }
});

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

const totpSetupRoute = createRoute({
    method: 'post',
    path: '/2fa/setup',
    summary: 'Begin TOTP 2FA enrollment',
    description: 'Generates a fresh secret + recovery codes and returns the QR data URI. Caller must POST /2fa/verify before 2FA is actually enabled.',
    responses: {
        200: { content: { 'application/json': { schema: TotpSetupResponseSchema } }, description: 'Setup payload' },
        401: { description: 'Unauthorized' },
    }
});

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

const totpVerifyRoute = createRoute({
    method: 'post',
    path: '/2fa/verify',
    summary: 'Activate TOTP 2FA',
    description: 'Verifies the supplied code against the pending secret. On success, sets totpEnabled=true.',
    request: { body: { content: { 'application/json': { schema: TotpVerifySchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: '2FA enabled' },
        400: { description: 'Invalid code or no pending secret' },
        401: { description: 'Unauthorized' },
    }
});

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

const totpDisableRoute = createRoute({
    method: 'post',
    path: '/2fa/disable',
    summary: 'Disable TOTP 2FA',
    description: 'Requires both the current password and a valid TOTP / recovery code. Wipes all 2FA state.',
    request: { body: { content: { 'application/json': { schema: TotpDisableSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: '2FA disabled' },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized — wrong password or code' },
    }
});

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

const totpRegenRoute = createRoute({
    method: 'post',
    path: '/2fa/recovery-codes/regenerate',
    summary: 'Regenerate recovery codes',
    description: 'Invalidates all existing recovery codes and returns a fresh set. Requires password + 2FA code.',
    request: { body: { content: { 'application/json': { schema: TotpRegenerateSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: TotpSetupResponseSchema } }, description: 'New recovery codes' },
        401: { description: 'Unauthorized' },
    }
});

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

const login2faRoute = createRoute({
    method: 'post',
    path: '/login/2fa',
    summary: 'Complete 2FA login',
    description: 'Exchanges a short-lived challenge token + TOTP code for a session cookie.',
    middleware: [requireCsrfToken],
    request: { body: { content: { 'application/json': { schema: TotpLoginSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: Login2faResponseSchema } }, description: 'Login complete' },
        401: { description: 'Invalid or expired challenge / code' },
    }
});

coreAuthRoutes.openapi(login2faRoute, async (c) => {
    await checkRateLimit(c, 'login');

    const { challengeToken, code } = c.req.valid('json');
    const secret = requireJwtSecret(c.env.JWT_SECRET);

    let payload: Record<string, unknown>;
    try {
        payload = await verify(challengeToken, secret, 'HS256') as Record<string, unknown>;
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
    const sessionToken = await sign({
        sub: me.id,
        'custom:tenantId': me.tenantId,
        'custom:userRole': me.role,
        role: me.role,
        iat: now,
        exp: now + 60 * 60 * 24,
    }, secret, 'HS256');

    setCookie(c, '__Host-inspector_token', sessionToken, authCookieOptions());
    return c.json({ success: true, data: { redirect: '/dashboard' } }, 200);
});

export default coreAuthRoutes;
