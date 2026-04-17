import { OpenAPIHono } from '@hono/zod-openapi';
import { Context } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { users } from './lib/db/schema';
import * as schema from './lib/db/schema';

import { brandingMiddleware } from './lib/middleware/branding';
import { tenantRouter } from './lib/middleware/tenant-router';
import { diMiddleware } from './lib/middleware/di';
import { requireActiveSubscription } from './lib/middleware/tier-guard';
import { AppError, ErrorCode, Errors } from './lib/errors';
import { sendError } from './lib/response';
import { HonoConfig } from './types/hono';
import { UserRole } from './types/auth';
import { logger } from './lib/logger';

import { HomePage } from './templates/pages/home';
import { LoginPage } from './templates/pages/login';
import { DashboardPage } from './templates/pages/dashboard';
import { SettingsPage } from './templates/pages/settings';
import { PublicBookingPage } from './templates/pages/booking';
import { FormRendererPage } from './templates/pages/form-renderer';
import { AgentDashboardPage } from './templates/pages/agent-dashboard';
import { TemplatesPage } from './templates/pages/templates';
import { TeamPage } from './templates/pages/team';
import { AgreementsPage } from './templates/pages/agreements';
import { SetupPage } from './templates/pages/setup';


import coreAuthRoutes from './api/auth';
import integrationRoutes from './api/integration';
import inspectionsRoutes from './api/inspections';
import aiRoutes from './api/ai';
import bookingsRoutes from './api/bookings';
import adminRoutes from './api/admin';
import agentRoutes from './api/agent';
import availabilityRoutes from './api/availability';
import calendarRoutes from './api/calendar';
import teamRoutes from './api/team';

const app = new OpenAPIHono<HonoConfig>();

// Global request logger
app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    logger.info('Request processed', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration: `${duration}ms`,
        tenantId: c.get('tenantId'), // Might be unset but that's okay
    });
});

// Health check
app.get('/status', (c) => c.json({ status: 'Core Engine Online', timestamp: new Date().toISOString() }));


/**
 * Global Error Handler
 * Standardizes all application errors into a JSON response.
 */
app.onError((err: unknown, c: Context<HonoConfig>) => {
    // Robust check for AppError or any object carrying a status and code
    const isAppError = err instanceof AppError || (
        typeof err === 'object' && err !== null &&
        'status' in err && typeof (err as Record<string, unknown>).status === 'number' &&
        'code' in err && typeof (err as Record<string, unknown>).code === 'string'
    );

    if (isAppError) {
        const appErr = err as Record<string, unknown>;
        const status = appErr.status as number;
        return sendError(c, appErr.message as string, appErr.code as string, status as 500, appErr.details as Record<string, unknown> | undefined);
    }

    logger.error('Unhandled application error', {
        method: c.req.method,
        url: c.req.url,
    }, err instanceof Error ? err : undefined);

    return sendError(c, 'Internal server error', ErrorCode.INTERNAL_ERROR, 500);
});

// Static assets
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const staticOpts = (opts: Record<string, string>): any => opts;
app.get('/static/*', serveStatic(staticOpts({ root: './' })));
app.get('/favicon.png', serveStatic(staticOpts({ path: './favicon.png' })));
app.get('/logo.png', serveStatic(staticOpts({ path: './logo.png' })));
app.get('/styles.css', serveStatic(staticOpts({ path: './styles.css' })));
app.get('/manifest.json', serveStatic(staticOpts({ path: './manifest.json' })));
app.get('/sw.js', serveStatic(staticOpts({ path: './sw.js' })));
app.get('/js/*', serveStatic(staticOpts({ root: './' })));

// Global Middlewares
app.use('*', diMiddleware);
app.use('*', tenantRouter);
app.use('*', brandingMiddleware);

