import { describe, it, expect } from 'vitest';
import { isForeignKeyViolation } from '../../../server/lib/db/foreign-key-violation';

describe('isForeignKeyViolation', () => {
    it('recognises the driver message on the error and on its cause chain', () => {
        expect(isForeignKeyViolation(new Error('FOREIGN KEY constraint failed'))).toBe(true);
        expect(isForeignKeyViolation(new Error('Failed query', { cause: new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed') }))).toBe(true);
    });
    it('does not claim other failures (controls)', () => {
        expect(isForeignKeyViolation(new Error('UNIQUE constraint failed: contacts.email'))).toBe(false);
        expect(isForeignKeyViolation('FOREIGN KEY constraint failed')).toBe(false);
        expect(isForeignKeyViolation(undefined)).toBe(false);
    });
});
