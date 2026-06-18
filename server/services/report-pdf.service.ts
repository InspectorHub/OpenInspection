import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { reportPdfs, tenantConfigs } from '../lib/db/schema';
import type { ReportPdf } from '../lib/db/schema';
import { generatePdfFromUrl } from '../lib/pdf';
import { Errors } from '../lib/errors';
import type { BrowserRun } from '../types/hono';
import type { PdfSettings } from '../lib/pdf-settings';

/**
 * Layer ③ — running header/footer inputs threaded from the caller into the
 * Browser Rendering /pdf quick action. All fields optional; when absent the
 * footer falls back to defaults (footer on, no license, empty address).
 */
export interface ReportPdfFooterOpts {
    settings?: PdfSettings;
    address?: string;
    license?: string | null;
}

export type ReportPdfType = 'summary' | 'full';
export type ReportPdfStatus = 'queued' | 'rendering' | 'ready' | 'failed';

/**
 * Spec 5A — Report PDF Pipeline.
 *
 * Wraps the existing server/lib/pdf.ts:generatePdfFromUrl primitive with:
 * - R2 persistence (REPORTS bucket — see wrangler.jsonc)
 * - Summary vs Full Report distinction
 * - D1 metadata tracking with stale detection (source_version vs inspection.updatedAt)
 * - Manual Refresh API
 * - Signed URL generation for client downloads
 *
 * Renderer is reused as-is — this service is the orchestration + storage layer.
 *
 * Subsequent tasks (5A.3+) wire:
 * - /internal/render endpoint with HMAC token (renderer source URL)
 * - /api/reports/:id/pdf?type=summary|full (client download endpoint)
 * - POST /api/reports/:id/pdf/refresh (re-render trigger)
 * - publishInspection() integration to enqueue both PDFs at publish time
 */
export class ReportPdfService {
    constructor(
        private db: D1Database,
        private browser: BrowserRun | undefined,     // BROWSER binding (optional — falls back to text-only email)
        private r2: R2Bucket | undefined,            // REPORTS bucket binding (optional during local dev)
    ) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    /**
     * Migration 0059 — gate the Browser-Rendering pipeline behind a tenant
     * opt-in toggle so Workers Free hosters don't burn isolate seconds on
     * a binding that always 404s, and Paid tenants pay only when they
     * deliberately want pre-rendered PDFs (vs the always-free
     * window.print() the public viewer ships with).
     */
    async isPipelineEnabled(tenantId: string): Promise<boolean> {
        const db = this.getDrizzle();
        const row = await db.select({ enabled: tenantConfigs.enablePdfPipeline })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return row?.enabled === true;
    }

