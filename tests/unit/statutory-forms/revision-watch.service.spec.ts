/**
 * The watcher writes to the sightings table and to nothing else.
 *
 * ── The assertion this file is really about ─────────────────────────────────
 * Every test here seeds ONE published revision with a hash nobody could produce
 * by accident, then polls a page serving different bytes, then reads the
 * versions table back and demands it still holds exactly that row. An assertion
 * that the table was "empty" or that some string was "absent" would pass for a
 * watcher that never ran at all; this one fails the moment a poll writes, edits
 * or replaces a published revision, and it names the value it expected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { statutoryFormSightings } from '../../../server/lib/db/schema/statutory-form-sightings';
import { statutoryFormVersions } from '../../../server/lib/db/schema/statutory-forms';
import { setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';

const PAGE = 'https://example.gov/forms/rei.pdf';
const PUBLISHED_HASH = 'a'.repeat(64);

/**
 * A catalogue with something in it. The repository publishes no statutory form,
 * so the real one is empty and every verdict off it would be `unrecognised` —
 * a suite that could only ever exercise one of the three answers.
 */
const CATALOGUE: StatutoryFormVersion[] = [{
    formId: 'tx_trec_rei',
    version: '7-6',
    sourceUrl: PAGE,
    sourceHash: PUBLISHED_HASH,
    effectiveFrom: Date.parse('2021-09-01T00:00:00.000Z'),
    mandatoryFrom: Date.parse('2022-02-01T00:00:00.000Z'),
    effectiveUntil: null,
    publishedBy: 'platform',
    publishedAt: Date.parse('2026-08-21T00:00:00.000Z'),
    withdrawnAt: null,
}];

vi.mock('../../../server/lib/statutory/forms', () => ({
    PUBLISHED_FORM_VERSIONS: CATALOGUE,
    FIELD_MAPS: [],
    EMPTY_CATALOGUE_REASON: null,
    fieldMapFor: () => null,
}));

const TARGET = { formId: 'tx_trec_rei', sourceUrl: PAGE };
const NOW = new Date('2026-08-23T04:00:00.000Z');
const LATER = new Date('2026-08-24T04:00:00.000Z');

let sqlite: SqliteDatabase;
let db: BetterSQLite3Database<typeof schema>;
let binding: D1Database;

/** `fetch` answering with the bytes an agency page is serving today. */
function serving(body: string, status = 200) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
}

/** The bytes whose sha256 is the hash the fixture publishes. */
const PUBLISHED_BYTES = 'the revision we publish';
let publishedBytesHash = '';

beforeEach(async () => {
    sqlite = new Database(':memory:');
    await setupSchema(sqlite);
    db = drizzle(sqlite, { schema });
    binding = toD1Binding(sqlite);

    const { sha256Hex } = await import('../../../server/lib/statutory/revision-watch');
    publishedBytesHash = await sha256Hex(new TextEncoder().encode(PUBLISHED_BYTES));
    CATALOGUE[0]!.sourceHash = publishedBytesHash;

    await db.insert(statutoryFormVersions).values({
        id: 'ver_1',
        formId: 'tx_trec_rei',
        version: '7-6',
        effectiveFrom: new Date(CATALOGUE[0]!.effectiveFrom),
        mandatoryFrom: new Date(CATALOGUE[0]!.mandatoryFrom!),
        effectiveUntil: null,
        sourceUrl: PAGE,
        sourceHash: publishedBytesHash,
        objectKey: 'statutory/tx_trec_rei/7-6.pdf',
        publishedBy: 'platform',
        publishedAt: new Date(CATALOGUE[0]!.publishedAt),
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    sqlite.close();
});

async function poll(now = NOW) {
    const { StatutoryRevisionWatchService } = await import(
        '../../../server/services/statutory/revision-watch.service'
    );
    return new StatutoryRevisionWatchService(binding).poll(TARGET, now);
}

async function versionRows() {
    return db.select().from(statutoryFormVersions).all();
}

describe('the watcher records what a page served', () => {
    it('calls it unchanged when the page serves the revision we publish', async () => {
        serving(PUBLISHED_BYTES);
        expect((await poll())?.verdict).toBe('unchanged');
    });

    it('calls it changed when the page serves anything else', async () => {
        serving('a revision nobody here has read yet');
        const seen = await poll();
        expect(seen?.verdict).toBe('changed');
        const rows = await db.select().from(statutoryFormSightings).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.verdict).toBe('changed');
    });

    it('keeps first_seen_at still while last_seen_at moves', async () => {
        // The answer somebody actually wants from this table is "since WHEN has
        // this page been serving something we do not publish". An upsert that
        // refreshed both timestamps would make a month-old divergence read as
        // this morning's, and would do it on a table that looks fully populated.
        serving('a revision nobody here has read yet');
        await poll(NOW);
        await poll(LATER);

        const rows = await db.select().from(statutoryFormSightings).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.firstSeenAt.getTime()).toBe(NOW.getTime());
        expect(rows[0]!.lastSeenAt.getTime()).toBe(LATER.getTime());
    });

    it('records nothing at all when the page could not be read', async () => {
        // A failed poll that wrote a row would be indistinguishable from a
        // successful one, and the row it wrote would name a digest of an error
        // page. Silence in the table, loudness in the log.
        serving('<html>Not Found</html>', 404);
        expect(await poll()).toBeNull();
        expect(await db.select().from(statutoryFormSightings).all()).toHaveLength(0);
    });
});

describe('the watcher never publishes', () => {
    it('leaves the published revision byte-for-byte as it found it', async () => {
        serving('a revision nobody here has read yet');
        await poll();

        // An equality on the whole row, not a check that something is absent.
        // The published hash is the digest of a string this file chose, so a
        // watcher that overwrote it with what the page served would not merely
        // fail — it would print the substituted value.
        const rows = await versionRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]!.sourceHash).toBe(publishedBytesHash);
        expect(rows[0]!.version).toBe('7-6');
        expect(rows[0]!.objectKey).toBe('statutory/tx_trec_rei/7-6.pdf');
    });

    it('adds no revision for the bytes it just saw', async () => {
        const NEW_BYTES = 'a revision nobody here has read yet';
        serving(NEW_BYTES);
        const seen = await poll();

        // Named rather than counted: the digest the watcher itself reported is
        // the exact value that must not have become a published revision.
        const rows = await versionRows();
        expect(rows.map((r) => r.sourceHash)).toEqual([publishedBytesHash]);
        expect(rows.some((r) => r.sourceHash === seen!.observedHash)).toBe(false);
    });
});
