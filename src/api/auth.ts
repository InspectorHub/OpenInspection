import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../lib/db/schema';
import { sign } from 'hono/jwt';
import { setCookie, deleteCookie } from 'hono/cookie';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { requireCsrfToken } from '../lib/middleware/csrf';
import {
    LoginSchema,
    ChangePasswordSchema,
    JoinTeamSchema,
    ForgotPasswordSchema,
    ResetPasswordSchema,
    AuthResponseSchema,
    SuccessResponseSchema,
    SetupSchema
} from '../lib/validations/auth.schema';
import { createApiResponseSchema } from '../lib/validations/shared.schema';

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
    const body = c.req.valid('json');
    const user = await c.var.services.auth.validateCredentials(body.email, body.password);

    const secret = requireJwtSecret(c.env.JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
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
    const body = c.req.valid('json');
    const resetToken = await c.var.services.auth.createPasswordResetToken(body.email);
    
    if (!resetToken) return c.json({ success: true, data: { success: true } }, 200);

    const baseUrl = c.env.APP_BASE_URL || 'http://localhost:8788';
    const resetLink = `${baseUrl}/login?reset_token=${resetToken}`;

    if (c.env.RESEND_API_KEY && !c.env.RESEND_API_KEY.includes('your_api_key')) {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.env.RESEND_API_KEY}` },
            body: JSON.stringify({
                from: c.env.SENDER_EMAIL || `${c.env.APP_NAME} <noreply@example.com>`,
                to: [body.email],
                subject: 'Reset your password',
                html: `<p>Click the link below to reset your ${c.env.APP_NAME} password. This link expires in 1 hour.</p>
                       <p><a href="${resetLink}" style="background:#4f46e5;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">Reset Password</a></p>
                       <p style="font-size:12px;color:#999;">If you didn't request this, ignore this email. Link: ${resetLink}</p>`
            })
        }).catch(e => console.error('Reset email error:', e));
    }

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
                            role: z.string()
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
    const row = await db.select({ email: users.email }).from(users).where(eq(users.id, user.sub)).get();

    return c.json({
        success: true,
        data: {
            user: {
                id: user.sub,
                email: row?.email,
                tenantId: c.get('tenantId'),
                role: c.get('userRole')
            }
        }
    }, 200);
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

    return c.json({ success: true, data: { success: true } }, 200);
});

export default coreAuthRoutes;
