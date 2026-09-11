import { describe, it, expect } from 'vitest';
import { parseLibraryDescription } from '../../../server/services/marketplace/library-pack';
import { MARKETPLACE_LIBRARIES } from '../../../server/services/starter-content/fixtures/marketplace';

/**
 * F39, server half — the pack's own description has to survive the blob being
 * dropped.
 *
 * `browseCatalogue` strips `schema` from every row (~50KB each, no client reads
 * it) and nothing lifted the description out of it first, so the browse response
 * had no `description` at all while the card had a render branch for one. The
 * lift happens where the blob is already parsed for the item count.
 *
 * ⚠️ ASSERTED AGAINST THE SHIPPED FIXTURE, not against a string written here.
 * A spec that fed its own `{ description: 'x' }` object would be self-consistent
 * and would not notice the day the seeder stops writing one — the fixture is the
 * authority for what a catalogue entry actually carries.
 */
describe('parseLibraryDescription', () => {
    it('finds a description on the starter pack the seeder actually ships', () => {
        const starter = MARKETPLACE_LIBRARIES.find((l) => l.name === 'Starter Comment Pack');
        expect(starter).toBeDefined();
        const description = parseLibraryDescription(starter?.schema);
        expect(description).not.toBeNull();
        // The fixture composes it from the comment corpus, so assert the shape it
        // promises rather than a copy of the sentence.
        expect(description).toMatch(/pre-written inspection comments/);
    });

    it('reads a blob that arrives as a JSON STRING as well as a parsed object', () => {
        // Drizzle json mode and the raw driver path disagree about which one
        // arrives; a reader that handled only one would report "no description"
        // for half the deployments, the same defect the item counter documents.
        const packed = JSON.stringify({ description: 'Ninety-six statutory questions.' });
        expect(parseLibraryDescription(packed)).toBe('Ninety-six statutory questions.');
    });

    it('returns null — never an empty string — for a pack with nothing to say', () => {
        expect(parseLibraryDescription({ comments: [] })).toBeNull();
        expect(parseLibraryDescription({ description: '   ' })).toBeNull();
        expect(parseLibraryDescription('not json')).toBeNull();
        expect(parseLibraryDescription(null)).toBeNull();
    });
});
