/**
 * The reader that every other contract spec stands on.
 *
 * These specs exist because of how this suite would fail if it broke: a parser
 * that returns an empty set makes every downstream "we send nothing Intuit does
 * not declare" assertion pass vacuously. That is the exact failure this whole
 * lane was built to stop happening elsewhere, so it gets checked here first,
 * with counts printed rather than implied.
 */
import { describe, it, expect } from 'vitest';
import {
    xsd, vendoredFileCount, declaredFields, schemaRequiredFields,
    inheritanceChain, documentation, enumValues,
} from './intuit-schema';

describe('the vendored schemas are actually being read', () => {
    it('loads all four files and finds a lot of them', () => {
        expect(vendoredFileCount).toBe(4);
        // Roughly 700 KB across the four. A floor, not an equality: Intuit adds
        // entities, and a refresh that shrank this by an order of magnitude
        // would mean a fetch returned an error page.
        expect(xsd.length).toBeGreaterThan(500_000);
        expect(xsd).toContain('<xs:complexType name="Invoice">');
        expect(xsd).toContain('<xs:complexType name="Customer">');
    });

    it('resolves an entity across file boundaries', () => {
        // `Invoice` is in Finance.xsd and `IntuitEntity` in IntuitBaseTypes.xsd.
        // If the chain stopped at the file edge, `Id` and `SyncToken` would go
        // missing and every update payload would look undeclared.
        expect(inheritanceChain('Invoice')).toEqual(
            ['Invoice', 'SalesTransaction', 'Transaction', 'IntuitEntity'],
        );
        const fields = declaredFields('Invoice');
        expect(fields.size).toBeGreaterThan(50);
        expect(fields.has('Id')).toBe(true);
        expect(fields.has('SyncToken')).toBe(true);
    });

    it('finds Customer, which lives in a different file from Invoice', () => {
        expect(inheritanceChain('Customer')).toContain('IntuitEntity');
        const fields = declaredFields('Customer');
        expect(fields.size).toBeGreaterThan(20);
        expect(fields.has('DisplayName')).toBe(true);
    });

    it('returns nothing for a type that does not exist, and says so distinctly', () => {
        // The negative control. Without it, a reader that returned an empty set
        // for EVERYTHING would satisfy the specs above only by accident of
        // which assertions are `toBeGreaterThan`.
        expect(declaredFields('NotAnIntuitEntity').size).toBe(0);
        expect(inheritanceChain('NotAnIntuitEntity')).toEqual(['NotAnIntuitEntity']);
        expect(documentation('NotAnIntuitEntity')).toBe('');
        expect(enumValues('NotAnEnum')).toEqual([]);
    });

    it('does not confuse a nested inline type for the end of the outer one', () => {
        // A non-greedy `.*?</xs:complexType>` would stop at the first nested
        // close and silently truncate. `Invoice` has plenty of body after its
        // first nested type, so a truncated read loses `Line`.
        expect(declaredFields('Invoice').has('Line')).toBe(true);
    });

    it('reads minOccurs across a wrapped attribute, not just the opening line', () => {
        // These declarations wrap:
        //     <xs:element name="CustomerRef" type="ReferenceType"
        //                 minOccurs="0">
        // A reader that looked at the first line only would report "no
        // minOccurs, therefore required" — which is exactly the wrong answer,
        // and exactly the mistake a line-oriented grep makes.
        expect(schemaRequiredFields('Invoice').has('CustomerRef')).toBe(false);
    });

    it('pins the limit that makes the prose specs necessary', () => {
        // 🔴 Intuit's schema requires NEITHER of the two fields whose absence
        // broke every invoice push this product ever made. Both are
        // `minOccurs="0"`, so a validator run over these files passes the exact
        // document QuickBooks refuses.
        //
        // This is why `invoice-payload.contract.spec.ts` quotes the type's
        // documentation instead: the binding rules live in prose. Anyone
        // tempted to replace those quotes with schema validation should fail
        // here first.
        const required = schemaRequiredFields('Invoice');
        expect(required.has('Line')).toBe(false);
        expect(required.has('CustomerRef')).toBe(false);
        // Both are declared, though — so field-NAME conformance still works,
        // and that half of this lane is fully automatic.
        expect(declaredFields('Invoice').has('Line')).toBe(true);
        expect(declaredFields('Invoice').has('CustomerRef')).toBe(true);
    });
});
