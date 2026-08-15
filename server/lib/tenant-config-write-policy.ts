import { getTableColumns } from 'drizzle-orm';
import { tenantConfigs } from './db/schema';
import { Errors } from './errors';
import {
    UpdateBrandingSchema,
    TenantConfigPatchSchema,
    CommunicationPatchSchema,
    TeamDefaultsSchema,
} from './validations/admin/settings';

/**
 * Which `tenant_configs` columns a `BrandingService` write may set.
 *
 * `writeConfig` is a generic upsert over the tenant config row, and it used to
 * write whatever key it was handed. `POST /api/admin/branding` hands it a spread
 * of the whole request body, so every column the service could name was one
 * owner/manager call away — and, where the MCP `extended` tier is on, one tool
 * call away. Refusing one column in the writer (as `is_estimates_shown` did,
 * before it was dropped) never changed the property that made it reachable, so
 * the next sensitive column inherited it. This list is that property, fixed
 * once for all columns.
 *
 * The list is DERIVED, never typed out. Two sources:
 *
 *  1. The request schemas of the endpoints that funnel into the service. A
 *     column is writable because an endpoint declares it writable, so the schema
 *     is the fact and this is a projection of it. A hand-copied second list
 *     drifts the day someone adds a field to a schema — and nothing fails then,
 *     because the schema alone still validates the request. Adding a field to
 *     one of these schemas is the ONE action that makes a column writable.
 *
 *  2. `SERVICE_OWNED_COLUMNS` — the columns the service computes itself, on
 *     paths where nothing about the value is submitted, so there is no request
 *     schema to derive from. Adding a name here is a deliberate, reviewable act.
 *
 * The union is finally intersected with the REAL columns of `tenant_configs`.
 * That is what keeps transient (non-column) schema fields out —
 * `confirmCurrencyChange`, `attestCancellationClause`, `googleOAuthMode` —
 * without naming them anywhere: they are not columns, so they cannot be
 * columns this writer may set. Should one of them ever become a column, its
 * schema entry is already the reason it may be written, and nothing here has
 * to be remembered.
 */
const REQUEST_SCHEMAS = [
    // POST /api/admin/branding (spreads its whole validated body into the service)
    UpdateBrandingSchema,
    // PATCH /api/admin/tenant-config
    TenantConfigPatchSchema,
    // PATCH /api/admin/communication
    CommunicationPatchSchema,
    // PUT /api/team/defaults
    TeamDefaultsSchema,
] as const;

/**
 * Columns written by the service, not by a caller's request body:
 *  - `logoUrl` — `uploadLogo` builds the brand-asset URL from the R2 key it
 *    just wrote; the request carries a file, not a URL.
 *  - `integrationConfig` — `updateIntegrationConfig` merges and re-serialises
 *    the JSON blob; callers pass parsed fields, never the string.
 *  - the attestation triple — `attestCancellationClause` derives id + version +
 *    timestamp from the agreement row it just verified. The request carries the
 *    agreement id only, and it is transient (see `UpdateBrandingSchema`).
 *
 * `satisfies` makes a typo here a type error rather than a 422 at runtime.
 */
const SERVICE_OWNED_COLUMNS = [
    'logoUrl',
    'integrationConfig',
    'cancellationClauseAgreementId',
    'cancellationClauseVersion',
    'cancellationClauseAttestedAt',
] as const satisfies readonly (keyof typeof tenantConfigs.$inferInsert)[];

const TENANT_CONFIG_COLUMNS: ReadonlySet<string> = new Set(Object.keys(getTableColumns(tenantConfigs)));

export const WRITABLE_TENANT_CONFIG_COLUMNS: ReadonlySet<string> = new Set(
    [
        ...REQUEST_SCHEMAS.flatMap((schema) => Object.keys(schema.shape)),
        ...SERVICE_OWNED_COLUMNS,
    ].filter((key) => TENANT_CONFIG_COLUMNS.has(key)),
);

/**
 * Refuse a tenant-config write that names a column no endpoint declares.
 *
 * REFUSED, not silently dropped. A drop turns "I saved it and it did not take"
 * into a question with no evidence anywhere — the request succeeded, the row is
 * unchanged, and nothing in the logs says why. A 422 that names the key answers
 * it at the moment it happens, for the operator AND for the developer who added
 * a field to a service call and forgot the schema. The cost of being wrong the
 * other way is symmetric only in appearance: a wrongly-dropped write is a data
 * bug that surfaces later somewhere else, a wrongly-refused write is a loud
 * error on the line that caused it.
 *
 * `tenantId` and `updatedAt` are stamped by the writer AFTER this check, so
 * they are deliberately not writable input.
 */
export function assertWritableTenantConfig(data: object): void {
    const rejected = Object.keys(data).filter((key) => !WRITABLE_TENANT_CONFIG_COLUMNS.has(key));
    if (rejected.length === 0) return;
    throw Errors.UnprocessableEntity(
        `Not a writable tenant configuration field: ${rejected.join(', ')}. `
        + 'Tenant configuration accepts only the columns declared by a settings request schema '
        + '(see server/lib/tenant-config-write-policy.ts); declare the field there before writing it.',
        { fields: rejected },
    );
}
