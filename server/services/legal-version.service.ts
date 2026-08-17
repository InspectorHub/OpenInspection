import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from '../lib/db/schema';
import { tenantLegalVersions, tenantConfigs } from '../lib/db/schema';
import { sha256Hex } from './signing-key.service';
import { epochMsToWallClockYmd, resolveTenantTimeZone } from '../lib/tz';

export type LegalDoc = 'privacy' | 'terms';

export interface LegalVersionRow {
    version: string;
    publishedAt: Date;
    contentHash: string;
    isMaterial: boolean;
    bodySnapshot: string | null;
}

/**
 * Versioning for a tenant's own Privacy Policy and Terms (design §6A.3).
 *
 * The whole point is that a row can PRODUCE the text it describes, so
 * `recordPublish` snapshots the body rather than hashing it and moving on —
 * see the schema comment for why the platform's own registry can get away with
 * hashing and this one cannot.
 */
export class LegalVersionService {
    constructor(private readonly db: DrizzleD1Database<typeof schema>) {}

    /**
     * Record a publish, unless nothing was published.
     *
     * A tenant saving unrelated settings, or re-saving the same prose, must not
     * mint a version — a registry that grows a row per form submission stops
     * meaning "the document changed" on its first busy afternoon. So the
     * content hash is compared against the latest row and an unchanged body is
     * a no-op that returns the existing version.
     *
     * Returns the version string now in force, or null when the write failed.
     */
    async recordPublish(input: {
        tenantId: string;
        doc: LegalDoc;
        body: string | null;
        /** Test seam only — production resolves it from the tenant's config. */
        timezone?: string | null;
        userId?: string | null;
        isMaterial?: boolean;
        now?: number;
    }): Promise<string | null> {
        const body = input.body?.trim() ? input.body : null;
        const contentHash = await sha256Hex(body ?? '');

        const latest = await this.latest(input.tenantId, input.doc);
        if (latest && latest.contentHash === contentHash) return latest.version;

        const at = input.now ?? Date.now();
        // The date a reader is shown must be the TENANT's date, so the service
        // resolves it rather than trusting a caller to pass one. `2026-08-01` in
        // UTC is still 2026-07-31 across the Americas for most of the day, and a
        // "last updated" that is a day ahead of the company's own calendar is
        // the kind of wrong that only ever shows up in a complaint.
        const timezone = input.timezone ?? await this.tenantTimezone(input.tenantId);
        const version = epochMsToWallClockYmd(at, resolveTenantTimeZone(timezone));

        // Same-day republish REPLACES rather than appending: the row that
        // survives a date is the text that was in force when that date closed,
        // which is the only one anything downstream could have relied on. The
        // unique index is what makes that true rather than a convention.
        await this.db.insert(tenantLegalVersions).values({
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            doc: input.doc,
            version,
            bodySnapshot: body,
            contentHash,
            isMaterial: input.isMaterial ?? false,
            publishedAt: new Date(at),
            publishedByUserId: input.userId ?? null,
        }).onConflictDoUpdate({
            target: [tenantLegalVersions.tenantId, tenantLegalVersions.doc, tenantLegalVersions.version],
            set: {
                bodySnapshot: body,
                contentHash,
                isMaterial: input.isMaterial ?? false,
                publishedAt: new Date(at),
                publishedByUserId: input.userId ?? null,
            },
        });
        return version;
    }

    private async tenantTimezone(tenantId: string): Promise<string | null> {
        const row = await this.db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return row?.defaultTimezone ?? null;
    }

    /** The version currently in force, or null when this doc was never published. */
    async latest(tenantId: string, doc: LegalDoc): Promise<LegalVersionRow | null> {
        const row = await this.db.select({
            version: tenantLegalVersions.version,
            publishedAt: tenantLegalVersions.publishedAt,
            contentHash: tenantLegalVersions.contentHash,
            isMaterial: tenantLegalVersions.isMaterial,
            bodySnapshot: tenantLegalVersions.bodySnapshot,
        })
            .from(tenantLegalVersions)
            .where(and(
                eq(tenantLegalVersions.tenantId, tenantId),
                eq(tenantLegalVersions.doc, doc),
            ))
            .orderBy(desc(tenantLegalVersions.publishedAt))
            .limit(1)
            .get();
        return row ?? null;
    }

    /** Every version of one document, newest first. */
    async list(tenantId: string, doc: LegalDoc): Promise<LegalVersionRow[]> {
        return this.db.select({
            version: tenantLegalVersions.version,
            publishedAt: tenantLegalVersions.publishedAt,
            contentHash: tenantLegalVersions.contentHash,
            isMaterial: tenantLegalVersions.isMaterial,
            bodySnapshot: tenantLegalVersions.bodySnapshot,
        })
            .from(tenantLegalVersions)
            .where(and(
                eq(tenantLegalVersions.tenantId, tenantId),
                eq(tenantLegalVersions.doc, doc),
            ))
            .orderBy(desc(tenantLegalVersions.publishedAt))
            .all();
    }
}
