/**
 * The generic CSV adapter — one file, two entity kinds, and the accounting
 * that makes a skipped line visible.
 *
 * Every line that does not become an entry is named with its line number and a
 * reason. That is the difference between "3 of 5 imported" (which sends the
 * operator hunting) and "line 4 has no name, line 5 has no name".
 */
import { describe, it, expect } from 'vitest';
import { csvGenericAdapter } from '../../../server/lib/migration-intake/adapters/csv-generic';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';

describe('csvGenericAdapter — contacts', () => {
    const csv = [
        'Full Name,Email,Brokerage',
        'Alice Ng,alice@example.test,Acme Realty',
        'Bob Ray,bob@example.test,"Beta, Inc."',
        ',orphan@example.test,Nobody',
    ].join('\n');

    const options = {
        entity: 'contact' as const,
        mapping: {
            name: 'Full Name',
            email: 'Email',
            agency: 'Brokerage',
            type: { fixed: 'agent' as const },
        },
    };

    it('emits one contact per usable line and validates as a bundle', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.contacts).toEqual([
            { name: 'Alice Ng', email: 'alice@example.test', agency: 'Acme Realty', type: 'agent' },
            { name: 'Bob Ray', email: 'bob@example.test', agency: 'Beta, Inc.', type: 'agent' },
        ]);
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('names the dropped line instead of counting it', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok && result.bundle.manifest.counts.contact).toEqual({
            readFromSource: 3,
            emitted: 2,
            dropped: [{ at: 'line 4', reason: 'the mapped name column is empty' }],
        });
    });

    it('takes the contact type from a column when the mapping names one', () => {
        const typed = [
            'Full Name,Kind',
            'Alice,agent',
            'Bob,client',
        ].join('\n');
        const result = csvGenericAdapter.convert(typed, {
            entity: 'contact',
            mapping: { name: 'Full Name', type: { column: 'Kind' } },
        });
        expect(result.ok && result.bundle.contacts.map((c) => c.type)).toEqual(['agent', 'client']);
    });

    it('drops a line whose type column holds a value outside the vocabulary', () => {
        const typed = ['Full Name,Kind', 'Alice,vendor'].join('\n');
        const result = csvGenericAdapter.convert(typed, {
            entity: 'contact',
            mapping: { name: 'Full Name', type: { column: 'Kind' } },
        });
        expect(result.ok && result.bundle.contacts).toEqual([]);
        expect(result.ok && result.bundle.manifest.counts.contact.dropped).toEqual([
            { at: 'line 2', reason: 'contact type "vendor" is not one of agent, client, other' },
        ]);
    });

    it('refuses a file whose header does not carry the mapped column', () => {
        const result = csvGenericAdapter.convert('A,B\n1,2', options);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('MISSING_COLUMN');
        expect(!result.ok && result.error.message).toMatch(/Full Name/);
    });

    it('refuses an empty file', () => {
        const result = csvGenericAdapter.convert('', options);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('EMPTY_FILE');
    });
});

describe('csvGenericAdapter — members', () => {
    const csv = [
        'Email,Name,Role',
        'ins@example.test,Ins Pector,inspector',
        'mgr@example.test,Man Ager,manager',
        'agt@example.test,A Gent,agent',
        ',No Email,inspector',
    ].join('\n');

    const options = {
        entity: 'member' as const,
        mapping: { email: 'Email', name: 'Name', role: { column: 'Role' } },
    };

    it('emits the staff roles and validates as a bundle', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.members).toEqual([
            { email: 'ins@example.test', name: 'Ins Pector', role: 'inspector' },
            { email: 'mgr@example.test', name: 'Man Ager', role: 'manager' },
        ]);
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('drops an agent row and says why, rather than silently downgrading it', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok && result.bundle.manifest.counts.member.dropped).toEqual([
            { at: 'line 4', reason: 'agent access is granted per inspection and cannot be imported here' },
            { at: 'line 5', reason: 'the mapped email column is empty' },
        ]);
        expect(result.ok && result.bundle.manifest.counts.member.readFromSource).toBe(4);
        expect(result.ok && result.bundle.manifest.counts.member.emitted).toBe(2);
    });

    it('applies a fixed role when the mapping gives one instead of a column', () => {
        const result = csvGenericAdapter.convert('Email\nx@example.test', {
            entity: 'member',
            mapping: { email: 'Email', role: { fixed: 'inspector' } },
        });
        expect(result.ok && result.bundle.members).toEqual([{ email: 'x@example.test', role: 'inspector' }]);
    });
});
