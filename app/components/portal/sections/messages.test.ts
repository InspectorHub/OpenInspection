import { describe, it, expect } from 'vitest';
import { messageRows } from '../../../../app/components/portal/sections/MessagesSection';

// The fixtures below are deliberately UNCAST. `messageRows` is generic over
// `T extends { createdAt: string | number }` and returns `T[]`, so an ordinary
// object literal is already a legal argument — and passing one is what makes
// `rows.map((r) => r.body)` mean something: T carries the fixture's own shape
// through, so a renamed or dropped field is a compile error here rather than an
// `undefined` that quietly compares equal. An `as any` on each literal (which
// is what these used to carry) collapsed T to `any` and took that with it.
describe('messageRows', () => {
  it('orders messages oldest→newest by numeric createdAt', () => {
    const rows = messageRows([
      { body: 'b', fromRole: 'client', createdAt: 2 },
      { body: 'a', fromRole: 'inspector', createdAt: 1 },
    ]);
    expect(rows.map((r) => r.body)).toEqual(['a', 'b']);
  });

  it('orders messages oldest→newest by ISO string createdAt', () => {
    const rows = messageRows([
      { body: 'newer', fromRole: 'client', createdAt: '2026-06-16T10:00:00Z' },
      { body: 'older', fromRole: 'inspector', createdAt: '2026-06-16T09:00:00Z' },
    ]);
    expect(rows.map((r) => r.body)).toEqual(['older', 'newer']);
  });

  it('preserves all fields', () => {
    const rows = messageRows([
      { id: '1', body: 'a', fromRole: 'client', fromName: 'X', createdAt: 1, attachments: [] },
    ]);
    expect(rows[0]).toMatchObject({ id: '1', fromName: 'X', attachments: [] });
  });
});
