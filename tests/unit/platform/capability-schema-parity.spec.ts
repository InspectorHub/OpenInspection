import { describe, it, expect } from 'vitest';
import { TOGGLEABLE } from '../../../server/lib/auth/capabilities';
import {
    InviteMemberSchema,
    UpdateMemberSchema,
    TeamMembersResponseSchema,
    resolvedCapabilitySchema,
    CAPABILITY_DESCRIPTIONS,
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
                    // Required on the response, and unrelated to capabilities:
                    // the team page reads it to decide whether an owner has a
                    // second factor to clear. Present here so this fixture is a
                    // complete member row rather than a capability-only one.
                    totpEnabled: false,
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

/**
 * `GET /api/auth/me` HAND-LISTED five capabilities in an inline z.object
 * (profile.ts). It is the same shape as #77 -- a set declared in one place and
 * re-typed in another -- and the only reason it was harmless is that
 * zod-openapi does not strip response bodies, so the extra keys travelled while
 * the published contract under-described them. The inspector portal reads this
 * contract, so an under-described capability is a capability no client can be
 * written against.
 */
describe('the /me capability contract describes the whole set', () => {
    it('describes exactly TOGGLEABLE', () => {
        expect(Object.keys(resolvedCapabilitySchema().shape).sort()).toEqual(sorted);
    });

    it('gives every capability a non-empty description', () => {
        for (const cap of TOGGLEABLE) {
            expect(CAPABILITY_DESCRIPTIONS[cap]?.length ?? 0).toBeGreaterThan(0);
        }
    });

    it('requires every key, unlike the sparse override map', () => {
        // capabilityToggleMap() (all optional) and resolvedCapabilitySchema()
        // (all required) are different shapes on purpose: the request accepts a
        // partial set, the response promises a complete one. Collapsing them
        // would let /me under-report a capability as simply absent.
        //
        // safeParse, not `expect(...).toThrow()`: a missing export throws too,
        // so a toThrow() here passes before the schema exists at all.
        const result = resolvedCapabilitySchema().safeParse({ publish: true });
        expect(result.success).toBe(false);
    });
});
