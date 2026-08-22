import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq, gt } from 'drizzle-orm';
import { inspections, inspectionResults, inspectionMediaPool, orphanedMedia } from '../db/schema/inspection';
import { collectAttachedPhotos } from './collect-attached';
import { computeOrphans, ORPHAN_GRACE_MS } from './orphan-gc';
import { logger } from '../logger';

export interface OrphanSweepOptions {
  /** Inspections examined in this batch. */
  limit: number;
  /** Resume point: the last inspection id of the previous batch, or null to start. */
  afterInspectionId: string | null;
}

export interface OrphanSweepResult {
  /** R2 objects deleted this batch. */
  reaped: number;
  /** Where to resume, or null when the whole table has been walked. */
  nextCursor: string | null;
}

/**
 * Background GC of orphaned inspection R2 blobs (Q8).
 *
 * For each inspection in the batch, list its R2 prefix and compute the live key
 * set from the attached photos, cover image, and media pool. Keys present in R2
 * but no longer referenced are recorded the first time they are seen
 * unreferenced, then deleted once they have aged past the grace window.
 * Idempotent: safe to run again, and safe to run twice over the same batch.
 *
 * BOUNDED, and that is not a detail. This used to read every inspection row on
 * every tick and parse every report blob, so its cost was the size of the whole
 * table on a schedule — which is how a background job that fits its CPU budget
 * on the day it ships stops fitting it later without anyone changing a line.
 * Keyset paging on the primary key: stable under concurrent inserts, and it
 * needs no cursor column and therefore no migration in either deployment mode.
 */
export async function sweepOrphanedMedia(
  d1: D1Database,
  r2: R2Bucket,
  now: number,
  opts: OrphanSweepOptions,
): Promise<OrphanSweepResult> {
  const db = drizzle(d1);
  let reaped = 0;
  // One row beyond the batch, purely to answer "is there more?" without a
  // second COUNT query.
  const rows = await db
    .select({
      id: inspections.id,
      tenantId: inspections.tenantId,
      coverImageKey: inspections.coverImageKey,
      coverPhotoId: inspections.coverPhotoId,
    })
    .from(inspections)
    .where(opts.afterInspectionId ? gt(inspections.id, opts.afterInspectionId) : undefined)
    .orderBy(asc(inspections.id))
    .limit(opts.limit + 1)
    .all();
  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;

  for (const insp of page) {
    const prefix = `${insp.tenantId}/${insp.id}/`;

    // R2 FIRST, and the order is load-bearing. When the prefix holds nothing,
    // `computeOrphans` cannot record or delete anything whatever the live set
    // contains — so the report blob need not be read or parsed at all. That
    // parse was the most expensive single operation in the scheduled path, and
    // this skips it for every inspection nobody has attached a photo to.
    const r2Keys: string[] = [];
    let cursor: string | undefined = undefined;
    do {
      const list: R2Objects = await r2.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const o of list.objects) r2Keys.push(o.key);
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    const live = new Set<string>();
    if (r2Keys.length > 0) {
      const resultRow = await db
        .select()
        .from(inspectionResults)
        .where(and(eq(inspectionResults.inspectionId, insp.id), eq(inspectionResults.tenantId, insp.tenantId)))
        .get();
      const data = resultRow?.data
        ? typeof resultRow.data === 'string'
          ? JSON.parse(resultRow.data)
          : resultRow.data
        : {};
      for (const p of collectAttachedPhotos(data, new Map(), (k) => k)) {
        live.add(p.key);
        live.add(p.originalKey);
      }
      if (insp.coverImageKey) live.add(insp.coverImageKey);
      if (insp.coverPhotoId) live.add(insp.coverPhotoId);
      const pool = await db
        .select({ r2Key: inspectionMediaPool.r2Key })
        .from(inspectionMediaPool)
        .where(and(eq(inspectionMediaPool.inspectionId, insp.id), eq(inspectionMediaPool.tenantId, insp.tenantId)))
        .all();
      for (const r of pool) live.add(r.r2Key);
    }

    const seenRows = await db
      .select()
      .from(orphanedMedia)
      .where(and(eq(orphanedMedia.inspectionId, insp.id), eq(orphanedMedia.tenantId, insp.tenantId)))
      .all();
    const seen = new Map<string, number>(
      seenRows.map((r) => [r.r2Key, r.firstSeenAt instanceof Date ? r.firstSeenAt.getTime() : Number(r.firstSeenAt)]),
    );

    const plan = computeOrphans(live, r2Keys, seen, now, ORPHAN_GRACE_MS);
    for (const key of plan.toRecord) {
      await db.insert(orphanedMedia).values({
        id: crypto.randomUUID(),
        tenantId: insp.tenantId,
        inspectionId: insp.id,
        r2Key: key,
        firstSeenAt: new Date(now),
      });
    }
    for (const key of plan.toClear) {
      await db.delete(orphanedMedia).where(and(eq(orphanedMedia.tenantId, insp.tenantId), eq(orphanedMedia.r2Key, key)));
    }
    for (const key of plan.toDelete) {
      await r2.delete(key).catch((err) => logger.warn('[orphan-gc] R2 delete failed', { key, error: String(err) }));
      await db.delete(orphanedMedia).where(and(eq(orphanedMedia.tenantId, insp.tenantId), eq(orphanedMedia.r2Key, key)));
      reaped++;
    }
  }

  return { reaped, nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.id : null };
}
