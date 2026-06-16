import { Context, Next } from 'hono';
import { HonoConfig, AppServices } from '../../types/hono';
import { AdminService } from '../../services/admin.service';
import { UnitService } from '../../services/unit.service';
import { ObserverLinkService } from '../../services/observer-link.service';
import { ReportVersionService } from '../../services/report-version.service';
import { AIService } from '../../services/ai.service';
import { AuthService } from '../../services/auth.service';
import { OutboxService } from '../../portal/outbox.service';
import { publishRow } from '../../portal/outbox.service';
import { BookingService } from '../../services/booking.service';
import { BrandingService } from '../../services/branding.service';
import { assembleTenantEmailService, loadTenantEmailConfig, type LoadedEmailConfig } from '../email/build-email-service';
import { InspectionService } from '../../services/inspection.service';
import { TeamService } from '../../services/team.service';
import { TemplateService } from '../../services/template.service';
import { AgreementService } from '../../services/agreement.service';
import { AvailabilityService } from '../../services/booking.service';
import { ContactService } from '../../services/contact.service';
import { InvoiceService } from '../../services/invoice.service';
import { PortalAccessService } from '../../services/portal-access.service';
import { ServiceService } from '../../services/service.service';
import { AutomationService } from '../../services/automation.service';
import { MarketplaceService } from '../../services/marketplace.service';
import { MessageService } from '../../services/message.service';
import { NotificationService } from '../../services/notification.service';
import { WidgetService } from '../../services/widget.service';
import { RecommendationService } from '../../services/recommendation.service';
import { ContractorTypeService } from '../../services/contractor-type.service';
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
import { RepairRequestService } from '../../services/repair-request.service';
import { StandaloneProvider } from '../integration/standalone';
import { PortalProvider } from '../../portal/portal.provider';

/**
 * Middleware that injects a lazy-loaded service registry into the Hono context.
 * When env vars for email/AI are absent, falls back to AES-GCM-decrypted DB secrets.
 *
 * ORDERING (A-16): registered AFTER the JWT middleware. The tenant-scoped
 * email/AI config below reads `c.get('tenantId')`, which the JWT middleware
 * (authed API) or tenantRouter (standalone / public slug paths) sets — when
 * this middleware ran first, the gate never opened and per-tenant email
 * identity + Gemini BYOK silently fell back to platform defaults on every
 * request. The profile/keyring bootstrap that earlier middlewares need lives
 * in `contextBootstrap` now.
 */
