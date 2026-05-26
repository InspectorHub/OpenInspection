/**
 * Design System 0520 subsystem C phase 4 — canEdit permission matrix.
 *
 * Owners + admins → always.
 * Lead / apprentice → must be on the inspection (inspectorId /
 *   leadInspectorId / helperInspectorIds).
 * Specialist → on-inspection AND sectionId in user.assigned_section_ids.
 * Office → never (read-only seat).
 * Legacy 'inspector' aliased to 'lead' via the role-alias shim.
 */
import { describe, it, expect } from 'vitest';
import { canEdit } from '../../src/lib/rbac/can-edit';

const baseInspection = {
    id: 'i1',
    inspectorId: 'u-lead',
    leadInspectorId: 'u-lead',
    helperInspectorIds: '["u-helper-1"]',
    teamMode: true,
};

describe('canEdit (subsystem C P4)', () => {
    it('owner / admin can edit anything', () => {
        expect(canEdit({ id: 'u', role: 'owner', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
        expect(canEdit({ id: 'u', role: 'admin', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('lead can edit own inspections', () => {
        expect(canEdit({ id: 'u-lead', role: 'lead', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('lead cannot edit foreign inspection', () => {
        expect(canEdit({ id: 'u-other', role: 'lead', assignedSectionIds: '[]' }, baseInspection)).toBe(false);
    });

    it('helper listed in helperInspectorIds can edit', () => {
        expect(canEdit({ id: 'u-helper-1', role: 'lead', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('specialist needs sectionId AND that section in assigned list', () => {
        const u = { id: 'u-helper-1', role: 'specialist', assignedSectionIds: '["s-roof"]' };
        expect(canEdit(u, baseInspection, 's-roof')).toBe(true);
        expect(canEdit(u, baseInspection, 's-elec')).toBe(false);
    });

    it('specialist without sectionId arg denies', () => {
        const u = { id: 'u-helper-1', role: 'specialist', assignedSectionIds: '["s-roof"]' };
        expect(canEdit(u, baseInspection)).toBe(false);
    });

    it('apprentice gets lead-like access (queue routing happens in patchItem)', () => {
        expect(canEdit({ id: 'u-helper-1', role: 'apprentice', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('office can never edit', () => {
        expect(canEdit({ id: 'u-lead', role: 'office', assignedSectionIds: '[]' }, baseInspection)).toBe(false);
        expect(canEdit({ id: 'u-helper-1', role: 'office', assignedSectionIds: '[]' }, baseInspection)).toBe(false);
    });

    it('legacy inspector role aliased to lead', () => {
        expect(canEdit({ id: 'u-lead', role: 'inspector', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('malformed helperInspectorIds JSON treated as empty', () => {
        const broken = { ...baseInspection, helperInspectorIds: 'not-json' };
        expect(canEdit({ id: 'u-helper-1', role: 'lead', assignedSectionIds: '[]' }, broken)).toBe(false);
    });

    it('agent role denied (subsystem A buyer-agent surface, read-only)', () => {
        expect(canEdit({ id: 'u-lead', role: 'agent', assignedSectionIds: '[]' }, baseInspection)).toBe(false);
    });
});
