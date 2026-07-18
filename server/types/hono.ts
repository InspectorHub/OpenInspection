/**
 * Cloudflare Browser Run "Quick Actions" Worker binding (post-rebrand from
 * "Browser Rendering"). Minimal local declaration — the official
 * @cloudflare/workers-types package shipping in this repo predates the
 * Quick Actions surface. Full action list per
 * https://developers.cloudflare.com/browser-run/quick-actions/
 */
export interface BrowserRun {
    quickAction(
        action: 'pdf' | 'screenshot' | 'content' | 'markdown' | 'snapshot' | 'scrape' | 'json' | 'links' | 'crawl',
        options: { url?: string; html?: string; [key: string]: unknown },
    ): Promise<Response>;
}

/**
 * Global environment bindings for the Cloudflare Worker.
 * Defines the expected resources from wrangler.jsonc.
 */
export interface AppEnv {
    // Infrastructure
    DB: D1Database;
    TENANT_CACHE: KVNamespace;
    PHOTOS: R2Bucket;
    /** Cloudflare Stream — video walk-through storage (Media Studio, Plan 7).
     *  Account-scoped, name-only binding. `StreamBinding` is an ambient global
     *  interface vendored in worker-configuration.d.ts. */
    STREAM: StreamBinding;
    /** Cloudflare Stream customer subdomain for iframe/thumbnail URLs
     *  (e.g. "customer-xxxx"). No hardcoded fallback — features that build
     *  Stream URLs must fail closed when this is absent. */
    STREAM_CUSTOMER_SUBDOMAIN?: string;
    
    // Security & Auth
    /** Legacy HS256 signing secret. Still used as the KDF input for
     *  tenant config encryption (config-crypto.ts), QBO token encryption
     *  (qbo-crypto.ts), audit signing-key encryption (KEY_ENCRYPTION_SECRET
     *  fallback), and M2M Bearer auth. Pre-launch JWT migration removed
     *  it from sign()/verify() paths; rotation scripts will retire those
     *  remaining usages. */
    JWT_SECRET: string;
    /** Optional rotation-window fallback for JWT_SECRET (envelope secrets KEK
     *  unwrap + legacy blob decrypt). Set during a JWT_SECRET rotation, run the
     *  reencrypt endpoint, then delete. Never used for new writes. */
    JWT_SECRET_PREVIOUS?: string;
    /** Spec 5H — AES-GCM key for encrypting tenant Ed25519 private keys. Falls back to JWT_SECRET. */
    KEY_ENCRYPTION_SECRET: string;
    /** Multi-version ES256 keyring (see server/lib/jwt-keyring.ts). Every JWT
     *  is signed/verified through this keyring; `JWT_CURRENT_KID` names the
     *  active signer (e.g. "v1"). Versions are discovered dynamically by
     *  pairing JWT_PRIVATE_KEY_V<N> with JWT_PUBLIC_KEY_V<N>. */
    JWT_CURRENT_KID?: string;
    JWT_PRIVATE_KEY_V1?: string;
    JWT_PUBLIC_KEY_V1?:  string;
    JWT_PRIVATE_KEY_V2?: string;
    JWT_PUBLIC_KEY_V2?:  string;
    JWT_PRIVATE_KEY_V3?: string;
    JWT_PUBLIC_KEY_V3?:  string;
    TURNSTILE_SITE_KEY: string;
    TURNSTILE_SECRET_KEY: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GEMINI_API_KEY: string;
    
    // Communication
    RESEND_API_KEY: string;
    SENDER_EMAIL: string;
    
    // System Defaults
    APP_NAME: string;
    PRIMARY_COLOR: string;
    APP_BASE_URL?: string;

    // Legal
    /** Optional: URL of the operator's Terms of Service. When set (with or without PRIVACY_URL), account-creating public forms require an acceptance checkbox. */
    TERMS_URL?: string;
    /** Optional: URL of the operator's Privacy Policy. When set, public pages render a privacy-notice footer link. */
    PRIVACY_URL?: string;

