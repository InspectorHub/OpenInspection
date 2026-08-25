/**
 * The browser's converted-workbook file name, against the server rule that
 * reads it.
 *
 * When `StartImportPanel` flattens one sheet of an `.xlsx` to CSV it builds a
 * `File` the server has never seen before, and exactly ONE thing on the server
 * looks at its name: `extForFileName`. That single call decides two things that
 * are not recoverable later —
 *
 *   - which size cap the upload is measured against (`assertSourceSizeWithin`
 *     compares a CSV against the CSV limit, a container against the vendor
 *     limit), and
 *   - the content type the stored R2 object is written with (`text/csv` vs
 *     `application/octet-stream`).
 *
 * so the two sides are asserted against each other here rather than restated as
 * a comment on either. This spec lives under `tests/unit/` and not beside
 * `xlsx-intake.ts` on purpose: it is the one assertion in this feature that
 * reaches into `server/`.
 */
import { describe, expect, it } from 'vitest';

import { csvFileNameFor } from '~/lib/xlsx-intake';
import { extForFileName } from '../../../server/services/migration-intake/source-file.service';

describe('browser-converted workbook upload', () => {
    it('produces a name the server files as CSV', () => {
        expect(extForFileName(csvFileNameFor('Contacts.xlsx', 'Sheet 1'))).toBe('csv');
    });

    it('produces a name the server files as CSV even when the sheet name looks like a suffix', () => {
        // The sanitiser must not be able to hand back something ending in a
        // binary suffix — a sheet may legitimately be called `2024.xlsx`.
        expect(extForFileName(csvFileNameFor('Contacts.xlsx', '2024.xlsx'))).toBe('csv');
    });

    it('files the UNCONVERTED workbook as binary', () => {
        // Positive control. The equality above is only worth asserting if the
        // untransformed name resolves differently — otherwise it would hold for
        // a `csvFileNameFor` that returned its input unchanged, which is
        // precisely the bug it exists to catch.
        expect(extForFileName('Contacts.xlsx')).toBe('bin');
    });
});
