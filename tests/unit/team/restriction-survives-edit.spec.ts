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

    it('an edit that sends a map replaces it, like every other switch: the restriction stays only when it is stated', () => {
        const dropped = planMemberUpdate({
            actor: owner, isSelf: false,
            current: { role: 'inspector', permissionOverrides: { viewAllInspections: false } },
            nextRole: 'inspector', requested: { publish: false },
        });
        expect(dropped.permissionOverrides).toEqual({ publish: false });
        expect(dropped.capabilitiesChanged).toContain('viewAllInspections');
        const kept = planMemberUpdate({
            actor: owner, isSelf: false,
            current: { role: 'inspector', permissionOverrides: { viewAllInspections: false } },
            nextRole: 'inspector', requested: { publish: false, viewAllInspections: false },
        });
        expect(kept.permissionOverrides).toEqual({ publish: false, viewAllInspections: false });
        expect(kept.capabilitiesChanged).toEqual(['publish']);
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
