// tests/unit/reports/translation-staleness.spec.ts
/**
 * The withhold rule, and the exact thing `english_hash` proves.
 *
 * A courtesy translation is stored beside the English report and keyed to the
 * render-input hash of the English it was made FROM. A reader who is shown a
 * translation of a finding the inspector has since corrected is worse off than
 * a reader shown no translation at all, so a mismatch WITHHOLDS rather than
 * warns.
 *
 * The record survives the withhold on purpose: "there is no translation" and
 * "there is one and it is currently withheld" are different states, and only
 * the second one can be repaired.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ReportTranslationService } from '../../../server/services/report-translation.service';
import { COURTESY_TRANSLATION_NOTICE } from '../../../server/lib/legal/courtesy-translation-notice';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000t1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000t2';
const REPORT = '11111111-1111-1111-1111-1111111111r1';
const LOCALE = 'es-419';

const ENGLISH_HASH = 'a'.repeat(64);
const EDITED_ENGLISH_HASH = 'b'.repeat(64);

const SEGMENTS = ['El techo presenta danos.', 'Se recomienda reparar.'];

function input(englishHash = ENGLISH_HASH) {
    return {
        segments: SEGMENTS,
        source: 'openai-compatible:byo',
        englishHash,
        aiCallId: '22222222-2222-2222-2222-2222222222c1',
    };
}

describe('ReportTranslationService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: ReportTranslationService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new ReportTranslationService({} as D1Database);
    });

    it('serves a translation whose english hash matches the report it is read against', async () => {
        await svc.store(TENANT, REPORT, LOCALE, input());

        const live = await svc.readFresh(TENANT, REPORT, LOCALE, ENGLISH_HASH);

        expect(live).not.toBeNull();
        expect(live!.segments).toEqual(SEGMENTS);
        expect(live!.source).toBe('openai-compatible:byo');
    });

    it('withholds the translation when the report it was made from has changed', async () => {
        await svc.store(TENANT, REPORT, LOCALE, input());

        // The inspector edited a finding and republished: the render-input hash
        // moved, and this translation describes the previous document.
        const withheld = await svc.readFresh(TENANT, REPORT, LOCALE, EDITED_ENGLISH_HASH);

        expect(withheld).toBeNull();
    });

    it('keeps the record when the translation is withheld, so the state is repairable', async () => {
        await svc.store(TENANT, REPORT, LOCALE, input());

        expect(await svc.readFresh(TENANT, REPORT, LOCALE, EDITED_ENGLISH_HASH)).toBeNull();

        // No row at all and a row that no longer matches are different answers.
        const record = await svc.read(TENANT, REPORT, LOCALE);
        expect(record).not.toBeNull();
        expect(record!.englishHash).toBe(ENGLISH_HASH);
    });

    it('reports no record at all before anything was ever translated', async () => {
        expect(await svc.read(TENANT, REPORT, LOCALE)).toBeNull();
        expect(await svc.readFresh(TENANT, REPORT, LOCALE, ENGLISH_HASH)).toBeNull();
    });

    it('never returns another tenant a translation, matching hash or not', async () => {
        await svc.store(TENANT, REPORT, LOCALE, input());

        expect(await svc.readFresh(OTHER_TENANT, REPORT, LOCALE, ENGLISH_HASH)).toBeNull();
        expect(await svc.read(OTHER_TENANT, REPORT, LOCALE)).toBeNull();
    });

    it('replaces the previous translation for a locale rather than accumulating rows', async () => {
        const first = await svc.store(TENANT, REPORT, LOCALE, input());
        const second = await svc.store(TENANT, REPORT, LOCALE, {
            ...input(EDITED_ENGLISH_HASH),
            segments: ['El techo fue reparado.', 'No se recomienda accion.'],
        });

        expect(second.id).not.toBe(first.id);

        const rows = await testDb.select().from(schema.reportTranslations).all();
        expect(rows).toHaveLength(1);

        const record = await svc.read(TENANT, REPORT, LOCALE);
        expect(record!.englishHash).toBe(EDITED_ENGLISH_HASH);
        expect(record!.segments[0]).toBe('El techo fue reparado.');
    });

    it('stamps the notice version in force when the translation was produced', async () => {
        const stored = await svc.store(TENANT, REPORT, LOCALE, input());
        expect(stored.noticeVersion).toBe(COURTESY_TRANSLATION_NOTICE.version);
    });

    it('hashes the translated bytes that were actually stored', async () => {
        const stored = await svc.store(TENANT, REPORT, LOCALE, input());

        const row = await testDb.select().from(schema.reportTranslations).get();
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(row!.content));
        const hex = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

        // Over the stored string itself, not over a re-serialisation of a parse
        // of it. Anything else drifts from the bytes the moment either side
        // changes how it serialises.
        expect(stored.translatedHash).toBe(hex);
    });

    it('removes a translation without disturbing another locale on the same report', async () => {
        await svc.store(TENANT, REPORT, LOCALE, input());
        await svc.store(TENANT, REPORT, 'pt-BR', input());

        expect(await svc.remove(TENANT, REPORT, LOCALE)).toBe(true);

        expect(await svc.read(TENANT, REPORT, LOCALE)).toBeNull();
        expect(await svc.read(TENANT, REPORT, 'pt-BR')).not.toBeNull();

        // Removing what is not there is not an error, and reports no work done.
        expect(await svc.remove(TENANT, REPORT, LOCALE)).toBe(false);
    });
});
