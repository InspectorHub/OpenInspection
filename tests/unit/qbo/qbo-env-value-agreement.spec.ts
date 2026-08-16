import { describe, it, expect } from 'vitest';
import { validateStripeKeyFormats } from '../../../server/lib/secrets-catalog';
import { resolveQboApiBase } from '../../../server/services/qbo/api-base';

/**
 * Two places decide what `QBO_ENV` may be, and they must not drift.
 *
 * The settings form validates it when a self-hoster types it; `resolveQboApiBase`
 * rejects it when the worker tries to reach Intuit. A comment asking the next
 * person to keep the two in step is the kind of coupling this repo requires to
 * be executable instead — so this asserts the agreement rather than describing
 * it. Widening one side alone turns a value the form accepts into a connection
 * that fails at OAuth, which is precisely the round trip the validator exists
 * to spare the tenant.
 */
const ACCEPTED = ['sandbox', 'production'];

const REJECTED = [
    'Sandbox',      // capitalised — the likeliest typo
    'prod',
    'sandbox2',
    '',
];

/**
 * Surrounding whitespace is NOT a disagreement, and finding out why is the
 * reason this file exists. The validator tests `v.trim()`, and the save path
 * (`api/secrets.ts`) stores `value.trim()` — so the resolver is only ever
 * handed the trimmed form. Accepting it at the field is correct; the two ends
 * agree because the middle normalises.
 */
const NORMALISED = ['  sandbox', 'production '];

describe('QBO_ENV: the form and the API base agree on the valid set', () => {
    it.each(ACCEPTED)('accepts %j in both places', (value) => {
        expect(validateStripeKeyFormats({ QBO_ENV: value })).toBeNull();
        expect(() => resolveQboApiBase(value)).not.toThrow();
    });

    it.each(REJECTED)('rejects %j in both places', (value) => {
        // An empty value is "leave it alone" to the form, so only the API base
        // speaks for that one; every other shape must be refused by both.
        if (value !== '') {
            expect(validateStripeKeyFormats({ QBO_ENV: value })).not.toBeNull();
        }
        expect(() => resolveQboApiBase(value)).toThrow();
    });

    it.each(NORMALISED)('accepts %j at the field, and it reaches the resolver trimmed', (value) => {
        expect(validateStripeKeyFormats({ QBO_ENV: value })).toBeNull();
        // What the save path stores. Asserting the trim here is what keeps the
        // two ends honest: drop it from api/secrets.ts and this goes red rather
        // than surfacing as a failed OAuth round trip.
        expect(() => resolveQboApiBase(value.trim())).not.toThrow();
        expect(() => resolveQboApiBase(value)).toThrow();
    });

    it('rejects an unset value at the API base', () => {
        expect(() => resolveQboApiBase(undefined)).toThrow();
    });
});
