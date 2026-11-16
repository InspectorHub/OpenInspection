/**
 * Table classification for the tenant data package.
 *
 * One entry per table in `server/lib/db/schema`, split by family so no file
 * grows past the size gate. The aggregate below is what the exporter, the
 * importer and the coverage spec read. See `classification-types.ts` for the
 * dispositions and for why a missing decision is a failure, not a default.
 */
import { BUSINESS_FAMILY } from './classification-business';
import { INSPECTION_FAMILY } from './classification-inspection';
import { TENANT_FAMILY } from './classification-tenant';
import type { ClassifiedTable } from './classification-types';

export const CLASSIFICATION: readonly ClassifiedTable[] = [...TENANT_FAMILY, ...INSPECTION_FAMILY, ...BUSINESS_FAMILY];
