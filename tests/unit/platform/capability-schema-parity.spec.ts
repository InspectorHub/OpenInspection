import { describe, it, expect } from 'vitest';
import { TOGGLEABLE } from '../../../server/lib/auth/capabilities';
import {
    InviteMemberSchema,
    UpdateMemberSchema,
    TeamMembersResponseSchema,
} from '../../../server/lib/validations/admin/compliance';

/**
 * Every capability the server declares must be grantable through the API that
 * grants capabilities (#77).
 *
 * `viewCommunication` shipped declared, role-defaulted, enforced on the Outbox
 * route, returned by `/me` and by the team endpoint, and rendered as a checkbox
 * in both team drawers — while the invite and update request schemas listed only
 * the other four by hand. Zod strips unknown keys, so the box was tickable,
 * submitted, and silently discarded: the capability was unsettable by anyone.
 *
 * These assertions are written as PARSE results, not shape introspection,
 * because stripping is what actually harmed users. A schema that merely
 * *mentions* a key it then drops would still pass an introspection test.
 */
const everyCapability = Object.fromEntries(TOGGLEABLE.map((cap) => [cap, true]));
const sorted = [...TOGGLEABLE].sort();

describe('team request schemas accept exactly the TOGGLEABLE capability set', () => {
    it('POST /api/team/invite keeps every declared capability', () => {
        const parsed = InviteMemberSchema.parse({
            email: 'new-user@example.com',
            role: 'inspector',
            permissionOverrides: everyCapability,
        });
        expect(Object.keys(parsed.permissionOverrides ?? {}).sort()).toEqual(sorted);
    });

    it('PATCH /api/team/members/:id keeps every declared capability', () => {
        const parsed = UpdateMemberSchema.parse({
            role: 'manager',
            permissionOverrides: everyCapability,
        });
        expect(Object.keys(parsed.permissionOverrides ?? {}).sort()).toEqual(sorted);
    });

    it('the team response describes the same set it accepts', () => {
        const parsed = TeamMembersResponseSchema.parse({
            success: true,
            data: {
                members: [{
                    id: 'u1',
                    name: null,
                    email: 'a@example.com',
                    role: 'inspector',
                    permissionOverrides: everyCapability,
                    createdAt: '2026-01-01T00:00:00Z',
                }],
                invites: [],
            },
        });
        expect(Object.keys(parsed.data.members[0].permissionOverrides ?? {}).sort()).toEqual(sorted);
    });

    it('still strips a capability the server never declared', () => {
        const parsed = UpdateMemberSchema.parse({
            permissionOverrides: { ...everyCapability, deleteTenant: true },
        });
        expect(Object.keys(parsed.permissionOverrides ?? {})).not.toContain('deleteTenant');
    });
});
