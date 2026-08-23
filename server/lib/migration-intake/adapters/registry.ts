import { ROLE } from '../../auth/roles';
import type { TemplateRatingKind, VendorId } from '../bundle';
import type { AdapterInspection, BundleResult, MigrationAdapter } from './types';
import { csvGenericAdapter, type CsvContactMapping, type CsvMemberMapping } from './csv-generic';
import { homeInspectorProAdapter } from './home-inspector-pro';
import { spectoraAdapter } from './spectora';
import {
    CONTAINER_VENDORS,
    TABULAR_VENDOR,
    isZipContainer,
    type IntakeSource,
} from './source';

/**
 * Re-exported so a caller keeps ONE import for the intake layer. The split is
 * about file size and about what a fact is ABOUT — the upload's form versus
 * which reader claims it — not about a boundary callers should have to know.
 */
export {
    intakeSourceFromBytes,
    intakeSourceFromText,
    type IntakeSource,
} from './source';

/**
 * The entry points an import can be started from.
 *
 * Declared here rather than imported from the column enum because an adapter
 * may not reach the storage layer — the tie between the two lists is held by an
 * assertion in the registry spec instead of by an import.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. These are OUR entry
 * points, named by this product for its own screens. None of them is read out
 * of anybody's file.
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
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — one of our own entry
 * points, subtracted from our own list.
 */
type MappableIntent = Exclude<IntakeIntent, 'assisted.full'>;


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
 *
 * `ratingKind` is what the operator said the template's own rating words mean.
 * It is read by the adapters whose vocabulary describes ITEMS; an export whose
 * words file comments has nothing to answer, so the wizard never asks it and
 * `defaultMappingFor` supplies the reading that changes nothing.
 *
 * ⚠️ ONE LINE PER ARM, and the template arm LAST. The converter-literal gate
 * reads a declaration by accumulating lines until one ends in a semicolon, so a
 * field written on its own line inside an earlier arm ends the declaration
 * there — and every literal after it silently stops being classified while the
 * gate still reports green.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. `template`, `contacts`
 * and `members` are OUR entity vocabulary, decided by the entry point the
 * operator chose rather than read out of a file.
 */
export type IntakeMapping =
    | { kind: 'contacts'; mapping: CsvContactMapping }
    | { kind: 'members'; mapping: CsvMemberMapping }
    | { kind: 'template'; name: string; ratingKind: TemplateRatingKind };

/**
 * What the registry reads off an adapter: who it is, and whether it can report
 * columns. `convert` is deliberately not in this view — dispatching a
 * conversion needs the mapping's type, which is what `buildBundle` is for.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — the name of a method
 * on our own interface.
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
    home_inspector_pro: homeInspectorProAdapter,
    csv_generic: csvGenericAdapter,
};

/** A file that is not what the operator said it was, and what it looks like instead. */
export interface VendorMismatch {
    declared: VendorId;
    /** null when nothing here recognises it either — the assisted path, not a correction. */
    looksLike: VendorId | null;
}

/**
 * Header spellings that mean a given field. Matched case-insensitively, whole-cell.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATORS. Ordinary English words
 * for the fields a contact list holds, gathered here so a spreadsheet exported
 * from anywhere can be recognised. They belong to no product: nothing in this
 * list came from any one export, and no product's own vocabulary is reproduced
 * by it. Exported so `../contacts-template.ts` DERIVES the starter file.
 */
export const CONTACT_HEADERS = {
    name: ['name', 'full name', 'fullname', 'contact', 'contact name'],
    email: ['email', 'e-mail', 'email address'],
    phone: ['phone', 'tel', 'mobile', 'phone number'],
    agency: ['agency', 'company', 'organization', 'organisation', 'brokerage', 'firm'],
    role: ['role', 'permission', 'access'],
} as const;

function pickColumn(columns: string[], candidates: readonly string[]): string | undefined {
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
 * Read in one direction only: it is what the spreadsheet adapter must NOT
 * consume. A line splitter finds fields in `{"id":"x","name":"y"}` because the
 * separator it looks for is a comma, so an unguarded match would offer
 * fragments of a JSON document as column headings.
 */
function asJsonDocument(text: string): { value: unknown } | null {
    const trimmed = text.trim();
    // ⚠️ LITERAL-USE CLASSIFICATION: PUBLIC STANDARD VALUE. The two characters
    // a JSON document may begin with, from that format's own specification.
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
        return { value: JSON.parse(trimmed) as unknown };
    } catch {
        return null;
    }
}

/**
 * Whether the vendor's adapter reads this kind of file at all.
 *
 * A cheap pre-filter, not the verdict. The adapter's own `inspect` is
 * authoritative — this exists so a text adapter is never handed a container's
 * bytes decoded as UTF-8, which is not a failed parse but a destroyed file.
 */
function recognises(vendor: VendorId, source: IntakeSource): boolean {
    if (CONTAINER_VENDORS.includes(vendor)) return isZipContainer(source);
    if (vendor === TABULAR_VENDOR) {
        return !isZipContainer(source) && asJsonDocument(source.text()) === null;
    }
    return false;
}

/**
 * The file in the form this vendor's adapter reads it.
 *
 * BYTES for a container, TEXT for a tabular file. The registry decides because
 * it is the only place that knows both which adapter is being asked and what
 * the operator uploaded; an adapter that had to accept both forms would carry a
 * decode it has no way to judge.
 */
function inputFor(vendor: VendorId, source: IntakeSource): unknown {
    return CONTAINER_VENDORS.includes(vendor) ? source.bytes : source.text();
}

