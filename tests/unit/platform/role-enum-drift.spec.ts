import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { ROLES } from '../../../server/lib/auth/roles';
import { ROLE_KIND } from '../../../server/lib/people/role-kinds';
import { DEFAULT_ROLE_PROFILES } from '../../../server/lib/people/default-role-profiles';
import { users, tenantInvites, contacts, contactRoleProfiles } from '../../../server/lib/db/schema';
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
 * NOT covered here: the `GROUP_ORDER` literals in
 * app/components/inspection/{PeopleEditor,SendReportModal}.tsx and the inline
 * kind tuple in SendSmsModal.tsx. None is exported, and importing the modules
 * to reach them would pull a React tree into a node-env server suite. Export
 * them (or move the order into a shared constant) and they belong above.
 */
