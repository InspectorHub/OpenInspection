import { ROLES } from '../../auth/roles';
import { parseCsvTable } from '../csv';
import {
    BUNDLE_CONTACT_TYPES,
    type BundleContact,
    type BundleContactType,
    type BundleMember,
    type BundleMemberRole,
    type EntityCounts,
} from '../bundle';
import type { AdapterInspection, BundleResult, MigrationAdapter } from './types';
import { emptyEntityCounts } from './types';

const CSV_GENERIC_ADAPTER_VERSION = '1';

/**
 * A vocabulary word as WE spell it when the file's spelling matches one, and the
 * file's own text when it does not.
 *
 * Both halves matter. Case-folding is what lets a file saying "Client" or
 * "Inspector" import without anybody editing it. Passing the unmatched text
 * through UNCHANGED is what lets the repair screen show the operator the word
 * they actually typed — "Buyer", not "buyer" — so they can find it in their
 * spreadsheet. The row is judged later, by the describer, not here.
 *
 * The role list handed in is the FULL taxonomy including `agent`, deliberately:
 * canonicalising `Agent` to `agent` is what earns that row the describer's own
 * sentence about per-inspection access instead of a generic "not one of".
 */
function canonicalise(vocabulary: readonly string[], text: string): string {
    return vocabulary.find((word) => word === text.toLowerCase()) ?? text;
}

/**
 * Where a value comes from: a column in the uploaded file, or a single answer
 * the operator gave for the whole file. Both are answers. There is no third
 * shape for "not answered" — a required field with no source is a mapping that
 * has not been completed, and the format will not carry the result.
 */
type CsvValueSource<T> = { column: string } | { fixed: T };

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
    /**
     * The header row and up to five data rows.
     *
     * Five is enough for a person to tell a "Name" column from an "Owner"
     * column and short enough to sit above the mapping controls without the
     * page scrolling. Reading the whole file here would parse it twice for no
     * gain — `convert` re-reads it once the mapping is settled.
     */
    inspect(input: unknown): AdapterInspection | null {
        if (typeof input !== 'string') return null;
        const table = parseCsvTable(input);
        if (table.columns.length === 0) return null;
        return { kind: 'columns', columns: table.columns, sampleRows: table.rows.slice(0, 5) };
    },
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

        // A LINE IS NOT DROPPED FOR BEING WRONG. It is emitted as the file wrote
        // it, and what is wrong with it is said against that row on the repair
        // screen — one bad value costs the operator one row, not the upload.
        //
        // This used to drop four kinds of row: an empty mapped name, a contact
        // type outside our vocabulary, the agent role, and a role outside the
        // ones an import may grant. The describer has a sentence for every one
        // of them, and none of those sentences could ever be shown, because the
        // rows they describe never reached a staging table.
        //
        // ONE drop remains, and it is not a judgement about the data: a line
        // with nothing in ANY mapped column. There is no value on it to repair
        // and no entry it could ever become — it is a spreadsheet artefact, and
        // `dropped` still names its line so the count and the file agree.
        table.rows.forEach((row, i) => {
            const at = `line ${table.lineNumbers[i]}`;

            if (options.entity === 'contact') {
                const m = options.mapping;
                const name = cell(row, m.name);
                const email = cell(row, m.email);
                const phone = cell(row, m.phone);
                const agency = cell(row, m.agency);
                const typeCell = 'fixed' in m.type ? '' : cell(row, m.type.column);
                if (!name && !email && !phone && !agency && !typeCell) {
                    counts.dropped.push({ at, reason: 'every mapped column is empty on this line' });
                    return;
                }
                const entry: BundleContact = {
                    name,
                    type: 'fixed' in m.type
                        ? m.type.fixed
                        : canonicalise(BUNDLE_CONTACT_TYPES, typeCell),
                };
                if (email) entry.email = email;
                if (phone) entry.phone = phone;
                if (agency) entry.agency = agency;
                contacts.push(entry);
                counts.emitted++;
                return;
            }

            const m = options.mapping;
            const email = cell(row, m.email);
            const name = cell(row, m.name);
            const roleCell = 'fixed' in m.role ? '' : cell(row, m.role.column);
            if (!email && !name && !roleCell) {
                counts.dropped.push({ at, reason: 'every mapped column is empty on this line' });
                return;
            }
            // `email` is written even when the cell was empty. The field is
            // required by the format because it is where the invitation goes,
            // and an entry that omitted it would be a row no screen can repair.
            const entry: BundleMember = {
                email,
                role: 'fixed' in m.role ? m.role.fixed : canonicalise(ROLES, roleCell),
            };
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
