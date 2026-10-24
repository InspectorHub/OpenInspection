// Admin API aggregator.
//
// This module is intentionally thin: the ~49 admin routes were split into
// focused sub-routers under `server/api/admin/` (behavior-preserving — the
// handler bodies + route definitions are byte-identical to the original
// single-file router). Each route's `createRoute({...})` definition is
// co-located with its `.openapi()` handler in the owning sub-router, and each
// sub-router imports the dependencies it needs directly — there is no shared
// barrel module.
//
// The sub-routers are mounted at `/` so the external path surface is IDENTICAL
// to the original chain (every route path is absolute, e.g. `/export`,
// `/agreements/send`, `/comments`). The router is registered as plain statements,
// so its typed-client schema (`AdminApi`) is derived from `adminRouteParts` —
// every mounted sub-router, in mount order — and a test pins that list to what
// `app` really mounted (see `server/lib/api-schema.ts`). `server/index.ts`
// mounts this default export at `/api/admin` unchanged.
//
// NOTE: `server/api/admin/branding.ts` is a SEPARATE sub-router mounted directly
// at `/api/admin` by `server/index.ts` (its own `AdminBrandingApi` type), and is
// intentionally NOT aggregated here.
import { createApiRouter } from '../lib/openapi-router';
import { mounted, type ApiOf } from '../lib/api-schema';
import adminAgreementsRoutes, { adminAgreementsRouteConfigs } from './admin/admin-agreements';
import adminEsignRoutes, { adminEsignRouteConfigs } from './admin/admin-esign';
import adminSigningKeyRoutes, { adminSigningKeyRouteConfigs } from './admin/admin-signing-key';
import adminCommentsRoutes, { adminCommentsRouteConfigs } from './admin/admin-comments';
import adminDataRoutes, { adminDataRouteConfigs } from './admin/admin-data';
import adminAiAssuranceRoutes, { adminAiAssuranceRouteConfigs } from './admin/admin-ai-assurance';
import adminDataImportRoutes, { adminDataImportRouteConfigs } from './admin/admin-data-import';
import adminFindingKeyRoutes, { adminFindingKeyRouteConfigs } from './admin/admin-finding-keys';
import adminContentInstallRoutes, { adminContentInstallRouteConfigs } from './admin/admin-content-install';
import adminSettingsRoutes, { adminSettingsRouteConfigs } from './admin/admin-settings';
import adminConfigRoutes, { adminConfigRouteConfigs } from './admin/admin-config';
import adminHolidayRoutes, { adminHolidayRouteConfigs } from './admin/admin-holidays';
import adminServiceAreasRoutes, { adminServiceAreasRouteConfigs } from './admin/admin-service-areas';
import adminBookingRoutingRoutes, { adminBookingRoutingRouteConfigs } from './admin/admin-booking-routing';
import adminStatutorySourceRoutes, { adminStatutorySourceRouteConfigs } from './admin/admin-statutory-source';
import adminIntegrationSourcesRoutes, { adminIntegrationSourcesRouteConfigs } from './admin/admin-integration-sources';

const app = createApiRouter();
app.route('/', adminAgreementsRoutes);
app.route('/', adminEsignRoutes);
app.route('/', adminSigningKeyRoutes);
app.route('/', adminCommentsRoutes);
app.route('/', adminDataRoutes);
app.route('/', adminAiAssuranceRoutes);
app.route('/', adminDataImportRoutes);
app.route('/', adminFindingKeyRoutes);
app.route('/', adminContentInstallRoutes);
app.route('/', adminSettingsRoutes);
app.route('/', adminConfigRoutes);
app.route('/', adminHolidayRoutes);
app.route('/', adminServiceAreasRoutes);
app.route('/', adminBookingRoutingRoutes);
app.route('/', adminStatutorySourceRoutes);
app.route('/', adminIntegrationSourcesRoutes);

/** Registration order, mounts included. Drives `AdminApi`; a test pins it to what `app` really registered. */
export const adminRouteParts = [
    mounted('/', adminAgreementsRoutes, adminAgreementsRouteConfigs),
    mounted('/', adminEsignRoutes, adminEsignRouteConfigs),
    mounted('/', adminSigningKeyRoutes, adminSigningKeyRouteConfigs),
    mounted('/', adminCommentsRoutes, adminCommentsRouteConfigs),
    mounted('/', adminDataRoutes, adminDataRouteConfigs),
    mounted('/', adminAiAssuranceRoutes, adminAiAssuranceRouteConfigs),
    mounted('/', adminDataImportRoutes, adminDataImportRouteConfigs),
    mounted('/', adminFindingKeyRoutes, adminFindingKeyRouteConfigs),
    mounted('/', adminContentInstallRoutes, adminContentInstallRouteConfigs),
    mounted('/', adminSettingsRoutes, adminSettingsRouteConfigs),
    mounted('/', adminConfigRoutes, adminConfigRouteConfigs),
    mounted('/', adminHolidayRoutes, adminHolidayRouteConfigs),
    mounted('/', adminServiceAreasRoutes, adminServiceAreasRouteConfigs),
    mounted('/', adminBookingRoutingRoutes, adminBookingRoutingRouteConfigs),
    mounted('/', adminStatutorySourceRoutes, adminStatutorySourceRouteConfigs),
    mounted('/', adminIntegrationSourcesRoutes, adminIntegrationSourcesRouteConfigs),
] as const;

export type AdminApi = ApiOf<typeof adminRouteParts>;

// Preserve the named export consumed by `tests/unit/api/admin.communication.spec.ts`
// (and any other `import { validateCommunicationPatch } from '../api/admin'`).
export { validateCommunicationPatch } from './admin/admin-settings';

export default app;
