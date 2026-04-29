import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray } from 'drizzle-orm';
import { inspections, contacts } from '../lib/db/schema';

function csvRow(fields: (string | number | boolean | null | undefined)[]): string {
    return fields.map(f => {
        const s = String(f ?? '').replace(/"/g, '""');
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(',');
}

function parseCSV(text: string): string[][] {
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
    return lines.map(line => {
        const row: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) { row.push(current); current = ''; }
            else current += ch;
        }
        row.push(current);
        return row;
    });
}

export class DataService {
    constructor(private db: D1Database) {}
    private getDrizzle() { return drizzle(this.db as any); }

    // ── Export ─────────────────────────────────────────────────────────────────

    async exportInspectionsCSV(tenantId: string): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select().from(inspections)
            .where(eq(inspections.tenantId, tenantId))
            .orderBy(inspections.date);

        const header = csvRow([
            'id', 'date', 'property_address', 'unit', 'client_name', 'client_email', 'client_phone',
            'status', 'payment_status', 'price_cents', 'year_built', 'sqft', 'foundation_type',
            'bedrooms', 'bathrooms', 'county', 'inspector_id', 'referred_by_agent_id',
            'confirmed_at', 'cancel_reason', 'internal_notes', 'created_at',
        ]);
        const dataRows = rows.map(r => csvRow([
            r.id, r.date, r.propertyAddress, r.unit, r.clientName, r.clientEmail, r.clientPhone,
            r.status, r.paymentStatus, r.price,
            r.yearBuilt, r.sqft, r.foundationType, r.bedrooms, r.bathrooms, r.county,
            r.inspectorId, r.referredByAgentId,
            r.confirmedAt, r.cancelReason, r.internalNotes,
            r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        ]));
        return [header, ...dataRows].join('\n');
    }

    async exportContactsCSV(tenantId: string): Promise<string> {
        const db = this.getDrizzle();
        const rows = await db.select().from(contacts)
            .where(eq(contacts.tenantId, tenantId));

        const header = csvRow(['id', 'type', 'name', 'email', 'phone', 'agency', 'notes', 'created_at']);
        const dataRows = rows.map(r => csvRow([
            r.id, r.type, r.name, r.email, r.phone, r.agency, r.notes,
            r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
        ]));
        return [header, ...dataRows].join('\n');
    }

    // ── Import ──────────────────────────────────────────────────────────────────

    /**
     * Imports contacts from CSV. Supports Spectora/ITB column name variants.
     * Contacts schema uses a single `name` field and `agency` (not company).
     * Returns { imported, skipped, errors }.
     */
    async importContactsCSV(tenantId: string, csvText: string): Promise<{
        imported: number; skipped: number; errors: string[];
    }> {
        const rows = parseCSV(csvText);
        if (rows.length < 2) return { imported: 0, skipped: 0, errors: ['CSV has no data rows'] };

        const headers = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
        // Map column variants (Spectora uses "first name"/"last name", ITB may use "name")
        const col = (names: string[]): number => {
            for (const n of names) { const idx = headers.indexOf(n); if (idx >= 0) return idx; }
            return -1;
        };
        const typeIdx    = col(['type', 'contact_type', 'role']);
        const nameIdx    = col(['name', 'full_name', 'fullname', 'contact_name']);
        const firstIdx   = col(['first_name', 'first name', 'firstname']);
        const lastIdx    = col(['last_name', 'last name', 'lastname']);
        const emailIdx   = col(['email', 'email_address', 'e-mail']);
        const phoneIdx   = col(['phone', 'phone_number', 'mobile']);
        const agencyIdx  = col(['agency', 'company', 'organization', 'firm']);

        const db = this.getDrizzle();
        let imported = 0; let skipped = 0; const errors: string[] = [];

        // Collect all emails from CSV, then batch-check for existing contacts
        const allEmails: string[] = [];
        for (let i = 1; i < rows.length; i++) {
            const email = emailIdx >= 0 ? rows[i][emailIdx]?.trim() : '';
            if (email) allEmails.push(email);
        }

        // Batch-load existing emails in one query instead of N queries
        const existingEmails = new Set<string>();
        if (allEmails.length > 0) {
            const existing = await db.select({ email: contacts.email }).from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), inArray(contacts.email, allEmails)));
            for (const row of existing) {
                if (row.email) existingEmails.add(row.email);
            }
        }

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const email = emailIdx >= 0 ? row[emailIdx]?.trim() : '';
            if (!email) { skipped++; continue; }

            if (existingEmails.has(email)) { skipped++; continue; }
            existingEmails.add(email); // Prevent duplicates within the same CSV

            try {
                const typeRaw = typeIdx >= 0 ? row[typeIdx]?.trim().toLowerCase() : 'client';
                const type = (['agent', 'client'].includes(typeRaw ?? ''))
                    ? (typeRaw as 'agent' | 'client')
                    : 'client';

                // Prefer `name` column; fall back to joining first + last
                let name = nameIdx >= 0 ? row[nameIdx]?.trim() || '' : '';
                if (!name && (firstIdx >= 0 || lastIdx >= 0)) {
                    const first = firstIdx >= 0 ? row[firstIdx]?.trim() || '' : '';
                    const last  = lastIdx  >= 0 ? row[lastIdx]?.trim()  || '' : '';
                    name = [first, last].filter(Boolean).join(' ');
                }
                if (!name) name = email;  // last resort

                await db.insert(contacts).values({
                    id:        crypto.randomUUID(),
                    tenantId,
                    type,
                    name,
                    email,
                    phone:     phoneIdx  >= 0 ? row[phoneIdx]?.trim()  || null : null,
                    agency:    agencyIdx >= 0 ? row[agencyIdx]?.trim() || null : null,
                    createdAt: new Date(),
                });
                imported++;
            } catch (err) {
                errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
        }
        return { imported, skipped, errors };
    }
}
