// Admin → Integration & config sub-router (Phase 1.3 split of
// server/api/admin.ts).
//
// Integration config, Stripe Connect account, widget origin allowlist, earnings
// summary, ICS subscription token, Browser-Run smoke probe + per-tenant PDF
// pipeline toggle. Route definitions are co-located with their `.openapi()`
// handlers; bodies are byte-identical to the original admin.ts. Mounted at `/`
// by the admin aggregator, preserving the original paths.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBaseUrl } from '../../lib/url';
import { logger } from '../../lib/logger';
import {
    StripeConnectAccountSchema,
} from '../../lib/validations/admin.schema';
import { tenantConfigs } from '../../lib/db/schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";


// ─── Integration Config & Secrets ────────────────────────────────────────────

const IntegrationConfigSchema = z.object({
    appBaseUrl: z.string().optional().describe('TODO describe appBaseUrl field for the OpenInspection MCP integration'),
    turnstileSiteKey: z.string().optional().describe('TODO describe turnstileSiteKey field for the OpenInspection MCP integration'),
    googleClientId: z.string().optional().describe('TODO describe googleClientId field for the OpenInspection MCP integration'),
    streamCustomerSubdomain: z.string().optional().describe('Cloudflare Stream customer subdomain for self-host Stream video backend (e.g. customer.cloudflarestream.com).'),
}).openapi('IntegrationConfig');

// C-15 (2026-06-06): SecretsInputSchema + the POST /config/secrets route were
// RETIRED with the legacy `tenant_configs.secrets` store. Tenant secrets are
// written exclusively via PUT /api/secrets (canonical `secrets_enc`).

const getConfigRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/config',
    tags: ["admin"],
    summary: 'Get integration config and masked secrets',
    middleware: [requireRole('owner')],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ integrationConfig: IntegrationConfigSchema.describe('TODO describe integrationConfig field for the OpenInspection MCP integration'), secrets: z.record(z.string(), z.string()).describe('TODO describe secrets field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }).openapi('ConfigResponse') } },
            description: 'Success',
        },
    },
    operationId: "listTenantConfig",
    description: "Auto-generated placeholder for listTenantConfig (GET /config, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


const updateIntegrationConfigRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/config',
    tags: ["admin"],
    summary: 'Save non-sensitive integration config (plaintext)',
    middleware: [requireRole('owner')],
    request: { body: { content: { 'application/json': { schema: IntegrationConfigSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Saved' },
    },
    operationId: "createTenantConfig",
    description: "Auto-generated placeholder for createTenantConfig (POST /config, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


// --- Widget Origin Allowlist ---

const getWidgetOriginsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/widget/origins',
    tags: ["admin"],
    summary: 'Get current widget allowed-origin list',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ origins: z.array(z.string()).describe('TODO describe origins field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantWidgetOrigins",
    description: "Auto-generated placeholder for listTenantWidgetOrigins (GET /widget/origins, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

const setWidgetOriginsRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/widget/origins',
    tags: ["admin"],
    summary: 'Replace widget allowed-origin list',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: z.object({ origins: z.array(z.string().min(1)).max(50).describe('TODO describe origins field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ origins: z.array(z.string()).describe('TODO describe origins field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Saved',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "updateTenantWidgetOrigin",
    description: "Auto-generated placeholder for updateTenantWidgetOrigin (PUT /widget/origins, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

// --- Stripe Connect (inspector-facing) ---

const getStripeConnectRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/stripe-connect',
    tags: ["admin"],
    summary: 'Get the tenant Stripe Connect account ID',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ accountId: z.string().nullable().describe('TODO describe accountId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantStripeConnect",
    description: "Auto-generated placeholder for listTenantStripeConnect (GET /stripe-connect, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

const setStripeConnectRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/stripe-connect',
    tags: ["admin"],
    summary: 'Set the tenant Stripe Connect account ID',
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: StripeConnectAccountSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ accountId: z.string().describe('TODO describe accountId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Saved',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "updateTenantStripeConnect",
    description: "Auto-generated placeholder for updateTenantStripeConnect (PUT /stripe-connect, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

const deleteStripeConnectRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/stripe-connect',
    tags: ["admin"],
    summary: 'Disconnect the tenant Stripe Connect account',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ accountId: z.null().describe('TODO describe accountId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Cleared',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteTenantStripeConnect",
    description: "Auto-generated placeholder for deleteTenantStripeConnect (DELETE /stripe-connect, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

// --- Earnings Summary ---

const getEarningsSummaryRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/earnings-summary',
    tags: ["admin"],
    summary: 'Get aggregated invoice earnings (paid/pending/count)',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({
                            paid: z.number().describe('TODO describe paid field for the OpenInspection MCP integration'),
                            pending: z.number().describe('TODO describe pending field for the OpenInspection MCP integration'),
                            count: z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
                        }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantEarningsSummary",
    description: "Auto-generated placeholder for listTenantEarningsSummary (GET /earnings-summary, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));

// --- ICS Subscription Token ---

const icsTokenRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/ics-token',
    tags: ["admin", "calendar"],
    summary: "List tenant ics token",
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({ url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Subscription URL',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listTenantIcsToken",
    description: "Auto-generated placeholder for listTenantIcsToken (GET /ics-token, admin domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * GET /api/admin/system/br-smoke
 *
 * Diagnostic — invokes `env.BROWSER.fetch(url, { Accept: 'application/pdf' })`
 * and returns the raw outcome so an operator can confirm Cloudflare Browser
 * Run (formerly Browser Rendering) is provisioned for the account before
 * flipping `tenant_configs.enable_pdf_pipeline`. Does NOT persist anything;
 * does NOT count toward audit chain.
 *
 * Default probe URL is `https://example.com` — a stable third-party page
 * that should always render to a small (<10 KB) PDF when BR is live.
 * Override with `?url=` for richer testing (e.g. a published `/report/...`
 * route on the same Worker).
 */
const BrSmokeQuerySchema = z.object({
    url: z.string().url().optional().openapi({ example: 'https://example.com' }).describe('Target URL for the BR probe; defaults to https://example.com.'),
});
const BrSmokeResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        bindingPresent: z.boolean().describe('Whether env.BROWSER is wired by wrangler.jsonc.'),
        probedUrl: z.string(),
        status: z.number().nullable().describe('HTTP status returned by env.BROWSER.fetch; null if the call threw.'),
        ok: z.boolean().describe('True iff status is 2xx AND content-type is application/pdf.'),
        contentType: z.string().nullable(),
        contentLength: z.number().nullable().describe('Body byte length read into memory (capped at 1 MB).'),
        durationMs: z.number().describe('Wall time for env.BROWSER.fetch round-trip.'),
        error: z.string().nullable().describe('Exception message if the call threw.'),
        hint: z.string().describe('Human-readable interpretation of the result.'),
    }),
});
const brSmokeRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/system/br-smoke',
    tags: ['admin'],
    summary: 'Probe Cloudflare Browser Run binding (env.BROWSER) liveness',
    middleware: [requireRole('owner', 'manager')],
    request: { query: BrSmokeQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: BrSmokeResponseSchema } },
            description: 'Probe result — see hint field for interpretation.',
        },
    },
    operationId: 'brSmokeProbe',
    description: 'Operator diagnostic for confirming Browser Run is enabled before enabling the per-tenant PDF pipeline.',
}, { scopes: ['admin'], tier: 'extended' }));


/**
 * PATCH /api/admin/pdf-pipeline
 *
 * Toggle the per-tenant Browser-Run PDF pipeline flag
 * (`tenant_configs.enable_pdf_pipeline`). When false, all Spec 5A/5H render call-sites skip
 * `env.BROWSER.fetch()` to avoid burning Worker CPU on a binding that may
 * be unprovisioned. Default for a fresh tenant is false.
 *
 * Note: the same field is also accepted by `POST /api/admin/branding`
 * alongside other tenant config — this endpoint exists for ops automation
 * that wants a single-purpose URL without touching unrelated fields.
 */
const PdfPipelineToggleSchema = z.object({
    enabled: z.boolean().openapi({ example: true }).describe('Whether to enable the server-side PDF rendering pipeline for this tenant.'),
});
const PdfPipelineResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        tenantId: z.string(),
        enabled: z.boolean(),
    }),
});
const togglePdfPipelineRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/pdf-pipeline',
    tags: ['admin'],
    summary: 'Toggle the per-tenant Browser-Run PDF rendering pipeline',
    middleware: [requireRole('owner', 'manager')],
    request: {
        body: { content: { 'application/json': { schema: PdfPipelineToggleSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: PdfPipelineResponseSchema } },
            description: 'Pipeline flag persisted; new value echoed.',
        },
    },
    operationId: 'togglePdfPipeline',
    description: 'Flips tenant_configs.enable_pdf_pipeline (Spec 5A / Spec 5H gate). Verify env.BROWSER liveness with GET /api/admin/system/br-smoke first.',
}, { scopes: ['admin'], tier: 'extended' }));


