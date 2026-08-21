import { ROLE } from '../../auth/roles';
import type { VendorId } from '../bundle';
import type { AdapterInspection, BundleResult, MigrationAdapter } from './types';
import { csvGenericAdapter, type CsvContactMapping, type CsvMemberMapping } from './csv-generic';
import { spectoraAdapter } from './spectora';

/**
 * The entry points an import can be started from.
 *
 * Declared here rather than imported from the column enum because an adapter
 * may not reach the storage layer — the tie between the two lists is held by an
 * assertion in the registry spec instead of by an import.
 */
export const INTAKE_INTENTS = [
    'templates.create',
    'templates.overwrite',
    'contacts.import',
    'members.invite',
    'assisted.full',
] as const;

type IntakeIntent = typeof INTAKE_INTENTS[number];

/**
 * An entry point that names an entity family, and therefore has something a
 * mapping could describe. `assisted.full` is excluded in the TYPE rather than
 * rejected at runtime: it never runs an adapter, so there is no inspection to
 * turn into a mapping and no answer this function could honestly return.
 */
type MappableIntent = Exclude<IntakeIntent, 'assisted.full'>;

/** The uploaded file, as text plus the name the operator's machine gave it. */
export interface IntakeSource {
    fileName: string;
    text: string;
}

/**
 * Which adapter reads this file, and whether it has columns to map.
 *
 * `inspection` is null for a format with no columns. The wizard reads the null
 * and skips its mapping step — it does not ask which vendor it is looking at.
 */
export interface AdapterMatch {
    vendor: VendorId;
    adapterName: string;
    adapterVersion: string;
    inspection: AdapterInspection | null;
}

/**
 * Everything the file does not say, gathered into one value.
 *
 * A discriminated union rather than a type parameter on the adapter, because a
 * registry of differently-parameterised adapters can only be typed by widening
 * the parameter away — and a widened parameter is the same as no parameter.
 */
export type IntakeMapping =
    | { kind: 'template'; name: string }
    | { kind: 'contacts'; mapping: CsvContactMapping }
    | { kind: 'members'; mapping: CsvMemberMapping };

/**
 * What the registry reads off an adapter: who it is, and whether it can report
 * columns. `convert` is deliberately not in this view — dispatching a
 * conversion needs the mapping's type, which is what `buildBundle` is for.
 */
type AdapterIdentity = Omit<MigrationAdapter<unknown>, 'convert'>;

/**
 * The adapters, keyed by the vendor each one reads.
 *
 * Partial on purpose: `VendorId` names every vendor the stored format can
 * record, including files converted for us outside this codebase, and only some
 * of those have an adapter here.
 */
export const ADAPTER_VENDORS: Readonly<Partial<Record<VendorId, AdapterIdentity>>> = {
    spectora: spectoraAdapter,
    csv_generic: csvGenericAdapter,
};

/**
 * Which vendor's adapter an entry point routes to, decided before the file is
 * read. The entry point already states what was asked for; reading the file to
 * find out would be the inference this design refuses everywhere else.
 */
const VENDOR_FOR_INTENT: Readonly<Record<MappableIntent, VendorId>> = {
    'templates.create': 'spectora',
    'templates.overwrite': 'spectora',
    'contacts.import': 'csv_generic',
    'members.invite': 'csv_generic',
};

/** Header spellings that mean a given field. Matched case-insensitively, whole-cell. */
const NAME_HEADERS = ['name', 'full name', 'fullname', 'contact', 'contact name'];
const EMAIL_HEADERS = ['email', 'e-mail', 'email address'];
const PHONE_HEADERS = ['phone', 'tel', 'mobile', 'phone number'];
const AGENCY_HEADERS = ['agency', 'company', 'organization', 'organisation', 'brokerage', 'firm'];
const ROLE_HEADERS = ['role', 'permission', 'access'];

function pickColumn(columns: string[], candidates: string[]): string | undefined {
    const lowered = columns.map((c) => c.trim().toLowerCase());
    for (const candidate of candidates) {
        const idx = lowered.indexOf(candidate);
        if (idx >= 0) return columns[idx];
    }
    return undefined;
}

/**
 * The text as a JSON document, or null when it is not one.
 *
 * Read in both directions. A JSON file is what the template adapter consumes,
 * and it is also what the spreadsheet adapter must NOT consume: a line splitter
 * finds fields in `{"id":"x","name":"y"}` because the separator it looks for is
 * a comma, so an unguarded match would offer fragments of JSON as columns.
 */
function asJsonDocument(text: string): { value: unknown } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
        return { value: JSON.parse(trimmed) as unknown };
    } catch {
        return null;
    }
}

/** Whether the vendor's adapter reads this kind of file at all. */
function recognises(vendor: VendorId, source: IntakeSource): boolean {
    if (vendor === 'spectora') {
        const doc = asJsonDocument(source.text);
        if (!doc) return false;
        const value = doc.value;
        return typeof value === 'object'
            && value !== null
            && !Array.isArray(value)
            && Array.isArray((value as { sections?: unknown }).sections);
    }
    if (vendor === 'csv_generic') return asJsonDocument(source.text) === null;
    return false;
}

