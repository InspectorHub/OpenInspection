import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * QuickBooks v3 has no PUT.
 *
 * An update is a POST to the same entity path carrying `Id` and `SyncToken`.
 * A PUT is answered with a 400 whose detail reads
 * `"No resource method found for PUT"` — measured against the sandbox on
 * 2026-08-16, which is the only way it could have been measured.
 *
 * Every update path used PUT, so none of them had ever worked. Only creates
 * did. The mocked suites could not see it: they assert what `apiCall` was
 * asked to do, and `apiCall` was asked to do the wrong thing consistently, so
 * every expectation agreed with every implementation.
 *
 * Worse, the failure was invisible in the product too. A 400 is exactly what a
 * stale SyncToken returns, so it entered the refetch-and-retry branch, ran out
 * of attempts, and — before the retry-exhaustion fix — fell through to writing
 * `qbo_sync_status: 'synced'`. Every invoice update reported success while
 * QuickBooks received nothing. Making that failure visible is what surfaced
 * this.
 *
 * This test is a source-level guard, and it is honest about being one: it
 * cannot verify the verb against Intuit. What it can do is make the verb a
 * decision someone has to defend rather than one they can reintroduce by
 * habit. The type on `apiCall` no longer admits 'PUT' either.
 */
const QBO_DIR = join(process.cwd(), 'server', 'services', 'qbo');

function qboSources(): Array<{ file: string; text: string }> {
    return readdirSync(QBO_DIR)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => ({ file: f, text: readFileSync(join(QBO_DIR, f), 'utf8') }));
}

describe('the QuickBooks integration never sends a PUT', () => {
    it('has no PUT in any QBO service', () => {
        const sources = qboSources();

        // Both numbers. A scan that found no files would otherwise pass for the
        // rest of time precisely because it had stopped working.
        expect(sources.length).toBeGreaterThan(5);

        const offenders = sources
            .filter(({ text }) => /['"]PUT['"]/.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')))
            .map(({ file }) => file);

        expect(offenders).toEqual([]);
    });

    it('still sends POST on the update paths, which is the positive control', () => {
        // Without this, deleting every call would satisfy the assertion above.
        const byName = Object.fromEntries(qboSources().map((s) => [s.file, s.text]));

        expect(byName['customer-sync.ts']).toContain("'POST', 'customer'");
        expect(byName['invoice-sync.ts']).toContain("'POST', 'invoice'");
    });
});
