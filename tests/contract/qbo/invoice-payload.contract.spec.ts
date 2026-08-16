/**
 * The Invoice document we send, against what Intuit's own schema says.
 *
 * This lane exists because of a specific history: every invoice this product
 * ever pushed was refused, twice over — once for a missing `CustomerRef` and
 * once for an empty `Line` — and the unit suite stayed green throughout,
 * because its fixtures supplied both. The rules broken were stated the whole
 * time in `Finance.xsd`, which Intuit ships in its own SDK repositories.
 *
 * Nothing here touches the network. See `vendor/SOURCES.md` for what these
 * files can and cannot tell us; error codes, notably, are not in them.
 */
import { describe, it, expect } from 'vitest';
import { declaredFields, documentation } from './intuit-schema';
import {
    billableLines, toQboLines, buildInvoicePayload,
} from '../../../server/services/qbo/invoice-payload';

const lines = (items: Array<{ description: string; amountCents: number; quantity?: number }>, total: number) =>
    toQboLines(billableLines(items, total), 'ITEM-1');

const payloadFor = (items: Array<{ description: string; amountCents: number }>, total: number) =>
    buildInvoicePayload({
        docNumber: 'INV-001',
        txnDate:   '2026-08-16',
        dueDate:   '2026-09-15',
        lines:     lines(items, total),
        qboCustomerId: 'QBO-CUST-1',
        status:    'sent',
    });

const ITEMISED = [{ description: 'Full home inspection', amountCents: 45000 }];

describe('the Invoice document we send', () => {
    it('uses only field names Intuit declares on Invoice', () => {
        // The REST API is JSON and the schema is XML, but the mapping is
        // name-for-name — so a key we invented, or misspelled, is a key
        // QuickBooks accepts the document with and then ignores. That failure
        // is silent on both sides.
        const declared = declaredFields('Invoice');
        expect(declared.size).toBeGreaterThan(50);   // the reader found the type
        const sent = Object.keys(payloadFor(ITEMISED, 45000));
        expect(sent.length).toBeGreaterThan(0);
        expect(sent.filter((k) => !declared.has(k))).toEqual([]);
    });

    it('uses only field names Intuit declares on a sales line', () => {
        const declaredLine = declaredFields('Line');
        const declaredDetail = declaredFields('SalesItemLineDetail');
        expect(declaredLine.size).toBeGreaterThan(0);
        expect(declaredDetail.size).toBeGreaterThan(0);

        const [line] = lines(ITEMISED, 45000);
        const lineKeys = Object.keys(line!).filter((k) => k !== 'SalesItemLineDetail');
        expect(lineKeys.filter((k) => !declaredLine.has(k))).toEqual([]);
        const detailKeys = Object.keys(line!.SalesItemLineDetail);
        expect(detailKeys.filter((k) => !declaredDetail.has(k))).toEqual([]);
    });

    // --- the rules the schema does NOT enforce -----------------------------
    //
    // These two sentences are Intuit's, quoted out of the vendored file, and
    // they are the whole reason this lane reads documentation at all. BOTH
    // `Line` and `CustomerRef` are declared `minOccurs="0"` — see
    // `intuit-schema.contract.spec.ts`, which pins that — so schema validation
    // passes the exact documents QuickBooks refuses with faults 2020 and 6190.
    // The binding rules are prose; assert the prose.

    const INVOICE_DOC = documentation('Invoice');

    it('still states the two rules we broke, in Intuit\'s own words', () => {
        // If a schema refresh reworded these, the quotes below stop being
        // Intuit's and the assertions under them stop meaning anything. Fail
        // here rather than let them drift into folklore.
        expect(INVOICE_DOC).toContain(
            'An invoice must have at least one line that describes the item and an amount.',
        );
        expect(INVOICE_DOC).toContain(
            'An invoice must have a reference to a customer in the header.',
        );
    });

    it('has at least one line even when the invoice carries no itemisation', () => {
        // The dashboard's "New invoice" dialog collects an amount and no line
        // items; every invoice raised through it was refused for this.
        const payload = payloadFor([], 44400);
        expect(Array.isArray(payload.Line)).toBe(true);
        expect(payload.Line as unknown[]).toHaveLength(1);
        expect((payload.Line as Array<{ Amount: number }>)[0]!.Amount).toBe(444);
    });

    it('keeps the tenant\'s own lines when there are some — the positive control', () => {
        // Without this, a fallback that fired unconditionally would satisfy the
        // spec above and quietly replace real itemisation with one summary line.
        const payload = payloadFor(
            [{ description: 'Inspection', amountCents: 40000 }, { description: 'Radon', amountCents: 5000 }],
            45000,
        );
        expect(payload.Line as unknown[]).toHaveLength(2);
    });

    it('references a customer in the header', () => {
        expect(payloadFor(ITEMISED, 45000).CustomerRef).toEqual({ value: 'QBO-CUST-1' });
    });
});
