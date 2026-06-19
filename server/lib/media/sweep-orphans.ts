import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { inspections, inspectionResults, inspectionMediaPool, orphanedMedia } from '../db/schema/inspection';
import { collectAttachedPhotos } from './collect-attached';
import { computeOrphans, ORPHAN_GRACE_MS } from './orphan-gc';
import { logger } from '../logger';

/**
 * Background GC of orphaned inspection R2 blobs (Q8).
 *
 * For each inspection, list its R2 prefix and compute the live key set from the
 * attached photos, cover image, and media pool. Keys present in R2 but no longer
 * referenced are recorded the first time they are seen unreferenced, then deleted
 * once they have aged past the grace window. Idempotent: safe to run every tick.
 *
 * @returns the number of R2 objects deleted this run.
 */
export async function sweepOrphanedMedia(d1: D1Database, r2: R2Bucket, now: number): Promise<number> {
  const db = drizzle(d1);
  let reaped = 0;
  const rows = await db
    .select({
      id: inspections.id,
      tenantId: inspections.tenantId,
      coverImageKey: inspections.coverImageKey,
      coverPhotoId: inspections.coverPhotoId,
    })
    .from(inspections)
    .all();
  for (const insp of rows) {
    const prefix = `${insp.tenantId}/${insp.id}/`;
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
    const live = new Set<string>();
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

    const r2Keys: string[] = [];
    let cursor: string | undefined = undefined;
    do {
      const list: R2Objects = await r2.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const o of list.objects) r2Keys.push(o.key);
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

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
  return reaped;
}
