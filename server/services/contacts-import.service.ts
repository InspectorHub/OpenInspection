/**
 * Contacts CSV import — parser + two-phase bulk insert.
 *
 * Two-step UX:
 *  1. POST /api/contacts/import/preview — `parseCsvPreview` returns the first
 *     20 rows + column inference so the frontend can render a mapping UI.
 *  2. POST /api/contacts/import       — `importContacts` re-parses without the
 *     20-row cap, applies the user-chosen column mapping, and imports in two
 *     phases (B-29+):
 *
 *     Phase 1 (in-memory, zero writes): validate EVERY row — name required,
 *     email format, in-file duplicate emails — and dedupe against the
 *     tenant's existing contacts. ANY validation error returns the FULL
 *     error list and writes nothing. (The old row-by-row insert committed
 *     earlier rows before hitting a bad one, so a fixed-file retry
 *     re-inserted them: the DB-9 partial unique index only catches exact-case
 *     email matches, never email-less contacts, and surfaced as raw
 *     constraint-error noise per row rather than a clean result.)
 *
 *     Phase 2 (all rows valid): one db.batch() of inserts chunked to the D1
 *     100-bind-per-statement limit — atomic on D1, all-or-nothing.
 *
 *     skipped ≠ error: blank names and already-in-DB emails are deliberate
 *     skips, so re-importing an appended export only inserts the new rows.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, isNotNull, isNull, and } from 'drizzle-orm';
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

    // ── Phase 1: validate every row in memory — zero writes ────────────────
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];
    const seenEmails = new Map<string, number>(); // lowercased email → first row no
    const candidates: Array<{
        name: string; email: string | null; phone: string | null; agency: string | null;
    }> = [];

    for (let i = 0; i < dataLines.length; i++) {
        const fields = parseCsvLine(dataLines[i]);
        const row: Record<string, string> = {};
        columns.forEach((col, j) => { row[col] = fields[j] ?? ''; });
        const rowNo = i + 2;

        const name = row[mapping.name]?.trim();
        if (!name) { skipped++; continue; }

        const email = mapping.email ? row[mapping.email]?.trim() || null : null;
        if (email && !EMAIL_RE.test(email)) {
            errors.push({ row: rowNo, message: `Invalid email: ${email}` });
            continue;
        }
        if (email) {
            const key = email.toLowerCase();
            const firstRow = seenEmails.get(key);
            if (firstRow !== undefined) {
                errors.push({ row: rowNo, message: `Duplicate email in file: ${email} (already on row ${firstRow})` });
                continue;
            }
            seenEmails.set(key, rowNo);
        }

        candidates.push({
            name,
            email,
            phone: mapping.phone ? row[mapping.phone]?.trim() || null : null,
            agency: mapping.agency ? row[mapping.agency]?.trim() || null : null,
        });
    }

    // ANY file problem → report the complete list, write nothing. The user
    // fixes everything in one pass and retries against an unchanged table.
    if (errors.length > 0) return { inserted: 0, skipped, errors };

    // Against-DB dedup (one SELECT): an email that already exists in this
    // tenant is a deliberate skip, not an error — re-importing an appended
    // export only inserts the new rows. Mirrors the DB-9 partial unique index
    // (email IS NOT NULL AND archived_at IS NULL): archived contacts do NOT
    // block a fresh active row, and the comparison here is case-insensitive
    // (stricter than the case-sensitive index, which the old per-row inserts
    // happily slipped past with a different casing).
    if (candidates.some((c) => c.email)) {
        const existing = await db.select({ email: contacts.email }).from(contacts)
            .where(and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.email),
                isNull(contacts.archivedAt),
            ))
            .all();
        const existingSet = new Set(existing.map((r) => (r.email ?? '').toLowerCase()));
        for (let i = candidates.length - 1; i >= 0; i--) {
            const email = candidates[i].email;
            if (email && existingSet.has(email.toLowerCase())) {
                candidates.splice(i, 1);
                skipped++;
            }
        }
    }
    if (candidates.length === 0) return { inserted: 0, skipped, errors: [] };

    // ── Phase 2: one atomic chunked batch insert ────────────────────────────
    const now = new Date();
    const rows = candidates.map((c) => ({
        id: crypto.randomUUID(),
        tenantId,
        type: mapping.type ?? 'client',
        name: c.name,
        email: c.email,
        phone: c.phone,
        agency: c.agency,
        createdAt: now,
    }));
    // D1 caps bind parameters at 100 per prepared statement; 8 bound columns
    // per row → chunk the VALUES lists, all chunks inside ONE db.batch()
    // (atomic). Drivers without batch (better-sqlite3 unit mock) fall back to
    // sequential chunk inserts, per the starter-content/service.service idiom.
    const colsPerRow = Object.keys(rows[0]!).length;
    const maxRowsPerStmt = Math.max(1, Math.floor(100 / colsPerRow));
    const stmts = [];
    for (let i = 0; i < rows.length; i += maxRowsPerStmt) {
        stmts.push(db.insert(contacts).values(rows.slice(i, i + maxRowsPerStmt)));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (db as any).batch === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).batch(stmts as [any, ...any[]]);
    } else {
        for (const s of stmts) await s;
    }

    return { inserted: rows.length, skipped, errors: [] };
}
