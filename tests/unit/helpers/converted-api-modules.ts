import type { RoutePart } from '../../../server/lib/api-schema';
import type { createApiRouter } from '../../../server/lib/openapi-router';

type Router = ReturnType<typeof createApiRouter>;

/**
 * A router file written as plain `app.openapi(route, handler)` / `app.route(prefix, child)` statements.
 *
 * Its typed-client schema (`XxxApi`) is derived from `xxxRouteConfigs` / `xxxRouteParts` (see
 * `server/lib/api-schema.ts`), not from the registrations, so the two can drift: a route registered but
 * left out of the tuple, or a child router mounted but left out, vanishes from the client without a
 * compile error. `api-route-configs.spec.ts` pins the tuple to the registry for every module listed here,
 * and fails when a router in a file that exports such a tuple is not listed.
 *
 * A file may hold several routers: it is listed once per router, each entry naming its own tuple.
 */
export interface ConvertedApiModule {
    /** Repo-relative path of the router file. */
    file: string;
    /** The exported name of this router's tuple; a file with several routers has one entry per tuple. */
    tuple: string;
    /**
     * Plain (non-OpenAPI) handlers the router registers after its route configs, as Hono dispatches them
     * (`method path`, method lowercased, path with `:param`). They are not in the tuple and not in the typed client;
     * listing them here keeps the dispatch comparison exact instead of excusing it.
     */
    native?: readonly string[];
    load: () => Promise<{ app: Router; configs: readonly RoutePart[] }>;
}

