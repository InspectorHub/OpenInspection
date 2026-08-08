/**
 * Proof that the Price Capability Inventory gate
 * (`scripts/check-price-capability.mjs`) bites.
 *
 * The product decision it enforces: the platform stores what an inspection
 * OBSERVES — category, severity, description — and never produces a repair
 * cost, a market value, or a negotiation amount. Money on an inspection is
 * written by the buyer or their agent.
 *
 * A gate is only worth its runtime if somebody has watched it go red on the
 * thing it exists to stop, and the sharpest available material is the pair of
 * columns that were deleted when this rule was adopted: `estimateMinCents` /
 * `estimateMaxCents`, a repair estimate on a canned comment that reached the
 * report as the inspection company's own figure. The fixture puts them back;
 * this spec asserts the gate says so.
 *
 * It runs the gate as a child process rather than importing it, because the
 * exit code IS the contract — a gate that prints complaints and exits 0 is the
 * failure mode this whole family of checks was written after.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GATE = path.join(ROOT, 'scripts', 'check-price-capability.mjs');
const FIXTURE = 'scripts/fixtures/price-capability-probe';

function runGate(...args: string[]) {
    const res = spawnSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

describe('price-capability gate', () => {
    it('passes on the real source tree', () => {
        const { status, output } = runGate();
        expect(output).toContain('price-capability: OK');
        expect(status).toBe(0);
    });

    it('reports a non-empty inventory on the real tree', () => {
        // A gate that scanned nothing would also print OK. Pin the surfaces to
        // "found something" so an empty scan cannot pass as a clean one.
        const { output } = runGate();
        expect(output).toMatch(/[1-9]\d* money columns of [1-9]\d* tables/);
        expect(output).toMatch(/[1-9]\d* money fields across [1-9]\d* inspection shapes/);
        expect(output).toMatch(/[1-9]\d* money-input sites/);
    });

    describe('against the probe fixture', () => {
        const { status, output } = runGate('--fixture', FIXTURE);

        it('fails', () => {
            expect(status).toBe(1);
        });

        it('names the retired repair-estimate identifiers coming back', () => {
            expect(output).toContain("RETIRED identifier 'estimateMinCents' is back in the source");
            expect(output).toContain("RETIRED identifier 'estimateMaxCents' is back in the source");
        });

        it('names a new money column on a finding-shaped table', () => {
            expect(output).toContain("UNLISTED money-shaped schema column: 'probe_findings.repair_estimate_cents'");
        });

        it('names a new money field inside the persisted inspection shape', () => {
            expect(output).toContain('probe-inspection-shape.ts#repairCostCents');
        });

        it('names a new money-entry control, which no naming rule would catch', () => {
            expect(output).toContain('UNLISTED money-entry control render site');
        });

        it('leaves the negative controls alone', () => {
            // If the gate flagged these too it would be failing on everything it
            // reads, and the five assertions above would mean nothing.
            //
            // Match on the VIOLATION LINES only, not the whole transcript: the
            // gate's own closing paragraph says the words "category, severity,
            // description", and a naive substring search over stdout reports a
            // negative control as flagged because the gate quoted the rule.
            const violations = output
                .split('\n')
                .filter((l) => /^\s+(UNLISTED|RETIRED|STALE)\b/.test(l));
            expect(violations.length).toBeGreaterThan(0);
            for (const clean of ['severity', 'description', 'notes', 'photo_count', 'photoCount',
                                 'is_deposit_overridden', 'isDepositOverridden', 'priced_at', 'pricedAt']) {
                expect(violations.join('\n')).not.toContain(clean);
            }
        });
    });

    it('fails on an inventory entry that matches nothing', () => {
        // The other direction. Without it the inventory decays into a blanket
        // permit: entries outlive the things they describe, and the next field
        // to land on one of those names is pre-approved by a line nobody meant
        // to leave behind.
        const { status, output } = runGate('--stale-probe');
        expect(status).toBe(1);
        expect(output).toContain("STALE inventory entry: column '__probe_table.__probe_cents'");
    });
});
