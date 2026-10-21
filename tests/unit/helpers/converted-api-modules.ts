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
 * and fails when a file that exports such a tuple is not listed.
 */
export interface ConvertedApiModule {
    /** Repo-relative path of the router file. */
    file: string;
    load: () => Promise<{ app: Router; configs: readonly RoutePart[] }>;
}

/** The single list to extend when another router file is converted. */
export const CONVERTED_API_MODULES: readonly ConvertedApiModule[] = [
    {
        file: 'server/api/admin.ts',
        load: async () => {
            const m = await import('../../../server/api/admin');
            return { app: m.default, configs: m.adminRouteParts };
        },
    },
    {
        file: 'server/api/admin/admin-agreements.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-agreements');
            return { app: m.default, configs: m.adminAgreementsRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-ai-assurance.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-ai-assurance');
            return { app: m.default, configs: m.adminAiAssuranceRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-booking-routing.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-booking-routing');
            return { app: m.default, configs: m.adminBookingRoutingRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-comments.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-comments');
            return { app: m.default, configs: m.adminCommentsRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-config.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-config');
            return { app: m.default, configs: m.adminConfigRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-content-install.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-content-install');
            return { app: m.default, configs: m.adminContentInstallRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-data-import.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-data-import');
            return { app: m.default, configs: m.adminDataImportRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-data.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-data');
            return { app: m.default, configs: m.adminDataRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-defect-categories.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-defect-categories');
            return { app: m.default, configs: m.adminDefectCategoriesRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-esign.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-esign');
            return { app: m.default, configs: m.adminEsignRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-finding-keys.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-finding-keys');
            return { app: m.default, configs: m.adminFindingKeyRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-holidays.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-holidays');
            return { app: m.default, configs: m.adminHolidayRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-integration-sources.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-integration-sources');
            return { app: m.default, configs: m.adminIntegrationSourcesRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-service-areas.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-service-areas');
            return { app: m.default, configs: m.adminServiceAreasRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-settings.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-settings');
            return { app: m.default, configs: m.adminSettingsRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-signing-key.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-signing-key');
            return { app: m.default, configs: m.adminSigningKeyRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/admin-statutory-source.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/admin-statutory-source');
            return { app: m.default, configs: m.adminStatutorySourceRouteConfigs };
        },
    },
    {
        file: 'server/api/admin/branding.ts',
        load: async () => {
            const m = await import('../../../server/api/admin/branding');
            return { app: m.default, configs: m.adminBrandingRouteConfigs };
        },
    },
    {
        file: 'server/api/agents.ts',
        load: async () => {
            const m = await import('../../../server/api/agents');
            return { app: m.default, configs: m.agentsRouteConfigs };
        },
    },
    {
        file: 'server/api/ai.ts',
        load: async () => {
            const m = await import('../../../server/api/ai');
            return { app: m.default, configs: m.aiRouteConfigs };
        },
    },
    {
        file: 'server/api/analytics.ts',
        load: async () => {
            const m = await import('../../../server/api/analytics');
            return { app: m.default, configs: m.analyticsRouteConfigs };
        },
    },
    {
        file: 'server/api/automations.ts',
        load: async () => {
            const m = await import('../../../server/api/automations');
            return { app: m.default, configs: m.automationsRouteConfigs };
        },
    },
    {
        file: 'server/api/availability.ts',
        load: async () => {
            const m = await import('../../../server/api/availability');
            return { app: m.availabilityRoutes, configs: m.availabilityRouteConfigs };
        },
    },
    {
        file: 'server/api/billing.ts',
        load: async () => {
            const m = await import('../../../server/api/billing');
            return { app: m.default, configs: m.billingRouteConfigs };
        },
    },
    {
        file: 'server/api/calendar-events.ts',
        load: async () => {
            const m = await import('../../../server/api/calendar-events');
            return { app: m.default, configs: m.calendarEventsRouteConfigs };
        },
    },
    {
        file: 'server/api/client.ts',
        load: async () => {
            const m = await import('../../../server/api/client');
            return { app: m.clientRoutes, configs: m.clientRouteConfigs };
        },
    },
    {
        file: 'server/api/concierge.ts',
        load: async () => {
            const m = await import('../../../server/api/concierge');
            return { app: m.default, configs: m.conciergeRouteConfigs };
        },
    },
    {
        file: 'server/api/contacts.ts',
        load: async () => {
            const m = await import('../../../server/api/contacts');
            return { app: m.default, configs: m.contactRouteConfigs };
        },
    },
    {
        file: 'server/api/contacts/import.ts',
        load: async () => {
            const m = await import('../../../server/api/contacts/import');
            return { app: m.default, configs: m.contactsImportRouteConfigs };
        },
    },
    {
        file: 'server/api/contractor-types.ts',
        load: async () => {
            const m = await import('../../../server/api/contractor-types');
            return { app: m.default, configs: m.contractorTypesRouteConfigs };
        },
    },
    {
        file: 'server/api/credentials.ts',
        load: async () => {
            const m = await import('../../../server/api/credentials');
            return { app: m.default, configs: m.credentialsRouteConfigs };
        },
    },
    {
        file: 'server/api/email-templates.ts',
        load: async () => {
            const m = await import('../../../server/api/email-templates');
            return { app: m.default, configs: m.emailTemplateRouteConfigs };
        },
    },
    {
        file: 'server/api/evidence.ts',
        load: async () => {
            const m = await import('../../../server/api/evidence');
            return { app: m.default, configs: m.evidenceRouteConfigs };
        },
    },
    {
        file: 'server/api/inspection-prefs.ts',
        load: async () => {
            const m = await import('../../../server/api/inspection-prefs');
            return { app: m.default, configs: m.inspectionPrefsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspection-requests.ts',
        load: async () => {
            const m = await import('../../../server/api/inspection-requests');
            return { app: m.default, configs: m.inspectionRequestsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections');
            return { app: m.inspectionsRoutes, configs: m.inspectionsRouteParts };
        },
    },
    {
        file: 'server/api/inspections/bulk.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/bulk');
            return { app: m.default, configs: m.bulkRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/cancellation.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/cancellation');
            return { app: m.default, configs: m.cancellationRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/communication.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/communication');
            return { app: m.default, configs: m.communicationRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/compliance.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/compliance');
            return { app: m.default, configs: m.complianceRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/cost-export.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/cost-export');
            return { app: m.default, configs: m.costExportRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/cost-items.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/cost-items');
            return { app: m.default, configs: m.costItemRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/hierarchy.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/hierarchy');
            return { app: m.default, configs: m.hierarchyRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/media-upload-url.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/media-upload-url');
            return { app: m.default, configs: m.mediaUploadUrlRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/media.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/media');
            return { app: m.default, configs: m.mediaRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/pay-splits.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/pay-splits');
            return { app: m.default, configs: m.paySplitRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/people.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/people');
            return { app: m.default, configs: m.peopleRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/repair-requests.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/repair-requests');
            return { app: m.default, configs: m.inspectionRepairRequestRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/report-gate.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/report-gate');
            return { app: m.default, configs: m.reportGateRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/report-translation.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/report-translation');
            return { app: m.default, configs: m.reportTranslationRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/reports.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/reports');
            return { app: m.default, configs: m.inspectionReportRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/results.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/results');
            return { app: m.default, configs: m.resultsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/schedule.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/schedule');
            return { app: m.default, configs: m.scheduleRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/send-sms.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/send-sms');
            return { app: m.default, configs: m.sendSmsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/services.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/services');
            return { app: m.default, configs: m.inspectionServiceRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/statutory-details.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/statutory-details');
            return { app: m.default, configs: m.statutoryDetailsRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/statutory.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/statutory');
            return { app: m.default, configs: m.statutoryRouteConfigs };
        },
    },
    {
        file: 'server/api/inspections/templates.ts',
        load: async () => {
            const m = await import('../../../server/api/inspections/templates');
            return { app: m.default, configs: m.templatesRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations-ai.ts',
        load: async () => {
            const m = await import('../../../server/api/integrations-ai');
            return { app: m.default, configs: m.integrationsAiRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations-overview.ts',
        load: async () => {
            const m = await import('../../../server/api/integrations-overview');
            return { app: m.default, configs: m.integrationsOverviewRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations-test-steps.ts',
        load: async () => {
            const m = await import('../../../server/api/integrations-test-steps');
            return { app: m.default, configs: m.integrationsTestStepsRouteConfigs };
        },
    },
    {
        file: 'server/api/integrations.ts',
        load: async () => {
            const m = await import('../../../server/api/integrations');
            return { app: m.default, configs: m.integrationsRouteParts };
        },
    },
    {
        file: 'server/api/invoices.ts',
        load: async () => {
            const m = await import('../../../server/api/invoices');
            return { app: m.default, configs: m.invoiceRouteParts };
        },
    },
    {
        file: 'server/api/invoices/payments.ts',
        load: async () => {
            const m = await import('../../../server/api/invoices/payments');
            return { app: m.default, configs: m.invoicePaymentRouteConfigs };
        },
    },
    {
        file: 'server/api/mcp-grants.ts',
        load: async () => {
            const m = await import('../../../server/api/mcp-grants');
            return { app: m.default, configs: m.mcpGrantsRouteConfigs };
        },
    },
    {
        file: 'server/api/message-templates.ts',
        load: async () => {
            const m = await import('../../../server/api/message-templates');
            return { app: m.default, configs: m.messageTemplateRouteConfigs };
        },
    },
    {
        file: 'server/api/migration-intake.ts',
        load: async () => {
            const m = await import('../../../server/api/migration-intake');
            return { app: m.default, configs: m.migrationIntakeRouteConfigs };
        },
    },
    {
        file: 'server/api/notification-preferences.ts',
        load: async () => {
            const m = await import('../../../server/api/notification-preferences');
            return { app: m.default, configs: m.notificationPreferenceRouteConfigs };
        },
    },
    {
        file: 'server/api/notifications.ts',
        load: async () => {
            const m = await import('../../../server/api/notifications');
            return { app: m.default, configs: m.notificationsRouteConfigs };
        },
    },
    {
        file: 'server/api/places.ts',
        load: async () => {
            const m = await import('../../../server/api/places');
            return { app: m.default, configs: m.placesRouteConfigs };
        },
    },
    {
        file: 'server/api/profile.ts',
        load: async () => {
            const m = await import('../../../server/api/profile');
            return { app: m.default, configs: m.profileRouteConfigs };
        },
    },
    {
        file: 'server/api/public-report.ts',
        load: async () => {
            const m = await import('../../../server/api/public-report');
            return { app: m.default, configs: m.publicReportRouteParts };
        },
    },
    {
        file: 'server/api/public-share.ts',
        load: async () => {
            const m = await import('../../../server/api/public-share');
            return { app: m.default, configs: m.publicShareRouteConfigs };
        },
    },
    {
        file: 'server/api/public-slug.ts',
        load: async () => {
            const m = await import('../../../server/api/public-slug');
            return { app: m.default, configs: m.publicSlugRouteConfigs };
        },
    },
    {
        file: 'server/api/public/inspector-profile.ts',
        load: async () => {
            const m = await import('../../../server/api/public/inspector-profile');
            return { app: m.default, configs: m.publicInspectorProfileRouteConfigs };
        },
    },
    {
        file: 'server/api/public/verify.ts',
        load: async () => {
            const m = await import('../../../server/api/public/verify');
            return { app: m.default, configs: m.publicVerifyRouteConfigs };
        },
    },
    {
        file: 'server/api/public/view-tracking.ts',
        load: async () => {
            const m = await import('../../../server/api/public/view-tracking');
            return { app: m.default, configs: m.viewTrackingRouteConfigs };
        },
    },
    {
        file: 'server/api/rating-systems.ts',
        load: async () => {
            const m = await import('../../../server/api/rating-systems');
            return { app: m.default, configs: m.ratingSystemsRouteConfigs };
        },
    },
    {
        file: 'server/api/recommendations.ts',
        load: async () => {
            const m = await import('../../../server/api/recommendations');
            return { app: m.default, configs: m.recommendationsRouteConfigs };
        },
    },
    {
        file: 'server/api/repair-builder.ts',
        load: async () => {
            const m = await import('../../../server/api/repair-builder');
            return { app: m.default, configs: m.repairBuilderRouteConfigs };
        },
    },
    {
        file: 'server/api/role-profiles.ts',
        load: async () => {
            const m = await import('../../../server/api/role-profiles');
            return { app: m.default, configs: m.roleProfilesRouteConfigs };
        },
    },
    {
        file: 'server/api/schedule-day-slots.ts',
        load: async () => {
            const m = await import('../../../server/api/schedule-day-slots');
            return { app: m.default, configs: m.scheduleDaySlotsRouteConfigs };
        },
    },
    {
        file: 'server/api/schedule-week-summary.ts',
        load: async () => {
            const m = await import('../../../server/api/schedule-week-summary');
            return { app: m.default, configs: m.scheduleWeekSummaryRouteParts };
        },
    },
    {
        file: 'server/api/secrets.ts',
        load: async () => {
            const m = await import('../../../server/api/secrets');
            return { app: m.default, configs: m.secretsRouteConfigs };
        },
    },
    {
        file: 'server/api/unsubscribe.ts',
        load: async () => {
            const m = await import('../../../server/api/unsubscribe');
            return { app: m.default, configs: m.unsubscribeRouteConfigs };
        },
    },
    {
        file: 'server/api/usage.ts',
        load: async () => {
            const m = await import('../../../server/api/usage');
            return { app: m.default, configs: m.usageRouteConfigs };
        },
    },
    {
        file: 'server/api/users.ts',
        load: async () => {
            const m = await import('../../../server/api/users');
            return { app: m.default, configs: m.userRouteConfigs };
        },
    },
    {
        file: 'server/api/widget.ts',
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

/** A router file the registry must list: it imports the helpers, or it exports a tuple by the usual name. */
export function needsRegistration(source: string): boolean {
    return importsApiSchema(source) || exportsRouteTuple(source);
}