/** The single list to extend when another router is converted (one entry per router, not per file). */
export const CONVERTED_API_MODULES: readonly ConvertedApiModule[] = [
    {
        file: 'server/api/admin.ts',
        tuple: 'adminRouteParts',
        load: async () => {
            const m = await import('../../../server/api/admin');
            return { app: m.default, configs: m.adminRouteParts };
        },
    },
    {
        file: 'server/api/admin/admin-agreements.ts',
        tuple: 'adminAgreementsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-agreements');
            return { app: m.default, configs: m.adminAgreementsRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-ai-assurance.ts',
        tuple: 'adminAiAssuranceRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-ai-assurance');
            return { app: m.default, configs: m.adminAiAssuranceRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-booking-routing.ts',
        tuple: 'adminBookingRoutingRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-booking-routing');
            return { app: m.default, configs: m.adminBookingRoutingRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-comments.ts',
        tuple: 'adminCommentsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-comments');
            return { app: m.default, configs: m.adminCommentsRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-config.ts',
        tuple: 'adminConfigRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-config');
            return { app: m.default, configs: m.adminConfigRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-content-install.ts',
        tuple: 'adminContentInstallRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-content-install');
            return { app: m.default, configs: m.adminContentInstallRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-data-import.ts',
        tuple: 'adminDataImportRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-data-import');
            return { app: m.default, configs: m.adminDataImportRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-data.ts',
        tuple: 'adminDataRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-data');
            return { app: m.default, configs: m.adminDataRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-defect-categories.ts',
        tuple: 'adminDefectCategoriesRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-defect-categories');
            return { app: m.default, configs: m.adminDefectCategoriesRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-esign.ts',
        tuple: 'adminEsignRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-esign');
            return { app: m.default, configs: m.adminEsignRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-finding-keys.ts',
        tuple: 'adminFindingKeyRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-finding-keys');
            return { app: m.default, configs: m.adminFindingKeyRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-holidays.ts',
        tuple: 'adminHolidayRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-holidays');
            return { app: m.default, configs: m.adminHolidayRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-integration-sources.ts',
        tuple: 'adminIntegrationSourcesRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-integration-sources');
            return { app: m.default, configs: m.adminIntegrationSourcesRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-service-areas.ts',
        tuple: 'adminServiceAreasRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-service-areas');
            return { app: m.default, configs: m.adminServiceAreasRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-settings.ts',
        tuple: 'adminSettingsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-settings');
            return { app: m.default, configs: m.adminSettingsRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-signing-key.ts',
        tuple: 'adminSigningKeyRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-signing-key');
            return { app: m.default, configs: m.adminSigningKeyRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-statutory-source.ts',
        tuple: 'adminStatutorySourceRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-statutory-source');
            return { app: m.default, configs: m.adminStatutorySourceRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/branding.ts',
        tuple: 'adminBrandingRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/admin/branding');
            return { app: m.default, configs: m.adminBrandingRouteConfigs };
        },
    },
    {
        file: 'server/api/agents.ts',
        tuple: 'agentsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/agents');
            return { app: m.default, configs: m.agentsRouteConfigs };
        },
    },
    {
        file: 'server/api/ai.ts',
        tuple: 'aiRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/ai');
            return { app: m.default, configs: m.aiRouteConfigs };
        },
    },
    {
        file: 'server/api/analytics.ts',
        tuple: 'analyticsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/analytics');
            return { app: m.default, configs: m.analyticsRouteConfigs };
        },
    },
    {
        file: 'server/api/audit.ts',
        tuple: 'auditRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/audit');
            return { app: m.default, configs: m.auditRouteConfigs };
        },
    },
    {
        file: 'server/api/auth.ts',
        tuple: 'coreAuthRouteParts',
        load: async () => {
            const m = await import('../../../server/api/auth');
            return { app: m.default, configs: m.coreAuthRouteParts };
        },
    },
    {
        file: 'server/api/auth/profile.ts',
        tuple: 'profileRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/auth/profile');
            return { app: m.default, configs: m.profileRouteConfigs };
        },
    },
    {
        file: 'server/api/auth/totp.ts',
        tuple: 'totpRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/auth/totp');
            return { app: m.default, configs: m.totpRouteConfigs };
        },
    },
    {
        file: 'server/api/automations.ts',
        tuple: 'automationsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/automations');
            return { app: m.default, configs: m.automationsRouteConfigs };
        },
    },
    {
        file: 'server/api/availability.ts',
        tuple: 'availabilityRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/availability');
            return { app: m.availabilityRoutes, configs: m.availabilityRouteConfigs };
        },
    },
    {
        file: 'server/api/billing.ts',
        tuple: 'billingRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/billing');
            return { app: m.default, configs: m.billingRouteConfigs };
        },
    },
    {
        file: 'server/api/bookings.ts',
        tuple: 'bookingsRouteParts',
        load: async () => {
            const m = await import('../../../server/api/bookings');
            return { app: m.bookingsRoutes, configs: m.bookingsRouteParts };
        },
    },
    {
        file: 'server/api/bookings/create.ts',
        tuple: 'createBookingRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/bookings/create');
            return { app: m.default, configs: m.createBookingRouteConfigs };
        },
    },
    {
        file: 'server/api/bookings/geocode.ts',
        tuple: 'publicGeocodeRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/bookings/geocode');
            return { app: m.default, configs: m.publicGeocodeRouteConfigs };
        },
    },
    {
        file: 'server/api/calendar-blocks.ts',
        tuple: 'calendarBlockRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/calendar-blocks');
            return { app: m.default, configs: m.calendarBlockRouteConfigs };
        },
    },
    {
        file: 'server/api/calendar-events.ts',
        tuple: 'calendarEventsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/calendar-events');
            return { app: m.default, configs: m.calendarEventsRouteConfigs };
        },
    },
    {
        file: 'server/api/calendar-items.ts',
        tuple: 'calendarItemsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/calendar-items');
            return { app: m.default, configs: m.calendarItemsRouteConfigs };
        },
    },
    {
        file: 'server/api/calendar.ts',
        tuple: 'calendarRouteParts',
        load: async () => {
            const m = await import('../../../server/api/calendar');
            return { app: m.default, configs: m.calendarRouteParts };
        },
    },
    {
        file: 'server/api/client.ts',
        tuple: 'clientRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/client');
            return { app: m.clientRoutes, configs: m.clientRouteConfigs };
        },
    },
    {
        file: 'server/api/concierge.ts',
        tuple: 'conciergeRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/concierge');
            return { app: m.default, configs: m.conciergeRouteConfigs };
        },
    },
    {
        file: 'server/api/contacts.ts',
        tuple: 'contactRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/contacts');
            return { app: m.default, configs: m.contactRouteConfigs };
        },
    },
    {
        file: 'server/api/contacts/import.ts',
        tuple: 'contactsImportRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/contacts/import');
            return { app: m.default, configs: m.contactsImportRouteConfigs };
        },
    },
    {
        file: 'server/api/contractor-types.ts',
        tuple: 'contractorTypesRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/contractor-types');
            return { app: m.default, configs: m.contractorTypesRouteConfigs };
        },
    },
    {
        file: 'server/api/credentials.ts',
        tuple: 'credentialsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/credentials');
            return { app: m.default, configs: m.credentialsRouteConfigs };
        },
    },
    {
        file: 'server/api/email-templates.ts',
        tuple: 'emailTemplateRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/email-templates');
            return { app: m.default, configs: m.emailTemplateRouteConfigs };
        },
    },
    {
        file: 'server/api/evidence.ts',
        tuple: 'evidenceRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/evidence');
            return { app: m.default, configs: m.evidenceRouteConfigs };
        },
    },
    {
        file: 'server/api/inspection-prefs.ts',
        tuple: 'inspectionPrefsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspection-prefs');
            return { app: m.default, configs: m.inspectionPrefsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspection-requests.ts',
        tuple: 'inspectionRequestsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspection-requests');
            return { app: m.default, configs: m.inspectionRequestsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspection-sync.ts',
        tuple: 'syncRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspection-sync');
            return { app: m.default, configs: m.syncRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections.ts',
        tuple: 'inspectionsRouteParts',
        load: async () => {
            const m = await import('../../../server/api/inspections');
            return { app: m.inspectionsRoutes, configs: m.inspectionsRouteParts };
        },
    },
    {
        file: 'server/api/inspections/bulk.ts',
        tuple: 'bulkRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/bulk');
            return { app: m.default, configs: m.bulkRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/cancellation.ts',
        tuple: 'cancellationRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/cancellation');
            return { app: m.default, configs: m.cancellationRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/communication.ts',
        tuple: 'communicationRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/communication');
            return { app: m.default, configs: m.communicationRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/compliance.ts',
        tuple: 'complianceRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/compliance');
            return { app: m.default, configs: m.complianceRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/cost-export.ts',
        tuple: 'costExportRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/cost-export');
            return { app: m.default, configs: m.costExportRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/cost-items.ts',
        tuple: 'costItemRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/cost-items');
            return { app: m.default, configs: m.costItemRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/hierarchy.ts',
        tuple: 'hierarchyRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/hierarchy');
            return { app: m.default, configs: m.hierarchyRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/media-studio.ts',
        tuple: 'mediaStudioRouteConfigs',
        native: [
            'post /:id/media/video/r2-upload',
            'post /:id/media/video/r2-upload-poster',
            'get /:id/media/video/r2-object/:mediaId',
            'get /:id/media/video/r2-object/:mediaId/poster',
        ],
        load: async () => {
            const m = await import('../../../server/api/inspections/media-studio');
            return { app: m.default, configs: m.mediaStudioRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/media-upload-url.ts',
        tuple: 'mediaUploadUrlRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/media-upload-url');
            return { app: m.default, configs: m.mediaUploadUrlRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/media.ts',
        tuple: 'mediaRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/media');
            return { app: m.default, configs: m.mediaRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/pay-splits.ts',
        tuple: 'paySplitRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/pay-splits');
            return { app: m.default, configs: m.paySplitRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/people.ts',
        tuple: 'peopleRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/people');
            return { app: m.default, configs: m.peopleRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/publish.ts',
        tuple: 'publishRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/publish');
            return { app: m.default, configs: m.publishRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/repair-requests.ts',
        tuple: 'inspectionRepairRequestRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/repair-requests');
            return { app: m.default, configs: m.inspectionRepairRequestRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/report-delivery.ts',
        tuple: 'reportDeliveryRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/report-delivery');
            return { app: m.default, configs: m.reportDeliveryRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/report-gate.ts',
        tuple: 'reportGateRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/report-gate');
            return { app: m.default, configs: m.reportGateRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/report-translation.ts',
        tuple: 'reportTranslationRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/report-translation');
            return { app: m.default, configs: m.reportTranslationRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/reports.ts',
        tuple: 'inspectionReportRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/reports');
            return { app: m.default, configs: m.inspectionReportRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/results.ts',
        tuple: 'resultsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/results');
            return { app: m.default, configs: m.resultsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/schedule.ts',
        tuple: 'scheduleRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/schedule');
            return { app: m.default, configs: m.scheduleRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/send-sms.ts',
        tuple: 'sendSmsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/send-sms');
            return { app: m.default, configs: m.sendSmsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/services.ts',
        tuple: 'inspectionServiceRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/services');
            return { app: m.default, configs: m.inspectionServiceRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/statutory-details.ts',
        tuple: 'statutoryDetailsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/statutory-details');
            return { app: m.default, configs: m.statutoryDetailsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/statutory.ts',
        tuple: 'statutoryRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/statutory');
            return { app: m.default, configs: m.statutoryRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/templates.ts',
        tuple: 'templatesRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/inspections/templates');
            return { app: m.default, configs: m.templatesRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations-ai.ts',
        tuple: 'integrationsAiRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/integrations-ai');
            return { app: m.default, configs: m.integrationsAiRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations-overview.ts',
        tuple: 'integrationsOverviewRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/integrations-overview');
            return { app: m.default, configs: m.integrationsOverviewRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations-test-steps.ts',
        tuple: 'integrationsTestStepsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/integrations-test-steps');
            return { app: m.default, configs: m.integrationsTestStepsRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations.ts',
        tuple: 'integrationsRouteParts',
        load: async () => {
            const m = await import('../../../server/api/integrations');
            return { app: m.default, configs: m.integrationsRouteParts };
        },
    },
    {
        file: 'server/api/invoices.ts',
        tuple: 'invoiceRouteParts',
        load: async () => {
            const m = await import('../../../server/api/invoices');
            return { app: m.default, configs: m.invoiceRouteParts };
        },
    },
    {
        file: 'server/api/invoices/payments.ts',
        tuple: 'invoicePaymentRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/invoices/payments');
            return { app: m.default, configs: m.invoicePaymentRouteConfigs };
        },
    },
    {
        file: 'server/api/marketplace.ts',
        tuple: 'marketplaceRouteParts',
        load: async () => {
            const m = await import('../../../server/api/marketplace');
            return { app: m.default, configs: m.marketplaceRouteParts };
        },
    },
    {
        file: 'server/api/marketplace/statutory-update.ts',
        tuple: 'statutoryUpdateRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/marketplace/statutory-update');
            return { app: m.default, configs: m.statutoryUpdateRouteConfigs };
        },
    },
    {
        file: 'server/api/marketplace/sub-routes.ts',
        tuple: 'marketplaceSubRouteParts',
        load: async () => {
            const m = await import('../../../server/api/marketplace/sub-routes');
            return { app: m.default, configs: m.marketplaceSubRouteParts };
        },
    },
    {
        file: 'server/api/marketplace/uninstall.ts',
        tuple: 'marketplaceUninstallRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/marketplace/uninstall');
            return { app: m.default, configs: m.marketplaceUninstallRouteConfigs };
        },
    },
    {
        file: 'server/api/mcp-grants.ts',
        tuple: 'mcpGrantsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/mcp-grants');
            return { app: m.default, configs: m.mcpGrantsRouteConfigs };
        },
    },
    {
        file: 'server/api/message-templates.ts',
        tuple: 'messageTemplateRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/message-templates');
            return { app: m.default, configs: m.messageTemplateRouteConfigs };
        },
    },
    {
        file: 'server/api/messages-threads.ts',
        tuple: 'messageThreadRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/messages-threads');
            return { app: m.messageThreadRoutes, configs: m.messageThreadRouteConfigs };
        },
    },
    {
        file: 'server/api/messages.ts',
        tuple: 'inspectorMessageRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/messages');
            return { app: m.inspectorMessageRoutes, configs: m.inspectorMessageRouteConfigs };
        },
    },
    {
        file: 'server/api/messages.ts',
        tuple: 'messageRouteParts',
        load: async () => {
            const m = await import('../../../server/api/messages');
            return { app: m.default, configs: m.messageRouteParts };
        },
    },
    {
        file: 'server/api/metrics.ts',
        tuple: 'metricsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/metrics');
            return { app: m.default, configs: m.metricsRouteConfigs };
        },
    },
    {
        file: 'server/api/migration-intake.ts',
        tuple: 'migrationIntakeRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/migration-intake');
            return { app: m.default, configs: m.migrationIntakeRouteConfigs };
        },
    },
    {
        file: 'server/api/notification-preferences.ts',
        tuple: 'notificationPreferenceRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/notification-preferences');
            return { app: m.default, configs: m.notificationPreferenceRouteConfigs };
        },
    },
    {
        file: 'server/api/notifications.ts',
        tuple: 'notificationsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/notifications');
            return { app: m.default, configs: m.notificationsRouteConfigs };
        },
    },
    {
        file: 'server/api/places.ts',
        tuple: 'placesRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/places');
            return { app: m.default, configs: m.placesRouteConfigs };
        },
    },
    {
        file: 'server/api/profile.ts',
        tuple: 'profileRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/profile');
            return { app: m.default, configs: m.profileRouteConfigs };
        },
    },
    {
        file: 'server/api/public-report.ts',
        tuple: 'publicReportRouteParts',
        load: async () => {
            const m = await import('../../../server/api/public-report');
            return { app: m.default, configs: m.publicReportRouteParts };
        },
    },
    {
        file: 'server/api/public-share.ts',
        tuple: 'publicShareRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/public-share');
            return { app: m.default, configs: m.publicShareRouteConfigs };
        },
    },
    {
        file: 'server/api/public-slug.ts',
        tuple: 'publicSlugRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/public-slug');
            return { app: m.default, configs: m.publicSlugRouteConfigs };
        },
    },
    {
        file: 'server/api/public/deposit-intent.ts',
        tuple: 'depositIntentRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/public/deposit-intent');
            return { app: m.default, configs: m.depositIntentRouteConfigs };
        },
    },
    {
        file: 'server/api/public/inspector-profile.ts',
        tuple: 'publicInspectorProfileRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/public/inspector-profile');
            return { app: m.default, configs: m.publicInspectorProfileRouteConfigs };
        },
    },
    {
        file: 'server/api/public/verify.ts',
        tuple: 'publicVerifyRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/public/verify');
            return { app: m.default, configs: m.publicVerifyRouteConfigs };
        },
    },
    {
        file: 'server/api/public/view-tracking.ts',
        tuple: 'viewTrackingRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/public/view-tracking');
            return { app: m.default, configs: m.viewTrackingRouteConfigs };
        },
    },
    {
        file: 'server/api/rating-systems.ts',
        tuple: 'ratingSystemsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/rating-systems');
            return { app: m.default, configs: m.ratingSystemsRouteConfigs };
        },
    },
    {
        file: 'server/api/recommendations.ts',
        tuple: 'recommendationsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/recommendations');
            return { app: m.default, configs: m.recommendationsRouteConfigs };
        },
    },
    {
        file: 'server/api/repair-builder.ts',
        tuple: 'repairBuilderRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/repair-builder');
            return { app: m.default, configs: m.repairBuilderRouteConfigs };
        },
    },
    {
        file: 'server/api/role-profiles.ts',
        tuple: 'roleProfilesRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/role-profiles');
            return { app: m.default, configs: m.roleProfilesRouteConfigs };
        },
    },
    {
        file: 'server/api/schedule-day-slots.ts',
        tuple: 'scheduleDaySlotsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/schedule-day-slots');
            return { app: m.default, configs: m.scheduleDaySlotsRouteConfigs };
        },
    },
    {
        file: 'server/api/schedule-week-summary.ts',
        tuple: 'scheduleWeekSummaryRouteParts',
        load: async () => {
            const m = await import('../../../server/api/schedule-week-summary');
            return { app: m.default, configs: m.scheduleWeekSummaryRouteParts };
        },
    },
    {
        file: 'server/api/secrets.ts',
        tuple: 'secretsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/secrets');
            return { app: m.default, configs: m.secretsRouteConfigs };
        },
    },
    {
        file: 'server/api/services.ts',
        tuple: 'servicesRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/services');
            return { app: m.servicesRoutes, configs: m.servicesRouteConfigs };
        },
    },
    {
        file: 'server/api/sms.ts',
        tuple: 'smsAdminRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/sms');
            return { app: m.smsAdminRoutes, configs: m.smsAdminRouteConfigs };
        },
    },
    {
        file: 'server/api/sms.ts',
        tuple: 'smsPublicRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/sms');
            return { app: m.smsPublicRoutes, configs: m.smsPublicRouteConfigs };
        },
    },
    {
        file: 'server/api/tags.ts',
        tuple: 'inspectionTagRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/tags');
            return { app: m.inspectionTagRoutes, configs: m.inspectionTagRouteConfigs };
        },
    },
    {
        file: 'server/api/tags.ts',
        tuple: 'tagsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/tags');
            return { app: m.default, configs: m.tagsRouteConfigs };
        },
    },
    {
        file: 'server/api/team-defaults.ts',
        tuple: 'teamDefaultsRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/team-defaults');
            return { app: m.default, configs: m.teamDefaultsRouteConfigs };
        },
    },
    {
        file: 'server/api/team-permission-templates.ts',
        tuple: 'teamPermissionTemplateRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/team-permission-templates');
            return { app: m.default, configs: m.teamPermissionTemplateRouteConfigs };
        },
    },
    {
        file: 'server/api/team-two-factor.ts',
        tuple: 'teamTwoFactorRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/team-two-factor');
            return { app: m.default, configs: m.teamTwoFactorRouteConfigs };
        },
    },
    {
        file: 'server/api/team.ts',
        tuple: 'teamRouteParts',
        load: async () => {
            const m = await import('../../../server/api/team');
            return { app: m.default, configs: m.teamRouteParts };
        },
    },
    {
        file: 'server/api/unsubscribe.ts',
        tuple: 'unsubscribeRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/unsubscribe');
            return { app: m.default, configs: m.unsubscribeRouteConfigs };
        },
    },
    {
        file: 'server/api/usage.ts',
        tuple: 'usageRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/usage');
            return { app: m.default, configs: m.usageRouteConfigs };
        },
    },
    {
        file: 'server/api/users.ts',
        tuple: 'userRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/users');
            return { app: m.default, configs: m.userRouteConfigs };
        },
    },
    {
        file: 'server/api/widget.ts',
        tuple: 'widgetRouteConfigs',
        load: async () => {
            const m = await import('../../../server/api/widget');
            return { app: m.default, configs: m.widgetRouteConfigs };
        },
    },
];

