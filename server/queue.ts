import type { HonoConfig } from './types/hono';
import type { ImagesBinding } from './lib/media/strip-exif';

/**
 * The queue entry point, for all four consumers this worker owns.
 *
 * Split out of `server/index.ts` for the same reason `scheduled.ts` was: the
 * default export lived in the module that builds the API, so reaching a queue
 * handler meant evaluating every route and every Zod schema first. The
 * dispatcher itself needs none of that — it reads `batch.queue` and hands off.
 *
 * ⚠️ The saving here is NOT the same as the cron split's, and the cron split's
 * own production result was NULL. Measured 2026-09-07: removing this import
 * from the scheduled handler cut a COLD isolate from 273 ms to 59 ms locally,
 * and changed production not at all (10.48 ms/tick before, 10.86 ms after)
 * because production cron ticks land on isolates other traffic already warmed.
 * A queue consumer is invoked the same way. So treat this as removing a cold-
 * start cost that is paid rarely, not as a per-invocation win — and measure a
 * WARM isolate before claiming otherwise.
 *
 * Every branch keeps its dynamic import, so a word-export batch still does not
 * load the cmd consumer. Never throws.
 */
export async function queue(
    batch: MessageBatch<unknown>,
    env: HonoConfig['Bindings'],
    _ctx: ExecutionContext,
): Promise<void> {
    if (batch.queue.includes('word-export')) {
        const { handleWordExportBatch } = await import('./services/report-export-consumer');
        const images = (env as unknown as { IMAGES?: ImagesBinding }).IMAGES;
        await handleWordExportBatch({
            DB: env.DB, PHOTOS: env.PHOTOS, TENANT_CACHE: env.TENANT_CACHE,
            KEY_ENCRYPTION_SECRET: env.KEY_ENCRYPTION_SECRET, JWT_SECRET: env.JWT_SECRET,
            ...(images ? { IMAGES: images } : {}),
        }, batch);
        return;
    }
    // The cron queue. One message = one job = one Worker invocation with its
    // own CPU budget; that split is what keeps the scheduled path inside the
    // Workers Free 10 ms per-invocation ceiling.
    if (batch.queue.includes('-cron')) {
        const { handleCronBatch } = await import('./cron/consumer');
        await handleCronBatch(env as never, batch as never);
        return;
    }
    if (batch.queue.includes('-cmd-') && !batch.queue.includes('cmd-dlq')) {
        const { handleCmdBatch } = await import('./portal/cmd-batch');
        // SYNC_QUEUE carries replies (A-21 batch 2); PHOTOS/EXPORTS serve
        // offboarding (batch 3) and the DOs let purge empty them; the last
        // argument is the secret a report amendment is signed with (cmd-batch.ts).
        await handleCmdBatch(env.DB, env.TENANT_CACHE, batch, env.SYNC_QUEUE, { photos: env.PHOTOS, exports: env.EXPORTS_BUCKET }, { INSPECTION_DOC: env.INSPECTION_DOC, TENANT_PRESENCE: env.TENANT_PRESENCE }, env, env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET);
        return;
    }
    // Imported dynamically, and from `./portal/sync-dlq` rather than from
    // `integration.module` — that module statically imports two route modules,
    // which would put the whole point of this file back.
    const { handleSyncDlqBatch } = await import('./portal/sync-dlq');
    await handleSyncDlqBatch(env.DB, batch);
}
