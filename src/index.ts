import { OpenAPIHono } from '@hono/zod-openapi';
import { Context } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { deleteCookie, getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { users } from './lib/db/schema';
import * as schema from './lib/db/schema';

import { brandingMiddleware } from './lib/middleware/branding';
import { tenantRouter } from './lib/middleware/tenant-router';
import { diMiddleware } from './lib/middleware/di';
import { requireActiveSubscription } from './lib/middleware/tier-guard';
import { securityHeaders } from './lib/middleware/security-headers';
import { issueCsrfCookie } from './lib/middleware/csrf';
import { AppError, ErrorCode, Errors } from './lib/errors';
import { sendError } from './lib/response';
import { HonoConfig } from './types/hono';
import { UserRole } from './types/auth';
import { logger } from './lib/logger';
import { BUILD } from './generated/version';

import { LoginPage } from './templates/pages/login';
import { DashboardPage } from './templates/pages/dashboard';
import { SettingsPage } from './templates/pages/settings';
import { PublicBookingPage } from './templates/pages/booking';
import { FormRendererPage } from './templates/pages/form-renderer';
import { AgentDashboardPage } from './templates/pages/agent-dashboard';
import { TemplatesPage } from './templates/pages/templates';
import { TemplateEditorPage } from './templates/pages/template-editor';
import { MarketplacePage } from './templates/pages/marketplace';
import { TeamPage } from './templates/pages/team';
import { AgreementsPage } from './templates/pages/agreements';
import { AgreementSignPage } from './templates/pages/agreement-sign';
import { CalendarPage } from './templates/pages/calendar';
import { ContactsPage } from './templates/pages/contacts';
import { InvoicesPage } from './templates/pages/invoices';
import { SetupPage } from './templates/pages/setup';
import { ReportCardStackPage } from './templates/pages/report-card-stack';
import { InspectionEditPage } from './templates/pages/inspection-edit';
import { SettingsAutomationsPage } from './templates/pages/settings-automations';
import { MetricsPage } from './templates/pages/metrics';
import { SettingsDataPage } from './templates/pages/settings-data';


import coreAuthRoutes from './api/auth';
import integrationRoutes from './api/integration';
import inspectionsRoutes from './api/inspections';
import aiRoutes from './api/ai';
import bookingsRoutes from './api/bookings';
import adminRoutes from './api/admin';
import agentRoutes from './api/agent';
import availabilityRoutes from './api/availability';
import calendarRoutes from './api/calendar';
import calendarEventsRoutes from './api/calendar-events';
import teamRoutes from './api/team';
import contactRoutes from './api/contacts';
import invoiceRoutes from './api/invoices';
import servicesRoutes from './api/services';
import automationsRoutes from './api/automations';
import metricsRoutes from './api/metrics';
import marketplaceRoutes from './api/marketplace';
import dataRoutes from './api/data';
import icsRoutes from './api/ics';

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
app.get('/status', (c) => c.json({
    status: 'ok',
    app: 'openinspection-core',
    commit: BUILD.shortCommit,
    branch: BUILD.branch,
    buildTime: BUILD.buildTime,
    timestamp: new Date().toISOString(),
}));


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

    // Strip the query string before logging so one-shot secrets in URLs (e.g. ?reset_token=…)
    // don't get captured by downstream log sinks.
    const pathOnly = c.req.url.split('?')[0];
    logger.error('Unhandled application error', {
        method: c.req.method,
        url: pathOnly,
    }, err instanceof Error ? err : undefined);

    return sendError(c, 'Internal server error', ErrorCode.INTERNAL_ERROR, 500);
});

