import { Context, Next } from 'hono';
import { HonoConfig, AppServices } from '../../types/hono';
import { AdminService } from '../../services/admin.service';
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

import { StandaloneProvider } from '../integration/standalone';
import { PortalProvider } from '../integration/portal';

/**
 * Middleware that injects a lazy-loaded service registry into the Hono context.
 * When env vars for email/AI are absent, falls back to AES-GCM-decrypted DB secrets.
 */
export async function diMiddleware(c: Context<HonoConfig>, next: Next) {
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
                        // Sprint 1 A-4: pass APP_MODE so the service can return
                        // dev-mock suggestions in standalone (local) deployments
                        // when no API key is set, instead of throwing 503.
                        c.env.APP_MODE,
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
                    target.team = new TeamService(c.env.DB, ...(c.env.APP_MODE ? [{ APP_MODE: c.env.APP_MODE }] : []));
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
            }
            return target[prop];
        }
    }));

    await next();
}