// Global JWT Middleware — extracts tenantId / userRole from Bearer token or cookie.
app.use('*', async (c, next) => {
    const path = c.req.path;
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup';
    const isPublic = path.startsWith('/api/public/') || path.startsWith('/api/integration/') || path === '/book' || path === '/' || path === '/status' || path.startsWith('/static/') || path.includes('.');

    if (isAuthPublic || isPublic || path === '/setup' || path === '/login' || path === '/join') return next();

    // Generate setup code if system is uninitialized and we are in standalone
    if (c.env.APP_MODE === 'standalone' && c.env.TENANT_CACHE) {
        // Prefer explicit environment variable if set by user during deployment
        const storedCode = c.env.SETUP_CODE || await c.env.TENANT_CACHE.get('setup_verification_code');

        if (!storedCode) {
            const db = drizzle(c.env.DB);
            const user = await db.select().from(users).limit(1).get();
            if (!user) {
                const newCode = Math.floor(100000 + Math.random() * 900000).toString();
                await c.env.TENANT_CACHE.put('setup_verification_code', newCode, { expirationTtl: 3600 });
                logger.warn('New system detected. System initialization code generated.', { code: newCode });
                logger.info(`Initialization Code Required: ${newCode}`);
            }
        } else if (c.env.SETUP_CODE) {
             // Just log that we are using the user-defined code
             const db = drizzle(c.env.DB);
             const user = await db.select().from(users).limit(1).get();
             if (!user) {
                 logger.info('System initialization required. Using user-defined SETUP_CODE.');
             }
        }
    }

    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : getCookie(c, 'inspector_token');

    if (!token) return next();

    try {
        const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
        const tenantId = (payload['custom:tenantId'] ?? payload['tenantId']) as string | undefined;
        const userRole = (payload['custom:userRole'] ?? payload['role']) as string | undefined;

        if (tenantId) c.set('tenantId', tenantId);
        if (userRole) c.set('userRole', userRole as UserRole);

        // Also update user object in context if needed
        if (userRole) {
            c.set('user', {
                sub: payload.sub as string,
                email: payload.email as string,
                role: userRole as UserRole,
                tenantId: tenantId as string
            });
        }

    } catch (err: unknown) {
        // Invalid token — we don't throw here to allow public routes to work
        // but the absence of tenantId/userRole will be caught by route-level guards.
        const message = err instanceof Error ? err.message : String(err);
        logger.info(`[JWT] Token verification failed: ${message}`);
    }

    // --- Tenant Isolation Guard (Fail-Fast) ---
    // In SaaS mode, strictly verify that the token's tenant matches the requested subdomain's tenant.
    if (c.env.APP_MODE === 'saas') {
        const tokenTenantId = c.get('tenantId');
        const resolvedTenantId = c.get('resolvedTenantId');

        // If both are present and they DON'T match, it's a cross-tenant breach attempt.
        if (tokenTenantId && resolvedTenantId && tokenTenantId !== resolvedTenantId) {
            logger.warn(`[Guard] BLOCKING cross-tenant access: Token(${tokenTenantId}) -> Host(${resolvedTenantId})`);
            logger.error('Cross-tenant access attempt blocked', {
                tokenTenantId,
                requestedTenantId: resolvedTenantId,
                path: c.req.path
            });
            throw Errors.Forbidden('Access denied: cross-tenant authorization failure.');
        }
    }


    // --- Scoped DB Injection ---
    const tenantIdForDb = c.get('tenantId') || c.get('resolvedTenantId');
    if (tenantIdForDb) {
        const { createScopedDb } = await import('./lib/db/scoped');
        const db = drizzle(c.env.DB);
        c.set('sdb', createScopedDb(db as unknown as ReturnType<typeof drizzle<typeof schema>>, tenantIdForDb));
    }

    return next();
});

// API Routes
app.use('/api/*', requireActiveSubscription);

// Module Routes
// Mount auth routes at canonical API path AND at root so that /setup, /login (POST), /join (POST) work without redirects
app.route('/api/auth', coreAuthRoutes);
app.route('/', coreAuthRoutes);
app.route('/api/inspections', inspectionsRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/public', bookingsRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/agent', agentRoutes);
app.route('/api/availability', availabilityRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/team', teamRoutes);
app.route('/api/integration', integrationRoutes);

// OpenAPI Documentation
app.doc('/doc', {
    openapi: '3.0.0',
    info: {
        version: '1.0.0-rc.1',
        title: 'OpenInspection Core API',
        description: 'Advanced property inspection platform API documentation.'
    },
});

// Swagger UI
app.get('/ui', (c) => {
    return c.html(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Swagger UI</title>
            <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
        </head>
        <body>
            <div id="swagger-ui"></div>
            <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
            <script>
                window.onload = () => {
                    window.ui = SwaggerUIBundle({
                        url: '/doc',
                        dom_id: '#swagger-ui',
                    });
                };
            </script>
        </body>
        </html>
    `);
});

// View Handlers
app.get('/login', (c) => {
    const branding = c.get('branding');
    return c.html(LoginPage({ branding }));
});

app.get('/setup', (c) => {
    return c.html(SetupPage({ branding: c.get('branding') }));
});


app.get('/book', (c) => {
    const branding = c.get('branding');
    return c.html(PublicBookingPage({ siteKey: c.env.TURNSTILE_SITE_KEY, branding }));
});

// HTML Auth Guard Middleware
const htmlAuthGuard = (allowedRoles?: string[]) => {
    return async (c: Context<HonoConfig>, next: () => Promise<void>) => {
        const userRole = c.get('userRole');
        if (!userRole) return c.redirect('/login');
        
        if (allowedRoles && !allowedRoles.includes(userRole)) {
            return c.redirect('/dashboard?error=unauthorized_role');
        }
        
        return await next();
    };
};

// Pages with Auth
app.get('/dashboard', htmlAuthGuard(), (c) => c.html(DashboardPage({ branding: c.get('branding') })));
app.get('/agent-dashboard', htmlAuthGuard(['agent']), (c) => c.html(AgentDashboardPage({ branding: c.get('branding') })));
app.get('/templates', htmlAuthGuard(['owner', 'admin']), (c) => c.html(TemplatesPage({ branding: c.get('branding') })));
app.get('/settings', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsPage({ branding: c.get('branding') })));
app.get('/team', htmlAuthGuard(['owner', 'admin']), (c) => c.html(TeamPage({ branding: c.get('branding') })));
app.get('/agreements', htmlAuthGuard(['owner', 'admin', 'agent']), (c) => c.html(AgreementsPage({ branding: c.get('branding') })));

// Field Inspection Form - Strictly for Inspectors
app.get('/inspections/:id/form', htmlAuthGuard(['inspector']), (c) => {
    const id = c.req.param('id');
    const branding = c.get('branding');
    if (!id) return c.redirect('/dashboard');
    return c.html(FormRendererPage({ inspectionId: id, branding }));
});

app.get('/', (c) => {
    const isStandalone = c.env.APP_MODE === 'standalone';
    const requestedSubdomain = c.get('requestedSubdomain');
    
    // In standalone mode or when a specific tenant is identified, go to dashboard
    if (isStandalone || (requestedSubdomain && requestedSubdomain !== 'www' && requestedSubdomain !== 'dev')) {
        return c.redirect('/dashboard');
    }
    
    return c.html(HomePage({ branding: c.get('branding') }));
});

export default app;