// Static assets
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const staticOpts = (opts: Record<string, string>): any => opts;
app.get('/static/*', serveStatic(staticOpts({ root: './' })));
app.get('/favicon.svg', serveStatic(staticOpts({ path: './favicon.svg' })));
app.get('/logo.svg', serveStatic(staticOpts({ path: './logo.svg' })));
app.get('/styles.css', serveStatic(staticOpts({ path: './styles.css' })));
app.get('/manifest.json', serveStatic(staticOpts({ path: './manifest.json' })));
app.get('/sw.js', serveStatic(staticOpts({ path: './sw.js' })));
app.get('/js/*', serveStatic(staticOpts({ root: './' })));
app.get('/css/*', serveStatic(staticOpts({ root: './' })));
app.get('/vendor/*', serveStatic(staticOpts({ root: './' })));
app.get('/fonts.css', serveStatic(staticOpts({ path: './fonts.css' })));
app.get('/fonts/*', serveStatic(staticOpts({ root: './' })));

// Global Middlewares
app.use('*', securityHeaders);
app.use('*', diMiddleware);
app.use('*', tenantRouter);
app.use('*', brandingMiddleware);

// Static asset extensions — these bypass JWT verification. We use a strict allowlist
// rather than path.includes('.') so a dot inside a path segment (e.g. "/inspections/foo.bar")
// can't trick the middleware into treating a protected route as public.
const STATIC_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|pdf)$/i;

