import { drizzle } from 'drizzle-orm/d1';
import { and, eq, sql } from 'drizzle-orm';
import { templates, inspections, inspectionResults } from '../lib/db/schema';
import { tenantMarketplaceImportHistory } from '../lib/db/schema/marketplace';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { MigrationStrategy } from '../lib/validations/template-migration.schema';

export interface MigrationPreview {
    affected: number;
    breakingItems: Array<{
        inspectionId: string;
        missingItems: string[];
        legacyResultsCount: number;
    }>;
    compatibleItems: Array<{ inspectionId: string }>;
    oldItemIds: string[];
    newItemIds: string[];
}

export interface MigrateResult {
    dryRun?: boolean;
    migrated: number;
    strategy: MigrationStrategy;
    preview: MigrationPreview;
    oldTemplateDeleted: boolean;
}

interface MigrateOptions {
    dryRun?: boolean;
    deleteOldTemplate?: boolean;
}

/**
 * Sprint 2 S2-6 — Template migration service.
 *
 * Re-binds inspections from one template to another with three policies:
 *   - 'refuse_incompatible' — abort with 422 if any inspection has results
 *     for items absent from the new template.
 *   - 'preserve_unknown' — park removed-item data under `data._legacy` so
 *     the inspector can surface or discard later. Default.
 *   - 'force' — drop removed-item data without ceremony.
 *
 * Always writes one row to `tenant_marketplace_import_history` with
 * action='migrate' so the per-import history drawer (S2-8) shows the event.
 */
export class TemplateMigrationService {
    private db: ReturnType<typeof drizzle>;

    constructor(rawDb: D1Database, private tenantId: string) {
        this.db = drizzle(rawDb);
    }

    private extractItemIds(rawSchema: unknown): string[] {
        let parsed: unknown = rawSchema;
        if (typeof rawSchema === 'string') {
            try { parsed = JSON.parse(rawSchema); } catch { return []; }
        }
        if (!parsed || typeof parsed !== 'object') return [];
        const sections = (parsed as { sections?: unknown[] }).sections;
        if (!Array.isArray(sections)) {
            // Flat array form: [{id, ...}, …]
            if (Array.isArray(parsed)) {
                return (parsed as Array<{ id?: string }>).map((it) => it?.id || '').filter(Boolean);
            }
            return [];
        }
        const out: string[] = [];
        for (const sec of sections) {
            const items = (sec as { items?: unknown[] }).items;
            if (!Array.isArray(items)) continue;
            for (const it of items) {
                const id = (it as { id?: string }).id;
                if (id) out.push(id);
            }
        }
        return out;
    }

    /**
     * Delete a template iff no inspection in this tenant still references it.
     * Returns true when deleted, false when the gate refused.
     *
     * Exposed (rather than inlined) so callers and tests can drive the gate
     * deterministically when a concurrent insert needs to be simulated.
     */
    async tryDeleteOldTemplate(oldId: string): Promise<boolean> {
        const stillRefs = await this.db.select({ id: inspections.id })
            .from(inspections)
            .where(and(
                eq(inspections.templateId, oldId),
                eq(inspections.tenantId, this.tenantId),
            ))
            .limit(1)
            .get();
        if (stillRefs) {
            logger.info('[migrate] skipped delete — other inspections still reference old template', {
                tenantId: this.tenantId, oldId,
            });
            return false;
        }
        await this.db.delete(templates)
            .where(and(eq(templates.id, oldId), eq(templates.tenantId, this.tenantId)))
            .run();
        return true;
    }

    /**
     * Compute the migration preview without mutating anything.
     */
    async preview(oldId: string, newId: string): Promise<MigrationPreview> {
        const oldT = await this.db.select().from(templates)
            .where(and(eq(templates.id, oldId), eq(templates.tenantId, this.tenantId)))
            .get();
        const newT = await this.db.select().from(templates)
            .where(and(eq(templates.id, newId), eq(templates.tenantId, this.tenantId)))
            .get();
        if (!oldT || !newT) {
            throw Errors.NotFound('Template not found');
        }

        const oldItemIds = this.extractItemIds(oldT.schema);
        const newItemIds = this.extractItemIds(newT.schema);
        const newSet = new Set(newItemIds);

        // Collect every inspection on the old template for this tenant.
        const insRows = await this.db.select({ id: inspections.id })
            .from(inspections)
            .where(and(
                eq(inspections.templateId, oldId),
                eq(inspections.tenantId, this.tenantId),
            ))
            .all();

        if (insRows.length === 0) {
            return { affected: 0, breakingItems: [], compatibleItems: [], oldItemIds, newItemIds };
        }

        const breaking: MigrationPreview['breakingItems'] = [];
        const compatible: MigrationPreview['compatibleItems'] = [];

        // For each inspection, fetch its results and diff item ids against newSet.
        for (const ins of insRows) {
            const insId = ins.id as string;
            const row = await this.db.select({ data: inspectionResults.data })
                .from(inspectionResults)
                .where(and(
                    eq(inspectionResults.inspectionId, insId),
                    eq(inspectionResults.tenantId, this.tenantId),
                ))
                .get();

            let resultMap: Record<string, unknown> = {};
            if (row?.data) {
                resultMap = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data as Record<string, unknown>);
            }
            const itemIds = Object.keys(resultMap).filter((k) => k !== '_legacy');
            const missing = itemIds.filter((iid) => !newSet.has(iid));
            if (missing.length > 0) {
                breaking.push({ inspectionId: insId, missingItems: missing, legacyResultsCount: missing.length });
            } else {
                compatible.push({ inspectionId: insId });
            }
        }

