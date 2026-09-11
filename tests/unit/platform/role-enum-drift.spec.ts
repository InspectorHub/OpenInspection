import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { ROLES, ROLE } from '../../../server/lib/auth/roles';
import { ROLE_KIND, ROLE_KINDS, REPAIR_CREATOR_KINDS } from '../../../server/lib/people/role-kinds';
import { CONSENT_RECIPIENT_TYPES } from '../../../server/lib/sms/consent-basis';
import { MESSAGE_FROM_ROLES } from '../../../server/lib/db/schema/message';
import { DEFAULT_ROLE_PROFILES } from '../../../server/lib/people/default-role-profiles';
import {
    users, tenantInvites, contacts, contactRoleProfiles,
    repairRequests, inspectionMessages, smsConsentLog,
} from '../../../server/lib/db/schema';
import {
    CreateContactSchema,
    ContactResponseSchema,
    ContactListQuerySchema,
    ContactDetailResponseSchema,
    ContactImportSchema,
} from '../../../server/lib/validations/contact.schema';
import {
    CreateRoleProfileSchema,
    RoleProfileSchema,
} from '../../../server/lib/validations/role-profile.schema';

/**
 * Two role vocabularies, kept honest from both ends.
 *
 * `users.role` / `tenantInvites.role` is the STAFF SEAT axis (ROLES). The
 * contact-party axis (ROLE_KIND: what a person IS on an inspection) is a
 * different axis that happens to share the word "agent", and it is the one
 * that drifts: it is spelled out by hand in a DB column, two more enums on
 * role profiles, seven request/response schemas, and a seeded default list.
 * A widened select with a narrow form schema is what that drift looks like
 * from the user's side — a rendered option whose save fails.
 *
 * Every case below compares a hand-written literal list against ROLE_KIND, so
 * adding a fourth kind (or quietly dropping one) fails here rather than in
 * production. Order is not asserted; membership is.
 */

const KINDS = Object.values(ROLE_KIND);

function columnEnum(table: unknown, columnName: string): readonly string[] {
    const col = getTableConfig(table as Parameters<typeof getTableConfig>[0])
        .columns.find((c) => c.name === columnName);
    // Fail closed: a renamed column must read as drift, not as an empty match.
    if (!col) throw new Error(`column ${columnName} not found`);
    return (col as unknown as { enumValues?: readonly string[] }).enumValues ?? [];
}

/**
 * Read the member list off a zod enum that may sit under `.default()`,
 * `.optional()` or `.nullable()` wrappers. Throws rather than returning []
 * when no enum is reachable — an unreadable source is a failed check, not a
 * vacuous pass.
 */
function enumOptions(schema: unknown): readonly string[] {
    let node: any = schema;
    for (let hops = 0; hops < 10 && node; hops++) {
        if (Array.isArray(node.options)) return node.options as readonly string[];
        node = node.def?.innerType ?? node._def?.innerType ?? null;
    }
    throw new Error('no zod enum reachable from this schema');
}

function expectKinds(actual: readonly string[]) {
    expect([...actual].sort()).toEqual([...KINDS].sort());
}

describe('role enum drift — staff seat axis (users.role)', () => {
    it('users.role enum matches ROLES', () => {
        expect([...columnEnum(users, 'role')].sort()).toEqual([...ROLES].sort());
    });
    it('tenant_invites.role enum matches ROLES', () => {
        expect([...columnEnum(tenantInvites, 'role')].sort()).toEqual([...ROLES].sort());
    });
});

describe('role enum drift — contact-party axis (ROLE_KIND)', () => {
    // --- database columns ---

    it('contacts.type enum matches ROLE_KIND', () => {
        expectKinds(columnEnum(contacts, 'type'));
    });

    it('contact_role_profiles.kind enum matches ROLE_KIND', () => {
        expectKinds(columnEnum(contactRoleProfiles, 'kind'));
    });

    // --- contact API schemas ---

    it('CreateContactSchema.type matches ROLE_KIND', () => {
        expectKinds(enumOptions(CreateContactSchema.shape.type));
    });

    it('ContactResponseSchema.type matches ROLE_KIND', () => {
        expectKinds(enumOptions(ContactResponseSchema.shape.type));
    });

    it('ContactListQuerySchema.type matches ROLE_KIND', () => {
        expectKinds(enumOptions(ContactListQuerySchema.shape.type));
    });

    it('ContactDetail contact.type matches ROLE_KIND', () => {
        expectKinds(enumOptions((ContactDetailResponseSchema.shape.data as any).shape.contact.shape.type));
    });

    it('ContactImportSchema mapping.type matches ROLE_KIND', () => {
        expectKinds(enumOptions((ContactImportSchema.shape.mapping as any).shape.type));
    });

    // --- role-profile API schemas ---

    it('CreateRoleProfileSchema.kind matches ROLE_KIND', () => {
        expectKinds(enumOptions(CreateRoleProfileSchema.shape.kind));
    });

    it('RoleProfileSchema.kind matches ROLE_KIND', () => {
        expectKinds(enumOptions(RoleProfileSchema.shape.kind));
    });

    // --- seeded data ---

    it('every DEFAULT_ROLE_PROFILES kind is a ROLE_KIND member', () => {
        // Seeds are the one list that legitimately need not cover every kind,
        // so this is containment, not equality — but a seed naming a kind that
        // no longer exists would seed rows capabilitiesForKind grants nothing.
        expect(DEFAULT_ROLE_PROFILES.length).toBeGreaterThan(0);
        const strays = DEFAULT_ROLE_PROFILES
            .filter((p) => !(KINDS as readonly string[]).includes(p.kind))
            .map((p) => `${p.key}:${p.kind}`);
        expect(strays).toEqual([]);
    });
});

