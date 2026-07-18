import { z } from 'zod';

/**
 * Commercial PCA Phase W Task 5 — the queue envelope for an async `.docx`
 * export job. Written server-side ONLY at enqueue time (POST
 * /api/inspections/:id/export/word): `tenantId` comes from `c.get('tenantId')`
 * (the JWT claim), never from client input — the consumer is NOT inside the
 * JWT middleware, so this envelope is the sole source of tenant scoping for
 * every downstream D1 read it performs.
 */
export interface WordExportJob {
    /** `report_exports.id` — the status row the consumer flips through
     *  queued -> building -> ready|failed. */
    exportId: string;
    tenantId: string;
    inspectionId: string;
    format: 'docx';
}

const wordExportJobSchema = z.object({
    exportId: z.string().min(1),
    tenantId: z.string().min(1),
    inspectionId: z.string().min(1),
    format: z.literal('docx'),
});

/** Parse a raw queue message body into a `WordExportJob`. Returns `null`
 *  (never throws) on a malformed envelope — the caller parks/logs it rather
 *  than crashing the batch handler. */
export function parseWordExportJob(raw: unknown): WordExportJob | null {
    const result = wordExportJobSchema.safeParse(raw);
    return result.success ? result.data : null;
}
