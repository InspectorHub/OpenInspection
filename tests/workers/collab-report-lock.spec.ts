/**
 * The results document of a published report takes no edits, and says so in a way a socket client can read.
 *
 * y-sync has no error frame, so a refused update cannot be answered with one. The document speaks through the
 * WebSocket CLOSE CODE instead: 4409 with the reason `REPORT_PUBLISHED`, the socket twin of HTTP 409. A client that is
 * closed this way never saw its edits acknowledged, keeps them, and asks the person.
 *
 * Real Durable Object in workerd with real sockets. Every refusal has a positive control in the same test.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { seedResultsDoc, applyItemPatch } from '@core/field-ui/shared/results-doc';
import { INSPECTION_RESULTS_TEST_DDL } from '../helpers/inline-ddl';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';

interface TestBindings { DB: D1Database; INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO> }
const b = env as unknown as TestBindings;
const KEY = '_default:sec1:item1';
const MSG_SYNC = 0;
const CODE = 4409;
const REASON = 'REPORT_PUBLISHED';

interface DOInternals { doc: Y.Doc; webSocketMessage(ws: WebSocket, data: ArrayBuffer): Promise<void> }

function updateFrame(update: Uint8Array): ArrayBuffer {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    return encoding.toUint8Array(enc).buffer as ArrayBuffer;
}

function clientEdit(rating: string): Uint8Array {
    const client = new Y.Doc();
    seedResultsDoc(client, [{ findingKey: KEY }]);
    const before = Y.encodeStateVector(client);
    applyItemPatch(client, KEY, 'rating', rating);
    return Y.encodeStateAsUpdate(client, before);
}

/** What a client library sees of a socket: it opens, may receive frames, and is closed with a code and a reason. */
class ClientProbe {
    closed: { code: number; reason: string } | null = null;
    constructor(readonly ws: WebSocket) {
        ws.accept();
        ws.addEventListener('close', (e) => { this.closed = { code: e.code, reason: e.reason }; });
    }
    async settle(): Promise<void> { await new Promise((r) => setTimeout(r, 60)); }
}

/** A socket stand-in for `webSocketMessage`, which records how the document closed it. */
class RecordingSocket {
    closed: { code: number; reason: string } | null = null;
    send(): void { /* not needed */ }
    close(code?: number, reason?: string): void { this.closed = { code: code ?? 1000, reason: reason ?? '' }; }
    asWs(): WebSocket { return this as unknown as WebSocket; }
}

/** `checkedAt` is when the route read D1; the default is "just now", i.e. after any mark the test made. */
const headers = (locked?: '0' | '1', checkedAt: number = Date.now() + 1_000): Record<string, string> => ({
    Upgrade: 'websocket', 'x-tenant-id': 'lock-tenant', 'x-inspection-id': 'insp-lock', 'x-report-id': 'rep-lock', 'x-user-id': 'u1',
    ...(locked ? { 'x-report-locked': locked, 'x-report-checked-at': String(checkedAt) } : {}),
});

describe('results document of a published report', () => {
    beforeAll(async () => {
        await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
    });

    const stub = () => b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`lock-tenant:insp-${crypto.randomUUID()}`));

    it('closes a new socket with 4409 REPORT_PUBLISHED when the route says the report is locked (control: unlocked stays open)', async () => {
        await runInDurableObject(stub(), async (instance: InspectionDocDO) => {
            seedResultsDoc((instance as unknown as DOInternals).doc, [{ findingKey: KEY }]);

            const locked = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers('1') }))).webSocket!);
            await locked.settle();
            expect(locked.closed).toEqual({ code: CODE, reason: REASON });

            const open = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers('0') }))).webSocket!);
            await open.settle();
            expect(open.closed).toBeNull();
            open.ws.close();
        });
    });

    it('closes the sockets that were already open when the report is published, and refuses their next update', async () => {
        await runInDurableObject(stub(), async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            seedResultsDoc(io.doc, [{ findingKey: KEY }]);
            const open = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers('0') }))).webSocket!);
            await open.settle();
            expect(open.closed).toBeNull();

            const res = await instance.fetch(new Request('https://do.local/lock', { method: 'POST' }));
            expect(((await res.json()) as { closed: number }).closed).toBe(1);
            await open.settle();
            expect(open.closed).toEqual({ code: CODE, reason: REASON });

            // A socket the runtime still routes a frame to is refused with the same code, and the edit is not applied.
            const before = Y.encodeStateAsUpdate(io.doc).byteLength;
            const late = new RecordingSocket();
            await io.webSocketMessage(late.asWs(), updateFrame(clientEdit('NI')));
            expect(late.closed).toEqual({ code: CODE, reason: REASON });
            expect(Y.encodeStateAsUpdate(io.doc).byteLength).toBe(before);
        });
    });

    it('without the lock the same update is applied (positive control for the refusal above)', async () => {
        await runInDurableObject(stub(), async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            seedResultsDoc(io.doc, [{ findingKey: KEY }]);
            const before = Y.encodeStateAsUpdate(io.doc).byteLength;
            const sock = new RecordingSocket();
            await io.webSocketMessage(sock.asWs(), updateFrame(clientEdit('NI')));
            expect(sock.closed).toBeNull();
            expect(Y.encodeStateAsUpdate(io.doc).byteLength).toBeGreaterThan(before);
        });
    });

    it('unlock (edit again) lets sockets in again, and an upgrade the route marks unlocked heals a mark that was never cleared', async () => {
        await runInDurableObject(stub(), async (instance: InspectionDocDO) => {
            seedResultsDoc((instance as unknown as DOInternals).doc, [{ findingKey: KEY }]);
            await instance.fetch(new Request('https://do.local/lock', { method: 'POST' }));
            // The document remembers the lock when the route says nothing...
            const remembered = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers() }))).webSocket!);
            await remembered.settle();
            expect(remembered.closed).toEqual({ code: CODE, reason: REASON });
            // ...D1's answer wins when it says the report is not locked...
            const healed = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers('0') }))).webSocket!);
            await healed.settle();
            expect(healed.closed).toBeNull();
            healed.ws.close();
            // ...and an explicit unlock clears it.
            await instance.fetch(new Request('https://do.local/lock', { method: 'POST' }));
            await instance.fetch(new Request('https://do.local/unlock', { method: 'POST' }));
            const after = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers() }))).webSocket!);
            await after.settle();
            expect(after.closed).toBeNull();
            after.ws.close();
        });
    });
    it('a publish that lands while an upgrade is in flight keeps its mark: a stale "0" read before the lock is not believed', async () => {
        await runInDurableObject(stub(), async (instance: InspectionDocDO) => {
            seedResultsDoc((instance as unknown as DOInternals).doc, [{ findingKey: KEY }]);
            const readD1At = Date.now() - 5_000;                       // the route read "not published" here...
            await instance.fetch(new Request('https://do.local/lock', { method: 'POST' })); // ...then the publish locked the document...
            const inFlight = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers('0', readD1At) }))).webSocket!);
            await inFlight.settle();                                    // ...and only now does the stale request arrive.
            expect(inFlight.closed).toEqual({ code: CODE, reason: REASON });
            // The mark survived: a later upgrade that says nothing is still refused.
            const later = new ClientProbe((await instance.fetch(new Request('https://do.local/ws', { headers: headers() }))).webSocket!);
            await later.settle();
            expect(later.closed).toEqual({ code: CODE, reason: REASON });
        });
    });
});
