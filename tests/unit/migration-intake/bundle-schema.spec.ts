/**
 * MigrationBundleV1 — the format contract between an adapter and the staging
 * step, and the three rules that make its counts trustworthy.
 *
 * The rules exist because the shape they replace was observed to fail
 * silently: a payload of entirely unusable entries could report success with
 * every count at zero, because only the entries that survived were counted.
 * An equation the validator checks means a dropped entry has to be written
 * down before the bundle is accepted at all.
 */
import { describe, it, expect } from 'vitest';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';
import { describeRowProblem } from '../../../server/lib/migration-intake/row-problems';

function emptyCounts() {
    return { readFromSource: 0, emitted: 0, dropped: [] as { at: string; reason: string }[] };
}

function bundleWith(overrides: Record<string, unknown> = {}) {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: { template: emptyCounts(), contact: emptyCounts(), member: emptyCounts() },
            warnings: [],
        },
        templates: [],
        contacts: [],
        members: [],
        ...overrides,
    };
}

describe('parseMigrationBundle', () => {
    it('accepts a well-formed empty bundle', () => {
        const result = parseMigrationBundle(bundleWith());
        expect(result.ok).toBe(true);
    });

    it('rejects a bundle whose formatVersion is not 1', () => {
        const result = parseMigrationBundle(bundleWith({ formatVersion: 2 }));
        expect(result.ok).toBe(false);
    });

    it('rejects readFromSource that does not equal emitted plus dropped', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 5, emitted: 3, dropped: [{ at: 'contacts[4]', reason: 'no name' }] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [
                { name: 'A', type: 'client' },
                { name: 'B', type: 'client' },
                { name: 'C', type: 'client' },
            ],
        }));
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.issues.join(' ')).toMatch(/contact/);
    });

    it('accepts the same counts once every dropped entry is named', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: {
                        readFromSource: 5,
                        emitted: 3,
                        dropped: [
                            { at: 'contacts[3]', reason: 'row has no name' },
                            { at: 'contacts[4]', reason: 'row has no name' },
                        ],
                    },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [
                { name: 'A', type: 'client' },
                { name: 'B', type: 'client' },
                { name: 'C', type: 'client' },
            ],
        }));
        expect(result.ok).toBe(true);
    });

    it('rejects emitted that disagrees with the array it counts', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 12, emitted: 12, dropped: [] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [
                { name: 'A', type: 'client' },
                { name: 'B', type: 'client' },
                { name: 'C', type: 'client' },
            ],
        }));
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.issues.join(' ')).toMatch(/emitted/);
    });

    it('requires the contact type KEY — the mapping step has to ask for it', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 1, emitted: 1, dropped: [] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [{ name: 'A' }],
        }));
        expect(result.ok).toBe(false);
    });

    /**
     * The reversal, stated as a contract: a ROW's own faults are not the FILE's.
     *
     * Each case below used to make `parseMigrationBundle` return `ok: false`,
     * which cost the operator the whole upload and named neither the row nor the
     * column. They are now accepted into the format and explained one row at a
     * time — so every assertion pairs "the file was read" with "and this is what
     * the operator is told about the row", because the first without the second
     * would only prove that a bad value now passes silently.
     */
    describe('a bad row stages instead of voiding the file', () => {
        function oneMember(member: Record<string, unknown>) {
            return parseMigrationBundle(bundleWith({
                manifest: {
                    source: { vendor: 'csv_generic' },
                    adapter: { name: 'csv-generic', version: '1' },
                    counts: {
                        template: emptyCounts(),
                        contact: emptyCounts(),
                        member: { readFromSource: 1, emitted: 1, dropped: [] },
                    },
                    warnings: [],
                },
                members: [member],
            }));
        }

        function oneContact(contact: Record<string, unknown>) {
            return parseMigrationBundle(bundleWith({
                manifest: {
                    source: { vendor: 'csv_generic' },
                    adapter: { name: 'csv-generic', version: '1' },
                    counts: {
                        template: emptyCounts(),
                        contact: { readFromSource: 1, emitted: 1, dropped: [] },
                        member: emptyCounts(),
                    },
                    warnings: [],
                },
                contacts: [contact],
            }));
        }

        it('accepts a member row with the agent role, and the describer explains it', () => {
            const result = oneMember({ email: 'a@example.test', role: 'agent' });
            expect(result.ok).toBe(true);
            expect(describeRowProblem('member', { email: 'a@example.test', role: 'agent' }))
                .toMatchObject({ field: 'role', value: 'agent', suggestion: 'inspector' });
        });

        it('accepts a member row whose address is malformed, and refuses to call it fine', () => {
            const result = oneMember({ email: 'not-an-address', role: 'inspector' });
            expect(result.ok).toBe(true);
            expect(describeRowProblem('member', { email: 'not-an-address', role: 'inspector' }))
                .toMatchObject({ field: 'email', value: 'not-an-address' });
        });

        it('still REQUIRES the member email key — a row without it cannot be repaired', () => {
            expect(oneMember({ role: 'inspector' }).ok).toBe(false);
        });

        it('accepts a contact with no name and one whose type is not ours', () => {
            expect(oneContact({ name: '', type: 'client' }).ok).toBe(true);
            expect(oneContact({ name: 'A', type: 'Buyer' }).ok).toBe(true);
            expect(describeRowProblem('contact', { name: '', type: 'client' }))
                .toMatchObject({ field: 'name' });
            expect(describeRowProblem('contact', { name: 'A', type: 'Buyer' }))
                .toMatchObject({ field: 'type', value: 'Buyer' });
        });

        it('keeps the contact email OPTIONAL — a contact without one is fine', () => {
            const result = oneContact({ name: 'A', type: 'client' });
            expect(result.ok).toBe(true);
            // The positive control for the sentence the product actually shows:
            // "Correct it, or clear it — a contact without one is fine."
            expect(describeRowProblem('contact', { name: 'A', type: 'client' })).toBeNull();
        });

        it('keeps the SHAPES it cannot explain — a name that is a number is still refused', () => {
            expect(oneContact({ name: 42, type: 'client' }).ok).toBe(false);
            expect(oneMember({ email: 7, role: 'inspector' }).ok).toBe(false);
        });
    });

    /**
     * ONE definition of "an email address", named by a value the two old ones
     * disagreed about.
     *
     * The upload was gated on zod's `.email()` while the repair screen judged the
     * same value by a looser shape. `x@y.z` is a value they disagree about: zod
     * rejects it, the row rule accepts it. Under the old pair, a spreadsheet
     * containing it was refused WHOLE — and the screen built to fix the row had
     * nothing to say about it, because it did not think anything was wrong.
     */
    describe('the two email rules are now one', () => {
        function contactWithEmail(email: string) {
            return parseMigrationBundle(bundleWith({
                manifest: {
                    source: { vendor: 'csv_generic' },
                    adapter: { name: 'csv-generic', version: '1' },
                    counts: {
                        template: emptyCounts(),
                        contact: { readFromSource: 1, emitted: 1, dropped: [] },
                        member: emptyCounts(),
                    },
                    warnings: [],
                },
                contacts: [{ name: 'A', email, type: 'client' }],
            }));
        }

        it('admits "x@y.z", which zod rejected and the repair screen always accepted', () => {
            expect(contactWithEmail('x@y.z').ok).toBe(true);
            expect(describeRowProblem('contact', { name: 'A', email: 'x@y.z', type: 'client' }))
                .toBeNull();
        });

        it('admits an address with a non-ASCII letter, for the same reason', () => {
            const address = 'j\u00fcrgen@m\u00fcller.example';
            expect(contactWithEmail(address).ok).toBe(true);
            expect(describeRowProblem('contact', { name: 'A', email: address, type: 'client' }))
                .toBeNull();
        });

        it('positive control: a value BOTH rules reject stages as a problem, not a refusal', () => {
            expect(contactWithEmail('nope').ok).toBe(true);
            expect(describeRowProblem('contact', { name: 'A', email: 'nope', type: 'client' }))
                .toMatchObject({ field: 'email', value: 'nope' });
        });
    });

    it('rejects a bundle carrying an id for a row it has not created yet', () => {
        const result = parseMigrationBundle(bundleWith({
            manifest: {
                source: { vendor: 'csv_generic' },
                adapter: { name: 'csv-generic', version: '1' },
                counts: {
                    template: emptyCounts(),
                    contact: { readFromSource: 1, emitted: 1, dropped: [] },
                    member: emptyCounts(),
                },
                warnings: [],
            },
            contacts: [{ id: 'vendor-42', name: 'A', type: 'client' }],
        }));
        expect(result.ok).toBe(false);
    });
});