export async function diMiddleware(c: Context<HonoConfig>, next: Next) {
    const tenantId = c.get('tenantId');

    // A-16 — one parallel batch (identity / brand / secrets / overrides)
    // replacing four serial awaits. Only API requests consume these (email
    // sends + AI), so page/asset requests skip the D1 reads entirely. The
    // root-mounted auth duplicates (/forgot-password) send platform-branded
    // mail by design, so the /api/ gate loses nothing there.
    let emailCfg: LoadedEmailConfig = { dbSecrets: {} };
    if (tenantId && c.req.path.startsWith('/api/')) {
        emailCfg = await loadTenantEmailConfig(c.env, tenantId);
    }

    // One place decides own-vs-platform Resend + branded renderer, shared with
    // non-request contexts (workflows/scheduled) via assembleTenantEmailService.
    const buildEmailService = () => assembleTenantEmailService(c.env, emailCfg, c.get('tenantId'));

    // Build the core->portal outbox sink, gated on the SYNC_QUEUE producer
    // binding — the transport itself. No queue → no sink → append() no-ops:
    // standalone never accumulates dead rows, and a misconfigured saas deploy
    // (queue binding missing) fails loudly-by-absence instead of silently
    // queueing rows nothing will ever publish. (The portal Service Binding was
    // retired after the queue migration — the old drain POST was its last
    // functional use; saas-mode detection now reads APP_MODE.)
    // On every append() the freshly-inserted row is pushed to the queue via
    // executionCtx.waitUntil (zero user-facing latency). A send failure is
    // swallowed — the row stays `pending` and the cron sweeper republishes it.
    // AuthService / TeamService stay ignorant of the queue: they only see the
    // UserSyncOutbox.append seam.
    const buildOutbox = (): OutboxService | undefined => {
        const queue = c.env.SYNC_QUEUE;
        if (!queue) return undefined;
        return new OutboxService(c.env.DB, (row) => {
            c.executionCtx.waitUntil(
                publishRow(c.env.DB, queue, row).catch(() => {
                    /* send failed — row stays pending; the sweeper handles it */
                }),
            );
        });
    };

    const services = {} as AppServices;

    c.set('services', new Proxy(services, {
        get(target, prop: keyof AppServices) {
            if (target[prop]) return target[prop];

            switch (prop) {
                case 'admin':
                    {
                        // Provider selection is a deployment-MODE decision
                        // (PortalProvider never fetched the retired binding —
                        // it only encodes saas semantics over DB+KV).
                        const provider = c.env.APP_MODE === 'saas'
                            ? new PortalProvider(c.env.DB, c.env.TENANT_CACHE)
                            : new StandaloneProvider(c.env.DB, c.env.TENANT_CACHE);
                        target.admin = new AdminService(c.env.DB, provider);
                    }
                    break;
                case 'ai':
                    target.ai = new AIService(
                        c.env.DB,
                        // Bring-your-own-key: the Gemini key comes solely from the
                        // tenant's own bound key (Settings → Advanced → AI), never a
                        // shared platform env key — applies to SaaS and standalone.
                        emailCfg.dbSecrets.geminiApiKey || '',
                        // Sprint 1 A-4: pass effective deployment mode so the
                        // service can return dev-mock suggestions when the
                        // active profile permits it (standalone) and
                        // no API key is configured, instead of throwing 503.
                        c.var.profile.aiDevMockFallback ? 'standalone' : 'saas',
                    );
                    break;
                case 'auth':
                    // Outbox forwarding to portal is SaaS-only: buildOutbox
                    // returns undefined when SYNC_QUEUE is absent (standalone)
                    // → AuthService.append no-ops (guarded by `if (this.outbox)`),
                    // so no portal code runs and no dead sync_outbox rows accumulate.
                    target.auth = new AuthService(
                        c.env.DB,
                        c.env.TENANT_CACHE,
                        buildOutbox(),
                    );
                    break;
                case 'outbox':
                    // SaaS-only: concrete sink exists only when SYNC_QUEUE is
                    // bound. Standalone leaves it undefined (keeps standalone
                    // free of server/portal/ code by construction, not by accident).
                    target.outbox = buildOutbox();
                    break;
                case 'booking':
                    target.booking = new BookingService(c.env.DB);
                    break;
                case 'branding':
                    target.branding = new BrandingService(c.env.DB, c.env.TENANT_CACHE);
                    break;
                case 'email':
                    target.email = buildEmailService();
                    break;
                case 'inspection':
                    target.inspection = new InspectionService(c.env.DB, c.env.PHOTOS, c.get('sdb'), c.env.TENANT_CACHE);
                    break;
                case 'team':
                    // Member removal emits `user.deleted` through the same
                    // SaaS-only outbox sink (undefined in standalone → no-op).
                    target.team = new TeamService(c.env.DB, buildOutbox());
                    break;
                case 'template':
                    target.template = new TemplateService(c.env.DB);
                    break;
                case 'agreement':
                    target.agreement = new AgreementService(c.env.DB, {
                        jwtSecret: c.env.JWT_SECRET,
                        ...(c.env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: c.env.JWT_SECRET_PREVIOUS } : {}),
                    });
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
                case 'portalAccess':
                    target.portalAccess = new PortalAccessService(c.env.DB, {
                        jwtSecret: c.env.JWT_SECRET,
                        ...(c.env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: c.env.JWT_SECRET_PREVIOUS } : {}),
                    });
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
                case 'contractorType':
                    target.contractorType = new ContractorTypeService(c.env.DB);
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
                    target.reportPdf = new ReportPdfService(c.env.DB, c.env.BROWSER, c.env.PHOTOS);
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
                            target.email = buildEmailService();
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
                            target.email = buildEmailService();
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
                    target.observerLink = new ObserverLinkService(c.env.DB, {
                        jwtSecret: c.env.JWT_SECRET,
                        ...(c.env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: c.env.JWT_SECRET_PREVIOUS } : {}),
                    });
                    break;
                case 'reportVersion':
                    target.reportVersion = new ReportVersionService(c.env.DB, c.env.KEY_ENCRYPTION_SECRET || c.env.JWT_SECRET);
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
                case 'repairRequest':
                    target.repairRequest = new RepairRequestService(c.env.DB);
                    break;
            }
            return target[prop];
        }
    }));

    await next();
}
