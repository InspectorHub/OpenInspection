/**
 * The log-only check that says when the D1 blob and a stored document disagree.
 * The wiring into hydration is covered in workerd by
 * tests/workers/collab-legacy-key-rename.spec.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { loadResultsProjection } from '../../../server/lib/collab/results-doc';
import type { ResultsProjection } from '../../../server/lib/collab/results-doc.types';
import { logger } from '../../../server/lib/logger';
import { countDivergentFindings, logDivergence } from '../../../server/durable-objects/results-divergence';

afterEach(() => vi.restoreAllMocks());

describe('countDivergentFindings', () => {
    it('is zero for an empty blob and an empty projection', () => {
        expect(countDivergentFindings({}, {})).toBe(0);
    });

    it('is zero when the document holds what the blob holds', () => {
        const blob = { a: { rating: 'D', notes: 'n' }, b: { notes: 'only notes' } };
        expect(countDivergentFindings(blob, blob as ResultsProjection)).toBe(0);
    });

    it('counts a blob finding the document lacks, or holds with neither rating nor notes', () => {
        const blob = { missing: { rating: 'D' }, emptied: { notes: 'text' }, kept: { rating: 'S' } };
        const doc: ResultsProjection = { emptied: {}, kept: { rating: 'S' } };
        expect(countDivergentFindings(blob, doc)).toBe(2);
    });

    it('does not count a blob entry with nothing to lose', () => {
        expect(countDivergentFindings({ a: {}, b: { rating: '', notes: '' }, c: { photos: [{ key: 'k' }] } }, {})).toBe(0);
    });

    it('skips meta keys, but not composite finding keys, which also start with an underscore', () => {
        expect(countDivergentFindings({ _inspector_signature: { rating: 'x', notes: 'y' } }, {})).toBe(0);
        expect(countDivergentFindings({ '_default:s1:roof': { rating: 'D' } }, {})).toBe(1);
        expect(countDivergentFindings({ '_default:s1:roof': { rating: 'D' } }, { '_default:s1:roof': { rating: 'D' } })).toBe(0);
    });

    it.each([[null], [undefined], ['text'], [42], [[{ rating: 'D' }]]])('treats a non-object blob (%j) as no divergence', (blob) => {
        expect(countDivergentFindings(blob, {})).toBe(0);
    });

    it('ignores entries that are not objects', () => {
        expect(countDivergentFindings({ a: 'D', b: null, c: 7 }, {})).toBe(0);
    });
});

describe('logDivergence', () => {
    const docWith = (projection: ResultsProjection) => {
        const doc = new Y.Doc();
        loadResultsProjection(doc, projection);
        return doc;
    };

    const NO_D1 = {} as D1Database;
    const target = { tenantId: 't1', inspectionId: 'insp-1', reportId: null };

    it('logs once, with the inspection id and a count only', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        await logDivergence(NO_D1, target, { roof: { rating: 'D', notes: 'secret text' }, attic: { notes: 'more' } }, docWith({}));
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('collab_d1_divergence', { inspectionId: 'insp-1', divergentFindings: 2 });
    });

    it('stays silent when they agree', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        await logDivergence(NO_D1, target, { roof: { rating: 'D' } }, docWith({ roof: { rating: 'D' } }));
        expect(warn).not.toHaveBeenCalled();
    });

    it('never throws, even when the logger does', async () => {
        vi.spyOn(logger, 'warn').mockImplementation(() => { throw new Error('sink down'); });
        await expect(logDivergence(NO_D1, target, { roof: { rating: 'D' } }, docWith({}))).resolves.toBeUndefined();
        await expect(logDivergence(NO_D1, target, { roof: { rating: 'D' } }, {} as Y.Doc)).resolves.toBeUndefined();
    });

    it('never throws when the report row cannot be read', async () => {
        const broken = { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database;
        await expect(logDivergence(broken, { ...target, reportId: 'rpt-1' }, { roof: { rating: 'D' } }, docWith({}))).resolves.toBeUndefined();
    });
});
