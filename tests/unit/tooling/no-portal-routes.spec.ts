import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types alongside it (same as the
// other scripts/lib modules these tooling specs import).
import { scanText, PORTAL_PREFIXES } from '../../../scripts/lib/no-portal-routes.mjs';

interface Hit {
    kind: string;
    line: number;
    path: string;
}

/**
 * This gate reads prose, so its whole risk is over-matching. Every negative
 * assertion below is paired with a positive control: a checker that flags
 * nothing passes "allows ordinary prose", and a checker that flags everything
 * passes "flags a bare portal path". Only both together say it works.
 */
describe('portal route literals in engine docs', () => {
    it('flags a bare portal path', () => {
        expect((scanText('Go to /company/acme/team to invite.') as Hit[]).map((h) => h.kind)).toContain('portal-route');
    });

    it('allows the same path inside an https link — the sanctioned way to refer to it', () => {
        expect(scanText('See [Managing seats](https://inspectorhub.io/company/acme/team).')).toEqual([]);
    });

    it('allows ordinary prose — the positive control', () => {
        expect(scanText('Open Settings and choose Integrations.')).toEqual([]);
    });

    it('allows a bare autolink, which is the same claim in a different spelling', () => {
        expect(scanText('The guide is at <https://inspectorhub.io/docs>.')).toEqual([]);
    });

    it('does NOT flag routes this app really has — it would be wrong about its own repository', () => {
        // Each of these is in app/routes.ts. A gate that condemns them is a gate
        // somebody switches off, taking the real check with it.
        const ours = '/login, /logout, /team, /verify, /join/abc, /settings/billing, /settings/usage, /portal/acme, /invoices';
        expect(scanText(ours)).toEqual([]);
    });

    it('does not match a portal name buried inside a longer word or path segment', () => {
        expect(scanText('The /docsomething path and api/companyName field are ours.')).toEqual([]);
    });

    it('reports the line, so the author is not sent hunting through a long page', () => {
        const hits = scanText('# Title\n\nProse.\n\nOpen /pricing to compare.\n') as Hit[];
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(5);
    });

    it('honours a line-scoped exemption that carries a reason', () => {
        expect(scanText('We deliberately do not document /company/:slug/team. <!-- no-portal-routes-allow: negative statement -->')).toEqual([]);
    });

    it('ignores an exemption with no reason — an unexplained exemption is an oversight', () => {
        expect((scanText('Go to /pricing. <!-- no-portal-routes-allow: -->') as Hit[]).length).toBe(1);
    });

    it('honours a file-scoped exemption that carries a reason', () => {
        expect(scanText('<!-- no-portal-routes-allow-file: this page IS about the hosted service -->\n\nSee /pricing and /console.')).toEqual([]);
    });

    // A base held in an env var is the SAME claim as a literal host: the URL is
    // absolute, it just is not knowable at authoring time. Flagging it would
    // make the only correct way to write the sentence require an exemption
    // comment, and a gate that demands exemptions for correct lines teaches
    // people to reach for the exemption.
    it('allows a path hung off an interpolated base — that is the absolute form', () => {
        expect(scanText('Points at `${PORTAL_API_URL}/company/switch`, the only way to swap tenants.')).toEqual([]);
    });

    it('still flags the bare path in the same sentence shape — the positive control for the line above', () => {
        expect((scanText('Points at `/company/switch`, the only way to swap tenants.') as Hit[]).length).toBe(1);
    });

    it('has prefixes at all — an empty list would pass every negative test here', () => {
        expect(PORTAL_PREFIXES.length).toBeGreaterThan(0);
    });

    it('finds a hit for every prefix it declares, so a typo in the list cannot hide', () => {
        const missed = (PORTAL_PREFIXES as string[]).filter((p) => scanText(`Open /${p} now.`).length === 0);
        expect(missed, `these prefixes match nothing: ${missed.join(', ')}`).toEqual([]);
    });
});
