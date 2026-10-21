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
        file: 'server/api/billing.ts',
        load: async () => {
            const m = await import('../../../server/api/billing');
            return { app: m.default, configs: m.billingRouteConfigs };
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
        file: 'server/api/integrations-overview.ts',
        load: async () => {
            const m = await import('../../../server/api/integrations-overview');
            return { app: m.default, configs: m.integrationsOverviewRouteConfigs };
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
        file: 'server/api/public-report.ts',
        load: async () => {
            const m = await import('../../../server/api/public-report');
            return { app: m.default, configs: m.publicReportRouteParts };
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
        file: 'server/api/repair-builder.ts',
        load: async () => {
            const m = await import('../../../server/api/repair-builder');
            return { app: m.default, configs: m.repairBuilderRouteConfigs };
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
        file: 'server/api/usage.ts',
        load: async () => {
            const m = await import('../../../server/api/usage');
            return { app: m.default, configs: m.usageRouteConfigs };
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
