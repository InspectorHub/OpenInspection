import { ROLE, ROLES } from '../../auth/roles';
import { parseCsvTable } from '../csv';
import {
    BUNDLE_CONTACT_TYPES,
    type BundleContact,
    type BundleContactType,
    type BundleMember,
    type BundleMemberRole,
    type EntityCounts,
} from '../bundle';
import type { BundleResult, MigrationAdapter } from './types';
import { emptyEntityCounts } from './types';

const CSV_GENERIC_ADAPTER_VERSION = '1';

/**
 * The roles a member row may name: the role taxonomy minus the one this format
 * excludes, subtracted at runtime rather than re-typed as literals.
 *
 * The compiler does NOT check this — a type predicate is an unchecked
 * assertion, verified. What the subtraction buys is behavioural: a role added
 * to the taxonomy is accepted by an upload the day it exists, whereas a
 * hand-written list keeps matching its own three literals and refuses the new
 * role with "not one of owner, manager, inspector" — a message that reads like
 * the operator's file is wrong.
 */
const BUNDLE_MEMBER_ROLES: readonly BundleMemberRole[] =
    ROLES.filter((r): r is BundleMemberRole => r !== ROLE.AGENT);

/**
 * Where a value comes from: a column in the uploaded file, or a single answer
 * the operator gave for the whole file. Both are answers. There is no third
 * shape for "not answered" — a required field with no source is a mapping that
 * has not been completed, and the format will not carry the result.
 */
export type CsvValueSource<T> = { column: string } | { fixed: T };

export interface CsvContactMapping {
    name: string;
    email?: string | undefined;
    phone?: string | undefined;
    agency?: string | undefined;
    type: CsvValueSource<BundleContactType>;
}

export interface CsvMemberMapping {
    email: string;
    name?: string | undefined;
    role: CsvValueSource<BundleMemberRole>;
}

export type CsvGenericOptions =
    | { entity: 'contact'; mapping: CsvContactMapping }
    | { entity: 'member'; mapping: CsvMemberMapping };

function missingColumn(columns: string[], wanted: string): boolean {
    return !columns.includes(wanted);
}

function requiredColumns(options: CsvGenericOptions): string[] {
    if (options.entity === 'contact') {
        const m = options.mapping;
        const cols = [m.name, m.email, m.phone, m.agency].filter((c): c is string => typeof c === 'string');
        if ('column' in m.type) cols.push(m.type.column);
        return cols;
    }
    const m = options.mapping;
    const cols = [m.email, m.name].filter((c): c is string => typeof c === 'string');
    if ('column' in m.role) cols.push(m.role.column);
    return cols;
}

function cell(row: Record<string, string>, column?: string | undefined): string {
    if (!column) return '';
    return (row[column] ?? '').trim();
}

/**
 * The generic spreadsheet entry into the normalised format.
 *
 * `input` is the CSV text. Everything the file does not say — which column
 * means what, and what kind of contact or which role these rows are — arrives
 * through `options`, so the adapter never has to guess. A guess has a case it
 * gets wrong, and the wrong case here is silent: a header it cannot match
 * becomes a column assignment nobody asked for.
 */
export const csvGenericAdapter: MigrationAdapter<CsvGenericOptions> = {
    name: 'csv-generic',
    version: CSV_GENERIC_ADAPTER_VERSION,
    vendor: 'csv_generic',
    convert(input: unknown, options: CsvGenericOptions): BundleResult {
        if (typeof input !== 'string') {
            return { ok: false, error: { code: 'NOT_TEXT', message: 'The uploaded file could not be read as text.' } };
        }
        const table = parseCsvTable(input);
        if (table.columns.length === 0) {
            return { ok: false, error: { code: 'EMPTY_FILE', message: 'The uploaded file is empty.' } };
        }
        for (const wanted of requiredColumns(options)) {
            if (missingColumn(table.columns, wanted)) {
                return {
                    ok: false,
                    error: {
                        code: 'MISSING_COLUMN',
                        message: `The file has no column named "${wanted}". Change the mapping, or add that column and upload again.`,
                    },
                };
            }
        }

        const counts: EntityCounts = { readFromSource: table.rows.length, emitted: 0, dropped: [] };
        const contacts: BundleContact[] = [];
        const members: BundleMember[] = [];

        table.rows.forEach((row, i) => {
            const at = `line ${table.lineNumbers[i]}`;

            if (options.entity === 'contact') {
                const m = options.mapping;
                const name = cell(row, m.name);
                if (!name) {
                    counts.dropped.push({ at, reason: 'the mapped name column is empty' });
                    return;
                }
                let type: BundleContactType;
                if ('fixed' in m.type) {
                    type = m.type.fixed;
                } else {
                    const raw = cell(row, m.type.column).toLowerCase();
                    const match = BUNDLE_CONTACT_TYPES.find((t) => t === raw);
                    if (!match) {
                        counts.dropped.push({
                            at,
                            reason: `contact type "${cell(row, m.type.column)}" is not one of ${BUNDLE_CONTACT_TYPES.join(', ')}`,
                        });
                        return;
                    }
                    type = match;
                }
                const entry: BundleContact = { name, type };
                const email = cell(row, m.email);
                if (email) entry.email = email;
                const phone = cell(row, m.phone);
                if (phone) entry.phone = phone;
                const agency = cell(row, m.agency);
                if (agency) entry.agency = agency;
                contacts.push(entry);
                counts.emitted++;
                return;
            }

            const m = options.mapping;
            const email = cell(row, m.email);
            if (!email) {
                counts.dropped.push({ at, reason: 'the mapped email column is empty' });
                return;
            }
            let role: BundleMemberRole;
            if ('fixed' in m.role) {
                role = m.role.fixed;
            } else {
                const raw = cell(row, m.role.column).toLowerCase();
                if (raw === ROLE.AGENT) {
                    counts.dropped.push({
                        at,
                        reason: 'agent access is granted per inspection and cannot be imported here',
                    });
                    return;
                }
                const match = BUNDLE_MEMBER_ROLES.find((r) => r === raw);
                if (!match) {
                    counts.dropped.push({
                        at,
                        reason: `role "${cell(row, m.role.column)}" is not one of ${BUNDLE_MEMBER_ROLES.join(', ')}`,
                    });
                    return;
                }
                role = match;
            }
            const entry: BundleMember = { email, role };
            const name = cell(row, m.name);
            if (name) entry.name = name;
            members.push(entry);
            counts.emitted++;
        });

        return {
            ok: true,
            bundle: {
                formatVersion: 1,
                manifest: {
                    source: { vendor: 'csv_generic' },
                    adapter: { name: 'csv-generic', version: CSV_GENERIC_ADAPTER_VERSION },
                    counts: {
                        template: emptyEntityCounts(),
                        contact: options.entity === 'contact' ? counts : emptyEntityCounts(),
                        member: options.entity === 'member' ? counts : emptyEntityCounts(),
                    },
                    warnings: [],
                },
                templates: [],
                contacts,
                members,
            },
        };
    },
};