    // Optional Configuration
    SINGLE_TENANT_ID?: string;
    BILLING_URL?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    APP_MODE?: 'standalone' | 'saas';
    SETUP_CODE?: string;
    // Test/dev-only escape hatch: when '1', checkRateLimit no-ops. Set ONLY in
    // the ephemeral E2E .dev.vars (scripts/gen-e2e-dev-vars.mjs) so the seeded
    // suite's concentrated single-IP logins don't trip the 10/60s login limiter.
    // Unset (the default) everywhere else — production/self-host stays enforced.
    DISABLE_RATE_LIMIT?: string;
    // Test-only email sink: when '1', every outbound email is captured to KV
    // instead of sent (RecordingEmailProvider) and the env-gated
    // `/api/__test__/last-email` route reads it back — so E2E can obtain the
    // password-reset token, which is emailed and never returned by an API. Set
    // ONLY on the Playwright worker (playwright.config.ts `--var`). Unset (the
    // default) everywhere else — production/self-host never sink or expose it.
    E2E_EMAIL_SINK?: string;

    // Payments
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_PUBLISHABLE_KEY?: string;

    // Track L — Twilio SMS (platform-default in SaaS; merged from tenant secrets
    // by integrationSecretsMiddleware for BYO/standalone).
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
    // Managed-pool send path: API Key SID + API Key Secret (ISV account, not per-tenant).
    TWILIO_API_KEY_SID?: string;
    TWILIO_API_KEY_SECRET?: string;
    /** Shared Messaging Service SID used by all managed_shared tenants. */
    TWILIO_SHARED_MESSAGING_SERVICE_SID?: string;
    /**
     * Dedicated HMAC secret for Twilio compliance-status webhooks (brand/campaign/TFV
     * callbacks). When set, this takes precedence over TWILIO_AUTH_TOKEN for verifying
     * POST /api/public/twilio/compliance-status/:tenant. Optional — falls back to
     * TWILIO_AUTH_TOKEN when absent. If neither is set, the webhook rejects 403.
     */
    TWILIO_COMPLIANCE_WEBHOOK_TOKEN?: string;
    /** Managed-ISV Telnyx API key — drives the Telnyx managed-compliance provision
     *  path + cron sweep (Plan 2). Absent → Telnyx managed resolution fails closed. */
    TELNYX_API_KEY?: string;
    /** Base64 Ed25519 PUBLIC key for verifying Telnyx compliance-status webhooks
     *  (POST /api/public/telnyx/compliance-status/:tenant). Missing → webhook 403. */
    TELNYX_PUBLIC_KEY?: string;
    /** Platform-wide monthly SMS allowance for managed (dedicated/shared) tenants.
     *  Parsed as an integer; defaults to DEFAULT_MANAGED_SMS_ALLOWANCE (1000) when
     *  absent or non-numeric. Send quota check reads the current period counter from
     *  usage_counters and blocks when count >= allowance. */
    MANAGED_SMS_MONTHLY_ALLOWANCE?: string;

