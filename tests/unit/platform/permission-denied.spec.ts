/**
 * The wording of a permission refusal: what was attempted, who is asking and what they lack,
 * and the one way past it. Each case pairs a refusal with a different caller so the message
 * cannot be a single sentence that happens to fit one of them.
 */
import { describe, it, expect } from 'vitest';
import { deniedNeedsPermission, deniedNeedsRole, capabilityLabel } from '../../../server/lib/permission-denied';
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
