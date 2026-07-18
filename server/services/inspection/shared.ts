// Shared module-level types, constants, and pure helpers for the inspection
// service family. Extracted verbatim from the former monolithic
// inspection.service.ts so the facade + every sub-service import a single
// source of truth (fixes the prior drift risk where these helpers were
// duplicated). Behavior-preserving: bodies are byte-identical moves.

import { z } from 'zod';
import { AutomationService } from '../automation.service';
import { logger } from '../../lib/logger';
import { RECOMMENDATION_CATEGORIES, RECOMMENDATION_CATEGORY_IDS } from '../../lib/recommendation-categories';
import { isDefectTrade, isDefectDeadline, isDefectTimeframe, DEFECT_TRADE_LABELS, DEFECT_DEADLINE_LABELS, DEFECT_TIMEFRAME_LABELS } from '../../types/defect-fields';
import { listUnresolved } from '../../lib/mustache';
import { InspectionSchema, InspectionListQuerySchema, CreateInspectionSchema } from '../../lib/validations/inspection.schema';
import type { Severity } from '../../lib/validations/rating-system.schema';
import type { DefectCommentState } from '../../types/inspection-item-state';
import type { CannedDefect, TemplateSchemaV2 } from '../../types/template-schema';

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
 * Sprint 2 S2-3 / S2-4 — sanitize the new per-defect fields on every
 * inspection-results write. Mutates the supplied `data` record in place.
 *
 *   - `recommendationId` must be one of {@link RECOMMENDATION_CATEGORY_IDS};
 *     unknown slugs are dropped (set to null) so an outdated client doesn't
 *     poison the JSON payload.
 *   - `estimateLow` / `estimateHigh` must be non-negative finite integers
 *     (cents). Anything else collapses to null.
 *
 * The sanitizer is intentionally lossy + per-row: a single malformed defect
 * does not reject the whole patch. Mirrors the canned-comment + photo merge
 * strategy used elsewhere in updateResults().
 */
export function sanitizeDefectStates(data: Record<string, unknown>): void {
    const validSlugs = new Set<string>(RECOMMENDATION_CATEGORY_IDS);
    for (const key of Object.keys(data)) {
        const entry = data[key] as { tabs?: { defects?: unknown } } | null | undefined;
        if (!entry || typeof entry !== 'object') continue;
        const defects = entry.tabs?.defects;
        if (!Array.isArray(defects)) continue;
        for (const d of defects as Array<Record<string, unknown>>) {
            if (!d || typeof d !== 'object') continue;
            // recommendationId — string slug or null
            if ('recommendationId' in d) {
                const v = d.recommendationId;
                d.recommendationId = (typeof v === 'string' && validSlugs.has(v)) ? v : null;
            }
            // estimateLow / estimateHigh — non-negative integers (cents) or null
            for (const side of ['estimateLow', 'estimateHigh'] as const) {
                if (side in d) {
                    const v = d[side];
                    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
                        d[side] = Math.round(v);
                    } else {
                        d[side] = null;
                    }
                }
            }
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
export function fireAutomation(db: D1Database, tenantId: string, inspectionId: string, event: string): Promise<void> {
    return new AutomationService(db)
        .trigger({ tenantId, inspectionId, triggerEvent: event, companyName: '', reportBaseUrl: '' })
        .catch(err => logger.error('automation trigger failed', { event }, err instanceof Error ? err : undefined));
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
