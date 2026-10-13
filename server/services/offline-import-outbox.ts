/**
 * Replaying the writes a device queued while it was offline, as the importer.
 *
 * Three guards stand between a package and a double write, and they cover
 * different things:
 *
 *  - a CREATE is held by the client-chosen inspection id: replaying it finds the
 *    row and answers 200, however much time has passed;
 *  - the 24 hour `Idempotency-Key` ledger replays the stored answer for a repeat
 *    that arrives inside its window (kept, because it is harmless);
 *  - an UPDATE or COMPLETE is a last-writer-wins overwrite, so a repeat after the
 *    ledger row expired would put an old value over a newer edit. The
 *    `offline_import_applied` table is what holds the line there: an entry whose
 *    key is recorded is skipped BEFORE the route is called, and a key is recorded
 *    only after the route answered 2xx, so a refused entry stays retryable.
 *
 * Crash window: the record is written straight after the route answers. If the
 * Worker dies between the two, a retry applies that one write again. That is the
 * same outcome the 24 hour ledger alone gave, narrowed from a day to the gap
 * between two awaits; the write is an overwrite of the same value, so it only
 * matters if someone edited the same field inside that gap.
 *
 * Retention: rows are never swept. Each is a few dozen bytes and only an imported
 * package makes one. A retention policy is a separate decision; sweeping them is
 * exactly what re-opens the replay hole, so none is implied here.
 */

import type { Context } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { Errors, type AppError } from '../lib/errors';
import { offlineImportApplied } from '../lib/db/schema';
import { getDrizzle } from '../lib/route-helpers';
import { logger } from '../lib/logger';
import type { OutboxEntry } from '../lib/native/offline-package';
import type { HonoConfig } from '../types/hono';

export interface OutboxFailure {
    idempotencyKey: string;
    op: OutboxEntry['op'];
    inspectionId: string;
    /** HTTP status the target route answered. */
    status: number;
}

export interface OutboxResult {
    applied: number;
    skipped: number;
    failed: OutboxFailure[];
}

/** D1 allows 100 bound parameters per statement; leave room for the tenant id. */
const LOOKUP_CHUNK = 80;

/** The in-process request that replays one queued write with the caller's own credentials. */
function outboxRequest(c: Context<HonoConfig>, entry: OutboxEntry): Request {
    const { id, ...rest } = entry.payload;
    const headers = new Headers({ 'Idempotency-Key': entry.idempotencyKey });
    // Only the caller's credentials travel. Version-handshake and other client
    // headers do not: this is the server calling itself, not the device.
    for (const name of ['authorization', 'cookie']) {
        const v = c.req.header(name);
        if (v) headers.set(name, v);
    }
    const url = (path: string) => new URL(path, c.req.url);
    switch (entry.op) {
        case 'inspection.create':
            headers.set('content-type', 'application/json');
            return new Request(url('/api/inspections'), { method: 'POST', headers, body: JSON.stringify(entry.payload) });
        case 'inspection.update':
            headers.set('content-type', 'application/json');
            return new Request(url(`/api/inspections/${id}`), { method: 'PATCH', headers, body: JSON.stringify(rest) });
        case 'inspection.complete':
            return new Request(url(`/api/inspections/${id}/complete`), { method: 'POST', headers });
    }
}

function detailed(err: AppError, details: unknown): AppError {
    err.details = details;
    return err;
}

function failureFor(status: number, message: string, details: unknown): AppError {
    if (status === 401 || status === 403) return detailed(Errors.Forbidden(message), details);
    if (status === 404) return detailed(Errors.NotFound(message), details);
    if (status === 409) return detailed(Errors.Conflict(message), details);
    if (status === 422) return Errors.UnprocessableEntity(message, details);
    if (status >= 500) return Errors.ServiceUnavailable(message, details);
    return Errors.BadRequest(message, details);
}

function executionContext(c: Context<HonoConfig>): ExecutionContext | undefined {
    try { return c.executionCtx; } catch { return undefined; }
}

/**
 * A refusal that will answer the same way next time: the device sent something
 * the server will not accept. Rate limiting and timeouts are 4xx too, but they
 * are about the moment, not the entry, so they stop the request like a 5xx does.
 */
function isPermanentRefusal(status: number): boolean {
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function recordedKeys(c: Context<HonoConfig>, tenantId: string, keys: readonly string[]): Promise<Set<string>> {
    const db = getDrizzle(c);
    const found = new Set<string>();
    for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
        const rows = await db.select({ key: offlineImportApplied.idempotencyKey }).from(offlineImportApplied)
            .where(and(eq(offlineImportApplied.tenantId, tenantId), inArray(offlineImportApplied.idempotencyKey, keys.slice(i, i + LOOKUP_CHUNK))));
        for (const r of rows) found.add(r.key);
    }
    return found;
}

async function record(c: Context<HonoConfig>, tenantId: string, userId: string, entry: OutboxEntry): Promise<void> {
    // A conflicting row means another request recorded the same entry first: already recorded.
    await getDrizzle(c).insert(offlineImportApplied).values({
        tenantId, idempotencyKey: entry.idempotencyKey, op: entry.op, inspectionId: entry.payload.id,
        appliedAt: new Date(), appliedBy: userId,
    }).onConflictDoNothing();
}

/**
 * Replay `entries` in order. With `tolerateRefusals` a permanent 4xx from the
 * target route is reported in `failed` and the next entry still runs; without it,
 * and for every 5xx, 408 and 429 either way, the first refusal throws and the
 * whole request fails so that the client retries it.
 */
export async function applyOutbox(
    c: Context<HonoConfig>,
    entries: readonly OutboxEntry[],
    opts: { tolerateRefusals: boolean },
): Promise<OutboxResult> {
    const result: OutboxResult = { applied: 0, skipped: 0, failed: [] };
    if (entries.length === 0) return result;
    const tenantId = c.get('tenantId');
    const userId = c.get('user')?.sub;
    if (!tenantId || !userId) throw Errors.Unauthorized();

    // Creates are held by the client id; only overwrites need the durable record.
    const guarded = (e: OutboxEntry) => e.op !== 'inspection.create';
    const already = await recordedKeys(c, tenantId, entries.filter(guarded).map((e) => e.idempotencyKey));
    const { app } = await import('../index');

    for (const entry of entries) {
        if (guarded(entry) && already.has(entry.idempotencyKey)) {
            result.skipped++;
            continue;
        }
        const res = await app.fetch(outboxRequest(c, entry), c.env, executionContext(c));
        if (!res.ok) {
            logger.warn('offline import: a queued write was refused', { op: entry.op, status: res.status });
            const details = { idempotencyKey: entry.idempotencyKey, op: entry.op, inspectionId: entry.payload.id, status: res.status };
            if (opts.tolerateRefusals && isPermanentRefusal(res.status)) {
                result.failed.push(details);
                continue;
            }
            throw failureFor(res.status, `Queued write ${entry.idempotencyKey} (${entry.op}) was refused`, details);
        }
        if (guarded(entry)) await record(c, tenantId, userId, entry);
        // A create that answers 200 found the inspection already there; any other
        // write is a repeat when the idempotency layer replayed its stored answer.
        const repeat = res.headers.get('Idempotency-Replayed') === 'true'
            || (entry.op === 'inspection.create' && res.status === 200);
        if (repeat) result.skipped++; else result.applied++;
    }
    return result;
}
