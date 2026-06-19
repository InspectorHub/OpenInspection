import { eq, and } from 'drizzle-orm';
import { inspections, inspectionResults, templates } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { sanitizeDefectStates, type PropertyFacts, type PropertyFactFoundation } from './shared';
import { InspectionSubService } from './base';

/**
 * Inspection results writes: field results merge, property-facts read/write,
 * per-inspection template snapshot replacement, and rating-system switch
 * (remap / clear). Extracted verbatim from InspectionService. Self-contained
 * (getPropertyFacts is called internally by updatePropertyFacts).
 */
export class InspectionResultsService extends InspectionSubService {
    /**
     * Round-2 backlog G1 (Spectora §E.2) — return the Property Facts strip
     * payload for a single inspection. Each field is null when the inspector
     * hasn't filled it in yet so the UI can show its "—" placeholder.
     */
    async getPropertyFacts(id: string, tenantId: string): Promise<PropertyFacts> {
        const db = this.getDrizzle();
        const row = await db.select({
            yearBuilt:      inspections.yearBuilt,
            sqft:           inspections.sqft,
            foundationType: inspections.foundationType,
            lotSize:        inspections.lotSize,
            bedrooms:       inspections.bedrooms,
            bathrooms:      inspections.bathrooms,
        }).from(inspections)
          .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
          .get();
        if (!row) throw Errors.NotFound('Inspection not found');
        // Foundation column is free-text in SQLite; coerce to the canonical
        // four-value enum so the API response schema validates. Anything
        // unexpected falls back to 'other'.
        const allowedFoundations: ReadonlyArray<PropertyFactFoundation> =
            ['basement', 'slab', 'crawlspace', 'other'] as const;
        const ft = row.foundationType ?? null;
        const foundationType: PropertyFactFoundation | null = ft === null
            ? null
            : (allowedFoundations.includes(ft as PropertyFactFoundation) ? (ft as PropertyFactFoundation) : 'other');
        return {
            yearBuilt:      row.yearBuilt      ?? null,
            sqft:           row.sqft           ?? null,
            foundationType,
            lotSize:        row.lotSize        ?? null,
            bedrooms:       row.bedrooms       ?? null,
            bathrooms:      row.bathrooms      ?? null,
        };
    }

    /**
     * Round-2 backlog G1 — patch the six Property Facts columns in a single
     * write. Undefined keys are skipped (so the caller can save one field at
     * a time without clobbering the others). Null values clear the field.
     * Returns the resulting facts row so the UI doesn't need a re-fetch.
     */
    async updatePropertyFacts(id: string, tenantId: string, facts: {
        yearBuilt?:      number | null | undefined;
        sqft?:           number | null | undefined;
        foundationType?: PropertyFactFoundation | null | undefined;
        lotSize?:        string | null | undefined;
        bedrooms?:       number | null | undefined;
        bathrooms?:      number | null | undefined;
    }): Promise<PropertyFacts> {
        const db = this.getDrizzle();
        const existing = await db.select({ id: inspections.id }).from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!existing) throw Errors.NotFound('Inspection not found');

        const update: Partial<typeof inspections.$inferInsert> = {};
        if (facts.yearBuilt      !== undefined) update.yearBuilt      = facts.yearBuilt;
        if (facts.sqft           !== undefined) update.sqft           = facts.sqft;
        if (facts.foundationType !== undefined) update.foundationType = facts.foundationType;
        if (facts.lotSize        !== undefined) update.lotSize        = facts.lotSize;
        if (facts.bedrooms       !== undefined) update.bedrooms       = facts.bedrooms;
        if (facts.bathrooms      !== undefined) update.bathrooms      = facts.bathrooms;

        if (Object.keys(update).length > 0) {
            await db.update(inspections).set(update)
                .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
        }

