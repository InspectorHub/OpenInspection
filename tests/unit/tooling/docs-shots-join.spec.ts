import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types alongside it (same as the
// other scripts/lib modules these tooling specs import).
import { extractMarkers, validateGuide, renderPublished, stripMarkers } from '../../../scripts/lib/docs-shots.mjs';

interface Marker {
    id: string;
    alt: string;
    error: string | null;
}

/**
 * The prose and the capture script are two files that must agree, and this is
 * the code that makes "must agree" mean something. Everything here is about a
 * disagreement being LOUD — a guide that publishes with a hole in it is worse
 * than one that fails to publish, because the hole is invisible once rendered.
 */
describe('markers', () => {
    it('are read in document order with their alt text', () => {
        const md = [
            'Intro.',
            '<!-- shot: open-inspections | The inspections list -->',
            'Then this.',
            '<!--shot:new-inspection|The New Inspection button-->',
        ].join('\n\n');
        const markers = extractMarkers(md) as Marker[];
        expect(markers.map((m) => m.id)).toEqual(['open-inspections', 'new-inspection']);
        expect(markers[0].alt).toBe('The inspections list');
        // Whitespace around the pipe is optional — an author should not have to
        // remember a spacing convention.
        expect(markers[1].alt).toBe('The New Inspection button');
        expect(markers.every((m) => m.error === null)).toBe(true);
    });

    it('report a missing alt rather than publishing an unlabelled image', () => {
        const [m] = extractMarkers('<!-- shot: pick-template -->') as Marker[];
        expect(m.error).toContain('no alt text');
        // The message has to carry the fix, because the author is mid-sentence
        // in a markdown file and not reading this source.
        expect(m.error).toContain('<!-- shot: pick-template |');
    });

    it('report a malformed id instead of silently dropping it', () => {
        // A dropped marker would come back as "capture with no marker", which
        // points the reader at the wrong file entirely.
        for (const bad of ['Pick Template', 'pick_template', '-leading', '']) {
            const [m] = extractMarkers(`<!-- shot: ${bad} | alt -->`) as Marker[];
            expect(m.error, bad).toBeTruthy();
        }
    });
});

describe('validateGuide', () => {
    const ok = (ids: string[]) => ids.map((id) => ({ id, alt: 'a', error: null }));

    it('passes when the two sides agree', () => {
        const r = validateGuide({ slug: 'g', markers: ok(['a', 'b']), shotIds: ['b', 'a'] });
        expect(r.problems).toEqual([]);
        expect(r.markerCount).toBe(2);
        expect(r.shotCount).toBe(2);
    });

    it('names a marker whose capture never happened', () => {
        const r = validateGuide({ slug: 'g', markers: ok(['a', 'b']), shotIds: ['a'] });
        expect(r.problems.join('\n')).toContain('marker with no capture: b');
    });

    it('names a capture that has nowhere to go', () => {
        const r = validateGuide({ slug: 'g', markers: ok(['a']), shotIds: ['a', 'stray'] });
        expect(r.problems.join('\n')).toContain('capture with no marker: stray');
    });

    it('reports BOTH directions in one run', () => {
        // One run should tell you the whole story. Reporting the first problem
        // only turns a five-minute fix into five runs.
        const r = validateGuide({ slug: 'g', markers: ok(['a', 'gone']), shotIds: ['a', 'stray'] });
        const text = r.problems.join('\n');
        expect(text).toContain('marker with no capture: gone');
        expect(text).toContain('capture with no marker: stray');
    });

    it('catches a duplicated marker', () => {
        const r = validateGuide({ slug: 'g', markers: ok(['a', 'a']), shotIds: ['a'] });
        expect(r.problems.join('\n')).toContain('duplicate marker "a"');
    });

    it('surfaces a malformed marker as a problem, not as a phantom orphan', () => {
        const markers = [{ id: 'a', alt: '', error: 'shot "a" has no alt text' }];
        const r = validateGuide({ slug: 'g', markers, shotIds: ['a'] });
        expect(r.problems.join('\n')).toContain('no alt text');
        // It must NOT also be counted as a capture nobody asked for.
        expect(r.problems.join('\n')).not.toContain('capture with no marker');
    });
});

describe('renderPublished', () => {
    it('swaps each marker for its image, keeping the alt text', () => {
        const md = 'Before.\n\n<!-- shot: a | The list -->\n\nAfter.';
        const out = renderPublished(md, { a: '/cms-media/docs/g/x.png' });
        expect(out).toBe('Before.\n\n![The list](/cms-media/docs/g/x.png)\n\nAfter.');
    });

    it('throws rather than publishing a guide with a hole in it', () => {
        // Once rendered, a dropped image is invisible — the page just reads as
        // if that step needed no picture.
        expect(() => renderPublished('<!-- shot: a | alt -->', {})).toThrow(/no uploaded image for shot "a"/);
    });
});

describe('stripMarkers', () => {
    it('leaves prose that reads normally', () => {
        const md = 'One.\n\n<!-- shot: a | alt -->\n\nTwo.';
        expect(stripMarkers(md)).toBe('One.\n\nTwo.');
    });
});
