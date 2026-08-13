/**
 * The edit marker — what "keep my edits" rests on.
 *
 * This module decides which of a tenant's canned-comment rows a marketplace
 * re-import is allowed to delete. Getting it wrong destroys work an inspector
 * did by hand, which is the defect that caused it to be written (#348). It
 * shipped with no tests at all; these are them.
 *
 * The module draws a line down the middle of itself, and these specs are
 * organised along it:
 *
 *   WHAT GETS DELETED is decided by hash equality alone — exact, per row,
 *   comparing a row's own text against its own recorded import hash. Every
 *   assertion about `preservedIds` / `edited` belongs to this half and is
 *   deterministic.
 *
 *   WHAT THE PAGE SHOWS beside a rewrite is a guess, because pack entries carry
 *   no stable ids. Assertions about `published` belong to that half. A wrong
 *   guess is a misleading screen; it can never cost a row. The specs keep that
 *   asymmetry visible rather than testing both as if they were the same promise.
 */
import { describe, it, expect } from 'vitest';
import {
    normalizeCommentText,
    hashCommentText,
    hashCommentTexts,
    buildReplacePlan,
    type PackEntry,
    type PriorRow,
    type PublishedSide,
    type EditPair,
    type ReplacePlan,
} from '../../../server/lib/library-edit-marker';

/** A prior row with the boring fields filled in. */
function row(over: Partial<PriorRow> & Pick<PriorRow, 'id' | 'text'>): PriorRow {
    return { section: null, importHash: null, editedAt: null, ...over };
}

const entry = (text: string, section?: string): PackEntry => ({ text, section });

/** Import a row: its recorded hash is the hash of the text it arrived with. */
async function imported(id: string, text: string, over: Partial<PriorRow> = {}): Promise<PriorRow> {
    return row({ id, text, importHash: await hashCommentText(text), ...over });
}

describe('normalizeCommentText', () => {
    it('collapses runs of whitespace and trims', () => {
        expect(normalizeCommentText('  the   roof \n\n covering  ')).toBe('the roof covering');
    });

    it('leaves a already-normal string alone', () => {
        expect(normalizeCommentText('the roof covering')).toBe('the roof covering');
    });
});

