/**
 * The bundle format restates two vocabularies that also live elsewhere: the
 * contact-type set (a database column) and the role set (the role taxonomy).
 * The restatement is deliberate — an adapter's import graph must stay free of
 * the ORM — so the agreement is asserted here rather than asked for in a
 * comment. A comment that says "keep these in sync" is a latent bug.
 */
import { describe, it, expect } from 'vitest';
import {
    BUNDLE_CONTACT_TYPES,
    BUNDLE_MEMBER_ROLES,
    MIGRATION_ENTITY_KINDS,
    VENDOR_IDS,
    looksLikeEmailAddress,
} from '../../../server/lib/migration-intake/bundle';
import { contacts } from '../../../server/lib/db/schema';
import { ROLES } from '../../../server/lib/auth/roles';
import { RemapRequestSchema } from '../../../server/lib/validations/migration-intake.schema';
import { IMPORT_MEMBER_ROLES } from '../../../app/lib/imports-types';
import { describeRowProblem } from '../../../server/lib/migration-intake/row-problems';

describe('bundle vocabularies', () => {
    it('BUNDLE_CONTACT_TYPES is exactly the contacts.type column enum', () => {
        expect([...BUNDLE_CONTACT_TYPES].sort()).toEqual([...contacts.type.enumValues].sort());
    });

    it('the member roles a bundle may carry are the roles minus agent', () => {
        const bundleRoles = ROLES.filter((r) => r !== 'agent');
        expect(bundleRoles).toEqual(['owner', 'manager', 'inspector']);
        expect([...BUNDLE_MEMBER_ROLES]).toEqual(bundleRoles);
    });

    /**
     * The last spelling of that list, held by an assertion rather than by a
     * comment.
     *
     * `RemapRequestSchema` writes its own `z.enum` because zod needs a non-empty
     * TUPLE and the shared list is an array — a cast would be an unchecked
     * assertion, which is what this file exists to avoid. So the agreement is
     * checked at runtime instead: a role added to the taxonomy would otherwise
     * appear in the mapping dropdown and be refused by the request schema behind
     * it, and nothing would say so.
     */
    it('the remap schema offers exactly the roles a bundle may carry', () => {
        const parsed = RemapRequestSchema.parse({
            mapping: { kind: 'members', mapping: { email: 'Email', role: { fixed: 'inspector' } } },
        });
        expect(parsed.mapping.kind).toBe('members');
        for (const role of BUNDLE_MEMBER_ROLES) {
            expect(RemapRequestSchema.safeParse({
                mapping: { kind: 'members', mapping: { email: 'Email', role: { fixed: role } } },
            }).success).toBe(true);
        }
        // The negative control: the one role the format excludes is refused, so
        // the loop above is not simply passing everything.
        expect(RemapRequestSchema.safeParse({
            mapping: { kind: 'members', mapping: { email: 'Email', role: { fixed: 'agent' } } },
        }).success).toBe(false);
    });

    it('the mapping dropdown offers exactly the same roles', () => {
        expect([...IMPORT_MEMBER_ROLES]).toEqual([...BUNDLE_MEMBER_ROLES]);
    });

    /**
     * There is ONE definition of "an email address", and it is the one whose
     * verdict the operator is shown.
     *
     * Asserted as an agreement rather than as a regex test: the predicate and
     * the sentence the repair screen renders have to answer the same question,
     * or a row reads as repaired on one screen and unrepaired on the next.
     */
    it('the row describer judges an address by the shared predicate, and nothing else', () => {
        for (const value of ['x@y.z', 'jane.doe@sub.example.museum', 'a@b_c.com']) {
            expect(looksLikeEmailAddress(value)).toBe(true);
            expect(describeRowProblem('member', { email: value, role: 'inspector' })).toBeNull();
        }
        for (const value of ['nope', 'a b@c.com', 'a@b']) {
            expect(looksLikeEmailAddress(value)).toBe(false);
            expect(describeRowProblem('member', { email: value, role: 'inspector' }))
                .toMatchObject({ field: 'email', value });
        }
    });

    it('every entity kind has a vendor-independent name', () => {
        expect([...MIGRATION_ENTITY_KINDS]).toEqual(['template', 'contact', 'member']);
        expect(VENDOR_IDS).toContain('spectora');
        expect(VENDOR_IDS).toContain('csv_generic');
    });
});
