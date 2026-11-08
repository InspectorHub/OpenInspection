import { describe, it, expect } from 'vitest';
import { InspectionPrefsSchema, InspectionPrefsPatchSchema, DEFAULT_INSPECTION_PREFS } from '../../../server/lib/validations/inspection-prefs.schema';
import { DEFAULT_AGENT_REPAIR_ACCESS, resolveAgentRepairAccess } from '../../../server/lib/people/agent-repair-access';
import { DEFAULT_INSPECTION_PREFS as FIELD_UI_DEFAULT_PREFS } from '../../../packages/field-ui/src/hooks/useInspectionPrefs';

describe('InspectionPrefsSchema', () => {
    it('accepts a valid prefs object and defaults autoAdvance to keyboard (B-18)', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating_notes',
            autoAdvanceDelayMs: 200,
            pinnedTagIds: ['tag1', 'tag2'],
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.autoAdvance).toBe('keyboard');
    });

    it('rejects an unknown autoAdvance mode', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating_notes',
            autoAdvance: 'sometimes',
            autoAdvanceDelayMs: 200,
            pinnedTagIds: [],
        });
        expect(r.success).toBe(false);
    });

    it('rejects an unknown cloneDefault', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'everything',
            autoAdvanceDelayMs: 200,
            pinnedTagIds: [],
        });
        expect(r.success).toBe(false);
    });

    it('clamps autoAdvanceDelayMs into [0, 2000]', () => {
        const tooLow = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating', autoAdvanceDelayMs: -10, pinnedTagIds: [],
        });
        expect(tooLow.success).toBe(false);
        const tooHigh = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating', autoAdvanceDelayMs: 5000, pinnedTagIds: [],
        });
        expect(tooHigh.success).toBe(false);
    });

    it('limits pinnedTagIds to 5 entries', () => {
        const r = InspectionPrefsSchema.safeParse({
            cloneDefault: 'rating', autoAdvanceDelayMs: 100,
            pinnedTagIds: ['a','b','c','d','e','f'],
        });
        expect(r.success).toBe(false);
    });
});

describe('InspectionPrefsPatchSchema', () => {
    it('accepts a partial patch', () => {
        const r = InspectionPrefsPatchSchema.safeParse({ cloneDefault: 'all' });
        expect(r.success).toBe(true);
    });

    it('accepts empty object', () => {
        const r = InspectionPrefsPatchSchema.safeParse({});
        expect(r.success).toBe(true);
    });
});

describe('DEFAULT_INSPECTION_PREFS', () => {
    it('passes the full schema', () => {
        expect(InspectionPrefsSchema.safeParse(DEFAULT_INSPECTION_PREFS).success).toBe(true);
    });
});

describe('agentRepairAccess default has ONE answer in every layer', () => {
    // The enforcement resolver answered `read` while the settings API and the editor hook answered `readwrite`, so the
    // settings page showed "View and edit" for a company whose agents were read-only, and any staff save of an unrelated
    // preference wrote `readwrite` into the stored blob. Each layer is held to the shared constant.
    it('the shared constant is read, the narrower policy decided on 2026-08-14', () => {
        expect(DEFAULT_AGENT_REPAIR_ACCESS).toBe('read');
    });

    it('the enforcement resolver, the zod default and withDefaults all agree', () => {
        const parsed = InspectionPrefsSchema.parse({ cloneDefault: 'rating_notes', autoAdvanceDelayMs: 200, pinnedTagIds: [] });
        expect(parsed.agentRepairAccess).toBe(resolveAgentRepairAccess(undefined));
        expect(DEFAULT_INSPECTION_PREFS.agentRepairAccess).toBe(resolveAgentRepairAccess(undefined));
    });

    it('the field-ui hook default (used until the tenant prefs load, and offline) agrees with the server', () => {
        expect(FIELD_UI_DEFAULT_PREFS.agentRepairAccess).toBe(DEFAULT_AGENT_REPAIR_ACCESS);
    });
});
