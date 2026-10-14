import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { EVENT_TYPES } from '../../../server/services/starter-content/fixtures/event-types';

/**
 * Inserts the default booking event types for one tenant, straight from the
 * fixture list provisioning uses. A test fixture only: production code gets
 * these rows through the starter-content installer.
 */
export async function seedDefaultEventTypes(
    db: BetterSQLite3Database<typeof schema>,
    tenantId: string,
): Promise<void> {
    await db.insert(schema.eventTypes).values(EVENT_TYPES.map(seed => ({
        id:        crypto.randomUUID(),
        tenantId,
        createdAt: new Date(),
        active:    true,
        ...seed,
    })));
}
