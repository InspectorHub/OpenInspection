/**
 * The generic CSV adapter — one file, two entity kinds, and the accounting
 * that makes a skipped line visible.
 *
 * A LINE IS NOT DROPPED FOR BEING WRONG. A row the adapter cannot make sense of
 * is emitted as the file wrote it and explained against that row on the repair
 * screen; only a line with nothing in any mapped column is dropped, because
 * there is no value on it to correct. Each assertion below therefore pairs the
 * emitted entry with what `describeRowProblem` says about it — the emission
 * alone would prove only that something was carried, not that the operator will
 * be told what to do with it.
 *
 * Every line that does not become an entry is still named with its line number
 * and a reason. That is the difference between "3 of 5 imported" (which sends
 * the operator hunting) and "line 5 is blank".
 */
import { describe, it, expect } from 'vitest';
import { csvGenericAdapter } from '../../../server/lib/migration-intake/adapters/csv-generic';
import { describeRowProblem } from '../../../server/lib/migration-intake/row-problems';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';

describe('csvGenericAdapter — contacts', () => {
    const csv = [
        'Full Name,Email,Brokerage',
        'Alice Ng,alice@example.test,Acme Realty',
        'Bob Ray,bob@example.test,"Beta, Inc."',
        ',orphan@example.test,Nobody',
        ',,',
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

    it('emits one contact per line that holds anything, and validates as a bundle', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.contacts).toEqual([
            { name: 'Alice Ng', email: 'alice@example.test', agency: 'Acme Realty', type: 'agent' },
            { name: 'Bob Ray', email: 'bob@example.test', agency: 'Beta, Inc.', type: 'agent' },
            // The nameless line is CARRIED rather than lost: an entry the
            // operator can be shown and asked about.
            { name: '', email: 'orphan@example.test', agency: 'Nobody', type: 'agent' },
        ]);
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('stages the nameless line as a problem, and leaves the good ones good', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const problems = result.bundle.contacts.map((c) => describeRowProblem('contact', c));
        // Two good, one bad, and the bad one named — not "at least one bad".
        expect(problems.filter((p) => p === null)).toHaveLength(2);
        expect(problems[2]).toMatchObject({ field: 'name' });
    });

    it('names the one dropped line instead of counting it', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok && result.bundle.manifest.counts.contact).toEqual({
            readFromSource: 4,
            emitted: 3,
            // Only the line with nothing on it at all. A blank line has no value
            // to repair, so there is nothing a staged row could offer.
            dropped: [{ at: 'line 5', reason: 'every mapped column is empty on this line' }],
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

    it('carries a type outside the vocabulary AS THE FILE SPELLS IT, and stages it', () => {
        const typed = ['Full Name,Kind', 'Alice,client', 'Bob,Vendor'].join('\n');
        const result = csvGenericAdapter.convert(typed, {
            entity: 'contact',
            mapping: { name: 'Full Name', type: { column: 'Kind' } },
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // Not lower-cased. The operator has to find "Vendor" in their own file.
        expect(result.bundle.contacts.map((c) => c.type)).toEqual(['client', 'Vendor']);
        expect(result.bundle.manifest.counts.contact.dropped).toEqual([]);
        expect(describeRowProblem('contact', result.bundle.contacts[0])).toBeNull();
        expect(describeRowProblem('contact', result.bundle.contacts[1])).toMatchObject({
            field: 'type', value: 'Vendor', suggestion: 'client',
        });
    });

    it('still folds the case of a type it recognises, so "Client" imports untouched', () => {
        const typed = ['Full Name,Kind', 'Alice,Client'].join('\n');
        const result = csvGenericAdapter.convert(typed, {
            entity: 'contact',
            mapping: { name: 'Full Name', type: { column: 'Kind' } },
        });
        expect(result.ok && result.bundle.contacts.map((c) => c.type)).toEqual(['client']);
        expect(result.ok && describeRowProblem('contact', result.bundle.contacts[0])).toBeNull();
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

    it('emits every line and validates as a bundle', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.members).toEqual([
            { email: 'ins@example.test', name: 'Ins Pector', role: 'inspector' },
            { email: 'mgr@example.test', name: 'Man Ager', role: 'manager' },
            { email: 'agt@example.test', name: 'A Gent', role: 'agent' },
            // The address is written even though the cell was empty: the field
            // is where the invitation goes, so an entry without it is a row no
            // screen could repair.
            { email: '', name: 'No Email', role: 'inspector' },
        ]);
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    });

    it('stages the agent row and the address-less one, each with its own sentence', () => {
        const result = csvGenericAdapter.convert(csv, options);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const problems = result.bundle.members.map((m) => describeRowProblem('member', m));
        expect(problems.filter((p) => p === null)).toHaveLength(2);
        expect(problems[2]).toMatchObject({ field: 'role', value: 'agent', suggestion: 'inspector' });
        expect(problems[2]?.reason).toMatch(/per inspection/);
        expect(problems[3]).toMatchObject({ field: 'email' });
        expect(problems[3]?.reason).toMatch(/no email address/);
        // Nothing lost, and the accounting still closes over the whole file.
        expect(result.bundle.manifest.counts.member.readFromSource).toBe(4);
        expect(result.bundle.manifest.counts.member.emitted).toBe(4);
        expect(result.bundle.manifest.counts.member.dropped).toEqual([]);
    });

    it('drops a member line with nothing in any mapped column, and names it', () => {
        const blank = ['Email,Name,Role', 'ins@example.test,Ins Pector,inspector', ',,'].join('\n');
        const result = csvGenericAdapter.convert(blank, options);
        expect(result.ok && result.bundle.members).toHaveLength(1);
        expect(result.ok && result.bundle.manifest.counts.member.dropped).toEqual([
            { at: 'line 3', reason: 'every mapped column is empty on this line' },
        ]);
    });

    it('applies a fixed role when the mapping gives one instead of a column', () => {
        const result = csvGenericAdapter.convert('Email\nx@example.test', {
            entity: 'member',
            mapping: { email: 'Email', role: { fixed: 'inspector' } },
        });
        expect(result.ok && result.bundle.members).toEqual([{ email: 'x@example.test', role: 'inspector' }]);
    });
});
