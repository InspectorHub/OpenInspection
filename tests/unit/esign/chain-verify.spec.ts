/**
 * C2: the offline verifier accepts a pack the server produced. Chains here are built by the real AuditLogService (so the hash rule, the
 * signature encoding and the key selection are the server's own), packed the way the sign-off workflow packs them, and read back by
 * the browser-side verifier.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { asc } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
import { AuditLogService } from '../../../server/services/audit-log.service';
import { SigningKeyService } from '../../../server/services/signing-key.service';
import { verifyEvidenceZip, MAX_EVENTS } from '../../../app/lib/evidence-zip-verify';
import { sha256Hex } from '../../../server/lib/sha256';

const TENANT = '00000000-0000-0000-0000-000000000001';
const REQ = '00000000-0000-0000-0000-000000000100';

describe('the offline verifier and a server-built pack', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let audit: AuditLogService;
    let keys: SigningKeyService;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({ id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        testD1.use(db);
        keys = new SigningKeyService(testD1.binding, 'unit-test-key-encryption-secret-32b');
        audit = new AuditLogService(testD1.binding, keys);
    });

    const events = async () => (await db.select().from(schema.esignAuditLogs).orderBy(asc(schema.esignAuditLogs.createdAt)).all())
        .map((r) => ({ id: r.id, event: r.event, createdAt: r.createdAt.getTime(), payloadJson: r.payloadJson, prevHash: r.prevHash, hash: r.hash, signature: r.signature, keyFingerprint: r.keyFingerprint }));

    async function pack(overrides: { events?: unknown[]; keysList?: boolean } = {}): Promise<Uint8Array> {
        const active = (await keys.getPublicKey(TENANT))!;
        const rows = overrides.events ?? await events();
        const fingerprints = [...new Set((rows as Array<{ keyFingerprint: string }>).map((r) => r.keyFingerprint))];
        const chainKeys = (await Promise.all(fingerprints.map((fp) => keys.getPublicKeyByFingerprint(TENANT, fp)))).filter(Boolean).map((k) => ({ fingerprint: k!.fingerprint, pem: k!.pem }));
        const trail = { envelopeId: REQ, algorithm: 'Ed25519', publicKeyPem: active.pem, keyFingerprint: active.fingerprint, ...(overrides.keysList === false ? {} : { keys: chainKeys }), events: rows };
        return zipSync({ 'audit-trail.json': strToU8(JSON.stringify(trail, null, 2)), 'public-key.pem': strToU8(active.pem) });
    }

    async function build() {
        await audit.append(TENANT, REQ, 'request.created', { at: 1 });
        await audit.append(TENANT, REQ, 'signer.presented', { signerId: 's1', contentHash: 'h' });
        await audit.append(TENANT, REQ, 'signer.signed', { signerId: 's1', onBehalfOf: null, tsMs: 5, name: 'Zoë "Z" O\'Neil' });
    }

    it('accepts a genuine pack', async () => {
        await build();
        const verdict = await verifyEvidenceZip(await pack());
        expect(verdict).toMatchObject({ valid: true, eventCount: 3, problems: [] });
    });

    it('accepts a genuine pack whose events are listed in another order (the chain is followed by its links)', async () => {
        await build();
        const verdict = await verifyEvidenceZip(await pack({ events: (await events()).reverse() }));
        expect(verdict.valid).toBe(true);
    });

    it('accepts a chain that spans a key rotation when the pack carries both keys, and says which key is missing when it carries only the active one', async () => {
        await audit.append(TENANT, REQ, 'request.created', { at: 1 });
        await audit.append(TENANT, REQ, 'signer.presented', { signerId: 's1', contentHash: 'h' });
        const rotated = await keys.rotateKeypair(TENANT);
        expect(rotated.retired).not.toBeNull();
        await audit.append(TENANT, REQ, 'signer.signed', { signerId: 's1' });
        expect(new Set((await events()).map((e) => e.keyFingerprint)).size).toBe(2);

        expect(await verifyEvidenceZip(await pack())).toMatchObject({ valid: true, eventCount: 3 });

        const partial = await verifyEvidenceZip(await pack({ keysList: false }));
        expect(partial.valid).toBe(false);
        // The earlier events could not be checked: that is a missing key, not a bad signature.
        expect(partial.problems.map((p) => p.reason)).toEqual(['no_key', 'no_key']);
    });

    it('names tampering: an edited payload is a hash failure, a swapped signature is a signature failure, a second follower is a fork', async () => {
        await build();
        const rows = await events();
        const edited = rows.map((r, i) => (i === 1 ? { ...r, payloadJson: r.payloadJson.replace('"s1"', '"s9"') } : r));
        expect((await verifyEvidenceZip(await pack({ events: edited }))).problems.map((p) => p.reason)).toContain('hash');

        const swapped = rows.map((r, i) => (i === 2 ? { ...r, signature: rows[1]!.signature } : r));
        expect((await verifyEvidenceZip(await pack({ events: swapped }))).problems.map((p) => p.reason)).toEqual(['signature']);

        const forked = [...rows, { ...rows[2]!, id: 'forked-copy' }];
        expect((await verifyEvidenceZip(await pack({ events: forked }))).problems.map((p) => p.reason)).toContain('fork');
    });

    it('says plainly when the zip is not a pack', async () => {
        expect((await verifyEvidenceZip(new Uint8Array([1, 2, 3]))).unreadable).toBe('not_zip');
        expect((await verifyEvidenceZip(zipSync({ 'other.txt': strToU8('x') }))).unreadable).toBe('missing_files');
        expect((await verifyEvidenceZip(zipSync({ 'audit-trail.json': strToU8('{"events": 4}'), 'public-key.pem': strToU8('x') }))).unreadable).toBe('bad_trail');
    });

    it('records why this was needed: the page used to hash {event, payloadJson, prevHash, createdAt} and verify a hex signature over the hex text', async () => {
        await build();
        const rows = await events();
        // The previous page's rule, restated: it could not agree with the server on any row.
        const legacyHash = async (ev: (typeof rows)[number]) => {
            const canonical = JSON.stringify({ event: ev.event, payloadJson: ev.payloadJson, prevHash: ev.prevHash, createdAt: ev.createdAt });
            const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
            return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
        };
        for (const row of rows) expect(await legacyHash(row)).not.toBe(row.hash);
        expect((await verifyEvidenceZip(await pack())).valid).toBe(true);
    });

    it('reports the fingerprint it checked with, the one the server computed, so a reader can compare it with the online page', async () => {
        await build();
        const active = (await keys.getPublicKey(TENANT))!;
        const verdict = await verifyEvidenceZip(await pack());
        expect(verdict.fingerprints).toEqual([active.fingerprint]);
    });

    /** A pack an attacker builds: their own key, a trail they hashed and signed themselves. */
    async function forged(claimedFingerprint?: string): Promise<{ zip: Uint8Array; theirs: string }> {
        const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
        const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey) as ArrayBuffer);
        const theirs = await sha256Hex(spki);
        const pem = '-----BEGIN PUBLIC KEY-----\n' + btoa(String.fromCharCode(...spki)).match(/.{1,64}/g)!.join('\n') + '\n-----END PUBLIC KEY-----\n';
        const fingerprint = claimedFingerprint ?? theirs;
        let prev: string | null = null;
        const rows = [];
        for (const [i, payload] of [{ at: 1 }, { signerId: 'mallory', signed: true }].entries()) {
            const payloadJson = JSON.stringify(payload);
            const hash = await sha256Hex(payloadJson + (prev ?? ''));
            const bytes = Uint8Array.from(hash.match(/../g)!.map((h) => parseInt(h, 16)));
            const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, bytes)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            rows.push({ id: `f${i}`, event: i === 0 ? 'request.created' : 'signer.signed', createdAt: i, payloadJson, prevHash: prev, hash, signature, keyFingerprint: fingerprint });
            prev = hash;
        }
        const trail = { keyFingerprint: fingerprint, keys: [{ fingerprint, pem }], events: rows };
        return { zip: zipSync({ 'audit-trail.json': strToU8(JSON.stringify(trail)), 'public-key.pem': strToU8(pem) }), theirs };
    }

    it('rejects a forged pack that files its own key under the real key fingerprint', async () => {
        await build();
        const real = (await keys.getPublicKey(TENANT))!;
        const { zip } = await forged(real.fingerprint);
        const verdict = await verifyEvidenceZip(zip);
        expect(verdict.outcome).toBe('invalid');
        expect(verdict.problems.map((p) => p.reason)).toContain('key_mismatch');
        expect(verdict.fingerprints).toEqual([]);
    });

    it('a forged pack under its own fingerprint is internally consistent, so the fingerprint it reports is what gives it away', async () => {
        await build();
        const real = (await keys.getPublicKey(TENANT))!;
        const { zip, theirs } = await forged();
        const verdict = await verifyEvidenceZip(zip);
        expect(verdict.fingerprints).toEqual([theirs]);
        expect(verdict.fingerprints).not.toContain(real.fingerprint);
    });

    it('a pack that lacks a key is "partial", not "invalid"; a real chain problem is "invalid" even when a key is also missing', async () => {
        await audit.append(TENANT, REQ, 'request.created', { at: 1 });
        await keys.rotateKeypair(TENANT);
        await audit.append(TENANT, REQ, 'signer.signed', { signerId: 's1' });
        const partial = await verifyEvidenceZip(await pack({ keysList: false }));
        expect(partial.outcome).toBe('partial');
        const rows = await events();
        const edited = rows.map((r, i) => (i === 1 ? { ...r, payloadJson: r.payloadJson.replace('s1', 's2') } : r));
        expect((await verifyEvidenceZip(await pack({ events: edited, keysList: false }))).outcome).toBe('invalid');
        expect((await verifyEvidenceZip(await pack())).outcome).toBe('valid');
    });

    it('catches a swapped signature from another key, a duplicated event, a dropped middle event, and a null versus empty-string predecessor', async () => {
        await build();
        const rows = await events();
        const other = await forged();
        const otherRows = (JSON.parse(new TextDecoder().decode(unzipSync(other.zip)['audit-trail.json']!)) as { events: Array<{ signature: string }> }).events;
        const swapped = rows.map((r, i) => (i === 2 ? { ...r, signature: otherRows[1]!.signature } : r));
        expect((await verifyEvidenceZip(await pack({ events: swapped }))).problems.map((p) => p.reason)).toEqual(['signature']);

        const duplicated = [...rows, { ...rows[1]!, id: 'dup-of-second' }];
        expect((await verifyEvidenceZip(await pack({ events: duplicated }))).problems.map((p) => p.reason)).toContain('fork');

        const dropped = [rows[0]!, rows[2]!];
        const droppedVerdict = await verifyEvidenceZip(await pack({ events: dropped }));
        expect(droppedVerdict.outcome).toBe('invalid');
        expect(droppedVerdict.problems.map((p) => p.reason)).toContain('chain');

        // An empty string is not "no predecessor": it is not a start of the chain, so a row written that way is a break.
        const emptyPrev = rows.map((r, i) => (i === 0 ? { ...r, prevHash: '' } : r));
        expect((await verifyEvidenceZip(await pack({ events: emptyPrev }))).outcome).toBe('invalid');
    });

    it('a forged row that copies the id of an earlier row is reported, at the tail and in the middle', async () => {
        await build();
        const rows = await events();
        const zeros = '0'.repeat(64);

        // At the tail: it follows the genuine last row, carries nothing a key could have signed, and borrows the first row's id.
        const tail = [...rows, { id: rows[0]!.id, event: 'signer.signed', createdAt: 9, payloadJson: '{}', prevHash: rows[2]!.hash, hash: zeros, signature: 'AAAA', keyFingerprint: 'zz' }];
        const tailVerdict = await verifyEvidenceZip(await pack({ events: tail }));
        expect(tailVerdict.outcome).toBe('invalid');
        expect(tailVerdict.problems.map((p) => p.reason)).toEqual(expect.arrayContaining(['chain', 'hash']));

        // In the middle: a genuine row whose id was overwritten with another row's id.
        const middle = rows.map((r, i) => (i === 1 ? { ...r, id: rows[2]!.id } : r));
        const middleVerdict = await verifyEvidenceZip(await pack({ events: middle }));
        expect(middleVerdict.outcome).toBe('invalid');
        expect(middleVerdict.problems.map((p) => p.reason)).toContain('chain');
    });

    it('a row that hangs off an event the pack does not hold is reported, and so is a loop that never reaches the head', async () => {
        await build();
        const rows = await events();
        const stray = { ...rows[2]!, id: 'stray', prevHash: 'ab'.repeat(32) };
        const strayVerdict = await verifyEvidenceZip(await pack({ events: [...rows, stray] }));
        expect(strayVerdict.outcome).toBe('invalid');
        expect(strayVerdict.problems).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'chain', eventId: 'stray' })]));

        // Two rows that name each other as predecessor: neither is reachable from the first event.
        const a = { ...rows[1]!, id: 'loop-a', hash: 'aa'.repeat(32), prevHash: 'bb'.repeat(32) };
        const b = { ...rows[1]!, id: 'loop-b', hash: 'bb'.repeat(32), prevHash: 'aa'.repeat(32) };
        const loopVerdict = await verifyEvidenceZip(await pack({ events: [...rows, a, b] }));
        expect(loopVerdict.outcome).toBe('invalid');
        const reported = loopVerdict.problems.filter((p) => p.reason === 'chain').map((p) => p.eventId);
        expect(reported).toEqual(expect.arrayContaining(['loop-a', 'loop-b']));
    });

    it('refuses an oversize entry and too many events with a clear reason, and reads nothing else in the zip', async () => {
        await build();
        const huge = zipSync({ 'audit-trail.json': new Uint8Array(9 * 1024 * 1024), 'public-key.pem': strToU8('x') });
        expect((await verifyEvidenceZip(huge)).unreadable).toBe('too_large');
        const manyEvents = Array.from({ length: MAX_EVENTS + 1 }, (_v, i) => ({ id: `e${i}`, event: 'signer.reminded', payloadJson: '{}', prevHash: null, hash: 'a', signature: 'a', keyFingerprint: 'a' }));
        const many = zipSync({ 'audit-trail.json': strToU8(JSON.stringify({ events: manyEvents })), 'public-key.pem': strToU8('x') });
        expect((await verifyEvidenceZip(many)).unreadable).toBe('too_large');
        // An unrelated large entry is never inflated: it does not make a good pack unreadable.
        const withExtra = zipSync({ ...unzipSync(await pack()), 'photos.bin': new Uint8Array(20 * 1024 * 1024) });
        expect((await verifyEvidenceZip(withExtra)).outcome).toBe('valid');
    });
});
