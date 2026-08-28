import { describe, it, expect } from 'vitest';
import { statutoryFormEntries } from '../../../server/lib/db/schema';

describe('statutory_form_entries', () => {
    it('carries one row per (tenant, inspection, form)', () => {
        const cols = Object.keys(statutoryFormEntries);
        expect(cols).toEqual(expect.arrayContaining(
            ['id', 'tenantId', 'inspectionId', 'formId', 'values', 'updatedAt']));
    });
});
