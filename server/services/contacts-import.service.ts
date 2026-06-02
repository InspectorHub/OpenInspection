/**
 * Contacts CSV import — parser + bulk insert.
 *
 * Two-step UX:
 *  1. POST /api/contacts/import/preview — `parseCsvPreview` returns the first
 *     20 rows + column inference so the frontend can render a mapping UI.
 *  2. POST /api/contacts/import       — `importContacts` re-parses without the
 *     20-row cap, applies the user-chosen column mapping, and bulk-inserts
 *     contacts with per-row error capture (one bad row doesn't fail the batch).
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { contacts } from '../lib/db/schema';

const MAX_PREVIEW_ROWS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CsvPreviewResult {
    columns: string[];
    rows: Record<string, string>[];
    totalRowsDetected: number;
    truncated: boolean;
}

export interface ImportMapping {
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    agency?: string | undefined;
    type?: 'agent' | 'client' | undefined;
}

export interface ImportResult {
    inserted: number;
    skipped: number;
    errors: { row: number; message: string }[];
}

/**
 * Tokenises a single CSV line respecting double-quoted fields (RFC 4180 lite).
 * Embedded `""` escapes a literal quote. Commas outside quotes split fields.
 */
function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { cur += ch; }
        } else {
            if (ch === ',') { out.push(cur); cur = ''; }
            else if (ch === '"' && cur === '') { inQuotes = true; }
            else { cur += ch; }
        }
    }
    out.push(cur);
    return out;
}

export function parseCsvPreview(csv: string): CsvPreviewResult {
    const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return { columns: [], rows: [], totalRowsDetected: 0, truncated: false };
    const columns = parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);
    const totalRowsDetected = dataLines.length;
    const previewLines = dataLines.slice(0, MAX_PREVIEW_ROWS);
    const rows = previewLines.map((line) => {
        const fields = parseCsvLine(line);
        const row: Record<string, string> = {};
        columns.forEach((col, i) => { row[col] = fields[i] ?? ''; });
        return row;
    });
    return { columns, rows, totalRowsDetected, truncated: totalRowsDetected > MAX_PREVIEW_ROWS };
}

export async function importContacts(
    db: DrizzleD1Database,
    tenantId: string,
    csv: string,
    mapping: ImportMapping,
): Promise<ImportResult> {
    const allLines = csv.split(/\r?\n/).filter((l) => l.length > 0);
    if (allLines.length === 0) return { inserted: 0, skipped: 0, errors: [] };
    const columns = parseCsvLine(allLines[0]);
    const dataLines = allLines.slice(1);

    let inserted = 0;
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < dataLines.length; i++) {
        const fields = parseCsvLine(dataLines[i]);
        const row: Record<string, string> = {};
        columns.forEach((col, j) => { row[col] = fields[j] ?? ''; });

        const name = row[mapping.name]?.trim();
        if (!name) { skipped++; continue; }

        const email = mapping.email ? row[mapping.email]?.trim() || null : null;
        if (email && !EMAIL_RE.test(email)) {
            errors.push({ row: i + 2, message: `Invalid email: ${email}` });
            continue;
        }

        try {
            await db.insert(contacts).values({
                id: crypto.randomUUID(),
                tenantId,
                type: mapping.type ?? 'client',
                name,
                email,
                phone: mapping.phone ? row[mapping.phone]?.trim() || null : null,
                agency: mapping.agency ? row[mapping.agency]?.trim() || null : null,
                createdAt: new Date(),
            });
            inserted++;
        } catch (e) {
            errors.push({ row: i + 2, message: e instanceof Error ? e.message : 'insert failed' });
        }
    }

    return { inserted, skipped, errors };
}
