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
// `/agreements/send`, `/comments`). Hono merges each sub-router's OpenAPI + RPC
// types, so `typeof adminRoutes` (exported as `AdminApi`) is preserved for the
// `hono/client` consumers. `server/index.ts` mounts this default export at
// `/api/admin` unchanged.
//
// NOTE: `server/api/admin/branding.ts` is a SEPARATE sub-router mounted directly
// at `/api/admin` by `server/index.ts` (its own `AdminBrandingApi` type), and is
// intentionally NOT aggregated here.
import { createApiRouter } from '../lib/openapi-router';
import adminAgreementsRoutes from './admin/admin-agreements';
import adminEsignRoutes from './admin/admin-esign';
import adminCommentsRoutes from './admin/admin-comments';
import adminDataRoutes from './admin/admin-data';
import adminDataImportRoutes from './admin/admin-data-import';
import adminSettingsRoutes from './admin/admin-settings';
import adminConfigRoutes from './admin/admin-config';
import adminHolidayRoutes from './admin/admin-holidays';

const adminRoutes = createApiRouter()
    .route('/', adminAgreementsRoutes)
    .route('/', adminEsignRoutes)
    .route('/', adminCommentsRoutes)
    .route('/', adminDataRoutes)
    .route('/', adminDataImportRoutes)
    .route('/', adminSettingsRoutes)
    .route('/', adminConfigRoutes)
    .route('/', adminHolidayRoutes);

export type AdminApi = typeof adminRoutes;

// Preserve the named export consumed by `tests/unit/api/admin.communication.spec.ts`
// (and any other `import { validateCommunicationPatch } from '../api/admin'`).
export { validateCommunicationPatch } from './admin/admin-settings';

export default adminRoutes;
