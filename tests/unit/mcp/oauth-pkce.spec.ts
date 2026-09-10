/**
 * The MCP authorization server offers S256 and nothing else.
 *
 * PKCE exists so that a stolen authorization code cannot be redeemed. The
 * `plain` method returns it to being redeemable: the token endpoint compares the
 * verifier to the stored challenge verbatim, and the challenge travelled in the
 * same redirect URL as the code — so whoever intercepted one holds the other.
 * Advertising `plain` is therefore worse than offering no PKCE at all, because a
 * client that negotiates down believes it is protected.
 *
 * ⚠️ WHY THIS TEST READS THE LIBRARY AND NOT JUST OUR OPTIONS OBJECT.
 * The authorization server here is not our code: it is
 * `@cloudflare/workers-oauth-provider`, and the default for `allowPlainPKCE` is
 * TRUE. So the defect was an omission, and a test that only asserted "we pass
 * allowPlainPKCE: false" would pass just as happily if the library renamed the
 * option — the deployment would be back to advertising `plain` with a green
 * suite. These assertions are pinned to the two library behaviours the option
 * controls, read out of the installed package, so a rename or a default change
 * turns them red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROVIDER_SRC = readFileSync(
    join(__dirname, '../../../server/lib/mcp/oauth-provider.ts'),
    'utf8',
);

const LIBRARY_SRC = readFileSync(
    join(__dirname, '../../../node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js'),
    'utf8',
);

describe('MCP OAuth offers S256 only', () => {
    it('passes allowPlainPKCE: false at the construction site', () => {
        // The construction site is the only place this can be set — the option
        // has no env override and no runtime toggle.
        expect(PROVIDER_SRC).toMatch(/allowPlainPKCE:\s*false/);
    });

    it('the library still gates its advertisement on that exact option name', () => {
        // `code_challenge_methods_supported: this.options.allowPlainPKCE !== false
        //     ? ["plain", "S256"] : ["S256"]`
        //
        // Two things are pinned: the option name, and the `!== false` test that
        // makes an UNSET option mean "plain is allowed". If either moves, the
        // line above stops narrowing the advertisement and this goes red.
        expect(LIBRARY_SRC).toMatch(
            /code_challenge_methods_supported:\s*this\.options\.allowPlainPKCE\s*!==\s*false/,
        );
    });

    it('the library still REFUSES plain when the option is false, rather than only hiding it', () => {
        // Narrowing the metadata document is not enough on its own: a client
        // that ignores the document and sends `plain` anyway, or omits the
        // method entirely, must be refused rather than served. This is the throw
        // that does it.
        expect(LIBRARY_SRC).toMatch(
            /codeChallengeMethod === "plain" && this\.provider\.options\.allowPlainPKCE === false/,
        );
    });

    it('an omitted code_challenge_method still defaults to plain in the library', () => {
        // The reason the refusal above matters more than it looks. A request
        // that says nothing about its method is READ as plain, so "we only
        // advertise S256" would not have protected a client that simply left the
        // parameter out. If the library ever changes this default to S256, this
        // test goes red and the comment at the construction site needs revising
        // rather than the option.
        expect(LIBRARY_SRC).toMatch(
            /get\("code_challenge_method"\)\s*\|\|\s*"plain"/,
        );
    });

    it('the outbound calendar client, which is a different PKCE actor, is unaffected', () => {
        // Positive control. This repository is BOTH an authorization server
        // (here) and an OAuth client (Google Calendar), and the client side has
        // always sent S256. Without this assertion, a broken reader that matched
        // nothing anywhere would satisfy every negative check above.
        const calendar = readFileSync(
            join(__dirname, '../../../server/lib/calendar/google.ts'),
            'utf8',
        );
        expect(calendar).toMatch(/code_challenge_method:\s*'S256'/);
    });
});
