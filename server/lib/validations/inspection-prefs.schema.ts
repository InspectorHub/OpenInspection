/**
 * Workflow shortcuts PR — tenant-level inspector editor preferences.
 *
 * Stored as JSON in `tenant_configs.inspection_prefs`. Validated on every
 * PATCH; server applies DEFAULT_INSPECTION_PREFS when the column is NULL
 * or any field is missing.
 */
import { z } from '@hono/zod-openapi';

export const InspectionPrefsSchema = z.object({
    cloneDefault:       z.enum(['rating', 'rating_notes', 'all']),
    /** B-18 — 'keyboard' (default) advances only on keyboard rating; pointer
     *  clicks stay put. Defaulted so pre-existing rows / full-object payloads
     *  without the field stay valid. */
    autoAdvance:        z.enum(['always', 'keyboard', 'off']).default('keyboard'),
    autoAdvanceDelayMs: z.number().int().min(0).max(2000),
    pinnedTagIds:       z.array(z.string().min(1)).max(5),
    /** Track H (IA-7 / P-6②) — which defect fields the publish gate REQUIRES.
     *  Rides this prefs endpoint but is STORED in its own
     *  `tenant_configs.require_defect_fields` column (the readiness service
     *  reads it directly). Default LOOSE — gaps warn, not block. */
    requireDefectFields: z.enum(['none', 'location', 'trade', 'both']).default('none'),
}).openapi('InspectionPrefs');

export type InspectionPrefs = z.infer<typeof InspectionPrefsSchema>;

/** All fields optional — used by PATCH to support partial updates. */
export const InspectionPrefsPatchSchema = InspectionPrefsSchema.partial().openapi('InspectionPrefsPatch');

export const DEFAULT_INSPECTION_PREFS: InspectionPrefs = {
    cloneDefault:       'rating_notes',
    autoAdvance:        'keyboard',
    autoAdvanceDelayMs: 200,
    pinnedTagIds:       [],
    requireDefectFields: 'none',
};

/** Merge a possibly-partial DB row with the defaults. */
export function withDefaults(row: Partial<InspectionPrefs> | null | undefined): InspectionPrefs {
    return { ...DEFAULT_INSPECTION_PREFS, ...(row ?? {}) };
}
