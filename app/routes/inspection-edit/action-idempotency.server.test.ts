// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { writeKeyFor } from './action-idempotency.server';

const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.append(k, v);
    return data;
};

describe('writeKeyFor', () => {
    it.each(['unit-create', 'unit-duplicate', 'unit-bulk-create', 'add-statutory-instance', 'upload-cover'])(
        '%s carries the key the transport sent',
        (intent) => {
            expect(writeKeyFor(intent, form({ intent, idempotencyKey: ' k-1 ' }))).toBe('k-1');
        },
    );

    it.each(['complete', 'publish', 'unit-rename', 'unit-delete', 'set-cover', 'save-settings'])(
        '%s is idempotent by nature and takes none',
        (intent) => {
            expect(writeKeyFor(intent, form({ intent, idempotencyKey: 'k-1' }))).toBeUndefined();
        },
    );

    it('a create without a key, or with a blank one, takes none', () => {
        expect(writeKeyFor('unit-create', form({ intent: 'unit-create' }))).toBeUndefined();
        expect(writeKeyFor('unit-create', form({ intent: 'unit-create', idempotencyKey: '   ' }))).toBeUndefined();
    });

    it('a missing or non-string intent takes none', () => {
        expect(writeKeyFor(null, form({ idempotencyKey: 'k-1' }))).toBeUndefined();
    });
});