/**
 * The cases above compare MEMBERS, which is the weaker of the two checks: two
 * hand-written lists that happen to agree pass while both are wrong together,
 * and they keep passing right up until someone edits one of them. The cases
 * below compare the ARRAY ITSELF. `toBe` can only pass if the declaration
 * imported the vocabulary instead of retyping it, so it is evidence about the
 * code's shape rather than about today's values.
 *
 * Keep both: membership catches a drift the identity check cannot see (a zod
 * enum copies its input, so no reference survives), identity catches the drift
 * membership cannot (a correct copy that is still a copy).
 */
describe('role vocabularies are derived, not retyped', () => {
    it('users.role reads the ROLES array itself', () => {
        expect(columnEnum(users, 'role')).toBe(ROLES);
    });

    it('contacts.type reads the ROLE_KINDS array itself', () => {
        expect(columnEnum(contacts, 'type')).toBe(ROLE_KINDS);
    });

    it('contact_role_profiles.kind reads the ROLE_KINDS array itself', () => {
        expect(columnEnum(contactRoleProfiles, 'kind')).toBe(ROLE_KINDS);
    });

    it('inspection_messages.from_role reads MESSAGE_FROM_ROLES itself', () => {
        expect(columnEnum(inspectionMessages, 'from_role')).toBe(MESSAGE_FROM_ROLES);
    });

    it('sms_consent_log.recipient_type reads CONSENT_RECIPIENT_TYPES itself', () => {
        expect(columnEnum(smsConsentLog, 'recipient_type')).toBe(CONSENT_RECIPIENT_TYPES);
    });

    it('repair_requests.created_by_kind reads REPAIR_CREATOR_KINDS itself', () => {
        expect(columnEnum(repairRequests, 'created_by_kind')).toBe(REPAIR_CREATOR_KINDS);
    });

    // The zod enums cannot be checked by identity (z.enum copies), so assert
    // ORDER as well as membership: a hand-written copy in this codebase was
    // spelled agent/client/other while the vocabulary reads client/agent/other,
    // and an order-insensitive check is exactly what let that sit there.
    it('every contact/role-profile zod enum is ROLE_KINDS in ROLE_KINDS order', () => {
        const inOrder = [...ROLE_KINDS];
        expect(enumOptions(CreateContactSchema.shape.type)).toEqual(inOrder);
        expect(enumOptions(ContactResponseSchema.shape.type)).toEqual(inOrder);
        expect(enumOptions(ContactListQuerySchema.shape.type)).toEqual(inOrder);
        expect(enumOptions((ContactDetailResponseSchema.shape.data as any).shape.contact.shape.type)).toEqual(inOrder);
        expect(enumOptions((ContactImportSchema.shape.mapping as any).shape.type)).toEqual(inOrder);
        expect(enumOptions(CreateRoleProfileSchema.shape.kind)).toEqual(inOrder);
        expect(enumOptions(RoleProfileSchema.shape.kind)).toEqual(inOrder);
    });
});

/**
 * The vocabularies that are NEIGHBOURS of ROLE_KIND without being it. Each is
 * pinned here against the members it is actually allowed to have, so a future
 * "these look the same, unify them" reads as a failing test rather than as a
 * plausible refactor. The reason each one differs lives at its declaration.
 */
describe('neighbouring vocabularies stay distinct', () => {
    it('repair_requests.created_by_kind is client+agent+inspector — never `other`', () => {
        expect([...REPAIR_CREATOR_KINDS]).toEqual([ROLE_KIND.CLIENT, ROLE_KIND.AGENT, ROLE.INSPECTOR]);
        // `repair-access.ts` resolves an `other`-kind portal grant (attorney,
        // title company, …) to NO builder role at all, so a column that
        // accepted it would be recording an actor the resolver cannot produce.
        expect(REPAIR_CREATOR_KINDS as readonly string[]).not.toContain(ROLE_KIND.OTHER);
    });

    it('inspection_messages.from_role is every kind plus the staff side', () => {
        expect([...MESSAGE_FROM_ROLES]).toEqual([ROLE.INSPECTOR, ...ROLE_KINDS]);
    });

    it('sms_consent_log.recipient_type is every kind plus staff', () => {
        expect([...CONSENT_RECIPIENT_TYPES]).toEqual([...ROLE_KINDS, 'staff']);
        // Staff is a BASIS, not a contact-party kind: it exists so a staff STOP
        // can be recorded without entering the consumer consent evidence.
        expect(ROLE_KINDS as readonly string[]).not.toContain('staff');
    });
});

/**
 * NOT covered here: the group ordering used by
 * app/components/inspection/{PeopleEditor,SendReportModal,SendSmsModal}.tsx.
 * All three now map over the imported `ROLE_KINDS` rather than a local tuple,
 * so there is no second list left to compare; reaching them from here would
 * pull a React tree into a node-env server suite for no added evidence.
 */