export const adminConfigRoutes = createApiRouter()
    .openapi(getConfigRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const svc = c.var.services.branding;
        const integrationConfig = await svc.getIntegrationConfig(tenantId);
        // C-15: the legacy `tenant_configs.secrets` store is retired. Masked
        // secrets are served by GET /api/secrets (canonical `secrets_enc`);
        // the field is kept (empty) for response-shape compatibility.
        return c.json({ success: true, data: { integrationConfig, secrets: {} } }, 200);
    })
    .openapi(updateIntegrationConfigRoute, async (c) => {
        const body = c.req.valid('json');
        await c.var.services.branding.updateIntegrationConfig(c.get('tenantId'), body as unknown as import('../../services/branding.service').IntegrationConfig);
        auditFromContext(c, 'config.integration.update', 'tenant_config');
        return c.json({ success: true }, 200);
    })
    .openapi(getWidgetOriginsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const origins = await c.var.services.widget.getAllowedOrigins(tenantId);
        return c.json({ success: true as const, data: { origins } }, 200);
    })
    .openapi(setWidgetOriginsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { origins } = c.req.valid('json');
        await c.var.services.widget.setAllowedOrigins(tenantId, origins);
        return c.json({ success: true as const, data: { origins } }, 200);
    })
    .openapi(getStripeConnectRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { accountId } = await c.var.services.admin.getStripeConnect(tenantId);
        return c.json({ success: true as const, data: { accountId } }, 200);
    })
    .openapi(setStripeConnectRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { accountId } = c.req.valid('json');
        await c.var.services.admin.setStripeConnect(tenantId, accountId);
        auditFromContext(c, 'config.integration.update', 'tenant_config', { metadata: { stripeConnect: 'set' } });
        return c.json({ success: true as const, data: { accountId } }, 200);
    })
    .openapi(deleteStripeConnectRoute, async (c) => {
        const tenantId = c.get('tenantId');
        await c.var.services.admin.setStripeConnect(tenantId, null);
        auditFromContext(c, 'config.integration.update', 'tenant_config', { metadata: { stripeConnect: 'cleared' } });
        return c.json({ success: true as const, data: { accountId: null } }, 200);
    })
    .openapi(getEarningsSummaryRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const summary = await c.var.services.invoice.getEarningsSummary(tenantId);
        return c.json({ success: true as const, data: summary }, 200);
    })
    .openapi(icsTokenRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        const configs = await db
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .limit(1);

        let token = configs[0]?.icsToken ?? null;

        if (!token) {
            token = crypto.randomUUID().replace(/-/g, '');
            if (configs[0]) {
                await db
                    .update(tenantConfigs)
                    .set({ icsToken: token, updatedAt: new Date() })
                    .where(eq(tenantConfigs.tenantId, tenantId));
            } else {
                await db.insert(tenantConfigs).values({
                    tenantId,
                    icsToken: token,
                    updatedAt: new Date(),
                });
            }
        }

        const baseUrl = getBaseUrl(c);
        return c.json({ success: true as const, data: { url: `${baseUrl}/api/ics/${token}` } }, 200);
    })
    .openapi(brSmokeRoute, async (c) => {
        const { url } = c.req.valid('query');
        const probedUrl = url ?? 'https://example.com';
        const browser = c.env.BROWSER;

        if (!browser) {
            return c.json({
                success: true as const,
                data: {
                    bindingPresent: false,
                    probedUrl,
                    status: null,
                    ok: false,
                    contentType: null,
                    contentLength: null,
                    durationMs: 0,
                    error: null,
                    hint: 'env.BROWSER not bound. Add [browser] binding = "BROWSER" to wrangler.jsonc and redeploy.',
                },
            }, 200);
        }

        const start = Date.now();
        let status: number | null = null;
        let contentType: string | null = null;
        let contentLength: number | null = null;
        let error: string | null = null;
        let body: ArrayBuffer | null = null;

        try {
            const res = await browser.quickAction('pdf', { url: probedUrl });
            status = res.status;
            contentType = res.headers.get('content-type');
            const buf = await res.arrayBuffer();
            body = buf;
            contentLength = Math.min(buf.byteLength, 1_048_576);
        } catch (e) {
            error = (e as Error).message;
        }

        const durationMs = Date.now() - start;
        const ok = status !== null && status >= 200 && status < 300
            && (contentType?.includes('application/pdf') ?? false);

        let hint: string;
        if (error) {
            hint = `Call threw before returning: ${error}. Likely a TypeError (binding misconfigured) or compatibility_date too old (need >= "2026-03-24" for .quickAction()).`;
        } else if (status === 404) {
            const bodyPreview = body ? new TextDecoder().decode(body.slice(0, 64)) : '';
            hint = bodyPreview.startsWith('Not Found')
                ? 'Browser Run NOT provisioned for this account. Enable Browser Run in the CF dashboard, then re-probe.'
                : `Probed URL returned 404 from origin (not from BR). Try a known-good URL like https://example.com.`;
        } else if (ok) {
            hint = `Browser Run is live. Returned a ${contentLength}-byte PDF in ${durationMs} ms. Safe to enable the per-tenant pipeline.`;
        } else {
            hint = `Unexpected response — status=${status}, content-type=${contentType}. Inspect manually before enabling the pipeline.`;
        }

        logger.info('br-smoke probe', { probedUrl, status, contentType, contentLength, durationMs, ok });

        return c.json({
            success: true as const,
            data: { bindingPresent: true, probedUrl, status, ok, contentType, contentLength, durationMs, error, hint },
        }, 200);
    })
    .openapi(togglePdfPipelineRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { enabled } = c.req.valid('json');

        const brandingService = c.var.services.branding;
        await brandingService.updateBranding(tenantId, { enablePdfPipeline: enabled });

        auditFromContext(c, 'config.tenant_config.patch', 'tenant_configs', {
            metadata: { field: 'enablePdfPipeline', enabled },
        });

        return c.json({
            success: true as const,
            data: { tenantId, enabled },
        }, 200);
    });

export type AdminConfigApi = typeof adminConfigRoutes;
export default adminConfigRoutes;
