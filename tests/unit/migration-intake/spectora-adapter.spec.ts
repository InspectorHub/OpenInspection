/**
 * The Spectora adapter — the bundle it produces, and the two shapes it
 * refuses. The conversion itself is covered by the existing converter specs;
 * what is new here is that the result is a bundle whose accounting validates.
 */
import { describe, it, expect } from 'vitest';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';

const EXPORT = {
    id: 'sp-1',
    name: 'Residential',
    sections: [
        {
            id: 'sec-1',
            name: 'Roof',
            items: [
                {
                    id: 'it-1',
                    name: 'Covering',
                    comments: [
                        { id: 'c-1', type: 'DEFECT', title: 'Missing shingles', text: 'Several are gone.' },
                        { id: 'c-2', type: 'INFORMATIONAL', title: 'Material', text: 'Asphalt.' },
                    ],
                },
            ],
        },
    ],
};

describe('spectoraAdapter', () => {
    it('produces a bundle that passes the format validator', () => {
        const result = spectoraAdapter.convert(EXPORT, { name: 'Imported residential' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed = parseMigrationBundle(result.bundle);
        expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
        expect(parsed.ok).toBe(true);
    });

    it('names the template from the caller, not from the export', () => {
        const result = spectoraAdapter.convert(EXPORT, { name: 'Imported residential' });
        expect(result.ok && result.bundle.templates[0].name).toBe('Imported residential');
    });

    it('accounts for exactly one template read and one emitted', () => {
        const result = spectoraAdapter.convert(EXPORT, { name: 'X' });
        expect(result.ok && result.bundle.manifest.counts.template)
            .toEqual({ readFromSource: 1, emitted: 1, dropped: [] });
        expect(result.ok && result.bundle.manifest.counts.contact.emitted).toBe(0);
        expect(result.ok && result.bundle.manifest.counts.member.emitted).toBe(0);
    });

    it('carries no primary key of ours anywhere in the bundle', () => {
        const result = spectoraAdapter.convert(EXPORT, { name: 'X' });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(Object.keys(result.bundle.templates[0])).toEqual(['name', 'schema', 'stats']);
    });

    it('reports an unknown comment kind as an adapter-level warning', () => {
        const result = spectoraAdapter.convert({
            sections: [{ id: 's', name: 'S', items: [{ id: 'i', name: 'I', comments: [{ id: 'c', type: 'WEIRD', text: 'x' }] }] }],
        }, { name: 'X' });
        expect(result.ok && result.bundle.manifest.warnings.map((w) => w.code)).toEqual(['UNKNOWN_COMMENT_TYPE']);
    });

    it('refuses a payload that is not an object', () => {
        const result = spectoraAdapter.convert('not json', { name: 'X' });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NOT_AN_EXPORT');
    });

    it('refuses an export with no sections rather than emitting an empty template', () => {
        const result = spectoraAdapter.convert({ id: 'x', name: 'y' }, { name: 'X' });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.code).toBe('NO_SECTIONS');
    });
});
