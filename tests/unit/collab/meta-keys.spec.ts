/**
 * Meta keys (`_inspector_signature`) are not findings: the results document never
 * holds them, and a persist must not replace them in the blob.
 *
 * The workers spec tests/workers/collab-legacy-key-rename.spec.ts runs the same
 * thing through the real Durable Object.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { isMetaKey } from '../../../server/lib/finding-key';
import { loadResultsProjection, projectResults, seedResultsDoc } from '../../../server/lib/collab/results-doc';
import type { ResultsProjection } from '../../../server/lib/collab/results-doc.types';
import { writeResultsProjection } from '../../../server/durable-objects/inspection-doc-d1';

const SIGNATURE = { signatureBase64: 'sig', signedAt: 1 };

describe('isMetaKey', () => {
    it.each([
        ['_inspector_signature', true],
        ['_anything', true],
        ['_', true],
        ['_default:s:i', false],
        ['_default:_unknown:x', false],
        ['unit-1:s:i', false],
        ['roof', false],
        ['', false],
        ['s:i', false],
        ['_s:i', true],
    ])('%j -> %s', (key, expected) => {
        expect(isMetaKey(key)).toBe(expected);
    });
});

describe('the results document and meta keys', () => {
    it('does not seed an item map for a meta key when it imports a blob, and still imports the findings', () => {
        const doc = new Y.Doc();
        loadResultsProjection(doc, {
            _inspector_signature: SIGNATURE,
            _other_meta: { a: 1 },
            '_default:s1:roof': { rating: 'D' },
        } as unknown as ResultsProjection);

        expect([...doc.getMap('results').keys()]).toEqual(['_default:s1:roof']);
        expect(projectResults(doc)).toEqual({ '_default:s1:roof': { rating: 'D' } });
    });

    it('does not project an empty item map a document already holds for a meta key', () => {
        const doc = new Y.Doc();
        seedResultsDoc(doc, [{ findingKey: '_default:s1:roof' }]);
        doc.getMap<unknown>('results').set('_inspector_signature', new Y.Map<unknown>());

        expect(projectResults(doc)).toEqual({ '_default:s1:roof': {} });
    });
});

describe('writeResultsProjection reading the row first', () => {
    it('writes nothing when the row cannot be read, and says so by throwing', async () => {
        const statements: string[] = [];
        const d1 = {
            prepare: (sql: string) => {
                statements.push(sql);
                throw new Error('d1 unavailable');
            },
        } as unknown as D1Database;

        await expect(
            writeResultsProjection(d1, { tenantId: 't1', inspectionId: 'i1', reportId: 'r1' }, new Uint8Array([1]), { '_default:s1:roof': { rating: 'D' } }),
        ).rejects.toThrow('d1 unavailable');

        expect(statements).toHaveLength(1);
        expect(statements[0]?.toLowerCase()).toContain('select');
        expect(statements.some((s) => s.toLowerCase().includes('update'))).toBe(false);
    });
});
