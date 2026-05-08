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
    JWT_SECRET: string;
    /** Spec 5H — AES-GCM key for encrypting tenant Ed25519 private keys. Falls back to JWT_SECRET. */
    KEY_ENCRYPTION_SECRET: string;
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
    SETUP_CODE?: string;

    /** Sprint 1 CC-2 — set to "true" on sandbox.inspectorhub.io demo deployment.
     *  Causes MainLayout/BareLayout to render the SandboxBanner. */
    SANDBOX_MODE?: string;

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

    // Spec 5H — Public verifier base URL embedded in Certificate of Completion
    ESIGN_PUBLIC_VERIFY_BASE?: string;

    // SaaS Portal Integration
    PORTAL_API_URL?: string;
    PORTAL_M2M_SECRET?: string;

    // Spec 5D — Address Autofill. Server-side proxy holds the API key so it
    // never leaks to the client. Optional: when absent, dashboard.tsx falls
    // back to a free-text address input (no autocomplete dropdown).
    GOOGLE_PLACES_API_KEY?: string;
}

import { AdminService } from '../services/admin.service';
import { AIService } from '../services/ai.service';
import { AuthService } from '../services/auth.service';
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
import { AuthVariables } from './auth';

/**
 * Registry of all available services.
 * This allows for lazy-loading and better testability.
 */
export interface AppServices {
    admin: AdminService;
    auth: AuthService;
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
}

/**
 * Global variables injected into the Hono context via middlewares.
 */
export type AppVariables = AuthVariables & {
    services: AppServices;
};

/**
 * Helper type for Hono Generic definitions.
 */
export type HonoConfig = {
    Bindings: AppEnv;
    Variables: AppVariables;
};
