/**
 * The content step of first-run setup.
 *
 * Setup gives a new workspace the full starter library unless the operator
 * asked to start empty, in which case nothing is written here. The matching
 * stamp (`NO_STARTER_CONTENT`) is written with the tenant row by the setup
 * provider, so the bundled-content sweep also leaves the workspace alone.
 */
import { logger } from '../../lib/logger';

export async function seedSetupContent(db: D1Database, tenantId: string, startEmpty: boolean): Promise<void> {
    if (startEmpty) {
        logger.info('Setup started without bundled content', { tenantId });
        return;
    }
    // Auto-seed the FULL starter content library in one idempotent pass (templates, agreements,
    // canned comments, event types, tags, recommendations, rating systems, marketplace libraries) —
    // the same canonical seeder `POST /api/admin/data/install-bundled-content` uses.
    // Not an EXISTING workspace — `already_initialized` refuses forever once a user exists, so content a later release ships arrives only via that route.
    try {
        const { seedStarterContent } = await import('../starter-content.service');
        const seeded = await seedStarterContent(db, tenantId);
        logger.info('Auto-seeded starter content during setup', { tenantId, ...seeded });
    } catch (seedErr) {
        // Don't block setup if seeding fails — log and continue.
        logger.error('Auto-seed starter content failed during setup', { tenantId }, seedErr instanceof Error ? seedErr : undefined);
    }
}