    /**
     * Look up an existing PDF record. Returns null if never rendered.
     * Caller checks .status to decide whether to wait, fail, or serve stale.
     */
    async getPdfRecord(inspectionId: string, tenantId: string, type: ReportPdfType): Promise<ReportPdf | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(reportPdfs)
            .where(and(
                eq(reportPdfs.inspectionId, inspectionId),
                eq(reportPdfs.tenantId, tenantId),
                eq(reportPdfs.type, type),
            ))
            .orderBy(desc(reportPdfs.versionNumber))
            .get();
        return row ?? null;
    }

    /**
     * Render a PDF + persist to R2 + write D1 row. Idempotent on (inspectionId, type)
     * via the unique index — re-rendering replaces the existing row.
     *
     * When `contentHash` is provided the PDF is stored at a content-addressed R2
     * key (`…/${type}-${contentHash}.pdf`) so different versions with identical
     * rendered output share the same object in R2. The legacy versioned/draft keys
     * are used when contentHash is absent, preserving backward compatibility.
     *
     * Throws if BROWSER or R2 binding is absent (callers must check or accept failure).
     */
    async renderAndStore(
        inspectionId: string,
        tenantId: string,
        type: ReportPdfType,
        opts: { reportUrl: string; sourceVersion: number; versionNumber?: number | null; contentHash?: string; footer?: ReportPdfFooterOpts },
    ): Promise<ReportPdf> {
        if (!this.browser) throw Errors.BadRequest('PDF rendering unavailable: BROWSER binding not configured');
        if (!this.r2) throw Errors.BadRequest('PDF storage unavailable: storage bucket binding not configured');

        // type=summary appends &summary=1 so the report template can render
        // a condensed view (defects + safety only). Implementation wired in
        // task 5A.4 (print-mode CSS).
        const renderUrl = type === 'summary'
            ? (opts.reportUrl.includes('?') ? `${opts.reportUrl}&summary=1` : `${opts.reportUrl}?summary=1`)
            : opts.reportUrl;

        // ReportPdfFooterOpts is structurally identical to the generatePdfFromUrl
        // opts (settings/address/license, all optional) — forward it directly.
        const pdfBuffer = await generatePdfFromUrl(this.browser, renderUrl, opts.footer);

        // Content-addressed key when a hash is available; legacy key for back-compat.
        const r2Key = opts.contentHash != null
            ? `${tenantId}/${inspectionId}/reports/${type}-${opts.contentHash}.pdf`
            : opts.versionNumber != null
                ? `${tenantId}/${inspectionId}/reports/v${opts.versionNumber}/${type}.pdf`
                : `${tenantId}/${inspectionId}/reports/${type}.pdf`;
        await this.r2.put(r2Key, pdfBuffer);

        const now = Date.now();
        const id = crypto.randomUUID();
        const row = {
            id,
            tenantId,
            inspectionId,
            type,
            r2Key,
            renderedAt: now,
            sourceVersion: opts.sourceVersion,
            sizeBytes: pdfBuffer.byteLength,
            status: 'ready' as ReportPdfStatus,
            error: null,
            versionNumber: opts.versionNumber ?? null,
            contentHash: opts.contentHash ?? null,
        };

        // INSERT OR REPLACE via Drizzle: delete then insert (cheap; row count is small).
        // The unique index on (inspection_id, type, version_number) makes this safe.
        const db = this.getDrizzle();
        await db.delete(reportPdfs).where(and(
            eq(reportPdfs.inspectionId, inspectionId),
            eq(reportPdfs.tenantId, tenantId),
            eq(reportPdfs.type, type),
            opts.versionNumber != null
                ? eq(reportPdfs.versionNumber, opts.versionNumber)
                : isNull(reportPdfs.versionNumber),
        ));
        await db.insert(reportPdfs).values(row);

        return row as ReportPdf;
    }

    /**
     * True when the rendered PDF predates the latest inspection edit.
     * Caller decides whether to serve-stale-then-refresh or block the download.
     */
    isStale(record: ReportPdf, currentInspectionVersion: number): boolean {
        return record.sourceVersion < currentInspectionVersion;
    }

    /**
     * Stream a PDF object from R2. Proxy pattern (mirrors PHOTOS bucket usage):
     * caller — typically GET /api/inspections/:id/pdf — returns the body as a
     * Response with the right Content-Type. Returning the R2ObjectBody (rather
     * than a presigned URL) avoids needing the S3-compatible API creds.
     *
     * Returns null when the object is missing in R2 (rare — shouldn't happen
     * if the D1 row says status='ready', but guard anyway).
     */
    async streamPdf(record: ReportPdf): Promise<R2ObjectBody | null> {
        if (!this.r2) throw Errors.BadRequest('PDF storage unavailable: storage bucket binding not configured');
        if (record.status !== 'ready') {
            throw Errors.BadRequest(`PDF not ready (status=${record.status})`);
        }
        const obj = await this.r2.get(record.r2Key);
        return obj;
    }

    /**
     * Look up an existing PDF record keyed by the exact versionNumber
     * (or the NULL-version draft row when versionNumber is null).
     */
    async getPdfRecordForVersion(
        inspectionId: string,
        tenantId: string,
        type: ReportPdfType,
        versionNumber: number | null,
    ): Promise<ReportPdf | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(reportPdfs).where(and(
            eq(reportPdfs.inspectionId, inspectionId),
            eq(reportPdfs.tenantId, tenantId),
            eq(reportPdfs.type, type),
            versionNumber != null
                ? eq(reportPdfs.versionNumber, versionNumber)
                : isNull(reportPdfs.versionNumber),
        )).get();
        return row ?? null;
    }

    /**
     * Look up a ready PDF row by content hash. Returns the first matching row
     * or null. Used by getOrRender to short-circuit Browser Rendering when
     * identical-content PDFs are already cached.
     */
    async getPdfRecordByContentHash(
        inspectionId: string,
        tenantId: string,
        type: ReportPdfType,
        contentHash: string,
    ): Promise<ReportPdf | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(reportPdfs).where(and(
            eq(reportPdfs.inspectionId, inspectionId),
            eq(reportPdfs.tenantId, tenantId),
            eq(reportPdfs.type, type),
            eq(reportPdfs.contentHash, contentHash),
            eq(reportPdfs.status, 'ready'),
        )).get();
        return row ?? null;
    }

    /**
     * On-demand content-hash cache-or-render.
     *
     * Cache decision is based on a SHA-256 hash of the render inputs
     * (inspection data + RENDER_VERSION salt) rather than version/dataVersion,
     * so a no-op edit that bumps dataVersion but leaves the visible report
     * unchanged reuses the existing PDF without a Browser Rendering round-trip.
     *
     * Cache HIT  → return existing ready row immediately (no render).
     * Cache MISS → renderAndStore with content-addressed R2 key, store hash.
     *
     * `versionNumber` is still forwarded to renderAndStore so the unique-index
     * delete-then-insert keeps rows keyed by version (archive integrity).
     */
    async getOrRender(
        inspectionId: string,
        tenantId: string,
        type: ReportPdfType,
        opts: { reportUrl: string; contentHash: string; versionNumber: number | null; footer?: ReportPdfFooterOpts },
    ): Promise<ReportPdf> {
        const cached = await this.getPdfRecordByContentHash(inspectionId, tenantId, type, opts.contentHash);
        if (cached) return cached;   // identical content already rendered — reuse, no Browser Rendering
        return this.renderAndStore(inspectionId, tenantId, type, {
            reportUrl: opts.reportUrl,
            sourceVersion: Date.now(),
            versionNumber: opts.versionNumber,
            contentHash: opts.contentHash,
            ...(opts.footer ? { footer: opts.footer } : {}),
        });
    }

    /**
     * Delete all transient (versionNumber=null) PDF rows for an inspection from
     * both R2 and D1. Called after publish so stale on-demand renders are evicted
     * and subsequent downloads render fresh current content.  Non-fatal: the
     * caller wraps this in try/catch and logs warnings on failure.
     */
    async purgeTransientPdfs(inspectionId: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        const rows = await db.select().from(reportPdfs).where(and(
            eq(reportPdfs.inspectionId, inspectionId),
            eq(reportPdfs.tenantId, tenantId),
            isNull(reportPdfs.versionNumber),
        )).all();
        for (const r of rows) {
            try { if (this.r2) await this.r2.delete(r.r2Key); } catch { /* non-fatal */ }
        }
        await db.delete(reportPdfs).where(and(
            eq(reportPdfs.inspectionId, inspectionId),
            eq(reportPdfs.tenantId, tenantId),
            isNull(reportPdfs.versionNumber),
        ));
    }

    /**
     * Mark a record as queued for re-render. Used by POST /api/reports/:id/pdf/refresh
     * before kicking off the render workflow. Version-scoped (#120): operates only
     * on the row matching the given versionNumber (or the legacy NULL-version row
     * when null) so re-publishing never mutates a different version's archived row.
     */
    async markQueued(inspectionId: string, tenantId: string, type: ReportPdfType, versionNumber: number | null = null): Promise<void> {
        const db = this.getDrizzle();
        const existing = await db.select().from(reportPdfs).where(and(
            eq(reportPdfs.inspectionId, inspectionId),
            eq(reportPdfs.tenantId, tenantId),
            eq(reportPdfs.type, type),
            versionNumber != null
                ? eq(reportPdfs.versionNumber, versionNumber)
                : isNull(reportPdfs.versionNumber),
        )).get();
        if (existing) {
            await db.update(reportPdfs)
                .set({ status: 'queued', error: null })
                .where(eq(reportPdfs.id, existing.id));
            return;
        }
        // First-time queue — create a placeholder row so the UI can poll status.
        await db.insert(reportPdfs).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId,
            type,
            r2Key: '',
            renderedAt: 0,
            sourceVersion: 0,
            sizeBytes: null,
            status: 'queued',
            error: null,
            versionNumber,
        });
    }
}
