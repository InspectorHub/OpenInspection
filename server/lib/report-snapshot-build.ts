/**
 * Building the snapshot a publish freezes, apart from the service that stores it: the size rule, the
 * commercial parts, and the once-per-request build the pre-publish checks share.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from './db/schema';
import { CostItemService } from '../services/cost-item.service';
import { ComplianceService } from '../services/compliance/pca-compliance.service';
import { resolveReportTier } from './report-tier';
import { MAX_SNAPSHOT_BYTES, snapshotByteLength } from './report-snapshot';
import type { Snapshot, SnapshotPresentation } from './version-diff';
import { DefectCategoryService } from '../services/inspection/defect-category.service';
import { resolveTenantTimeZone } from './tz';
import { logger } from './logger';

/** The snapshot of a publish is larger than one stored row may be. Not retryable: the report itself has to shrink. */
export class SnapshotTooLargeError extends Error {
    constructor(readonly bytes: number) {
        super(`This report is too large to publish: its frozen copy is ${(bytes / 1024 / 1024).toFixed(2)} MB and the limit is 1 MB. Remove photos, notes or units, then publish again.`);
        this.name = 'SnapshotTooLargeError';
    }
}

/** Throws `SnapshotTooLargeError` when the snapshot would not fit one stored row (D1 counts bytes, not characters). */
export function assertSnapshotSize(snapshotJson: string): void {
    const bytes = snapshotByteLength(snapshotJson);
    if (bytes > MAX_SNAPSHOT_BYTES) throw new SnapshotTooLargeError(bytes);
}

/** Runs a write once more after a failure, logging the first; a second failure is thrown. */
export async function retryOnce(write: () => PromiseLike<unknown>, ids: Record<string, unknown>): Promise<void> {
    try {
        await write();
    } catch (err) {
        logger.warn('report version insert failed, retrying once', { ...ids, error: err instanceof Error ? err.message : String(err) });
        await write();
    }
}

/**
 * Snapshots built for the checks before a publish, by key: the unchanged-publish comparison and the size check read the same state.
 *
 * A publish builds the snapshot twice and no fewer: once here, and again inside `snapshotOnPublish` AFTER the status
 * flip. The second cannot reuse the first: publishing writes the automatic inspector signature into the results and
 * changes the order's report status, and the stored copy has to contain both.
 */
export class CheckBuilds {
    private readonly builds = new Map<string, Promise<string>>();

    get(key: string, build: () => Promise<string>): Promise<string> {
        let built = this.builds.get(key);
        if (!built) {
            built = build();
            this.builds.set(key, built);
            built.catch(() => this.builds.delete(key));
        }
        return built;
    }
}

/**
 * What a commercial report reads from tables of their own: the cost line items (and the year its reserve
 * schedule counts from), the company's reserve assumptions and, for a full PCA report, the sign-offs,
 * questionnaire and document review. Gated on the report tier exactly as the report build gates its reads, so a
 * residential report pays for none of it and its snapshot gains nothing.
 */
export async function commercialSnapshotParts(
    d1: D1Database,
    encryptionSecret: string,
    previousSecrets: readonly string[],
    tenantId: string,
    inspectionId: string,
    ins: Record<string, unknown>,
): Promise<Pick<Snapshot, 'costItems' | 'costYear' | 'reserve' | 'compliance'>> {
    const tier = resolveReportTier({
        propertyType: (ins.propertyType as string | null) ?? null,
        storedTier: (ins.reportTier as 'light_commercial' | 'full_pca' | null) ?? null,
    });
    if (!tier) return {};
    const [costItems, cfg] = await Promise.all([
        new CostItemService(d1).listByInspection(inspectionId, tenantId),
        drizzle(d1).select({
            reserveScheduleEnabled: tenantConfigs.reserveScheduleEnabled,
            reserveTermYears: tenantConfigs.reserveTermYears,
            inflationRateBps: tenantConfigs.inflationRateBps,
        }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get(),
    ]);
    const parts: Pick<Snapshot, 'costItems' | 'costYear' | 'reserve' | 'compliance'> = {
        costItems: costItems as unknown as Array<Record<string, unknown>>,
        costYear: new Date().getFullYear(),
        // The defaults the live read uses when the company has no config row.
        reserve: {
            reserveScheduleEnabled: Boolean(cfg?.reserveScheduleEnabled),
            reserveTermYears: cfg?.reserveTermYears ?? 12,
            inflationRateBps: cfg?.inflationRateBps ?? null,
        },
    };
    if (tier === 'full_pca') {
        const c = await new ComplianceService(d1, encryptionSecret, previousSecrets).getCompliance(tenantId, inspectionId);
        // JSON round trip: a Date column is stored as text, and the reader revives the known date fields.
        //
        // The questionnaire is stored as its status and answers ONLY. Its row also carries `shareToken`, the
        // bearer credential of the no-login questionnaire form: a signed, immutable record is the wrong place for a
        // credential that must stay revocable, and the report reads nothing else of it. (No column read here is
        // encrypted at rest: the sign-off signature is public verification material, and the secret
        // `getCompliance` is constructed with is used only by the signing methods, never by this read.)
        parts.compliance = JSON.parse(JSON.stringify({
            reportSignoffs: c.reportSignoffs,
            psq: c.psq ? { status: c.psq.status, responses: c.psq.responses } : null,
            documentReview: c.documentReview,
        })) as NonNullable<Snapshot['compliance']>;
    }
    return parts;
}

/**
 * The company's presentation settings as they are at publish: the defect categories (colour, and whether each drives
 * the Summary) and the report time zone. Read the same way the live report reads them, so a pinned read and a live read
 * of an unchanged company agree. The repair-export switch is deliberately NOT here: it is an access switch and stays live.
 */
export async function presentationSnapshotPart(d1: D1Database, tenantId: string): Promise<SnapshotPresentation> {
    const [categories, cfg] = await Promise.all([
        new DefectCategoryService(d1).listOrDefaults(tenantId),
        drizzle(d1).select({ defaultTimezone: tenantConfigs.defaultTimezone }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get(),
    ]);
    return {
        defectCategories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color, drivesSummary: c.drivesSummary })),
        timeZone: resolveTenantTimeZone(cfg?.defaultTimezone),
    };
}
