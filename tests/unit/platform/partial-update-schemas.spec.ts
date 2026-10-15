/**
 * A partial update must leave unspecified fields alone. zod keeps a field's
 * `.default()` under `.partial()`, so an omitted field is parsed as PRESENT with its
 * default and the handler then overwrites the stored value with it.
 */
import { describe, it, expect } from 'vitest';
import { UpdateDefectCategorySchema } from '../../../server/lib/validations/defect-category.schema';
import { UpdateInspectionTypeSchema } from '../../../server/lib/validations/inspection-type.schema';
import { UpdateRatingSystemSchema } from '../../../server/lib/validations/rating-system.schema';
import { InspectionPrefsPatchSchema } from '../../../server/lib/validations/inspection-prefs.schema';

describe('partial update schemas carry only what the caller sent', () => {
    it.each([
        ['defect category', UpdateDefectCategorySchema, { name: 'Safety' }],
        ['inspection type', UpdateInspectionTypeSchema, { name: 'Medical Office' }],
        ['rating system', UpdateRatingSystemSchema, { name: 'Five star' }],
        ['inspection prefs', InspectionPrefsPatchSchema, { autoAdvance: 'off' }],
    ] as const)('%s: an omitted field is absent from the parsed body', (_label, schema, input) => {
        const parsed = schema.safeParse(input);
        expect(parsed.success).toBe(true);
        expect(parsed.data).toEqual(input);
    });

    it.each([
        ['defect category', UpdateDefectCategorySchema, { color: '#112233', drivesSummary: false }],
        ['inspection type', UpdateInspectionTypeSchema, { sortOrder: 7 }],
        ['rating system', UpdateRatingSystemSchema, { isDefault: true }],
    ] as const)('%s: a field that IS sent is kept (positive control)', (_label, schema, input) => {
        expect(schema.safeParse(input).data).toEqual(input);
    });
});
