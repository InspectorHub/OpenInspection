/**
 * A parked command must never hold the payload (#276).
 *
 * `cmd.tenant.update` carries `adminEmail` + `adminPasswordHash` SPARSELY —
 * only password-change commands do (see `applyCredentialIfFresh`). Both parking
 * paths used to write the message itself: the raw string on a parse failure and
 * `JSON.stringify(env)` on an unknown type/version. So one malformed
 * password-change command left an admin credential in a table nothing pruned,
 * no erasure rule covered, and no PII heuristic flagged.
 *
 * Real workerd, because `applyCmdEnvelope` takes a real `D1Database`. The
 * `parked_cmd_events` DDL is hand-declared the way every sibling spec in this
 * directory declares the tables it touches.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';

const b = env as unknown as { DB: D1Database };

/** The credential the parked row must not be able to reveal. */
const SECRET_HASH = 'pbkdf2:100000:U0FMVFNBTFQ:SECRETHASHVALUE';
const ADMIN_EMAIL = 'boss@example.com';

/** A password-change command whose dataschema version core does not know. */
function credentialEnvelope(over: Record<string, unknown> = {}) {
    return {
        specversion: '1.0',
        id: 'cmd-parked-1',
        type: 'io.inspectorhub.cmd.tenant.update',
        source: 'portal',
        time: '2026-08-06T00:00:00.000Z',
        dataschema: 'cmd-tenant-update/v99',
        tenantseq: 7,
        data: {
            tenantId: 'ct1', slug: 'ws-1', status: 'active',
            adminEmail: ADMIN_EMAIL, adminPasswordHash: SECRET_HASH,
        },
        ...over,
    };
}

interface ParkedRow { id: string; envelope: string; reason: string }

async function onlyParkedRow(): Promise<ParkedRow> {
    const r = await b.DB.prepare('SELECT id, envelope, reason FROM parked_cmd_events').all<ParkedRow>();
    expect(r.results).toHaveLength(1);
    return r.results[0]!;
}

describe('parked commands never retain the payload', () => {
    beforeAll(async () => {
        await b.DB.exec(
            'CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);',
        );
    });
    beforeEach(async () => {
        await b.DB.exec('DELETE FROM parked_cmd_events;');
    });

    it('stores no credential when a credential-bearing command fails to parse', async () => {
        // Valid JSON, invalid envelope (no `specversion`) — the shape a real
        // portal/core contract skew produces, and the path that parks the RAW
        // string. This is the credential path.
        const { specversion: _dropped, ...malformed } = credentialEnvelope();
        expect(await applyCmdEnvelope(b.DB, undefined, JSON.stringify(malformed))).toBe('parked');

        const row = await onlyParkedRow();
        expect(row.reason).toBe('parse-failed');
        expect(row.envelope).not.toContain('SECRETHASHVALUE');
        expect(row.envelope).not.toContain('adminPasswordHash');
        expect(row.envelope).not.toContain(ADMIN_EMAIL);
    });

    it('stores no credential when a credential-bearing command has an unknown version', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, credentialEnvelope())).toBe('parked');

        const row = await onlyParkedRow();
        expect(row.reason).toBe('unknown-type-or-version');
        expect(row.envelope).not.toContain('SECRETHASHVALUE');
        expect(row.envelope).not.toContain('adminPasswordHash');
        expect(row.envelope).not.toContain(ADMIN_EMAIL);
    });

    it('still says which command skewed, and how to match it against the sender', async () => {
        // The row exists so a human learns portal and core disagree about a
        // command shape. Type, dataschema, id, sequence, size and a digest of
        // the bytes say that; the payload never added diagnostic value that
        // justified holding a secret.
        await applyCmdEnvelope(b.DB, undefined, credentialEnvelope());
        const fp = JSON.parse((await onlyParkedRow()).envelope) as Record<string, unknown>;
        expect(fp).toMatchObject({
            type: 'io.inspectorhub.cmd.tenant.update',
            dataschema: 'cmd-tenant-update/v99',
            cmdId: 'cmd-parked-1',
            tenantseq: 7,
        });
        expect(fp['sha256']).toMatch(/^[0-9a-f]{64}$/);
        expect(fp['bytes']).toBeGreaterThan(0);
    });

    it('still says WHY an unparseable envelope could not be read', async () => {
        // Names of envelope fields that failed validation — never their values,
        // and never a key from inside `data`.
        const { specversion: _dropped, ...malformed } = credentialEnvelope();
        await applyCmdEnvelope(b.DB, undefined, JSON.stringify(malformed));
        const fp = JSON.parse((await onlyParkedRow()).envelope) as Record<string, unknown>;
        expect(fp['invalidFields']).toEqual(['specversion']);
        // The claimed routing fields survive so the row is still attributable.
        expect(fp).toMatchObject({ type: 'io.inspectorhub.cmd.tenant.update', cmdId: 'cmd-parked-1' });
    });

    it('parks a fingerprint even for input that is not JSON at all', async () => {
        expect(await applyCmdEnvelope(b.DB, undefined, 'not json at all {{')).toBe('parked');
        const fp = JSON.parse((await onlyParkedRow()).envelope) as Record<string, unknown>;
        expect(fp['type']).toBeNull();
        expect(fp['sha256']).toMatch(/^[0-9a-f]{64}$/);
        expect(fp['invalidFields']).toEqual(['<not-json>']);
    });
});
