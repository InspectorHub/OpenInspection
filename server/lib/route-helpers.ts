import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';

/**
 * Shared route helpers for the Phase-1 route splits.
 *
 * These wrap the two boilerplate accessors every authenticated handler needs:
 * the verified tenant id (read exclusively from the JWT-set context variable,
 * never from user input) and a Drizzle instance bound to the request's D1.
 *
 * `lint:provider-helpers` bans hand-rolled `drizzle(c.env.DB)` / `drizzle(env.DB)`
 * in server/api — call one of these instead.
 */

/**
 * Returns the verified tenant id for the current request.
 *
 * `tenantId` is set by the auth middleware from the verified JWT claims — never
 * from user input (see Tenant Isolation Rules in CLAUDE.md). Always prefer this
 * over reading `c.get('tenantId')` inline so the source of truth stays single.
 */
export function getTenantId(c: Context<HonoConfig>): string {
    return c.get('tenantId');
}

/**
 * Returns a Drizzle ORM instance bound to the request's D1 database.
 *
 * Return type is intentionally loose (`any` schema map): handlers pass the
 * handle into helpers typed as `ReturnType<typeof drizzle>` / service methods
 * with their own schema maps. Pinning `Record<string, never>` here made every
 * call site a TS2345 after the provider-helpers migration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDrizzle(c: Context<HonoConfig>): ReturnType<typeof drizzle<any>> {
    return drizzle(c.env.DB);
}

/**
 * Drizzle from a bare D1 binding — for helpers that only have `env` (e.g.
 * integration test loggers, non-request callbacks). Prefer `getDrizzle(c)` in
 * route handlers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDrizzle(db: D1Database): ReturnType<typeof drizzle<any>> {
    return drizzle(db);
}

/** Shared alias for helpers that take a drizzle handle without a schema map. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppDrizzle = ReturnType<typeof drizzle<any>>;
