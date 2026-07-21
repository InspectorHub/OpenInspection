import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { inspectorCredentials } from '../../../server/lib/db/schema';

describe('inspector_credentials schema', () => {
  it('has the credential columns and no expiry field', () => {
    const cols = getTableConfig(inspectorCredentials).columns.map((c) => c.name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id', 'tenant_id', 'user_id', 'label', 'member_number',
        'image_r2_key', 'sort_order', 'is_active', 'created_at', 'updated_at',
      ]),
    );
    expect(cols).not.toContain('expires_at');
  });
});
