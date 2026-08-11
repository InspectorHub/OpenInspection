// Shared module-level types, constants, and pure helpers for the inspection
// service family. Extracted verbatim from the former monolithic
// inspection.service.ts so the facade + every sub-service import a single
// source of truth (fixes the prior drift risk where these helpers were
// duplicated). Behavior-preserving: bodies are byte-identical moves.

import type { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { AutomationService } from '../automation.service';
import { reportVersions } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { RECOMMENDATION_CATEGORIES, RECOMMENDATION_CATEGORY_IDS } from '../../lib/recommendation-categories';
import { deleteRepairPriceKeys } from '../../lib/repair-price-keys';
import { isDefectTrade, isDefectDeadline, isDefectTimeframe, DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS } from '../../types/defect-fields';
import { listUnresolved } from '../../lib/mustache';
import type { InspectionSchema, InspectionListQuerySchema, CreateInspectionSchema } from '../../lib/validations/inspection.schema';
import type { Severity } from '../../lib/validations/rating-system.schema';
import type { DefectCommentState } from '../../types/inspection-item-state';
import type { CannedDefect, TemplateSchemaV2 } from '../../types/template-schema';

/**
 * An inspection's own frozen structure — the ONE way to read it.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 * Four consumers used to fall back to the LIVE `templates.schema` when an
 * inspection had no snapshot, each with its own spelling of the same check.
 * That made the snapshot a convention rather than a guarantee: the next row
 * that missed one silently re-acquired today's template structure and nothing
 * failed. It is the `trade_slug` shape — the mechanism was correct and nothing
 * stopped it being bypassed. A report re-derived that way is not the report the
 * inspector filled in, and there is no signal that it happened.
 *
 * ─── The two ways callers use it, and why they differ ───────────────────────
 * ⚠️ Four callers, two behaviours. Do NOT make them uniform without re-reading
 * this: they are answering different questions.
 *
 *   THROW — `requireTemplateSnapshot`
 *     `inspection-report.service.ts` and `inspection-publish.service.ts`.
 *     They answer "what does this report contain" and "may it be published".
 *     A wrong answer there reaches a client, so a missing snapshot is a 500
 *     (`Errors.Internal`, server/lib/errors.ts) rather than a plausible
 *     document nobody can vouch for. Not a 404 and not a 409: the caller did
 *     nothing wrong, an invariant of ours was violated. The report page's error
 *     boundary shows the failure and the structured log carries the id.
 *
 *   LOG AND DEGRADE — `templateSnapshotSectionsOrNone`
 *     `inspection-photo.service.ts` and the admin bulk-import path. Both build
 *     an item-id → label map and already degrade to using the item id as its
 *     own label. Making them throw would turn a cosmetic degradation into a
 *     broken drawer. Silence is what is forbidden here, not the degradation —
 *     so they log and STOP reading the live template.
 *
 * See #307.
 */
function parseSnapshot(raw: unknown): { sections: unknown[] } | null {
    if (!raw) return null;
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const sections = (parsed as { sections?: unknown }).sections;
    // ⚠️ `Array.isArray`, NOT `length > 0`.
    //
    // All four sites tested for a NON-EMPTY sections array, but they were
    // asking "is there anything worth preferring over the live template" — and
    // when both were empty the answer was the same either way, so the
    // distinction never showed. As a REQUIRED check it does show, and
    // length-based presence is wrong: `{ sections: [] }` is what an inspection
    // filled against the blank starter template ("My Inspection Template
    // (Blank)", created by first-run setup in every standalone install)
    // faithfully records. That is a real, correct snapshot of an empty
    // structure, not a missing one, and condemning it would 500 the hub page
    // of a freshly-installed deployment.
    if (!Array.isArray(sections)) return null;
    return parsed as { sections: unknown[] };
}

/**
 * The inspection's own frozen structure, or a loud failure. See the note above.
 *
 * ⚠️ `templateId` is load-bearing, and the two absences it separates are NOT
 * the same fault:
 *
 *   templateId SET, snapshot missing → the row NAMES a template whose structure
 *     it no longer carries. That is the invariant violation this exists to
 *     surface, and the only state the live-template fallback used to paper
 *     over. It throws.
 *
 *   templateId NULL, snapshot missing → the inspection was never built from a
 *     template. There is no lost structure to mourn and nothing to re-acquire;
 *     the fallback never fired for these rows either, because there was no
 *     template row to fall back TO. Throwing here would turn a legitimate
 *     template-less inspection into a 500 on its own report page, which is a
 *     regression rather than a guarantee. It logs and yields no sections,
 *     which is byte-identical to what the old code produced.
 */
export function requireTemplateSnapshot(
    inspection: { id: string; templateId?: string | null; templateSnapshot?: unknown },
    tenantId: string,
): TemplateSchemaV2 {
    const snapshot = parseSnapshot(inspection.templateSnapshot);
    if (snapshot) return snapshot as unknown as TemplateSchemaV2;

    if (inspection.templateId) {
        logger.error('inspection names a template but carries no template snapshot', {
            inspectionId: inspection.id,
            templateId:   inspection.templateId,
            tenantId,
        });
        throw Errors.Internal('This inspection has no template snapshot, so its report structure cannot be resolved.');
    }

    logger.warn('inspection has neither a template nor a snapshot; report has no sections', {
        inspectionId: inspection.id,
        tenantId,
    });
    return { schemaVersion: 2, sections: [] } as unknown as TemplateSchemaV2;
}

/**
 * The snapshot's sections for a label map, or an empty list plus a logged
 * error. Never reads the live template. See the note above for which callers
 * take this and why.
 */
export function templateSnapshotSectionsOrNone<T>(
    inspection: { id: string; templateId?: string | null; templateSnapshot?: unknown },
    tenantId: string,
): T[] {
    const snapshot = parseSnapshot(inspection.templateSnapshot);
    if (snapshot) return snapshot.sections as T[];

    // Same two-absence split as requireTemplateSnapshot, at a lower volume: a
    // row naming a template it cannot honour is an error, a template-less
    // inspection having no sections is simply true.
    if (inspection.templateId) {
        logger.error('inspection names a template but carries no template snapshot; labels degrade to item ids', {
            inspectionId: inspection.id,
            templateId:   inspection.templateId,
            tenantId,
        });
    }
    return [];
}

/**
 * Media Studio (cover crop) — resolves the cover image URL, preferring the
 * baked cropped derivative (`coverImageKey`) over the uncropped source
 * (`coverPhotoId`). Returns null when neither is set.
 */
export function resolveCoverUrl(
  ins: { coverImageKey?: string | null; coverPhotoId?: string | null },
  makePhotoUrl: (key: string) => string,
): string | null {
  const key = ins.coverImageKey ?? ins.coverPhotoId;
  return key ? makePhotoUrl(key) : null;
}

/** Slug → label map for resolving aggregated recommendation badges in
 *  getReportData. Built once at module load. */
export const RECOMMENDATION_CATEGORY_LABELS = new Map<string, string>(
    RECOMMENDATION_CATEGORIES.map(c => [c.id, c.label]),
);

/**
 * Sprint 2 S2-3 — sanitize the per-defect fields on every inspection-results
 * write. Mutates the supplied `data` record in place.
 *
 *   - `recommendationId` must be one of {@link RECOMMENDATION_CATEGORY_IDS};
 *     unknown slugs are dropped (set to null) so an outdated client doesn't
 *     poison the JSON payload.
 *   - repair-price keys are removed outright, on the item entry and on every
 *     defect row, canned or custom (`server/lib/repair-price-keys.ts`).
 *
 * The price keys are DELETED, not normalized. Normalizing one is the sanitizer
 * saying the key belongs here and only its value was wrong — the shape of an
 * accepted capability — and there is no legal repair price to normalize toward.
 *
 * The sanitizer is intentionally lossy + per-row: a single malformed defect
 * does not reject the whole patch. Rejecting the write outright was considered
 * and refused — the entry also carries the rating, the notes and the photos,
 * and an offline client replaying a queued payload that still holds a stale
 * price would lose the inspector's whole entry over a field no screen offers.
 * The surface that DOES have a request boundary (the template write) rejects
 * loudly instead; see `server/lib/validations/template.schema.ts`.
 */
export function sanitizeDefectStates(data: Record<string, unknown>): void {
    const validSlugs = new Set<string>(RECOMMENDATION_CATEGORY_IDS);
    for (const key of Object.keys(data)) {
        const entry = data[key] as {
            tabs?: { defects?: unknown };
            customComments?: { defects?: unknown };
        } | null | undefined;
        if (!entry || typeof entry !== 'object') continue;
        // Item-level estimate — no defect tab required to reach it.
        deleteRepairPriceKeys(entry);
        // A field-authored custom defect is a defect row too, and the repair
        // list read it by the same key names.
        const customDefects = entry.customComments?.defects;
        if (Array.isArray(customDefects)) {
            for (const c of customDefects as Array<Record<string, unknown>>) {
                if (!c || typeof c !== 'object') continue;
                deleteRepairPriceKeys(c);
            }
        }
        const defects = entry.tabs?.defects;
        if (!Array.isArray(defects)) continue;
        for (const d of defects as Array<Record<string, unknown>>) {
            if (!d || typeof d !== 'object') continue;
            // recommendationId — string slug or null
            if ('recommendationId' in d) {
                const v = d.recommendationId;
                d.recommendationId = (typeof v === 'string' && validSlugs.has(v)) ? v : null;
            }
            deleteRepairPriceKeys(d);
            // trade / deadline / timeframe — enum or null (drop unknown values)
            if ('trade' in d) {
                d.trade = isDefectTrade(d.trade) ? d.trade : null;
            }
            if ('deadline' in d) {
                d.deadline = isDefectDeadline(d.deadline) ? d.deadline : null;
            }
            if ('timeframe' in d) {
                d.timeframe = isDefectTimeframe(d.timeframe) ? d.timeframe : null;
            }
        }
    }
}

/**
 * Returns the trigger Promise so callers can keep the worker isolate alive
 * via `c.executionCtx.waitUntil(...)`. The previous fire-and-forget version
 * dangled the promise — CF Workers terminated the isolate after the
 * response was sent, so AutomationService.trigger never inserted the
 * automation_logs row, and report.published / inspection.confirmed /
 * inspection.cancelled / inspection.created automations never fired.
 */
export function fireAutomation(
    db: D1Database, tenantId: string, inspectionId: string, event: string, reportId?: string,
): Promise<void> {
    return new AutomationService(db)
        .trigger({
            tenantId, inspectionId, triggerEvent: event, companyName: '', reportBaseUrl: '',
            // Which DELIVERABLE this is about. `report.published` dedups on a
            // synthetic per-event key, and an inspection-only key collapses the
            // radon report's first publish into the standard report's — for
            // ever, not for a window.
            ...(reportId ? { reportId } : {}),
        })
        .catch(err => logger.error('automation trigger failed', { event }, err instanceof Error ? err : undefined));
}

/**
 * Which report trigger a publish should fire. The first publish of an
 * inspection is `report.published`; any later re-publish (a prior
 * report_versions row already exists) is `report.amended`, so amendment
 * notifications get their own template + change summary instead of looking
 * like a duplicate "report ready" mail. Called BEFORE the new snapshot row is
 * written, so "a prior row exists" == "this publish produces version ≥ 2".
 */
export async function resolvePublishTrigger(
    db: D1Database,
    tenantId: string,
    inspectionId: string,
    reportId?: string,
): Promise<'report.published' | 'report.amended'> {
    // "A prior version exists" is a question about THIS deliverable. Asked of
    // the whole inspection, the radon report's first publish reads as an
    // amendment because the standard report was published on Tuesday — and the
    // client gets a "your report was updated" notice about a document they have
    // never seen.
    const prior = await drizzle(db)
        .select({ id: reportVersions.id })
        .from(reportVersions)
        .where(and(
            eq(reportVersions.tenantId, tenantId),
            reportId
                ? eq(reportVersions.reportId, reportId)
                : eq(reportVersions.inspectionId, inspectionId),
        ))
        .limit(1)
        .get();
    return prior ? 'report.amended' : 'report.published';
}

// mapRatingSystemLevels moved to ../lib/map-rating-levels (B-18: pure +
// unit-tested so the pausesAdvance passthrough can't silently regress).

/**
 * Resolve a defect-state row into the variables consumed by the Mustache
 * renderer when substituting tokens like `{{location}}` / `{{trade}}` in
 * canned-comment prose. Falls back to the template's default `location`
 * when the inspector hasn't filled an inspection-specific override.
 */
function stringifyAttributeValue(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v.length > 0 ? v : null;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return null;
}

export function resolveDefectMustacheVars(
    st: DefectCommentState | undefined,
    d: CannedDefect,
    itemAttributes?: Record<string, unknown>,
): Record<string, string | null> {
    const location = (typeof st?.location === 'string' && st.location.length > 0)
        ? st.location
        : (d.location || null);
    const vars: Record<string, string | null> = {
        location,
        trade:     st?.trade     ? DEFECT_TRADE_LABELS[st.trade]         : null,
        deadline:  st?.deadline  ? DEFECT_DEADLINE_LABELS[st.deadline]   : null,
        timeframe: st?.timeframe ? DEFECT_TIMEFRAME_LABELS[st.timeframe] : null,
    };
    if (itemAttributes) {
        for (const [k, v] of Object.entries(itemAttributes)) {
            if (k in vars) continue; // defect-level vars take precedence
            vars[k] = stringifyAttributeValue(v);
        }
    }
    return vars;
}

interface PublishBlockingDefect {
    sectionId:        string;
    sectionTitle:     string;
    itemId:           string;
    itemLabel:        string;
    cannedId:         string;
    cannedTitle:      string;
    missing:          Array<'location' | 'trade'>;
    unresolvedTokens: string[];
}

/** Track H (IA-7 / P-6②) — which defect fields the publish gate REQUIRES.
 *  Resolved as inspection override ?? tenant default ?? 'none' (loose). */
export type RequireDefectFields = 'none' | 'location' | 'trade' | 'both';

/** Pure resolution of the two-level config — override (NULL = inherit)
 *  beats the tenant default; both unset → 'none' (loose). */
export function resolveRequireDefectFields(
    override: RequireDefectFields | null | undefined,
    tenantDefault: RequireDefectFields | null | undefined,
): RequireDefectFields {
    return override ?? tenantDefault ?? 'none';
}

export interface PublishReadiness {
    ready: boolean;
    blockingDefects: PublishBlockingDefect[];
    /** Track H (IA-7) — incomplete-but-not-required defects: surfaced as a
     *  yellow warning on the publish gate, never a block. */
    warningDefects: PublishBlockingDefect[];
}

/**
 * Task 12 — pure function: walks the template schema + inspection results
 * and returns the set of included defects that are missing fields
 * (location and/or trade) or have unresolved Mustache tokens.
 *
 * Track H (IA-7 / P-6②): which missing fields BLOCK is now configurable.
 *   - A field in `requirement` missing → the defect blocks publish.
 *   - A field missing but NOT required → the defect lands in warningDefects.
 *   - Unresolved tokens ALWAYS block: the canned prose references a variable
 *     ({{location}}, {{brand}}, …) that would render as a literal gap in the
 *     report — that's broken content, not a policy choice.
 * The parameter defaults to 'both' (the legacy behavior) so existing pure
 * callers are unaffected; the SERVICE resolves the tenant/inspection config.
 */
export function computePublishReadinessFromState(
    schema: TemplateSchemaV2,
    results: Record<string, unknown>,
    requirement: RequireDefectFields = 'both',
): PublishReadiness {
    const requireLocation = requirement === 'location' || requirement === 'both';
    const requireTrade = requirement === 'trade' || requirement === 'both';
    const blocking: PublishBlockingDefect[] = [];
    const warnings: PublishBlockingDefect[] = [];
    for (const section of schema.sections ?? []) {
        for (const item of section.items ?? []) {
            if (item.type !== 'rich') continue;
            const defectsTpl = item.tabs?.defects ?? [];
            const entry = results[item.id] as { tabs?: { defects?: DefectCommentState[] }; attributes?: Record<string, unknown> } | undefined;
            const stateRows = entry?.tabs?.defects ?? [];
            const stateById = new Map(stateRows.map(d => [d.cannedId, d]));
            const itemAttrVars: Record<string, string | null> = {};
            if (entry?.attributes) {
                for (const [k, v] of Object.entries(entry.attributes)) {
                    itemAttrVars[k] = stringifyAttributeValue(v);
                }
            }
            for (const d of defectsTpl) {
                const st = stateById.get(d.id);
                const included = st ? !!st.included : !!d.default;
                if (!included) continue;
                const missing: Array<'location' | 'trade'> = [];
                const hasLocation = (typeof st?.location === 'string' && st.location.length > 0)
                    || (typeof d.location === 'string' && d.location.length > 0);
                if (!hasLocation) missing.push('location');
                if (!st?.trade) missing.push('trade');
                const effectiveComment = (st?.comment && st.comment.length > 0) ? st.comment : d.comment;
                const unresolved = listUnresolved(effectiveComment, {
                    location:  hasLocation ? 'x' : null,
                    trade:     st?.trade     ?? null,
                    deadline:  st?.deadline  ?? null,
                    timeframe: st?.timeframe ?? null,
                    ...itemAttrVars,
                });
                if (missing.length === 0 && unresolved.length === 0) continue;
                const requiredMissing = missing.filter(f =>
                    (f === 'location' && requireLocation) || (f === 'trade' && requireTrade));
                const target = (requiredMissing.length > 0 || unresolved.length > 0) ? blocking : warnings;
                target.push({
                    sectionId:        section.id,
                    sectionTitle:     section.title,
                    itemId:           item.id,
                    itemLabel:        item.label,
                    cannedId:         d.id,
                    cannedTitle:      d.title,
                    missing,
                    unresolvedTokens: unresolved,
                });
            }
        }
    }
    return { ready: blocking.length === 0, blockingDefects: blocking, warningDefects: warnings };
}

export type Inspection = z.infer<typeof InspectionSchema>;
export type InspectionListParams = z.infer<typeof InspectionListQuerySchema>;
export type CreateInspectionData = z.infer<typeof CreateInspectionSchema>;

/** Round-2 backlog G1 — Property Facts strip payload. Mirrors the canonical
 *  Zod shape declared in inspection.schema.ts (PropertyFactsSchema). */
export type PropertyFactFoundation = 'basement' | 'slab' | 'crawlspace' | 'other';
export interface PropertyFacts {
    yearBuilt:      number | null;
    sqft:           number | null;
    foundationType: PropertyFactFoundation | null;
    lotSize:        string | null;
    bedrooms:       number | null;
    bathrooms:      number | null;
}

// -----------------------------------------------------------------------
// Sprint 1 Sub-spec A Task 5 — ITEM-aware Quick Comments ranking helper.
//
// Scores a list of canned comments against the active item label so that
// the QUICK COMMENTS panel surfaces the most relevant entries first.
// Pure function (no DB) — exported for unit-test isolation; the API caller
// is expected to fetch the section's comments first, then rank in memory.
// -----------------------------------------------------------------------

type CannedSeverity = Severity | null;

export interface CannedCommentLike {
    id:         string;
    text:       string;
    section?:   string | null;
    category?:  string | null;
    severity?:  CannedSeverity;
}

export interface RankCommentsOpts {
    section:    string;
    itemLabel:  string;
    severity?:  Severity;
    limit?:     number;
}

function tokenize(input: string): string[] {
    return (input || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(t => t.length >= 3);
}

function scoreCanned(c: CannedCommentLike, opts: RankCommentsOpts): number {
    const lcItem = (opts.itemLabel || '').toLowerCase().trim();
    const itemTokens = tokenize(opts.itemLabel);
    const lcCategory = (c.category || '').toLowerCase();
    const lcText = (c.text || '').toLowerCase();
    const lcSection = (c.section || '').toLowerCase();

    let s = 0;
    // Strongest signal: category exactly matches the item label.
    if (lcCategory && lcCategory === lcItem) s += 100;
    // Substring overlap (either direction) — handles "Gutters" vs "Gutters & Downspouts".
    else if (lcCategory && (lcCategory.includes(lcItem) || lcItem.includes(lcCategory))) s += 60;
    // Comment text contains all item tokens (length >= 3 each).
    if (itemTokens.length > 0) {
        const hits = itemTokens.filter(t => lcText.includes(t) || lcCategory.includes(t)).length;
        if (hits === itemTokens.length) s += 40;
        else if (hits > 0) s += 20 * (hits / itemTokens.length);
    }
    // Section match.
    if (lcSection && lcSection === opts.section.toLowerCase()) s += 10;
    // Severity boost when caller knows the active item's severity.
    if (opts.severity && c.severity === opts.severity) s += 5;
    return s;
}

export function rankCannedCommentsForItem<T extends CannedCommentLike>(
    comments: T[],
    opts: RankCommentsOpts,
): T[] {
    if (!Array.isArray(comments) || comments.length === 0) return [];
    const scored = comments.map((c, idx) => ({ c, s: scoreCanned(c, opts), idx }));
    // Stable sort: higher score first, then preserve original order for ties.
    scored.sort((a, b) => (b.s - a.s) || (a.idx - b.idx));
    const out = scored.map(x => x.c);
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
}
