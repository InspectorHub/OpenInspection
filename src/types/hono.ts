/**
 * Global environment bindings for the Cloudflare Worker.
 * Defines the expected resources from wrangler.toml.
 */
export interface AppEnv {
    // Infrastructure
    DB: D1Database;
    TENANT_CACHE: KVNamespace;
    PHOTOS: R2Bucket;
    
    // Security & Auth
    /** Legacy HS256 signing secret. Still used as the KDF input for
     *  tenant config encryption (config-crypto.ts), QBO token encryption
     *  (qbo-crypto.ts), audit signing-key encryption (KEY_ENCRYPTION_SECRET
     *  fallback), and M2M Bearer auth. Pre-launch JWT migration removed
     *  it from sign()/verify() paths; rotation scripts will retire those
     *  remaining usages. */
    JWT_SECRET: string;
    /** Spec 5H — AES-GCM key for encrypting tenant Ed25519 private keys. Falls back to JWT_SECRET. */
    KEY_ENCRYPTION_SECRET: string;
    /** Multi-version ES256 keyring (see src/lib/jwt-keyring.ts). Every JWT
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
    GA_MEASUREMENT_ID: string;

    // Optional Configuration
    SINGLE_TENANT_ID?: string;
    BILLING_URL?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    APP_MODE?: 'standalone' | 'saas';
    SAAS_TOPOLOGY?: 'shared' | 'silo';
    SETUP_CODE?: string;

    // Payments
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;

    // Rate Limiting
    RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };

    // PDF Generation (Cloudflare Browser Rendering — beta)
    BROWSER?: Fetcher;

    // Report PDF storage (Spec 5A) — pre-rendered Summary + Full Report PDFs.
    // Optional during local dev so the worker boots without the binding.
    REPORTS?: R2Bucket;

    // Spec 5H P1 — async sign-completion pipeline (signed.pdf + cert.pdf + audit append)
    SIGN_COMPLETION_WORKFLOW?: Workflow;

    // Design System 0520 subsystem B — presence Durable Objects (phase 2).
    // Optional in non-saas profiles where presence is disabled (standalone
    // single-inspector deployments). Routes that touch presence feature-detect.
    INSPECTION_PRESENCE?: DurableObjectNamespace;
    TENANT_PRESENCE?: DurableObjectNamespace;

    // Spec 5H — Public verifier base URL embedded in Certificate of Completion
    ESIGN_PUBLIC_VERIFY_BASE?: string;

    // SaaS Portal Integration
    PORTAL_API_URL?: string;
    /** Legacy single-secret M2M binding. Kept as a transitional fallback so
     *  deployments that have not yet provisioned the V<N> keyring keep
     *  working. New deployments populate PORTAL_M2M_SECRET_V<N> instead. */
    PORTAL_M2M_SECRET?: string;
    /** Multi-version PORTAL_M2M_SECRET keyring (see src/lib/m2m-auth.ts).
     *  Portal-> core M2M calls are verified against every active V<N> so
     *  the shared bearer/HMAC secret can be rotated with an overlap window.
     *  PORTAL_M2M_CURRENT_KID names the version Portal sends; core just
     *  accepts any V<N> that matches. */
    PORTAL_M2M_CURRENT_KID?: string;
    PORTAL_M2M_SECRET_V1?: string;
    PORTAL_M2M_SECRET_V2?: string;
    PORTAL_M2M_SECRET_V3?: string;

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
import { OutboxService } from '../services/outbox.service';
import { BookingService, AvailabilityService } from '../services/booking.service';
import { BrandingService } from '../services/branding.service';
import { EmailService } from '../services/email.service';
import { InspectionService } from '../services/inspection.service';
import { TeamService } from '../services/team.service';
import { TemplateService } from '../services/template.service';
import { AgreementService } from '../services/agreement.service';
import { ContactService } from '../services/contact.service';
import { InvoiceService } from '../services/invoice.service';
import { ServiceService } from '../services/service.service';
import { AutomationService } from '../services/automation.service';
import { MarketplaceService } from '../services/marketplace.service';
import { MessageService } from '../services/message.service';
import { NotificationService } from '../services/notification.service';
import { WidgetService } from '../services/widget.service';
import { RecommendationService } from '../services/recommendation.service';
import { EventService } from '../services/event.service';
import { TotpService } from '../services/totp.service';
import { TemplateSeedService } from '../services/template-seed.service';
import { ReportPdfService } from '../services/report-pdf.service';
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
    outbox: OutboxService;
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
    service: ServiceService;
    automation: AutomationService;
    marketplace: MarketplaceService;
    message: MessageService;
    notification: NotificationService;
    widget: WidgetService;
    recommendation: RecommendationService;
    event: EventService;
    totp: TotpService;
    templateSeed: TemplateSeedService;
    reportPdf: ReportPdfService;
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
    observerLink: import('../services/observer-link.service').ObserverLinkService;
    reportVersion: import('../services/report-version.service').ReportVersionService;
    apprentice: import('../services/apprentice.service').ApprenticeService;
    guestInvite: import('../services/guest-invite.service').GuestInviteService;
    identity: import('../services/identity.service').IdentityService;
    integrations: import('../services/integrations.service').IntegrationsService;
    analytics: import('../services/analytics.service').AnalyticsService;
}

/**
 * Global variables injected into the Hono context via middlewares.
 */
export type AppVariables = AuthVariables & {
    services: AppServices;
    profile: DeploymentProfile;
};

/**
 * Helper type for Hono Generic definitions.
 */
export type HonoConfig = {
    Bindings: AppEnv;
    Variables: AppVariables;
};
