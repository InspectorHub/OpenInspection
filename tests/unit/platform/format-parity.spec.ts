// Guards that the server-side formatter (server/lib/format.ts) stays byte-identical
// to the app-side twin (app/lib/format.ts). The app<->server import boundary forbids
// sharing one module, so this parity test is the executable coupling that fails the
// build if the two ever drift.
import { describe, it, expect } from 'vitest';
import * as appFmt from '../../../app/lib/format';
import * as srvFmt from '../../../server/lib/format';

const CASES = {
  formatDate: [
    ['2026-07-17', { locale: 'en-US', timeZone: 'UTC', month: 'long' as const }],
    ['2026-07-17', { locale: 'es-419', timeZone: 'UTC', month: 'long' as const }],
    ['2026-07-17T20:00:00.000Z', { locale: 'en-US', timeZone: 'Asia/Shanghai' }],
    [null, { locale: 'en-US' }],
  ],
  formatTime: [
    ['2026-07-17T09:00:00.000Z', { locale: 'en-US', timeZone: 'UTC', timeZoneName: 'short' as const }],
    ['2026-07-17T09:00:00.000Z', { locale: 'es-419', timeZone: 'America/New_York' }],
  ],
  formatDateTime: [
    ['2026-07-17T20:00:00.000Z', { locale: 'en-US', timeZone: 'Asia/Shanghai' }],
    ['2026-07-17T20:00:00.000Z', { locale: 'es-419', timeZone: 'UTC' }],
  ],
} as const;

describe('app/server formatter parity', () => {
  for (const [fn, cases] of Object.entries(CASES)) {
    for (const [value, opts] of cases) {
      it(`${fn}(${JSON.stringify(value)}, ${JSON.stringify(opts)}) matches`, () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = (appFmt as any)[fn](value, opts);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = (srvFmt as any)[fn](value, opts);
        expect(s).toBe(a);
      });
    }
  }

  it('formatNumber + formatCurrency match', () => {
    expect(srvFmt.formatNumber(1234567.89, { locale: 'es-419' })).toBe(appFmt.formatNumber(1234567.89, { locale: 'es-419' }));
    expect(srvFmt.formatCurrency(123450, { locale: 'es-419', currency: 'USD' }))
      .toBe(appFmt.formatCurrency(123450, { locale: 'es-419', currency: 'USD' }));
  });
});