/**
 * Which adapter, if any, can read this file for what the operator asked for.
 *
 * Intent-aware on purpose. The same spreadsheet is readable for a contact
 * import and unreadable for a template import, and answering "which vendor is
 * this" without knowing what was asked would produce a match the write path
 * cannot use.
 *
 * `assisted.full` NEVER matches. That entry exists for a file whose owner could
 * not say what it was; having it guess between a contact list and a staff list
 * is exactly the inference every other entry point is designed to avoid.
 */
export function matchAdapter(intent: IntakeIntent, source: IntakeSource): AdapterMatch | null {
    if (intent === 'assisted.full') return null;
    if (source.text.trim().length === 0) return null;

    const vendor = VENDOR_FOR_INTENT[intent];
    const adapter = ADAPTER_VENDORS[vendor];
    if (!adapter) return null;
    if (!recognises(vendor, source)) return null;

    // The skip rule itself, derived rather than written down per vendor: an
    // adapter with no `inspect` has no columns to offer, so the mapping step
    // has no question to ask. An adapter that grows an `inspect` starts being
    // asked about on the day it does, with no edit here.
    const inspection = adapter.inspect?.(source.text) ?? null;
    // An adapter that CAN report columns and reports none was handed a file it
    // cannot read. One that reports nothing by design says nothing here.
    if (adapter.inspect && !inspection) return null;

    return {
        vendor: adapter.vendor,
        adapterName: adapter.name,
        adapterVersion: adapter.version,
        inspection,
    };
}

/**
 * The mapping the wizard starts from.
 *
 * A guess where a header plainly says what it is, and EMPTY where it does not.
 * The path this replaces fell back to the first column for the name, which
 * imported an email address as everybody's name without saying so; an
 * unanswered mapping has to look unanswered or the step cannot insist.
 */
export function defaultMappingFor(
    intent: MappableIntent,
    inspection: AdapterInspection | null,
    source: IntakeSource,
): IntakeMapping {
    if (intent === 'templates.create' || intent === 'templates.overwrite') {
        return { kind: 'template', name: source.fileName.replace(/\.[^.]+$/, '') };
    }

    const columns = inspection?.columns ?? [];

    if (intent === 'members.invite') {
        const mapping: CsvMemberMapping = {
            email: pickColumn(columns, EMAIL_HEADERS) ?? '',
            role: { fixed: ROLE.INSPECTOR },
        };
        const name = pickColumn(columns, NAME_HEADERS);
        if (name) mapping.name = name;
        const role = pickColumn(columns, ROLE_HEADERS);
        if (role) mapping.role = { column: role };
        return { kind: 'members', mapping };
    }

    const mapping: CsvContactMapping = {
        name: pickColumn(columns, NAME_HEADERS) ?? '',
        // A fixed answer rather than a column: the type set is ours, not the
        // exporting product's, so a column of their words rarely lines up. The
        // operator can switch it to a column in the mapping step.
        type: { fixed: 'client' },
    };
    const email = pickColumn(columns, EMAIL_HEADERS);
    if (email) mapping.email = email;
    const phone = pickColumn(columns, PHONE_HEADERS);
    if (phone) mapping.phone = phone;
    const agency = pickColumn(columns, AGENCY_HEADERS);
    if (agency) mapping.agency = agency;
    return { kind: 'contacts', mapping };
}

/**
 * Runs the adapter for this vendor with the mapping the operator settled on.
 *
 * A mapping that does not belong to the vendor is a refusal rather than a
 * throw: it can only arise from a stored batch whose vendor and mapping have
 * come apart, and the operator needs a sentence, not a 500.
 */
export function buildBundle(
    vendor: VendorId,
    source: IntakeSource,
    mapping: IntakeMapping,
): BundleResult {
    if (vendor === 'spectora') {
        if (mapping.kind !== 'template') {
            return {
                ok: false,
                error: {
                    code: 'MAPPING_MISMATCH',
                    message: 'This import was created from a vendor template export, so it cannot take a column mapping. Start the import again.',
                },
            };
        }
        const doc = asJsonDocument(source.text);
        if (!doc) {
            return {
                ok: false,
                error: {
                    code: 'NOT_AN_EXPORT',
                    message: 'This file is not a template export. Export a single template as JSON and upload that file.',
                },
            };
        }
        return spectoraAdapter.convert(doc.value, { name: mapping.name });
    }

    if (vendor === 'csv_generic') {
        if (mapping.kind === 'contacts') {
            return csvGenericAdapter.convert(source.text, { entity: 'contact', mapping: mapping.mapping });
        }
        if (mapping.kind === 'members') {
            return csvGenericAdapter.convert(source.text, { entity: 'member', mapping: mapping.mapping });
        }
        return {
            ok: false,
            error: {
                code: 'MAPPING_MISMATCH',
                message: 'This import was created from a spreadsheet, so it needs a column mapping rather than a template name. Start the import again.',
            },
        };
    }

    return {
        ok: false,
        error: {
            code: 'NO_ADAPTER',
            message: `No adapter here reads "${vendor}" files, so this import cannot be rebuilt from its source file.`,
        },
    };
}
