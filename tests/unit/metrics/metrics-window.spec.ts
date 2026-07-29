/**
 * The `?from=&to=` window both metrics endpoints take.
 *
 * These endpoints are public API and MCP tools, so they cannot assume the
 * frontend normalised anything. The rules mirror `app/lib/metrics-range.ts`:
 * resolve rather than reject, and cap the span — the findings endpoint reads
 * every result envelope inside the window.
 */
import { describe, it, expect } from 'vitest';
import { inclusiveUpperBound, resolveMetricsWindow } from '../../../server/lib/metrics-window';

const NOW = new Date('2026-07-29T10:00:00Z');

describe('resolveMetricsWindow', () => {
    it('defaults to the trailing three months when neither bound is given', () => {
        expect(resolveMetricsWindow({}, NOW)).toEqual({ from: '2026-04-29', to: '2026-07-29' });
    });

    it('passes a well-formed window through', () => {
        expect(resolveMetricsWindow({ from: '2026-01-01', to: '2026-03-31' }, NOW))
            .toEqual({ from: '2026-01-01', to: '2026-03-31' });
    });

    it('swaps a reversed pair instead of returning nothing', () => {
        expect(resolveMetricsWindow({ from: '2026-06-01', to: '2026-01-01' }, NOW))
            .toEqual({ from: '2026-01-01', to: '2026-06-01' });
    });

    it('ignores a malformed bound rather than erroring on a hand-built request', () => {
        // Malformed `from` falls back to the default (three months before now =
        // 2026-04-29), which lands AFTER the supplied `to` — and the reversed
        // pair then swaps, same as any other reversed input.
        expect(resolveMetricsWindow({ from: 'yesterday', to: '2026-03-31' }, NOW))
            .toEqual({ from: '2026-03-31', to: '2026-04-29' });
    });

    it('rejects an impossible civil date that Date.UTC would silently roll over', () => {
        // 2026-02-30 becomes March 2 if handed straight to Date.UTC.
        const out = resolveMetricsWindow({ from: '2026-02-30', to: '2026-07-29' }, NOW);
        expect(out.from).toBe('2026-04-29');
    });

    it('caps an unbounded span — the findings read is linear in the window', () => {
        const out = resolveMetricsWindow({ from: '1990-01-01', to: '2026-07-29' }, NOW);
        expect(out.to).toBe('2026-07-29');
        expect(out.from > '2021-01-01' && out.from < '2022-01-01').toBe(true);
    });
});

describe('inclusiveUpperBound', () => {
    it('sorts after every time-of-day on its own date', () => {
        const bound = inclusiveUpperBound('2026-07-29');
        // `inspections.date` holds either shape depending on how the row was made.
        expect('2026-07-29' <= bound).toBe(true);
        expect('2026-07-29T07:40:07.055Z' <= bound).toBe(true);
        expect('2026-07-29T23:59:59.999Z' <= bound).toBe(true);
        // …and before the next day, either shape.
        expect('2026-07-30' <= bound).toBe(false);
        expect('2026-07-30T00:00:00.000Z' <= bound).toBe(false);
    });

    it('is why a same-day inspection is not silently dropped', () => {
        // The bug this exists to prevent: comparing against the bare date
        // excludes every row created today, because '2026-07-29T07:40' sorts
        // AFTER '2026-07-29'. A user picking "Last 7 days" would see today's
        // work missing with no indication anything had been filtered out.
        expect('2026-07-29T07:40:07.055Z' <= '2026-07-29').toBe(false);
    });
});
