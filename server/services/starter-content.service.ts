/**
 * Trial Sample-Data Mode (2026-05-20 spec) — starter content seeding.
 *
 * Called from the portal's OnboardingWorkflow once a new tenant is
 * provisioned, this service idempotently populates the tenant with the
 * tools-only starter content described in the spec:
 *
 *   - 3 inspection templates  (Residential / Pre-Listing / Sewer Scope)
 *   - 1 agreement template    (generic pre-inspection w/ disclaimer)
 *   - 250 canned comments     (from starter-content/fixtures/canned-comments)
 *   - 3 event_types           (Standard / Pre-Listing / Sewer Scope)
 *   - 4 tags                  (Safety concern / Needs maintenance / Cosmetic / Follow-up needed)
 *   - 80 recommendations      (from server/data/recommendation-seeds.ts)
 *   - 4 rating systems        (from server/data/rating-system-seeds.ts)
 *   - N marketplace libraries (global; idempotent at the libraries table)
 *
 * "Idempotent" means: safe to call twice — the second call inserts 0 rows
 * everywhere. Per-table uniqueness key:
 *
 *   templates                → (tenantId, name)
 *   agreements               → (tenantId, name)
 *   comments                 → (tenantId, category, text)            (text is the natural body)
 *   event_types              → (tenantId, slug)
 *   tags                     → (tenantId, name)                       (enforced by uniqueIndex)
 *   recommendations          → (tenantId, category, name)
 *   rating_systems           → (tenantId, slug)                       (enforced by uniqueIndex)
 *   marketplace_libraries    → (name)                                  (global table — name unique)
 *
 * The function never throws on individual-row insert failure unless the
 * failure indicates a programming bug (schema mismatch, etc.). Existence
 * checks happen first; insert paths are unconditional.
 */

import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import {
    templates,
    agreements,
    comments,
    eventTypes,
    tags,
    recommendations,
    ratingSystems,
    marketplaceLibraries,
} from '../lib/db/schema';
import { logger } from '../lib/logger';

// Spec 4F + design-alignment B+C fix — the "bare" INSPECTION_TEMPLATES
// fixture in starter-content/fixtures/templates.ts seeds section
// scaffolding with `items: []`, which leaves users staring at templates
// that look broken (the templates list shows "0 items" for every row).
// Swap to the same rich JSON files TemplateSeedService.bulkSeed uses so
// portal-onboarded tenants get the 40-item Standard Residential, the
// 21-item Pre-Listing, the 9-item Sewer Scope, etc. Same shape (name +
// schema), just populated. Idempotent — the loop below skips names that
// already exist on the tenant.
import residentialSeed         from '../data/seed-templates/residential.json';
import preListingSeed          from '../data/seed-templates/pre-listing.json';
import newConstructionSeed     from '../data/seed-templates/new-construction.json';
import newConstructionFinalSeed from '../data/seed-templates/new-construction-final.json';
import sewerScopeSeed          from '../data/seed-templates/sewer-scope.json';
import radonSeed               from '../data/seed-templates/radon.json';
import moldInspectionSeed      from '../data/seed-templates/mold-inspection.json';
const INSPECTION_TEMPLATES = [
    residentialSeed,
    preListingSeed,
    newConstructionSeed,
    newConstructionFinalSeed,
    sewerScopeSeed,
    radonSeed,
    moldInspectionSeed,
] as ReadonlyArray<{ name: string; schema: unknown }>;
import { AGREEMENT_TEMPLATE } from './starter-content/fixtures/agreement-template';
import { CANNED_COMMENTS } from './starter-content/fixtures/canned-comments';
import { EVENT_TYPES } from './starter-content/fixtures/event-types';
import { TAGS } from './starter-content/fixtures/tags';
import { RECOMMENDATIONS } from './starter-content/fixtures/recommendations';
import { RATING_SYSTEMS } from './starter-content/fixtures/rating-systems';
import { MARKETPLACE_LIBRARIES } from './starter-content/fixtures/marketplace';

/**
 * Insert many rows in as few D1 round-trips as possible: multi-row INSERTs
 * chunked to stay under D1's 100-bound-parameter-per-statement limit, all sent
 * in a single db.batch(). No-op for an empty array. This turns hundreds of
 * sequential awaited inserts (slow, and a long window during which a closed
 * setup tab leaves partial data) into one batched round-trip per table.
 */