    // Rate Limiting
    RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };

    // PDF Generation (Cloudflare Browser Run — formerly Browser Rendering).
    // Quick Actions API: env.BROWSER.quickAction("pdf", { url }) → Response.
    // Requires wrangler `compatibility_date >= "2026-03-24"`. The official
    // workers-types package predates the rebrand, so we declare a minimal
    // shape locally.
    BROWSER?: BrowserRun;

    // Report PDF storage (Spec 5A) — pre-rendered Summary + Full Report PDFs.
    // Optional during local dev so the worker boots without the binding.

    // Spec 5H P1 — async sign-completion pipeline (signed.pdf + cert.pdf + audit append)
    SIGN_COMPLETION_WORKFLOW?: Workflow;

    // Design System 0520 subsystem B — presence Durable Objects (phase 2).
    // Optional in non-saas profiles where presence is disabled (standalone
    // single-inspector deployments). Routes that touch presence feature-detect.
    INSPECTION_PRESENCE?: DurableObjectNamespace;
    TENANT_PRESENCE?: DurableObjectNamespace;

    // Collab editing (#181) — one DO instance per inspection holding the
    // authoritative Y.Doc for results. Optional so builds without the binding
    // (local dev without wrangler.local.jsonc) boot cleanly; Task-5 route
    // feature-detects before forwarding the WS upgrade.
    INSPECTION_DOC?: DurableObjectNamespace;

    // Remote MCP server (Phase A) — one DO instance per authenticated MCP session.
    // Optional so standalone builds without the binding boot cleanly; Task A3
    // routes feature-detect before forwarding to McpAgent.serve().
    INSPECTOR_MCP?: DurableObjectNamespace;

    // KV store for the @cloudflare/workers-oauth-provider OAuth token/grant state.
    // The binding name OAUTH_KV is hardcoded in that library — do not rename.
    // Optional so builds without a provisioned KV namespace boot cleanly.
    OAUTH_KV?: KVNamespace;

    // Spec 5H — Public verifier base URL embedded in Certificate of Completion
    ESIGN_PUBLIC_VERIFY_BASE?: string;

    // SaaS Portal Integration (browser redirects). NOTE: the PORTAL_SERVICE
    // Service Binding was RETIRED (2026-06-04) — its last functional use was
    // the old outbox drain POST, replaced by the sync queue. Portal->core RPC
    // rides portal's CORE_SERVICE binding; core itself holds no binding to
    // portal anymore.
    PORTAL_API_URL?: string;

    // Core -> portal user-sync transport (A-13/A-14). SaaS-only producer
    // binding to the `inspectorhub-sync-saas` Cloudflare Queue. Absent in
    // standalone — producer code guards on it, so standalone's outbox sink is
    // never constructed and no rows accumulate.
    SYNC_QUEUE?: Queue<import('../lib/sync-events/envelope').SyncEnvelope>;

    // A-21 batch 3 — shared offboarding exports bucket (SaaS-only; the same
    // bucket the portal worker binds). The cmd consumer streams the tenant
    // export ZIP here (`cmd.tenant.data_export`) via multipart upload and the
    // portal serves the download. Absent in standalone (no portal).
    EXPORTS_BUCKET?: R2Bucket;

    // Commercial PCA Phase W — async .docx export producer binding (queue
    // `openinspection-word-export`; declared in the COMMITTED wrangler.jsonc,
    // unlike SYNC_QUEUE/EXPORTS_BUCKET above — standalone + one-click deploys
    // get Word export too). Optional/fail-closed: the enqueue route returns
    // 503 EXPORT_UNAVAILABLE when a deploy strips the binding.
    WORD_EXPORT_QUEUE?: Queue<import('../lib/sync-events/word-export-job').WordExportJob>;

    // Spec 5D — Address Autofill. Server-side proxy holds the API key so it
    // never leaks to the client. Optional: when absent, dashboard.tsx falls
    // back to a free-text address input (no autocomplete dropdown).
    GOOGLE_PLACES_API_KEY?: string;

    // Sprint 3 S3-1 — Estated.io public-records API. Server-side proxy holds
    // the key so it never leaks to the client. Optional: when absent the
    // /api/inspections/:id/property-facts/autofill endpoint returns
    // `{ data: null, reason: 'NO_API_KEY' }` and the UI falls back to manual
    // entry. Matches the existing GOOGLE_PLACES_API_KEY graceful-degrade
    // pattern.
    ESTATED_API_KEY?: string;

    // QuickBooks Online integration
    QBO_CLIENT_ID?: string;
    QBO_CLIENT_SECRET?: string;
    QBO_WEBHOOK_SECRET?: string;
}

