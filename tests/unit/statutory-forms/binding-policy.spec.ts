import { describe, it, expect } from 'vitest';
import { assertNoPersonalDataOutsideBindings }
    from '../../../server/lib/statutory/binding-policy';
import type { StatutoryFormDeclaration } from '../../../server/types/template-schema';

const decl = (bindings: StatutoryFormDeclaration['bindings']):
    StatutoryFormDeclaration => ({ formId: 'f', bindings });

describe('assertNoPersonalDataOutsideBindings', () => {
    // -- must REFUSE ---------------------------------------------------------
    it('refuses a person-shaped field supplied as a literal', () => {
        expect(() => assertNoPersonalDataOutsideBindings(
            decl({ client_name: { from: 'literal', value: 'Jane Doe' } })))
            .toThrow(/client_name/);
    });
    it('refuses a person-shaped field bound to an item', () => {
        expect(() => assertNoPersonalDataOutsideBindings(
            decl({ owner_email: { from: 'item', itemId: 'i1' } })))
            .toThrow(/owner_email/);
    });
    it('refuses a phone-shaped field from an item attribute', () => {
        expect(() => assertNoPersonalDataOutsideBindings(
            decl({ contact_phone: { from: 'item_attribute', itemId: 'i1', attribute: 'v' } })))
            .toThrow(/contact_phone/);
    });

    // -- must ALLOW (positive controls) --------------------------------------
    // Without these, a gate that refuses EVERYTHING would pass the three above
    // and prove nothing at all.
    it('allows a person-shaped field bound through from: inspection', () => {
        expect(() => assertNoPersonalDataOutsideBindings(
            decl({ client_name: { from: 'inspection', field: 'client_name' } })))
            .not.toThrow();
    });
    it('allows a signature reference', () => {
        expect(() => assertNoPersonalDataOutsideBindings(
            decl({ inspector_signature: { from: 'signature', scope: 'whole_form' } })))
            .not.toThrow();
    });
    it('allows the property address, which is address-shaped but not a person', () => {
        expect(() => assertNoPersonalDataOutsideBindings(
            decl({ property_address: { from: 'inspection', field: 'property_address' } })))
            .not.toThrow();
    });
    it('allows an ordinary property field as a literal', () => {
        expect(() => assertNoPersonalDataOutsideBindings(
            decl({ roof_cover: { from: 'literal', value: 'Shingle' } })))
            .not.toThrow();
    });
});
