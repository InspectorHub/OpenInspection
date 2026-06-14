/**
 * canEdit permission matrix (roles collapsed to owner/admin/inspector/agent
 * — 2026-06-13).
 *
 * Owners + admins → always.
 * Inspector → must be on the inspection (inspectorId /
 *   leadInspectorId / helperInspectorIds). Section-scope restrictions
 *   (formerly the specialist role) were removed; an on-inspection
 *   inspector now has full edit access.
 * Agent → never (buyer-agent surface, read-only).
 */
import { describe, it, expect } from 'vitest';
import { canEdit } from '../../server/lib/rbac/can-edit';

const baseInspection = {
    id: 'i1',
    inspectorId: 'u-lead',
    leadInspectorId: 'u-lead',
    helperInspectorIds: '["u-helper-1"]',
    teamMode: true,
};

describe('canEdit (subsystem C P4)', () => {
    it('owner / manager can edit anything', () => {
        expect(canEdit({ id: 'u', role: 'owner', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
        expect(canEdit({ id: 'u', role: 'manager', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('inspector can edit own inspections', () => {
        expect(canEdit({ id: 'u-lead', role: 'inspector', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('inspector cannot edit foreign inspection', () => {
        expect(canEdit({ id: 'u-other', role: 'inspector', assignedSectionIds: '[]' }, baseInspection)).toBe(false);
    });

    it('helper listed in helperInspectorIds can edit', () => {
        expect(canEdit({ id: 'u-helper-1', role: 'inspector', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('on-inspection inspector has full access regardless of sectionId (specialist scoping removed)', () => {
        const u = { id: 'u-helper-1', role: 'inspector', assignedSectionIds: '["s-roof"]' };
        expect(canEdit(u, baseInspection, 's-roof')).toBe(true);
        expect(canEdit(u, baseInspection, 's-elec')).toBe(true);
        expect(canEdit(u, baseInspection)).toBe(true);
    });

    it('malformed helperInspectorIds JSON treated as empty', () => {
        const broken = { ...baseInspection, helperInspectorIds: 'not-json' };
        expect(canEdit({ id: 'u-helper-1', role: 'inspector', assignedSectionIds: '[]' }, broken)).toBe(false);
    });

    it('agent role denied (subsystem A buyer-agent surface, read-only)', () => {
        expect(canEdit({ id: 'u-lead', role: 'agent', assignedSectionIds: '[]' }, baseInspection)).toBe(false);
    });
});
