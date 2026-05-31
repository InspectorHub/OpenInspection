import { describe, it, expect } from 'vitest';
import { CreateInspectionFromWizardSchema } from '../../src/lib/validations/wizard.schema';

const valid = {
    property: { address: '123 Main St', yearBuilt: 1973, sqft: 1840, propertyType: 'single_family' as const },
    services: ['general', 'pool'],
    schedule: { date: '2026-06-01', startTime: '09:00', durationMinutes: 180 },
    teamMode: false,
};

describe('CreateInspectionFromWizardSchema (subsystem B phase 5 task 5.1)', () => {
    it('accepts the happy-path solo payload', () => {
        expect(CreateInspectionFromWizardSchema.safeParse(valid).success).toBe(true);
    });

    it('accepts team payload with lead + helpers', () => {
        const r = CreateInspectionFromWizardSchema.safeParse({
            ...valid,
            teamMode: true,
            leadInspectorId: 'user-lead',
            helperInspectorIds: ['user-a', 'user-b'],
        });
        expect(r.success).toBe(true);
    });

    it('rejects services empty array', () => {
        expect(CreateInspectionFromWizardSchema.safeParse({ ...valid, services: [] }).success).toBe(false);
    });

    it('rejects bad date format', () => {
        expect(CreateInspectionFromWizardSchema.safeParse({ ...valid, schedule: { ...valid.schedule, date: '6/1/26' } }).success).toBe(false);
    });

    it('rejects bad time format', () => {
        expect(CreateInspectionFromWizardSchema.safeParse({ ...valid, schedule: { ...valid.schedule, startTime: '9am' } }).success).toBe(false);
    });

    it('rejects too-short address', () => {
        expect(CreateInspectionFromWizardSchema.safeParse({ ...valid, property: { ...valid.property, address: 'X' } }).success).toBe(false);
    });

    it('rejects out-of-range year', () => {
        expect(CreateInspectionFromWizardSchema.safeParse({ ...valid, property: { ...valid.property, yearBuilt: 1600 } }).success).toBe(false);
    });

    it('rejects out-of-range duration', () => {
        expect(CreateInspectionFromWizardSchema.safeParse({ ...valid, schedule: { ...valid.schedule, durationMinutes: 15 } }).success).toBe(false);
        expect(CreateInspectionFromWizardSchema.safeParse({ ...valid, schedule: { ...valid.schedule, durationMinutes: 800 } }).success).toBe(false);
    });
});
