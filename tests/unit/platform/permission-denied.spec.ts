/**
 * The wording of a permission refusal: what was attempted, who is asking and what they lack,
 * and the one way past it. Each case pairs a refusal with a different caller so the message
 * cannot be a single sentence that happens to fit one of them.
 */
import { describe, it, expect } from 'vitest';
import { deniedByRule, deniedNeedsPermission, deniedNeedsRole, capabilityLabel, DENIED_BY_RULE } from '../../../server/lib/permission-denied';
import { TOGGLEABLE } from '../../../server/lib/auth/capabilities';

const ctx = (role: string | undefined) => ({ get: (k: string) => (k === 'userRole' ? role : undefined) }) as never;

describe('deniedNeedsPermission', () => {
    it('names the role, the permission by its Team-page label, and who can grant it', () => {
        const e = deniedNeedsPermission(ctx('inspector'), 'scheduleOthers', 'You cannot reassign this');
        expect(e.status).toBe(403);
        expect(e.message).toBe(
            'You cannot reassign this. You are signed in as an Inspector, which does not have the "Schedule for others" permission. '
            + 'Ask an owner or manager to turn on "Schedule for others" for you on the Team page.',
        );
        expect(e.details).toMatchObject({ role: 'inspector', requiredCapability: 'scheduleOthers', fix: 'grant_permission' });
    });

    it('sends a manager to an owner, because a manager cannot change their own permissions', () => {
        const e = deniedNeedsPermission(ctx('manager'), 'templateImport');
        expect(e.message).toContain('signed in as a Manager');
        expect(e.message).toContain('Ask an owner to turn on "Import templates"');
        expect(e.message).not.toContain('owner or manager');
    });

    it('for a permission the role can never hold, says so and points at a role change instead of a switch', () => {
        const e = deniedNeedsPermission(ctx('staff'), 'publish', 'Publishing is signing the report');
        expect(e.message).toContain('signed in as an office staff member');
        expect(e.message).toContain('cannot be given to Staff accounts');
        expect(e.message).toContain('change your role to Inspector or Manager');
        expect(e.message).not.toContain('turn on');
        expect(e.details).toMatchObject({ fix: 'change_role' });
    });

    it('describes a caller with no recognised role as exactly that', () => {
        expect(deniedNeedsPermission(ctx(undefined), 'publish').message).toContain('a user with no recognised role');
    });

    it('has a label for every capability', () => {
        for (const cap of TOGGLEABLE) expect(capabilityLabel(cap).length).toBeGreaterThan(0);
    });
});

describe('deniedNeedsRole', () => {
    it('lists the roles that may, names the caller, and says who to ask', () => {
        const e = deniedNeedsRole(ctx('inspector'), ['owner', 'manager']);
        expect(e.message).toBe(
            'This needs the Owner or Manager role, and you are signed in as an Inspector. '
            + 'Ask an owner or manager to do this, or to change your role on the Team page.',
        );
        expect(e.details).toMatchObject({ role: 'inspector', requiredRoles: ['owner', 'manager'] });
    });

    it('for an owner-only action asks an owner, not "an owner or manager"', () => {
        const e = deniedNeedsRole(ctx('manager'), ['owner'], 'Only an owner can send a file to be converted');
        expect(e.message).toContain('Ask an owner to do this');
        expect(e.message).not.toContain('owner or manager');
    });

    it('for the agent area, tells a team member to sign in with an agent account rather than to change their team role', () => {
        const e = deniedNeedsRole(ctx('owner'), ['agent']);
        expect(e.message).toContain('This needs the Agent role, and you are signed in as an Owner.');
        expect(e.message).toContain('Sign out and sign in with an agent account.');
        expect(e.message).not.toContain('change your role');
    });

    it('tells an agent account that it only has the agent portal', () => {
        expect(deniedNeedsRole(ctx('agent'), ['owner', 'manager', 'inspector']).message)
            .toContain('Agent accounts can only use the agent portal.');
    });
});

