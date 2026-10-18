/**
 * A switch the role pins (staff never write report content or publish) is dropped on every write path,
 * the same way, and a value stored before the pin is cleared by the next edit. Each case has a control
 * that proves a settable switch is kept, so "dropped" cannot mean "everything dropped".
 */
import { describe, it, expect } from 'vitest';
import { planMemberUpdate, diffOverrides } from '../../../server/services/team/plan-member-update';
import { getCapabilities, pinnedCapabilities } from '../../../server/lib/auth/capabilities';
import { actorOf, OWNER_ACTOR } from '../helpers/grant-actor';

const manager = actorOf('manager');
const edit = (role: 'staff' | 'inspector', stored: unknown, requested: Record<string, boolean> | null | undefined, actor = manager) =>
    planMemberUpdate({ actor, isSelf: false, current: { role, permissionOverrides: stored }, nextRole: role, requested });

describe('pinned switches are dropped, not stored', () => {
    it('the pinned set for staff is exactly what the role table says', () => {
        expect([...pinnedCapabilities('staff')].sort()).toEqual(['editReports', 'publish', 'viewAllInspections']);
    });

    it('a manager saving editReports:true for staff stores nothing and changes nothing', () => {
        const plan = edit('staff', null, { editReports: true });
        expect(plan.permissionOverrides).toBeNull();
        expect(plan.capabilitiesChanged).toEqual([]);
        expect(getCapabilities('staff', plan.permissionOverrides).editReports).toBe(false);
        // control: a settable switch in the same request is kept
        const kept = edit('staff', null, { editReports: true, manageContacts: false });
        expect(kept.permissionOverrides).toEqual({ manageContacts: false });
        // control: the same request for an inspector (editReports is settable for that role, and off is a difference)
        expect(edit('inspector', null, { editReports: false }).permissionOverrides).toEqual({ editReports: false });
    });

    it('an editReports:true stored on staff before the pin is cleared by the next edit', () => {
        const plan = edit('staff', { editReports: true, manageContacts: false }, undefined);
        expect(plan.permissionOverrides).toEqual({ manageContacts: false });
        expect(diffOverrides('staff', { editReports: true, publish: true })).toBeNull();
    });

    it('the owner path agrees with the manager path', () => {
        expect(edit('staff', null, { editReports: true }, OWNER_ACTOR).permissionOverrides).toBeNull();
    });
});
