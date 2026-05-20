import { Context, Next } from 'hono';
import { HonoConfig, AppServices } from '../../types/hono';
import { AdminService } from '../../services/admin.service';
import { UnitService } from '../../services/unit.service';
import { ObserverLinkService } from '../../services/observer-link.service';
import { ReportVersionService } from '../../services/report-version.service';
import { ApprenticeService } from '../../services/apprentice.service';
import { GuestInviteService } from '../../services/guest-invite.service';
import { AIService } from '../../services/ai.service';
import { AuthService } from '../../services/auth.service';
import { BookingService } from '../../services/booking.service';
import { BrandingService } from '../../services/branding.service';
import { EmailService } from '../../services/email.service';
import { InspectionService } from '../../services/inspection.service';
import { TeamService } from '../../services/team.service';
import { TemplateService } from '../../services/template.service';
import { AgreementService } from '../../services/agreement.service';
import { AvailabilityService } from '../../services/booking.service';
import { ContactService } from '../../services/contact.service';
import { InvoiceService } from '../../services/invoice.service';
import { ServiceService } from '../../services/service.service';
import { AutomationService } from '../../services/automation.service';
import { MarketplaceService } from '../../services/marketplace.service';
import { MessageService } from '../../services/message.service';
import { NotificationService } from '../../services/notification.service';
import { WidgetService } from '../../services/widget.service';
import { RecommendationService } from '../../services/recommendation.service';
import { EventService } from '../../services/event.service';
import { TotpService } from '../../services/totp.service';
import { TemplateSeedService } from '../../services/template-seed.service';
import { ReportPdfService } from '../../services/report-pdf.service';
import { SigningKeyService } from '../../services/signing-key.service';
import { AuditLogService } from '../../services/audit-log.service';
import { TemplateMigrationService } from '../../services/template-migration.service';
import { ImportHistoryService } from '../../services/import-history.service';
import { InspectionRequestService } from '../../services/inspection-request.service';
import { RatingSystemService } from '../../services/rating-system.service';
import { DashboardPrefsService } from '../../services/dashboard-prefs.service';
import { TagService } from '../../services/tag.service';
import { PropertyLookupService } from '../../services/property-lookup.service';
import { UserService } from '../../services/user.service';
import { IcsService } from '../../services/ics.service';
import { AgentService } from '../../services/agent.service';
import { ConciergeService } from '../../services/concierge.service';
import { QBOService } from '../../services/qbo.service';
import { IdentityService } from '../../services/identity.service';
import { IntegrationsService } from '../../services/integrations.service';
import { AnalyticsService } from '../../services/analytics.service';

import { StandaloneProvider } from '../integration/standalone';
import { PortalProvider } from '../integration/portal';
import { getDeploymentProfile } from '../deployment-profile';
import { buildKeyring } from '../jwt-keyring';

/**
 * Middleware that injects a lazy-loaded service registry into the Hono context.
 * When env vars for email/AI are absent, falls back to AES-GCM-decrypted DB secrets.
 */