import { AdminService } from '../services/admin.service';
import { AIService } from '../services/ai.service';
import { AuthService } from '../services/auth.service';
import type { UserSyncOutbox } from '../lib/integration/user-sync';
import { BookingService, AvailabilityService } from '../services/booking.service';
import { BrandingService } from '../services/branding.service';
import { EmailService } from '../services/email.service';
import { InspectionService } from '../services/inspection.service';
import { TeamService } from '../services/team.service';
import { TemplateService } from '../services/template.service';
import { AgreementService } from '../services/agreement.service';
import { ContactService } from '../services/contact.service';
import { InvoiceService } from '../services/invoice.service';
import { PortalAccessService } from '../services/portal-access.service';
import { ServiceService } from '../services/service.service';
import { AutomationService } from '../services/automation.service';
import { MarketplaceService } from '../services/marketplace.service';
import { MessageService } from '../services/message.service';
import { NotificationService } from '../services/notification.service';
import { WidgetService } from '../services/widget.service';
import { RecommendationService } from '../services/recommendation.service';
import { ContractorTypeService } from '../services/contractor-type.service';
import { EventService } from '../services/event.service';
import { InspectionTypeService } from '../services/inspection-type.service';
import { TotpService } from '../services/totp.service';
import { TemplateSeedService } from '../services/template-seed.service';
import { ReportPdfService } from '../services/report-pdf.service';
import { ReportExportService } from '../services/report-export.service';
import { SigningKeyService } from '../services/signing-key.service';
import { AuditLogService } from '../services/audit-log.service';
import { TemplateMigrationService } from '../services/template-migration.service';
import { ImportHistoryService } from '../services/import-history.service';
import { InspectionRequestService } from '../services/inspection-request.service';
import { RatingSystemService } from '../services/rating-system.service';
import { DashboardPrefsService } from '../services/dashboard-prefs.service';
import { TagService } from '../services/tag.service';
import { PropertyLookupService } from '../services/property-lookup.service';
import { UserService } from '../services/user.service';
import { IcsService } from '../services/ics.service';
import { AgentService } from '../services/agent.service';
import { ConciergeService } from '../services/concierge.service';
import { AuthVariables } from './auth';
import { DeploymentProfile } from '../lib/deployment-profile';

/**
 * Registry of all available services.
 * This allows for lazy-loading and better testability.
 */
export interface AppServices {
    admin: AdminService;
    auth: AuthService;
    outbox?: UserSyncOutbox | undefined;
    booking: BookingService;
    branding: BrandingService;
    email: EmailService;
    inspection: InspectionService;
    team: TeamService;
    template: TemplateService;
    agreement: AgreementService;
    availability: AvailabilityService;
    ai: AIService;
    contact: ContactService;
    invoice: InvoiceService;
    portalAccess: PortalAccessService;
    portal: import('../services/portal.service').PortalService;
    service: ServiceService;
    automation: AutomationService;
    marketplace: MarketplaceService;
    message: MessageService;
    notification: NotificationService;
    widget: WidgetService;
    recommendation: RecommendationService;
    contractorType: ContractorTypeService;
    event: EventService;
    inspectionType: InspectionTypeService;
    totp: TotpService;
    templateSeed: TemplateSeedService;
    reportPdf: ReportPdfService;
    reportExport: ReportExportService;
    signingKey: SigningKeyService;
    auditLog: AuditLogService;
    templateMigration: TemplateMigrationService;
    importHistory: ImportHistoryService;
    inspectionRequest: InspectionRequestService;
    ratingSystem: RatingSystemService;
    dashboardPrefs: DashboardPrefsService;
    tag: TagService;
    propertyLookup: PropertyLookupService;
    user: UserService;
    ics: IcsService;
    // Agent Accounts A1
    agent: AgentService;
    // Agent Accounts A3
    concierge: ConciergeService;
    // QuickBooks Online integration
    qbo: import('../services/qbo.service').QBOService;
    unit: import('../services/unit.service').UnitService;
    unitSwitch: import('../services/unit-switch.service').UnitSwitchService;
    observerLink: import('../services/observer-link.service').ObserverLinkService;
    reportVersion: import('../services/report-version.service').ReportVersionService;
    identity: import('../services/identity.service').IdentityService;
    integrations: import('../services/integrations.service').IntegrationsService;
    analytics: import('../services/analytics.service').AnalyticsService;
    repairRequest: import('../services/repair-request.service').RepairRequestService;
    clientDocument: import('../services/client-document.service').ClientDocumentService;
    compliance: import('../services/compliance/pca-compliance.service').ComplianceService;
}

/**
 * Global variables injected into the Hono context via middlewares.
 */
type AppVariables = AuthVariables & {
    services: AppServices;
    profile: DeploymentProfile;
    /** Unified client portal — verified email from the __Host-portal_session
     *  cookie, set by the portal session middleware (server/api/portal.ts).
     *  Tenant-independent (email ownership is global); cross-tenant isolation
     *  comes from every portal query being scoped to the path's tenantId. */
    portalEmail?: string;
};

/**
 * Helper type for Hono Generic definitions.
 */
export type HonoConfig = {
    Bindings: AppEnv;
    Variables: AppVariables;
};