/**
 * Whether a router file's source imports `ApiOf` or `mounted` from `lib/api-schema`, by any relative path
 * (`../lib/api-schema`, `../../lib/api-schema`, with or without `type`). A file that does derives its client
 * type from a tuple, whatever the tuple is called, so it has to be listed in CONVERTED_API_MODULES.
 */
export function importsApiSchema(source: string): boolean {
    const importFrom = /import\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+)\s*from\s*['"]\.{1,2}\/(?:[\w.-]+\/)*api-schema['"]/g;
    for (const match of source.matchAll(importFrom)) {
        const specifiers = match[1] ?? '';
        if (specifiers.startsWith('*') || /\b(?:ApiOf|mounted)\b/.test(specifiers)) return true;
    }
    return false;
}

/** The by-name check the scan started with: an exported `xxxRouteConfigs` / `xxxRouteParts` tuple. */
export function exportsRouteTuple(source: string): boolean {
    return /^export const \w+(?:RouteConfigs|RouteParts) = \[/m.test(source);
}

/**
 * Every tuple a file derives a client type from: the one named in each `ApiOf<typeof X>`, plus each exported
 * `xxxRouteConfigs` / `xxxRouteParts` list. A file with several converted routers has several, and each must
 * have its own entry in CONVERTED_API_MODULES.
 */
export function routerTuples(source: string): string[] {
    const names = new Set<string>();
    for (const m of source.matchAll(/ApiOf<\s*typeof\s+(\w+)/g)) names.add(m[1] ?? '');
    for (const m of source.matchAll(/^export const (\w+(?:RouteConfigs|RouteParts)) = \[/gm)) names.add(m[1] ?? '');
    return [...names].sort();
}

/** A router file the registry must list: it imports the helpers, or it exports a tuple by the usual name. */
export function needsRegistration(source: string): boolean {
    return importsApiSchema(source) || exportsRouteTuple(source);
}