        return this.getPropertyFacts(id, tenantId);
    }

    /**
     * Updates an inspection's results.
     */
    async updateResults(id: string, tenantId: string, data: Record<string, unknown>) {
        const db = this.getDrizzle();
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) {
            throw Errors.NotFound('Inspection not found or access denied');
        }

        // Sprint 2 S2-3 / S2-4 — validate the per-defect recommendation slug
        // and estimate range fields before persisting. Unknown slugs are
        // dropped (silently — the legacy fields stay intact); negative or
        // non-finite cents collapse to null. This guards the JSON payload
        // without rejecting the entire write on a single bad row.
        sanitizeDefectStates(data);

        const existing = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();

        if (existing) {
            const mergedData = { ...(existing.data as Record<string, unknown>), ...data };
            await db.update(inspectionResults).set({ data: mergedData, lastSyncedAt: new Date() }).where(eq(inspectionResults.id, existing.id));
        } else {
            // Sprint 2 S2-1 — when seeding an inspection_results row for the
            // first time, also freeze the active rating system onto the row
            // so future edits to the source system never mutate this report.
            let ratingSystemId: string | null = null;
            let ratingSystemSnapshot: unknown = null;
            if (inspection.templateId) {
                const tpl = await db.select().from(templates)
                    .where(and(eq(templates.id, inspection.templateId), eq(templates.tenantId, tenantId)))
                    .get();
                const tplRatingSystemId = tpl
                    ? ((tpl as unknown as { ratingSystemId?: string | null }).ratingSystemId ?? null)
                    : null;
                if (tplRatingSystemId) {
                    const { ratingSystems } = await import('../../lib/db/schema');
                    const sysRow = await db.select().from(ratingSystems)
                        .where(and(eq(ratingSystems.id, tplRatingSystemId), eq(ratingSystems.tenantId, tenantId)))
                        .get();
                    if (sysRow) {
                        ratingSystemId = sysRow.id as string;
                        const rawLevels = sysRow.levels as unknown;
                        const lvls = typeof rawLevels === 'string' ? JSON.parse(rawLevels) : rawLevels;
                        ratingSystemSnapshot = { id: sysRow.id, slug: sysRow.slug, name: sysRow.name, levels: lvls };
                    }
                }
            }
            const insertValues = {
                id: crypto.randomUUID(),
                inspectionId: id,
                tenantId,
                data,
                lastSyncedAt: new Date(),
                ratingSystemId,
                ratingSystemSnapshot: ratingSystemSnapshot as never,
            };
            await db.insert(inspectionResults).values(insertValues);
        }
    }

    /**
     * Feature: inline template-snapshot edit.
     *
     * Replaces the per-inspection template snapshot wholesale — used by the
     * editor when an inspector swaps rating system, adds/removes sections or
     * items, or otherwise tailors the report structure for one job without
     * touching the source template row. Validation happens upstream at the
     * Zod boundary, so by the time we land here `snapshot` is a parsed v2
     * schema object; we stringify on the way to D1.
     */
    async updateTemplateSnapshot(id: string, tenantId: string, snapshot: unknown) {
        const db = this.getDrizzle();
        const row = await db.select({ id: inspections.id }).from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!row) throw Errors.NotFound('Inspection not found or access denied');
        await db.update(inspections)
            .set({ templateSnapshot: JSON.stringify(snapshot) as never })
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));
    }

    /**
     * Feature #20 phase 2 — swap the rating system on a per-inspection
     * snapshot, with controlled handling of already-saved item ratings.
     *
     * Mode:
     *   'remap'  — try to map each existing rating to the new system by
     *              severity bucket (good / marginal / significant). Levels
     *              whose bucket has no match in the new system are cleared.
     *   'clear'  — wipe every rating; preserve notes, photos, custom
     *              comments.
     *
     * Also clears inspection_results.ratingSystemSnapshot so getReportData
     * picks the new system from the template snapshot on the next read,
     * and re-freezes against the new system on the next write.
     */
    async switchRatingSystem(
        id: string,
        tenantId: string,
        ratingSystemId: string,
        mode: 'remap' | 'clear',
    ): Promise<{ remapped: number; cleared: number; total: number }> {
        const db = this.getDrizzle();
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!inspection) throw Errors.NotFound('Inspection not found or access denied');

        const { ratingSystems } = await import('../../lib/db/schema');
        const sysRow = await db.select().from(ratingSystems)
            .where(and(eq(ratingSystems.id, ratingSystemId), eq(ratingSystems.tenantId, tenantId)))
            .get();
        if (!sysRow) throw Errors.NotFound('Rating system not found');

        type SeedLevel = { id?: string; abbr?: string; label: string; color?: string; bucket: string };
        const rawLevels = sysRow.levels as unknown;
        const newLevels: SeedLevel[] = typeof rawLevels === 'string' ? JSON.parse(rawLevels) as SeedLevel[] : rawLevels as SeedLevel[];

        // bucket → severity mapping (rating-systems table uses 'bucket',
        // TemplateSchemaV2 uses 'severity' on the embedded ratingSystem)
        const bucketToSeverity = (b: string): 'good' | 'marginal' | 'significant' | 'minor' => {
            if (b === 'satisfactory') return 'good';
            if (b === 'monitor') return 'marginal';
            if (b === 'defect') return 'significant';
            return 'minor';
        };

        // Build new embedded rating system for the snapshot
        const newSnapLevels = newLevels.map(l => ({
            id:           l.label,
            label:        l.label,
            ...(l.abbr ? { abbreviation: l.abbr } : {}),
            ...(l.color ? { color: l.color } : {}),
            severity:     bucketToSeverity(l.bucket),
            isDefect:     l.bucket === 'defect',
        }));

        // Build remap: old level label/id → new level id, via bucket
        const snapStr = inspection.templateSnapshot as unknown as string | null;
        const oldSnapshot = snapStr ? JSON.parse(snapStr) as { ratingSystem?: { levels?: Array<{ id: string; label?: string; severity?: string }> }; [k: string]: unknown } : {};
        const oldLevels = oldSnapshot.ratingSystem?.levels ?? [];
        const severityToBucket = (s: string | undefined): string | null => {
            if (s === 'good') return 'satisfactory';
            if (s === 'marginal') return 'monitor';
            if (s === 'significant') return 'defect';
            return null;
        };
        const remap = new Map<string, string | null>();
        for (const oldL of oldLevels) {
            const bucket = severityToBucket(oldL.severity);
            const newL = bucket ? newLevels.find(n => n.bucket === bucket) : null;
            remap.set(oldL.id, newL?.label ?? null);
            if (oldL.label && oldL.label !== oldL.id) remap.set(oldL.label, newL?.label ?? null);
        }

        // Overwrite snapshot
        const newSnapshot = {
            ...oldSnapshot,
            ratingSystem: {
                name:           sysRow.name,
                defaultLevelId: newSnapLevels[0]?.id,
                levels:         newSnapLevels,
            },
        };
        await db.update(inspections)
            .set({ templateSnapshot: JSON.stringify(newSnapshot) as never })
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)));

        // Rewrite per-item ratings on inspection_results
        const existing = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId)))
            .get();
        let remapped = 0, cleared = 0, total = 0;
        if (existing) {
            const data = { ...(existing.data as Record<string, Record<string, unknown>>) };
            for (const itemId of Object.keys(data)) {
                const it = data[itemId];
                if (!it || !('rating' in it)) continue;
                const oldRating = it.rating as string | null | undefined;
                if (!oldRating) continue;
                total++;
                if (mode === 'clear') {
                    it.rating = null;
                    cleared++;
                } else {
                    const next = remap.has(oldRating) ? remap.get(oldRating) : null;
                    if (next) {
                        it.rating = next;
                        remapped++;
                    } else {
                        it.rating = null;
                        cleared++;
                    }
                }
            }
            // Clear the ratingSystemSnapshot freeze so the new one re-freezes
            // on the next write.
            await db.update(inspectionResults).set({
                data,
                ratingSystemId: null as never,
                ratingSystemSnapshot: null as never,
                lastSyncedAt: new Date(),
            }).where(eq(inspectionResults.id, existing.id));
        }

        return { remapped, cleared, total };
    }
}
