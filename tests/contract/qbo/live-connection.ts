/**
 * Borrowing the local sandbox connection, so a live contract spec can talk to
 * QuickBooks as this deployment does.
 *
 * There is no fixture here and there cannot be one. The whole point of the live
 * lane is to ask the real API questions no schema can answer — which fault code
 * a duplicate name returns, whether v3 has a PUT — and a stubbed answer to any
 * of those is exactly the mistake this suite exists to stop.
 *
 * It reads the same row the worker reads: `qbo_connections` in the local D1
 * file, tokens decrypted with `JWT_SECRET` from `.dev.vars` through the
 * product's own `decryptToken`. Nothing is minted, nothing is written, and the
 * secret is never printed.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { decryptToken } from '../../../server/lib/qbo-crypto';

const ROOT = join(__dirname, '..', '..', '..');
const D1_DIR = join(ROOT, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');

export interface LiveConnection {
    realmId: string;
    accessToken: string;
    apiBase: string;
}

/** Why the lane could not run, in words a reader can act on. */
export type Unavailable = { reason: string };

function devVars(): Record<string, string> | null {
    const path = join(ROOT, '.dev.vars');
    if (!existsSync(path)) return null;
    const out: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
    }
    return out;
}

/**
 * The connection, or a stated reason there is none.
 *
 * Never throws and never returns a half-built object: a live spec has exactly
 * two legitimate states, "ran" and "could not run, and here is why", and a
 * third one that looks like the first is how a suite reports green on nothing.
 */
export async function liveConnection(): Promise<LiveConnection | Unavailable> {
    const env = devVars();
    if (!env) return { reason: 'no .dev.vars — copy .dev.vars.example and add your Intuit sandbox keys' };
    if (!env.JWT_SECRET) return { reason: '.dev.vars has no JWT_SECRET, so stored tokens cannot be decrypted' };
    if (!env.QBO_ENV) return { reason: '.dev.vars has no QBO_ENV — set it to `sandbox`' };

    if (!existsSync(D1_DIR)) return { reason: `no local D1 at ${D1_DIR} — run npm run db:migrate` };
    const file = readdirSync(D1_DIR).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
    if (!file) return { reason: `no D1 database file in ${D1_DIR}` };

    // Read-only, and never through wrangler: a subprocess per query costs about
    // two seconds, which would dominate a lane whose whole value is being fast
    // enough to run before a push.
    const db = new Database(join(D1_DIR, file), { readonly: true, fileMustExist: true });
    let row: { realm_id: string; access_token_enc: string; token_expires_at: number } | undefined;
    try {
        row = db.prepare(
            'SELECT realm_id, access_token_enc, token_expires_at FROM qbo_connections LIMIT 1',
        ).get() as typeof row;
    } catch (e) {
        return { reason: `could not read qbo_connections: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
        db.close();
    }

    if (!row) return { reason: 'no qbo_connections row — connect a sandbox company at /settings/integrations/qbo' };
    if (row.token_expires_at < Date.now()) {
        // Deliberately not refreshed here. A refresh ROTATES the stored token,
        // and a test that quietly rewrites the developer's connection is doing
        // something a test has no business doing.
        return { reason: 'the stored access token has expired — press Sync in the app to refresh it, then re-run' };
    }

    const accessToken = await decryptToken(row.access_token_enc, env.JWT_SECRET);
    const apiBase = env.QBO_ENV === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com';

    return { realmId: row.realm_id, accessToken, apiBase };
}

export const isUnavailable = (c: LiveConnection | Unavailable): c is Unavailable =>
    'reason' in c;

/** POST an entity document and hand back the status and parsed body, faults included. */
export async function post(
    conn: LiveConnection, entity: string, body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
    const sep = entity.includes('?') ? '&' : '?';
    const res = await fetch(`${conn.apiBase}/v3/company/${conn.realmId}/${entity}${sep}minorversion=75`, {
        method:  'POST',
        headers: {
            Authorization:  `Bearer ${conn.accessToken}`,
            Accept:         'application/json',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text) as Record<string, unknown>; }
    catch { parsed = { unparsed: text.slice(0, 400) }; }
    return { status: res.status, body: parsed };
}

/** Every fault code in a response, in the order QuickBooks reported them. */
export function faultCodes(body: Record<string, unknown>): string[] {
    const errors = (body as { Fault?: { Error?: Array<{ code?: string }> } }).Fault?.Error;
    return Array.isArray(errors) ? errors.map((e) => String(e?.code ?? '')) : [];
}