describe('hashCommentText', () => {
    it('is a 64-char sha-256 hex digest', async () => {
        expect(await hashCommentText('anything')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reads reflowed whitespace as the SAME text', async () => {
        // The reason normalization exists: an editor that rewraps a paragraph
        // has not rewritten it, and must not be treated as a conflict.
        const [a, b] = await hashCommentTexts([
            'Water staining was observed at the ceiling.',
            'Water   staining was observed\n at the ceiling.  ',
        ]);
        expect(a).toBe(b);
    });

    it('reads a changed word as different text', async () => {
        const [a, b] = await hashCommentTexts([
            'Water staining was observed at the ceiling.',
            'Water staining was observed at the wall.',
        ]);
        expect(a).not.toBe(b);
    });

    it('agrees with the plural form element by element', async () => {
        const texts = ['one', 'two', 'three'];
        const plural = await hashCommentTexts(texts);
        const singular = await Promise.all(texts.map(hashCommentText));
        expect(plural).toEqual(singular);
    });
});

describe('buildReplacePlan — what gets deleted (exact, hash-decided)', () => {
    it('leaves an untouched row unprotected: nothing to preserve', async () => {
        const original = 'Downspouts discharge against the foundation.';
        const plan = await buildReplacePlan(
            [await imported('c1', original)],
            [entry('Downspouts discharge against the foundation, causing erosion.')],
        );
        expect(plan.total).toBe(1);
        expect(plan.edited).toBe(0);
        expect(plan.preservedIds).toEqual([]);
        expect(plan.pairs).toEqual([]);
    });

    it('protects a row whose text no longer hashes to what we imported', async () => {
        const prior = await imported('c1', 'Downspouts discharge against the foundation.');
        const plan = await buildReplacePlan(
            [{ ...prior, text: 'Downspouts discharge directly against the foundation wall.' }],
            [entry('Downspouts discharge against the foundation, causing erosion.')],
        );
        expect(plan.edited).toBe(1);
        expect(plan.preservedIds).toEqual(['c1']);
    });

    it('does NOT protect a row edited and then changed back', async () => {
        // Stated in the module header as a design consequence, and it is the
        // clearest evidence that the marker is content and not a write flag:
        // `editedAt` is set, yet the row is not a conflict.
        const original = 'Downspouts discharge against the foundation.';
        const prior = await imported('c1', original, { editedAt: new Date(1_700_000_000_000) });
        const plan = await buildReplacePlan(
            [{ ...prior, text: `  ${original}  ` }],
            [entry('Downspouts discharge against the foundation, causing erosion.')],
        );
        expect(plan.edited).toBe(0);
        expect(plan.preservedIds).toEqual([]);
    });

    it('claims nothing about a row that predates the marker', async () => {
        // importHash === null. Not edited, not publisher-changed, no pair — the
        // planner has no recorded "before" and must not invent one.
        const plan = await buildReplacePlan(
            [row({ id: 'c1', text: 'Tenant-authored line.' })],
            [entry('Something else entirely.')],
        );
        expect(plan).toMatchObject({
            total: 1,
            edited: 0,
            publisherChanged: 0,
            preservedIds: [],
            pairs: [],
        });
    });

    it('counts a publisher change only when the imported text is gone from v2', async () => {
        const kept = await imported('c1', 'The water heater is past its service life.');
        const dropped = await imported('c2', 'The dishwasher drain lacks an air gap.');
        const plan = await buildReplacePlan(
            [kept, dropped],
            [entry('The water heater is past its service life.')],
        );
        expect(plan.publisherChanged).toBe(1);
    });

    it('is order-independent: the same data plans the same way', async () => {
        const a = await imported('c1', 'Alpha line about the roof covering.');
        const b = await imported('c2', 'Beta line about the plumbing supply.');
        const pack = [entry('Alpha line about the roof covering, replaced.')];
        const forward = await buildReplacePlan([a, b], pack);
        const reverse = await buildReplacePlan([b, a], pack);
        expect(forward).toEqual(reverse);
    });
});

describe('buildReplacePlan — what the page shows (a guess, and says so)', () => {
    it('shows the inspector their own "before" when v2 still ships it', async () => {
        const original = 'Water staining was observed at the ceiling.';
        const prior = await imported('c1', original);
        const plan = await buildReplacePlan(
            [{ ...prior, text: 'Active water staining at the ceiling, source not determined.' }],
            [entry('Unrelated line about the driveway surface.'), entry(original)],
        );
        const published: PublishedSide = plan.pairs[0]!.published;
        expect(published).toEqual({ kind: 'unchanged', text: original });
        // And that entry must not be re-inserted under their rewrite, or they
        // get handed back the exact sentence they replaced, as a second row.
        expect(plan.skipEntryIndexes).toEqual([1]);
    });

    it('pairs a rewrite with its plausible successor', async () => {
        const prior = await imported('c1', 'The roof covering is at the end of its service life.');
        const plan = await buildReplacePlan(
            [{ ...prior, text: 'The roof covering appears to be at the end of its service life.' }],
            [entry('The roof covering is beyond its expected service life and needs replacement.')],
        );
        expect(plan.pairs[0]!.published.kind).toBe('changed');
        expect(plan.pairs[0]!.published.text).toContain('beyond its expected service life');
    });

    it('says "removed" rather than inventing a pairing', async () => {
        const prior = await imported('c1', 'The roof covering is at the end of its service life.');
        const plan = await buildReplacePlan(
            [{ ...prior, text: 'The roof covering is well past its service life.' }],
            [entry('The garage door opener lacks a functioning photo-eye sensor.')],
        );
        expect(plan.pairs[0]!.published).toEqual({ kind: 'removed', text: null });
    });

    it('never offers a row its own "before" as the publisher\'s new version', async () => {
        // An entry that IS some row's imported text is the before, not a
        // successor. Without the claim set, c2's rewrite could be paired with
        // c1's original and shown as "the publisher now says ...".
        const c1 = await imported('c1', 'The roof covering is at the end of its service life.');
        const c2 = await imported('c2', 'The roof covering is at the end of its useful life.');
        const plan = await buildReplacePlan(
            [c1, { ...c2, text: 'The roof covering is well past the end of its useful life.' }],
            [entry(c1.text)],
        );
        const pair = plan.pairs.find((p: EditPair) => p.commentId === 'c2')!;
        expect(pair.published.text).not.toBe(c1.text);
    });

    it('does not pair two lines that merely share a few common words', async () => {
        // similarity() returns 0 below three shared content words: in a library
        // about one building, two words in common is coincidence.
        const prior = await imported('c1', 'The attic insulation is thin.');
        const plan = await buildReplacePlan(
            [{ ...prior, text: 'The attic insulation is thin and uneven.' }],
            [entry('The attic hatch is not weatherstripped.')],
        );
        expect(plan.pairs[0]!.published.kind).toBe('removed');
    });

    it('reports editedAt in epoch milliseconds from either stored form', async () => {
        const at = 1_700_000_000_000;
        const base = await imported('c1', 'Original text about the foundation.');
        const rewritten = 'Rewritten text about the foundation wall.';
        const fromDate = await buildReplacePlan(
            [{ ...base, text: rewritten, editedAt: new Date(at) }], [entry('x')],
        );
        const fromNumber = await buildReplacePlan(
            [{ ...base, text: rewritten, editedAt: at }], [entry('x')],
        );
        expect(fromDate.pairs[0]!.editedAt).toBe(at);
        expect(fromNumber.pairs[0]!.editedAt).toBe(at);
    });

    it('reports a null editedAt for a row edited before the column existed', async () => {
        const base = await imported('c1', 'Original text about the foundation.');
        const plan: ReplacePlan = await buildReplacePlan(
            [{ ...base, text: 'Rewritten text about the foundation wall.', editedAt: null }],
            [entry('x')],
        );
        expect(plan.pairs[0]!.editedAt).toBeNull();
    });
});