// Global JWT Middleware — extracts tenantId / userRole from Bearer token or cookie.
app.use('*', async (c, next) => {
    const path = c.req.path;
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup';
    const isPublic = path.startsWith('/api/public/') || path.startsWith('/api/integration/') || path.startsWith('/api/ics/') || path === '/book' || path === '/' || path === '/status' || path.startsWith('/static/') || path.startsWith('/report/') || path.startsWith('/agreements/sign/') || STATIC_ASSET_EXT.test(path);

    if (isAuthPublic || isPublic || path === '/setup' || path === '/login' || path === '/join' || path.startsWith('/agreements/sign/')) return next();

    // Generate setup code if system is uninitialized and we are in standalone
    if (c.env.APP_MODE === 'standalone' && c.env.TENANT_CACHE) {
        // Prefer explicit environment variable if set by user during deployment
        const storedCode = c.env.SETUP_CODE || await c.env.TENANT_CACHE.get('setup_verification_code');

        if (!storedCode) {
            const db = drizzle(c.env.DB);
            const user = await db.select().from(users).limit(1).get();
            if (!user) {
                // Use CSPRNG instead of Math.random so the one-hour bootstrap code isn't predictable.
                const rand = crypto.getRandomValues(new Uint32Array(1))[0];
                const newCode = (100000 + (rand % 900000)).toString();
                await c.env.TENANT_CACHE.put('setup_verification_code', newCode, { expirationTtl: 3600 });
                logger.warn('New system detected. System initialization code generated.');
                logger.info('Initialization code stored in KV. Use SETUP_CODE env var in production.');
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
        : getCookie(c, '__Host-inspector_token');

    if (!token) return next();

    // Fail closed if the signing key is missing or too weak to meaningfully resist offline brute force.
    if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
        logger.error('JWT_SECRET is missing or shorter than 32 characters; refusing to verify tokens');
        throw Errors.Internal('Server configuration error');
    }

    try {
        // Decode header first so we can reject non-JWT-typed tokens before spending CPU on
        // signature verification.
        const headerPart = token.split('.')[0];
        if (headerPart) {
            try {
                const header = JSON.parse(atob(headerPart.replace(/-/g, '+').replace(/_/g, '/')));
                if (header.typ && header.typ !== 'JWT') {
                    throw Errors.Unauthorized('Unsupported token type');
                }
            } catch (err) {
                if (err instanceof AppError) throw err;
                // Malformed header — fall through to verify() which will reject.
            }
        }

        const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
        const tenantId = (payload['custom:tenantId'] ?? payload['tenantId']) as string | undefined;
        const userRole = (payload['custom:userRole'] ?? payload['role']) as string | undefined;
        const userId = payload.sub as string | undefined;
        const tokenIat = payload.iat as number | undefined;

        // Reject tokens issued before the user's last password change / reset.
        if (userId && c.env.TENANT_CACHE) {
            const invalidatedAt = await c.env.TENANT_CACHE.get(`pwchanged:${userId}`);
            if (invalidatedAt) {
                const invalidatedTs = parseInt(invalidatedAt, 10);
                if (!tokenIat || tokenIat < invalidatedTs) {
                    throw Errors.Unauthorized('Token has been invalidated');
                }
            }
        }

        if (tenantId) c.set('tenantId', tenantId);
        if (userRole) c.set('userRole', userRole as UserRole);

        // Populate the per-request user context. Email is intentionally not carried in the JWT
        // anymore — routes that need it (e.g. /me) look it up from the DB.
        if (userRole) {
            c.set('user', {
                sub: payload.sub as string,
                role: userRole as UserRole,
                tenantId: tenantId as string
            });
        }

    } catch (err: unknown) {
        // Clear the bad cookie so the browser stops re-sending it on every request.
        deleteCookie(c, '__Host-inspector_token', { path: '/', secure: true, sameSite: 'Strict' });
        if (err instanceof AppError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.info(`[JWT] Token verification failed: ${message}`);
        throw Errors.Unauthorized('Invalid or expired token');
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
// Mount /api/calendar/events BEFORE /api/calendar so the more-specific path takes precedence.
app.route('/api/calendar/events', calendarEventsRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/team', teamRoutes);
app.route('/api/contacts', contactRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/services', servicesRoutes);
app.route('/api/automations', automationsRoutes);
app.route('/api/metrics', metricsRoutes);
app.route('/api/templates/marketplace', marketplaceRoutes);
app.route('/api/data', dataRoutes);
app.route('/api/integration', integrationRoutes);
app.route('/api/ics', icsRoutes);

// OpenAPI Documentation
app.doc('/doc', {
    openapi: '3.0.0',
    info: {
        version: '1.0.0-rc.1',
        title: 'OpenInspection Core API',
        description: 'Advanced property inspection platform API documentation.'
    },
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

// Swagger UI (owner/admin only)
app.get('/ui', htmlAuthGuard(['owner', 'admin']), (c) => {
    return c.html(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Swagger UI</title>
            <link rel="stylesheet" href="/vendor/swagger-ui.css" />
        </head>
        <body>
            <div id="swagger-ui"></div>
            <script src="/vendor/swagger-ui-bundle.js" crossorigin></script>
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
app.get('/login', async (c) => {
    // If user is already authenticated, redirect to dashboard
    const token = getCookie(c, '__Host-inspector_token');
    if (token && c.env.JWT_SECRET) {
        try {
            await verify(token, c.env.JWT_SECRET, 'HS256');
            return c.redirect('/dashboard');
        } catch {
            // Invalid/expired token — show login page
        }
    }
    // Issue the CSRF cookie before rendering so the form's submit handler can echo it back.
    issueCsrfCookie(c);
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

// Public agreement signing page (no auth required — token is the secret)
app.get('/agreements/sign/:token', async (c) => {
    const token = c.req.param('token') as string;
    const branding = c.get('branding');
    try {
        const svc = c.var.services.agreement;
        const { request, agreement } = await svc.getAgreementByToken(token);
        await svc.markViewed(token);

        // Best-effort fetch of linked inspection + inspector for placeholder substitution.
        // Scoped to the request's tenantId — public token is the secret, but we still
        // refuse to leak data across tenants.
        const vars: { client_name?: string; property_address?: string; inspection_date?: string; inspector_name?: string } = {
            client_name: request.clientName ?? '',
        };
        if (request.inspectionId) {
            try {
                const db = drizzle(c.env.DB, { schema });
                const insp = await db.select().from(schema.inspections)
                    .where(and(eq(schema.inspections.id, request.inspectionId), eq(schema.inspections.tenantId, request.tenantId)))
                    .get();
                if (insp) {
                    vars.property_address = insp.propertyAddress ?? '';
                    vars.inspection_date = insp.date ?? '';
                    if (!vars.client_name) vars.client_name = insp.clientName ?? '';
                    if (insp.inspectorId) {
                        const inspector = await db.select().from(schema.users)
                            .where(and(eq(schema.users.id, insp.inspectorId), eq(schema.users.tenantId, request.tenantId)))
                            .get();
                        if (inspector) vars.inspector_name = inspector.name ?? inspector.email ?? '';
                    }
                }
            } catch (e) {
                logger.warn('agreement-sign: failed to load inspection vars', { token: token.slice(0, 8), error: (e as Error).message });
            }
        }

        return c.html(AgreementSignPage({
            token,
            agreementName: agreement.name,
            agreementContent: agreement.content,
            clientName: request.clientName ?? null,
            status: request.status as 'pending' | 'viewed' | 'signed',
            branding,
            vars,
        }));
    } catch {
        return c.text('Agreement not found or link has expired.', 404);
    }
});

// Public report page (no auth required)
app.get('/report/:id', async (c) => {
    const id = c.req.param('id') as string;
    const tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) return c.text('Not found', 404);

    try {
        const service = c.var.services.inspection;
        const data = await service.getReportData(id, tenantId as string);

        const rawDate = data.inspection.date || '';
        const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '';

        return c.html(ReportCardStackPage({
            inspectionId: id,
            address: data.inspection.propertyAddress || 'Unknown Address',
            date: formattedDate || rawDate,
            inspectorName: data.inspection.inspectorName,
            theme: data.theme,
            stats: data.stats,
            sections: data.sections,
            ratingLevels: data.ratingLevels as import('./lib/report-utils').RatingLevel[],
            branding: c.get('branding'),
        }));
    } catch {
        return c.text('Report not found', 404);
    }
});

// Pages with Auth
app.get('/dashboard', htmlAuthGuard(), (c) => c.html(DashboardPage({ branding: c.get('branding') })));
app.get('/agent-dashboard', htmlAuthGuard(['agent']), (c) => c.html(AgentDashboardPage({ branding: c.get('branding') })));
app.get('/templates', htmlAuthGuard(['owner', 'admin']), (c) => c.html(TemplatesPage({ branding: c.get('branding') })));
app.get('/templates/:id/edit', htmlAuthGuard(['owner', 'admin']), (c) => {
    const id = c.req.param('id') as string;
    return c.html(TemplateEditorPage({ templateId: id, branding: c.get('branding') }));
});
app.get('/marketplace', htmlAuthGuard(['owner', 'admin']), (c) => c.html(MarketplacePage({ branding: c.get('branding') })));
app.get('/settings', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsPage({ branding: c.get('branding') })));
app.get('/settings/automations', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsAutomationsPage({ branding: c.get('branding') })));
app.get('/settings/data', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsDataPage({ branding: c.get('branding') })));
app.get('/metrics', htmlAuthGuard(['owner', 'admin']), (c) => c.html(MetricsPage({ branding: c.get('branding') })));
app.get('/team', htmlAuthGuard(['owner', 'admin']), (c) => c.html(TeamPage({ branding: c.get('branding') })));
app.get('/agreements', htmlAuthGuard(['owner', 'admin', 'agent']), (c) => c.html(AgreementsPage({ branding: c.get('branding') })));
app.get('/contacts', htmlAuthGuard(['owner', 'admin']), (c) => c.html(ContactsPage({ branding: c.get('branding') })));
app.get('/invoices', htmlAuthGuard(['owner', 'admin']), (c) => c.html(InvoicesPage({ branding: c.get('branding') })));
app.get('/calendar', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => c.html(CalendarPage({ branding: c.get('branding') })));

// Field Inspection Form
app.get('/inspections/:id/form', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const id = c.req.param('id');
    const branding = c.get('branding');
    if (!id) return c.redirect('/dashboard');
    return c.html(FormRendererPage({ inspectionId: id, branding }));
});

// Inspection Edit Page - Inspector + Admin/Owner
app.get('/inspections/:id/edit', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const id = c.req.param('id');
    if (!id) return c.redirect('/dashboard');
    return c.html(InspectionEditPage({ inspectionId: id, branding: c.get('branding') }));
});

app.get('/', (c) => c.redirect('/dashboard'));

export default app;
export { scheduled } from './scheduled';
