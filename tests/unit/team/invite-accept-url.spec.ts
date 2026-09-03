/**
 * One invitation, one URL.
 *
 * The accept link is produced in five places — the create response, the
 * invitation email, the resend, the roster's "Invite link" dialog and the
 * admin console — and each of them used to compose it by hand. That is the
 * shape the repository's own Comment Rules call out: a "must stay in sync"
 * coupling maintained by memory. It did not stay in sync.
 *
 * Two ways it came apart, both found rather than imagined:
 *
 *   1. a screen pasted `window.location.origin` in front of the token, so a
 *      deployment reached at any address other than its configured base handed
 *      out a link nobody could accept;
 *   2. the roster-import path resolved its base through a SECOND `getBaseUrl`
 *      (`lib/repair-gates.ts`) which hardcodes `https://` and returns the EMPTY
 *      STRING when there is no Host header — producing `/join?token=…`, a
 *      relative reference, inside an email.
 *
 * `inviteAcceptUrl` is now the only producer. These assertions are about the
 * two failures above, so the last one is the important one: whatever else is
 * true, the result has to be a URL that survives leaving the building.
 */
import { describe, it, expect } from 'vitest';
import type { Context } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import { inviteAcceptUrl } from '../../../server/lib/url';

const TOKEN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** The three things getBaseUrl reads, and nothing else. */
function ctx(opts: { appBaseUrl?: string; host?: string; url?: string }): Context<HonoConfig> {
    return {
        env: { APP_BASE_URL: opts.appBaseUrl },
        req: {
            url: opts.url ?? 'http://localhost:8787/api/team/members',
            header: (name: string) => (name === 'host' ? opts.host : undefined),
        },
    } as unknown as Context<HonoConfig>;
}

describe('inviteAcceptUrl', () => {
    it('uses the deployment base URL when one is configured', () => {
        expect(inviteAcceptUrl(ctx({ appBaseUrl: 'https://inspections.example.test' }), TOKEN))
            .toBe(`https://inspections.example.test/join?token=${TOKEN}`);
    });

    it('does not double the slash when the configured base carries one', () => {
        // A trailing slash in a deployment secret is not a misconfiguration
        // anyone would notice, and `//join` is a different path.
        expect(inviteAcceptUrl(ctx({ appBaseUrl: 'https://inspections.example.test/' }), TOKEN))
            .toBe(`https://inspections.example.test/join?token=${TOKEN}`);
    });

    it('keeps the request scheme when falling back to the Host header', () => {
        // The second getBaseUrl hardcodes https here. Over plain http that
        // yields a link to an origin the deployment does not answer on.
        expect(inviteAcceptUrl(ctx({ host: 'localhost:8787', url: 'http://localhost:8787/x' }), TOKEN))
            .toBe(`http://localhost:8787/join?token=${TOKEN}`);
    });

    it('is ABSOLUTE even with no base URL and no Host header', () => {
        // The failure that mattered: an empty base makes `/join?token=…`, which
        // reads as fine in code review and is unclickable in an inbox.
        const url = inviteAcceptUrl(ctx({}), TOKEN);
        expect(url.startsWith('/')).toBe(false);
        expect(() => new URL(url)).not.toThrow();
        expect(new URL(url).searchParams.get('token')).toBe(TOKEN);
    });

    it('CONTROL — the token is what comes back out of the query string', () => {
        // Guards the parse, not just the concatenation: a helper that dropped or
        // mangled the token would still produce a well-formed absolute URL.
        const url = inviteAcceptUrl(ctx({ appBaseUrl: 'https://x.test' }), TOKEN);
        expect(new URL(url).pathname).toBe('/join');
        expect(new URL(url).searchParams.get('token')).toBe(TOKEN);
    });
});
