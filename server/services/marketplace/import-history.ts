/**
 * One row per install / update / replace / uninstall event.
 *
 * A free function beside the other marketplace write halves rather than a
 * method, for the same reason `library-insert.ts` and `library-replace.ts` are:
 * every verb has to write the same audit shape, and a private method is
 * reachable only from the one class — which is what pushed the update paths for
 * the two kinds apart in the first place.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';

import { tenantMarketplaceImportHistory } from '../../lib/db/schema/marketplace';
import { logger } from '../../lib/logger';

/** The service's `drizzle(env.DB)` handle. Named so this signature does not
 *  silently narrow to the schema-less default and reject its only caller. */
type MarketplaceDb = DrizzleD1Database<Record<string, unknown>>;

/**
 * What happened to an import.
 *
 * 'uninstall' is a first-class action rather than an 'update' with a null
 * target: it is the only one that stops a pack being offered, and a reader
 * asking "when did this workspace stop using that pack" needs to be able to
 * find it without inferring it from a missing version.
 */
type MarketplaceHistoryAction = 'install' | 'update' | 'replace' | 'uninstall';

export interface ImportHistoryInput {
    templateId?: string | null;
    libraryId?: string | null;
    action: MarketplaceHistoryAction;
    sourceVersion?: string | null;
    targetVersion?: string | null;
    rowsAffected: number;
    metadata?: Record<string, unknown>;
    userId: string;
}

/**
 * Write one history row.
 *
 * Never throws; swallows + logs, so an audit failure cannot break the import it
 * is describing.
 */
export async function writeImportHistory(
    db: MarketplaceDb,
    tenantId: string,
    input: ImportHistoryInput,
): Promise<void> {
    try {
        await db.insert(tenantMarketplaceImportHistory).values({
            id:            crypto.randomUUID(),
            tenantId,
            templateId:    input.templateId ?? null,
            libraryId:     input.libraryId ?? null,
            action:        input.action,
            sourceVersion: input.sourceVersion ?? null,
            targetVersion: input.targetVersion ?? null,
            rowsAffected:  input.rowsAffected,
            metadata:      input.metadata ? JSON.stringify(input.metadata) : null,
            createdAt:     new Date(),
            createdBy:     input.userId,
        }).run();
    } catch (err) {
        logger.error('[marketplace] history insert failed', {
            tenantId, action: input.action,
        }, err instanceof Error ? err : undefined);
    }
}
