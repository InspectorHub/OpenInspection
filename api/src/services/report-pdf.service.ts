import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { reportPdfs, tenantConfigs } from '../lib/db/schema';
import type { ReportPdf } from '../lib/db/schema';
import { generatePdfFromUrl } from '../lib/pdf';
import { Errors } from '../lib/errors';

export type ReportPdfType = 'summary' | 'full';
export type ReportPdfStatus = 'queued' | 'rendering' | 'ready' | 'failed';

/**
 * Spec 5A — Report PDF Pipeline.
 *
 * Wraps the existing src/lib/pdf.ts:generatePdfFromUrl primitive with:
 * - R2 persistence (REPORTS bucket — see wrangler.toml)
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
        private browser: Fetcher | undefined,        // BROWSER binding (optional — falls back to text-only email)
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
            .get();
        return row ?? null;
    }

    /**
     * Render a PDF + persist to R2 + write D1 row. Idempotent on (inspectionId, type)
     * via the unique index — re-rendering replaces the existing row.
     *
     * Throws if BROWSER or R2 binding is absent (callers must check or accept failure).
     */
    async renderAndStore(
        inspectionId: string,
        tenantId: string,
        type: ReportPdfType,
        opts: { reportUrl: string; sourceVersion: number },
    ): Promise<ReportPdf> {
        if (!this.browser) throw Errors.BadRequest('PDF rendering unavailable: BROWSER binding not configured');
        if (!this.r2) throw Errors.BadRequest('PDF storage unavailable: REPORTS bucket binding not configured');

        // type=summary appends &summary=1 so the report template can render
        // a condensed view (defects + safety only). Implementation wired in
        // task 5A.4 (print-mode CSS).
        const renderUrl = type === 'summary'
            ? (opts.reportUrl.includes('?') ? `${opts.reportUrl}&summary=1` : `${opts.reportUrl}?summary=1`)
            : opts.reportUrl;

        const pdfBuffer = await generatePdfFromUrl(this.browser, renderUrl);
        const r2Key = `${tenantId}/${inspectionId}/${type}.pdf`;
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
        };

        // INSERT OR REPLACE via Drizzle: delete then insert (cheap; row count is small).
        // The unique index on (inspection_id, type) makes this safe.
        const db = this.getDrizzle();
        await db.delete(reportPdfs).where(and(
            eq(reportPdfs.inspectionId, inspectionId),
            eq(reportPdfs.tenantId, tenantId),
            eq(reportPdfs.type, type),
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
        if (!this.r2) throw Errors.BadRequest('PDF storage unavailable: REPORTS bucket binding not configured');
        if (record.status !== 'ready') {
            throw Errors.BadRequest(`PDF not ready (status=${record.status})`);
        }
        const obj = await this.r2.get(record.r2Key);
        return obj;
    }

    /**
     * Mark a record as queued for re-render. Used by POST /api/reports/:id/pdf/refresh
     * before kicking off the render workflow.
     */
    async markQueued(inspectionId: string, tenantId: string, type: ReportPdfType): Promise<void> {
        const db = this.getDrizzle();
        const existing = await this.getPdfRecord(inspectionId, tenantId, type);
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
        });
    }
}
