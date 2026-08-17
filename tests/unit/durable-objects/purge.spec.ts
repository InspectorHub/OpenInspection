/**
 * The purge verb's path matcher.
 *
 * A pure-function test, deliberately narrow: it asserts the SHAPE of the match
 * and nothing about whether either Durable Object honours it. That second
 * question needs the real runtime and is answered in
 * `tests/workers/do-purge.spec.ts`, which empties an object that actually has
 * something in it. A matcher test alone would pass against two classes that
 * never call it.
 */
import { describe, it, expect } from 'vitest';
import { purgePathMatches } from '../../../server/durable-objects/purge-path';

describe('DO purge routing', () => {
    it('matches the purge suffix and nothing adjacent', () => {
        expect(purgePathMatches('/purge')).toBe(true);
        expect(purgePathMatches('/some/prefix/purge')).toBe(true);
        expect(purgePathMatches('/purged')).toBe(false);
        expect(purgePathMatches('/purge/all')).toBe(false);
        expect(purgePathMatches('/snapshots')).toBe(false);
    });

    it('does not match a path that merely contains the word', () => {
        // The two live route families this sits beside end in `/ws`,
        // `/snapshots` and `/restore`. A destructive verb reached by accident
        // from any of them is unrecoverable, so the match is anchored rather
        // than forgiving.
        expect(purgePathMatches('/purge/ws')).toBe(false);
        expect(purgePathMatches('/repurge')).toBe(false);
        expect(purgePathMatches('/purge?force=1')).toBe(false);
        expect(purgePathMatches('')).toBe(false);
    });
});
