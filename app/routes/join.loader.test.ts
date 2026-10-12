// The accept URL the server emails is `/join?token=`. A link in the path-segment
// form `/join/<token>` has to land on the same page rather than on a "missing
// token" screen, because that form is the one the route table used to declare.
import { describe, it, expect } from 'vitest';
import { loader } from '~/routes/join';
import { createLoadContext } from '~/lib/load-context';

type LoaderArgs = Parameters<typeof loader>[0];

function args(path: string): LoaderArgs {
    return {
        request: { url: `http://app.example.com${path}` },
        context: createLoadContext({}),
        params: {},
    } as unknown as LoaderArgs;
}

describe('join loader - legacy path-segment links', () => {
    it('redirects /join/<token> to the canonical query form', async () => {
        const res = (await loader(args('/join/abc-123'))) as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toBe('/join?token=abc-123');
    });

    it('tolerates a trailing slash and re-encodes the token for the query', async () => {
        const res = (await loader(args('/join/a%2Fb/'))) as Response;
        expect(res.headers.get('Location')).toBe('/join?token=a%2Fb');
    });

    it('CONTROL - the canonical form is not redirected', async () => {
        const res = await loader(args('/join'));
        expect(res).not.toBeInstanceOf(Response);
        expect(res).toMatchObject({ valid: false, token: '' });
    });
});
