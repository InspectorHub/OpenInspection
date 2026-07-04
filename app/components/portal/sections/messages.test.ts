import { describe, it, expect } from 'vitest';
import { messageRows } from '../../../../app/components/portal/sections/MessagesSection';

describe('messageRows', () => {
  it('orders messages oldest→newest by numeric createdAt', () => {
    const rows = messageRows([
      { body: 'b', fromRole: 'client', createdAt: 2 } as any,
      { body: 'a', fromRole: 'inspector', createdAt: 1 } as any,
    ]);
    expect(rows.map((r) => r.body)).toEqual(['a', 'b']);
  });

  it('orders messages oldest→newest by ISO string createdAt', () => {
    const rows = messageRows([
      { body: 'newer', fromRole: 'client', createdAt: '2026-06-16T10:00:00Z' } as any,
      { body: 'older', fromRole: 'inspector', createdAt: '2026-06-16T09:00:00Z' } as any,
    ]);
    expect(rows.map((r) => r.body)).toEqual(['older', 'newer']);
  });

  it('preserves all fields', () => {
    const rows = messageRows([
      { id: '1', body: 'a', fromRole: 'client', fromName: 'X', createdAt: 1, attachments: [] } as any,
    ]);
    expect(rows[0]).toMatchObject({ id: '1', fromName: 'X', attachments: [] });
  });
});
