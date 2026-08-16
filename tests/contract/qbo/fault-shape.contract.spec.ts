/**
 * What we read out of a QuickBooks failure, against the shape Intuit declares.
 *
 * `describeQboError` is the reason this integration's failures are now
 * diagnosable at all: before it, every refusal was recorded as the seven
 * characters `QBO 400`, and two fatal defects hid behind that string for their
 * entire life while QuickBooks named them in the response. So the fields it
 * reaches for had better be the fields Intuit sends.
 *
 * `IntuitRestServiceDef.xsd` declares the envelope. It does NOT declare a single
 * error CODE — `6240`, the fault a duplicate DisplayName really returns, is in
 * none of the vendored files. Codes come off the wire or not at all, which is
 * the boundary between this lane and the live one.
 */
import { describe, it, expect } from 'vitest';
import { declaredFields, enumValues } from './intuit-schema';
import { describeQboError } from '../../../server/services/qbo/error-detail';

describe('the fault envelope we parse', () => {
    it('reads only fields Intuit declares on Error', () => {
        const declared = declaredFields('Error');
        expect(declared.size).toBeGreaterThan(0);
        // The four `describeQboError` reaches for. `code` is an attribute on the
        // XML side and a key on the JSON side; the reader covers both.
        for (const field of ['Message', 'Detail', 'code', 'element']) {
            expect(declared.has(field)).toBe(true);
        }
    });

    it('knows the fault categories Intuit can send', () => {
        // Pinned so a refresh that adds a category is noticed. The misspelling
        // is Intuit's and is reproduced deliberately — correcting it here would
        // make this spec disagree with the wire.
        expect(enumValues('FaultTypeEnum')).toEqual([
            'AuthenticationFault', 'AuthorizatonFault', 'ValidationFault', 'SystemFault',
        ]);
    });

    it('repeats every reported error, not just the first', () => {
        // One ValidationFault can carry several entries, and reporting only the
        // leading one costs a whole round trip to discover the second.
        const err = Object.assign(new Error('QBO 400'), {
            qboResponse: {
                Fault: {
                    type: 'ValidationFault',
                    Error: [
                        { Message: 'Business Validation Error', Detail: 'first thing', code: '6000' },
                        { Message: 'Duplicate Name Exists Error', Detail: 'second thing', code: '6240' },
                    ],
                },
            },
        });
        const described = describeQboError(err);
        expect(described).toContain('first thing');
        expect(described).toContain('second thing');
        expect(described).toContain('6000');
        expect(described).toContain('6240');
    });

    it('names the field when Intuit names one', () => {
        const err = Object.assign(new Error('QBO 400'), {
            qboResponse: {
                Fault: {
                    type: 'ValidationFault',
                    Error: [{
                        Message: 'Required param missing',
                        Detail:  'Required parameter Line is missing in the request',
                        code:    '2020',
                        element: 'Line',
                    }],
                },
            },
        });
        expect(describeQboError(err)).toContain('[Line]');
    });

    it('falls back to the plain message when there is no fault to read', () => {
        // The negative control: a transport failure has no `qboResponse`, and
        // this must not invent structure that was not there.
        expect(describeQboError(new Error('fetch failed'))).toBe('fetch failed');
    });
});
