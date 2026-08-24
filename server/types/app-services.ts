/**
 * The service registry — every service a request can reach, and its type.
 *
 * Split out of `hono.ts` when that file hit the large-file limit at exactly the
 * line a new service needed. The seam is a real one rather than a line count:
 * `hono.ts` describes the WORKER — its bindings, its context variables, the
 * Hono generic — while this file describes what the application layer offers,
 * and the two grow for different reasons. A new Cloudflare binding is not a new
 * service, and a new service is not a new binding.
 *
 * `hono.ts` re-exports `AppServices`, so every existing import site keeps
 * working and nothing has to learn which of the two files the name came from.
 * The registry is realised in `server/lib/middleware/di.ts`, which lazily
 * constructs each member on first access.
 */
import type { AdminService } from '../services/admin.service';
import type { AIService } from '../services/ai.service';
import type { AuthService } from '../services/auth.service';
import type { UserSyncOutbox } from '../lib/integration/user-sync';
import type { BookingService } from '../services/booking.service';
import type { AvailabilityService } from '../services/availability.service';
import type { BrandingService } from '../services/branding.service';
import type { LegalVersionService } from '../services/legal-version.service';
import type { EmailService } from '../services/email.service';
import type { InspectionService } from '../services/inspection.service';
import type { TeamService } from '../services/team.service';
import type { TemplateService } from '../services/template.service';
import type { AgreementService } from '../services/agreement.service';
import type { ContactService } from '../services/contact.service';
import type { InvoiceService } from '../services/invoice.service';
import type { PortalAccessService } from '../services/portal-access.service';
import type { ServiceService } from '../services/service.service';
import type { AutomationService } from '../services/automation.service';
import type { MarketplaceService } from '../services/marketplace.service';
import type { MessageService } from '../services/message.service';
import type { NotificationService } from '../services/notification.service';
import type { WidgetService } from '../services/widget.service';
import type { RecommendationService } from '../services/recommendation.service';
import type { ContractorTypeService } from '../services/contractor-type.service';
import type { CredentialService } from '../services/credential.service';
import type { EventService } from '../services/event.service';
import type { InspectionTypeService } from '../services/inspection-type.service';
import type { TotpService } from '../services/totp.service';
import type { TemplateSeedService } from '../services/template-seed.service';
import type { ReportPdfService } from '../services/report-pdf.service';
import type { ReportExportService } from '../services/report-export.service';
import type { SigningKeyService } from '../services/signing-key.service';
import type { AuditLogService } from '../services/audit-log.service';
import type { ImportHistoryService } from '../services/import-history.service';
import type { InspectionRequestService } from '../services/inspection-request.service';
import type { RatingSystemService } from '../services/rating-system.service';
import type { DashboardPrefsService } from '../services/dashboard-prefs.service';
import type { TagService } from '../services/tag.service';
import type { PropertyLookupService } from '../services/property-lookup.service';
import type { UserService } from '../services/user.service';
import type { IcsService } from '../services/ics.service';
import type { AgentService } from '../services/agent.service';
import type { ConciergeService } from '../services/concierge.service';

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
    /** Immutable version rows for the tenant's own Privacy / Terms (design 6A.3). */
    legalVersion: LegalVersionService;
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
    people: import('../services/people.service').PeopleService;
    portal: import('../services/portal.service').PortalService;
    service: ServiceService;
    automation: AutomationService;
    marketplace: MarketplaceService;
    message: MessageService;
    notification: NotificationService;
    widget: WidgetService;
    recommendation: RecommendationService;
    contractorType: ContractorTypeService;
    credentials: CredentialService;
    event: EventService;
    inspectionType: InspectionTypeService;
    totp: TotpService;
    templateSeed: TemplateSeedService;
    reportPdf: ReportPdfService;
    reportTranslation: import('../services/report-translation.service').ReportTranslationService;
    reportExport: ReportExportService;
    signingKey: SigningKeyService;
    auditLog: AuditLogService;
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
    reportVersion: import('../services/report-version.service').ReportVersionService;
    integrations: import('../services/integrations.service').IntegrationsService;
    analytics: import('../services/analytics.service').AnalyticsService;
    repairRequest: import('../services/repair-request.service').RepairRequestService;
    clientDocument: import('../services/client-document.service').ClientDocumentService;
    compliance: import('../services/compliance/pca-compliance.service').ComplianceService;
}