describe('deniedByRule and a bare role', () => {
    it('names the rule, the caller and who can still do it', () => {
        const e = deniedByRule(ctx('staff'), 'Office staff cannot cancel an inspection that has started', 'An owner or manager');
        expect(e.status).toBe(403);
        expect(e.message).toBe(
            'Office staff cannot cancel an inspection that has started. You are signed in as an office staff member. An owner or manager can do this.',
        );
        expect(e.details).toMatchObject({ role: 'staff' });
    });

    it('accepts a role string where no request context is at hand, and describes an unknown one as such', () => {
        expect(deniedNeedsRole('manager', ['owner'], 'Changing or removing an owner is an owner action').message)
            .toContain('you are signed in as a Manager');
        expect(deniedByRule(undefined, 'x', 'An owner').message).toContain('a user with no recognised role');
    });
});

describe('advice that fits the caller (review round 1)', () => {
    it('never tells an agent to ask for a role change on the Team page', () => {
        const e = deniedNeedsPermission(ctx('agent'), 'scheduleOthers', 'You cannot do this');
        expect(e.message).toContain('Agent accounts can only use the agent portal.');
        expect(e.message).not.toContain('Team page');
        expect(e.message).not.toContain('Inspector or Manager');
        expect(e.details).toMatchObject({ role: 'agent', requiredCapability: 'scheduleOthers' });
        // control: an inspector still gets the grant advice
        expect(deniedNeedsPermission(ctx('inspector'), 'scheduleOthers').message).toContain('Team page');
    });

    it('a staff refusal built with deniedByRule says who can do it and does not ask staff to change role', async () => {
        const { denyStaff } = await import('../../../server/lib/middleware/rbac');
        const e = await denyStaff(
            { get: (k: string) => (k === 'userRole' ? 'staff' : undefined) } as never,
            (async () => undefined) as never,
        ).then(() => null, (err: unknown) => err as { status: number; message: string; details: Record<string, unknown> });
        expect(e).not.toBeNull();
        expect(e!.status).toBe(403);
        expect(e!.message).toContain('An owner, manager or inspector can do this.');
        expect(e!.message).not.toContain('change your role');
        expect(e!.message).not.toContain('This needs the');
        // control: a role that really is missing from a list still reads as a role refusal
        expect(deniedNeedsRole(ctx('staff'), ['owner', 'manager']).message).toContain('change your role');
    });

    it('deniedByRule carries a stable machine value in details.rule, not the human sentence', () => {
        const what = 'Office staff cannot cancel an inspection that has started';
        const e = deniedByRule(ctx('staff'), what, 'An owner or manager');
        expect(e.details).toMatchObject({ role: 'staff', rule: DENIED_BY_RULE });
        expect(JSON.stringify(e.details)).not.toContain('cancel');
        expect(e.message).toContain(what);
        // two different rules share the same machine value; the human text lives only in the message
        expect((deniedByRule(ctx('staff'), 'Something else', 'An owner').details as { rule: string }).rule).toBe(DENIED_BY_RULE);
    });
});

describe('role strings and unknown roles (review round 1)', () => {
    it('a viewer given as a role string is described by that role, for every role the product has', () => {
        for (const [role, who] of [['owner', 'an Owner'], ['manager', 'a Manager'], ['inspector', 'an Inspector'], ['staff', 'an office staff member'], ['agent', 'an Agent']] as const) {
            expect(deniedNeedsRole(role, ['owner'], 'Only an owner can do this').message, role).toContain(`you are signed in as ${who}`);
            expect(deniedByRule(role, 'x', 'An owner').message, role).toContain(`You are signed in as ${who}.`);
        }
    });

    it('a role string this build does not know is described as unrecognised, in both builders', () => {
        expect(deniedNeedsRole('janitor', ['owner']).message).toContain('a user with no recognised role');
        expect(deniedByRule('janitor', 'x', 'An owner').message).toContain('a user with no recognised role');
        expect(deniedNeedsRole('janitor', ['owner']).details).toMatchObject({ role: 'janitor' });
    });
});
