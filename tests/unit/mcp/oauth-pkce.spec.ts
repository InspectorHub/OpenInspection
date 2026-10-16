/**
 * The MCP authorization server offers S256 and nothing else.
 *
 * PKCE exists so that a stolen authorization code cannot be redeemed. The
 * `plain` method returns it to being redeemable: the challenge travels in the
 * same redirect URL as the code, so whoever intercepted one holds the other.
 *
 * In 0.x this was an option that defaulted to the weak setting and had to be
 * switched off. In 1.x the weak method (and the implicit grant) were removed
 * from the library, and constructing a provider with either option set throws.
 * What is left to hold here is the absence of those options in our own
 * construction site, so that nobody re-adds one and discovers it only at
 * construction time in a deployment; the behavioural half (the advertised
 * methods, a refused `plain`) runs against the real provider in
 * tests/workers/mcp/provider-1x.spec.ts.
 *
 * The assertions read the installed library as well as our options object: a
 * test that only checked "we do not pass the option" would stay green if the
 * library silently changed what an omitted option means.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROVIDER_SRC = readFileSync(join(__dirname, '../../../server/lib/mcp/oauth-provider.ts'), 'utf8');
const LIBRARY_SRC = readFileSync(
    join(__dirname, '../../../node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js'),
    'utf8',
);

describe('MCP OAuth offers S256 only', () => {
    it('our construction site sets neither of the options the library removed', () => {
        // Code lines only: the explanatory comments legitimately name them.
        const code = PROVIDER_SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        expect(code).not.toMatch(/allowPlainPKCE/);
        expect(code).not.toMatch(/allowImplicitFlow/);
    });

    it('the library refuses to construct with either removed option set', () => {
        expect(LIBRARY_SRC).toMatch(/if \(this\.options\.allowPlainPKCE\) throw new TypeError\("allowPlainPKCE has been removed/);
        expect(LIBRARY_SRC).toMatch(/if \(this\.options\.allowImplicitFlow\) throw new TypeError\("allowImplicitFlow has been removed/);
    });

    it('the library advertises its fixed method list rather than an option-driven one', () => {
        expect(LIBRARY_SRC).toMatch(/code_challenge_methods_supported:\s*this\.serverCapabilities\.codeChallengeMethods/);
        expect(LIBRARY_SRC).not.toMatch(/code_challenge_methods_supported:\s*this\.options\.allowPlainPKCE/);
    });

    it('the outbound calendar client, which is a different PKCE actor, is unaffected', () => {
        // Positive control. This repository is BOTH an authorization server (here)
        // and an OAuth client (Google Calendar), and the client side has always
        // sent S256. Without this assertion, a reader that matched nothing anywhere
        // would satisfy every negative check above.
        const calendar = readFileSync(join(__dirname, '../../../server/lib/calendar/google.ts'), 'utf8');
        expect(calendar).toMatch(/code_challenge_method:\s*'S256'/);
    });
});
