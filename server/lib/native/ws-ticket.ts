import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import type { Role } from '../auth/roles';
import { isRole } from '../auth/roles';
import { Errors } from '../errors';
import { nativeClientEnabled } from '../mcp/flag';

/**
 * One-time WebSocket tickets.
 *
 * A WebView WebSocket cannot send an Authorization header, and the native app
 * holds a bearer token rather than the session cookie, so a socket could not
 * authenticate at all. The app trades its bearer identity for a ticket over an
 * ordinary authenticated call, then opens the socket with `?ticket=`.
 *
 * A ticket is valid for ONE thing: the WebSocket upgrade of the inspection it
 * was issued for. It is not a credential for any other route.
 */

export const WS_TICKET_TTL_S = 60;
const KEY_PREFIX = 'wsticket:';

export interface WsTicket {
    tenantId: string;
    userId: string;
    role: Role;
    inspectionId: string;
}

/** Upgrade routes a ticket may open: the inspection's collab and presence sockets. */
const TICKET_WS_PATH = /^\/api\/inspections\/([^/]+)\/(?:collab|presence)\/ws$/;

/** The inspection id a ticket-eligible WebSocket path addresses, or null for any other path. */
export function wsTicketInspectionId(path: string): string | null {
    return TICKET_WS_PATH.exec(path)?.[1] ?? null;
}

function randomTicketId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24)); // 192 bits
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Store a ticket for the already-verified identity and return its opaque id. */
export async function issueWsTicket(kv: KVNamespace, ticket: WsTicket): Promise<string> {
    const id = randomTicketId();
    await kv.put(`${KEY_PREFIX}${id}`, JSON.stringify(ticket), { expirationTtl: WS_TICKET_TTL_S });
    return id;
}

function parseTicket(raw: string): WsTicket | null {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return null; }
    if (!value || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (typeof o.tenantId !== 'string' || !o.tenantId) return null;
    if (typeof o.userId !== 'string' || !o.userId) return null;
    if (typeof o.inspectionId !== 'string' || !o.inspectionId) return null;
    if (!isRole(o.role)) return null;
    return { tenantId: o.tenantId, userId: o.userId, role: o.role, inspectionId: o.inspectionId };
}

/**
 * Redeem a ticket. The key is deleted before the value is used, so a parallel
 * replay cannot ride a still-resolving call (the same order the SSO code uses).
 * KV offers no compare-and-delete, so two requests landing in the same instant
 * could both read it; the 60 s life and the per-inspection binding bound that.
 */
export async function consumeWsTicket(kv: KVNamespace, id: string): Promise<WsTicket | null> {
    const key = `${KEY_PREFIX}${id}`;
    const raw = await kv.get(key);
    if (!raw) return null;
    await kv.delete(key);
    return parseTicket(raw);
}

/**
 * Give a token-less WebSocket upgrade the identity its ticket was issued for.
 *
 * Returns false when this request is not asking for a ticket identity (not an
 * upgrade, not a ticket-eligible path, or no `ticket` parameter), in which case
 * the caller carries on exactly as before. Once a ticket IS presented, every
 * failure is a 401: unknown, expired, already used, issued for another
 * inspection, or native clients switched off.
 */
export async function applyWsTicketIdentity(c: Context<HonoConfig>): Promise<boolean> {
    const presented = c.req.query('ticket');
    if (!presented) return false;
    const inspectionId = wsTicketInspectionId(c.req.path);
    if (!inspectionId || c.req.header('Upgrade')?.toLowerCase() !== 'websocket') return false;

    const kv = c.env.TENANT_CACHE;
    if (!kv || !nativeClientEnabled(c.env)) throw Errors.Unauthorized('Invalid or expired ticket');
    const ticket = await consumeWsTicket(kv, presented);
    if (!ticket || ticket.inspectionId !== inspectionId) throw Errors.Unauthorized('Invalid or expired ticket');

    c.set('tenantId', ticket.tenantId);
    c.set('userRole', ticket.role);
    c.set('user', { sub: ticket.userId, role: ticket.role, tenantId: ticket.tenantId });
    return true;
}
