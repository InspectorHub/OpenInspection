import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { reportExports } from '../lib/db/schema';
import type { ReportExport } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

export type ReportExportFormat = 'docx';
export type ReportExportStatus = 'queued' | 'building' | 'ready' | 'failed';

/**
 * Commercial PCA Phase W Task 4 — `report_exports` status-row CRUD + R2
 * stream. Mirrors ReportPdfService's storage pattern (D1 metadata + R2
 * proxy stream), scaled down to the async-only Word export lifecycle:
 * queued -> building -> ready|failed. The queue consumer (Phase W Task 5)
 * drives the state transitions; this service is the shared read/write layer
 * for both the consumer and the status/download routes.
 */
export class ReportExportService {
    constructor(
        private db: D1Database,
        private r2: R2Bucket | undefined,   // PHOTOS bucket binding (optional during local dev)
    ) {}

    private getDrizzle() { return drizzle(this.db); }

    /**
     * Insert a new `queued` export row. One row per export request — repeat
     * clicks create independent rows (no de-dup); the caller enqueues the
     * matching queue job with the returned id.
     */
    async create(tenantId: string, inspectionId: string, format: ReportExportFormat): Promise<{ id: string }> {
        const db = this.getDrizzle();
        const id = crypto.randomUUID();
        // timestamp_ms columns take a Date on write (drizzle's sqlite-core
        // integer/timestamp_ms mapper calls .getTime() — see
        // ComplianceService.signOff for the same convention).
        const now = new Date();
        await db.insert(reportExports).values({
            id,
            tenantId,
            inspectionId,
            format,
            status: 'queued',
            r2Key: null,
            sizeBytes: null,
            error: null,
            createdAt: now,
            updatedAt: now,
        });
        return { id };
    }

    /** Tenant-scoped lookup. Returns null when missing or cross-tenant. */
    async get(id: string, tenantId: string): Promise<ReportExport | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(reportExports)
            .where(and(eq(reportExports.id, id), eq(reportExports.tenantId, tenantId)))
            .get();
        return row ?? null;
    }

    /** Flip a queued row to `building` (consumer picked up the job). */
    async markBuilding(id: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(reportExports)
            .set({ status: 'building', updatedAt: new Date() })
            .where(and(eq(reportExports.id, id), eq(reportExports.tenantId, tenantId)));
    }

    /** Flip to `ready` with the R2 key + byte size the consumer wrote. */
    async markReady(id: string, tenantId: string, r2Key: string, sizeBytes: number): Promise<void> {
        const db = this.getDrizzle();
        await db.update(reportExports)
            .set({ status: 'ready', r2Key, sizeBytes, error: null, updatedAt: new Date() })
            .where(and(eq(reportExports.id, id), eq(reportExports.tenantId, tenantId)));
    }

    /** Flip to `failed` with the error message surfaced to the polling UI. */
    async markFailed(id: string, tenantId: string, error: string): Promise<void> {
        const db = this.getDrizzle();
        logger.error('[report-export] build failed', { exportId: id, tenantId, error });
        await db.update(reportExports)
            .set({ status: 'failed', error, updatedAt: new Date() })
            .where(and(eq(reportExports.id, id), eq(reportExports.tenantId, tenantId)));
    }

    /**
     * Stream the exported `.docx` object from R2. Proxy pattern (mirrors
     * ReportPdfService.streamPdf): caller returns the body as a Response.
     * Throws when the record is not `ready` (never built, still building, or
     * failed) — callers must check status via `get`/status route before
     * offering the download link, this is a defensive re-check.
     *
     * Returns null when the object is missing in R2 (rare — shouldn't happen
     * if the D1 row says status='ready', but guard anyway).
     */
    async stream(record: ReportExport): Promise<R2ObjectBody | null> {
        if (!this.r2) throw Errors.BadRequest('Export storage unavailable: storage bucket binding not configured');
        if (record.status !== 'ready') {
            throw Errors.BadRequest(`Export not ready (status=${record.status})`);
        }
        if (!record.r2Key) throw Errors.BadRequest('Export record missing r2Key despite ready status');
        const obj = await this.r2.get(record.r2Key);
        return obj;
    }
}