async function batchInsert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table: any,
    rows: Record<string, unknown>[],
): Promise<void> {
    if (rows.length === 0) return;

    // Drivers without batch support (e.g. unit-test mocks): sequential inserts.
    if (typeof d.batch !== 'function') {
        for (const row of rows) await d.insert(table).values(row).run();
        return;
    }

    const colsPerRow = Object.keys(rows[0]!).length || 1;
    const maxRowsPerStmt = Math.max(1, Math.floor(100 / colsPerRow));
    const stmts = [];
    for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
        stmts.push(d.insert(table).values(rows.slice(i, i + maxRowsPerStmt)));
    }
    // d.batch wants a non-empty tuple; stmts is guaranteed non-empty here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await d.batch(stmts as [any, ...any[]]);
}

export interface StarterContentResult {
    inspectionTemplatesSeeded: number;
    agreementTemplatesSeeded:  number;
    cannedCommentsSeeded:      number;
    eventTypesSeeded:          number;
    tagsSeeded:                number;
    recommendationsSeeded:     number;
    ratingSystemsSeeded:       number;
    marketplaceLibrariesSeeded: number;
}

/**
 * Idempotently seed starter content into a tenant. Safe to call multiple
 * times — existing rows (matched per the uniqueness key documented in the
 * module header) are not duplicated.
 *
 * @returns counts of NEW rows inserted (zero on idempotent re-run).
 */
