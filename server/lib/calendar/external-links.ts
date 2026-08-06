/**
 * The OI entity <-> provider event id map (`calendar_external_links`).
 *
 * Every caller goes through here so the uniqueness rule — one link per
 * (tenant, provider, entity_type, entity_id) — is expressed once. `upsertLink`
 * is keyed on exactly that tuple, which is what makes a second push an UPDATE
 * of the same remote event rather than a second event on someone's calendar.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { calendarExternalLinks } from '../db/schema';
import type { CalendarProviderId } from './provider';

export type CalendarLinkEntityType = 'inspection' | 'calendar_block';

export type CalendarExternalLinkRow = typeof calendarExternalLinks.$inferSelect;

export interface CalendarLinkKey {
    tenantId: string;
    provider: CalendarProviderId;
    entityType: CalendarLinkEntityType;
    entityId: string;
}

/**
 * Records (or refreshes) the remote id for one OI entity. Returns nothing:
 * callers that need the row back should read it, so there is no second place
 * that decides what a link row looks like.
 */
export async function upsertLink(
    db: DrizzleD1Database,
    input: CalendarLinkKey & { userId: string; externalId: string; etag?: string | null },
): Promise<void> {
    const now = new Date();
    await db.insert(calendarExternalLinks).values({
        id: crypto.randomUUID(),
        tenantId: input.tenantId,
        userId: input.userId,
        provider: input.provider,
        entityType: input.entityType,
        entityId: input.entityId,
        externalId: input.externalId,
        etag: input.etag ?? null,
        createdAt: now,
        updatedAt: now,
    }).onConflictDoUpdate({
        target: [
            calendarExternalLinks.tenantId,
            calendarExternalLinks.provider,
            calendarExternalLinks.entityType,
            calendarExternalLinks.entityId,
        ],
        // userId moves with the link: reassigning an inspection to another
        // inspector re-points the row at whoever now owns the remote event.
        set: {
            userId: input.userId,
            externalId: input.externalId,
            etag: input.etag ?? null,
            updatedAt: now,
        },
    });
}

/** The link for one entity, or null when it was never pushed. */
export async function getLink(
    db: DrizzleD1Database,
    key: CalendarLinkKey,
): Promise<CalendarExternalLinkRow | null> {
    const row = await db.select().from(calendarExternalLinks)
        .where(and(
            eq(calendarExternalLinks.tenantId, key.tenantId),
            eq(calendarExternalLinks.provider, key.provider),
            eq(calendarExternalLinks.entityType, key.entityType),
            eq(calendarExternalLinks.entityId, key.entityId),
        ))
        .get();
    return row ?? null;
}

/** Drops the link for one entity. Idempotent — a missing row is not an error. */
export async function deleteLink(
    db: DrizzleD1Database,
    key: CalendarLinkKey,
): Promise<void> {
    await db.delete(calendarExternalLinks).where(and(
        eq(calendarExternalLinks.tenantId, key.tenantId),
        eq(calendarExternalLinks.provider, key.provider),
        eq(calendarExternalLinks.entityType, key.entityType),
        eq(calendarExternalLinks.entityId, key.entityId),
    ));
}

/**
 * Every external id this user has pushed to this provider.
 *
 * The import path asks this question once per sync and answers rule 2 — "skip
 * events OI itself created" — from the resulting set. Asking per event would be
 * N queries against a table whose whole purpose is to be small.
 */
export async function listOwnExternalIds(
    db: DrizzleD1Database,
    params: { tenantId: string; userId: string; provider: CalendarProviderId },
): Promise<Set<string>> {
    const rows = await db.select({ externalId: calendarExternalLinks.externalId })
        .from(calendarExternalLinks)
        .where(and(
            eq(calendarExternalLinks.tenantId, params.tenantId),
            eq(calendarExternalLinks.userId, params.userId),
            eq(calendarExternalLinks.provider, params.provider),
        ))
        .all();
    return new Set(rows.map((r) => r.externalId));
}
