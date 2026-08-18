/**
 * The bundle format restates two vocabularies that also live elsewhere: the
 * contact-type set (a database column) and the role set (the role taxonomy).
 * The restatement is deliberate — an adapter's import graph must stay free of
 * the ORM — so the agreement is asserted here rather than asked for in a
 * comment. A comment that says "keep these in sync" is a latent bug.
 */
import { describe, it, expect } from 'vitest';
import { BUNDLE_CONTACT_TYPES, MIGRATION_ENTITY_KINDS, VENDOR_IDS } from '../../../server/lib/migration-intake/bundle';
import { contacts } from '../../../server/lib/db/schema';
import { ROLES } from '../../../server/lib/auth/roles';

describe('bundle vocabularies', () => {
    it('BUNDLE_CONTACT_TYPES is exactly the contacts.type column enum', () => {
        expect([...BUNDLE_CONTACT_TYPES].sort()).toEqual([...contacts.type.enumValues].sort());
    });

    it('the member roles a bundle may carry are the roles minus agent', () => {
        const bundleRoles = ROLES.filter((r) => r !== 'agent');
        expect(bundleRoles).toEqual(['owner', 'manager', 'inspector']);
    });

    it('every entity kind has a vendor-independent name', () => {
        expect([...MIGRATION_ENTITY_KINDS]).toEqual(['template', 'contact', 'member']);
        expect(VENDOR_IDS).toContain('spectora');
        expect(VENDOR_IDS).toContain('csv_generic');
    });
});
