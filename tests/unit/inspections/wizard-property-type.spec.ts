/**
 * POST /api/inspections/wizard stores the property type it is given in inspections.property_type, the same column every other way of
 * creating or editing an inspection writes. It must therefore accept exactly the values that column holds (single_family, multi_unit,
 * commercial) and refuse any other, so the property type control, the report tier and the typed contract all see one vocabulary.
 */
import { describe, it, expect } from 'vitest';
import { INSPECTION_PROPERTY_TYPES } from '@core/field-ui/shared/inspection-property-type';
import { PLATFORM_SUBTYPES } from '@core/field-ui/shared/commercial-subtypes';
import { CreateInspectionFromWizardSchema } from '../../../server/lib/validations/wizard.schema';
import { CreateInspectionSchema, UpdateInspectionSchema } from '../../../server/lib/validations/inspection.schema';

const body = (property: Record<string, unknown>) => ({
    property: { address: '12 Test Street', ...property },
    services: ['svc-1'],
    schedule: { date: '2026-11-03', startTime: '09:00', durationMinutes: 120 },
    teamMode: false,
});

describe('the wizard route and the property type vocabulary', () => {
    it.each(INSPECTION_PROPERTY_TYPES)('accepts the stored value %s', (value) => {
        expect(CreateInspectionFromWizardSchema.safeParse(body({ propertyType: value })).success).toBe(true);
    });

    it('accepts a body with no property type (the column stays null: unclassified)', () => {
        expect(CreateInspectionFromWizardSchema.safeParse(body({})).success).toBe(true);
    });

    it.each(['condo', 'townhouse', 'multi_family', 'multi-unit', 'single-family', 'residential', ''])('refuses %j, which no reader of the column knows', (value) => {
        expect(CreateInspectionFromWizardSchema.safeParse(body({ propertyType: value })).success).toBe(false);
    });

    it('takes its values from the same list as create and update', () => {
        const wizard = CreateInspectionFromWizardSchema.shape.property.shape.propertyType.unwrap().options;
        expect([...wizard].sort()).toEqual([...INSPECTION_PROPERTY_TYPES].sort());
        // create and update accept every one of them as well (the control that the list above is the real one, not a copy of itself)
        for (const value of INSPECTION_PROPERTY_TYPES) {
            expect(UpdateInspectionSchema.safeParse({ propertyType: value }).success, `update ${value}`).toBe(true);
        }
        expect(CreateInspectionSchema.safeParse({ propertyAddress: '12 Test Street', propertyType: 'condo' }).success).toBe(false);
    });

    it('lists the same commercial subtypes as the platform list', () => {
        const wizard = CreateInspectionFromWizardSchema.shape.property.shape.commercialSubtype.unwrap().options;
        expect([...wizard].sort()).toEqual(PLATFORM_SUBTYPES.map((subtype) => subtype.id).sort());
    });
});
