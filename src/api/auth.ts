import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../lib/db/schema';
import { sign, verify } from 'hono/jwt';
import { getCookie, setCookie } from 'hono/cookie';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
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
 * Interface for the decoded JWT payload.
 */
export interface AuthPayload {
    sub: string;
    email: string;
    'custom:tenantId': string;
    'custom:userRole': string;
    role: string;
    exp: number;
}

const coreAuthRoutes = new OpenAPIHono<HonoConfig>();

// --- Routes ---

const loginRoute = createRoute({
    method: 'post',
    path: '/login',
    summary: 'User Login',
    description: 'Validates credentials and sets a JWT cookie.',
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

    const now = Math.floor(Date.now() / 1000);
    const token = await sign({
        sub: user.id,
        email: user.email,
        'custom:tenantId': user.tenantId,
        'custom:userRole': user.role,
        role: user.role,
        exp: now + 60 * 60 * 24,
    }, c.env.JWT_SECRET, 'HS256');

    setCookie(c, 'inspector_token', token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 24,
    });

    return c.json({
        success: true,
        data: { token, redirect: '/dashboard' }
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
    const rawToken = getCookie(c, 'inspector_token') || c.req.header('Authorization')?.replace('Bearer ', '');
    if (!rawToken) throw Errors.Unauthorized();

    const payload = await verify(rawToken, c.env.JWT_SECRET, 'HS256') as unknown as AuthPayload;
    if (!payload.sub) throw Errors.Unauthorized();

    const body = c.req.valid('json');
    await c.var.services.auth.updatePassword(payload.sub, body.currentPassword, body.newPassword);
    
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

    const now = Math.floor(Date.now() / 1000);
    const token = await sign({
        sub: user.id,
        email: user.email,
        'custom:tenantId': user.tenantId,
        'custom:userRole': user.role,
        role: user.role,
        exp: now + 60 * 60 * 24,
    }, c.env.JWT_SECRET);

    setCookie(c, 'inspector_token', token, {
        httpOnly: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 24,
    });

    return c.json({
        success: true,
        data: { token, redirect: '/dashboard' }
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

    const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
    const host = c.req.header('host');
    const resetLink = `${protocol}://${host}/login?reset_token=${resetToken}`;

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
    let token = '';
    if (newUser && c.env.JWT_SECRET) {
        const now = Math.floor(Date.now() / 1000);
        token = await sign({
            sub: newUser.id,
            email: newUser.email,
            'custom:tenantId': newUser.tenantId,
            'custom:userRole': newUser.role,
            role: newUser.role,
            exp: now + 60 * 60 * 24,
        }, c.env.JWT_SECRET, 'HS256');
        setCookie(c, 'inspector_token', token, {
            httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24,
        });
    }

    return c.json({
        success: true,
        token,
        data: { token, redirect: '/dashboard' }
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
    return c.json({
        success: true,
        data: {
            user: {
                id: c.get('tenantId'), // Simplified for verification: returning tenantId as a proxy for 'me'
                tenantId: c.get('tenantId'),
                role: c.get('userRole')
            }
        }
    }, 200);
});

export default coreAuthRoutes;
