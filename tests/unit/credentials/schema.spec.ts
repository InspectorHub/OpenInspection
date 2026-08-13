import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { inspectorCredentials, users } from '../../../server/lib/db/schema';

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

/**
 * The durable half of the retired `license_number_backfill` / `drop_users_license_number`
 * migration pair: `users.license_number` stays gone.
 *
 * That pair used to be exercised by replaying its actual SQL against a rebuilt
 * pre-drop database (`tests/unit/credentials/license-backfill.spec.ts`). The
 * chain squash removed both files, and there is nothing left to replay them
 * against: a squashed baseline builds a fresh database, and a fresh database
 * never had `license_number` to migrate off of. The migration-specific
 * behavior it verified — the backfill's guards, its idempotency, the DROP
 * COLUMN shape that avoided a table rebuild — died with the file, and the
 * label/sort-order/dedup behavior it also covered already has a live home in
 * `CredentialService.primaryLicenseNumber` (`tests/unit/credentials/service.spec.ts`).
 * What outlives the file is the end state: the column never comes back.
 */
describe('users schema', () => {
  it('has no license_number column — the licence lives in inspector_credentials now', () => {
    const cols = getTableConfig(users).columns.map((c) => c.name);
    expect(cols).not.toContain('license_number');
  });
});
