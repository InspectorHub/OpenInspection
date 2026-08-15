import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/** How long a released slug stays un-claimable. Portal owns `tenants.slug` and
 *  is the AUTHORITY on this number; core stores the value it is told so the two
 *  tables read the same side by side, and enforces nothing. */
export const SLUG_RETIREMENT_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Slugs a tenant used to have — core's copy, and it answers a DIFFERENT
 * question from portal's.
 *
 * Portal's copy decides CLAIMABILITY (may somebody register this slug). This
 * one decides RESOLUTION: a public link carrying an old slug has to find its
 * tenant, and public routing happens here. Core never enforces the retirement
 * window; portal owns `tenants.slug` and is its only writer.
 *
 * Written from `portal.provider.ts`, on the same slug change that already drops
 * the stale `tenant:<old-slug>` KV entry — so no new command type and no
 * transport change. The two tables are written from one rename event and are
 * not compared anywhere; if they ever diverge, portal's is authoritative for
 * claims and this one for resolution, and neither can corrupt the other.
 *
 * ⚠️ In STANDALONE this table is created by the migration and stays PERMANENTLY
 * EMPTY, by design. `PortalProvider` is the SaaS writer only; standalone's
 * equivalent (`StandaloneProvider`) performs the same slug heal and is
 * deliberately NOT mirrored here — because in standalone an old-slug link
 * already works. When `resolveByPathParam` returns false the router falls
 * through to `resolveByFixedTenant`, which resolves the single tenant
 * regardless of the slug in the URL. The self-hoster was never broken, so there
 * is nothing for history to repair. Do not mirror the write to make the table
 * look populated.
 *
 * No `tenant_id` NOT NULL tenant-scope exception is needed: `tenant_id` IS the
 * scope column, and `old_slug` is the primary key because one tenant may rename
 * many times and every reader asks "who did THIS slug belong to".
 */
export const tenantSlugHistory = sqliteTable('tenant_slug_history', {
    // The slug as it appears in an old public link — the LOOKUP KEY, matched
    // exactly by `resolveByPathParam` after the live-slug and KV lookups miss,
    // and never cached (a history hit must not warm `tenant:<slug>` for whoever
    // claims that slug next). Written by `portal.provider.ts` BEFORE the rename
    // lands, as an upsert on this key: a slug that comes round again re-points
    // to its latest owner instead of colliding.
    oldSlug:      text('old_slug').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    changedAt:    integer('changed_at', { mode: 'timestamp_ms' }).notNull(),
    retiredUntil: integer('retired_until', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_tenant_slug_history_tenant').on(t.tenantId),
]);