/**
 * Which adapter reads this file, given what the operator said it is.
 *
 * ── Why the caller names the vendor ─────────────────────────────────────────
 * This used to derive the vendor from the intent: `templates.create` meant
 * Spectora, always. So the product could read exactly one vendor's templates
 * and the code could not say so — a file from any other product got "nothing
 * could read that", which is true and useless.
 *
 * With the declaration in hand the question changes from "can I read this" to
 * "is this what you said it was", and THAT has a specific answer. See
 * `describeVendorMismatch`.
 *
 * `assisted.full` NEVER matches, whatever is declared. That entry exists for a
 * file whose owner could not say what it was; having it guess is exactly the
 * inference every other entry point is designed to avoid.
 */
export async function matchAdapter(
    intent: IntakeIntent,
    vendor: VendorId,
    source: IntakeSource,
): Promise<AdapterMatch | null> {
    if (intent === 'assisted.full') return null;
    if (source.bytes.byteLength === 0) return null;

    const adapter = ADAPTER_VENDORS[vendor];
    // A vendor with no adapter is a normal answer, not an error: `VendorId`
    // names every vendor the stored format can record, and only some have a
    // reader here. The wizard routes the rest to the assisted path.
    if (!adapter) return null;
    if (!recognises(vendor, source)) return null;

    // Async because reading a container means decompressing it, and
    // decompression on this platform is a stream.
    const inspection = (await adapter.inspect?.(inputFor(vendor, source))) ?? null;
    // An adapter that CAN report and reports nothing was handed a file it
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
 * What the file looks like, when it is not what the operator declared.
 *
 * Returns null when the declaration was right — so a caller can ask this
 * unconditionally and only render a sentence when there is one.
 *
 * `looksLike` is null when nothing here recognises the file either. That is a
 * different sentence from "this looks like another vendor's file": one offers a
 * correction, the other offers the assisted path, and conflating them sends
 * people down the wrong one.
 */
export async function describeVendorMismatch(
    intent: IntakeIntent,
    declared: VendorId,
    source: IntakeSource,
): Promise<VendorMismatch | null> {
    if ((await matchAdapter(intent, declared, source)) !== null) return null;
    for (const vendor of Object.keys(ADAPTER_VENDORS) as VendorId[]) {
        if (vendor === declared) continue;
        if ((await matchAdapter(intent, vendor, source)) !== null) {
            return { declared, looksLike: vendor };
        }
    }
    return { declared, looksLike: null };
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
        // The file's own name beats the filename: a real vendor template calls
        // itself something meaningful while its file is named for whoever saved
        // it. The filename is the fallback, not the answer.
        const own = inspection?.kind === 'template' ? inspection.name : null;
        return {
            kind: 'template',
            name: own ?? source.fileName.replace(/\.[^.]+$/, ''),
            // The reading that preserves what the file already says: its words
            // become the item's rating options, verbatim. Any other default
            // would silently restructure a template for an operator who never
            // opened the step — and this is the ONE answer that is not a guess
            // about meaning, because it changes nothing.
            ratingKind: 'severity',
        };
    }

    // ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — the name of one
    // of our own inspection arms; see `AdapterInspection`.
    const columns = inspection?.kind === 'columns' ? inspection.columns : [];

    if (intent === 'members.invite') {
        const mapping: CsvMemberMapping = {
            email: pickColumn(columns, CONTACT_HEADERS.email) ?? '',
            role: { fixed: ROLE.INSPECTOR },
        };
        const name = pickColumn(columns, CONTACT_HEADERS.name);
        if (name) mapping.name = name;
        const role = pickColumn(columns, CONTACT_HEADERS.role);
        if (role) mapping.role = { column: role };
        return { kind: 'members', mapping };
    }

    const mapping: CsvContactMapping = {
        name: pickColumn(columns, CONTACT_HEADERS.name) ?? '',
        // A fixed answer rather than a column: the type set is ours, not the
        // exporting product's, so a column of their words rarely lines up. The
        // operator can switch it to a column in the mapping step.
        type: { fixed: 'client' },
    };
    const email = pickColumn(columns, CONTACT_HEADERS.email);
    if (email) mapping.email = email;
    const phone = pickColumn(columns, CONTACT_HEADERS.phone);
    if (phone) mapping.phone = phone;
    const agency = pickColumn(columns, CONTACT_HEADERS.agency);
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
export async function buildBundle(
    vendor: VendorId,
    source: IntakeSource,
    mapping: IntakeMapping,
): Promise<BundleResult> {
    if (CONTAINER_VENDORS.includes(vendor)) {
        if (mapping.kind !== 'template') {
            return {
                ok: false,
                error: {
                    code: 'MAPPING_MISMATCH',
                    message: 'This import was created from a vendor template export, so it cannot take a column mapping. Start the import again.',
                },
            };
        }
        // Each adapter is handed the BYTES and does its own shape test, so a
        // file that is not that vendor's export is refused with the adapter's
        // own sentence rather than with a second one written here that could
        // disagree with it.
        if (vendor === 'home_inspector_pro') {
            return homeInspectorProAdapter.convert(source.bytes, {
                name: mapping.name,
                ratingKind: mapping.ratingKind,
            });
        }
        // The Spectora adapter takes no rating answer, and that is a statement
        // rather than an omission: its vocabulary files comments into the three
        // tabs, so there is no question to pass on. Its options type says so,
        // which is what stops an answer being handed over and quietly dropped.
        return spectoraAdapter.convert(source.bytes, { name: mapping.name });
    }

    if (vendor === TABULAR_VENDOR) {
        if (mapping.kind === 'contacts') {
            return csvGenericAdapter.convert(source.text(), { entity: 'contact', mapping: mapping.mapping });
        }
        if (mapping.kind === 'members') {
            return csvGenericAdapter.convert(source.text(), { entity: 'member', mapping: mapping.mapping });
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