export async function diMiddleware(c: Context<HonoConfig>, next: Next) {
    c.set('profile', getDeploymentProfile(c.env));
    // Per-request ES256 keyring. PEM → CryptoKey imports happen at most once
    // per request; downstream sign/verify call sites share the same Promise.
    // .catch() suppresses the "unhandled rejection" diagnostic for requests
    // that never touch JWTs (webhooks, healthchecks). Real awaiters still see
    // the original rejection — the .catch() returns a separate, swallowed
    // chain that never sees an `await`.
    const keyringPromise = buildKeyring(c.env as unknown as Record<string, string | undefined>);
    keyringPromise.catch(() => { /* defer reporting to the first awaiter */ });
    c.set('keyringPromise', keyringPromise);
    // Pre-load DB secrets only when env vars are absent and tenant is known.
    // Env vars always take priority over DB-stored config.
    let dbSecrets: { resendApiKey?: string; senderEmail?: string; geminiApiKey?: string } = {};
    const tenantId = c.get('tenantId');
    if (tenantId && (!c.env.RESEND_API_KEY || !c.env.GEMINI_API_KEY)) {
        try {
            const bSvc = new BrandingService(c.env.DB, c.env.TENANT_CACHE);
            dbSecrets = await bSvc.getDecryptedSecrets(tenantId, c.env.JWT_SECRET);
        } catch {
            // Secrets not yet configured — proceed without them
        }
    }

    const services = {} as AppServices;

    c.set('services', new Proxy(services, {
        get(target, prop: keyof AppServices) {
            if (target[prop]) return target[prop];

            switch (prop) {
                case 'admin':
                    {
                        const provider = c.env.PORTAL_API_URL
                            ? new PortalProvider(c.env.DB, c.env.TENANT_CACHE)
                            : new StandaloneProvider(c.env.DB, c.env.TENANT_CACHE);
                        target.admin = new AdminService(c.env.DB, provider);
                    }
                    break;
                case 'ai':
                    target.ai = new AIService(
                        c.env.DB,
                        c.env.GEMINI_API_KEY || dbSecrets.geminiApiKey || '',
                        // Sprint 1 A-4: pass effective deployment mode so the
                        // service can return dev-mock suggestions when the
                        // active profile permits it (standalone/sandbox) and
                        // no API key is configured, instead of throwing 503.
                        c.var.profile.aiDevMockFallback ? 'standalone' : 'saas',
                    );
                    break;
                case 'auth':
                    target.auth = new AuthService(c.env.DB, c.env.TENANT_CACHE);
                    break;
                case 'booking':
                    target.booking = new BookingService(c.env.DB);
                    break;
                case 'branding':
                    target.branding = new BrandingService(c.env.DB, c.env.TENANT_CACHE);
                    break;
                case 'email':
                    target.email = new EmailService(
                        c.env.RESEND_API_KEY || dbSecrets.resendApiKey || '',
                        c.env.SENDER_EMAIL || dbSecrets.senderEmail || '',
                        c.env.APP_NAME || 'OpenInspection'
                    );
                    break;
                case 'inspection':
                    target.inspection = new InspectionService(c.env.DB, c.env.PHOTOS, c.get('sdb'), c.env.TENANT_CACHE);
                    break;
                case 'team':
                    target.team = new TeamService(c.env.DB);
                    break;
                case 'template':
                    target.template = new TemplateService(c.env.DB);
                    break;
                case 'agreement':
                    target.agreement = new AgreementService(c.env.DB);
                    break;
                case 'signingKey':
                    target.signingKey = new SigningKeyService(c.env.DB, c.env.KEY_ENCRYPTION_SECRET || c.env.JWT_SECRET);
                    break;
                case 'auditLog':
                    {
                        // auditLog depends on signingKey — pull via the proxy so it lazy-resolves the same way
                        if (!target.signingKey) {
                            target.signingKey = new SigningKeyService(c.env.DB, c.env.KEY_ENCRYPTION_SECRET || c.env.JWT_SECRET);
                        }
                        target.auditLog = new AuditLogService(c.env.DB, target.signingKey);
                    }
                    break;
                case 'availability':
                    target.availability = new AvailabilityService(c.env.DB);
                    break;
                case 'contact':
                    target.contact = new ContactService(c.env.DB);
                    break;
                case 'invoice':
                    target.invoice = new InvoiceService(c.env.DB);
                    break;
                case 'service':
                    target.service = new ServiceService(c.env.DB);
                    break;
                case 'automation':
                    target.automation = new AutomationService(
                        c.env.DB,
                        new NotificationService(c.env.DB),
                    );
                    break;
                case 'marketplace':
                    target.marketplace = new MarketplaceService(c.env.DB, c.get('tenantId'));
                    break;
                case 'message':
                    target.message = new MessageService(c.env.DB, new NotificationService(c.env.DB));
                    break;
                case 'widget':
                    target.widget = new WidgetService(c.env.DB);
                    break;
                case 'notification':
                    target.notification = new NotificationService(c.env.DB);
                    break;
                case 'recommendation':
                    target.recommendation = new RecommendationService(c.env.DB);
                    break;
                case 'event':
                    target.event = new EventService(c.env.DB);
                    break;
                case 'totp':
                    target.totp = new TotpService();
                    break;
                case 'templateSeed':
                    target.templateSeed = new TemplateSeedService(c.env.DB);
                    break;
                case 'reportPdf':
                    target.reportPdf = new ReportPdfService(c.env.DB, c.env.BROWSER, c.env.REPORTS);
                    break;
                case 'templateMigration':
                    target.templateMigration = new TemplateMigrationService(c.env.DB, c.get('tenantId'));
                    break;
                case 'importHistory':
                    target.importHistory = new ImportHistoryService(c.env.DB, c.get('tenantId'));
                    break;
                case 'inspectionRequest':
                    target.inspectionRequest = new InspectionRequestService(c.env.DB);
                    break;
                case 'ratingSystem':
                    target.ratingSystem = new RatingSystemService(c.env.DB);
                    break;
                case 'dashboardPrefs':
                    target.dashboardPrefs = new DashboardPrefsService(c.env.DB);
                    break;
                case 'tag':
                    target.tag = new TagService(c.env.DB);
                    break;
                case 'propertyLookup':
                    target.propertyLookup = new PropertyLookupService({
                        ESTATED_API_KEY: c.env.ESTATED_API_KEY,
                    });
                    break;
                case 'user':
                    target.user = new UserService(c.env.DB);
                    break;
                case 'ics':
                    {
                        // Booking #7 Sprint C-2 — busy-only inspector calendar.
                        // Host derived from APP_BASE_URL when set so UID values
                        // are stable across environments; falls back to a
                        // generic 'openinspection' tag in local dev.
                        const host = c.env.APP_BASE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'openinspection';
                        target.ics = new IcsService(c.env.DB, host);
                    }
                    break;
                case 'agent':
                    {
                        // Agent Accounts A1 — agent service depends on EmailService
                        // (through the same lazy proxy) and the public app base URL
                        // for accept-link minting.
                        if (!target.email) {
                            target.email = new EmailService(
                                c.env.RESEND_API_KEY || dbSecrets.resendApiKey || '',
                                c.env.SENDER_EMAIL || dbSecrets.senderEmail || '',
                                c.env.APP_NAME || 'OpenInspection',
                            );
                        }
                        target.agent = new AgentService(
                            c.env.DB,
                            target.email,
                            c.env.APP_BASE_URL || '',
                        );
                    }
                    break;
                case 'concierge':
                    {
                        // Agent Accounts A3 — concierge state-machine service.
                        // Depends on EmailService (for client/inspector/agent
                        // notifications) + APP_BASE_URL for the magic-link target.
                        if (!target.email) {
                            target.email = new EmailService(
                                c.env.RESEND_API_KEY || dbSecrets.resendApiKey || '',
                                c.env.SENDER_EMAIL || dbSecrets.senderEmail || '',
                                c.env.APP_NAME || 'OpenInspection',
                            );
                        }
                        target.concierge = new ConciergeService(
                            c.env.DB,
                            target.email,
                            c.env.APP_BASE_URL || '',
                        );
                    }
                    break;
                case 'qbo':
                    target.qbo = new QBOService(
                        c.env.DB,
                        c.env.QBO_CLIENT_ID ?? '',
                        c.env.QBO_CLIENT_SECRET ?? '',
                        c.env.QBO_WEBHOOK_SECRET ?? '',
                        c.env.JWT_SECRET,
                    );
                    break;
                case 'unit':
                    target.unit = new UnitService(c.env.DB);
                    break;
                case 'observerLink':
                    target.observerLink = new ObserverLinkService(c.env.DB);
                    break;
                case 'reportVersion':
                    target.reportVersion = new ReportVersionService(c.env.DB);
                    break;
                case 'apprentice':
                    target.apprentice = new ApprenticeService(c.env.DB);
                    break;
                case 'guestInvite':
                    target.guestInvite = new GuestInviteService(c.env.DB);
                    break;
                case 'identity':
                    target.identity = new IdentityService(c.env.DB);
                    break;
                case 'integrations':
                    target.integrations = new IntegrationsService(c.env.DB, c.env);
                    break;
                case 'analytics':
                    target.analytics = new AnalyticsService(c.env.DB);
                    break;
            }
            return target[prop];
        }
    }));

    await next();
}
