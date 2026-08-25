/**
 * The one place a configured base URL becomes a recordable destination.
 *
 * The stakes are why this is its own module with its own spec: the value it
 * returns is written to `ai_call_provenance.endpoint`, which is read back by
 * the assurance export. A workspace's base URL is validated only loosely at the
 * save endpoint, and a URL may legally carry `user:password@` — so anything
 * that reached the column verbatim could put a credential into a compliance
 * record that is designed to be handed out.
 *
 * Stripping is STRUCTURAL, not textual: `URL.origin` and `URL.pathname` simply
 * do not include userinfo, query or fragment. There is no regex here to get
 * wrong, and that is the point.
 */
import { describe, it, expect } from 'vitest';
import { normaliseEndpoint } from '../../../server/lib/ai/endpoint';

describe('normaliseEndpoint', () => {
    it('drops credentials, query and fragment, keeping scheme host port path', () => {
        expect(normaliseEndpoint('https://u:sk-secret@ai.corp.internal:8000/v1/proj-42?k=1#frag'))
            .toBe('https://ai.corp.internal:8000/v1/proj-42');
    });

    it('keeps the path, because some backends encode a processing region in it', () => {
        expect(normaliseEndpoint('https://eu-west1-aiplatform.example/v1/projects/p/locations/eu'))
            .toBe('https://eu-west1-aiplatform.example/v1/projects/p/locations/eu');
    });

    it('normalises a trailing slash so one endpoint records one way', () => {
        // `chatCompletionsUrl` already strips trailing slashes before calling.
        // Recording `https://h/v1` and `https://h/v1/` as two values would split
        // one destination into two in any grouping over this column.
        expect(normaliseEndpoint('https://h/v1/')).toBe(normaliseEndpoint('https://h/v1'));
        expect(normaliseEndpoint('https://h/v1/')).toBe('https://h/v1');
    });

    it('records a bare origin without a stray slash', () => {
        expect(normaliseEndpoint('https://h')).toBe('https://h');
    });

    it('answers "unparseable" rather than throwing or storing the raw string', () => {
        // The save endpoint's validation is being tightened in this same
        // release, but STORED values predate it and this column is written from
        // what is in the database. A parse failure must not become either an
        // exception on the AI path or a verbatim copy of an unvalidated string.
        expect(normaliseEndpoint('not a url')).toBe('unparseable');
        expect(normaliseEndpoint('')).toBe('unparseable');
    });
});
