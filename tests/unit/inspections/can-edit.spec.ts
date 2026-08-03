/**
 * canEdit permission matrix (roles collapsed to owner/admin/inspector/agent
 * — 2026-06-13).
 *
 * Owners + admins → always.
 * Inspector → must be on the inspection. Membership arrives as
 *   `assignedUserIds`, built by the caller from the roster
 *   (`inspection_inspectors`) — this function does not read it, and
 *   deliberately cannot: the lead/helper columns it used to consult are no
 *   longer written, so a version that still read them would deny every
 *   non-admin. Section-scope restrictions (formerly the specialist role) were
 *   removed; an on-inspection inspector now has full edit access.
 * Agent → never (buyer-agent surface, read-only).
 *
 * Note that nothing in production calls canEdit — see the module docstring.
 * These tests pin the decision logic, not an enforced policy.
 */
import { describe, it, expect } from 'vitest';
import { canEdit } from '../../../server/lib/rbac/can-edit';

const baseInspection = {
    id: 'i1',
    assignedUserIds: ['u-lead', 'u-helper-1'],
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

    it('a helper on the roster can edit', () => {
        expect(canEdit({ id: 'u-helper-1', role: 'inspector', assignedSectionIds: '[]' }, baseInspection)).toBe(true);
    });

    it('on-inspection inspector has full access regardless of sectionId (specialist scoping removed)', () => {
        const u = { id: 'u-helper-1', role: 'inspector', assignedSectionIds: '["s-roof"]' };
        expect(canEdit(u, baseInspection, 's-roof')).toBe(true);
        expect(canEdit(u, baseInspection, 's-elec')).toBe(true);
        expect(canEdit(u, baseInspection)).toBe(true);
    });

    it('an unassigned inspection admits nobody but admins', () => {
        // Replaces the old "malformed JSON treated as empty" case. There is no
        // JSON to malform any more, but the outcome that mattered — an empty
        // membership list must deny rather than fail open — still does.
        const unassigned = { ...baseInspection, assignedUserIds: [] };
        expect(canEdit({ id: 'u-lead', role: 'inspector', assignedSectionIds: '[]' }, unassigned)).toBe(false);
        expect(canEdit({ id: 'u-lead', role: 'owner', assignedSectionIds: '[]' }, unassigned)).toBe(true);
    });

    it('agent role denied (subsystem A buyer-agent surface, read-only)', () => {
        expect(canEdit({ id: 'u-lead', role: 'agent', assignedSectionIds: '[]' }, baseInspection)).toBe(false);
    });
});