export async function seedStarterContent(
    db: D1Database,
    tenantId: string,
): Promise<StarterContentResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = drizzle(db as any);

    // ── inspection templates ────────────────────────────────────────────
    let inspectionTemplatesSeeded = 0;
    {
        const existing = await d.select({ name: templates.name }).from(templates)
            .where(eq(templates.tenantId, tenantId)).all();
        const existingNames = new Set(existing.map(r => r.name as string));
        const rows = INSPECTION_TEMPLATES.filter(t => !existingNames.has(t.name)).map(t => ({
            id:        crypto.randomUUID(),
            tenantId,
            name:      t.name,
            version:   1,
            schema:    JSON.stringify(t.schema),
            createdAt: new Date(),
        }));
        await batchInsert(d, templates, rows);
        inspectionTemplatesSeeded = rows.length;
    }

    // ── agreement templates ─────────────────────────────────────────────
    let agreementTemplatesSeeded = 0;
    {
        const existing = await d.select({ name: agreements.name }).from(agreements)
            .where(and(eq(agreements.tenantId, tenantId), eq(agreements.name, AGREEMENT_TEMPLATE.name))).get();
        if (!existing) {
            await d.insert(agreements).values({
                id:        crypto.randomUUID(),
                tenantId,
                name:      AGREEMENT_TEMPLATE.name,
                content:   AGREEMENT_TEMPLATE.content,
                version:   1,
                createdAt: new Date(),
            }).run();
            agreementTemplatesSeeded = 1;
        }
    }

    // ── canned comments ─────────────────────────────────────────────────
    // Uniqueness key: (category, text) within tenant. The combination is
    // stable across re-seeds because both fields are immutable in the
    // fixture.
    let cannedCommentsSeeded = 0;
    {
        const existing = await d.select({ category: comments.category, text: comments.text }).from(comments)
            .where(eq(comments.tenantId, tenantId)).all();
        const existingKeys = new Set(existing.map(r => `${r.category ?? ''}::${r.text}`));
        const now = new Date();
        const rows = CANNED_COMMENTS
            .filter(c => !existingKeys.has(`${c.category ?? ''}::${c.text}`))
            .map(c => ({
                id:           crypto.randomUUID(),
                tenantId,
                text:         c.text,
                category:     c.category,
                ratingBucket: c.ratingBucket,
                section:      c.category,
                sectionIds:   null,
                itemLabels:   null,
                itemLabel:    c.itemLabel || null,
                triggerCode:  null,
                searchKeywords: null,
                createdAt:    now,
            }));
        await batchInsert(d, comments, rows);
        cannedCommentsSeeded = rows.length;
    }

    // ── event types ─────────────────────────────────────────────────────
    let eventTypesSeeded = 0;
    {
        const existing = await d.select({ slug: eventTypes.slug }).from(eventTypes)
            .where(eq(eventTypes.tenantId, tenantId)).all();
        const existingSlugs = new Set(existing.map(r => r.slug as string));
        const rows = EVENT_TYPES.filter(e => !existingSlugs.has(e.slug)).map(e => ({
            id:                 crypto.randomUUID(),
            tenantId,
            name:               e.name,
            slug:               e.slug,
            defaultDurationMin: e.defaultDurationMin,
            defaultPriceCents:  e.defaultPriceCents,
            color:              e.color,
            sortOrder:          e.sortOrder,
            active:             true,
            createdAt:          new Date(),
        }));
        await batchInsert(d, eventTypes, rows);
        eventTypesSeeded = rows.length;
    }

    // ── tags ────────────────────────────────────────────────────────────
    let tagsSeeded = 0;
    {
        const existing = await d.select({ name: tags.name }).from(tags)
            .where(eq(tags.tenantId, tenantId)).all();
        const existingNames = new Set(existing.map(r => r.name as string));
        const now = Date.now();
        const rows = TAGS.filter(tag => !existingNames.has(tag.name)).map(tag => ({
            id:        crypto.randomUUID(),
            tenantId,
            name:      tag.name,
            color:     tag.color,
            isSeed:    1,
            createdAt: now,
        }));
        await batchInsert(d, tags, rows);
        tagsSeeded = rows.length;
    }

    // ── recommendations ─────────────────────────────────────────────────
    let recommendationsSeeded = 0;
    {
        const existing = await d.select({ category: recommendations.category, name: recommendations.name })
            .from(recommendations).where(eq(recommendations.tenantId, tenantId)).all();
        const existingKeys = new Set(existing.map(r => `${r.category ?? ''}::${r.name}`));
        const rows = RECOMMENDATIONS
            .filter(r => !existingKeys.has(`${r.category ?? ''}::${r.name}`))
            .map(r => ({
                id:                   crypto.randomUUID(),
                tenantId,
                category:             r.category,
                name:                 r.name,
                severity:             r.severity,
                defaultEstimateMin:   r.defaultEstimateMin,
                defaultEstimateMax:   r.defaultEstimateMax,
                defaultRepairSummary: r.defaultRepairSummary,
                createdByUserId:      null,
                createdAt:            new Date(),
            }));
        await batchInsert(d, recommendations, rows);
        recommendationsSeeded = rows.length;
    }

    // ── rating systems ──────────────────────────────────────────────────
    let ratingSystemsSeeded = 0;
    {
        const existing = await d.select({ slug: ratingSystems.slug }).from(ratingSystems)
            .where(eq(ratingSystems.tenantId, tenantId)).all();
        const existingSlugs = new Set(existing.map(r => r.slug as string));
        const now = Date.now();
        const rows = RATING_SYSTEMS.filter(rs => !existingSlugs.has(rs.slug)).map(rs => {
            const levels = rs.levels.map((lvl, idx) => ({
                id:    crypto.randomUUID(),
                abbr:  lvl.abbr,
                label: lvl.label,
                color: lvl.color,
                bucket: lvl.bucket,
                ...(lvl.hotkey ? { hotkey: lvl.hotkey } : {}),
                order: idx,
            }));
            return {
                id:          crypto.randomUUID(),
                tenantId,
                name:        rs.name,
                slug:        rs.slug,
                description: rs.description,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                levels:      levels as any,
                isDefault:   rs.isDefault,
                isSeed:      true,
                createdAt:   now,
                updatedAt:   now,
            };
        });
        await batchInsert(d, ratingSystems, rows);
        ratingSystemsSeeded = rows.length;
    }

    // ── marketplace libraries (GLOBAL table) ────────────────────────────
    // The marketplace_libraries table has no tenant_id — it is a shared
    // catalogue of importable content. We still idempotently insert the
    // default libraries here so a brand-new system has something to import.
    let marketplaceLibrariesSeeded = 0;
    {
        const existing = await d.select({ name: marketplaceLibraries.name }).from(marketplaceLibraries).all();
        const existingNames = new Set(existing.map(r => r.name as string));
        const now = new Date().toISOString();
        const rows = MARKETPLACE_LIBRARIES.filter(lib => !existingNames.has(lib.name)).map(lib => ({
            id:            crypto.randomUUID(),
            name:          lib.name,
            kind:          lib.kind,
            semver:        lib.semver,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            schema:        lib.schema as any,
            authorId:      'system',
            changelog:     lib.changelog,
            downloadCount: 0,
            featured:      lib.featured,
            createdAt:     now,
            updatedAt:     now,
        }));
        await batchInsert(d, marketplaceLibraries, rows);
        marketplaceLibrariesSeeded = rows.length;
    }

    const result: StarterContentResult = {
        inspectionTemplatesSeeded,
        agreementTemplatesSeeded,
        cannedCommentsSeeded,
        eventTypesSeeded,
        tagsSeeded,
        recommendationsSeeded,
        ratingSystemsSeeded,
        marketplaceLibrariesSeeded,
    };
    logger.info('starter-content.seeded', { tenantId, ...result });
    return result;
}
