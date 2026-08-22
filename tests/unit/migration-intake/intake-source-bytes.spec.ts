/**
 * The size gate measures the file, and picks its cap by what the file is.
 *
 * The defect this guards: the gate used to measure a UTF-8 re-encoding of a
 * decoded upload. Every byte that did not survive the decode became a
 * three-byte replacement character, so a legitimate binary export was inflated
 * and could be refused as oversized — with a message telling the operator to
 * split a file that was never too large.
 */
import { describe, it, expect } from 'vitest';
import { assertSourceSizeWithin, type IntakeLimits } from '../../../server/lib/migration-intake/limits';
import {
    intakeSourceFromBytes,
    intakeSourceFromText,
    matchAdapter,
} from '../../../server/lib/migration-intake/adapters/registry';

const LIMITS: IntakeLimits = {
    maxCsvBytes: 5_000_000,
    maxVendorExportBytes: 20_000_000,
    maxRows: 10_000,
};

describe('assertSourceSizeWithin', () => {
    it('accepts an 8 MB binary against the vendor-export cap', () => {
        expect(() => assertSourceSizeWithin(LIMITS, 'bin', 8_000_000)).not.toThrow();
    });

    it('refuses a binary over the vendor-export cap, naming both numbers', () => {
        expect(() => assertSourceSizeWithin(LIMITS, 'bin', 21_000_000))
            .toThrowError(/21 MB.*20 MB/);
    });

    it('holds a CSV to the CSV cap, which is lower', () => {
        expect(() => assertSourceSizeWithin(LIMITS, 'csv', 6_000_000)).toThrow();
        expect(() => assertSourceSizeWithin(LIMITS, 'json', 6_000_000)).not.toThrow();
    });
});

describe('IntakeSource', () => {
    it('keeps the bytes it was built from, byte for byte', () => {
        const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]);
        const src = intakeSourceFromBytes('AHIT Master.tpz', bytes);
        expect(Array.from(src.bytes)).toEqual(Array.from(bytes));
    });

    it('decodes to text only when asked', () => {
        const src = intakeSourceFromText('people.csv', 'Name,Email\nZoe,zoe@example.test');
        expect(src.text()).toBe('Name,Email\nZoe,zoe@example.test');
        expect(new TextDecoder().decode(src.bytes)).toBe('Name,Email\nZoe,zoe@example.test');
    });

    it('a binary source still reaches the adapters without being altered', () => {
        const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe]);
        const src = intakeSourceFromBytes('AHIT Master.tpz', bytes);
        // Nothing reads .tpz yet, so this must be null rather than a match.
        // What matters here is that reaching that answer left the bytes alone.
        expect(matchAdapter('templates.create', 'spectora', src)).toBeNull();
        expect(Array.from(src.bytes)).toEqual(Array.from(bytes));
    });
});
