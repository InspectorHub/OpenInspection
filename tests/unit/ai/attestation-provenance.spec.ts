import { describe, it, expect, beforeEach } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fx = createTestDb();
    db = fx.db;
    await setupSchema(fx.sqlite);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'a1', createdAt: new Date() });
});

/**
 * ⚠️ A describe block stood here, and what it was doing is worth recording.
 *
 * It asserted that `ai_key_attestation_endpoint`, `_model`, `_service_tier`,
 * `_intended_use` and `_config_version` round-tripped — the "record the
 * destination, not just the key" half of the attestation. Every one of those
 * assertions passed, and none of them meant anything: `AiKeyAttestationRecord`
 * carries no such fields, so the secrets save could not write them even in
 * principle. **This spec was the only thing that had ever put a value in those
 * five columns**, and it was inserting them with Drizzle and reading them back,
 * which proves SQLite stores what you give it.
 *
 * They were left behind when the AI fields moved to `tenant_ai_configs` /
 * `tenant_ai_attestations`, so the assertions went with them. What the live
 * attestation actually records is covered in
 * `tests/unit/secrets/byo-ai-attestation.spec.ts`, against the save path rather
 * than against the table.
 *
 * The version-starts-at-zero case moved too, to `ai-config-save.spec.ts` — and
 * has since been deleted outright along with the column it described. What
 * remains there asserts the upsert branch it used to prove incidentally: the
 * first save creates the row, the second updates it.
 */

/**
 * ⚠️ TWO MORE ASSERTIONS STOOD HERE, AND THEY WENT THE SAME WAY AS THE FIVE ABOVE.
 *
 * They inserted `config_version` with Drizzle and read it back, under the title
 * "provenance answers which configuration was in force". It never did: the
 * version was a pointer into a per-version history that was never kept, and no
 * call site ever supplied one, so the column was NULL on every row for as long
 * as it existed. The tests passed because SQLite stores what you give it —
 * the same shape as the five attestation columns this file already records
 * having deleted for exactly that reason.
 *
 * The question they were reaching for IS now answered, by
 * `ai_call_provenance.endpoint`, observed off the adapter that ran. That is
 * covered in `provenance.spec.ts` against the write path, which is where a
 * value the system produces belongs — not here against the table.
 */
describe('provenance carries no prompt text', () => {
    it('still has no field that could carry the prompt', () => {
        // The enforcement the schema comment describes — asserted rather than
        // trusted, because this change widens the table.
        const columns = Object.keys(schema.aiCallProvenance);
        expect(columns.some(c => /prompt|text|content|body|input/i.test(c)
            && c !== 'promptVersion')).toBe(false);
    });
});
