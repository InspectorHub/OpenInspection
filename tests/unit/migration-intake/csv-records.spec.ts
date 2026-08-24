/**
 * The reader has to find RECORDS, not lines.
 *
 * Both intake readers used to split the file on `/\r?\n/` and only then run the
 * quote-aware tokeniser over each piece. A quoted field containing a newline
 * was therefore torn in half, the continuation became its own row, and every
 * column after it shifted — silently, because the file is still well-formed
 * CSV and nothing counts what was lost.
 *
 * That is not hypothetical for this product: the contacts export quotes a
 * multi-line note, so our own export was unreadable by our own importer.
 */
import { describe, it, expect } from 'vitest';
import { parseCsvPreview, parseCsvTable } from '../../../server/lib/migration-intake/csv';

describe('csv records', () => {
    it('keeps a quoted newline inside one field', () => {
        const csv = 'name,notes\r\nDana,"first line\r\nsecond line"\r\nRoss,plain\r\n';
        const table = parseCsvTable(csv);
        expect(table.rows).toHaveLength(2);
        expect(table.rows[0].notes).toBe('first line\r\nsecond line');
        expect(table.rows[1].name).toBe('Ross');
    });

    it('numbers a row by the line its record STARTED on', () => {
        // A repair sentence pointing at the wrong line is barely better than no
        // sentence: the operator has to find the row in their spreadsheet.
        const csv = 'name,notes\nDana,"a\nb"\nRoss,plain\n';
        const table = parseCsvTable(csv);
        expect(table.lineNumbers).toEqual([2, 4]);
    });

    it('POSITIVE CONTROL — a file with no quoted newline is unchanged', () => {
        const csv = 'name,email\nDana,dana@example.com\nRoss,ross@example.com\n';
        const table = parseCsvTable(csv);
        expect(table.columns).toEqual(['name', 'email']);
        expect(table.rows).toHaveLength(2);
        expect(table.lineNumbers).toEqual([2, 3]);
    });

    it('POSITIVE CONTROL — the preview reader agrees with the table reader', () => {
        // Two readers with two splitting rules is how a preview and a commit
        // come to disagree about which column is which.
        const csv = 'name,notes\nDana,"a\nb"\n';
        expect(parseCsvPreview(csv).rows[0].notes).toBe(parseCsvTable(csv).rows[0].notes);
        // The agreement alone is not enough: two readers that are wrong in the
        // SAME way agree perfectly, which is exactly what they did before this.
        // So the shared answer is named as well as compared.
        expect(parseCsvPreview(csv).rows[0].notes).toBe('a\nb');
    });

    it('treats an unterminated quote as one final record rather than throwing', () => {
        // A malformed file has to arrive at the repair screen, not at a 500.
        const csv = 'name,notes\nDana,"never closed\n';
        expect(() => parseCsvTable(csv)).not.toThrow();
        expect(parseCsvTable(csv).rows).toHaveLength(1);
    });

    it('still skips a blank line between records', () => {
        // The old readers filtered empty pieces, and a spreadsheet program
        // trailing a blank line is common enough that dropping that behaviour
        // would turn every such file into one empty row.
        const csv = 'name,email\nDana,dana@example.com\n\nRoss,ross@example.com\n';
        const table = parseCsvTable(csv);
        expect(table.rows).toHaveLength(2);
        expect(table.lineNumbers).toEqual([2, 4]);
    });
});
