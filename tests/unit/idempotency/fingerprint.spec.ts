import { describe, it, expect } from 'vitest';
import { canonicalize, fingerprint } from '../../../server/lib/idempotency/fingerprint';

describe('canonicalize', () => {
    it('orders keys so payload order cannot change the fingerprint', () => {
        expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    });

    it('recurses into nested objects and arrays', () => {
        expect(canonicalize({ x: [{ b: 1, a: 2 }] })).toBe(canonicalize({ x: [{ a: 2, b: 1 }] }));
    });

    it('does NOT treat array order as insignificant — [1,2] is not [2,1]', () => {
        expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
    });
});

describe('fingerprint', () => {
    it('differs when the body differs', async () => {
        const a = await fingerprint('POST', '/api/inspections', { address: 'A' });
        const b = await fingerprint('POST', '/api/inspections', { address: 'B' });
        expect(a).not.toBe(b);
    });

    it('differs when the path differs but the body matches', async () => {
        const a = await fingerprint('POST', '/api/inspections', { x: 1 });
        const b = await fingerprint('POST', '/api/reports', { x: 1 });
        expect(a).not.toBe(b);
    });

    it('is stable across calls', async () => {
        const body = { address: '123 Main', date: '2026-08-05' };
        expect(await fingerprint('POST', '/p', body)).toBe(await fingerprint('POST', '/p', body));
    });
});