        return { affected: insRows.length, breakingItems: breaking, compatibleItems: compatible, oldItemIds, newItemIds };
    }

    /**
     * Migrate inspections from oldId → newId. Always tenant-scoped.
     * Returns the resolved counts; throws AppError(422) under
     * 'refuse_incompatible' if any inspection would lose data.
     */
    async migrate(
        oldId: string,
        newId: string,
        strategy: MigrationStrategy,
        userId: string,
        options: MigrateOptions = {},
    ): Promise<MigrateResult> {
        const { dryRun = false, deleteOldTemplate = false } = options;

        const preview = await this.preview(oldId, newId);
        if (strategy === 'refuse_incompatible' && preview.breakingItems.length > 0) {
            throw Errors.UnprocessableEntity(
                `Migration would break ${preview.breakingItems.length} inspection(s). Use preserve_unknown or force to proceed.`,
                { preview },
            );
        }

        if (dryRun) {
            return { dryRun: true, migrated: 0, strategy, preview, oldTemplateDeleted: false };
        }

        const newSet = new Set(preview.newItemIds);
        const insRows = await this.db.select({ id: inspections.id })
            .from(inspections)
            .where(and(
                eq(inspections.templateId, oldId),
                eq(inspections.tenantId, this.tenantId),
            ))
            .all();

        const now = Date.now();
        const nowDate = new Date(now);

        // Migrate each inspection: rewrite results.data per strategy then
        // re-point templateId. We perform per-inspection updates in a small
        // batch loop — D1 does not yet have multi-row UPDATE …WHERE IN with
        // dynamic per-row JSON, so the loop is the cleanest path.
        for (const ins of insRows) {
            const insId = ins.id as string;
            const row = await this.db.select({ id: inspectionResults.id, data: inspectionResults.data })
                .from(inspectionResults)
                .where(and(
                    eq(inspectionResults.inspectionId, insId),
                    eq(inspectionResults.tenantId, this.tenantId),
                ))
                .get();

            const oldData: Record<string, unknown> = row?.data
                ? (typeof row.data === 'string' ? JSON.parse(row.data) : (row.data as Record<string, unknown>))
                : {};
            const kept: Record<string, unknown> = {};
            const dropped: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(oldData)) {
                if (k === '_legacy') {
                    // Preserve any pre-existing _legacy bucket so multi-step
                    // migrations don't silently lose the prior bucket.
                    dropped[k] = v;
                    continue;
                }
                if (newSet.has(k)) kept[k] = v;
                else dropped[k] = v;
            }

            const finalData =
                strategy === 'preserve_unknown' && Object.keys(dropped).length > 0
                    ? { ...kept, _legacy: dropped }
                    : kept;

            if (row) {
                await this.db.update(inspectionResults)
                    .set({ data: JSON.stringify(finalData), lastSyncedAt: nowDate })
                    .where(eq(inspectionResults.id, row.id as string))
                    .run();
            }

            await this.db.update(inspections)
                .set({ templateId: newId })
                .where(and(eq(inspections.id, insId), eq(inspections.tenantId, this.tenantId)))
                .run();
        }

        // Optionally delete the old template if no inspection references it.
        const oldTemplateDeleted = deleteOldTemplate
            ? await this.tryDeleteOldTemplate(oldId)
            : false;

        // Write history row (S2-8). Single insert; never blocks the response.
        try {
            await this.db.insert(tenantMarketplaceImportHistory).values({
                id:            crypto.randomUUID(),
                tenantId:      this.tenantId,
                templateId:    newId,
                libraryId:     null,
                action:        'migrate',
                sourceVersion: null,
                targetVersion: null,
                rowsAffected:  insRows.length,
                metadata:      JSON.stringify({
                    fromTemplateId: oldId,
                    toTemplateId:   newId,
                    strategy,
                    breakingItems:  preview.breakingItems.length,
                    compatibleItems: preview.compatibleItems.length,
                    oldTemplateDeleted,
                }),
                createdAt:     nowDate,
                createdBy:     userId,
            }).run();
        } catch (err) {
            // Audit failure must never break the migration response.
            logger.error('[migrate] history insert failed', {
                tenantId: this.tenantId, oldId, newId,
            }, err instanceof Error ? err : undefined);
        }

        // Bump the new template's version so the audit log carries clear
        // before/after version numbers.
        await this.db.update(templates)
            .set({ version: sql`COALESCE(${templates.version}, 1) + 1` })
            .where(and(eq(templates.id, newId), eq(templates.tenantId, this.tenantId)))
            .run();

        return {
            migrated: insRows.length,
            strategy,
            preview,
            oldTemplateDeleted,
        };
    }
}
