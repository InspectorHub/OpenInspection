/**
 * The Durable Object's `/rename-legacy-keys` verb.
 *
 * Reached only through a Worker-side stub whose id is derived from the
 * verified tenant and the report (`collabDocName`); like every other verb the
 * object trusts that route as its boundary. The object wires `hydrate` and
 * `persist` in; the decision of what to rename lives in
 * `server/lib/collab/legacy-key-rename.ts`.
 */

import type * as Y from 'yjs';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { hasRenamableLegacyKeys, itemSectionsFromSnapshot, renameLegacyFindingKeys } from '../lib/collab/legacy-key-rename';

/** The inspection's template snapshot, read under the tenant filter. */
export async function loadTemplateSnapshot(d1: D1Database, tenantId: string, inspectionId: string): Promise<unknown> {
    const row = await drizzle(d1)
        .select({ templateSnapshot: inspections.templateSnapshot })
        .from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.id, inspectionId)))
        .get();
    return row?.templateSnapshot ?? null;
}

export interface RenameLegacyKeysDeps {
    inspectionId: string;
    loadSnapshot: () => Promise<unknown>;
    /** Loads the document from D1 when the object has no stored state; not optional. */
    hydrate:      () => Promise<void>;
    /** Takes a version-history snapshot of the document as it is before anything moves. */
    snapshot:     () => Promise<unknown>;
    persist:      () => Promise<void>;
}

/**
 * Rename the document's legacy finding keys and persist the result.
 *
 * `hydrate` runs first and is not optional: an object with no prior state would
 * otherwise rename nothing and then persist an empty projection over the row.
 * When the rename would move anything, a snapshot is taken first so a rename
 * that went wrong (a conflict keeps the composite value) can be undone from the
 * version history; if the snapshot fails nothing is renamed. Nothing is
 * persisted when nothing was renamed. The log line carries numbers only.
 */
export async function renameLegacyKeysResponse(doc: Y.Doc, deps: RenameLegacyKeysDeps): Promise<Response> {
    await deps.hydrate();
    const sections = itemSectionsFromSnapshot(await deps.loadSnapshot());
    if (hasRenamableLegacyKeys(doc, sections)) await deps.snapshot();

    const counts = renameLegacyFindingKeys(doc, sections);
    if (counts.renamed > 0) {
        await deps.persist();
        logger.warn('collab_legacy_keys_renamed', { inspectionId: deps.inspectionId, renamed: counts.renamed, conflicts: counts.conflicts });
    }
    return Response.json(counts);
}
