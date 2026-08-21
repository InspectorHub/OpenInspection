/**
 * What makes one staged entry unwritable, said in a sentence that tells the
 * operator what to change.
 *
 * "invalid" and "corrupt" are banned words here. They describe our reaction to
 * the row rather than the row, and a person holding a spreadsheet cannot act on
 * either. Every reason names the field and what would fix it.
 *
 * Every "this is a problem" case is paired with a passing one of the same
 * shape. A predicate that answered "problem" to everything would satisfy the
 * failures alone, and a report built on it would block every import ever
 * staged.
 */
import { describe, it, expect } from 'vitest';
import { describeRowProblem } from '../../../server/lib/migration-intake/row-problems';

describe('describeRowProblem — contacts', () => {
    it('passes a complete contact', () => {
        expect(describeRowProblem('contact', {
            name: 'Alice', email: 'alice@example.test', type: 'client',
        })).toBeNull();
    });

    it('passes a contact with no email at all', () => {
        // Positive control for the email rule below: the address is optional,
        // and only an address that is THERE and unreadable is a problem.
        expect(describeRowProblem('contact', { name: 'Alice', type: 'client' })).toBeNull();
    });

    it('names the missing name column and what to put in it', () => {
        const problem = describeRowProblem('contact', { email: 'a@example.test', type: 'client' });
        expect(problem?.field).toBe('name');
        expect(problem?.reason).toMatch(/name/i);
        expect(problem?.reason).not.toMatch(/invalid|corrupt/i);
    });

    it('shows the value it could not read as an email address', () => {
        const problem = describeRowProblem('contact', { name: 'A', email: 'not-an-email', type: 'client' });
        expect(problem?.field).toBe('email');
        expect(problem?.value).toBe('not-an-email');
        expect(problem?.reason).toMatch(/email address/i);
    });

    it('lists the accepted contact types when the type is not one of them', () => {
        const problem = describeRowProblem('contact', { name: 'A', type: 'vendor' });
        expect(problem?.field).toBe('type');
        expect(problem?.reason).toMatch(/agent, client, other/);
        expect(problem?.suggestion).toBe('client');
    });
});

describe('describeRowProblem — members', () => {
    it('passes a complete member', () => {
        expect(describeRowProblem('member', { email: 'a@example.test', role: 'inspector' })).toBeNull();
    });

    it('requires an email address, because an invitation has nowhere else to go', () => {
        const problem = describeRowProblem('member', { role: 'inspector' });
        expect(problem?.field).toBe('email');
        expect(problem?.reason).toMatch(/invitation/i);
    });

    it('refuses the agent role and says where that access comes from instead', () => {
        const problem = describeRowProblem('member', { email: 'a@example.test', role: 'agent' });
        expect(problem?.field).toBe('role');
        expect(problem?.reason).toMatch(/per inspection/i);
        expect(problem?.suggestion).toBe('inspector');
    });

    it('names the staff roles when the role is not one of them', () => {
        const problem = describeRowProblem('member', { email: 'a@example.test', role: 'wizard' });
        expect(problem?.field).toBe('role');
        expect(problem?.reason).toMatch(/owner, manager, inspector/);
        expect(problem?.suggestion).toBe('inspector');
    });
});

describe('describeRowProblem — templates', () => {
    it('passes a template with a name and sections', () => {
        expect(describeRowProblem('template', {
            name: 'Residential',
            schema: { schemaVersion: 2, sections: [{ id: 's', title: 'Roof', items: [] }] },
        })).toBeNull();
    });

    it('requires a name', () => {
        const problem = describeRowProblem('template', {
            name: '', schema: { schemaVersion: 2, sections: [] },
        });
        expect(problem?.field).toBe('name');
    });

    it('refuses a template with no sections, naming what an empty one would be', () => {
        const problem = describeRowProblem('template', {
            name: 'Empty', schema: { schemaVersion: 2, sections: [] },
        });
        expect(problem?.field).toBe('schema');
        expect(problem?.reason).toMatch(/section/i);
    });
});
