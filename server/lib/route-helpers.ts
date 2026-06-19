import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { drizzle } from 'drizzle-orm/d1';

/**
 * Shared route helpers for the Phase-1 route splits.
 *
 * These wrap the two boilerplate accessors every authenticated handler needs:
 * the verified tenant id (read exclusively from the JWT-set context variable,
 * never from user input) and a Drizzle instance bound to the request's D1.
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
 * Returns a Drizzle ORM instance bound to the request's D1 database. Mirrors the
 * `drizzle(c.env.DB)` construction used across the API route handlers.
 */
export function getDrizzle(c: Context<HonoConfig>): ReturnType<typeof drizzle> {
    return drizzle(c.env.DB);
}
