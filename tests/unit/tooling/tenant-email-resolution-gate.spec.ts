/**
 * Unit tests for the tenant email resolution gate
 * (`scripts/check-tenant-email-resolution.mjs`).
 *
 * The gate allows `services.email` — the service DI built for the tenant it
 * already knew — only in allow-listed files whose tenant is resolved before the
 * DI middleware. These pin both directions over literal fixtures: a violation
 * is found, a clean file is clean, an allow-listed use is counted as exempt
 * (not as nothing), and an allow-list entry that no longer matches is stale.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Use { line: number; snippet: string }
interface Verdict { matches: number; exempt: number; violations: Array<Use & { file: string }>; stale: string[] }

let findServicesEmailUses: (source: string) => Use[];
let evaluate: (usesByFile: Map<string, Use[]>, allowlist: Record<string, string>) => Verdict;

beforeAll(async () => {
    const scriptPath = path.resolve(HERE, '../../../scripts/check-tenant-email-resolution.mjs');
    ({ findServicesEmailUses, evaluate } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

const VIOLATING = `
export async function confirm(c) {
    const svc = c.var.services.email;
    await c.var.services.email.sendBookingConfirmation(to);
    const { email } = c.var.services;
    const other = c.get('services').email;
}`;

const CLEAN = `
// services.email is not used here; the comment must not count.
/* nor here: c.var.services.email */
export async function confirm(c, tenantId) {
    const email = await c.var.services.emailFor(tenantId);
    await c.var.services.platformEmail().sendAgentLoginLink(to, url);
    await email.sendBookingConfirmation(to);
    const user = { email: 'a@b.test' };
}`;

describe('findServicesEmailUses', () => {
    it('finds every shape of reading the DI-built service', () => {
        const uses = findServicesEmailUses(VIOLATING);
        expect(uses.map((u) => u.line)).toEqual([3, 4, 5, 6]);
    });

    it('finds nothing in a file that uses emailFor / platformEmail, or only mentions the API in comments', () => {
        expect(findServicesEmailUses(CLEAN)).toEqual([]);
    });
});

describe('evaluate', () => {
    it('FAILS: a use outside the allow-list is a violation, and is counted as a match', () => {
        const verdict = evaluate(new Map([['server/api/public-thing.ts', findServicesEmailUses(VIOLATING)]]), {});
        expect(verdict.matches).toBe(4);
        expect(verdict.exempt).toBe(0);
        expect(verdict.violations.map((v) => `${v.file}:${v.line}`)).toEqual([
            'server/api/public-thing.ts:3', 'server/api/public-thing.ts:4',
            'server/api/public-thing.ts:5', 'server/api/public-thing.ts:6',
        ]);
    });

    it('PASSES: a clean tree has zero matches, zero violations — reported as numbers', () => {
        const verdict = evaluate(new Map(), {});
        expect(verdict).toEqual({ matches: 0, exempt: 0, violations: [], stale: [] });
    });

    it('an allow-listed file is EXEMPT, and its uses are still counted', () => {
        const verdict = evaluate(
            new Map([['server/api/team.ts', findServicesEmailUses(VIOLATING)]]),
            { 'server/api/team.ts': 'tenant JWT' },
        );
        expect(verdict).toMatchObject({ matches: 4, exempt: 4, violations: [], stale: [] });
    });

    it('an allow-list entry whose file no longer uses services.email is reported as stale', () => {
        const verdict = evaluate(
            new Map([['server/api/team.ts', findServicesEmailUses(VIOLATING)]]),
            { 'server/api/team.ts': 'tenant JWT', 'server/api/migrated.ts': 'was tenant JWT' },
        );
        expect(verdict.stale).toEqual(['server/api/migrated.ts']);
        expect(verdict.violations).toEqual([]);
    });
});
