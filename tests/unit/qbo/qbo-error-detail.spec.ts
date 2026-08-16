/**
 * A QuickBooks failure has to say what QuickBooks objected to.
 *
 * `apiCall` throws `Error('QBO 400')` and hangs the parsed response off the
 * error as `qboResponse`. Every sink recorded only `error.message`, so
 * `qbo_sync_errors.error_msg` and the log line both read `QBO 400` — for a
 * status QuickBooks returns for a missing required field, a bad reference, an
 * over-long string, a stale SyncToken, and an unsupported verb alike.
 *
 * That one string is how both of this integration's shipped defects stayed
 * hidden for their entire life: every update was sent as a PUT, which
 * QuickBooks answers `No resource method found for PUT`, and every invoice went
 * without a `CustomerRef`, which it answers `CustomerRef is required`. It was
 * naming them in the response the whole time. Nothing read it.
 *
 * The retry loop had a second version of the same problem: when it ran out of
 * attempts it threw a sentence of its own — "after 3 stale-token retries" —
 * which is a DIAGNOSIS, and it was wrong for every 400 that was not a stale
 * token. An invalid CustomerRef refetches cleanly and fails identically three
 * times, and the row then blamed a token that was never involved.
 */
import { describe, it, expect } from 'vitest';
import { describeQboError } from '../../../server/services/qbo/api-base';

const fault = (...errors: Array<Record<string, unknown>>) =>
    Object.assign(new Error('QBO 400'), {
        status: 400,
        qboResponse: { Fault: { Error: errors, type: 'ValidationFault' } },
    });

describe('describeQboError', () => {
    it('repeats what QuickBooks said, with the field and the code', () => {
        const msg = describeQboError(fault({
            Message: 'CustomerRef is required',
            Detail:  'CustomerRef is missing in the request',
            code:    '6560',
            element: 'Invoice',
        }));
        expect(msg).toContain('CustomerRef is missing in the request');
        expect(msg).toContain('Invoice');
        expect(msg).toContain('6560');
    });

    it('keeps every entry — one response can carry several problems', () => {
        // The real 400 that surfaced this carried both at once. Reporting only
        // the first costs a round trip to discover the second.
        const msg = describeQboError(fault(
            { Detail: 'Supplied length:22', code: '2050', element: 'DocNumber' },
            { Detail: 'CustomerRef is missing in the request', code: '6560', element: 'Invoice' },
        ));
        expect(msg).toContain('Supplied length:22');
        expect(msg).toContain('CustomerRef is missing in the request');
    });

    it('prefers Detail, which is the specific half, but accepts Message alone', () => {
        expect(describeQboError(fault({ Message: 'Stale Object Error', code: '5010' })))
            .toContain('Stale Object Error');
    });

    it('degrades to the bare message when there is no fault to read', () => {
        // A 5xx, a network error, or anything thrown before the response body
        // was parsed. It must not become "undefined" or throw a second time.
        expect(describeQboError(new Error('QBO 503'))).toBe('QBO 503');
        expect(describeQboError('not an error at all')).toBe('not an error at all');
        expect(describeQboError(null)).toBe('null');
        expect(describeQboError(Object.assign(new Error('QBO 400'), { qboResponse: {} })))
            .toBe('QBO 400');
    });

    it('ignores a Fault whose Error list is empty rather than emitting a bare colon', () => {
        expect(describeQboError(fault())).toBe('QBO 400');
    });
});
