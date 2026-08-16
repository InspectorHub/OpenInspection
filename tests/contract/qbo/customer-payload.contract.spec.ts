/**
 * The Customer document we send, against Intuit's own schema.
 *
 * Customer is the entity everything else hangs off: the invoice push reads its
 * mapping for `CustomerRef`, and both the payment and credit-memo pushes refuse
 * without one. A field we invent here disables three downstream pushes and
 * reports nothing.
 */
import { describe, it, expect } from 'vitest';
import { declaredFields, documentation } from './intuit-schema';
import {
    splitName, buildCustomerPayload, sanitizeDisplayName,
    type CustomerSource,
} from '../../../server/services/qbo/customer-payload';

const CONTACT = { email: 'pat@example.com', phone: '+15555550100', agency: 'Sunrise Realty' };

const payload = (name = 'Pat Client', contact: CustomerSource = CONTACT) => {
    const { firstName, lastName } = splitName(name);
    return buildCustomerPayload(name, firstName, lastName, contact);
};

describe('the Customer document we send', () => {
    it('uses only field names Intuit declares on Customer', () => {
        const declared = declaredFields('Customer');
        expect(declared.size).toBeGreaterThan(20);   // the reader found the type
        const sent = Object.keys(payload());
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.filter((k) => !declared.has(k))).toEqual([]);
    });

    it('uses the declared shapes for the two nested contact fields', () => {
        // `PrimaryEmailAddr` is an `EmailAddress` and `PrimaryPhone` a
        // `TelephoneNumber`; sending a bare string in either place is accepted
        // as a document and dropped as a value.
        const email = declaredFields('EmailAddress');
        const phone = declaredFields('TelephoneNumber');
        expect(email.size).toBeGreaterThan(0);
        expect(phone.size).toBeGreaterThan(0);

        const p = payload();
        expect(Object.keys(p.PrimaryEmailAddr as object).filter((k) => !email.has(k))).toEqual([]);
        expect(Object.keys(p.PrimaryPhone as object).filter((k) => !phone.has(k))).toEqual([]);
    });

    // --- the two rules Intuit states in prose ------------------------------

    const CUSTOMER_DOC = documentation('Customer');

    it('states the uniqueness rule the ladder exists for', () => {
        // Intuit's own words, verbatim, and the reason `upsertCustomer` climbs
        // a ladder at all. The fault CODE that announces a collision (6240) is
        // in none of these files — that one belongs to the live lane.
        expect(CUSTOMER_DOC).toContain('The customer name must be unique.');
    });

    it('states the colon rule, and the DisplayName we build obeys it', () => {
        // 🔴 A seventh "never worked" path, found by reading this sentence and
        // then asking the sandbox:
        //
        //     code 2040, element DisplayName
        //     "Element contains invalid characters. Colon: Test Client"
        //
        // The ladder does not retry 2040, so a contact called "Smith Trust:
        // 2019" was permanently unmappable — which disables the invoice,
        // payment and credit-memo pushes behind it.
        expect(CUSTOMER_DOC).toContain('The customer name must not contain a colon (:).');
        expect(sanitizeDisplayName('Smith Trust: 2019')).toBe('Smith Trust 2019');
        expect(payload('Acme: West').DisplayName).not.toContain(':');
    });

    it('leaves a name with no colon exactly as it is — the positive control', () => {
        // Without this, a sanitiser that mangled every name would satisfy the
        // spec above. A customer's name is theirs; we are allowed to drop the
        // one character QuickBooks refuses and nothing else.
        expect(sanitizeDisplayName('Pat Q Client')).toBe('Pat Q Client');
        expect(payload().DisplayName).toBe('Pat Client');
    });

    it('omits absent optionals entirely rather than sending null', () => {
        // A null `PrimaryEmailAddr` is a value QuickBooks interprets — as
        // clearing an address the tenant may have set on their side. Undefined
        // keys disappear in JSON.stringify; nulls do not.
        const p = payload('Pat Client', { email: null, phone: null, agency: null });
        const wire = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
        expect(Object.keys(wire).sort()).toEqual(['DisplayName', 'FamilyName', 'GivenName']);
    });

    it('never leaves FamilyName empty for a one-word name', () => {
        // Positive control on splitName: a blank family name sorts and searches
        // badly in QuickBooks' own UI, so the first token repeats.
        expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: 'Cher' });
        expect(splitName('Pat Q Client')).toEqual({ firstName: 'Pat', lastName: 'Q Client' });
    });
});
