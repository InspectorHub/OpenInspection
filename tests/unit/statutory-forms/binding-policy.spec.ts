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

    // -- the shapes the first pattern was blind to ---------------------------
    // Every one of these is a field name the OIR-B1-1802 map itself carries, and
    // every one of them went through unrefused while the pattern was a list of
    // spellings rather than a statement of the category. They are listed here by
    // NAME rather than folded into the loop below so a future narrowing of the
    // pattern fails with the offending name on screen.
    const PERSON_SHAPES = [
        // an address is not one token -- these are the owner block of a real form
        'owner_city', 'owner_zip', 'owner_county', 'owner_state', 'owner_street',
        // a person named without the word "name" on the field
        'contact_person', 'primary_signer', 'occupant_id',
        // the ones that were always caught, kept so a rewrite cannot lose them
        'owner_name', 'owner_email', 'owner_cell_phone', 'owner_mailing_address',
        'applicant_dob', 'insured_ssn',
    ];

    // A field that is genuinely about the building. If any of these ever starts
    // refusing, the pattern has stopped describing a person and started
    // describing "has an underscore in it" -- which is the failure mode that
    // makes a safety gate get switched off rather than fixed.
    const PROPERTY_SHAPES = [
        'roof_slope', 'year_of_home', 'number_of_stories', 'roof_covering_types',
        'wind_region', 'insurance_company', 'application_policy_number',
        'building_code_a_year_built', 'plumbing_gas_meter_location',
        'roof_geometry_low_slope_area_sqft',
    ];

    it('refuses every person shape bound to an item, and allows every property shape', () => {
        // An empty list would make both loops vacuously green, which is the one
        // way this test could pass while checking nothing.
        expect(PERSON_SHAPES.length).toBeGreaterThan(0);
        expect(PROPERTY_SHAPES.length).toBeGreaterThan(0);

        const refused = PERSON_SHAPES.filter((field) => {
            try {
                assertNoPersonalDataOutsideBindings(
                    decl({ [field]: { from: 'item', itemId: 'i1' } }));
                return false;
            } catch { return true; }
        });
        const allowed = PROPERTY_SHAPES.filter((field) => {
            try {
                assertNoPersonalDataOutsideBindings(
                    decl({ [field]: { from: 'item', itemId: 'i1' } }));
                return true;
            } catch { return false; }
        });

        expect(refused).toEqual(PERSON_SHAPES);
        expect(allowed).toEqual(PROPERTY_SHAPES);
    });

    it.each(['owner_city', 'owner_zip', 'owner_county', 'contact_person'])(
        'refuses %s, which the 1802 names and the first pattern could not see',
        (field) => {
            expect(() => assertNoPersonalDataOutsideBindings(
                decl({ [field]: { from: 'item_attribute', itemId: 'i1', attribute: 'v' } })))
                .toThrow(new RegExp(field));
        },
    );

    it.each(['owner_city', 'owner_zip', 'owner_county', 'contact_person'])(
        'still allows %s through the inspection route, which resolves outside the values',
        (field) => {
            // The rule is about the ROUTE. Widening the shape test must not make
            // a correctly-bound owner field unbindable.
            expect(() => assertNoPersonalDataOutsideBindings(
                decl({ [field]: { from: 'inspection', field: 'property_address' } })))
                .not.toThrow();
        },
    );
});
