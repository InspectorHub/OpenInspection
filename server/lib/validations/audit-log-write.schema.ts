import { z } from '@hono/zod-openapi';
import { AUDIT_FAMILIES } from '../audit-families';

/**
 * Request schemas for `POST /api/admin/audit-logs` — the one route where an
 * audit event arrives from OUTSIDE the process.
 *
 * A separate module from `audit.schema.ts`, which holds the READ side (the
 * entity change-history endpoint). Kept apart because the two have opposite
 * trust properties: the read schemas describe what we hand out, and these
 * describe what a caller may write into the trail.
 */

/**
 * The audit actions an INSPECTOR-driven request may record.
 *
 * Deliberately a one-item enum. The endpoint exists so the offline conflict
 * modal can record its own resolution; every other audit action is written
 * server-side by the code that performed the thing, and a client that can name
 * its own action can write a trail that never happened.
 *
 * It is also why `scripts/check-audit-registry.mjs` reads this file: the action
 * never appears as a literal at the call site, so a walk for literals alone
 * would report `inspection.sync_conflict_resolved` as written nowhere. A first
 * survey did exactly that and nearly deleted a live action.
 */
const InspectorAuditActionSchema = z.enum(['inspection.sync_conflict_resolved']);

/**
 * The entity family the recorded action touched.
 *
 * Was `z.string().min(1).max(64)`, which let a caller put any 64 characters
 * into `audit_logs.entity_type` — the column the admin audit list filters on.
 * The write helpers now type it as `AuditFamily`, and because this value
 * crosses the process boundary it is the one place a type cannot narrow it.
 */
const AuditFamilySchema = z.enum(AUDIT_FAMILIES);

/** Body of `POST /api/admin/audit-logs`. */
export const InspectorAuditLogSchema = z.object({
    action: InspectorAuditActionSchema.describe('The audit action to record. Constrained to the actions an inspector-driven request may write.'),
    resourceType: AuditFamilySchema.describe('The entity family the action touched.'),
    resourceId: z.string().min(1).max(128).describe('Id of the entity the action touched.'),
    detail: z.record(z.string(), z.unknown()).optional().describe('Free-form metadata. Redacted by value shape at write time.'),
}).describe('An inspector-driven audit event.');
