import { describe, it, expect } from 'vitest';
import { planMemberUpdate } from '../../../server/services/team/plan-member-update';
import { getCapabilities } from '../../../server/lib/auth/capabilities';

const owner = { role: 'owner', capabilities: getCapabilities('owner', null), userId: 'u-owner' } as const;

describe('a stored visibility restriction and member edits', () => {
    it('an edit that leaves the overrides alone keeps the restriction', () => {
        const plan = planMemberUpdate({
            actor: owner, isSelf: false,
            current: { role: 'inspector', permissionOverrides: { viewAllInspections: false } },
            nextRole: 'inspector', requested: undefined,
        });
        expect(plan.permissionOverrides).toEqual({ viewAllInspections: false });
    });

    const restricted = { role: 'inspector', permissionOverrides: { viewAllInspections: false } } as const;

    it('a partial map that does not mention the scope keeps the restriction and applies the other switches', () => {
        const plan = planMemberUpdate({ actor: owner, isSelf: false, current: restricted, nextRole: 'inspector', requested: { publish: false } });
        expect(plan.permissionOverrides).toEqual({ publish: false, viewAllInspections: false });
        expect(plan.capabilitiesChanged).toEqual(['publish']);
    });

    it('an empty map or an explicit null clears the other switches but not the restriction', () => {
        for (const requested of [{}, null]) {
            const plan = planMemberUpdate({ actor: owner, isSelf: false, current: { role: 'inspector', permissionOverrides: { publish: false, viewAllInspections: false } }, nextRole: 'inspector', requested });
            expect(plan.permissionOverrides).toEqual({ viewAllInspections: false });
        }
    });

    it('control: an explicit true lifts the restriction, an explicit false restates it', () => {
        const lifted = planMemberUpdate({ actor: owner, isSelf: false, current: restricted, nextRole: 'inspector', requested: { viewAllInspections: true } });
        expect(lifted.permissionOverrides).toBeNull();
        expect(lifted.capabilitiesChanged).toContain('viewAllInspections');
        const kept = planMemberUpdate({ actor: owner, isSelf: false, current: restricted, nextRole: 'inspector', requested: { publish: false, viewAllInspections: false } });
        expect(kept.permissionOverrides).toEqual({ publish: false, viewAllInspections: false });
        expect(kept.capabilitiesChanged).toEqual(['publish']);
    });

    it('control: an explicit restriction can be added to an unrestricted member', () => {
        const plan = planMemberUpdate({ actor: owner, isSelf: false, current: { role: 'inspector', permissionOverrides: null }, nextRole: 'inspector', requested: { viewAllInspections: false } });
        expect(plan.permissionOverrides).toEqual({ viewAllInspections: false });
    });

    it('the ceiling still decides who may change it: an inspector cannot lift their own restriction', () => {
        const self = { role: 'inspector', capabilities: getCapabilities('inspector', restricted.permissionOverrides), userId: 'u-i' } as const;
        expect(() => planMemberUpdate({ actor: self, isSelf: true, current: restricted, nextRole: 'inspector', requested: { viewAllInspections: true } })).toThrow();
    });

    it('control: a member with no stored restriction gains none from an edit', () => {
        const plan = planMemberUpdate({
            actor: owner, isSelf: false,
            current: { role: 'inspector', permissionOverrides: null },
            nextRole: 'inspector', requested: { publish: false },
        });
        expect(plan.permissionOverrides).toEqual({ publish: false });
    });

    it('a role that pins the switch stores nothing for it', () => {
        const plan = planMemberUpdate({
            actor: owner, isSelf: false,
            current: { role: 'inspector', permissionOverrides: { viewAllInspections: false } },
            nextRole: 'manager', requested: undefined,
        });
        expect(plan.permissionOverrides).toBeNull();
    });
});
